import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, runMigrations, withTenantContextRaw } from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "inventory database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = randomUUID().slice(0, 8);
const tenantA = randomUUID();
const tenantB = randomUUID();
const projectA = randomUUID();
const projectA2 = randomUUID();
const projectB = randomUUID();
const projectEdit = randomUUID();
const TABLES = ["inventory_systems", "inventory_rows"] as const;

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
      [id, `inv-${label}-${run}`, `inv-${label}-${run}-${id}`],
    );
  }
  for (const [project, tenant, slug] of [
    [projectA, tenantA, "inv-a"],
    [projectA2, tenantA, "inv-a2"],
    [projectB, tenantB, "inv-b"],
    [projectEdit, tenantA, "inv-edit"],
  ] as const) {
    await owner.query(
      "insert into projects (id, tenant_id, name, slug) values ($1, $2, $3, $4)",
      [project, tenant, slug, `${slug}-${run}`],
    );
  }
}, 60_000);

afterAll(async () => {
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await owner.end();
  await database.close();
});

type Scope = { tenant: string; project: string };

async function insertSystem(
  client: { query: Client["query"] },
  scope: Scope,
  name: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into inventory_systems
       (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
     values ($1, $2, $3, $4, 'inventory.xlsx', 'user-1', 1, 1) returning id`,
    [scope.tenant, scope.project, name.trim().toLowerCase(), name],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("inventory system was not inserted");
  return id;
}

function insertRow(
  client: { query: Client["query"] },
  scope: Scope,
  systemId: string,
  fields: { usable: boolean; issues: unknown[]; line?: number },
) {
  return client.query(
    `insert into inventory_rows
       (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
        layer, environment, exposure, usable, issues, source_kind, source_file_name, changed_by)
     values ($1, $2, $3, $4, 'ทีม A', 'Canonical', 'Ubuntu', '22.04.4',
        'OS', 'Production', 'Internal', $5, $6::jsonb, 'import', 'inventory.xlsx', 'user-1')`,
    [
      scope.tenant,
      scope.project,
      systemId,
      fields.line ?? 2,
      fields.usable,
      JSON.stringify(fields.issues),
    ],
  );
}

async function ownerCount(table: string, tenant: string): Promise<number> {
  const result = await owner.query<{ total: string }>(
    `select count(*) as total from ${table} where tenant_id = $1`,
    [tenant],
  );
  return Number(result.rows[0]?.total);
}

describe("inventory tenant isolation", () => {
  beforeAll(async () => {
    for (const scope of [
      { tenant: tenantA, project: projectA },
      { tenant: tenantB, project: projectB },
    ]) {
      await withTenantContextRaw(database, scope.tenant, async (client) => {
        const system = await insertSystem(client, scope, "Billing API");
        await insertRow(client, scope, system, { usable: true, issues: [] });
      });
    }
  });

  it.each(TABLES)("%s shows each tenant only its own rows", async (table) => {
    const asA = await withTenantContextRaw(database, tenantA, (client) =>
      client.query<{ tenant_id: string }>(
        `select tenant_id from ${table} where tenant_id = any($1::uuid[])`,
        [[tenantA, tenantB]],
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

  it("rejects writing a System or row for another tenant", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertSystem(client, { tenant: tenantB, project: projectB }, "Other"),
      ),
    ).rejects.toThrow(/row-level security/);
    const systemB = await owner.query<{ id: string }>(
      "select id from inventory_systems where tenant_id = $1",
      [tenantB],
    );
    const systemBId = systemB.rows[0]?.id;
    if (!systemBId) throw new Error("tenant B System missing");
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertRow(client, { tenant: tenantB, project: projectB }, systemBId, {
          usable: true,
          issues: [],
          line: 3,
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects a System of tenant A that points at tenant B's Project", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertSystem(client, { tenant: tenantA, project: projectB }, "Cross"),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("cannot update or delete the other tenant's rows", async () => {
    const updated = await withTenantContextRaw(database, tenantA, (client) =>
      client.query(
        "update inventory_rows set owner = 'hijacked', revision = revision + 1 where tenant_id = $1",
        [tenantB],
      ),
    );
    expect(updated.rowCount).toBe(0);
    const deleted = await withTenantContextRaw(database, tenantA, (client) =>
      client.query("delete from inventory_rows where tenant_id = $1", [
        tenantB,
      ]),
    );
    expect(deleted.rowCount).toBe(0);
    expect(await ownerCount("inventory_rows", tenantB)).toBe(1);
    const counters = await withTenantContextRaw(database, tenantA, (client) =>
      client.query(
        "update inventory_systems set total_rows = 0, usable_rows = 0 where tenant_id = $1",
        [tenantB],
      ),
    );
    expect(counters.rowCount).toBe(0);
  });

  it("cannot delete the other tenant's System", async () => {
    const deleted = await withTenantContextRaw(database, tenantA, (client) =>
      client.query("delete from inventory_systems where tenant_id = $1", [
        tenantB,
      ]),
    );
    expect(deleted.rowCount).toBe(0);
    expect(await ownerCount("inventory_systems", tenantB)).toBe(1);
  });
});

describe("inventory constraints", () => {
  it("keeps one System per name within a Project but allows it in another Project", async () => {
    const scope = { tenant: tenantA, project: projectA2 };
    await withTenantContextRaw(database, tenantA, async (client) => {
      await insertSystem(client, scope, "Partner Portal");
      await insertSystem(
        client,
        { ...scope, project: projectA },
        "Partner Portal",
      );
    });
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertSystem(client, scope, " partner portal "),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("requires usable to match the absence of issues", async () => {
    const scope = { tenant: tenantA, project: projectA };
    const system = await withTenantContextRaw(database, tenantA, (client) =>
      insertSystem(client, scope, "Constraint System"),
    );
    for (const [usable, issues] of [
      [true, [{ column: "Version", code: "required" }]],
      [false, []],
    ] as const) {
      await expect(
        withTenantContextRaw(database, tenantA, (client) =>
          insertRow(client, scope, system, {
            usable,
            issues: [...issues],
            line: 9,
          }),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("removes rows with their System and everything with the Project", async () => {
    const scope = { tenant: tenantA, project: projectEdit };
    const system = await withTenantContextRaw(
      database,
      tenantA,
      async (client) => {
        const id = await insertSystem(client, scope, "Cascade System");
        await insertRow(client, scope, id, { usable: true, issues: [] });
        await insertRow(client, scope, id, {
          usable: false,
          issues: [{ column: "Version", code: "version_not_patch_level" }],
          line: 3,
        });
        return id;
      },
    );
    await withTenantContextRaw(database, tenantA, (client) =>
      client.query("delete from inventory_systems where id = $1", [system]),
    );
    const rows = await owner.query(
      "select 1 from inventory_rows where system_id = $1",
      [system],
    );
    expect(rows.rowCount).toBe(0);

    await owner.query("delete from projects where id = $1", [projectA2]);
    const left = await owner.query(
      "select 1 from inventory_systems where project_id = $1",
      [projectA2],
    );
    expect(left.rowCount).toBe(0);
  });
});

describe("inventory catalog", () => {
  it("enables and forces RLS with a restrictive guard and tenant policy per table", async () => {
    const flags = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relname = any($1::text[])`,
      [[...TABLES]],
    );
    expect(flags.rows).toHaveLength(TABLES.length);
    expect(
      flags.rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity),
    ).toEqual([]);
    const policies = await owner.query<{
      tablename: string;
      permissive: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, permissive, roles::text[] as roles, qual, with_check
       from pg_policies where tablename = any($1::text[])`,
      [[...TABLES]],
    );
    for (const table of TABLES) {
      const mine = policies.rows.filter(
        (r) => r.tablename === table && r.roles.includes("nightwatch"),
      );
      expect(mine.filter((r) => r.permissive === "RESTRICTIVE")).toHaveLength(
        1,
      );
      const permissive = mine.filter((r) => r.permissive === "PERMISSIVE");
      expect(permissive).toHaveLength(1);
      expect(permissive[0]?.qual).toContain("app.tenant_id");
      expect(permissive[0]?.with_check).toContain("app.tenant_id");
    }
  });

  it("grants the runtime role only what a replacement and a row edit need", async () => {
    const granted = async (table: string) =>
      (
        await owner.query<{ privilege: string }>(
          `select p as privilege from unnest(array['select','insert','update','delete','truncate','references','trigger']) as p
           where has_table_privilege('nightwatch', $1::regclass, p)`,
          [table],
        )
      ).rows.map((row) => row.privilege);
    expect(await granted("inventory_systems")).toEqual([
      "select",
      "insert",
      "delete",
    ]);
    expect(await granted("inventory_rows")).toEqual([
      "select",
      "insert",
      "delete",
    ]);
    const updatable = async (table: string) =>
      (
        await owner.query<{ column_name: string }>(
          `select column_name from information_schema.column_privileges
           where grantee = 'nightwatch' and table_name = $1 and privilege_type = 'UPDATE'
           order by column_name`,
          [table],
        )
      ).rows.map((row) => row.column_name);
    // Tenant, Project, System, line and the generated key are never rewritten.
    expect(await updatable("inventory_systems")).toEqual([
      "total_rows",
      "usable_rows",
    ]);
    expect(await updatable("inventory_rows")).toEqual([
      "changed_at",
      "changed_by",
      "environment",
      "exposure",
      "issues",
      "layer",
      "owner",
      "product",
      "revision",
      "source_file_name",
      "source_kind",
      "usable",
      "vendor",
      "version",
    ]);
  });

  it("records the inventory actions as audit actions", async () => {
    const result = await owner.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conname = 'audit_events_action_check'`,
    );
    for (const action of [
      "organization.project.inventory.upload",
      "organization.project.inventory.row.create",
      "organization.project.inventory.row.update",
      "organization.project.inventory.row.delete",
    ]) {
      expect(result.rows[0]?.definition).toContain(action);
    }
  });

  it("derives one case- and space-insensitive key per row and keeps duplicate keys of earlier uploads", async () => {
    const scope = { tenant: tenantA, project: projectEdit };
    await withTenantContextRaw(database, scope.tenant, async (client) => {
      const system = await insertSystem(client, scope, "Keys");
      await insertRow(client, scope, system, {
        usable: true,
        issues: [],
        line: 2,
      });
      await client.query(
        `insert into inventory_rows
           (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
            layer, environment, exposure, usable, source_kind, source_file_name, changed_by)
         values ($1, $2, $3, 3, 'ทีม B', ' CANONICAL ', 'ubuntu', '22.04.4',
            'OS', 'Production', 'Internal', true, 'manual', null, 'user-2')`,
        [scope.tenant, scope.project, system],
      );
      const keys = await client.query<{ row_key: string }>(
        "select row_key from inventory_rows where system_id = $1",
        [system],
      );
      expect(new Set(keys.rows.map((row) => row.row_key)).size).toBe(1);
    });
  });

  it("rejects a row whose source and file name disagree", async () => {
    const scope = { tenant: tenantA, project: projectEdit };
    await expect(
      withTenantContextRaw(database, scope.tenant, async (client) => {
        const system = await insertSystem(client, scope, "Bad source");
        await client.query(
          `insert into inventory_rows
             (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
              layer, environment, exposure, usable, source_kind, source_file_name, changed_by)
           values ($1, $2, $3, 2, 'x', 'v', 'p', '1.2.3', 'OS', 'Production', 'Internal',
              true, 'manual', 'file.xlsx', 'user-2')`,
          [scope.tenant, scope.project, system],
        );
      }),
    ).rejects.toThrow(/inventory_rows_source/);
  });
});
