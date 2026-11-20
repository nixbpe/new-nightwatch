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
import { checkProjectAws, getProjectAws } from "./project";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(runtimeUrl);
const owner = createDatabase(ownerUrl);
const organizationId = randomUUID();
const actorUserId = randomUUID();
const viewer = randomUUID();
const input = { organizationId, actorUserId };
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
  sts: { organization, projectRole, accessKey: vi.fn() },
  rateLimiter: { consumeRateLimits, consumeRateLimit: vi.fn() },
};

beforeAll(async () => {
  await owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'AWS test', $2)",
    [organizationId, `aws-${organizationId}`],
  );
  for (const [user, role] of [
    [actorUserId, "owner"],
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
    checkOrganizationAws(deps, input, roleArn, false),
  ).resolves.toEqual({ ok: true, ...identity });
  expect((await getOrganizationAws(deps, input)).roleArn).toBeNull();
  await expect(
    checkOrganizationAws(deps, input, roleArn, true),
  ).resolves.toEqual({ ok: true, ...identity });
  const other = "arn:aws:iam::222222222222:role/Other";
  await expect(checkOrganizationAws(deps, input, other, true)).resolves.toEqual(
    { ok: false, code: "AWS_ACCOUNT_MISMATCH" },
  );
  expect((await getOrganizationAws(deps, input)).roleArn).toBe(roleArn);
  const calls = organization.mock.calls.length;
  consumeRateLimits.mockResolvedValueOnce({
    allowed: false,
    retryAfterSeconds: 12,
  });
  await expect(
    checkOrganizationAws(deps, input, roleArn, true),
  ).resolves.toEqual({ retryAfterSeconds: 12 });
  expect(organization).toHaveBeenCalledTimes(calls);
  await disconnectOrganizationAws(deps, input);
  expect(await getOrganizationAws(deps, input)).toMatchObject({
    roleArn: null,
    externalId: first.externalId,
  });
  const audit = await withTenantContextRaw(database, organizationId, (client) =>
    client.query(
      "select action, target_attributes, changes from audit_events where tenant_id = $1 order by occurred_at",
      [organizationId],
    ),
  );
  expect(audit.rows).toEqual(
    ["test", "update", "test", "delete"].map((action) => ({
      action: `organization.aws_connection.${action}`,
      target_attributes: {},
      changes: [],
    })),
  );
});

it("rejects late Project verification after a hub change and retains historical state", async () => {
  const projectId = randomUUID();
  const projectInput = { ...input, projectId };
  const reader = { ...projectInput, actorUserId: viewer };
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
    checkProjectAws(deps, reader, roleArn, true),
  ).rejects.toMatchObject({ statusCode: 403 });
  await checkOrganizationAws(deps, input, roleArn, true);
  await checkProjectAws(deps, projectInput, roleArn, true);
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
    checkProjectAws(deps, projectInput, roleArn, true),
  ).rejects.toMatchObject({ statusCode: 409, code: "AWS_CONNECTION_CHANGED" });
  await started.promise;
  try {
    await disconnectOrganizationAws(deps, input);
  } finally {
    late.resolve(identity);
  }
  await pending;
  expect(await getProjectAws(deps, projectInput)).toMatchObject({
    state: "needs_retest",
    method: "assume_role",
    settings: { hubConnected: false, roleArn },
  });
  await checkOrganizationAws(deps, input, roleArn, true);
  await checkProjectAws(deps, projectInput, roleArn, false);
  expect(await getProjectAws(deps, reader)).toMatchObject({
    state: "needs_retest",
  });
  await checkProjectAws(deps, projectInput, roleArn, true);
  expect(await getProjectAws(deps, reader)).toMatchObject({
    state: "connected",
  });
});
