import { randomUUID } from "node:crypto";
import { createDatabase, withTenantContextRaw } from "@nightwatch/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  checkOrganizationAws,
  disconnectOrganizationAws,
  getOrganizationAws,
  type AwsDeps,
} from "./organization";
import {
  checkProjectAws,
  disconnectProjectAws,
  getProjectAws,
} from "./project";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(runtimeUrl);
const owner = createDatabase(ownerUrl);
const organizationId = randomUUID();
const actorUserId = randomUUID();
const viewer = randomUUID();
const input = { organizationId, actorUserId, requestId: randomUUID() };
const revision = async () => (await getOrganizationAws(deps, input)).revision;
const roleArn = "arn:aws:iam::123456789012:role/Hub";
const identity = {
  accountId: "123456789012",
  arn: "arn:aws:sts::123456789012:assumed-role/Hub/NightWatchConnectionTest",
};
const organization = vi.fn(() => Promise.resolve(identity));
const projectRole = vi.fn(() => Promise.resolve(identity));
const consumeRateLimits = vi.fn(() =>
  Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
);
const deps: AwsDeps = {
  database,
  principalArn: "arn:aws:iam::999999999999:role/NightWatch",
  sts: {
    organization,
    projectRole,
    accessKey: () => Promise.resolve(identity),
  },
  credentialEnv: {
    CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "v1",
    CREDENTIAL_ENCRYPTION_KEYS: { v1: Buffer.alloc(32, 1).toString("base64") },
  },
  rateLimiter: { consumeRateLimits, consumeRateLimit: vi.fn() },
};

beforeAll(async () => {
  await owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'AWS test', $2)",
    [organizationId, `aws-${organizationId}`],
  );
  for (const [user, role] of [
    [actorUserId, "admin,viewer"],
    [viewer, "viewer"],
  ] as const) {
    await owner.sql.query(
      'insert into "user" (id, name, email, email_verified) values ($1, $1, $2, true)',
      [user, `${user}@example.test`],
    );
    await owner.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, $4)",
      [randomUUID(), organizationId, user, role],
    );
  }
});

afterAll(async () => {
  await owner.sql.query("delete from organization where id = $1", [
    organizationId,
  ]);
  await owner.sql.query('delete from "user" where id = any($1::text[])', [
    [actorUserId, viewer],
  ]);
  await database.close();
  await owner.close();
});

it("keeps drafts separate from the saved hub and redacts audit metadata", async () => {
  const [first, second] = await Promise.all([
    getOrganizationAws(deps, input),
    getOrganizationAws(deps, input),
  ]);
  expect(first.externalId).toBe(second.externalId);
  expect(first.externalId).toMatch(
    new RegExp(`^nw-org-aws-${organizationId}-[a-z2-7]{26}$`),
  );
  expect(first.trustPolicy).toContain(first.externalId);
  await expect(
    getOrganizationAws(deps, { ...input, actorUserId: viewer }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    checkOrganizationAws(deps, input, roleArn, await revision(), false),
  ).resolves.toEqual({ ok: true, ...identity });
  expect((await getOrganizationAws(deps, input)).roleArn).toBeNull();
  await expect(
    checkOrganizationAws(deps, input, roleArn, await revision(), true),
  ).resolves.toEqual({ ok: true, ...identity });
  // Saving the same ARN again changes nothing but the test time.
  await expect(
    checkOrganizationAws(deps, input, roleArn, await revision(), true),
  ).resolves.toEqual({ ok: true, ...identity });
  const other = "arn:aws:iam::222222222222:role/Other";
  await expect(
    checkOrganizationAws(deps, input, other, await revision(), true),
  ).resolves.toEqual({ ok: false, code: "AWS_ACCOUNT_MISMATCH" });
  expect((await getOrganizationAws(deps, input)).roleArn).toBe(roleArn);
  const calls = organization.mock.calls.length;
  consumeRateLimits.mockResolvedValueOnce({
    allowed: false,
    retryAfterSeconds: 12,
  });
  await expect(
    checkOrganizationAws(deps, input, roleArn, await revision(), true),
  ).resolves.toEqual({ retryAfterSeconds: 12 });
  expect(organization).toHaveBeenCalledTimes(calls);
  await disconnectOrganizationAws(deps, input, await revision());
  expect(await getOrganizationAws(deps, input)).toMatchObject({
    roleArn: null,
    externalId: first.externalId,
  });
  const audit = await withTenantContextRaw(database, organizationId, (client) =>
    client.query(
      "select action, request_id, target_attributes, changes from audit_events where tenant_id = $1 order by occurred_at",
      [organizationId],
    ),
  );
  const arn = { kind: "value", value: roleArn };
  expect(audit.rows).toEqual(
    (
      [
        ["test", []],
        ["update", [{ field: "roleArn", before: null, after: arn }]],
        ["test", []],
        ["test", []],
        ["delete", [{ field: "roleArn", before: arn, after: null }]],
      ] as const
    ).map(([action, changes]) => ({
      action: `organization.aws_connection.${action}`,
      request_id: input.requestId,
      target_attributes: {},
      changes,
    })),
  );
});

it("F-013 AC-11 refuses a test, save or disconnect made against an older revision", async () => {
  const start = await getOrganizationAws(deps, input);
  if (start.roleArn !== null)
    await disconnectOrganizationAws(deps, input, start.revision);
  // Saving an ARN over no connection moves the revision.
  const seen = await revision();
  await checkOrganizationAws(deps, input, roleArn, seen, true);
  const current = await getOrganizationAws(deps, input);
  expect(current.revision).not.toBe(seen);
  const calls = organization.mock.calls.length;
  const limits = consumeRateLimits.mock.calls.length;
  const other = "arn:aws:iam::123456789012:role/Other";
  for (const save of [false, true])
    await expect(
      checkOrganizationAws(deps, input, other, seen, save),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "AWS_CONNECTION_CHANGED",
    });
  await expect(
    disconnectOrganizationAws(deps, input, seen),
  ).rejects.toMatchObject({ statusCode: 409, code: "AWS_CONNECTION_CHANGED" });
  expect(organization).toHaveBeenCalledTimes(calls);
  expect(consumeRateLimits).toHaveBeenCalledTimes(limits);
  expect(await getOrganizationAws(deps, input)).toMatchObject({
    revision: current.revision,
    roleArn,
  });
  await disconnectOrganizationAws(deps, input, current.revision);
});

