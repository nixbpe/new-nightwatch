import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { openTestPostgres } from "./support/postgres";

const run = randomUUID().slice(0, 8);

describe("identifier mappings backfill from migration 0031", () => {
  it("queues each distinct usable vendor and product pair of an inventory uploaded under 0030", async () => {
    const legacy = await openTestPostgres(
      "mapping-backfill",
      "0030_project_inventory.sql",
    );
    try {
      const owner = legacy.owner.sql;
      const tenant = randomUUID();
      const project = randomUUID();
      const system = randomUUID();
      await owner.query(
        "insert into organization (id, name, slug) values ($1, 'Legacy', $2)",
        [tenant, `mapping-legacy-${run}`],
      );
      await owner.query(
        "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'p', $3)",
        [project, tenant, `mapping-legacy-${run}`],
      );
      await owner.query(
        `insert into inventory_systems (id, tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, $3, 'billing', 'Billing', 'inventory.csv', 'user', 4, 3)`,
        [system, tenant, project],
      );
      const rows: [number, string, string, boolean][] = [
        [2, "Redis", "Redis", true],
        [3, "REDIS", "redis", true],
        [4, "OpenSSL", "openssl", true],
        [5, "Rejected", "Thing", false],
      ];
      for (const [line, vendor, product, usable] of rows) {
        await owner.query(
          `insert into inventory_rows (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer, environment, exposure, usable, issues)
           values ($1, $2, $3, $4, 'team', $5, $6, '1.2.3', 'Middleware', 'Production', 'Internal', $7, $8::jsonb)`,
          [
            tenant,
            project,
            system,
            line,
            vendor,
            product,
            usable,
            JSON.stringify(usable ? [] : [{ column: "Version", code: "x" }]),
          ],
        );
      }

      await legacy.advanceTo("0031_identifier_mappings.sql");

      const mappings = await owner.query<{
        vendor_key: string;
        product_key: string;
        status: string;
        cpe: string | null;
      }>(
        `select vendor_key, product_key, status, cpe from inventory_mappings
         where project_id = $1 order by vendor_key, product_key`,
        [project],
      );
      expect(mappings.rows).toEqual([
        {
          vendor_key: "openssl",
          product_key: "openssl",
          status: "pending",
          cpe: null,
        },
        {
          vendor_key: "redis",
          product_key: "redis",
          status: "pending",
          cpe: null,
        },
      ]);
    } finally {
      await legacy.close();
    }
  }, 120_000);
});
