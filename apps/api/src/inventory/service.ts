import {
  INVENTORY_COLUMNS,
  INVENTORY_QUALITY_THRESHOLD_PERCENT,
  inventoryIssueMessage,
  type InventoryIssue,
  type InventorySummary,
  type InventorySystem,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";
import writeXlsxFile from "write-excel-file/universal";

import { withProjectAccess, type Identity } from "../projects/service";
import type { RateLimiter } from "../rate-limit";
import type { CpeSearch } from "./cpe";
import { ensureMappings } from "./mappings";

export type InventoryDeps = {
  database: Database;
  rateLimiter?: RateLimiter;
  cpeSearch?: CpeSearch;
};
export type ProjectIdentity = Identity & { projectId: string };

type SystemRow = {
  id: string;
  name: string;
  total_rows: number;
  usable_rows: number;
  file_name: string | null;
  uploaded_at: Date;
  revision: number;
  owners: string[];
};

const MAX_OWNERS_SHOWN = 5;
const NO_OWNER = "(ไม่ระบุ Owner)";
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/g;

export const toSystem = (row: SystemRow): InventorySystem => ({
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
  revision: row.revision,
});

export const SYSTEM_COLUMNS = `s.id, s.name, s.total_rows, s.usable_rows, s.file_name, s.uploaded_at, s.revision,
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
  const counts = await client.query<{ status: string; total: number }>(
    `select status, count(*)::int as total from inventory_mappings
     where tenant_id = $1 and project_id = $2 group by status`,
    [tenant, project],
  );
  const mappings = { pending: 0, confirmed: 0, unmapped: 0 };
  for (const row of counts.rows) {
    if (
      row.status === "pending" ||
      row.status === "confirmed" ||
      row.status === "unmapped"
    ) {
      mappings[row.status] = row.total;
    }
  }
  const systems = rows.map(toSystem);
  // The last import is the later of the newest import record and, for a Project that was
  // uploaded before imports were recorded, the newest System that came from a file. A System
  // created on the screen came from no file.
  const recorded = await client.query<{ file_name: string; imported_at: Date }>(
    `select file_name, imported_at from inventory_imports
     where tenant_id = $1 and project_id = $2 order by imported_at desc limit 1`,
    [tenant, project],
  );
  const last = rows.reduce<{ file_name: string; at: Date } | undefined>(
    (latest, row) =>
      row.file_name !== null && (!latest || row.uploaded_at > latest.at)
        ? { file_name: row.file_name, at: row.uploaded_at }
        : latest,
    recorded.rows[0]
      ? {
          file_name: recorded.rows[0].file_name,
          at: recorded.rows[0].imported_at,
        }
      : undefined,
  );
  return {
    canUpload,
    mappings,
    systemCount: systems.length,
    totalRows: systems.reduce((sum, system) => sum + system.totalRows, 0),
    usableRows: systems.reduce((sum, system) => sum + system.usableRows, 0),
    lastUploadAt: last?.at.toISOString() ?? null,
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
    async (client, { projectId, access }) => {
      await ensureMappings(client, input.organizationId, projectId);
      return summarize(
        client,
        input.organizationId,
        projectId,
        canUpload(access),
      );
    },
  );
}

type RejectedRow = {
  source_line: number | null;
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

export const sheetName = (owner: string, used: Set<string>): string => {
  // 24 units leave room for a collision suffix of up to " 9999".
  const cleaned = owner.replace(SHEET_NAME_FORBIDDEN, " ").trim();
  const base =
    cutUnits(cleaned || NO_OWNER, 24).replace(/^['\s]+|['\s]+$/g, "") ||
    NO_OWNER;
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
  const { system, rows } = await withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    async (client, { projectId }) => {
      const tenant = input.organizationId;
      const found = await client.query<{ name: string }>(
        `select name from inventory_systems
         where tenant_id = $1 and project_id = $2 and id = $3`,
        [tenant, projectId, input.systemId],
      );
      const name = found.rows[0]?.name;
      if (name === undefined) systemNotFound();
      const { rows } = await client.query<RejectedRow>(
        `select source_line, owner, vendor, product, version, layer, environment, exposure, issues
         from inventory_rows
         where tenant_id = $1 and project_id = $2 and system_id = $3 and not usable
         order by line_no`,
        [tenant, projectId, input.systemId],
      );
      return { system: { name }, rows };
    },
  );
  const byOwner = new Map<string, RejectedRow[]>();
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
        // A row written on the screen has no line in any file.
        row.source_line === null
          ? { value: "", type: String }
          : { value: row.source_line, type: Number },
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
