import type {
  InventoryImportCounts,
  InventoryImportPending,
  InventoryImportPreview,
  InventoryImportResult,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent } from "../audit/record";
import { withProjectAccess } from "../projects/service";
import { parseInventoryFile } from "./file";
import {
  planImport,
  type ExistingRow,
  type ExistingSystem,
  type ImportPlan,
  type PlanRow,
} from "./import-plan";
import { syncMappings } from "./mappings";
import { inventoryFileRejected } from "./messages";
import { recount } from "./row-edit";
import { validateRow, type InventoryRow } from "./rows";
import type { InventoryDeps, ProjectIdentity } from "./service";

type PreviewRecord = {
  id: string;
  file_name: string;
  created_at: Date;
  expires_at: Date;
  expired: boolean;
  summary: Omit<
    InventoryImportPreview,
    "id" | "fileName" | "createdAt" | "expiresAt"
  >;
};

const ABSENT = "absent";

// The file name is shown back to members, so it is reduced to a plain name.
function displayName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base.replace(/\p{Cc}/gu, " ").trim())
    .slice(0, 255)
    .join("");
  return clean === "" ? "inventory" : clean;
}

async function limitImports(deps: InventoryDeps, input: ProjectIdentity) {
  if (!deps.rateLimiter) {
    throw new AppError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "บริการ import inventory ยังไม่พร้อม",
    );
  }
  return deps.rateLimiter.consumeRateLimits({
    windowMs: 60_000,
    limits: [
      {
        key: `rl:inventory-import:u:${input.actorUserId}:p:${input.projectId.toLowerCase()}`,
        limit: 10,
      },
      {
        key: `rl:inventory-import:o:${input.organizationId.toLowerCase()}`,
        limit: 60,
      },
    ],
  });
}

/** Unseen Projects answer 404 and non-maintainers 403; the route runs it before the body is parsed. */
export function authorizeImport(deps: InventoryDeps, input: ProjectIdentity) {
  return withProjectAccess(deps.database, input, "inventory.write", false, () =>
    Promise.resolve(),
  );
}

function notFound(): never {
  throw new AppError(
    404,
    "INVENTORY_PREVIEW_NOT_FOUND",
    "ไม่พบ preview นี้ อาจถูกยกเลิก ยืนยันไปแล้ว หมดอายุ หรือแทนที่ด้วยไฟล์ใหม่ เลือกไฟล์ใหม่เพื่อสร้าง preview",
  );
}

function expired(): never {
  throw new AppError(
    409,
    "INVENTORY_PREVIEW_EXPIRED",
    "preview หมดอายุแล้ว (เกิน 30 นาที) ไม่มีข้อมูลใดถูกนำเข้า เลือกไฟล์ใหม่เพื่อสร้าง preview",
  );
}

function stale(): never {
  throw new AppError(
    409,
    "INVENTORY_PREVIEW_STALE",
    "inventory ของ System ในไฟล์นี้เปลี่ยนไปหลังจากสร้าง preview ไม่มีข้อมูลใดถูกนำเข้า เลือกไฟล์อีกครั้งเพื่อสร้าง preview ใหม่ แล้วตรวจก่อนยืนยัน",
  );
}

/** A preview belongs to one person: the user context lets the policy hide every other one. */
async function asUser(client: PoolClient, userId: string) {
  await client.query("select set_config('app.user_id', $1, true)", [userId]);
}

/**
 * The key the database gives a row (`inventory_rows.row_key`), so a row of the file and a stored
 * row are compared by one definition (see the note on ROW_COLUMNS in row-edit.ts).
 */
async function withKeys(
  client: PoolClient,
  rows: InventoryRow[],
): Promise<PlanRow[]> {
  const { rows: keys } = await client.query<{ key: string }>(
    `select lower(btrim(t.vendor)) || E'\\x01' || lower(btrim(t.product)) || E'\\x01' || lower(btrim(t.version)) as key
     from unnest($1::text[], $2::text[], $3::text[]) with ordinality as t(vendor, product, version, n)
     order by t.n`,
    [
      rows.map((row) => row.vendor),
      rows.map((row) => row.product),
      rows.map((row) => row.version),
    ],
  );
  return rows.map((row, index) => ({ ...row, key: keys[index]?.key ?? "" }));
}

type Inventory = {
  systems: Map<string, ExistingSystem>;
  fingerprints: Map<string, string>;
  existing: ExistingRow[];
};

