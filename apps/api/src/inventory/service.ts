import {
  INVENTORY_COLUMNS,
  INVENTORY_QUALITY_THRESHOLD_PERCENT,
  inventoryIssueMessage,
  type InventoryIssue,
  type InventoryRejectedRow,
  type InventoryRejectedRows,
  type InventorySummary,
  type InventorySystem,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";
import writeXlsxFile from "write-excel-file/universal";

import { recordAuditEvent } from "../audit/record";
import { withProjectAccess, type Identity } from "../projects/service";
import type { RateLimiter } from "../rate-limit";
import { parseInventoryFile } from "./file";
import { inventoryFileRejected } from "./messages";
import { validateRow, type InventoryRow } from "./rows";

export type InventoryDeps = { database: Database; rateLimiter?: RateLimiter };
export type ProjectIdentity = Identity & { projectId: string };

type SystemRow = {
  id: string;
  name: string;
  total_rows: number;
  usable_rows: number;
  file_name: string;
  uploaded_at: Date;
  owners: string[];
};

const MAX_OWNERS_SHOWN = 5;
const NO_OWNER = "(ไม่ระบุ Owner)";
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/g;

const toSystem = (row: SystemRow): InventorySystem => ({
  id: row.id,
  name: row.name,
  owners: row.owners,
  totalRows: row.total_rows,
  usableRows: row.usable_rows,
  lowQuality:
    row.usable_rows * 100 <
    INVENTORY_QUALITY_THRESHOLD_PERCENT * row.total_rows,
  fileName: row.file_name,
  uploadedAt: row.uploaded_at.toISOString(),
});

const SYSTEM_COLUMNS = `s.id, s.name, s.total_rows, s.usable_rows, s.file_name, s.uploaded_at,
  array(select o.owner from (select distinct r.owner from inventory_rows r
    where r.system_id = s.id order by r.owner limit ${String(MAX_OWNERS_SHOWN)}) o) as owners`;

async function summarize(
  client: PoolClient,
  tenant: string,
  project: string,
  canUpload: boolean,
): Promise<InventorySummary> {
  const { rows } = await client.query<SystemRow>(
    `select ${SYSTEM_COLUMNS} from inventory_systems s
     where s.tenant_id = $1 and s.project_id = $2 order by s.name_key`,
    [tenant, project],
  );
  const systems = rows.map(toSystem);
  const last = rows.reduce<SystemRow | undefined>(
    (latest, row) =>
      !latest || row.uploaded_at > latest.uploaded_at ? row : latest,
    undefined,
  );
  return {
    canUpload,
    systemCount: systems.length,
    totalRows: systems.reduce((sum, system) => sum + system.totalRows, 0),
    usableRows: systems.reduce((sum, system) => sum + system.usableRows, 0),
    lastUploadAt: last?.uploaded_at.toISOString() ?? null,
    lastUploadFileName: last?.file_name ?? null,
    systems,
  };
}

const canUpload = (access: { kind: string; role?: string }) =>
  access.kind === "org-admin" ||
  (access.kind === "member" && access.role === "admin");

export function getInventory(deps: InventoryDeps, input: ProjectIdentity) {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    (client, { projectId, access }) =>
      summarize(client, input.organizationId, projectId, canUpload(access)),
  );
}

// The file name is shown back to members, so it is reduced to a plain name.
function displayName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base.replace(/\p{Cc}/gu, " ").trim())
    .slice(0, 255)
    .join("");
  return clean === "" ? "inventory" : clean;
}

function groupBySystem(rows: InventoryRow[]) {
  const groups = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const group = groups.get(row.systemKey);
    if (group) group.push(row);
    else groups.set(row.systemKey, [row]);
  }
  return [...groups.values()];
}

async function limitUploads(deps: InventoryDeps, input: ProjectIdentity) {
  if (!deps.rateLimiter) {
    throw new AppError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "บริการ upload inventory ยังไม่พร้อม",
    );
  }
  return deps.rateLimiter.consumeRateLimits({
    windowMs: 60_000,
    limits: [
      {
        key: `rl:inventory-upload:u:${input.actorUserId}:p:${input.projectId}`,
        limit: 10,
      },
      { key: `rl:inventory-upload:o:${input.organizationId}`, limit: 60 },
    ],
  });
}

/** Unseen Projects answer 404 and non-admins 403; the route runs it before the body is parsed. */
export function authorizeUpload(deps: InventoryDeps, input: ProjectIdentity) {
  return withProjectAccess(deps.database, input, "inventory.write", false, () =>
    Promise.resolve(),
  );
}

