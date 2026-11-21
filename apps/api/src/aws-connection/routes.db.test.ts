import { randomBytes } from "node:crypto";

import {
  auditLogListResponseSchema,
  organizationAwsConnectionResponseSchema,
  type OrganizationAwsConnectionResponse,
} from "@nightwatch/api-contract";
import { createStsVerifier } from "@nightwatch/shared";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";
import { createRedisClient } from "../rate-limit";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for AWS route tests");

const PRINCIPAL = "arn:aws:iam::123456789012:role/NightWatchService";
const ROLE = "arn:aws:iam::111122223333:role/NightWatchOrgHub";
const ROLE_NEXT = "arn:aws:iam::111122223333:role/path/NightWatchOrgHub2";
const ROLE_DENIED = "arn:aws:iam::111122223333:role/Denied";
const ROLE_MISMATCH = "arn:aws:iam::555566667777:role/Elsewhere";
const ROLE_PROJECT = "arn:aws:iam::444455556666:role/NightWatchReadOnly";
// Raw AWS text and credentials the fake returns; none may leave the API.
const RAW_AWS_TEXT = "User arn:aws:sts::999 is not authorized RAW-AWS-DETAIL";
const FAKE_SECRET = "fake-secret-access-key";
const FAKE_TOKEN = "fake-session-token";
const EXTERNAL_ID_PATTERN = /^nw-org-[a-z0-9-]{0,40}-[a-z2-7]{26}$/;

type ClientFactory = NonNullable<Parameters<typeof createStsVerifier>[1]>;

/**
 * A fake AWS behind the real verifier: AssumeRole checks the External ID it
 * expects for each role, GetCallerIdentity answers for the assumed role.
 * `hold` parks AssumeRole until released, to change state mid-call.
 */
const aws = {
  trust: new Map<string, string>(),
  accounts: new Map<string, string>(),
  calls: [] as { roleArn: string; externalId: string }[],
  hold: undefined as Promise<void> | undefined,
  started: undefined as (() => void) | undefined,
};

const factory: ClientFactory = (_region, credentials) => ({
  async assumeRole(input) {
    const roleArn = input.RoleArn ?? "";
    aws.calls.push({ roleArn, externalId: input.ExternalId ?? "" });
    aws.started?.();
    await aws.hold;
    if (
      roleArn === ROLE_DENIED ||
      aws.trust.get(roleArn) !== input.ExternalId
    ) {
      throw Object.assign(new Error(RAW_AWS_TEXT), { name: "AccessDenied" });
    }
    return {
      $metadata: {},
      Credentials: {
        AccessKeyId: roleArn,
        SecretAccessKey: FAKE_SECRET,
        SessionToken: FAKE_TOKEN,
        Expiration: new Date(Date.now() + 900_000),
      },
    };
  },
  getCallerIdentity() {
    const roleArn = credentials.accessKeyId;
    const account = aws.accounts.get(roleArn) ?? roleArn.slice(13, 25);
    const name = roleArn.split("/").at(-1) ?? "";
    return Promise.resolve({
      $metadata: {},
      Account: account,
      Arn: `arn:aws:sts::${account}:assumed-role/${name}/NightWatchConnectionTest`,
    });
  },
  destroy() {},
});

const verifier = createStsVerifier(
  () =>
    Promise.resolve({
      accessKeyId: "workload",
      secretAccessKey: FAKE_SECRET,
      sessionToken: FAKE_TOKEN,
    }),
  factory,
);

let ctx: MonitorTestContext;
let noRedis: MonitorTestContext;
let deadRedis: MonitorTestContext;
let redis: Redis;
const redisClients: Redis[] = [];
const organizations: TestOrganization[] = [];

function path(org: TestOrganization, suffix = ""): string {
  return `/api/organizations/${org.id}/aws-connection${suffix}`;
}

async function newOrganization(
  context: MonitorTestContext = ctx,
): Promise<TestOrganization> {
  const org = await context.createOrganization("aws");
  organizations.push(org);
  return org;
}

