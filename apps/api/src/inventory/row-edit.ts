import {
  INVENTORY_ROWS_PAGE_SIZE,
  type inventoryRowsQuerySchema,
  type InventoryIssue,
  type InventoryRowCreate,
  type InventoryRowInput,
  type InventoryRowItem,
  type InventoryRowList,
  type InventoryRowUpdate,
  type OrganizationRole,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent } from "../audit/record";
import { withProjectAccess } from "../projects/service";
import { syncMappings } from "./mappings";
import { validateRow } from "./rows";
import type { InventoryDeps, ProjectIdentity } from "./service";

type RowRecord = {
  id: string;
  system_id: string;
  system_name: string;
  owner: string;
  vendor: string;
  product: string;
  version: string;
  layer: string;
  environment: string;
  exposure: string;
  usable: boolean;
  issues: InventoryIssue[];
  revision: number;
  row_key: string;
  duplicate: boolean;
  source_kind: "import" | "manual";
  source_file_name: string | null;
  changed_by_name: string | null;
  changed_at: Date;
};

// `duplicate` and every duplicate check use the generated `row_key` column, so rows are
// compared by one SQL definition (PostgreSQL `lower` and `btrim`). The mapping keys of F-018
// use the JavaScript `identityKey`; the two agree for ASCII and may differ for letters that
// the database locale does not lower-case.
const ROW_COLUMNS = `r.id, r.system_id, s.name as system_name, r.owner, r.vendor, r.product,
  r.version, r.layer, r.environment, r.exposure, r.usable, r.issues, r.revision, r.row_key,
  exists (select 1 from inventory_rows o
          where o.tenant_id = r.tenant_id and o.project_id = r.project_id
            and o.system_id = r.system_id and o.row_key = r.row_key and o.id <> r.id) as duplicate,
  r.source_kind, r.source_file_name, u.name as changed_by_name, r.changed_at,
  s.name_key, r.line_no`;
const ROW_FROM = `inventory_rows r join inventory_systems s on s.id = r.system_id
  left join "user" u on u.id = r.changed_by`;

const toItem = (row: RowRecord): InventoryRowItem => ({
  id: row.id,
  systemId: row.system_id,
  systemName: row.system_name,
  owner: row.owner,
  vendor: row.vendor,
  product: row.product,
  version: row.version,
  layer: row.layer,
  environment: row.environment,
  exposure: row.exposure,
  usable: row.usable,
  issues: row.issues,
  duplicate: row.duplicate,
  revision: row.revision,
  source: {
    kind: row.source_kind,
    fileName: row.source_file_name,
    changedBy: row.changed_by_name,
    changedAt: row.changed_at.toISOString(),
  },
});

const sourceLabel = (row: {
  source_kind: string;
  source_file_name: string | null;
}) =>
  row.source_kind === "import"
    ? `import จาก ${row.source_file_name ?? ""}`
    : "แก้ในระบบ";

function stale(): never {
  throw new AppError(
    409,
    "INVENTORY_ROW_STALE",
    "แถวนี้ถูกแก้หรือลบโดยคนอื่นหลังจากที่คุณเปิดหน้าต่างนี้ ไม่มีอะไรถูกบันทึก โหลดตารางใหม่แล้วทำรายการอีกครั้ง",
  );
}

function systemMissing(): never {
  throw new AppError(
    404,
    "INVENTORY_SYSTEM_NOT_FOUND",
    "ไม่พบ System นี้ อาจถูกลบโดยคนอื่น โหลดตารางใหม่แล้วเลือก System อีกครั้ง",
  );
}

export async function listRows(
  deps: InventoryDeps,
  input: ProjectIdentity,
  query: ReturnType<typeof inventoryRowsQuerySchema.parse>,
): Promise<InventoryRowList> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    async (client, { projectId }) => {
      const tenant = input.organizationId;
      const filters = [
        tenant,
        projectId,
        query.system ?? null,
        query.layer ?? null,
        query.status,
        query.q === undefined || query.q === "" ? null : query.q,
      ];
      const scoped = `select ${ROW_COLUMNS} from ${ROW_FROM}
        where r.tenant_id = $1 and r.project_id = $2`;
      const where = `where ($3::uuid is null or t.system_id = $3)
        and ($4::text is null or t.layer = $4)
        and ($5 = 'all' or ($5 = 'rejected' and not t.usable) or ($5 = 'duplicate' and t.duplicate))
        and ($6::text is null
             or position(lower($6) in lower(t.vendor)) > 0
             or position(lower($6) in lower(t.product)) > 0)`;
      const counted = await client.query<{ total: number }>(
        `select count(*)::int as total from (${scoped}) t ${where}`,
        filters,
      );
      const total = counted.rows[0]?.total ?? 0;
      const page = Math.min(
        query.page,
        Math.max(1, Math.ceil(total / INVENTORY_ROWS_PAGE_SIZE)),
      );
      const { rows } = await client.query<RowRecord>(
        `select t.* from (${scoped}) t ${where}
         order by t.name_key, t.line_no limit $7 offset $8`,
        [
          ...filters,
          INVENTORY_ROWS_PAGE_SIZE,
          (page - 1) * INVENTORY_ROWS_PAGE_SIZE,
        ],
      );
      return {
        rows: rows.map(toItem),
        total,
        page,
        pageSize: INVENTORY_ROWS_PAGE_SIZE,
      };
    },
  );
}