export async function uploadInventory(
  deps: InventoryDeps,
  input: ProjectIdentity,
  file: { name: string; bytes: Uint8Array },
): Promise<InventorySummary | { retryAfterSeconds: number }> {
  const limit = await limitUploads(deps, input);
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };
  const fileName = displayName(file.name);
  // Parsing is CPU work on untrusted bytes, so it runs outside the transaction (REQ-01).
  const parsed = await parseInventoryFile(fileName, file.bytes);
  if (!parsed.ok) throw inventoryFileRejected(fileName, parsed.rejection);
  const groups = groupBySystem(parsed.rows.map(validateRow));
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId, actorRole }) => {
      const tenant = input.organizationId;
      await client.query(
        "delete from inventory_systems where tenant_id = $1 and project_id = $2 and name_key = any($3::text[])",
        [tenant, projectId, groups.map(([first]) => first?.systemKey)],
      );
      const systems = await client.query<{ id: string; name_key: string }>(
        `insert into inventory_systems
           (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         select $1, $2, s.key, s.name, $3, $4, s.total, s.usable
         from unnest($5::text[], $6::text[], $7::int[], $8::int[]) as s(key, name, total, usable)
         returning id, name_key`,
        [
          tenant,
          projectId,
          fileName,
          input.actorUserId,
          groups.map(([first]) => first?.systemKey),
          groups.map(([first]) => first?.system),
          groups.map((group) => group.length),
          groups.map(
            (group) => group.filter((row) => row.issues.length === 0).length,
          ),
        ],
      );
      const idOf = new Map(systems.rows.map((row) => [row.name_key, row.id]));
      const rows = groups.flat();
      await client.query(
        `insert into inventory_rows
           (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
            layer, environment, exposure, usable, issues)
         select $1, $2, r.system_id, r.line, r.owner, r.vendor, r.product, r.version,
                r.layer, r.environment, r.exposure, r.issues = '[]', r.issues::jsonb
         from unnest($3::uuid[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[],
                     $9::text[], $10::text[], $11::text[], $12::text[])
           as r(system_id, line, owner, vendor, product, version, layer, environment, exposure, issues)`,
        [
          tenant,
          projectId,
          rows.map((row) => idOf.get(row.systemKey)),
          rows.map((row) => row.line),
          rows.map((row) => row.owner),
          rows.map((row) => row.vendor),
          rows.map((row) => row.product),
          rows.map((row) => row.version),
          rows.map((row) => row.layer),
          rows.map((row) => row.environment),
          rows.map((row) => row.exposure),
          rows.map((row) => JSON.stringify(row.issues)),
        ],
      );
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action: "organization.project.inventory.upload",
        target: { type: "project", id: projectId },
        changes: [],
      });
      return summarize(client, tenant, projectId, true);
    },
  );
}

type RejectedRow = {
  line_no: number;
  owner: string;
  vendor: string;
  product: string;
  version: string;
  layer: string;
  environment: string;
  exposure: string;
  issues: InventoryIssue[];
};

function systemNotFound(): never {
  throw new AppError(404, "INVENTORY_SYSTEM_NOT_FOUND", "ไม่พบ System");
}

export function getRejectedRows(
  deps: InventoryDeps,
  input: ProjectIdentity & { systemId: string },
): Promise<InventoryRejectedRows> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    async (client, { projectId }) => {
      const tenant = input.organizationId;
      const system = await client.query<SystemRow>(
        `select ${SYSTEM_COLUMNS} from inventory_systems s
         where s.tenant_id = $1 and s.project_id = $2 and s.id = $3`,
        [tenant, projectId, input.systemId],
      );
      const found = system.rows[0];
      if (!found) systemNotFound();
      const { rows } = await client.query<RejectedRow>(
        `select line_no, owner, vendor, product, version, layer, environment, exposure, issues
         from inventory_rows
         where tenant_id = $1 and project_id = $2 and system_id = $3 and not usable
         order by line_no`,
        [tenant, projectId, input.systemId],
      );
      return {
        system: toSystem(found),
        rows: rows.map((row): InventoryRejectedRow => ({
          line: row.line_no,
          owner: row.owner,
          vendor: row.vendor,
          product: row.product,
          version: row.version,
          layer: row.layer,
          environment: row.environment,
          exposure: row.exposure,
          issues: row.issues,
        })),
      };
    },
  );
}

// Excel allows 31 UTF-16 units and no leading or trailing apostrophe; the writer
// counts units, so the name is cut by units without splitting a code point.
function cutUnits(value: string, units: number): string {
  let result = "";
  for (const char of value) {
    if (result.length + char.length > units) break;
    result += char;
  }
  return result;
}

const sheetName = (owner: string, used: Set<string>): string => {
  const cleaned = owner
    .replace(SHEET_NAME_FORBIDDEN, " ")
    .replace(/^'+|'+$/g, "")
    .trim();
  const base = cutUnits(cleaned || NO_OWNER, 28).trim() || NO_OWNER;
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1)
    name = `${base} ${String(n)}`;
  used.add(name.toLowerCase());
  return name;
};

/** One sheet per Owner so each can be forwarded as is (S1.3, Q-03). */
export async function exportRejectedRows(
  deps: InventoryDeps,
  input: ProjectIdentity & { systemId: string },
) {
  const { system, rows } = await getRejectedRows(deps, input);
  const byOwner = new Map<string, InventoryRejectedRow[]>();
  for (const row of rows) {
    const group = byOwner.get(row.owner);
    if (group) group.push(row);
    else byOwner.set(row.owner, [row]);
  }
  const header = ["แถวในไฟล์", ...INVENTORY_COLUMNS, "เหตุผล"].map((value) => ({
    value,
    type: String,
    fontWeight: "bold" as const,
  }));
  const used = new Set<string>();
  const sheets = [...byOwner].map(([owner, group]) => ({
    sheet: sheetName(owner, used),
    data: [
      header,
      ...group.map((row) => [
        { value: row.line, type: Number },
        ...[
          system.name,
          row.owner,
          row.vendor,
          row.product,
          row.version,
          row.layer,
          row.environment,
          row.exposure,
          row.issues
            .map((issue) => `${issue.column}: ${inventoryIssueMessage(issue)}`)
            .join("\n"),
        ].map((value) => ({ value, type: String })),
      ]),
    ],
  }));
  if (sheets.length === 0) {
    throw new AppError(404, "INVENTORY_NO_REJECTED_ROWS", "ไม่มีแถวที่ไม่ผ่าน");
  }
  const blob = await writeXlsxFile(sheets, {}).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}