async function read(
  org: TestOrganization,
  context: MonitorTestContext = ctx,
): Promise<OrganizationAwsConnectionResponse> {
  const response = await context.call(org.users.owner, "GET", path(org));
  expect(response.status).toBe(200);
  return organizationAwsConnectionResponseSchema.parse(response.json);
}

/** Trusts ROLE for the Organization, then saves it. */
async function connect(
  org: TestOrganization,
  roleArn = ROLE,
): Promise<OrganizationAwsConnectionResponse> {
  const before = await read(org);
  aws.trust.set(roleArn, before.externalId);
  const response = await ctx.call(org.users.owner, "PUT", path(org), {
    roleArn,
    revision: before.revision,
  });
  expect(response.status).toBe(200);
  return organizationAwsConnectionResponseSchema.parse(response.json);
}

async function row(org: TestOrganization): Promise<unknown> {
  const result = await ctx.owner.sql.query<{ row: unknown }>(
    "select to_jsonb(c) as row from org_aws_connections c where tenant_id = $1",
    [org.id],
  );
  return result.rows[0]?.row;
}

async function auditRows(org: TestOrganization): Promise<
  {
    action: string;
    target_attributes: unknown;
    changes: unknown;
    text: string;
  }[]
> {
  const result = await ctx.owner.sql.query<{
    action: string;
    target_attributes: unknown;
    changes: unknown;
    text: string;
  }>(
    `select action, target_attributes, changes, to_jsonb(e)::text as text
     from audit_events e where tenant_id = $1 order by occurred_at, id`,
    [org.id],
  );
  return result.rows;
}

async function clearQuota(): Promise<void> {
  const keys = await redis.keys("rl:aws-test:*");
  if (keys.length > 0) await redis.del(...keys);
}

function trackedRedis(url: string): Redis {
  const client = createRedisClient(url);
  redisClients.push(client);
  return client;
}

beforeAll(async () => {
  redis = trackedRedis(redisUrl);
  ctx = await openMonitorTestContext({
    redis,
    awsSts: verifier,
    awsPrincipalArn: PRINCIPAL,
  });
  noRedis = await openMonitorTestContext({ awsSts: verifier });
  deadRedis = await openMonitorTestContext({
    redis: trackedRedis("redis://127.0.0.1:1"),
    awsSts: verifier,
  });
}, 180_000);

beforeEach(async () => {
  aws.calls.length = 0;
  aws.hold = undefined;
  aws.started = undefined;
  await clearQuota();
});

afterAll(async () => {
  await clearQuota();
  for (const client of redisClients) client.disconnect();
  await Promise.allSettled([ctx.close(), noRedis.close(), deadRedis.close()]);
});

describe("AC-01 External ID", () => {
  it("concurrent first GETs create one External ID; PUT and DELETE keep it", async () => {
    const org = await newOrganization();
    const bodies = await Promise.all(
      [org.users.owner, org.users.admin, org.users.owner, org.users.admin].map(
        (user) => ctx.call(user, "GET", path(org)),
      ),
    );
    const ids = bodies.map(
      (response) =>
        organizationAwsConnectionResponseSchema.parse(response.json).externalId,
    );
    expect(new Set(ids).size).toBe(1);
    const [externalId] = ids;
    expect(externalId).toMatch(EXTERNAL_ID_PATTERN);
    expect(externalId?.length).toBeLessThanOrEqual(1224);
    const count = await ctx.owner.sql.query(
      "select 1 from org_aws_connections where tenant_id = $1",
      [org.id],
    );
    expect(count.rows).toHaveLength(1);

    const saved = await connect(org);
    expect(saved.externalId).toBe(externalId);
    const gone = await ctx.call(
      org.users.owner,
      "DELETE",
      path(org, `?revision=${String(saved.revision)}`),
    );
    expect(gone.status).toBe(200);
    expect(
      organizationAwsConnectionResponseSchema.parse(gone.json).externalId,
    ).toBe(externalId);
    expect((await read(org)).externalId).toBe(externalId);
  });

  it("returns principalArn, or null when it is not configured (AC-02)", async () => {
    expect((await read(await newOrganization())).principalArn).toBe(PRINCIPAL);
    const org = await newOrganization(noRedis);
    expect((await read(org, noRedis)).principalArn).toBeNull();
  });
});

