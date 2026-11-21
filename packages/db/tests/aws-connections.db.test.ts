import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, runMigrations, withTenantContextRaw } from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "AWS connection database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = randomUUID().slice(0, 8);
const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = `aws-a-${run}`;
let projectA: string;
let projectB: string;

const TABLES = ["org_aws_connections", "project_aws_connections"] as const;
const ROLE_A = "arn:aws:iam::111122223333:role/NightWatchOrgHub";
const ROLE_P = "arn:aws:iam::444455556666:role/NightWatchReadOnly";

const externalId = (label: string) =>
  `nw-org-${label}-${[...randomBytes(26)]
    .map((byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte & 31])
    .join("")}`;
const EXTERNAL_A = externalId("a");

beforeAll(async () => {
  await runMigrations({
    url: ownerUrl,
    migrationsDir: new URL("../migrations", import.meta.url).pathname,
    log: () => undefined,
  });
  await owner.connect();
  for (const [id, label] of [
    [tenantA, "a"],
    [tenantB, "b"],
  ] as const) {
    await owner.query(
      "insert into organization (id, name, slug) values ($1, $2, $3)",
      [id, `aws-${label}-${run}`, `aws-${label}-${run}-${id}`],
    );
  }
  await owner.query(
    'insert into "user" (id, name, email, email_verified) values ($1, $1, $2, true)',
    [userA, `${userA}@example.test`],
  );
  projectA = await seedProject(tenantA, `aws-a-${run}`);
  projectB = await seedProject(tenantB, `aws-b-${run}`);
  await owner.query(
    "insert into org_aws_connections (tenant_id, external_id) values ($1, $2), ($3, $4)",
    [tenantA, EXTERNAL_A, tenantB, externalId("b")],
  );
  for (const [project, tenant] of [
    [projectA, tenantA],
    [projectB, tenantB],
  ] as const) {
    await owner.query(
      "insert into project_aws_connections (project_id, tenant_id, external_id) values ($1, $2, $3)",
      [project, tenant, `nw-prj-${project}`],
    );
  }
}, 60_000);

afterAll(async () => {
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await owner.query('delete from "user" where id = $1', [userA]);
  await owner.end();
  await database.close();
});

async function seedProject(tenant: string, slug: string): Promise<string> {
  const id = randomUUID();
  await owner.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, $3, $4)",
    [id, tenant, slug, slug],
  );
  return id;
}

const asTenant = (tenant: string, text: string, values: unknown[] = []) =>
  withTenantContextRaw(database, tenant, (client) =>
    client.query(text, values),
  );