/** The same rules an upload applies (Q-01, Q-02), so a row saved here is a row a file could carry. */
export function checkedFields(systemName: string, fields: InventoryRowInput) {
  const row = validateRow({
    line: 0,
    cells: {
      System: systemName,
      Owner: fields.owner,
      Vendor: fields.vendor,
      Product: fields.product,
      Version: fields.version,
      Layer: fields.layer,
      Environment: fields.environment,
      Exposure: fields.exposure,
    },
  });
  if (row.issues.length > 0) {
    throw new AppError(
      400,
      "INVENTORY_ROW_INVALID",
      "แถวนี้ไม่ผ่านกฎของ inventory แก้ช่องที่ระบุแล้วบันทึกอีกครั้ง",
      { issues: row.issues },
    );
  }
  return row;
}

async function loadRow(
  client: PoolClient,
  tenant: string,
  project: string,
  id: string,
): Promise<InventoryRowItem> {
  const { rows } = await client.query<RowRecord>(
    `select ${ROW_COLUMNS} from ${ROW_FROM}
     where r.tenant_id = $1 and r.project_id = $2 and r.id = $3`,
    [tenant, project, id],
  );
  const row = rows[0];
  if (!row) stale();
  return toItem(row);
}

/**
 * Rows of one System may share a key only when an upload before F-022 kept them, so the
 * database cannot hold the rule as a unique index. Every writer holds the Project lock, so
 * checking after the write sees all other rows and the refusal rolls the write back.
 */
async function assertKeyFree(
  client: PoolClient,
  tenant: string,
  project: string,
  rowId: string,
): Promise<void> {
  const { rows } = await client.query<{
    vendor: string;
    product: string;
    version: string;
    owner: string;
    system_name: string;
    source_kind: string;
    source_file_name: string | null;
  }>(
    `select o.vendor, o.product, o.version, o.owner, s.name as system_name,
            o.source_kind, o.source_file_name
     from inventory_rows o join inventory_systems s on s.id = o.system_id
     where o.tenant_id = $1 and o.project_id = $2 and o.id <> $3
       and o.system_id = (select system_id from inventory_rows
                          where tenant_id = $1 and project_id = $2 and id = $3)
       and o.row_key = (select row_key from inventory_rows
                        where tenant_id = $1 and project_id = $2 and id = $3)
     order by o.line_no limit 1`,
    [tenant, project, rowId],
  );
  const other = rows[0];
  if (!other) return;
  throw new AppError(
    409,
    "INVENTORY_ROW_DUPLICATE",
    `ซ้ำกับแถวที่มีอยู่ใน System ${other.system_name}: ${other.vendor} ${other.product} ${other.version} (Owner ${other.owner}, ${sourceLabel(other)}) แก้แถวนั้นแทน หรือเปลี่ยน Vendor, Product หรือ Version`,
  );
}

// The System's counters are what the quality label (Q-03) and the summary read.
export async function recount(
  client: PoolClient,
  tenant: string,
  project: string,
  systemId: string,
): Promise<void> {
  await client.query(
    `update inventory_systems s
     set total_rows = c.total, usable_rows = c.usable
     from (select count(*)::int as total, (count(*) filter (where usable))::int as usable
           from inventory_rows
           where tenant_id = $1 and project_id = $2 and system_id = $3) c
     where s.tenant_id = $1 and s.project_id = $2 and s.id = $3`,
    [tenant, project, systemId],
  );
}

type Change = "create" | "update" | "delete";

async function finish(
  client: PoolClient,
  input: ProjectIdentity,
  context: { projectId: string; actorRole: OrganizationRole },
  change: Change,
  rowId: string,
  systemId: string,
): Promise<void> {
  const tenant = input.organizationId;
  await recount(client, tenant, context.projectId, systemId);
  // A usable row that appears, changes or goes changes the product queue at once (F-018).
  await syncMappings(client, tenant, context.projectId);
  await recordAuditEvent(client, {
    ...input,
    actorRole: context.actorRole,
    action: `organization.project.inventory.row.${change}`,
    target: {
      type: "project",
      id: context.projectId,
      attributes: { rowId, systemId },
    },
    changes: [],
  });
}

