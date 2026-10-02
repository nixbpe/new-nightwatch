import {
  AUDIT_CATEGORIES,
  AUDIT_SEARCH_MAX_LENGTH,
  auditExportCreateResponseSchema,
  auditExportListResponseSchema,
  auditLogActorsResponseSchema,
  auditLogEventResponseSchema,
  auditLogListResponseSchema,
  type AuditCategory,
  type AuditExportCreateResponse,
  type AuditExportListResponse,
  type AuditExportRequest,
  type AuditLogActorsResponse,
  type AuditLogEventResponse,
  type AuditLogListResponse,
} from "@nightwatch/api-contract";

import { zonedDayBoundary } from "../preferences";
import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request, requestFile, type DownloadedFile } from "./client";

export const AUDIT_LOG_PAGE_SIZE = 50;

/** What the list request carries; `offset` is the zero-based row of the page. */
export type AuditListParams = {
  from?: string;
  to?: string;
  categories?: readonly AuditCategory[];
  actorUserId?: string;
  q?: string;
  asOf?: string;
  offset: number;
};

// Every key sits under TENANT_QUERY_PREFIX so switching Organization cancels and removes it (WEB-03).
export const auditLogQueryKeys = {
  all: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "audit-log", organizationId] as const,
  events: (organizationId: string, params: AuditListParams) =>
    [
      ...TENANT_QUERY_PREFIX,
      "audit-log",
      "events",
      organizationId,
      {
        from: params.from,
        to: params.to,
        categories: params.categories,
        actorUserId: params.actorUserId,
        q: params.q,
        offset: params.offset,
        asOf: params.asOf,
      },
    ] as const,
  event: (organizationId: string, eventId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "audit-log",
      "event",
      organizationId,
      eventId,
    ] as const,
  actors: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "audit-log", "actors", organizationId] as const,
  exports: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "audit-log", "exports", organizationId] as const,
};

/** True for any audit-log cache entry of this Organization (lists, details, actors, exports). */
export function isAuditLogQueryOf(
  queryKey: readonly unknown[],
  organizationId: string,
): boolean {
  return (
    queryKey[0] === TENANT_QUERY_PREFIX[0] &&
    queryKey[1] === "audit-log" &&
    (queryKey[2] === organizationId || queryKey[3] === organizationId)
  );
}

export function fetchAuditEvents(
  organizationId: string,
  params: AuditListParams,
): Promise<AuditLogListResponse> {
  return request(
    "/api/organizations/{organizationId}/audit-log/events",
    auditLogListResponseSchema,
    {
      params: { organizationId },
      query: {
        from: params.from,
        to: params.to,
        categories:
          params.categories === undefined || params.categories.length === 0
            ? undefined
            : params.categories.join(","),
        actorUserId: params.actorUserId,
        q: params.q,
        asOf: params.asOf,
        limit: AUDIT_LOG_PAGE_SIZE,
        offset: params.offset,
      },
    },
  );
}

export function fetchAuditEvent(
  organizationId: string,
  eventId: string,
): Promise<AuditLogEventResponse> {
  return request(
    "/api/organizations/{organizationId}/audit-log/events/{eventId}",
    auditLogEventResponseSchema,
    { params: { organizationId, eventId } },
    // The generated client types `before`/`after` as unknown; the contract schema narrows them.
  ).then((response) => auditLogEventResponseSchema.parse(response));
}

export function fetchAuditActors(
  organizationId: string,
): Promise<AuditLogActorsResponse> {
  return request(
    "/api/organizations/{organizationId}/audit-log/actors",
    auditLogActorsResponseSchema,
    { params: { organizationId } },
  );
}

export function fetchAuditExports(
  organizationId: string,
): Promise<AuditExportListResponse> {
  return request(
    "/api/organizations/{organizationId}/audit-log/exports",
    auditExportListResponseSchema,
    { params: { organizationId } },
  ).then((response) => auditExportListResponseSchema.parse(response));
}

export function createAuditExport(
  organizationId: string,
  body: AuditExportRequest,
  signal: AbortSignal,
): Promise<AuditExportCreateResponse> {
  return request(
    "/api/organizations/{organizationId}/audit-log/exports",
    auditExportCreateResponseSchema,
    { method: "POST", params: { organizationId }, body, signal },
  ).then((response) => auditExportCreateResponseSchema.parse(response));
}

export function downloadAuditExport(
  organizationId: string,
  exportId: string,
): Promise<DownloadedFile> {
  return requestFile(
    "/api/organizations/{organizationId}/audit-log/exports/{exportId}/download",
    { params: { organizationId, exportId } },
  );
}

export const AUDIT_RANGES = ["24h", "7d", "30d", "custom"] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

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
  const range = AUDIT_RANGES.find((item) => item === rawRange) ?? DEFAULT_RANGE;
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
  // All five stay in the URL so the chips keep showing what the user picked; none means all.
  if (categories.length > 0) {
    params.set("categories", categories.join(","));
  }
  if (filters.actor !== undefined) params.set("actor", filters.actor);
  if (filters.q !== undefined) params.set("q", filters.q);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
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
    offset: (filters.page - 1) * AUDIT_LOG_PAGE_SIZE,
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
