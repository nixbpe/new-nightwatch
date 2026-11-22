import {
  INVENTORY_IMPORTS_PAGE_SIZE,
  type InventoryImportList,
  type inventoryImportsQuerySchema,
} from "@nightwatch/api-contract";

import { withProjectAccess } from "../projects/service";
import type { InventoryDeps, ProjectIdentity } from "./service";

type ImportRecord = {
  id: string;
  file_name: string;
  imported_at: Date;
  imported_by_name: string | null;
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
};

/**
 * The confirmed imports of the Project, newest first (S7.5). Equal times order by id, so a page
 * boundary never repeats or drops a record. The importer is read by id and is null once the
 * account is gone. A record holds counts and a file name, never the file.
 */
export function listImports(
  deps: InventoryDeps,
  input: ProjectIdentity,
  query: ReturnType<typeof inventoryImportsQuerySchema.parse>,
): Promise<InventoryImportList> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    async (client, { projectId }) => {
      const tenant = input.organizationId;
      const counted = await client.query<{ total: number }>(
        `select count(*)::int as total from inventory_imports
         where tenant_id = $1 and project_id = $2`,
        [tenant, projectId],
      );
      const total = counted.rows[0]?.total ?? 0;
      const page = Math.min(
        query.page,
        Math.max(1, Math.ceil(total / INVENTORY_IMPORTS_PAGE_SIZE)),
      );
      const { rows } = await client.query<ImportRecord>(
        `select i.id, i.file_name, i.imported_at, u.name as imported_by_name,
                i.added, i.updated, i.unchanged, i.skipped, i.failed
         from inventory_imports i left join "user" u on u.id = i.imported_by
         where i.tenant_id = $1 and i.project_id = $2
         order by i.imported_at desc, i.id desc limit $3 offset $4`,
        [
          tenant,
          projectId,
          INVENTORY_IMPORTS_PAGE_SIZE,
          (page - 1) * INVENTORY_IMPORTS_PAGE_SIZE,
        ],
      );
      return {
        imports: rows.map((row) => ({
          id: row.id,
          fileName: row.file_name,
          importedAt: row.imported_at.toISOString(),
          importedBy: row.imported_by_name,
          added: row.added,
          updated: row.updated,
          unchanged: row.unchanged,
          skipped: row.skipped,
          failed: row.failed,
        })),
        total,
        page,
        pageSize: INVENTORY_IMPORTS_PAGE_SIZE,
      };
    },
  );
}
