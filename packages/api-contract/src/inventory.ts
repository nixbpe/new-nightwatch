import { z } from "zod";

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
  fileName: z.string(),
  uploadedAt: timestamp,
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

export const inventoryRejectedRowSchema = z.object({
  line: z.number().int().min(2),
  owner: z.string(),
  vendor: z.string(),
  product: z.string(),
  version: z.string(),
  layer: z.string(),
  environment: z.string(),
  exposure: z.string(),
  issues: z.array(inventoryIssueSchema).min(1),
});
export type InventoryRejectedRow = z.infer<typeof inventoryRejectedRowSchema>;

export const inventoryRejectedRowsSchema = z.object({
  system: inventorySystemSchema,
  rows: z.array(inventoryRejectedRowSchema),
});
export type InventoryRejectedRows = z.infer<typeof inventoryRejectedRowsSchema>;

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
