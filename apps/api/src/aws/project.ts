import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent } from "../audit/record";
import { withProjectAccess } from "../projects/service";
import {
  externalId,
  limitAws,
  requireSts,
  staleConnection,
  testIdentity,
  trustPolicy,
  type AwsDeps,
  type OrganizationIdentity,
} from "./organization";

export type ProjectIdentity = OrganizationIdentity & { projectId: string };
type Hub = { role_arn: string; external_id: string; revision: string };
type Connection = {
  method: "assume_role" | "access_key" | null;
  role_arn: string | null;
  account_id: string | null;
  region: string | null;
  hub_revision: string | null;
  revision: string;
  external_id: string;
  last_test_at: Date | null;
};

async function initialize(client: PoolClient, tenant: string, project: string) {
  const { rows } = await client.query<{ slug: string }>(
    "select slug from projects where tenant_id = $1 and id = $2",
    [tenant, project],
  );
  const row = rows[0];
  if (!row) throw new Error("Missing locked Project");
  await client.query(
    "insert into project_aws_connections (tenant_id, project_id, external_id) values ($1, $2, $3) on conflict (project_id) do nothing",
    [tenant, project, externalId(`nw-${row.slug}-`)],
  );
}

async function connection(client: PoolClient, tenant: string, project: string) {
  const { rows } = await client.query<Connection>(
    "select method, role_arn, account_id, region, hub_revision, revision, external_id, last_test_at from project_aws_connections where tenant_id = $1 and project_id = $2",
    [tenant, project],
  );
  return rows[0];
}

async function hub(client: PoolClient, tenant: string, lock = false) {
  const { rows } = await client.query<Hub>(
    `select role_arn, external_id, revision from org_aws_connections where tenant_id = $1 and role_arn is not null ${lock ? "for share" : ""}`,
    [tenant],
  );
  return rows[0];
}

export function getProjectAws(deps: AwsDeps, input: ProjectIdentity) {
  return withProjectAccess(
    deps.database,
    input,
    "aws.read",
    false,
    async (client, { projectId, access }) => {
      const canManage =
        access.kind === "org-admin" ||
        (access.kind === "member" && access.role === "admin");
      const tenant = input.organizationId;
      if (canManage) await initialize(client, tenant, projectId);
      const currentHub = await hub(client, tenant);
      const row = await connection(client, tenant, projectId);
      const state = !row?.method
        ? ("disconnected" as const)
        : row.method === "assume_role" &&
            row.hub_revision !== currentHub?.revision
          ? ("needs_retest" as const)
          : ("connected" as const);
      return {
        state,
        method: row?.method ?? null,
        accountId: row?.account_id ?? null,
        lastTestAt: row?.last_test_at?.toISOString() ?? null,
        ...(canManage &&
          row && {
            settings: {
              hubConnected: !!currentHub,
              roleArn: row.role_arn,
              region: row.region,
              externalId: row.external_id,
              trustPolicy: currentHub
                ? trustPolicy(currentHub.role_arn, row.external_id)
                : null,
            },
          }),
        ...(row?.method === "access_key" && { secretSet: true as const }),
      };
    },
  );
}

export async function checkProjectAws(
  deps: AwsDeps,
  input: ProjectIdentity,
  roleArn: string,
  save: boolean,
) {
  const tenant = input.organizationId;
  const snapshot = await withProjectAccess(
    deps.database,
    input,
    "aws.manage",
    true,
    async (client, { projectId }) => {
      await initialize(client, tenant, projectId);
      const currentHub = await hub(client, tenant);
      if (!currentHub)
        throw new AppError(
          409,
          "AWS_HUB_REQUIRED",
          "ตั้งค่าบัญชีกลางขององค์กรก่อน",
        );
      const row = await connection(client, tenant, projectId);
      if (!row) throw new Error("Missing initialized Project AWS settings");
      return { row, currentHub };
    },
  );
  const st = requireSts(deps);
  const limit = await limitAws(deps, input);
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };
  const outcome = await testIdentity(roleArn, () =>
    st.projectRole(
      {
        roleArn: snapshot.currentHub.role_arn,
        externalId: snapshot.currentHub.external_id,
      },
      { roleArn, externalId: snapshot.row.external_id },
    ),
  );
  return withProjectAccess(
    deps.database,
    input,
    "aws.manage",
    true,
    async (client, { actorRole, projectId }) => {
      const currentHub = await hub(client, tenant, true);
      const current = await connection(client, tenant, projectId);
      if (
        current?.revision !== snapshot.row.revision ||
        currentHub?.revision !== snapshot.currentHub.revision
      )
        staleConnection();
      if (save && outcome.ok) {
        await client.query(
          `update project_aws_connections set method = 'assume_role', role_arn = $3, account_id = $4,
        hub_revision = $5, last_test_at = now(), region = null, revision = gen_random_uuid(),
        access_key_ciphertext = null, access_key_iv = null, access_key_auth_tag = null, access_key_key_version = null,
        secret_ciphertext = null, secret_iv = null, secret_auth_tag = null, secret_key_version = null,
        updated_at = now(), updated_by = $6 where tenant_id = $1 and project_id = $2`,
          [
            tenant,
            projectId,
            roleArn,
            outcome.accountId,
            currentHub.revision,
            input.actorUserId,
          ],
        );
      }
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action:
          save && outcome.ok
            ? "organization.project.aws_connection.update"
            : "organization.project.aws_connection.test",
        target: { type: "project", id: projectId },
        changes: [],
      });
      return outcome;
    },
  );
}

export function disconnectProjectAws(deps: AwsDeps, input: ProjectIdentity) {
  return withProjectAccess(
    deps.database,
    input,
    "aws.manage",
    true,
    async (client, { actorRole, projectId }) => {
      const { rowCount } = await client.query(
        `update project_aws_connections set method = null, role_arn = null,
      account_id = null, region = null, hub_revision = null, last_test_at = null, revision = gen_random_uuid(),
      access_key_ciphertext = null, access_key_iv = null, access_key_auth_tag = null, access_key_key_version = null,
      secret_ciphertext = null, secret_iv = null, secret_auth_tag = null, secret_key_version = null,
      updated_at = now(), updated_by = $3 where tenant_id = $1 and project_id = $2`,
        [input.organizationId, projectId, input.actorUserId],
      );
      if (rowCount)
        await recordAuditEvent(client, {
          ...input,
          actorRole,
          action: "organization.project.aws_connection.delete",
          target: { type: "project", id: projectId },
          changes: [],
        });
    },
  );
}
