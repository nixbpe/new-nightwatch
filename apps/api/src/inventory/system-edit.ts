import type {
  InventorySystem,
  InventorySystemCreate,
  InventorySystemRename,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent } from "../audit/record";
import { withProjectAccess } from "../projects/service";
import { syncMappings } from "./mappings";
import { checkedFields } from "./row-edit";
import { validateSystemName } from "./rows";
import {
  SYSTEM_COLUMNS,
  toSystem,
  type InventoryDeps,
  type ProjectIdentity,
} from "./service";

type SystemRecord = Parameters<typeof toSystem>[0];

function nameTaken(name: string): never {
  throw new AppError(
    409,
    "INVENTORY_SYSTEM_NAME_TAKEN",
    `มี System ชื่อ ${name} ใน Project นี้แล้ว (ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้าย) ใช้ชื่ออื่น`,
  );
}

// A missing System is as stale as a changed one: an upload replaces a System with a new id.
function stale(): never {
  throw new AppError(
    409,
    "INVENTORY_SYSTEM_STALE",
    "System นี้ถูกเปลี่ยนชื่อ ลบ หรือแทนที่ด้วยการ upload โดยคนอื่น หรือจำนวนแถวเปลี่ยนไป หลังจากที่คุณเปิดหน้านี้ ไม่มีอะไรถูกบันทึก โหลดหน้าใหม่แล้วทำรายการอีกครั้ง",
  );
}

async function loadSystem(
  client: PoolClient,
  tenant: string,
  project: string,
  id: string,
): Promise<InventorySystem> {
  const { rows } = await client.query<SystemRecord>(
    `select ${SYSTEM_COLUMNS} from inventory_systems s
     where s.tenant_id = $1 and s.project_id = $2 and s.id = $3`,
    [tenant, project, id],
  );
  const row = rows[0];
  if (!row) stale();
  return toSystem(row);
}

/**
 * The Project-wide name rule: one System per trimmed, case-insensitive name. Every writer holds
 * the Project lock, so a name free here is still free at the insert or update, and the unique
 * index is only the backstop.
 */
async function assertNameFree(
  client: PoolClient,
  tenant: string,
  project: string,
  key: string,
  name: string,
  ownId: string | null,
): Promise<void> {
  const { rows } = await client.query(
    `select 1 from inventory_systems
     where tenant_id = $1 and project_id = $2 and name_key = $3
       and ($4::uuid is null or id <> $4)`,
    [tenant, project, key, ownId],
  );
  if (rows.length > 0) nameTaken(name);
}

export function createSystem(
  deps: InventoryDeps,
  input: ProjectIdentity,
  body: InventorySystemCreate,
): Promise<InventorySystem> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId, actorRole }) => {
      const tenant = input.organizationId;
      // The first row follows the rules of any row, and the name those of the System column.
      const row = checkedFields(body.name, body);
      await assertNameFree(
        client,
        tenant,
        projectId,
        row.systemKey,
        row.system,
        null,
      );
      const system = await client.query<{ id: string }>(
        `insert into inventory_systems
           (tenant_id, project_id, name_key, name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, $3, $4, $5, 1, 1) returning id`,
        [tenant, projectId, row.systemKey, row.system, input.actorUserId],
      );
      const systemId = system.rows[0]?.id;
      if (!systemId) throw new Error("inventory system was not inserted");
      const inserted = await client.query<{ id: string }>(
        `insert into inventory_rows
           (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
            layer, environment, exposure, usable, issues, source_kind, changed_by)
         values ($1, $2, $3, 2, $4, $5, $6, $7, $8, $9, $10, true, '[]'::jsonb, 'manual', $11)
         returning id`,
        [
          tenant,
          projectId,
          systemId,
          row.owner,
          row.vendor,
          row.product,
          row.version,
          row.layer,
          row.environment,
          row.exposure,
          input.actorUserId,
        ],
      );
      await syncMappings(client, tenant, projectId);
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action: "organization.project.inventory.system.create",
        target: {
          type: "project",
          id: projectId,
          attributes: { systemId, rowId: inserted.rows[0]?.id },
        },
        changes: [],
      });
      return loadSystem(client, tenant, projectId, systemId);
    },
  );
}

export function renameSystem(
  deps: InventoryDeps,
  input: ProjectIdentity & { systemId: string },
  body: InventorySystemRename,
): Promise<InventorySystem> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId, actorRole }) => {
      const tenant = input.organizationId;
      const current = await client.query<{ name: string; revision: number }>(
        `select name, revision from inventory_systems
         where tenant_id = $1 and project_id = $2 and id = $3`,
        [tenant, projectId, input.systemId],
      );
      const found = current.rows[0];
      if (!found || found.revision !== body.revision) stale();
      const next = validateSystemName(body.name);
      if (next.issues.length > 0) {
        throw new AppError(
          400,
          "INVENTORY_ROW_INVALID",
          "ชื่อ System ไม่ผ่านกฎของ inventory แก้ชื่อแล้วบันทึกอีกครั้ง",
          { issues: next.issues },
        );
      }
      // The same name again changes nothing: no new revision and no audit event.
      if (next.name === found.name) {
        return loadSystem(client, tenant, projectId, input.systemId);
      }
      // The System's own key is excluded, so a change of case or spacing alone is a rename.
      await assertNameFree(
        client,
        tenant,
        projectId,
        next.key,
        next.name,
        input.systemId,
      );
      await client.query(
        `update inventory_systems
         set name = $4, name_key = $5, revision = revision + 1
         where tenant_id = $1 and project_id = $2 and id = $3`,
        [tenant, projectId, input.systemId, next.name, next.key],
      );
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action: "organization.project.inventory.system.rename",
        target: {
          type: "project",
          id: projectId,
          attributes: { systemId: input.systemId },
        },
        changes: [],
      });
      return loadSystem(client, tenant, projectId, input.systemId);
    },
  );
}

/**
 * Deleting a System removes its rows by cascade, so the product queue follows exactly as it
 * does when every row is deleted one by one (F-018), and the results and VEX of a product no
 * usable row uses any more go with its mapping. The count the confirmation named must still
 * be the count under the lock.
 */
export function deleteSystem(
  deps: InventoryDeps,
  input: ProjectIdentity & { systemId: string },
  expected: { revision: number; rows: number },
): Promise<void> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId, actorRole }) => {
      const tenant = input.organizationId;
      const current = await client.query<{ revision: number; rows: number }>(
        `select s.revision,
                (select count(*)::int from inventory_rows r where r.system_id = s.id) as rows
         from inventory_systems s
         where s.tenant_id = $1 and s.project_id = $2 and s.id = $3`,
        [tenant, projectId, input.systemId],
      );
      const found = current.rows[0];
      if (
        !found ||
        found.revision !== expected.revision ||
        found.rows !== expected.rows
      ) {
        stale();
      }
      await client.query(
        "delete from inventory_systems where tenant_id = $1 and project_id = $2 and id = $3",
        [tenant, projectId, input.systemId],
      );
      await syncMappings(client, tenant, projectId);
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action: "organization.project.inventory.system.delete",
        target: {
          type: "project",
          id: projectId,
          attributes: { systemId: input.systemId, rows: found.rows },
        },
        changes: [],
      });
    },
  );
}