describe("AWS connection tenant isolation (DB-04)", () => {
  it.each(TABLES)("%s shows each tenant only its own rows", async (table) => {
    const result = await asTenant(
      tenantA,
      `select tenant_id from ${table} where tenant_id = any($1::uuid[])`,
      [[tenantA, tenantB]],
    );
    expect(result.rows).toEqual([{ tenant_id: tenantA }]);
  });

  it.each(TABLES)(
    "%s returns nothing without a tenant context",
    async (table) => {
      const result = await database.sql.query(
        `select 1 from ${table} where tenant_id = any($1::uuid[])`,
        [[tenantA, tenantB]],
      );
      expect(result.rows).toEqual([]);
    },
  );

  it.each(TABLES)("%s has RLS enabled and forced", async (table) => {
    const result = await owner.query(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass",
      [table],
    );
    expect(result.rows).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("rejects writing a row for another tenant", async () => {
    const tenantC = randomUUID();
    await owner.query(
      "insert into organization (id, name, slug) values ($1, $2, $2)",
      [tenantC, `aws-c-${run}-${tenantC}`],
    );
    try {
      await expect(
        asTenant(
          tenantA,
          "insert into org_aws_connections (tenant_id, external_id) values ($1, $2)",
          [tenantC, externalId("c")],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asTenant(
          tenantA,
          "insert into project_aws_connections (project_id, tenant_id, external_id) values ($1, $2, $3)",
          [projectB, tenantB, `nw-prj-x-${run}`],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await owner.query("delete from organization where id = $1", [tenantC]);
    }
  });

  it("cannot update the other tenant's rows", async () => {
    const counts = [
      (
        await asTenant(
          tenantA,
          "update org_aws_connections set revision = 99 where tenant_id = $1",
          [tenantB],
        )
      ).rowCount,
      (
        await asTenant(
          tenantA,
          "update project_aws_connections set org_connection_revision = null where project_id = $1",
          [projectB],
        )
      ).rowCount,
    ];
    expect(counts).toEqual([0, 0]);
  });

  it("rejects a project connection of tenant A that points at tenant B's project (composite FK)", async () => {
    const other = await seedProject(tenantB, `aws-fk-${run}`);
    await expect(
      asTenant(
        tenantA,
        "insert into project_aws_connections (project_id, tenant_id, external_id) values ($1, $2, $3)",
        [other, tenantA, `nw-prj-fk-${run}`],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("AWS connection grants", () => {
  async function privileges(table: string): Promise<string[]> {
    const result = await owner.query<{ privilege: string; ok: boolean }>(
      `select p as privilege, has_table_privilege('nightwatch', $1::regclass, p) as ok
       from unnest(array['select','insert','update','delete','truncate','references','trigger']) as p`,
      [table],
    );
    return result.rows.filter((row) => row.ok).map((row) => row.privilege);
  }

  async function updatableColumns(table: string): Promise<string[]> {
    const result = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = $1 and table_schema = 'public'
         and has_column_privilege('nightwatch', $1::regclass, column_name, 'update')
       order by column_name`,
      [table],
    );
    return result.rows.map((row) => row.column_name);
  }

  it("grants select and insert, with update by column and no delete", async () => {
    for (const table of TABLES) {
      expect(await privileges(table)).toEqual(["select", "insert"]);
    }
    expect(await updatableColumns("org_aws_connections")).toEqual([
      "revision",
      "role_arn",
      "tested_at",
      "updated_at",
      "updated_by",
      "verified_account_id",
      "verified_arn",
    ]);
    expect(await updatableColumns("project_aws_connections")).not.toEqual(
      expect.arrayContaining(["external_id", "tenant_id", "project_id"]),
    );
  });

  it.each([
    [
      "org_aws_connections",
      "external_id",
      "'nw-org-x-aaaaaaaaaaaaaaaaaaaaaaaaaa'",
    ],
    ["org_aws_connections", "tenant_id", "gen_random_uuid()"],
    ["project_aws_connections", "external_id", "'changed-id'"],
    ["project_aws_connections", "project_id", "gen_random_uuid()"],
  ])("denies the runtime role updating %s.%s", async (table, column, value) => {
    await expect(
      asTenant(tenantA, `update ${table} set ${column} = ${value}`),
    ).rejects.toThrow(/permission denied/);
  });

  it("denies the runtime role deleting a connection row", async () => {
    await expect(
      asTenant(
        tenantA,
        "delete from org_aws_connections where tenant_id = $1",
        [tenantA],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("org_aws_connections constraints", () => {
  const update = (set: string, values: unknown[] = []) =>
    asTenant(
      tenantA,
      `update org_aws_connections set ${set} where tenant_id = $1`,
      [tenantA, ...values],
    );

  it("accepts a coherent connection and a cleared one", async () => {
    await update(
      "role_arn = $2, verified_account_id = '111122223333', verified_arn = $3, tested_at = now(), revision = 1",
      [ROLE_A, "arn:aws:sts::111122223333:assumed-role/NightWatchOrgHub/x"],
    );
    await update(
      "role_arn = null, verified_account_id = null, verified_arn = null, tested_at = null, revision = 2",
    );
  });

  it.each([
    ["a role without a verified identity", "role_arn = $2", [ROLE_A]],
    [
      "a role without a verified account",
      "role_arn = $2, verified_arn = 'x', tested_at = now()",
      [ROLE_A],
    ],
    [
      "a verified account that is not the ARN's account",
      "role_arn = $2, verified_account_id = '999999999999', verified_arn = 'x', tested_at = now()",
      [ROLE_A],
    ],
    [
      "a malformed role ARN",
      "role_arn = 'arn:aws:iam::123:role/x', verified_account_id = '123', verified_arn = 'x', tested_at = now()",
      [],
    ],
    ["a negative revision", "revision = -1", []],
  ])("rejects %s", async (_label, set, values) => {
    await expect(update(set, values)).rejects.toThrow(/check/);
  });

  it.each([
    "nw-org-x-short",
    "nw-org-UPPER-aaaaaaaaaaaaaaaaaaaaaaaaaa",
    "other",
  ])("rejects External ID %j", async (value) => {
    const tenant = randomUUID();
    await owner.query(
      "insert into organization (id, name, slug) values ($1, $2, $2)",
      [tenant, `aws-x-${run}-${tenant}`],
    );
    try {
      await expect(
        owner.query(
          "insert into org_aws_connections (tenant_id, external_id) values ($1, $2)",
          [tenant, value],
        ),
      ).rejects.toThrow(/check/);
    } finally {
      await owner.query("delete from organization where id = $1", [tenant]);
    }
  });

  it("keeps External IDs unique across Organizations", async () => {
    await expect(
      owner.query(
        "update org_aws_connections set external_id = $2 where tenant_id = $1",
        [tenantB, EXTERNAL_A],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("project_aws_connections constraints", () => {
  const key = () => randomBytes(16);
  const keyColumns = `access_key_id_ciphertext = $2, access_key_id_iv = $2,
    access_key_id_auth_tag = $2, secret_access_key_ciphertext = $2,
    secret_access_key_iv = $2, secret_access_key_auth_tag = $2,
    credential_key_version = 'v1'`;
  const update = (set: string, values: unknown[] = []) =>
    asTenant(
      tenantA,
      `update project_aws_connections set ${set} where project_id = $1`,
      [projectA, ...values],
    );
  const reset = () =>
    owner.query(
      `update project_aws_connections set method = null, role_arn = null,
         access_key_id_ciphertext = null, access_key_id_iv = null,
         access_key_id_auth_tag = null, secret_access_key_ciphertext = null,
         secret_access_key_iv = null, secret_access_key_auth_tag = null,
         credential_key_version = null, region = null,
         last_test_result = null, last_test_code = null, last_tested_at = null,
         verified_account_id = null, verified_arn = null,
         org_connection_revision = null
       where project_id = $1`,
      [projectA],
    );

  it("accepts each method with its own data and a coherent last test", async () => {
    await update(
      `method = 'assume_role', role_arn = $2, last_test_result = 'passed',
       last_tested_at = now(), verified_account_id = '444455556666',
       verified_arn = 'arn:aws:sts::444455556666:assumed-role/r/s',
       org_connection_revision = 3`,
      [ROLE_P],
    );
    await reset();
    await update(`method = 'access_key', region = 'us-east-1', ${keyColumns}`, [
      key(),
    ]);
    await update(
      "last_test_result = 'failed', last_test_code = 'AWS_ACCESS_DENIED', last_tested_at = now()",
    );
    await reset();
  });

  it.each([
    ["role data without a method", "role_arn = $2", [ROLE_P]],
    [
      "key data without a method",
      keyColumns.replaceAll("$2", "$2::bytea"),
      [randomBytes(16)],
    ],
    ["assume_role without a role ARN", "method = 'assume_role'", []],
    [
      "assume_role with key data",
      `method = 'assume_role', role_arn = $3, ${keyColumns}`,
      [randomBytes(16), ROLE_P],
    ],
    [
      "access_key with a role ARN",
      `method = 'access_key', region = 'us-east-1', role_arn = $3, ${keyColumns}`,
      [randomBytes(16), ROLE_P],
    ],
    [
      "access_key missing the secret",
      `method = 'access_key', region = 'us-east-1', access_key_id_ciphertext = $2,
       access_key_id_iv = $2, access_key_id_auth_tag = $2, credential_key_version = 'v1'`,
      [randomBytes(16)],
    ],
    [
      "access_key without a region",
      `method = 'access_key', ${keyColumns}`,
      [randomBytes(16)],
    ],
    [
      "a role ARN the contract pattern refuses (empty path segment)",
      "method = 'assume_role', role_arn = 'arn:aws:iam::444455556666:role//x'",
      [],
    ],
    [
      "a role name longer than 64 characters",
      "method = 'assume_role', role_arn = $2",
      [`arn:aws:iam::444455556666:role/${"n".repeat(65)}`],
    ],
    [
      "a test code outside the contract's codes",
      `method = 'assume_role', role_arn = $2, last_test_result = 'failed',
       last_test_code = 'AWS_EXTERNAL_ID_MISMATCH', last_tested_at = now()`,
      [ROLE_P],
    ],
    [
      "a test code without a result",
      "method = 'assume_role', role_arn = $2, last_test_code = 'AWS_TIMEOUT'",
      [ROLE_P],
    ],
    [
      "a failed test without a code",
      "method = 'assume_role', role_arn = $2, last_test_result = 'failed', last_tested_at = now()",
      [ROLE_P],
    ],
    [
      "a failed test with a verified identity",
      `method = 'assume_role', role_arn = $2, last_test_result = 'failed',
       last_test_code = 'AWS_TIMEOUT', last_tested_at = now(),
       verified_account_id = '444455556666', verified_arn = 'x'`,
      [ROLE_P],
    ],
    [
      "an Organization revision on an untested Project",
      "method = 'assume_role', role_arn = $2, org_connection_revision = 1",
      [ROLE_P],
    ],
    [
      "an Organization revision on an access_key Project",
      `method = 'access_key', region = 'us-east-1', ${keyColumns},
       last_test_result = 'failed', last_test_code = 'AWS_TIMEOUT',
       last_tested_at = now(), org_connection_revision = 1`,
      [randomBytes(16)],
    ],
  ])("rejects %s", async (_label, set, values) => {
    await expect(update(set, values)).rejects.toThrow(/check/);
  });
});

describe("AWS connection cascades", () => {
  it("deleting a Project removes its connection", async () => {
    const project = await seedProject(tenantA, `aws-del-${run}`);
    await owner.query(
      "insert into project_aws_connections (project_id, tenant_id, external_id) values ($1, $2, $3)",
      [project, tenantA, `nw-prj-${project}`],
    );
    await asTenant(tenantA, "delete from projects where id = $1", [project]);
    const left = await owner.query(
      "select 1 from project_aws_connections where project_id = $1",
      [project],
    );
    expect(left.rows).toEqual([]);
  });

  it("deleting the user who saved a connection clears updated_by", async () => {
    const user = `aws-gone-${run}`;
    await owner.query(
      'insert into "user" (id, name, email, email_verified) values ($1, $1, $2, true)',
      [user, `${user}@example.test`],
    );
    await owner.query(
      "update org_aws_connections set updated_by = $2, updated_at = now() where tenant_id = $1",
      [tenantA, user],
    );
    await owner.query('delete from "user" where id = $1', [user]);
    const row = await owner.query<{ updated_by: string | null }>(
      "select updated_by from org_aws_connections where tenant_id = $1",
      [tenantA],
    );
    expect(row.rows).toEqual([{ updated_by: null }]);
  });
});

describe("audit_events constraints", () => {
  const insert = (action: string, category: string) =>
    owner.query(
      `insert into audit_events
         (tenant_id, actor_user_id, actor_role, category, action, target_type)
       values ($1, $2, 'owner', $3, $4, 'aws_connection')`,
      [tenantA, userA, category, action],
    );

  it("keeps the action names that 0028 wrote valid for existing events", async () => {
    for (const action of ["test", "update", "delete"])
      await insert(`organization.aws_connection.${action}`, "aws_connection");
    for (const action of ["test", "update", "delete"])
      await owner.query(
        `insert into audit_events
           (tenant_id, actor_user_id, actor_role, category, action, target_type)
         values ($1, $2, 'owner', 'project', $3, 'project')`,
        [tenantA, userA, `organization.project.aws_connection.${action}`],
      );
    const { rows } = await owner.query(
      "select count(*)::int as n from audit_events where tenant_id = $1 and (action like 'organization.aws_connection.%' or action like 'organization.project.aws_connection.%') and action not in ('organization.aws_connection.tested', 'organization.aws_connection.updated', 'organization.aws_connection.disconnected')",
      [tenantA],
    );
    expect(rows[0]).toMatchObject({ n: 6 });
  });

  it("accepts the AWS connection actions and rejects a category that does not match", async () => {
    for (const action of ["tested", "updated", "disconnected"]) {
      await insert(`organization.aws_connection.${action}`, "aws_connection");
    }
    await expect(
      insert("organization.aws_connection.tested", "project"),
    ).rejects.toThrow(/audit_events_category_matches_action/);
    await expect(
      insert("organization.project.create", "aws_connection"),
    ).rejects.toThrow(/audit_events_category_matches_action/);
    await expect(
      insert("organization.aws_connection.deleted", "aws_connection"),
    ).rejects.toThrow(/audit_events_action_check/);
  });
});
