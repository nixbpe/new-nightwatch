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
// A real workbook is a handful of XML parts and 5000 rows are about 1 MB of sheet
// XML, so these caps only stop a zip bomb.
const MAX_ZIP_ENTRIES = 200;
const MAX_UNZIPPED_BYTES = 16 * 1024 * 1024;
// The sheet reader fills the gap to a far row or column number with empty cells,
// so the numbers in the sheet XML are bounded before the reader sees them.
const MAX_SHEET_ROW_NUMBER = 20_000;
const MAX_SHEET_COLUMN_NUMBER = 64;
const MAX_CSV_RECORDS = 20_000;
const MAX_REPORTED_NAMES = 20;
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
    try {
      return toRows(parseCsv(text, MAX_CSV_RECORDS));
    } catch (error) {
      if (error instanceof RangeError) return reject({ code: "too_many_rows" });
      throw error;
    }
  }
  const table = await readWorkbook(bytes);
  return "ok" in table ? table : toRows(table);
}

async function readWorkbook(bytes: Uint8Array): Promise<Cell[][] | ParsedFile> {
  try {
    let entries = 0;
    let unzipped = 0;
    // fflate sizes each inflate buffer from the declared size, so the declared
    // total bounds what is inflated; every .xml and .rels part is inflated and scanned
    // (a superset of what the reader unpacks) because the reader takes the sheet
    // path from the workbook's rels, not from a fixed name.
    const parts = unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        unzipped += file.originalSize;
        if (entries > MAX_ZIP_ENTRIES || unzipped > MAX_UNZIPPED_BYTES) {
          throw new Error("zip limits exceeded");
        }
        return /\.(xml|rels)$/i.test(file.name);
      },
    });
    for (const xml of Object.values(parts)) assertSheetBounds(xml);
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

function columnNumber(letters: string): number {
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value;
}