describe("AC-03 test", () => {
  it("a passing test returns the verified identity and changes nothing saved", async () => {
    const org = await newOrganization();
    const before = await read(org);
    aws.trust.set(ROLE, before.externalId);
    const saved = await row(org);
    const response = await ctx.call(
      org.users.admin,
      "POST",
      path(org, "/test"),
      {
        roleArn: ROLE,
        revision: before.revision,
      },
    );
    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      result: "passed",
      accountId: "111122223333",
      arn: "arn:aws:sts::111122223333:assumed-role/NightWatchOrgHub/NightWatchConnectionTest",
    });
    expect(aws.calls).toEqual([
      { roleArn: ROLE, externalId: before.externalId },
    ]);
    expect(await row(org)).toEqual(saved);
    expect((await read(org)).connection).toBeNull();
  });

  it("a failing test returns a fixed code without AWS text and changes nothing saved", async () => {
    const org = await newOrganization();
    await connect(org);
    const saved = await row(org);
    const { revision } = await read(org);
    const response = await ctx.call(
      org.users.owner,
      "POST",
      path(org, "/test"),
      {
        roleArn: ROLE_DENIED,
        revision,
      },
    );
    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      result: "failed",
      code: "AWS_ACCESS_DENIED",
    });
    expect(response.text).not.toContain("RAW-AWS-DETAIL");
    expect(await row(org)).toEqual(saved);
    const logs = ctx.lines.join("\n");
    expect(logs).not.toContain("RAW-AWS-DETAIL");
    expect(logs).not.toContain(FAKE_SECRET);
  });
});

describe("AC-04 save", () => {
  it("a failed PUT keeps the saved value; a later PUT runs STS again on the new value", async () => {
    const org = await newOrganization();
    const first = await connect(org);
    const saved = await row(org);
    aws.calls.length = 0;

    const failed = await ctx.call(org.users.owner, "PUT", path(org), {
      roleArn: ROLE_DENIED,
      revision: first.revision,
    });
    expect(failed.status).toBe(422);
    expect(failed.json).toMatchObject({
      error: {
        code: "AWS_CONNECTION_TEST_FAILED",
        details: { code: "AWS_ACCESS_DENIED" },
      },
    });
    expect(await row(org)).toEqual(saved);

    aws.trust.set(ROLE_NEXT, first.externalId);
    const next = await ctx.call(org.users.admin, "PUT", path(org), {
      roleArn: ROLE_NEXT,
      revision: first.revision,
    });
    expect(next.status).toBe(200);
    expect(aws.calls.map((call) => call.roleArn)).toEqual([
      ROLE_DENIED,
      ROLE_NEXT,
    ]);
    const body = organizationAwsConnectionResponseSchema.parse(next.json);
    expect(body.revision).toBe(first.revision + 1);
    expect(body.connection).toMatchObject({
      roleArn: ROLE_NEXT,
      accountId: "111122223333",
      verifiedArn:
        "arn:aws:sts::111122223333:assumed-role/NightWatchOrgHub2/NightWatchConnectionTest",
      updatedBy: { id: org.users.admin, name: "aws-admin" },
    });
  });
});

describe("AC-04 saving the saved value", () => {
  it("re-runs STS and changes nothing: same revision, Project results and audit", async () => {
    const org = await newOrganization();
    const saved = await connect(org);
    const kept = await row(org);
    const events = await auditRows(org);
    aws.calls.length = 0;
    const again = await ctx.call(org.users.owner, "PUT", path(org), {
      roleArn: ROLE,
      revision: saved.revision,
    });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(saved);
    expect(aws.calls).toHaveLength(1);
    expect(await row(org)).toEqual(kept);
    expect(await auditRows(org)).toEqual(events);
  });
});

