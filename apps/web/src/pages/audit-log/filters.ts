import {
  DEFAULT_RANGE,
  serializeAuditFilters,
  type AuditFilters,
  type AuditRange,
} from "../../lib/api/audit-log";

export const RANGE_OPTIONS: readonly { value: AuditRange; label: string }[] = [
  { value: "24h", label: "24 ชั่วโมง" },
  { value: "7d", label: "7 วัน" },
  { value: "30d", label: "30 วัน" },
  { value: "custom", label: "กำหนดเอง" },
];

/** Anything but the default view: decides "ไม่ตรงตัวกรอง" over "ไม่มีข้อมูล". */
export function hasActiveFilters(filters: AuditFilters): boolean {
  return (
    filters.range !== DEFAULT_RANGE ||
    filters.categories.length > 0 ||
    filters.actor !== undefined ||
    filters.q !== undefined
  );
}

/** The same filters on page 1; this is what a changed filter resets to. */
export function filterIdentity(filters: AuditFilters): string {
  return serializeAuditFilters({ ...filters, page: 1 }).toString();
}