/**
 * What the file is merged into: the Systems it names, their rows, and a fingerprint of each
 * System (its id, name, revision and every row's id and revision), so any row edit, delete or
 * add, rename, delete or import of that System changes it.
 */
async function loadInventory(
  client: PoolClient,
  tenant: string,
  project: string,
  systemKeys: string[],
): Promise<Inventory> {
  const found = await client.query<{
    id: string;
    name: string;
    name_key: string;
    fingerprint: string;
  }>(
    `select s.id, s.name, s.name_key,
            md5(s.id::text || '|' || s.name || '|' || s.revision::text || '|' || coalesce(
              (select string_agg(r.id::text || ':' || r.revision::text, ',' order by r.id)
               from inventory_rows r where r.system_id = s.id), '')) as fingerprint
     from inventory_systems s
     where s.tenant_id = $1 and s.project_id = $2 and s.name_key = any($3::text[])`,
    [tenant, project, systemKeys],
  );
  const rows = await client.query<
    Omit<ExistingRow, "systemKey" | "key"> & { system_key: string; key: string }
  >(
    `select r.id, s.name_key as system_key, r.row_key as key, r.usable, r.owner, r.vendor,
            r.product, r.version, r.layer, r.environment, r.exposure, r.issues
     from inventory_rows r join inventory_systems s on s.id = r.system_id
     where r.tenant_id = $1 and r.project_id = $2 and s.name_key = any($3::text[])`,
    [tenant, project, systemKeys],
  );
  return {
    systems: new Map(
      found.rows.map((row) => [row.name_key, { id: row.id, name: row.name }]),
    ),
    fingerprints: new Map(
      found.rows.map((row) => [row.name_key, row.fingerprint]),
    ),
    existing: rows.rows.map(({ system_key: systemKey, ...row }) => ({
      ...row,
      systemKey,
    })),
  };
}

const systemKeys = (rows: InventoryRow[]) => [
  ...new Set(rows.map((row) => row.systemKey)),
];

function toPreview(record: PreviewRecord): InventoryImportPreview {
  return {
    id: record.id,
    fileName: record.file_name,
    createdAt: record.created_at.toISOString(),
    expiresAt: record.expires_at.toISOString(),
    ...record.summary,
  };
}

// clock_timestamp(), not now(): a request that waited for the Project lock must see the time it
// runs, not the time its transaction began.
const PREVIEW_COLUMNS = `id, file_name, created_at, expires_at, expires_at <= clock_timestamp() as expired, summary`;

/**
 * Reads the file into a preview and changes no inventory (Q-19). A file that does not match the
 * template is refused whole and leaves the person's earlier preview alone. A new preview
 * replaces the person's pending one for the Project.
 */
export async function createImportPreview(
  deps: InventoryDeps,
  input: ProjectIdentity,
  file: { name: string; bytes: Uint8Array },
): Promise<InventoryImportPreview | { retryAfterSeconds: number }> {
  const limit = await limitImports(deps, input);
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };
  const fileName = displayName(file.name);
  // Parsing is CPU work on untrusted bytes, so it runs outside the transaction (REQ-01).
  const parsed = await parseInventoryFile(fileName, file.bytes);
  if (!parsed.ok) throw inventoryFileRejected(fileName, parsed.rejection);
  const rows = parsed.rows.map(validateRow);
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId }) => {
      const tenant = input.organizationId;
      await asUser(client, input.actorUserId);
      const keys = systemKeys(rows);
      const inventory = await loadInventory(client, tenant, projectId, keys);
      const plan = planImport(
        await withKeys(client, rows),
        inventory.existing,
        inventory.systems,
      );
      const fingerprints = Object.fromEntries(
        plan.systemKeys.map((key) => [
          key,
          inventory.fingerprints.get(key) ?? ABSENT,
        ]),
      );
      await client.query(
        "delete from inventory_previews where tenant_id = $1 and project_id = $2 and created_by = $3",
        [tenant, projectId, input.actorUserId],
      );
      const inserted = await client.query<PreviewRecord>(
        `insert into inventory_previews
           (tenant_id, project_id, created_by, file_name, rows, summary, fingerprints)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         returning ${PREVIEW_COLUMNS}`,
        [
          tenant,
          projectId,
          input.actorUserId,
          fileName,
          JSON.stringify(rows),
          JSON.stringify({ totals: plan.totals, ...plan.preview }),
          JSON.stringify(fingerprints),
        ],
      );
      const record = inserted.rows[0];
      if (!record) throw new Error("inventory preview was not inserted");
      return toPreview(record);
    },
  );
}

