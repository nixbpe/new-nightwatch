import { randomBytes } from "node:crypto";

import {
  awsRoleArnAccountId,
  type AwsTestFailureCode,
  type OrganizationAwsConnectionRequest,
  type OrganizationAwsConnectionResponse,
  type OrganizationAwsConnectionTestResponse,
  type OrganizationAwsProject,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError, StsError, type StsVerifier } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent, type AuditEventInput } from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "../organization-notifications/service";
import { membershipDenied } from "../projects/service";
import { consumeAwsTestRateLimit, type RateLimiter } from "../rate-limit";

export type AwsConnectionDeps = {
  database: Database;
  /** NightWatch's principal for the trust policy, or null when not configured. */
  principalArn: string | null;
  /** Absent only in apps built without AWS (OpenAPI emission, unrelated tests). */
  sts?: StsVerifier;
  /** Absent when the API has no Redis: Test and PUT then answer 503. */
  rateLimiter?: RateLimiter;
};

export type Identity = {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
};

type AdminRole = "owner" | "admin";

type ConnectionRow = {
  externalId: string;
  roleArn: string | null;
  verifiedAccountId: string | null;
  verifiedArn: string | null;
  testedAt: Date | null;
  revision: number;
  updatedAt: Date | null;
  updatedById: string | null;
  updatedByName: string | null;
};

type ProjectRow = {
  projectId: string;
  projectName: string;
  roleArn: string;
  result: "passed" | "failed" | null;
  code: AwsTestFailureCode | null;
  testedAt: Date | null;
  orgRevision: number | null;
};

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

// RFC 4648 base32, lowercase, unpadded: 16 bytes give 26 characters.
function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

// The slug is display only; the random part makes the ID unguessable. The
// result stays inside the AWS ExternalId charset and the table's CHECK.
export function newOrganizationExternalId(slug: string): string {
  const label = slug
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .slice(0, 40);
  return `nw-org-${label}-${base32(randomBytes(16))}`;
}

function permissionDenied(): never {
  throw new AppError(
    403,
    "PERMISSION_DENIED",
    "เฉพาะเจ้าของและผู้ดูแลองค์กรจัดการการเชื่อมต่อ AWS ได้",
  );
}

function revisionConflict(currentRevision: number): never {
  throw new AppError(
    409,
    "AWS_CONNECTION_REVISION_CONFLICT",
    "การเชื่อมต่อ AWS ถูกแก้ไขจากคำขออื่น โหลดหน้าใหม่ก่อนดำเนินการต่อ",
    { currentRevision },
  );
}

// Membership changes lock the organization row FOR UPDATE, so the role read
// under FOR SHARE holds until the transaction ends.
async function lockAdmin(
  client: PoolClient,
  identity: Identity,
): Promise<{ role: AdminRole; slug: string }> {
  const organization = await client.query<{ slug: string }>(
    "select slug from organization where id = $1 for share",
    [identity.organizationId],
  );
  const slug = organization.rows[0]?.slug;
  if (slug === undefined) membershipDenied();
  const member = await client.query<{ role: string }>(
    "select role from member where organization_id = $1 and user_id = $2",
    [identity.organizationId, identity.actorUserId],
  );
  const raw = member.rows[0]?.role;
  if (raw === undefined) membershipDenied();
  const role = normalizeOrganizationRole(raw);
  if (role !== "owner" && role !== "admin") permissionDenied();
  return { role, slug };
}

const CONNECTION_SELECT = `
  select c.external_id as "externalId", c.role_arn as "roleArn",
         c.verified_account_id as "verifiedAccountId",
         c.verified_arn as "verifiedArn", c.tested_at as "testedAt",
         c.revision, c.updated_at as "updatedAt",
         m.user_id as "updatedById", u.name as "updatedByName"
  from org_aws_connections c
  left join member m on m.organization_id = c.tenant_id and m.user_id = c.updated_by
  left join "user" u on u.id = m.user_id
  where c.tenant_id = $1`;