describe("AC-05 Role ARN", () => {
  it.each([
    "arn:aws:iam::12345:role/x",
    "arn:aws:iam::111122223333:user/x",
    "arn:aws-cn:iam::111122223333:role/x",
    "arn:aws:iam::111122223333:role/",
    "",
  ])(
    "rejects %j as a roleArn field error without calling STS",
    async (roleArn) => {
      const org = await newOrganization();
      for (const method of ["POST", "PUT"] as const) {
        const response = await ctx.call(
          org.users.owner,
          method,
          path(org, method === "POST" ? "/test" : ""),
          { roleArn, revision: 0 },
        );
        expect(response.status).toBe(400);
        expect(response.json).toEqual({
          error: {
            code: "AWS_ROLE_ARN_INVALID",
            message: expect.any(String) as string,
            details: { field: "roleArn" },
          },
        });
      }
      expect(aws.calls).toEqual([]);
    },
  );

  it("an account other than the ARN's fails the test and is not saved", async () => {
    const org = await newOrganization();
    const { externalId, revision } = await read(org);
    aws.trust.set(ROLE_MISMATCH, externalId);
    aws.accounts.set(ROLE_MISMATCH, "999988887777");
    const tested = await ctx.call(org.users.owner, "POST", path(org, "/test"), {
      roleArn: ROLE_MISMATCH,
      revision,
    });
    expect(tested.json).toEqual({
      result: "failed",
      code: "AWS_ACCOUNT_MISMATCH",
    });
    const put = await ctx.call(org.users.owner, "PUT", path(org), {
      roleArn: ROLE_MISMATCH,
      revision,
    });
    expect(put.status).toBe(422);
    expect(put.json).toMatchObject({
      error: { details: { code: "AWS_ACCOUNT_MISMATCH" } },
    });
    expect((await read(org)).connection).toBeNull();
  });
});

describe("AC-06 and AC-07 Projects", () => {
  async function seedConnection(
    org: TestOrganization,
    label: string,
    columns: Record<string, unknown>,
  ): Promise<string> {
    const projectId = await ctx.createProject(org.id, label);
    const names = Object.keys(columns);
    await ctx.owner.sql.query(
      `insert into project_aws_connections
         (project_id, tenant_id, external_id${names.map((name) => `, ${name}`).join("")})
       values ($1, $2, $3${names.map((_, index) => `, $${String(index + 4)}`).join("")})`,
      [projectId, org.id, `nw-prj-${projectId}`, ...Object.values(columns)],
    );
    return projectId;
  }

  it("lists assume-role Projects with current, failed, untested and stale results; disconnect keeps them", async () => {
    const org = await newOrganization();
    const saved = await connect(org);
    const at = new Date("2026-10-11T09:12:00Z");
    const passed = {
      method: "assume_role",
      role_arn: ROLE_PROJECT,
      last_test_result: "passed",
      last_tested_at: at,
      verified_account_id: "444455556666",
      verified_arn:
        "arn:aws:sts::444455556666:assumed-role/NightWatchReadOnly/x",
    };
    const ids = {
      passed: await seedConnection(org, "A passed", {
        ...passed,
        org_connection_revision: saved.revision,
      }),
      failed: await seedConnection(org, "B failed", {
        method: "assume_role",
        role_arn: ROLE_PROJECT,
        last_test_result: "failed",
        last_test_code: "AWS_ACCESS_DENIED",
        last_tested_at: at,
        org_connection_revision: saved.revision,
      }),
      untested: await seedConnection(org, "C untested", {
        method: "assume_role",
        role_arn: ROLE_PROJECT,
      }),
      stale: await seedConnection(org, "D stale", {
        ...passed,
        org_connection_revision: saved.revision - 1,
      }),
    };
    const key = randomBytes(16);
    await seedConnection(org, "E access key", {
      method: "access_key",
      region: "us-east-1",
      access_key_id_ciphertext: key,
      access_key_id_iv: key,
      access_key_id_auth_tag: key,
      secret_access_key_ciphertext: key,
      secret_access_key_iv: key,
      secret_access_key_auth_tag: key,
      credential_key_version: "v1",
    });
    await seedConnection(org, "F none", {});

    const body = await read(org);
    expect(
      body.projects.map((project) => [project.projectId, project.status]),
    ).toEqual([
      [ids.passed, "passed"],
      [ids.failed, "failed"],
      [ids.untested, "untested"],
      [ids.stale, "stale"],
    ]);
    expect(body.projects[0]).toMatchObject({
      roleArn: ROLE_PROJECT,
      accountId: "444455556666",
      lastTest: { result: "passed", code: null, testedAt: at.toISOString() },
    });
    expect(body.projects[1]?.lastTest).toMatchObject({
      result: "failed",
      code: "AWS_ACCESS_DENIED",
    });

    const projectRows = () =>
      ctx.owner.sql
        .query<{ row: unknown }>(
          "select to_jsonb(p) as row from project_aws_connections p where tenant_id = $1 order by project_id",
          [org.id],
        )
        .then((result) => result.rows);
    const kept = await projectRows();
    const gone = await ctx.call(
      org.users.owner,
      "DELETE",
      path(org, `?revision=${String(body.revision)}`),
    );
    expect(gone.status).toBe(200);
    const after = organizationAwsConnectionResponseSchema.parse(gone.json);
    expect(after.connection).toBeNull();
    expect(after.revision).toBe(body.revision + 1);
    expect(await projectRows()).toEqual(kept);
    expect(after.projects.map((project) => project.status)).toEqual([
      "stale",
      "stale",
      "untested",
      "stale",
    ]);
    expect(after.projects[0]?.lastTest?.result).toBe("passed");

    // A new central account makes results recorded on the old one history.
    const again = await connect(org, ROLE_NEXT);
    expect(again.projects.map((project) => project.status)).toEqual([
      "stale",
      "stale",
      "untested",
      "stale",
    ]);
  });

  it("an Organization without assume-role Projects lists none", async () => {
    expect((await read(await newOrganization())).projects).toEqual([]);
  });
});

