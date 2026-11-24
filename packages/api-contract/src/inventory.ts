import { z } from "zod";

import { isStorableText } from "./monitor";

// Browser-safe (PKG-01): zod only. The template columns and rules below are the
// F-017 contract (E-005 S1.1, Q-01, Q-02); the web app shows a message per code.

export const INVENTORY_COLUMNS = [
  "System",
  "Owner",
  "Vendor",
  "Product",
  "Version",
  "Layer",
  "Environment",
  "Exposure",
] as const;
export const inventoryColumnSchema = z.enum(INVENTORY_COLUMNS);
export type InventoryColumn = z.infer<typeof inventoryColumnSchema>;

export const INVENTORY_LAYERS = [
  "OS",
  "DB",
  "Middleware",
  "Runtime",
  "Appliance",
] as const;
export const INVENTORY_ENVIRONMENTS = ["Production", "Non-production"] as const;
export const INVENTORY_EXPOSURES = [
  "Internet-facing",
  "Internal",
  "Isolated",
] as const;

export const INVENTORY_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const INVENTORY_MAX_ROWS = 5000;
export const INVENTORY_FIELD_MAX_LENGTH = 200;
// Q-03: a System below this share of usable rows is labelled low quality.
export const INVENTORY_QUALITY_THRESHOLD_PERCENT = 95;

export const inventoryIssueCodeSchema = z.enum([
  "required",
  "too_long",
  "not_in_list",
  "version_not_text",
  "version_not_a_number",
  "version_not_patch_level",
  "product_has_version",
]);
export type InventoryIssueCode = z.infer<typeof inventoryIssueCodeSchema>;

export const inventoryIssueSchema = z.object({
  column: inventoryColumnSchema,
  code: inventoryIssueCodeSchema,
});
export type InventoryIssue = z.infer<typeof inventoryIssueSchema>;

const timestamp = z.iso.datetime();

export const inventorySystemSchema = z.object({
  id: z.uuid(),
  // Empty when the file had rows without a System name.
  name: z.string(),
  owners: z.array(z.string()),
  totalRows: z.number().int().nonnegative(),
  usableRows: z.number().int().nonnegative(),
  lowQuality: z.boolean(),
  // Null for a System created in the system; then `uploadedAt` is when it was created.
  fileName: z.string().nullable(),
  uploadedAt: timestamp,
  // The token a rename or delete names, so a System changed meanwhile is never overwritten.
  revision: z.number().int().min(1),
});
export type InventorySystem = z.infer<typeof inventorySystemSchema>;

export const inventoryMappingCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  unmapped: z.number().int().nonnegative(),
});
export type InventoryMappingCounts = z.infer<
  typeof inventoryMappingCountsSchema
>;

export const inventorySummarySchema = z.object({
  canUpload: z.boolean(),
  mappings: inventoryMappingCountsSchema,
  systemCount: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
  usableRows: z.number().int().nonnegative(),
  lastUploadAt: timestamp.nullable(),
  lastUploadFileName: z.string().nullable(),
  systems: z.array(inventorySystemSchema),
});
export type InventorySummary = z.infer<typeof inventorySummarySchema>;

// F-022 S7.1: every row of a Project, read with filters and edited one row at a time.
export const INVENTORY_ROWS_PAGE_SIZE = 25;
// A body field is only bounded here; the row rules (Q-01, Q-02) answer per column.
const ROW_INPUT_MAX_LENGTH = 1000;

export const inventoryRowStatusSchema = z.enum([
  "all",
  "rejected",
  "duplicate",
]);
export type InventoryRowStatus = z.infer<typeof inventoryRowStatusSchema>;

