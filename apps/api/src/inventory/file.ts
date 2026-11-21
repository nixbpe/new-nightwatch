import {
  INVENTORY_COLUMNS,
  INVENTORY_MAX_FILE_BYTES,
  INVENTORY_MAX_ROWS,
  type InventoryColumn,
} from "@nightwatch/api-contract";
import { unzipSync } from "fflate";
import readExcelFile from "read-excel-file/universal";

export type Cell = string | number | boolean | Date | null;
export type RawRow = {
  /** 1-based position in the sheet, header row included. */
  line: number;
  cells: Record<InventoryColumn, Cell>;
};

export type FileRejection =
  | { code: "unsupported_extension" }
  | { code: "file_too_large" }
  | { code: "csv_not_utf8" }
  | { code: "xlsx_unreadable" }
  | { code: "sheet_not_found" }
  | {
      code: "columns_mismatch";
      missing: InventoryColumn[];
      unexpected: string[];
    }
  | { code: "no_rows" }
  | { code: "too_many_rows" };

export type ParsedFile =
  { ok: true; rows: RawRow[] } | { ok: false; rejection: FileRejection };

const SHEET_NAME = "inventory";
// A real workbook is a handful of XML parts; the cap only stops a zip bomb.
const MAX_ZIP_ENTRIES = 200;
const MAX_UNZIPPED_BYTES = 32 * 1024 * 1024;
const NO_NAME = "(ไม่มีชื่อ)";

const reject = (rejection: FileRejection): ParsedFile => ({
  ok: false,
  rejection,
});

export async function parseInventoryFile(
  fileName: string,
  bytes: Uint8Array,
): Promise<ParsedFile> {
  const extension = /\.(xlsx|csv)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (!extension) return reject({ code: "unsupported_extension" });
  if (bytes.byteLength > INVENTORY_MAX_FILE_BYTES) {
    return reject({ code: "file_too_large" });
  }
  if (extension === "csv") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return reject({ code: "csv_not_utf8" });
    }
    return toRows(parseCsv(text));
  }
  const table = await readWorkbook(bytes);
  return "ok" in table ? table : toRows(table);
}

async function readWorkbook(bytes: Uint8Array): Promise<Cell[][] | ParsedFile> {
  try {
    let entries = 0;
    let unzipped = 0;
    // The filter rejects every entry, so only the zip directory is read here.
    unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        unzipped += file.originalSize;
        if (entries > MAX_ZIP_ENTRIES || unzipped > MAX_UNZIPPED_BYTES) {
          throw new Error("zip limits exceeded");
        }
        return false;
      },
    });
    const sheets = await readExcelFile(new Blob([bytes]));
    const named = sheets.find(
      (sheet) => sheet.sheet.trim().toLowerCase() === SHEET_NAME,
    );
    const chosen = named ?? (sheets.length === 1 ? sheets[0] : undefined);
    return chosen
      ? (chosen.data as Cell[][])
      : reject({ code: "sheet_not_found" });
  } catch {
    return reject({ code: "xlsx_unreadable" });
  }
}

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (quoted) {
      if (char !== '"') field += char;
      else if (source.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source.charAt(i + 1) === "\n") i += 1;
      row.push(field);
      table.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    table.push(row);
  }
  return table;
}

const blank = (cell: Cell | undefined): boolean =>
  cell === null ||
  cell === undefined ||
  (typeof cell === "string" && cell.trim() === "");

function toRows(table: Cell[][]): ParsedFile {
  const header = table[0] ?? [];
  const body = table.slice(1);
  const columnOf = new Map<InventoryColumn, number>();
  const unexpected: string[] = [];
  const known = new Map(
    INVENTORY_COLUMNS.map((name) => [name.toLowerCase(), name]),
  );
  header.forEach((cell, index) => {
    const label = blank(cell) ? "" : String(cell).trim();
    const column = known.get(label.toLowerCase());
    if (column && !columnOf.has(column)) columnOf.set(column, index);
    else if (label !== "") unexpected.push(label);
    else if (body.some((line) => !blank(line[index]))) unexpected.push(NO_NAME);
  });
  const missing = INVENTORY_COLUMNS.filter((name) => !columnOf.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    return reject({ code: "columns_mismatch", missing, unexpected });
  }
  const rows: RawRow[] = [];
  body.forEach((line, offset) => {
    const cells = Object.fromEntries(
      INVENTORY_COLUMNS.map((name) => [
        name,
        line[columnOf.get(name) ?? -1] ?? null,
      ]),
    ) as Record<InventoryColumn, Cell>;
    if (Object.values(cells).every(blank)) return;
    rows.push({ line: offset + 2, cells });
  });
  if (rows.length > INVENTORY_MAX_ROWS)
    return reject({ code: "too_many_rows" });
  if (rows.length === 0) return reject({ code: "no_rows" });
  return { ok: true, rows };
}