describe("AC-08 permissions", () => {
  it.each(["viewer", "auditor"] as const)(
    "%s gets 403 with no settings data on all four operations, and GET creates nothing",
    async (role) => {
      const org = await newOrganization();
      const user = org.users[role];
      const responses = [
        await ctx.call(user, "GET", path(org)),
        await ctx.call(user, "POST", path(org, "/test"), {
          roleArn: ROLE,
          revision: 0,
        }),
        await ctx.call(user, "PUT", path(org), { roleArn: ROLE, revision: 0 }),
        await ctx.call(user, "DELETE", path(org, "?revision=0")),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(response.json).toEqual({
          error: {
            code: "PERMISSION_DENIED",
            message: expect.any(String) as string,
          },
        });
      }
      expect(await row(org)).toBeUndefined();
      expect(aws.calls).toEqual([]);
    },
  );

  it("a member of another Organization gets 403 MEMBERSHIP_DENIED", async () => {
    const org = await newOrganization();
    const other = await newOrganization();
    await read(org);
    for (const [method, suffix, body] of [
      ["GET", "", undefined],
      ["POST", "/test", { roleArn: ROLE, revision: 0 }],
      ["PUT", "", { roleArn: ROLE, revision: 0 }],
      ["DELETE", "?revision=0", undefined],
    ] as const) {
      const response = await ctx.call(
        other.users.owner,
        method,
        path(org, suffix),
        body,
      );
      expect(response.status).toBe(403);
      expect(response.json).toMatchObject({
        error: { code: "MEMBERSHIP_DENIED" },
      });
      expect(response.text).not.toContain("nw-org-");
    }
    expect(aws.calls).toEqual([]);
  });

  it("no session gets 401", async () => {
    const org = await newOrganization();
    expect((await ctx.call(null, "GET", path(org))).status).toBe(401);
  });
});

