import {
  AUDIT_CATEGORIES,
  AUDIT_SEARCH_MAX_LENGTH,
  type AuditCategory,
} from "@nightwatch/api-contract";

import type { AuditListParams } from "../../lib/api/audit-log";
import { zonedDayBoundary } from "../../lib/preferences";

export const RANGE_OPTIONS = [
  { value: "24h", label: "24 ชั่วโมง" },
  { value: "7d", label: "7 วัน" },
  { value: "30d", label: "30 วัน" },
  { value: "custom", label: "กำหนดเอง" },
] as const;
export type AuditRange = (typeof RANGE_OPTIONS)[number]["value"];

export const DEFAULT_RANGE: AuditRange = "7d";

const RANGE_MS: Record<Exclude<AuditRange, "custom">, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

/** The list filters as the URL carries them; `page` is 1-based. */
export type AuditFilters = {
  range: AuditRange;
  /** `YYYY-MM-DD`, only meaningful for `custom`. */
  from?: string;
  to?: string;
  categories: AuditCategory[];
  actor?: string;
  q?: string;
  page: number;
};

export const DEFAULT_FILTERS: AuditFilters = {
  range: DEFAULT_RANGE,
  categories: [],
  page: 1,
};

function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// eslint-disable-next-line no-control-regex -- the point is to reject them
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Invalid values fall back to the default without an error (spec "Web"). */
export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const rawRange = params.get("range");
  const range =
    RANGE_OPTIONS.find((option) => option.value === rawRange)?.value ??
    DEFAULT_RANGE;
  const from = params.get("from");
  const to = params.get("to");
  const rawCategories = params.get("categories");
  let categories: AuditCategory[] = [];
  if (rawCategories !== null) {
    const listed = rawCategories.split(",");
    const valid = listed.every((item) =>
      (AUDIT_CATEGORIES as readonly string[]).includes(item),
    );
    if (valid) {
      categories = AUDIT_CATEGORIES.filter((category) =>
        listed.includes(category),
      );
    }
  }
  const actor = params.get("actor");
  const q = params.get("q")?.trim();
  const page = Number(params.get("page"));
  const filters: AuditFilters = {
    range,
    categories,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
  if (range === "custom") {
    if (from !== null && isRealDay(from)) filters.from = from;
    if (to !== null && isRealDay(to)) filters.to = to;
  }
  if (actor !== null && actor.length >= 1 && actor.length <= 128) {
    filters.actor = actor;
  }
  if (
    q !== undefined &&
    q.length >= 1 &&
    q.length <= AUDIT_SEARCH_MAX_LENGTH &&
    !CONTROL_CHARACTERS.test(q)
  ) {
    filters.q = q;
  }
  return filters;
}

/** Defaults are not written, so the default view has a clean URL. */
export function serializeAuditFilters(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.range !== DEFAULT_RANGE) params.set("range", filters.range);
  if (filters.range === "custom") {
    if (filters.from !== undefined) params.set("from", filters.from);
    if (filters.to !== undefined) params.set("to", filters.to);
  }
  const categories = AUDIT_CATEGORIES.filter((category) =>
    filters.categories.includes(category),
  );
  if (categories.length > 0 && categories.length < AUDIT_CATEGORIES.length) {
    params.set("categories", categories.join(","));
  }
  if (filters.actor !== undefined) params.set("actor", filters.actor);
  if (filters.q !== undefined) params.set("q", filters.q);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

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

/** Relative ranges are cut to the minute so the loader and the page ask for the same list. */
export function floorToMinute(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/** The list request for these filters; `now` anchors the relative ranges. */
export function toListParams(
  filters: AuditFilters,
  options: { now: Date; timeZone: string; asOf?: string },
): AuditListParams {
  const params: AuditListParams = {
    offset: (filters.page - 1) * 50,
  };
  if (filters.range === "custom") {
    if (filters.from !== undefined) {
      params.from = zonedDayBoundary(
        filters.from,
        options.timeZone,
        "start",
      ).toISOString();
    }
    if (filters.to !== undefined) {
      params.to = zonedDayBoundary(
        filters.to,
        options.timeZone,
        "end",
      ).toISOString();
    }
  } else {
    params.from = new Date(
      options.now.getTime() - RANGE_MS[filters.range],
    ).toISOString();
  }
  if (filters.categories.length > 0) params.categories = filters.categories;
  if (filters.actor !== undefined) params.actorUserId = filters.actor;
  if (filters.q !== undefined) params.q = filters.q;
  if (options.asOf !== undefined) params.asOf = options.asOf;
  return params;
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