const MAX_TAG_LENGTH = 32_768;
const MAX_ATTRIBUTES = 64;
const ELEMENT_NAME = /([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/y;
const ATTRIBUTE_NAME = /[A-Za-z_:][\w.:-]*/y;
// XML whitespace only; JavaScript's \s also matches NBSP and U+2028.
const SPACE = /[ \t\n\r]+/y;

function malformed(): never {
  throw new Error("malformed or oversized tag");
}

function match(pattern: RegExp, text: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0];
}

// The reader's own rule (read-excel-file parseXmlStream.saxen.js trimXmlnsPrefix):
// drop everything up to the first ":", but a ":" at index 5 of a name that starts
// with "xmlns" does not count.
function readerAttributeName(name: string): string {
  for (let i = 0; i < name.length; i += 1) {
    if (name[i] === ":" && !(i === 5 && name.startsWith("xmlns"))) {
      return name.slice(i + 1);
    }
  }
  return name;
}

function assertReference(local: "row" | "c", reference: string): void {
  const parts =
    local === "row"
      ? /^()(\d{1,6})$/.exec(reference)
      : /^([A-Za-z]{1,3})(\d{1,6})$/.exec(reference);
  if (
    !parts ||
    Number(parts[2]) > MAX_SHEET_ROW_NUMBER ||
    columnNumber((parts[1] ?? "").toUpperCase()) > MAX_SHEET_COLUMN_NUMBER
  ) {
    throw new Error("reference out of bounds");
  }
}

// One linear pass over the tags of an XML part, accepting only the canonical form
// a spreadsheet writes: name, then repeated (whitespace, name, "=", quoted value),
// then optional whitespace and ">" or "/>", with a separator after every closing
// quote. In that subset the reader's recovery paths for odd input never run, so
// the scan and the reader agree on every attribute. Anything else, a repeated name
// after the reader's prefix rule, a tag over 4096 characters, a DOCTYPE or other
// declaration, is refused. A `row` or `c` element must carry a plain reference
// within the caps, so the reader never fills the gap to a far row or column.
function assertSheetBounds(xml: Uint8Array): void {
  const text = new TextDecoder().decode(xml);
  let start = text.indexOf("<");
  while (start !== -1) {
    const next = text.charAt(start + 1);
    if (next === "!" || next === "?" || next === "/") {
      const closer = text.startsWith("<!--", start)
        ? "-->"
        : text.startsWith("<![CDATA[", start)
          ? "]]>"
          : next === "?"
            ? "?>"
            : next === "/"
              ? ">"
              : malformed();
      const end = text.indexOf(closer, start + 1);
      if (end === -1) return;
      start = text.indexOf("<", end + closer.length);
      continue;
    }
    ELEMENT_NAME.lastIndex = start + 1;
    const name = ELEMENT_NAME.exec(text);
    if (!name) malformed();
    const local = name[2];
    let position = start + 1 + name[0].length;
    const seen = new Set<string>();
    let reference: string | undefined;
    for (;;) {
      if (position - start > MAX_TAG_LENGTH) malformed();
      const space = match(SPACE, text, position);
      if (text.charAt(position + (space?.length ?? 0)) === ">") {
        position += (space?.length ?? 0) + 1;
        break;
      }
      if (text.startsWith("/>", position + (space?.length ?? 0))) {
        position += (space?.length ?? 0) + 2;
        break;
      }
      if (space === undefined) malformed();
      position += space.length;
      const attribute = match(ATTRIBUTE_NAME, text, position);
      if (attribute === undefined || seen.size >= MAX_ATTRIBUTES) malformed();
      position += attribute.length;
      if (text.charAt(position) !== "=") malformed();
      const quote = text.charAt(position + 1);
      if (quote !== '"' && quote !== "'") malformed();
      const close = text.indexOf(quote, position + 2);
      if (close === -1 || close - start > MAX_TAG_LENGTH) malformed();
      const value = text.slice(position + 2, close);
      if (value.includes("<")) malformed();
      const key = readerAttributeName(attribute);
      if (seen.has(key)) malformed();
      seen.add(key);
      if (key === "r") reference = value;
      position = close + 1;
      const after = text.charAt(position);
      if (after !== ">" && after !== "/" && !/[ \t\n\r]/.test(after)) {
        malformed();
      }
    }
    if ((local === "row" || local === "c") && reference !== undefined) {
      assertReference(local, reference);
    }
    start = text.indexOf("<", position);
  }
}

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
export function parseCsv(text: string, maxRecords = Infinity): string[][] {
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
      if (table.length > maxRecords) throw new RangeError("too many records");
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
  const body = table
    .slice(1)
    .map((cells, offset) => ({ cells, line: offset + 2 }))
    .filter(({ cells }) => !cells.every(blank));
  if (body.length > INVENTORY_MAX_ROWS)
    return reject({ code: "too_many_rows" });
  const filled = new Set<number>();
  for (const { cells } of body) {
    cells.forEach((cell, index) => {
      if (!blank(cell)) filled.add(index);
    });
  }
  // Trailing header cells that are empty and have no data below are padding.
  const header = [...(table[0] ?? [])];
  while (
    header.length > 0 &&
    blank(header.at(-1)) &&
    !filled.has(header.length - 1)
  ) {
    header.pop();
  }
  const columnOf = new Map<InventoryColumn, number>();
  const unexpected: string[] = [];
  const known = new Map(
    INVENTORY_COLUMNS.map((name) => [name.toLowerCase(), name]),
  );
  header.forEach((cell, index) => {
    const label = blank(cell) ? "" : String(cell).trim();
    const column = known.get(label.toLowerCase());
    const extra =
      column && !columnOf.has(column)
        ? undefined
        : label !== ""
          ? label
          : filled.has(index)
            ? NO_NAME
            : undefined;
    if (column && extra === undefined) columnOf.set(column, index);
    else if (extra !== undefined && unexpected.length < MAX_REPORTED_NAMES) {
      unexpected.push(extra);
    }
  });
  const missing = INVENTORY_COLUMNS.filter((name) => !columnOf.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    return reject({ code: "columns_mismatch", missing, unexpected });
  }
  if (body.length === 0) return reject({ code: "no_rows" });
  const rows = body.map(({ cells: line, line: number }): RawRow => {
    const cells = Object.fromEntries(
      INVENTORY_COLUMNS.map((name) => [
        name,
        line[columnOf.get(name) ?? -1] ?? null,
      ]),
    ) as Record<InventoryColumn, Cell>;
    return { line: number, cells };
  });
  return { ok: true, rows };
}
