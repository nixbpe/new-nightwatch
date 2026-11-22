import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { openTestPostgres } from "./support/postgres";

// F-022 S7.5: a row written by an upload before 0038 keeps the file name, the uploader and the
// time of that upload as its provenance, and the file line the rejected-rows download prints.
describe("inventory row provenance backfill (0038, 0040)", () => {
  it("gives a row of an earlier upload its System's file name, uploader and upload time", async () => {
    const legacy = await openTestPostgres(
      "inventory-provenance-backfill",
      "0037_email_job_maintenance.sql",
    );
    const errors: unknown[] = [];
    try {
      const db = legacy.owner.sql;
      const tenant = randomUUID();
      const project = randomUUID();
      const system = randomUUID();
      await db.query(
        "insert into organization (id, name, slug) values ($1, 'Legacy', $2)",
        [tenant, `legacy-${tenant}`],
      );
      await db.query(
        "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'Legacy project', 'legacy-project')",
        [project, tenant],
      );
      await db.query(
        `insert into inventory_systems
           (id, tenant_id, project_id, name_key, name, file_name, uploaded_by, uploaded_at, total_rows, usable_rows)
         values ($1, $2, $3, 'billing', 'Billing', 'q3-upload.xlsx', 'uploader-id', '2026-01-02T03:04:05Z', 1, 1)`,
        [system, tenant, project],
      );
      await db.query(
        `insert into inventory_rows
           (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
            environment, exposure, usable)
         values ($1, $2, $3, 7, 'ทีม A', 'Canonical', 'Ubuntu', '22.04.4', 'OS', 'Production',
                 'Internal', true)`,
        [tenant, project, system],
      );

      await legacy.advanceTo("0040_inventory_import_preview.sql");

      const row = await db.query<{
        source_kind: string;
        source_file_name: string;
        changed_by: string;
        changed_at: Date;
        source_line: number;
        line_no: number;
      }>(
        `select source_kind, source_file_name, changed_by, changed_at, source_line, line_no
         from inventory_rows where project_id = $1`,
        [project],
      );
      expect(row.rows).toEqual([
        {
          source_kind: "import",
          source_file_name: "q3-upload.xlsx",
          changed_by: "uploader-id",
          changed_at: new Date("2026-01-02T03:04:05Z"),
          source_line: 7,
          line_no: 7,
        },
      ]);
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await legacy.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length)
      throw new AggregateError(errors, "legacy assertions and cleanup failed");
  }, 240_000);
});