/** The caller's own pending preview; another person's, and an expired one, are not there. */
export function getImportPreview(
  deps: InventoryDeps,
  input: ProjectIdentity,
): Promise<InventoryImportPending> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    false,
    async (client, { projectId }) => {
      await asUser(client, input.actorUserId);
      const { rows } = await client.query<PreviewRecord>(
        `select ${PREVIEW_COLUMNS} from inventory_previews
         where tenant_id = $1 and project_id = $2 and created_by = $3 and expires_at > clock_timestamp()`,
        [input.organizationId, projectId, input.actorUserId],
      );
      return { preview: rows[0] ? toPreview(rows[0]) : null };
    },
  );
}

export function cancelImportPreview(
  deps: InventoryDeps,
  input: ProjectIdentity & { previewId: string },
): Promise<void> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    false,
    async (client, { projectId }) => {
      await asUser(client, input.actorUserId);
      const { rowCount } = await client.query(
        `delete from inventory_previews
         where tenant_id = $1 and project_id = $2 and id = $3 and created_by = $4`,
        [input.organizationId, projectId, input.previewId, input.actorUserId],
      );
      if (rowCount === 0) notFound();
    },
  );
}

async function apply(
  client: PoolClient,
  input: ProjectIdentity,
  project: string,
  fileName: string,
  plan: ImportPlan,
  known: Map<string, ExistingSystem>,
): Promise<Map<string, string>> {
  const tenant = input.organizationId;
  const ids = new Map([...known].map(([key, system]) => [key, system.id]));
  const created = plan.systemKeys
    .map((key, index) => ({ key, system: plan.preview.systems[index] }))
    .filter((entry) => entry.system?.created);
  if (created.length > 0) {
    const inserted = await client.query<{ id: string; name_key: string }>(
      `insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
       select $1, $2, s.key, s.name, $3, $4, 0, 0
       from unnest($5::text[], $6::text[]) as s(key, name)
       returning id, name_key`,
      [
        tenant,
        project,
        fileName,
        input.actorUserId,
        created.map((entry) => entry.key),
        created.map((entry) => entry.system?.name),
      ],
    );
    for (const row of inserted.rows) ids.set(row.name_key, row.id);
  }
  const idOf = (key: string) => {
    const id = ids.get(key);
    if (!id) throw new Error("inventory import has no System for a row");
    return id;
  };
  const columns = (rows: PlanRow[]) => [
    rows.map((row) => row.owner),
    rows.map((row) => row.vendor),
    rows.map((row) => row.product),
    rows.map((row) => row.version),
    rows.map((row) => row.layer),
    rows.map((row) => row.environment),
    rows.map((row) => row.exposure),
    rows.map((row) => JSON.stringify(row.issues)),
  ];
  if (plan.updates.length > 0) {
    await client.query(
      `update inventory_rows r
       set owner = u.owner, vendor = u.vendor, product = u.product, version = u.version,
           layer = u.layer, environment = u.environment, exposure = u.exposure,
           usable = (u.issues = '[]'), issues = u.issues::jsonb, revision = r.revision + 1,
           source_kind = 'import', source_file_name = $3, source_line = u.line, changed_by = $4,
           changed_at = now()
       from unnest($5::uuid[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                   $11::text[], $12::text[], $13::text[], $14::int[])
         as u(id, owner, vendor, product, version, layer, environment, exposure, issues, line)
       where r.tenant_id = $1 and r.project_id = $2 and r.id = u.id`,
      [
        tenant,
        project,
        fileName,
        input.actorUserId,
        plan.updates.map((update) => update.id),
        ...columns(plan.updates.map((update) => update.row)),
        plan.updates.map((update) => update.row.line),
      ],
    );
  }
  if (plan.adds.length > 0) {
    // A line number is unique within its System, so new rows follow the System's last one.
    const last = await client.query<{ system_id: string; last: number }>(
      `select system_id, max(line_no) as last from inventory_rows
       where tenant_id = $1 and project_id = $2 and system_id = any($3::uuid[]) group by system_id`,
      [
        tenant,
        project,
        [...new Set(plan.adds.map((row) => idOf(row.systemKey)))],
      ],
    );
    const next = new Map(last.rows.map((row) => [row.system_id, row.last]));
    const lines = plan.adds.map((row) => {
      const id = idOf(row.systemKey);
      const line = (next.get(id) ?? 1) + 1;
      next.set(id, line);
      return line;
    });
    await client.query(
      `insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
          layer, environment, exposure, usable, issues, source_kind, source_file_name, source_line,
          changed_by)
       select $1, $2, r.system_id, r.line, r.owner, r.vendor, r.product, r.version,
              r.layer, r.environment, r.exposure, r.issues = '[]', r.issues::jsonb,
              'import', $3, r.file_line, $4
       from unnest($5::uuid[], $6::int[], $7::text[], $8::text[], $9::text[], $10::text[],
                   $11::text[], $12::text[], $13::text[], $14::text[], $15::int[])
         as r(system_id, line, owner, vendor, product, version, layer, environment, exposure, issues,
              file_line)`,
      [
        tenant,
        project,
        fileName,
        input.actorUserId,
        plan.adds.map((row) => idOf(row.systemKey)),
        lines,
        ...columns(plan.adds),
        plan.adds.map((row) => row.line),
      ],
    );
  }
  return ids;
}