it("rejects late Project verification after a hub change and retains historical state", async () => {
  const projectId = randomUUID();
  const projectInput = { ...input, projectId };
  const reader = { ...projectInput, actorUserId: viewer };
  const projectConfig = { method: "assume_role", roleArn } as const;
  await owner.sql.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'AWS', 'aws-project')",
    [projectId, organizationId],
  );
  await expect(getProjectAws(deps, reader)).rejects.toMatchObject({
    statusCode: 404,
  });
  await owner.sql.query(
    "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
    [projectId, organizationId, viewer],
  );
  expect(await getProjectAws(deps, reader)).not.toHaveProperty("settings");
  await expect(
    checkProjectAws(deps, reader, projectConfig, true),
  ).rejects.toMatchObject({ statusCode: 403 });
  await checkOrganizationAws(deps, input, roleArn, await revision(), true);
  await checkProjectAws(deps, projectInput, projectConfig, true);
  expect(await getProjectAws(deps, reader)).toMatchObject({
    state: "connected",
    method: "assume_role",
  });
  const started = Promise.withResolvers<undefined>();
  const late = Promise.withResolvers<typeof identity>();
  projectRole.mockImplementationOnce(() => {
    started.resolve(undefined);
    return late.promise;
  });
  const pending = expect(
    checkProjectAws(deps, projectInput, projectConfig, true),
  ).rejects.toMatchObject({ statusCode: 409, code: "AWS_CONNECTION_CHANGED" });
  await started.promise;
  try {
    await disconnectOrganizationAws(deps, input, await revision());
  } finally {
    late.resolve(identity);
  }
  await pending;
  expect(await getProjectAws(deps, projectInput)).toMatchObject({
    state: "needs_retest",
    method: "assume_role",
    settings: { hubConnected: false, roleArn },
  });
  await checkOrganizationAws(deps, input, roleArn, await revision(), true);
  await checkProjectAws(deps, projectInput, projectConfig, false);
  expect(await getProjectAws(deps, reader)).toMatchObject({
    state: "needs_retest",
  });
  await checkProjectAws(deps, projectInput, projectConfig, true);
  expect(await getProjectAws(deps, reader)).toMatchObject({
    state: "connected",
  });
});

it("writes both access-key fields encrypted and erases them when disconnected", async () => {
  const projectId = randomUUID();
  const projectInput = { ...input, projectId };
  await owner.sql.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'Keys', 'aws-keys')",
    [projectId, organizationId],
  );
  const draft = {
    method: "access_key",
    accessKeyId: "TESTACCESSKEY001",
    secretAccessKey: "dummysecretkey001",
    region: "us-east-1",
  } as const;
  const saved = await checkProjectAws(deps, projectInput, draft, true);
  const status = await getProjectAws(deps, projectInput);
  expect(status).toMatchObject({
    state: "connected",
    method: "access_key",
    secretSet: true,
  });
  const persisted = () =>
    withTenantContextRaw(database, organizationId, async (client) => {
      const result = await client.query<{
        id: Buffer | null;
        secret: Buffer | null;
      }>(
        "select access_key_ciphertext as id, secret_ciphertext as secret from project_aws_connections where tenant_id = $1 and project_id = $2",
        [organizationId, projectId],
      );
      return result.rows[0];
    });
  const encrypted = await persisted();
  expect(encrypted?.id).toBeInstanceOf(Buffer);
  expect(encrypted?.secret).toBeInstanceOf(Buffer);
  expect(encrypted?.id).not.toEqual(Buffer.from(draft.accessKeyId));
  expect(encrypted?.secret).not.toEqual(Buffer.from(draft.secretAccessKey));
  await disconnectProjectAws(deps, projectInput);
  expect(await persisted()).toEqual({ id: null, secret: null });
  const audit = await withTenantContextRaw(database, organizationId, (client) =>
    client.query(
      "select target_attributes, changes from audit_events where tenant_id = $1 and target_id = $2",
      [organizationId, projectId],
    ),
  );
  const outputs = JSON.stringify([saved, status, audit.rows]);
  expect(outputs).not.toContain(draft.accessKeyId);
  expect(outputs).not.toContain(draft.secretAccessKey);
});
