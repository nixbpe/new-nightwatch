import { randomBytes } from "node:crypto";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import {
  AppError,
  StsError,
  type CredentialEnv,
  type StsVerifier,
} from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent, type AuditAction } from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "../organization-notifications/service";
import type { RateLimiter } from "../rate-limit";

export type OrganizationIdentity = {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
};
export type AwsDeps = {
  database: Database;
  sts?: StsVerifier;
  principalArn?: string;
  credentialEnv?: CredentialEnv;
  rateLimiter?: RateLimiter;
};
type HubRow = {
  external_id: string;
  revision: string;
  write_version: string;
  role_arn: string | null;
  account_id: string | null;
  last_test_at: Date | null;
};

export function externalId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let buffer = 0;
  let result = prefix;
  for (const byte of randomBytes(16)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet.charAt((buffer >>> bits) & 31);
    }
  }
  if (bits > 0) result += alphabet.charAt((buffer << (5 - bits)) & 31);
  return result;
}

export function trustPolicy(principal: string, id: string) {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: principal },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": id } },
        },
      ],
    },
    null,
    2,
  );
}

export function staleConnection(): never {
  throw new AppError(
    409,
    "AWS_CONNECTION_CHANGED",
    "การตั้งค่าการเชื่อมต่อเปลี่ยนแล้ว โปรดโหลดใหม่",
  );
}

export function requireSts(deps: AwsDeps): StsVerifier {
  if (!deps.sts)
    throw new AppError(
      503,
      "AWS_STS_UNAVAILABLE",
      "บริการทดสอบการเชื่อมต่อ AWS ยังไม่พร้อม",
    );
  return deps.sts;
}

export async function limitAws(deps: AwsDeps, input: OrganizationIdentity) {
  if (!deps.rateLimiter)
    throw new AppError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "บริการทดสอบการเชื่อมต่อ AWS ยังไม่พร้อม",
    );
  return deps.rateLimiter.consumeRateLimits({
    windowMs: 60_000,
    limits: [
      {
        key: `rl:aws-test:u:${input.actorUserId}:o:${input.organizationId}`,
        limit: 10,
      },
      { key: `rl:aws-test:o:${input.organizationId}`, limit: 30 },
    ],
  });
}

export async function testIdentity(
  roleArn: string | null,
  call: () => Promise<{ accountId: string; arn: string }>,
) {
  try {
    const identity = await call();
    if (roleArn && identity.accountId !== roleArn.split(":")[4]) {
      return { ok: false as const, code: "AWS_ACCOUNT_MISMATCH" as const };
    }
    return { ok: true as const, ...identity };
  } catch (error) {
    if (!(error instanceof StsError)) throw error;
    return { ok: false as const, code: error.code };
  }
}

async function withOwner<T>(
  deps: AwsDeps,
  input: OrganizationIdentity,
  work: (
    client: PoolClient,
    role: "owner" | "admin",
    slug: string,
  ) => Promise<T>,
): Promise<T> {
  await assertMemberBeforeTenantContext(
    deps.database,
    input.organizationId,
    input.actorUserId,
  );
  return withTenantContextRaw(
    deps.database,
    input.organizationId,
    async (client) => {
      const { rows } = await client.query<{ slug: string; role: string }>(
        `select o.slug, m.role from organization o join member m on m.organization_id = o.id
       where o.id = $1 and m.user_id = $2 for share of o, m`,
        [input.organizationId, input.actorUserId],
      );
      const membership = rows[0];
      const role = membership && normalizeOrganizationRole(membership.role);
      if (!membership || (role !== "owner" && role !== "admin")) {
        throw new AppError(
          403,
          "PERMISSION_DENIED",
          "คุณไม่มีสิทธิ์จัดการการเชื่อมต่อ AWS ขององค์กร",
        );
      }
      return work(client, role, membership.slug);
    },
  );
}