describe("AC-09 audit", () => {
  it("records tested, updated and disconnected with ARN, account, result and revision, never credentials", async () => {
    const org = await newOrganization();
    const { externalId } = await read(org);
    aws.trust.set(ROLE, externalId);
    await ctx.call(org.users.owner, "POST", path(org, "/test"), {
      roleArn: ROLE_DENIED,
      revision: 0,
    });
    await ctx.call(org.users.owner, "POST", path(org, "/test"), {
      roleArn: ROLE,
      revision: 0,
    });
    const saved = await connect(org);
    await ctx.call(
      org.users.owner,
      "DELETE",
      path(org, `?revision=${String(saved.revision)}`),
    );

    const events = await auditRows(org);
    expect(
      events.map((event) => [event.action, event.target_attributes]),
    ).toEqual([
      [
        "organization.aws_connection.tested",
        {
          roleArn: ROLE_DENIED,
          accountId: "111122223333",
          result: "failed",
          code: "AWS_ACCESS_DENIED",
          revision: 0,
        },
      ],
      [
        "organization.aws_connection.tested",
        {
          roleArn: ROLE,
          accountId: "111122223333",
          result: "passed",
          code: null,
          revision: 0,
        },
      ],
      [
        "organization.aws_connection.updated",
        {
          roleArn: ROLE,
          accountId: "111122223333",
          result: "passed",
          code: null,
          revision: 1,
        },
      ],
      [
        "organization.aws_connection.disconnected",
        {
          roleArn: ROLE,
          accountId: "111122223333",
          result: null,
          code: null,
          revision: 2,
        },
      ],
    ]);
    expect(events[2]?.changes).toEqual([
      { field: "roleArn", before: null, after: { kind: "value", value: ROLE } },
    ]);
    expect(events[3]?.changes).toEqual([
      { field: "roleArn", before: { kind: "value", value: ROLE }, after: null },
    ]);
    for (const event of events) {
      for (const leak of [
        FAKE_SECRET,
        FAKE_TOKEN,
        "RAW-AWS-DETAIL",
        externalId,
      ]) {
        expect(event.text).not.toContain(leak);
      }
    }

    const list = await ctx.call(
      org.users.owner,
      "GET",
      `/api/organizations/${org.id}/audit-log/events?categories=aws_connection`,
    );
    expect(list.status).toBe(200);
    const parsed = auditLogListResponseSchema.parse(list.json);
    expect(parsed.events.map((event) => event.target)).toContainEqual({
      type: "aws_connection",
      roleArn: ROLE,
      accountId: "111122223333",
      result: null,
      code: null,
      revision: 2,
    });
  });

  it("a failed PUT and a no-op DELETE record nothing", async () => {
    const org = await newOrganization();
    await read(org);
    await ctx.call(org.users.owner, "PUT", path(org), {
      roleArn: ROLE_DENIED,
      revision: 0,
    });
    const noop = await ctx.call(
      org.users.owner,
      "DELETE",
      path(org, "?revision=0"),
    );
    expect(noop.status).toBe(200);
    expect(
      organizationAwsConnectionResponseSchema.parse(noop.json).revision,
    ).toBe(0);
    expect(await auditRows(org)).toEqual([]);
  });
});

