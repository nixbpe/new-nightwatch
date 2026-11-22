import {
  INVENTORY_COLUMNS,
  INVENTORY_MAX_FILE_BYTES,
  INVENTORY_MAX_ROWS,
  type InventoryIssue,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import writeXlsxFile from "write-excel-file/universal";

import { withProjectAccess } from "../projects/service";
import {
  INVENTORY_SHEET_NAME,
  MAX_UNZIPPED_BYTES,
  unzippedBytes,
} from "./file";
import type { InventoryDeps, ProjectIdentity } from "./service";

export type StoredRow = {
  system: string;
  owner: string;
  vendor: string;
  product: string;
  version: string;
  layer: string;
  environment: string;
  exposure: string;
  issues: InventoryIssue[];
};

const MAX_NAME_PART_CHARS = 40;
// What a row stores after the import cut a value (see `validateRow`): one more character puts
// the exported value over the limit again, so the file gives the row the same reason back.
const OVER_LIMIT_MARK = "…";
// The reader turns a date serial back into Math.floor((serial - SERIAL_AT_UNIX_EPOCH) * DAY_MS).
// The writer's own Date conversion lands 1 ms low for some times and skips others, so a Date
// is written as the serial of the middle of its millisecond, with a date format, which reads
// back as that exact time.
const DAY_MS = 86_400_000;
const SERIAL_AT_UNIX_EPOCH = 70 * 365 + 19;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COLUMN_FIELDS = [
  ["Owner", "owner"],
  ["Vendor", "vendor"],
  ["Product", "product"],
  ["Version", "version"],
  ["Layer", "layer"],
  ["Environment", "environment"],
  ["Exposure", "exposure"],
] as const;

export const dateSerial = (time: number) =>
  (time + 0.5) / DAY_MS + SERIAL_AT_UNIX_EPOCH;

function tooLarge(what: string): never {
  throw new AppError(
    409,
    "INVENTORY_EXPORT_TOO_LARGE",
    `${what} ใหญ่เกินกว่าจะ export เป็นไฟล์เดียวที่ import กลับได้ (ไม่เกิน ${String(INVENTORY_MAX_ROWS)} แถว และ ${String(INVENTORY_MAX_FILE_BYTES / 1024 / 1024)} MB) ไม่มีไฟล์ถูกสร้าง ลบแถวที่ไม่ใช้ก่อนแล้วลองใหม่`,
  );
}

/**
 * The cells of one row, as the template has them. Every value is a string cell, which a
 * spreadsheet shows as written and never evaluates, so a value that starts with = + - or @
 * stays inert and reads back unchanged. Two stored rows go back as the cell they came from,
 * because as text the same file would read back as a different row: a Version the file had
 * typed as a number or a date (`version_not_text`), and a value cut at the limit (`too_long`).
 *
 * Known limits, pinned by tests so a change is deliberate:
 * - The writer strips characters XML cannot hold (U+FFFD, U+FFFE, U+FFFF and other
 *   noncharacters, control characters), so a stored value with one reads back without it and
 *   its row key changes.
 * - A System name over 200 characters is keyed from the uncut name while its stored name is
 *   cut, so the file does not match that System again.
 */
export function cellsOf(row: StoredRow) {
  const overLimit = new Set<string>(
    row.issues
      .filter((issue) => issue.code === "too_long")
      .map((issue) => issue.column),
  );
  const text = (column: string, value: string) => ({
    value: overLimit.has(column) ? value + OVER_LIMIT_MARK : value,
    type: String,
  });
  const typedVersion = row.issues.some(
    (issue) => issue.column === "Version" && issue.code === "version_not_text",
  );
  const version = (() => {
    if (typedVersion && String(Number(row.version)) === row.version) {
      return { value: Number(row.version), type: Number };
    }
    if (typedVersion && ISO_DATE.test(row.version)) {
      return {
        value: dateSerial(Date.parse(row.version)),
        type: Number,
        format: row.version.endsWith("T00:00:00.000Z")
          ? "yyyy-mm-dd"
          : "yyyy-mm-dd hh:mm:ss",
      };
    }
    return text("Version", row.version);
  })();
  return [
    { value: row.system, type: String },
    ...COLUMN_FIELDS.map(([column, field]) =>
      column === "Version" ? version : text(column, row[field]),
    ),
  ];
}

// The part of a file name taken from a name a person typed: letters, marks and digits only,
// so no separator, quote or line break from the name reaches the header.
const namePart = (value: string) =>
  Array.from(
    value
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
  )
    .slice(0, MAX_NAME_PART_CHARS)
    .join("")
    .replace(/-+$/, "");

/** `inventory-<project>[-<system>]-<UTC date>.xlsx`, and the same name with ASCII letters only. */
export function exportFileNames(
  projectSlug: string,
  systemName: string | undefined,
  now: Date,
) {
  const date = now.toISOString().slice(0, 10);
  const build = (parts: (string | undefined)[]) =>
    ["inventory", ...parts, date].filter(Boolean).join("-") + ".xlsx";
  const system = systemName === undefined ? undefined : namePart(systemName);
  const ascii = system?.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    utf8: build([projectSlug, system]),
    ascii: build([projectSlug, ascii]),
  };
}