export function createRow(
  deps: InventoryDeps,
  input: ProjectIdentity,
  body: InventoryRowCreate,
): Promise<InventoryRowItem> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, context) => {
      const { projectId } = context;
      const tenant = input.organizationId;
      const system = await client.query<{ name: string }>(
        `select name from inventory_systems
       where tenant_id = $1 and project_id = $2 and id = $3`,
        [tenant, projectId, body.systemId],
      );
      const found = system.rows[0];
      if (!found) systemMissing();
      const row = checkedFields(found.name, body);
      const inserted = await client.query<{ id: string }>(
        `insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
          layer, environment, exposure, usable, issues, source_kind, changed_by)
       select $1, $2, $3, coalesce(max(line_no), 1) + 1, $4, $5, $6, $7, $8, $9, $10,
              true, '[]'::jsonb, 'manual', $11
       from inventory_rows where tenant_id = $1 and project_id = $2 and system_id = $3
       returning id`,
        [
          tenant,
          projectId,
          body.systemId,
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
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error("inventory row was not inserted");
      await assertKeyFree(client, tenant, projectId, id);
      await finish(client, input, context, "create", id, body.systemId);
      return loadRow(client, tenant, projectId, id);
    },
  );
}

const FIELDS = [
  "owner",
  "vendor",
  "product",
  "version",
  "layer",
  "environment",
  "exposure",
] as const;

type Stored = Record<(typeof FIELDS)[number], string> & {
  system_id: string;
  system_name: string;
  revision: number;
  row_key: string;
  usable: boolean;
};

async function storedRow(
  client: PoolClient,
  tenant: string,
  project: string,
  rowId: string,
  revision: number,
): Promise<Stored> {
  const { rows } = await client.query<Stored>(
    `select r.system_id, s.name as system_name, r.revision, r.row_key, r.usable,
            r.owner, r.vendor, r.product, r.version, r.layer, r.environment, r.exposure
     from inventory_rows r join inventory_systems s on s.id = r.system_id
     where r.tenant_id = $1 and r.project_id = $2 and r.id = $3`,
    [tenant, project, rowId],
  );
  // A row that is gone is as stale as a row that changed.
  const row = rows[0];
  if (!row || row.revision !== revision) stale();
  return row;
}

export function updateRow(
  deps: InventoryDeps,
  input: ProjectIdentity & { rowId: string },
  body: InventoryRowUpdate,
): Promise<InventoryRowItem> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, context) => {
      const { projectId } = context;
      const tenant = input.organizationId;
      const current = await storedRow(
        client,
        tenant,
        projectId,
        input.rowId,
        body.revision,
      );
      const row = checkedFields(current.system_name, body);
      // Saving what is already stored changes nothing: no new revision, source or audit event.
      if (
        current.usable &&
        FIELDS.every((field) => row[field] === current[field])
      ) {
        return loadRow(client, tenant, projectId, input.rowId);
      }
      const updated = await client.query<{ row_key: string }>(
        `update inventory_rows
       set owner = $4, vendor = $5, product = $6, version = $7, layer = $8,
           environment = $9, exposure = $10, usable = true, issues = '[]'::jsonb,
           revision = revision + 1, source_kind = 'manual', source_file_name = null, source_line = null,
           changed_by = $11, changed_at = now()
       where tenant_id = $1 and project_id = $2 and id = $3
       returning row_key`,
        [
          tenant,
          projectId,
          input.rowId,
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
      // A row that keeps its key (an earlier upload may have left a twin) is not a new clash.
      if (updated.rows[0]?.row_key !== current.row_key) {
        await assertKeyFree(client, tenant, projectId, input.rowId);
      }
      await finish(
        client,
        input,
        context,
        "update",
        input.rowId,
        current.system_id,
      );
      return loadRow(client, tenant, projectId, input.rowId);
    },
  );
}

export function deleteRow(
  deps: InventoryDeps,
  input: ProjectIdentity & { rowId: string },
  revision: number,
): Promise<void> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, context) => {
      const { projectId } = context;
      const tenant = input.organizationId;
      const current = await storedRow(
        client,
        tenant,
        projectId,
        input.rowId,
        revision,
      );
      await client.query(
        "delete from inventory_rows where tenant_id = $1 and project_id = $2 and id = $3",
        [tenant, projectId, input.rowId],
      );
      await finish(
        client,
        input,
        context,
        "delete",
        input.rowId,
        current.system_id,
      );
    },
  );
}
