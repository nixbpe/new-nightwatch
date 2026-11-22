import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, runMigrations, withTenantContextRaw } from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "identifier mapping tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = randomUUID().slice(0, 8);
const tenantA = randomUUID();
const tenantB = randomUUID();
const projectA = randomUUID();
const projectB = randomUUID();
const catalogProduct = `catalog-${run}`;

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
      [id, `map-${label}-${run}`, `map-${label}-${run}-${id}`],
    );
  }
  for (const [project, tenant, slug] of [
    [projectA, tenantA, "map-a"],
    [projectB, tenantB, "map-b"],
  ] as const) {
    await owner.query(
      "insert into projects (id, tenant_id, name, slug) values ($1, $2, $3, $4)",
      [project, tenant, slug, `${slug}-${run}`],
    );
  }
  await owner.query(
    "insert into catalog_product_mappings (vendor_key, product_key, cpe) values ('f5', $1, 'cpe:2.3:a:f5:big-ip:*:*:*:*:*:*:*:*')",
    [catalogProduct],
  );
}, 60_000);

afterAll(async () => {
  await owner.query(
    "delete from catalog_product_mappings where product_key = $1",
    [catalogProduct],
  );
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [tenantA, tenantB],
  ]);
  await owner.end();
  await database.close();
});

type Scope = { tenant: string; project: string };
type Fields = {
  status?: string;
  cpe?: string | null;
  purl?: string | null;
  confidence?: number | null;
  source?: string | null;
  confirmedAt?: boolean;
  key?: string;
};

function insertMapping(
  client: { query: Client["query"] },
  scope: Scope,
  fields: Fields = {},
) {
  const status = fields.status ?? "pending";
  const confirmed = fields.confirmedAt ?? status !== "pending";
  return client.query(
    `insert into inventory_mappings
       (tenant_id, project_id, vendor_key, product_key, vendor, product, status,
        cpe, purl, confidence, source, confirmed_by, confirmed_at)
     values ($1, $2, 'f5', $3, 'F5', 'BIG-IP', $4, $5, $6, $7, $8,
        case when $9::boolean then 'user-1' end,
        case when $9::boolean then now() end)`,
    [
      scope.tenant,
      scope.project,
      fields.key ?? randomUUID(),
      status,
      fields.cpe ?? null,
      fields.purl ?? null,
      fields.confidence ?? null,
      fields.source ?? null,
      confirmed,
    ],
  );
}