export function contentDisposition(names: { utf8: string; ascii: string }) {
  return `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeURIComponent(names.utf8)}`;
}

/**
 * The Project's current inventory, or one System's, as the template workbook (S7.4): usable and
 * failed rows alike, so the file imports back unchanged. Any member of the Project may read it.
 * More rows than one import accepts, or a file larger than one import accepts, is refused whole
 * instead of cut, because a cut file would look complete.
 */
export async function exportInventory(
  deps: InventoryDeps,
  input: ProjectIdentity & { systemId?: string },
  now = new Date(),
) {
  const { rows, projectSlug, systemName } = await withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    async (client, { projectId }) => {
      const tenant = input.organizationId;
      const project = await client.query<{ slug: string }>(
        "select slug from projects where tenant_id = $1 and id = $2",
        [tenant, projectId],
      );
      let name: string | undefined;
      if (input.systemId !== undefined) {
        const found = await client.query<{ name: string }>(
          `select name from inventory_systems
           where tenant_id = $1 and project_id = $2 and id = $3`,
          [tenant, projectId, input.systemId],
        );
        name = found.rows[0]?.name;
        if (name === undefined) {
          throw new AppError(404, "INVENTORY_SYSTEM_NOT_FOUND", "ไม่พบ System");
        }
      }
      const { rows } = await client.query<StoredRow>(
        `select s.name as system, r.owner, r.vendor, r.product, r.version, r.layer,
                r.environment, r.exposure, r.issues
         from inventory_rows r
         join inventory_systems s
           on s.id = r.system_id and s.tenant_id = r.tenant_id and s.project_id = r.project_id
         where r.tenant_id = $1 and r.project_id = $2 and ($3::uuid is null or r.system_id = $3)
         order by s.name_key, r.line_no
         limit ${String(INVENTORY_MAX_ROWS + 1)}`,
        [tenant, projectId, input.systemId ?? null],
      );
      return {
        rows,
        projectSlug: project.rows[0]?.slug ?? "",
        systemName: name,
      };
    },
  );
  const what = systemName === undefined ? "inventory ของ Project" : "System";
  if (rows.length > INVENTORY_MAX_ROWS) tooLarge(what);
  const blob = await writeXlsxFile(
    [
      {
        sheet: INVENTORY_SHEET_NAME,
        data: [
          INVENTORY_COLUMNS.map((value) => ({
            value,
            type: String,
            fontWeight: "bold" as const,
          })),
          ...rows.map(cellsOf),
        ],
      },
    ],
    {},
  ).toBlob();
  if (blob.size > INVENTORY_MAX_FILE_BYTES) tooLarge(what);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // An import also refuses a workbook that unpacks past a limit, however small the file is.
  if (unzippedBytes(bytes) > MAX_UNZIPPED_BYTES) tooLarge(what);
  return {
    bytes,
    names: exportFileNames(projectSlug, systemName, now),
  };
}