describe("AC-11 stale requests", () => {
  it("a stale revision answers 409 before STS on test and PUT, and on DELETE", async () => {
    const org = await newOrganization();
    const saved = await connect(org);
    aws.calls.length = 0;
    await clearQuota();
    const stale = saved.revision - 1;
    for (const [method, suffix, body] of [
      ["POST", "/test", { roleArn: ROLE, revision: stale }],
      ["PUT", "", { roleArn: ROLE, revision: stale }],
      ["DELETE", `?revision=${String(stale)}`, undefined],
    ] as const) {
      const response = await ctx.call(
        org.users.owner,
        method,
        path(org, suffix),
        body,
      );
      expect(response.status).toBe(409);
      expect(response.json).toMatchObject({
        error: {
          code: "AWS_CONNECTION_REVISION_CONFLICT",
          details: { currentRevision: saved.revision },
        },
      });
    }
    expect(aws.calls).toEqual([]);
    expect(await redis.keys(`rl:aws-test:*:o:${org.id}`)).toEqual([]);
  });

  async function duringSts(
    request: () => Promise<{ status: number; json: unknown; text: string }>,
    change: () => Promise<unknown>,
  ) {
    let release!: () => void;
    aws.hold = new Promise((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (aws.started = resolve));
    const pending = request();
    await started;
    await change();
    release();
    return pending;
  }

  it.each([
    ["POST", ROLE_NEXT],
    ["PUT", ROLE_NEXT],
    ["PUT", ROLE_DENIED],
  ] as const)(
    "%s %s: a revision change during STS answers 409 and saves nothing",
    async (method, roleArn) => {
      const org = await newOrganization();
      const saved = await connect(org);
      aws.trust.set(ROLE_NEXT, saved.externalId);
      const response = await duringSts(
        () =>
          ctx.call(
            org.users.owner,
            method,
            path(org, method === "POST" ? "/test" : ""),
            {
              roleArn,
              revision: saved.revision,
            },
          ),
        () =>
          ctx.call(
            org.users.admin,
            "DELETE",
            path(org, `?revision=${String(saved.revision)}`),
          ),
      );
      expect(response.status).toBe(409);
      expect(response.json).toMatchObject({
        error: { code: "AWS_CONNECTION_REVISION_CONFLICT" },
      });
      const now = await read(org);
      expect(now.connection).toBeNull();
      expect(now.revision).toBe(saved.revision + 1);
      expect((await auditRows(org)).map((event) => event.action)).toEqual([
        "organization.aws_connection.updated",
        "organization.aws_connection.disconnected",
      ]);
    },
  );

  it.each([
    ["POST", ROLE],
    ["PUT", ROLE],
    ["PUT", ROLE_DENIED],
  ] as const)(
    "%s %s: losing Owner/Admin during STS answers 403 with no result",
    async (method, roleArn) => {
      const org = await newOrganization();
      const { externalId } = await read(org);
      aws.trust.set(ROLE, externalId);
      const saved = await row(org);
      const response = await duringSts(
        () =>
          ctx.call(
            org.users.admin,
            method,
            path(org, method === "POST" ? "/test" : ""),
            {
              roleArn,
              revision: 0,
            },
          ),
        () =>
          ctx.owner.sql.query(
            "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
            [org.id, org.users.admin],
          ),
      );
      expect(response.status).toBe(403);
      expect(response.json).toEqual({
        error: {
          code: "PERMISSION_DENIED",
          message: expect.any(String) as string,
        },
      });
      expect(response.text).not.toContain("111122223333");
      expect(await row(org)).toEqual(saved);
      expect(await auditRows(org)).toEqual([]);
    },
  );
});

describe("AC-12 rate limit", () => {
  it("answers 429 with Retry-After after 10 calls per user, shared by test and PUT, without calling STS", async () => {
    const org = await newOrganization();
    const { externalId } = await read(org);
    aws.trust.set(ROLE, externalId);
    for (let index = 0; index < 10; index += 1) {
      const response = await ctx.call(
        org.users.owner,
        "POST",
        path(org, "/test"),
        { roleArn: ROLE_DENIED, revision: 0 },
      );
      expect(response.status).toBe(200);
    }
    const calls = aws.calls.length;
    const saved = await row(org);
    for (const method of ["POST", "PUT"] as const) {
      const response = await ctx.call(
        org.users.owner,
        method,
        path(org, method === "POST" ? "/test" : ""),
        { roleArn: ROLE, revision: 0 },
      );
      expect(response.status).toBe(429);
      expect(
        Number(response.headers.get("retry-after")),
      ).toBeGreaterThanOrEqual(1);
      expect(response.json).toMatchObject({
        error: {
          code: "AWS_TEST_RATE_LIMITED",
          details: { retryAfterSeconds: expect.any(Number) as number },
        },
      });
    }
    expect(aws.calls).toHaveLength(calls);
    expect(await row(org)).toEqual(saved);
    // Another Admin of the same Organization still has quota.
    const other = await ctx.call(org.users.admin, "POST", path(org, "/test"), {
      roleArn: ROLE,
      revision: 0,
    });
    expect(other.status).toBe(200);
  });

  it.each([
    ["no Redis", () => noRedis],
    ["Redis down", () => deadRedis],
  ] as const)(
    "answers 503 RATE_LIMIT_UNAVAILABLE with %s and calls no STS",
    async (_label, context) => {
      const app = context();
      const org = await newOrganization(app);
      await read(org, app);
      for (const method of ["POST", "PUT"] as const) {
        const response = await app.call(
          org.users.owner,
          method,
          path(org, method === "POST" ? "/test" : ""),
          { roleArn: ROLE, revision: 0 },
        );
        expect(response.status).toBe(503);
        expect(response.json).toMatchObject({
          error: { code: "RATE_LIMIT_UNAVAILABLE" },
        });
      }
      expect(aws.calls).toEqual([]);
    },
  );
});