async function readHub(
  client: PoolClient,
  tenant: string,
  slug: string,
  lock: boolean,
): Promise<HubRow> {
  await client.query(
    "insert into org_aws_connections (tenant_id, external_id) values ($1, $2) on conflict (tenant_id) do nothing",
    [tenant, externalId(`nw-org-${slug}-`)],
  );
  const result = await client.query<HubRow>(
    lock
      ? "select external_id, revision, updated_at::text as write_version, role_arn, account_id, last_test_at from org_aws_connections where tenant_id = $1 for update"
      : "select external_id, revision, updated_at::text as write_version, role_arn, account_id, last_test_at from org_aws_connections where tenant_id = $1",
    [tenant],
  );
  const hub = result.rows[0];
  if (!hub) throw new Error("AWS hub missing after initialization");
  return hub;
}

async function auditHub(
  client: PoolClient,
  input: OrganizationIdentity,
  actorRole: "owner" | "admin",
  action: AuditAction,
) {
  await recordAuditEvent(client, {
    ...input,
    actorRole,
    action,
    target: { type: "aws_connection" },
    changes: [],
  });
}

export function getOrganizationAws(deps: AwsDeps, input: OrganizationIdentity) {
  return withOwner(deps, input, async (client, _role, slug) => {
    const hub = await readHub(client, input.organizationId, slug, false);
    const { rows } = await client.query<{
      projectId: string;
      name: string;
      accountId: string;
      roleArn: string;
      lastTestAt: Date;
      current: boolean;
    }>(
      `select p.id as "projectId", p.name, c.account_id as "accountId", c.role_arn as "roleArn",
        c.last_test_at as "lastTestAt", (c.hub_revision = $2 and $3::text is not null) as current
       from project_aws_connections c join projects p on p.id = c.project_id and p.tenant_id = c.tenant_id
       where c.tenant_id = $1 and c.method = 'assume_role' order by p.name, p.id`,
      [input.organizationId, hub.revision, hub.role_arn],
    );
    return {
      roleArn: hub.role_arn,
      accountId: hub.account_id,
      lastTestAt: hub.last_test_at?.toISOString() ?? null,
      externalId: hub.external_id,
      trustPolicy: deps.principalArn
        ? trustPolicy(deps.principalArn, hub.external_id)
        : null,
      projects: rows.map((row) => ({
        ...row,
        lastTestAt: row.lastTestAt.toISOString(),
      })),
    };
  });
}

export async function checkOrganizationAws(
  deps: AwsDeps,
  input: OrganizationIdentity,
  roleArn: string,
  save: boolean,
) {
  const snapshot = await withOwner(deps, input, (client, _role, slug) =>
    readHub(client, input.organizationId, slug, false),
  );
  const st = requireSts(deps);
  const limit = await limitAws(deps, input);
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };
  const outcome = await testIdentity(roleArn, () =>
    st.organization({ roleArn, externalId: snapshot.external_id }),
  );
  return withOwner(deps, input, async (client, actorRole, slug) => {
    const current = await readHub(client, input.organizationId, slug, true);
    if (
      current.revision !== snapshot.revision ||
      current.write_version !== snapshot.write_version
    )
      staleConnection();
    if (save && outcome.ok) {
      await client.query(
        `update org_aws_connections set role_arn = $2, account_id = $3, last_test_at = now(), updated_at = now(), updated_by = $4,
        revision = case when role_arn is distinct from $2 then gen_random_uuid() else revision end where tenant_id = $1`,
        [input.organizationId, roleArn, outcome.accountId, input.actorUserId],
      );
      await auditHub(
        client,
        input,
        actorRole,
        "organization.aws_connection.update",
      );
    } else {
      await auditHub(
        client,
        input,
        actorRole,
        "organization.aws_connection.test",
      );
    }
    return outcome;
  });
}

export function disconnectOrganizationAws(
  deps: AwsDeps,
  input: OrganizationIdentity,
) {
  return withOwner(deps, input, async (client, actorRole) => {
    const result = await client.query(
      `update org_aws_connections set role_arn = null, account_id = null, last_test_at = null,
      revision = gen_random_uuid(), updated_at = now(), updated_by = $2 where tenant_id = $1 and role_arn is not null`,
      [input.organizationId, input.actorUserId],
    );
    if (result.rowCount)
      await auditHub(
        client,
        input,
        actorRole,
        "organization.aws_connection.delete",
      );
  });
}
