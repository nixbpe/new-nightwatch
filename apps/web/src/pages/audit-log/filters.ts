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

export type CustomRangeError = "start-after-end" | "before-retention";

/**
 * AC-11. `retainedDay` is the "เก็บย้อนหลังถึง" date of the latest response in the
 * preference zone, not the browser clock; unknown until a list has loaded.
 */
export function customRangeError(
  filters: AuditFilters,
  retainedDay: string | undefined,
): CustomRangeError | undefined {
  if (filters.range !== "custom") return undefined;
  if (
    filters.from !== undefined &&
    filters.to !== undefined &&
    filters.from > filters.to
  ) {
    return "start-after-end";
  }
  if (
    filters.from !== undefined &&
    retainedDay !== undefined &&
    filters.from < retainedDay
  ) {
    return "before-retention";
  }
  return undefined;
}