/**
 * Merges the preview into the Project's rows (Q-17, Q-18). Under the Project lock it refuses an
 * expired preview, then a preview whose Systems changed since it was made, plans the merge again
 * from the stored rows (the same plan the preview showed, because the fingerprints match) and
 * applies it in this transaction, so a failure leaves inventory unchanged and the preview in
 * place. The preview, the import record and the audit event are written in the same transaction.
 */
export function confirmImport(
  deps: InventoryDeps,
  input: ProjectIdentity & { previewId: string },
): Promise<InventoryImportResult> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId, actorRole }) => {
      const tenant = input.organizationId;
      await asUser(client, input.actorUserId);
      const found = await client.query<
        PreviewRecord & {
          rows: InventoryRow[];
          fingerprints: Record<string, string>;
        }
      >(
        `select ${PREVIEW_COLUMNS}, rows, fingerprints from inventory_previews
         where tenant_id = $1 and project_id = $2 and id = $3 and created_by = $4`,
        [tenant, projectId, input.previewId, input.actorUserId],
      );
      const preview = found.rows[0];
      if (!preview) notFound();
      if (preview.expired) expired();
      const keys = Object.keys(preview.fingerprints);
      const inventory = await loadInventory(client, tenant, projectId, keys);
      if (
        keys.some(
          (key) =>
            (inventory.fingerprints.get(key) ?? ABSENT) !==
            preview.fingerprints[key],
        )
      ) {
        stale();
      }
      const plan = planImport(
        await withKeys(client, preview.rows),
        inventory.existing,
        inventory.systems,
      );
      const ids = await apply(
        client,
        input,
        projectId,
        preview.file_name,
        plan,
        inventory.systems,
      );
      const touched = [
        ...new Set(
          [...plan.adds, ...plan.updates.map((update) => update.row)].map(
            (row) => ids.get(row.systemKey) ?? "",
          ),
        ),
      ];
      for (const systemId of touched) {
        await recount(client, tenant, projectId, systemId);
      }
      await syncMappings(client, tenant, projectId);
      await client.query(
        "delete from inventory_previews where tenant_id = $1 and id = $2",
        [tenant, input.previewId],
      );
      const totals: InventoryImportCounts = plan.totals;
      const record = await client.query<{ id: string; imported_at: Date }>(
        `insert into inventory_imports
           (tenant_id, project_id, imported_by, file_name, added, updated, unchanged, skipped, failed)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, imported_at`,
        [
          tenant,
          projectId,
          input.actorUserId,
          preview.file_name,
          totals.added,
          totals.updated,
          totals.unchanged,
          totals.skipped,
          totals.failed,
        ],
      );
      const importId = record.rows[0]?.id;
      const importedAt = record.rows[0]?.imported_at;
      if (!importId || !importedAt) throw new Error("import was not recorded");
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action: "organization.project.inventory.import",
        target: {
          type: "project",
          id: projectId,
          attributes: { importId, ...totals },
        },
        changes: [],
      });
      return {
        fileName: preview.file_name,
        importedAt: importedAt.toISOString(),
        totals,
        systems: plan.preview.systems.map((system) => ({
          id: ids.get(system.key) ?? "",
          name: system.name,
          created: system.created,
          added: system.added,
          updated: system.updated,
          unchanged: system.unchanged,
          skipped: system.skipped,
          failed: system.failed,
        })),
      };
    },
  );
}