export const inventoryRowsQuerySchema = z.object({
  system: z.uuid().optional(),
  layer: z.enum(INVENTORY_LAYERS).optional(),
  environment: z.enum(INVENTORY_ENVIRONMENTS).optional(),
  exposure: z.enum(INVENTORY_EXPOSURES).optional(),
  // Stored Owners have runs of whitespace collapsed to one space (import), so the filter does too.
  owner: z
    .string()
    .trim()
    .max(INVENTORY_FIELD_MAX_LENGTH)
    .refine(isStorableText)
    .transform((value) => value.replace(/\s+/gu, " "))
    .optional(),
  status: inventoryRowStatusSchema.default("all"),
  q: z
    .string()
    .trim()
    .max(INVENTORY_FIELD_MAX_LENGTH)
    .refine(isStorableText)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type InventoryRowsQuery = Partial<
  z.infer<typeof inventoryRowsQuerySchema>
>;

export const inventoryRowSourceSchema = z.object({
  kind: z.enum(["import", "manual"]),
  // Set when kind is "import".
  fileName: z.string().nullable(),
  // Null when the person's account no longer exists.
  changedBy: z.string().nullable(),
  changedAt: timestamp,
});
export type InventoryRowSource = z.infer<typeof inventoryRowSourceSchema>;

export const inventoryRowSchema = z.object({
  id: z.uuid(),
  systemId: z.uuid(),
  systemName: z.string(),
  owner: z.string(),
  vendor: z.string(),
  product: z.string(),
  version: z.string(),
  layer: z.string(),
  environment: z.string(),
  exposure: z.string(),
  usable: z.boolean(),
  issues: z.array(inventoryIssueSchema),
  // Another row of the same System has the same key (an upload before F-022 kept both).
  duplicate: z.boolean(),
  // The token a save or delete names, so a row changed meanwhile is never overwritten.
  revision: z.number().int().min(1),
  source: inventoryRowSourceSchema,
});
export type InventoryRowItem = z.infer<typeof inventoryRowSchema>;

export const inventoryRowListSchema = z.object({
  rows: z.array(inventoryRowSchema),
  // Rows matching the filters, over all pages.
  total: z.number().int().nonnegative(),
  // The page returned; a request past the last page gets the last one.
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type InventoryRowList = z.infer<typeof inventoryRowListSchema>;

const rowField = z.string().max(ROW_INPUT_MAX_LENGTH);
export const inventoryRowInputSchema = z.object({
  owner: rowField,
  vendor: rowField,
  product: rowField,
  version: rowField,
  layer: rowField,
  environment: rowField,
  exposure: rowField,
});
export type InventoryRowInput = z.infer<typeof inventoryRowInputSchema>;

export const inventoryRowCreateSchema = inventoryRowInputSchema.extend({
  systemId: z.uuid(),
});
export type InventoryRowCreate = z.infer<typeof inventoryRowCreateSchema>;

const revision = z.number().int().min(1);
export const inventoryRowUpdateSchema = inventoryRowInputSchema.extend({
  revision,
});
export type InventoryRowUpdate = z.infer<typeof inventoryRowUpdateSchema>;

export const inventoryRowDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
});

const SYSTEM_NAME_MAX_LENGTH = 1000;
const systemName = z.string().max(SYSTEM_NAME_MAX_LENGTH);

// F-022 S7.2: a System is created with its first row, renamed, and deleted with its rows.
export const inventorySystemCreateSchema = inventoryRowInputSchema.extend({
  name: systemName,
});
export type InventorySystemCreate = z.infer<typeof inventorySystemCreateSchema>;

export const inventorySystemRenameSchema = z.object({
  name: systemName,
  revision,
});
export type InventorySystemRename = z.infer<typeof inventorySystemRenameSchema>;

// `rows` is the count the confirmation named; a System that holds another number is refused.
export const inventorySystemDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
  rows: z.coerce.number().int().min(0),
});

// `details` of INVENTORY_ROW_INVALID: the same codes an upload keeps per row.
export const inventoryRowInvalidDetailsSchema = z.object({
  issues: z.array(inventoryIssueSchema).min(1),
});

const LIST_VALUES: Partial<Record<InventoryColumn, readonly string[]>> = {
  Layer: INVENTORY_LAYERS,
  Environment: INVENTORY_ENVIRONMENTS,
  Exposure: INVENTORY_EXPOSURES,
};

/** The reason shown to members and written into the Owner download. */
export function inventoryIssueMessage(issue: InventoryIssue): string {
  const list = LIST_VALUES[issue.column]?.join(", ");
  switch (issue.code) {
    case "required":
      return list ? `ว่าง ต้องเลือก ${list}` : "ว่าง ต้องกรอก";
    case "not_in_list":
      return `ค่าไม่อยู่ในรายการ ใช้ ${list ?? ""}`.trim();
    case "too_long":
      return `ยาวเกิน ${String(INVENTORY_FIELD_MAX_LENGTH)} ตัวอักษร`;
    case "version_not_text":
      return "Excel เก็บค่าเป็นตัวเลขหรือวันที่จนค่าเดิมหาย ตั้งคอลัมน์เป็น Text แล้วกรอกใหม่";
    case "version_not_a_number":
      return "ต้องเป็นเลขเวอร์ชัน ไม่ใช่ข้อความ เช่น latest";
    case "version_not_patch_level":
      return "ไม่ถึง patch level เช่น 8.0.36 หรือ 22.04.4";
    case "product_has_version":
      return "มีเลขเวอร์ชันปนในชื่อ Product ให้ย้ายไปคอลัมน์ Version";
  }
}
