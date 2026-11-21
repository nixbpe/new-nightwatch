import { createHash } from "node:crypto";

import {
  INVENTORY_ENVIRONMENTS,
  INVENTORY_EXPOSURES,
  INVENTORY_FIELD_MAX_LENGTH,
  INVENTORY_LAYERS,
  type InventoryColumn,
  type InventoryIssue,
  type InventoryIssueCode,
} from "@nightwatch/api-contract";

import type { Cell, RawRow } from "./file";

export type InventoryRow = {
  line: number;
  systemKey: string;
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

const LISTS: Partial<Record<InventoryColumn, readonly string[]>> = {
  Layer: INVENTORY_LAYERS,
  Environment: INVENTORY_ENVIRONMENTS,
  Exposure: INVENTORY_EXPOSURES,
};

// PostgreSQL 10 and later number releases X.Y, so the second number is already
// its patch release. Every other product needs a third number or a distro
// revision (E-005 Q-02). Extend only with a product whose X.Y is a patch level.
const TWO_PART_PATCH_PRODUCTS = new Set(["postgresql"]);

function text(cell: Cell): string {
  if (cell === null) return "";
  const value = cell instanceof Date ? cell.toISOString() : String(cell);
  return value.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

// A Version cell typed as number or date is already rewritten by the
// spreadsheet ("15.10" becomes 15.1), so the original value cannot be known.
function untypedVersion(cell: Cell): boolean {
  return typeof cell === "number" || cell instanceof Date;
}

export function versionIssue(
  product: string,
  version: string,
): InventoryIssueCode | null {
  const normalized = version.replace(/^v(?=\d)/i, "");
  if (!/\d/.test(normalized)) return "version_not_a_number";
  const match = /^(?:\d+:)?(\d+(?:\.\d+)*)([0-9A-Za-z.+~_:-]*)$/.exec(
    normalized,
  );
  if (!match) return "version_not_a_number";
  const numbers = (match[1] ?? "").split(".").length;
  const revision = /[-+~](?:\d|[A-Za-z]+\d)/.test(match[2] ?? "");
  if (numbers >= 3 || (numbers === 2 && revision)) return null;
  if (numbers === 2 && TWO_PART_PATCH_PRODUCTS.has(product.toLowerCase())) {
    return null;
  }
  return "version_not_patch_level";
}

// The Project-wide identity of a System. Lower-casing can lengthen a name past the
// 200 characters the key column holds, and cutting it would give two names one
// key, so a longer key is replaced by its hash.
export function systemKeyOf(system: string): string {
  const lower = system.toLowerCase();
  return Array.from(lower).length <= INVENTORY_FIELD_MAX_LENGTH
    ? lower
    : `sha256:${createHash("sha256").update(lower).digest("hex")}`;
}

export function validateRow(raw: RawRow): InventoryRow {
  const issues: InventoryIssue[] = [];
  const read = (column: InventoryColumn): string => {
    const cell = raw.cells[column];
    let value = text(cell);
    if (value === "") {
      issues.push({ column, code: "required" });
      return value;
    }
    if (Array.from(value).length > INVENTORY_FIELD_MAX_LENGTH) {
      issues.push({ column, code: "too_long" });
      value = Array.from(value).slice(0, INVENTORY_FIELD_MAX_LENGTH).join("");
    }
    const list = LISTS[column];
    if (list) {
      const match = list.find(
        (item) => item.toLowerCase() === value.toLowerCase(),
      );
      if (match) return match;
      issues.push({ column, code: "not_in_list" });
    }
    return value;
  };
  const row = {
    system: read("System"),
    owner: read("Owner"),
    vendor: read("Vendor"),
    product: read("Product"),
    version: read("Version"),
    layer: read("Layer"),
    environment: read("Environment"),
    exposure: read("Exposure"),
  };
  if (row.version !== "") {
    const code = untypedVersion(raw.cells.Version)
      ? "version_not_text"
      : versionIssue(row.product, row.version);
    if (code) issues.push({ column: "Version", code });
  }
  if (/\s\d+(?:\.\d+)+$/.test(row.product)) {
    issues.push({ column: "Product", code: "product_has_version" });
  }
  return {
    line: raw.line,
    systemKey: systemKeyOf(row.system),
    ...row,
    issues,
  };
}