async function selectConnection(
  client: PoolClient,
  organizationId: string,
  lock: boolean,
): Promise<ConnectionRow> {
  const result = await client.query<ConnectionRow>(
    `${CONNECTION_SELECT}${lock ? " for update of c" : ""}`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("AWS connection row missing");
  return row;
}

// Concurrent first reads insert at most one row: the losers' inserts wait for
// the winner's commit and do nothing, then the select sees the winner's row.
async function ensureConnection(
  client: PoolClient,
  organizationId: string,
  slug: string,
  lock = false,
): Promise<ConnectionRow> {
  await client.query(
    `insert into org_aws_connections (tenant_id, external_id) values ($1, $2)
     on conflict (tenant_id) do nothing`,
    [organizationId, newOrganizationExternalId(slug)],
  );
  return selectConnection(client, organizationId, lock);
}

function projectStatus(
  row: ProjectRow,
  connection: ConnectionRow,
): OrganizationAwsProject["status"] {
  if (row.result === null) return "untested";
  if (connection.roleArn === null || row.orgRevision !== connection.revision) {
    return "stale";
  }
  return row.result;
}

async function responseBody(
  client: PoolClient,
  organizationId: string,
  connection: ConnectionRow,
  principalArn: string | null,
): Promise<OrganizationAwsConnectionResponse> {
  const projects = await client.query<ProjectRow>(
    `select pc.project_id as "projectId", p.name as "projectName",
            pc.role_arn as "roleArn", pc.last_test_result as result,
            pc.last_test_code as code, pc.last_tested_at as "testedAt",
            pc.org_connection_revision as "orgRevision"
     from project_aws_connections pc
     join projects p on p.tenant_id = pc.tenant_id and p.id = pc.project_id
     where pc.tenant_id = $1 and pc.method = 'assume_role'
     order by p.name, p.id`,
    [organizationId],
  );
  const {
    roleArn,
    verifiedAccountId,
    verifiedArn,
    testedAt,
    updatedAt,
    updatedById,
    updatedByName,
  } = connection;
  return {
    externalId: connection.externalId,
    principalArn,
    revision: connection.revision,
    connection:
      roleArn && verifiedAccountId && verifiedArn && testedAt && updatedAt
        ? {
            roleArn,
            accountId: verifiedAccountId,
            verifiedArn,
            testedAt: testedAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
            updatedBy:
              updatedById && updatedByName
                ? { id: updatedById, name: updatedByName }
                : null,
          }
        : null,
    projects: projects.rows.map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      roleArn: row.roleArn,
      accountId: awsRoleArnAccountId(row.roleArn),
      lastTest:
        row.result && row.testedAt
          ? {
              result: row.result,
              code: row.code,
              testedAt: row.testedAt.toISOString(),
            }
          : null,
      status: projectStatus(row, connection),
    })),
  };
}

function auditTarget(fields: {
  roleArn: string | null;
  result: "passed" | "failed" | null;
  code: AwsTestFailureCode | null;
  revision: number;
}): AuditEventInput["target"] {
  return {
    type: "aws_connection",
    attributes: {
      roleArn: fields.roleArn,
      accountId: fields.roleArn ? awsRoleArnAccountId(fields.roleArn) : null,
      result: fields.result,
      code: fields.code,
      revision: fields.revision,
    },
  };
}

function inTenant<T>(
  database: Database,
  identity: Identity,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return assertMemberBeforeTenantContext(
    database,
    identity.organizationId,
    identity.actorUserId,
  ).then(() => withTenantContextRaw(database, identity.organizationId, work));
}

export function getOrganizationAwsConnection(
  deps: AwsConnectionDeps,
  identity: Identity,
): Promise<OrganizationAwsConnectionResponse> {
  return inTenant(deps.database, identity, async (client) => {
    const { slug } = await lockAdmin(client, identity);
    const connection = await ensureConnection(
      client,
      identity.organizationId,
      slug,
    );
    return responseBody(
      client,
      identity.organizationId,
      connection,
      deps.principalArn,
    );
  });
}

// STS runs with no transaction open (REQ-01). The External ID comes from the
// database, never from the request.
async function verify(
  deps: AwsConnectionDeps,
  identity: Identity,
  request: OrganizationAwsConnectionRequest,
): Promise<
  | { result: OrganizationAwsConnectionTestResponse }
  | { retryAfterSeconds: number }
> {
  const { sts, rateLimiter } = deps;
  if (!sts) throw new Error("AWS STS verifier is not configured");
  const externalId = await inTenant(deps.database, identity, async (client) => {
    const { slug } = await lockAdmin(client, identity);
    const connection = await ensureConnection(
      client,
      identity.organizationId,
      slug,
    );
    if (connection.revision !== request.revision) {
      revisionConflict(connection.revision);
    }
    return connection.externalId;
  });

  // Validation, permission and revision failures above took no quota.
  if (!rateLimiter) {
    throw new AppError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "rate limiter is unavailable",
    );
  }
  const limit = await consumeAwsTestRateLimit(rateLimiter, {
    userId: identity.actorUserId,
    organizationId: identity.organizationId,
  });
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };

  try {
    const caller = await sts.organization({
      roleArn: request.roleArn,
      externalId,
    });
    if (caller.accountId !== awsRoleArnAccountId(request.roleArn)) {
      return { result: { result: "failed", code: "AWS_ACCOUNT_MISMATCH" } };
    }
    return {
      result: {
        result: "passed",
        accountId: caller.accountId,
        arn: caller.arn,
      },
    };
  } catch (error) {
    if (error instanceof StsError) {
      return { result: { result: "failed", code: error.code } };
    }
    throw error;
  }
}

// After STS: the caller must still be an Owner or Admin (else 403, no result)
// and the connection must still be at the request's revision (else 409).
async function recheck(
  client: PoolClient,
  identity: Identity,
  revision: number,
  lock: boolean,
): Promise<{ role: AdminRole; connection: ConnectionRow }> {
  const { role } = await lockAdmin(client, identity);
  const connection = await selectConnection(
    client,
    identity.organizationId,
    lock,
  );
  if (connection.revision !== revision) revisionConflict(connection.revision);
  return { role, connection };
}

