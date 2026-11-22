import { z } from "zod";

import { inventoryIssueMessage, inventoryIssueSchema } from "./inventory";

// F-022 S7.3: an import is previewed, then confirmed. The preview holds parsed rows only (Q-19).

/** A preview is kept at most this long (Q-19); the database enforces the same limit. */
export const INVENTORY_PREVIEW_TTL_MINUTES = 30;

const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();

export const inventoryImportCountsSchema = z.object({
  added: count,
  updated: count,
  unchanged: count,
  skipped: count,
  failed: count,
});
export type InventoryImportCounts = z.infer<typeof inventoryImportCountsSchema>;

// Why a row of the file is skipped or kept as failed. `issues` are the codes an upload gave.
export const inventoryImportReasonSchema = z.discriminatedUnion("code", [
  // A row that fails the rules and is written as a failed row.
  z.object({
    code: z.literal("issues"),
    issues: z.array(inventoryIssueSchema),
  }),
  // A failed row whose key matches a usable row: the usable row stays.
  z.object({
    code: z.literal("existing_usable"),
    issues: z.array(inventoryIssueSchema),
  }),
  // A later row with the key of an earlier row of the same file.
  z.object({ code: z.literal("duplicate_in_file"), line: z.number().int() }),
  // The key is shared by several rows in the System already.
  z.object({ code: z.literal("duplicate_in_system") }),
]);
export type InventoryImportReason = z.infer<typeof inventoryImportReasonSchema>;

export const inventoryImportRowSchema = z.object({
  // The line of the sheet, header row included.
  line: z.number().int().min(1),
  system: z.string(),
  vendor: z.string(),
  product: z.string(),
  version: z.string(),
  outcome: z.enum(["skipped", "failed"]),
  reason: inventoryImportReasonSchema,
});
export type InventoryImportRow = z.infer<typeof inventoryImportRowSchema>;

export const inventoryImportSystemSchema = inventoryImportCountsSchema.extend({
  // The System's identity within the Project; two names cut to the same length differ here.
  key: z.string(),
  name: z.string(),
  // Created by this import; false for a System the Project already has.
  created: z.boolean(),
});
export type InventoryImportSystem = z.infer<typeof inventoryImportSystemSchema>;

// The file adds a version of a Product the System already has under another version.
export const inventoryImportWarningSchema = z.object({
  system: z.string(),
  vendor: z.string(),
  product: z.string(),
  newVersions: z.array(z.string()),
  existingVersions: z.array(z.string()),
});
export type InventoryImportWarning = z.infer<
  typeof inventoryImportWarningSchema
>;

export const inventoryImportPreviewSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  createdAt: timestamp,
  expiresAt: timestamp,
  totals: inventoryImportCountsSchema,
  systems: z.array(inventoryImportSystemSchema),
  rows: z.array(inventoryImportRowSchema),
  warnings: z.array(inventoryImportWarningSchema),
});
export type InventoryImportPreview = z.infer<
  typeof inventoryImportPreviewSchema
>;

// The caller's own pending preview; null when there is none or it expired.
export const inventoryImportPendingSchema = z.object({
  preview: inventoryImportPreviewSchema.nullable(),
});
export type InventoryImportPending = z.infer<
  typeof inventoryImportPendingSchema
>;

export const inventoryImportResultSchema = z.object({
  fileName: z.string(),
  importedAt: timestamp,
  totals: inventoryImportCountsSchema,
  systems: z.array(
    inventoryImportCountsSchema.extend({
      id: z.uuid(),
      name: z.string(),
      created: z.boolean(),
    }),
  ),
});
export type InventoryImportResult = z.infer<typeof inventoryImportResultSchema>;

/** The reason shown next to a skipped or failed row of a preview. */
export function inventoryImportReasonMessage(
  reason: InventoryImportReason,
): string {
  const issues = (list: readonly z.infer<typeof inventoryIssueSchema>[]) =>
    list
      .map((issue) => `${issue.column}: ${inventoryIssueMessage(issue)}`)
      .join(" · ");
  switch (reason.code) {
    case "issues":
      return issues(reason.issues);
    case "existing_usable":
      return `แถวเดิมที่ใช้งานได้ key เดียวกันยังอยู่ ไม่ถูกทับ (${issues(reason.issues)})`;
    case "duplicate_in_file":
      return `ซ้ำกับแถวที่ ${String(reason.line)} ในไฟล์`;
    case "duplicate_in_system":
      return "key นี้ซ้ำกันอยู่แล้วใน System แก้หรือลบแถวซ้ำในระบบก่อน แล้ว import ใหม่";
  }
}
