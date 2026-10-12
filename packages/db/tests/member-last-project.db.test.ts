import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  runMigrations,
  withTenantContextRaw,
  withTenantUserContextRaw,
} from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "member_last_project database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = randomUUID().slice(0, 8);
const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = `mlp-a-${run}`;
const userA2 = `mlp-a2-${run}`;
const userB = `mlp-b-${run}`;
let projectA: string;
let projectA2: string;
let projectB: string;

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
      [id, `mlp-${label}-${run}`, `mlp-${label}-${run}-${id}`],
    );
  }
  for (const user of [userA, userA2, userB]) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
      [user, user, `${user}@example.test`],
    );
  }
  for (const [tenant, user] of [
    [tenantA, userA],
    [tenantA, userA2],
    [tenantB, userB],
  ] as const) {
    await owner.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [randomUUID(), tenant, user],
    );
  }
  projectA = await seedProject(tenantA, "mlp-a-one");
  projectA2 = await seedProject(tenantA, "mlp-a-two");
  projectB = await seedProject(tenantB, "mlp-b-one");
}, 60_000);

afterAll(async () => {
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await owner.query('delete from "user" where id = any($1::text[])', [
    [userA, userA2, userB],
  ]);
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

async function ownerRows(tenant: string) {
  return (
    await owner.query<{ user_id: string; project_id: string }>(
      "select user_id, project_id from member_last_project where tenant_id = $1 order by user_id",
      [tenant],
    )
  ).rows;
}

const asUser = <T>(
  tenant: string,
  user: string,
  work: Parameters<typeof withTenantUserContextRaw<T>>[3],
) => withTenantUserContextRaw(database, tenant, user, work);

const remember = (tenant: string, user: string, project: string) =>
  asUser(tenant, user, (client) =>
    client.query(
      `insert into member_last_project (tenant_id, user_id, project_id, selected_at)
       values ($1, $2, $3, now())
       on conflict (tenant_id, user_id) do update set project_id = excluded.project_id`,
      [tenant, user, project],
    ),
  );

describe("member_last_project isolation (DB-10)", () => {
  it("lets a user write and update only their own row (upsert)", async () => {
    await remember(tenantA, userA, projectA);
    await remember(tenantA, userA, projectA2);
    expect(await ownerRows(tenantA)).toEqual([
      { user_id: userA, project_id: projectA2 },
    ]);
  });

  it("hides another user's row in the same tenant", async () => {
    await remember(tenantA, userA, projectA);
    const seen = await asUser(tenantA, userA2, (client) =>
      client.query("select 1 from member_last_project"),
    );
    expect(seen.rows).toEqual([]);
  });

  it("rejects writing a row for another user in the same tenant", async () => {
    await expect(remember(tenantA, userA, projectA)).resolves.toBeDefined();
    await expect(
      asUser(tenantA, userA2, (client) =>
        client.query(
          "insert into member_last_project (tenant_id, user_id, project_id, selected_at) values ($1, $2, $3, now())",
          [tenantA, userA, projectA2],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or read another user's row", async () => {
    await remember(tenantA, userA, projectA);
    const result = await asUser(tenantA, userA2, async (client) => {
      const updated = await client.query(
        "update member_last_project set project_id = $1 where user_id = $2",
        [projectA2, userA],
      );
      return updated.rowCount;
    });
    expect(result).toBe(0);
    expect(
      (await ownerRows(tenantA)).find((row) => row.user_id === userA),
    ).toMatchObject({ project_id: projectA });
  });

  it("hides rows from another tenant, even for the same user id", async () => {
    await remember(tenantA, userA, projectA);
    const seen = await asUser(tenantB, userA, (client) =>
      client.query("select 1 from member_last_project"),
    );
    expect(seen.rows).toEqual([]);
  });

  it("rejects a row for another tenant", async () => {
    await expect(
      asUser(tenantA, userA, (client) =>
        client.query(
          "insert into member_last_project (tenant_id, user_id, project_id, selected_at) values ($1, $2, $3, now())",
          [tenantB, userB, projectB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects a Project of another tenant, and a user who is not a member", async () => {
    await expect(remember(tenantA, userA, projectB)).rejects.toThrow(
      /foreign key/,
    );
    await expect(remember(tenantA, userB, projectA)).rejects.toThrow(
      /foreign key|row-level security/,
    );
  });

  it("returns nothing without a user context, and rejects writes without one", async () => {
    await remember(tenantA, userA, projectA);
    const noUser = await withTenantContextRaw(database, tenantA, (client) =>
      client.query("select 1 from member_last_project"),
    );
    expect(noUser.rows).toEqual([]);
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          "insert into member_last_project (tenant_id, user_id, project_id, selected_at) values ($1, $2, $3, now())",
          [tenantA, userA2, projectA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const none = await database.sql.query("select 1 from member_last_project");
    expect(none.rows).toEqual([]);
  });
});

describe("member_last_project grants and cascades", () => {
  it("grants select and insert, update on project_id, updated_at and selected_at only, no delete", async () => {
    const result = await owner.query<{ privilege: string; ok: boolean }>(
      `select p as privilege, has_table_privilege('nightwatch', 'member_last_project'::regclass, p) as ok
       from unnest(array['select','insert','update','delete','truncate']) as p`,
    );
    expect(
      result.rows.filter((row) => row.ok).map((row) => row.privilege),
    ).toEqual(["select", "insert"]);
    const columns = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'member_last_project' and table_schema = 'public'
         and has_column_privilege('nightwatch', 'member_last_project', column_name, 'update')
       order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "project_id",
      "selected_at",
      "updated_at",
    ]);
  });

  it("removes the row when its Project is deleted", async () => {
    const doomed = await seedProject(tenantA, `mlp-doomed-${run}`);
    await remember(tenantA, userA2, doomed);
    await owner.query("delete from projects where id = $1", [doomed]);
    expect(
      (await ownerRows(tenantA)).some((row) => row.user_id === userA2),
    ).toBe(false);
  });

  it("removes the row when the user leaves the Organization", async () => {
    await remember(tenantA, userA2, projectA);
    await owner.query(
      "delete from member where organization_id = $1 and user_id = $2",
      [tenantA, userA2],
    );
    expect(
      (await ownerRows(tenantA)).some((row) => row.user_id === userA2),
    ).toBe(false);
  });
});
