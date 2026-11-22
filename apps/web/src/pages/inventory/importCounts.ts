import type { InventoryImportCounts } from "@nightwatch/api-contract";

import type { DataTableColumn } from "../../components/ui/data-table";

export const COUNT_LABELS: [keyof InventoryImportCounts, string][] = [
  ["added", "เพิ่ม"],
  ["updated", "อัปเดต"],
  ["unchanged", "ไม่เปลี่ยน"],
  ["skipped", "ข้าม"],
  ["failed", "ไม่ผ่าน"],
];

export const countColumns = <
  Row extends InventoryImportCounts,
>(): DataTableColumn<Row>[] =>
  COUNT_LABELS.map(([key, label]) => ({
    key,
    header: label,
    align: "end" as const,
    mono: true,
    cell: (row: Row) => String(row[key]),
  }));