describe("inventory_mappings tenant isolation", () => {
  beforeAll(async () => {
    for (const scope of [
      { tenant: tenantA, project: projectA },
      { tenant: tenantB, project: projectB },
    ]) {
      await withTenantContextRaw(database, scope.tenant, (client) =>
        insertMapping(client, scope),
      );
    }
  });

  it("shows each tenant only its own rows and nothing without a context", async () => {
    const asA = await withTenantContextRaw(database, tenantA, (client) =>
      client.query<{ tenant_id: string }>(
        "select tenant_id from inventory_mappings where tenant_id = any($1::uuid[])",
        [[tenantA, tenantB]],
      ),
    );
    expect(asA.rows.map((row) => row.tenant_id)).toEqual([tenantA]);
    const bare = await database.sql.query(
      "select 1 from inventory_mappings where tenant_id = any($1::uuid[])",
      [[tenantA, tenantB]],
    );
    expect(bare.rows).toEqual([]);
  });

  it("rejects writing for another tenant or into another tenant's Project", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertMapping(client, { tenant: tenantB, project: projectB }),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertMapping(client, { tenant: tenantA, project: projectB }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("cannot update or delete another tenant's mapping", async () => {
    const result = await withTenantContextRaw(
      database,
      tenantA,
      async (client) => ({
        updated: await client.query(
          "update inventory_mappings set updated_at = now() where tenant_id = $1",
          [tenantB],
        ),
        deleted: await client.query(
          "delete from inventory_mappings where tenant_id = $1",
          [tenantB],
        ),
      }),
    );
    expect([result.updated.rowCount, result.deleted.rowCount]).toEqual([0, 0]);
  });

  it("keeps one mapping per vendor and product pair in a Project", async () => {
    const scope = { tenant: tenantA, project: projectA };
    await withTenantContextRaw(database, tenantA, (client) =>
      insertMapping(client, scope, { key: "once" }),
    );
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertMapping(client, scope, { key: "once" }),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("inventory_mappings states", () => {
  const scope = { tenant: tenantA, project: projectA };
  const CPE =
    "cpe:2.3:a:f5:big-ip_local_traffic_manager:17.1.1.3:*:*:*:*:*:*:*";
  const insert = (fields: Fields) =>
    withTenantContextRaw(database, tenantA, (client) =>
      insertMapping(client, scope, fields),
    );

  it.each([
    [
      "confirmed without a CPE or purl",
      { status: "confirmed", source: "manual" },
    ],
    ["confirmed without a source", { status: "confirmed", cpe: CPE }],
    ["unmapped but carrying a CPE", { status: "unmapped", cpe: CPE }],
    [
      "pending but already confirmed",
      { status: "pending", cpe: CPE, confirmedAt: true },
    ],
    [
      "pending with both a CPE and a purl",
      { status: "pending", cpe: CPE, purl: "pkg:deb/ubuntu/openssl" },
    ],
    ["a CPE of another format", { status: "pending", cpe: "cpe:/a:f5:big-ip" }],
    [
      "a purl of another format",
      { status: "pending", purl: "deb/ubuntu/openssl" },
    ],
    ["a confidence above 1", { status: "pending", cpe: CPE, confidence: 1.5 }],
    ["an unknown source", { status: "confirmed", cpe: CPE, source: "guess" }],
  ] as const)("rejects %s", async (_name, fields) => {
    await expect(insert(fields)).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    [
      "a pending suggestion with confidence",
      { status: "pending", cpe: CPE, confidence: 0.82, source: "nvd" },
    ],
    ["a confirmed CPE", { status: "confirmed", cpe: CPE, source: "manual" }],
    [
      "a confirmed purl",
      {
        status: "confirmed",
        purl: "pkg:deb/ubuntu/openssl@3.0.2",
        source: "manual",
      },
    ],
    [
      "a central confirmed CPE",
      { status: "confirmed", cpe: CPE, source: "central" },
    ],
    ["an unmapped pair", { status: "unmapped" }],
  ] as const)("accepts %s", async (_name, fields) => {
    await expect(insert(fields)).resolves.toBeDefined();
  });
});

describe("catalog_product_mappings", () => {
  it("is readable by every tenant and by none without a context", async () => {
    for (const tenant of [tenantA, tenantB]) {
      const rows = await withTenantContextRaw(database, tenant, (client) =>
        client.query(
          "select cpe from catalog_product_mappings where product_key = $1",
          [catalogProduct],
        ),
      );
      expect(rows.rows).toEqual([
        { cpe: "cpe:2.3:a:f5:big-ip:*:*:*:*:*:*:*:*" },
      ]);
    }
    const bare = await database.sql.query(
      "select 1 from catalog_product_mappings where product_key = $1",
      [catalogProduct],
    );
    expect(bare.rows).toEqual([]);
  });

  it("is never writable from the runtime role, even inside a context", async () => {
    for (const sql of [
      "insert into catalog_product_mappings (vendor_key, product_key, cpe) values ('x', 'y', 'cpe:2.3:a:x:y:*:*:*:*:*:*:*:*')",
      "update catalog_product_mappings set cpe = 'cpe:2.3:a:x:y:*:*:*:*:*:*:*:*'",
      "delete from catalog_product_mappings",
    ]) {
      await expect(
        withTenantContextRaw(database, tenantA, (client) => client.query(sql)),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("holds only a vendor and product pair and its identifier", async () => {
    const columns = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'catalog_product_mappings'
       order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "cpe",
      "created_at",
      "product_key",
      "purl",
      "vendor_key",
    ]);
    await expect(
      owner.query(
        "insert into catalog_product_mappings (vendor_key, product_key) values ('x', $1)",
        [`empty-${run}`],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("identifier mapping catalog", () => {
  it("forces RLS with a guard and tenant policy and grants only what is used", async () => {
    const flags = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relnamespace = 'public'::regnamespace
         and relname in ('inventory_mappings', 'catalog_product_mappings')`,
    );
    expect(flags.rows).toHaveLength(2);
    expect(
      flags.rows.filter(
        (row) => !row.relrowsecurity || !row.relforcerowsecurity,
      ),
    ).toEqual([]);
    const granted = async (table: string) =>
      (
        await owner.query<{ privilege: string }>(
          `select p as privilege from unnest(array['select','insert','update','delete','truncate']) as p
           where has_table_privilege('nightwatch', $1::regclass, p)`,
          [table],
        )
      ).rows.map((row) => row.privilege);
    expect(await granted("inventory_mappings")).toEqual([
      "select",
      "insert",
      "delete",
    ]);
    expect(await granted("catalog_product_mappings")).toEqual(["select"]);
  });

  it("records a mapping update as an audit action", async () => {
    const result = await owner.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conname = 'audit_events_action_check'`,
    );
    expect(result.rows[0]?.definition).toContain(
      "organization.project.inventory.mapping.update",
    );
  });
});