export async function testOrganizationAwsConnection(
  deps: AwsConnectionDeps,
  identity: Identity,
  request: OrganizationAwsConnectionRequest,
): Promise<
  | { result: OrganizationAwsConnectionTestResponse }
  | { retryAfterSeconds: number }
> {
  const verified = await verify(deps, identity, request);
  if ("retryAfterSeconds" in verified) return verified;
  const { result } = verified;
  await withTenantContextRaw(
    deps.database,
    identity.organizationId,
    async (client) => {
      const { role } = await recheck(client, identity, request.revision, false);
      await recordAuditEvent(client, {
        organizationId: identity.organizationId,
        actorUserId: identity.actorUserId,
        actorRole: role,
        action: "organization.aws_connection.tested",
        target: auditTarget({
          roleArn: request.roleArn,
          result: result.result,
          code: result.result === "failed" ? result.code : null,
          revision: request.revision,
        }),
        changes: [],
        requestId: identity.requestId,
      });
    },
  );
  return { result };
}

export async function updateOrganizationAwsConnection(
  deps: AwsConnectionDeps,
  identity: Identity,
  request: OrganizationAwsConnectionRequest,
): Promise<
  { body: OrganizationAwsConnectionResponse } | { retryAfterSeconds: number }
> {
  const verified = await verify(deps, identity, request);
  if ("retryAfterSeconds" in verified) return verified;
  const { result } = verified;
  return withTenantContextRaw(
    deps.database,
    identity.organizationId,
    async (client) => {
      // A caller who lost Owner/Admin or a stale revision gets 403/409 before
      // any STS outcome, the failure code included.
      const { role, connection } = await recheck(
        client,
        identity,
        request.revision,
        true,
      );
      if (result.result === "failed") {
        throw new AppError(
          422,
          "AWS_CONNECTION_TEST_FAILED",
          "ทดสอบการเชื่อมต่อไม่ผ่าน จึงยังไม่บันทึก",
          { code: result.code },
        );
      }
      // Saving the saved ARN changes nothing: no revision bump that would turn
      // Project results stale, and no event (AC-06, AC-09).
      if (connection.roleArn === request.roleArn) {
        return {
          body: await responseBody(
            client,
            identity.organizationId,
            connection,
            deps.principalArn,
          ),
        };
      }
      const revision = connection.revision + 1;
      await client.query(
        `update org_aws_connections
         set role_arn = $2, verified_account_id = $3, verified_arn = $4,
             tested_at = now(), revision = $5, updated_by = $6,
             updated_at = now()
         where tenant_id = $1`,
        [
          identity.organizationId,
          request.roleArn,
          result.accountId,
          result.arn,
          revision,
          identity.actorUserId,
        ],
      );
      await recordAuditEvent(client, {
        organizationId: identity.organizationId,
        actorUserId: identity.actorUserId,
        actorRole: role,
        action: "organization.aws_connection.updated",
        target: auditTarget({
          roleArn: request.roleArn,
          result: "passed",
          code: null,
          revision,
        }),
        changes: [
          {
            field: "roleArn",
            before:
              connection.roleArn === null
                ? null
                : { kind: "value", value: connection.roleArn },
            after: { kind: "value", value: request.roleArn },
          },
        ],
        requestId: identity.requestId,
      });
      return {
        body: await responseBody(
          client,
          identity.organizationId,
          await selectConnection(client, identity.organizationId, false),
          deps.principalArn,
        ),
      };
    },
  );
}

// Clears the connection and keeps the row, its External ID and every Project
// setting. Disconnecting what is not connected changes nothing.
export function disconnectOrganizationAwsConnection(
  deps: AwsConnectionDeps,
  identity: Identity,
  revision: number,
): Promise<OrganizationAwsConnectionResponse> {
  return inTenant(deps.database, identity, async (client) => {
    const { role, slug } = await lockAdmin(client, identity);
    let connection = await ensureConnection(
      client,
      identity.organizationId,
      slug,
      true,
    );
    if (connection.revision !== revision) revisionConflict(connection.revision);
    if (connection.roleArn !== null) {
      const next = revision + 1;
      await client.query(
        `update org_aws_connections
         set role_arn = null, verified_account_id = null, verified_arn = null,
             tested_at = null, revision = $2, updated_by = $3,
             updated_at = now()
         where tenant_id = $1`,
        [identity.organizationId, next, identity.actorUserId],
      );
      await recordAuditEvent(client, {
        organizationId: identity.organizationId,
        actorUserId: identity.actorUserId,
        actorRole: role,
        action: "organization.aws_connection.disconnected",
        target: auditTarget({
          roleArn: connection.roleArn,
          result: null,
          code: null,
          revision: next,
        }),
        changes: [
          {
            field: "roleArn",
            before: { kind: "value", value: connection.roleArn },
            after: null,
          },
        ],
        requestId: identity.requestId,
      });
      connection = await selectConnection(
        client,
        identity.organizationId,
        false,
      );
    }
    return responseBody(
      client,
      identity.organizationId,
      connection,
      deps.principalArn,
    );
  });
}
