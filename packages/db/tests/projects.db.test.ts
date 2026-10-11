import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, runMigrations, withTenantContextRaw } from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "project database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = randomUUID().slice(0, 8);
const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = `proj-a-${run}`;
const userA2 = `proj-a2-${run}`;
const userB = `proj-b-${run}`;
let projectA: string;
let projectB: string;

const TABLES = ["projects", "project_members"] as const;

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
      [id, `project-${label}-${run}`, `project-${label}-${run}-${id}`],
    );
  }
  for (const [id, email] of [
    [userA, "a"],
    [userA2, "a2"],
    [userB, "b"],
  ] as const) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
      [id, id, `${email}-${run}@example.test`],
    );
  }
  for (const [tenant, user] of [
    [tenantA, userA],
    [tenantA, userA2],
    [tenantB, userB],
  ] as const) {
    await owner.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
      [randomUUID(), tenant, user],
    );
  }
  projectA = await seedProject(tenantA, userA, `proj-a-${run}`);
  projectB = await seedProject(tenantB, userB, `proj-b-${run}`);
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

async function seedProject(
  tenant: string,
  user: string,
  slug: string,
): Promise<string> {
  const id = randomUUID();
  await owner.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, $3, $4)",
    [id, tenant, slug, slug],
  );
  await owner.query(
    "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'admin')",
    [id, tenant, user],
  );
  return id;
}

async function ownerCount(table: string, tenant: string): Promise<number> {
  const result = await owner.query<{ total: string }>(
    `select count(*) as total from ${table} where tenant_id = $1`,
    [tenant],
  );
  return Number(result.rows[0]?.total);
}

describe("project tenant isolation", () => {
  it.each(TABLES)("%s shows each tenant only its own rows", async (table) => {
    const ids = [tenantA, tenantB];
    const asA = await withTenantContextRaw(database, tenantA, (client) =>
      client.query<{ tenant_id: string }>(
        `select tenant_id from ${table} where tenant_id = any($1::uuid[])`,
        [ids],
      ),
    );
    expect(asA.rows.map((row) => row.tenant_id)).toEqual([tenantA]);
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

  it("rejects writing a project or a membership for another tenant", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          "insert into projects (tenant_id, name, slug) values ($1, 'x', 'xxx')",
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
          [projectB, tenantB, userB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects a membership of tenant A that points at tenant B's project or user", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
          [projectB, tenantA, userA2],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
          [projectA, tenantA, userB],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("cannot update or delete the other tenant's project", async () => {
    const counts = await withTenantContextRaw(
      database,
      tenantA,
      async (client) => {
        const updated = await client.query(
          "update projects set name = 'hijacked' where id = $1",
          [projectB],
        );
        const deleted = await client.query(
          "delete from projects where id = $1",
          [projectB],
        );
        return [updated.rowCount, deleted.rowCount];
      },
    );
    expect(counts).toEqual([0, 0]);
    expect(await ownerCount("projects", tenantB)).toBe(1);
  });
});

describe("project grants", () => {
  async function privileges(table: string): Promise<string[]> {
    const result = await owner.query<{ privilege: string; ok: boolean }>(
      `select p as privilege, has_table_privilege('nightwatch', $1::regclass, p) as ok
       from unnest(array['select','insert','update','delete','truncate','references','trigger']) as p`,
      [table],
    );
    return result.rows.filter((row) => row.ok).map((row) => row.privilege);
  }

  it("grants select, insert and delete on projects, with update by column", async () => {
    expect(await privileges("projects")).toEqual([
      "select",
      "insert",
      "delete",
    ]);
    const columns = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'projects' and table_schema = 'public'
         and has_column_privilege('nightwatch', 'projects', column_name, 'update')
       order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "description",
      "name",
      "updated_at",
    ]);
  });

  it("grants select and insert only on project_members", async () => {
    expect(await privileges("project_members")).toEqual(["select", "insert"]);
  });

  it.each(["slug", "tenant_id", "id"])(
    "denies the runtime role updating projects.%s",
    async (column) => {
      const value = column === "slug" ? "'other-slug'" : "gen_random_uuid()";
      await expect(
        withTenantContextRaw(database, tenantA, (client) =>
          client.query(
            `update projects set ${column} = ${value} where id = $1`,
            [projectA],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("denies the runtime role deleting project_members directly", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query("delete from project_members where project_id = $1", [
          projectA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("project constraints", () => {
  const insert = (name: string, slug: string, description: string | null) =>
    withTenantContextRaw(database, tenantA, (client) =>
      client.query(
        "insert into projects (tenant_id, name, slug, description) values ($1, $2, $3, $4)",
        [tenantA, name, slug, description],
      ),
    );

  it.each([
    ["", "ok-slug", null],
    ["n".repeat(81), "ok-slug", null],
    ["ok", "ab", null],
    ["ok", "Upper", null],
    ["ok", "a".repeat(41), null],
    ["ok", "ok-slug", ""],
    ["ok", "ok-slug", "d".repeat(501)],
  ])(
    "rejects name %j slug %j description %j",
    async (name, slug, description) => {
      await expect(insert(name, slug, description)).rejects.toThrow(/check/);
    },
  );

  it("names the slug constraint a duplicate violates, per tenant only", async () => {
    await expect(insert("dup", `proj-a-${run}`, null)).rejects.toMatchObject({
      code: "23505",
      constraint: "projects_tenant_slug_key",
    });
    await owner.query(
      "insert into projects (tenant_id, name, slug) values ($1, 'same', $2)",
      [tenantB, `proj-a-${run}`],
    );
    expect(await ownerCount("projects", tenantB)).toBe(2);
  });
});

describe("cascades", () => {
  it("deleting a member removes their project memberships without a tenant context", async () => {
    const user = `proj-gone-${run}`;
    await owner.query(
      'insert into "user" (id, name, email, email_verified) values ($1, $1, $2, true)',
      [user, `gone-${run}@example.test`],
    );
    await owner.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [randomUUID(), tenantA, user],
    );
    await owner.query(
      "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
      [projectA, tenantA, user],
    );
    // Runtime role, no app.tenant_id: the FORCE RLS rows must still go.
    const deleted = await database.sql.query(
      "delete from member where organization_id = $1 and user_id = $2",
      [tenantA, user],
    );
    expect(deleted.rowCount).toBe(1);
    const left = await owner.query(
      "select 1 from project_members where tenant_id = $1 and user_id = $2",
      [tenantA, user],
    );
    expect(left.rows).toEqual([]);
    await owner.query('delete from "user" where id = $1', [user]);
  });

  it("deleting a project removes its memberships", async () => {
    const id = await seedProject(tenantA, userA, `proj-del-${run}`);
    await withTenantContextRaw(database, tenantA, (client) =>
      client.query("delete from projects where id = $1", [id]),
    );
    const left = await owner.query(
      "select 1 from project_members where project_id = $1",
      [id],
    );
    expect(left.rows).toEqual([]);
  });
});

describe("audit_events constraints", () => {
  it("accepts the project actions and rejects a category that does not match", async () => {
    const insert = (action: string, category: string) =>
      owner.query(
        `insert into audit_events
           (tenant_id, actor_user_id, actor_role, category, action, target_type, target_id)
         values ($1, $2, 'owner', $3, $4, 'project', $5)`,
        [tenantA, userA, category, action, randomUUID()],
      );
    for (const action of ["create", "update", "delete"]) {
      await insert(`organization.project.${action}`, "project");
    }
    await expect(
      insert("organization.project.create", "monitor"),
    ).rejects.toThrow(/audit_events_category_matches_action/);
  });
});
