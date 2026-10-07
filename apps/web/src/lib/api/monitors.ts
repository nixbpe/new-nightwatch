import {
  MONITOR_HISTORY_DEFAULT_LIMIT,
  MONITOR_LIMIT_PER_ORGANIZATION,
  MONITOR_LIST_DEFAULT_LIMIT,
  MONITOR_RECENT_EVENTS_DEFAULT,
  monitorChecksResponseSchema,
  monitorDetailResponseSchema,
  monitorEventsResponseSchema,
  monitorIncidentsResponseSchema,
  monitorLastResponseResponseSchema,
  monitorListResponseSchema,
  monitorRecentEventsResponseSchema,
  monitorResponseTimesResponseSchema,
  monitorTestResponseSchema,
  monitorWriteResponseSchema,
  type MonitorChecksResponse,
  type MonitorDetailResponse,
  type MonitorEventsResponse,
  type MonitorHealthName,
  type MonitorIncidentsResponse,
  type MonitorLastResponseResponse,
  type MonitorListResponse,
  type MonitorListSort,
  type MonitorResponseTimesResponse,
  type MonitorTestResponse,
  type MonitorWriteResponse,
} from "@nightwatch/api-contract";
import type {
  monitorCreateSchema,
  monitorEditSchema,
  monitorTestCreateSchema,
  monitorTestEditSchema,
} from "@nightwatch/api-contract";

import type { z } from "zod";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request } from "./client";

// Requests are typed by the schema input: the server applies the defaults.
export type MonitorCreateBody = z.input<typeof monitorCreateSchema>;
export type MonitorEditBody = z.input<typeof monitorEditSchema>;
export type MonitorTestCreateBody = z.input<typeof monitorTestCreateSchema>;
export type MonitorTestEditBody = z.input<typeof monitorTestEditSchema>;

export type MonitorRecentEventsResponse = z.infer<
  typeof monitorRecentEventsResponseSchema
>;

export const MONITOR_LIST_PAGE_SIZE = MONITOR_LIST_DEFAULT_LIMIT;

// Overview list: one request returns every monitor of the organization (the per-organization cap fits one page).
// The Overview page and the workspace loader share it so both use the same query key.
export const OVERVIEW_LIST_PARAMS = {
  limit: MONITOR_LIMIT_PER_ORGANIZATION,
  offset: 0,
};
export const MONITOR_HISTORY_PAGE_SIZE = MONITOR_HISTORY_DEFAULT_LIMIT;
// Rows per "load more" on the checks history page: the contract maximum of `limit`.
export const MONITOR_CHECKS_CHUNK_SIZE = 50;
export const MONITOR_RECENT_EVENTS_LIMIT = MONITOR_RECENT_EVENTS_DEFAULT;
// The Overview and its recent-events card refetch on this interval without announcing it.
export const MONITOR_REFETCH_INTERVAL_MS = 30_000;

export type MonitorListParams = {
  limit: number;
  offset: number;
  health?: MonitorHealthName;
  q?: string;
  // Omitted for the default order so the key matches the loader and nav counts.
  sort?: MonitorListSort;
};

// Every key sits under TENANT_QUERY_PREFIX so switching Organization cancels and removes it.
export const monitorQueryKeys = {
  all: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "monitors", organizationId] as const,
  list: (organizationId: string, params: MonitorListParams) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "list",
      {
        limit: params.limit,
        offset: params.offset,
        health: params.health,
        q: params.q,
        ...(params.sort === undefined ? {} : { sort: params.sort }),
      },
    ] as const,
  recentEvents: (organizationId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "recent-events",
    ] as const,
  detail: (organizationId: string, monitorId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "detail",
      monitorId,
    ] as const,
  // `useInfiniteQuery` of the checks history page: its own shape, never shared with a single-page query.
  checksHistory: (organizationId: string, monitorId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "checks-history",
      monitorId,
    ] as const,
  incidents: (
    organizationId: string,
    monitorId: string,
    page: { limit: number; offset: number },
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "incidents",
      monitorId,
      page,
    ] as const,
  events: (
    organizationId: string,
    monitorId: string,
    page: { limit: number; offset: number },
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "events",
      monitorId,
      page,
    ] as const,
  lastResponse: (organizationId: string, monitorId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "last-response",
      monitorId,
    ] as const,
  responseTimes: (
    organizationId: string,
    monitorId: string,
    range: MonitorResponseRange,
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "response-times",
      monitorId,
      range,
    ] as const,
};

export function fetchMonitorList(
  organizationId: string,
  params: MonitorListParams,
): Promise<MonitorListResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors",
    monitorListResponseSchema,
    {
      params: { organizationId },
      query: {
        limit: params.limit,
        offset: params.offset,
        ...(params.health === undefined ? {} : { health: params.health }),
        ...(params.q === undefined || params.q === "" ? {} : { q: params.q }),
        ...(params.sort === undefined ? {} : { sort: params.sort }),
      },
    },
  );
}

export function fetchMonitorRecentEvents(
  organizationId: string,
  limit: number = MONITOR_RECENT_EVENTS_LIMIT,
): Promise<MonitorRecentEventsResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/recent-events",
    monitorRecentEventsResponseSchema,
    { params: { organizationId }, query: { limit } },
  );
}

export type MonitorResponseRange = "24h" | "7d" | "30d";

export function fetchMonitorDetail(
  organizationId: string,
  monitorId: string,
): Promise<MonitorDetailResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}",
    monitorDetailResponseSchema,
    { params: { organizationId, monitorId } },
  );
}

export function fetchMonitorChecks(
  organizationId: string,
  monitorId: string,
  page: { limit: number; offset: number },
): Promise<MonitorChecksResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/checks",
    monitorChecksResponseSchema,
    { params: { organizationId, monitorId }, query: page },
  );
}

export function fetchMonitorIncidents(
  organizationId: string,
  monitorId: string,
  page: { limit: number; offset: number },
): Promise<MonitorIncidentsResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/incidents",
    monitorIncidentsResponseSchema,
    { params: { organizationId, monitorId }, query: page },
  );
}

export function fetchMonitorEvents(
  organizationId: string,
  monitorId: string,
  page: { limit: number; offset: number },
): Promise<MonitorEventsResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/events",
    monitorEventsResponseSchema,
    { params: { organizationId, monitorId }, query: page },
  );
}

/** Owner and admin only: the caller must not request it for another role. */
export function fetchMonitorLastResponse(
  organizationId: string,
  monitorId: string,
): Promise<MonitorLastResponseResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/last-response",
    monitorLastResponseResponseSchema,
    { params: { organizationId, monitorId } },
  );
}

export function fetchMonitorResponseTimes(
  organizationId: string,
  monitorId: string,
  range: MonitorResponseRange,
): Promise<MonitorResponseTimesResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/response-times",
    monitorResponseTimesResponseSchema,
    { params: { organizationId, monitorId }, query: { range } },
  );
}

export function pauseMonitor(
  organizationId: string,
  monitorId: string,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/pause",
    monitorWriteResponseSchema,
    { method: "POST", params: { organizationId, monitorId } },
  );
}

export function resumeMonitor(
  organizationId: string,
  monitorId: string,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/resume",
    monitorWriteResponseSchema,
    { method: "POST", params: { organizationId, monitorId } },
  );
}

export function deleteMonitor(
  organizationId: string,
  monitorId: string,
): Promise<undefined> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}",
    undefined,
    { method: "DELETE", params: { organizationId, monitorId } },
  );
}

export function createMonitor(
  organizationId: string,
  body: MonitorCreateBody,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors",
    monitorWriteResponseSchema,
    { method: "POST", params: { organizationId }, body },
  );
}

export function updateMonitor(
  organizationId: string,
  monitorId: string,
  body: MonitorEditBody,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}",
    monitorWriteResponseSchema,
    { method: "PATCH", params: { organizationId, monitorId }, body },
  );
}

/** Test of a configuration that is not saved yet; nothing is stored. */
export function testMonitorDraft(
  organizationId: string,
  body: MonitorTestCreateBody,
): Promise<MonitorTestResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/test",
    monitorTestResponseSchema,
    { method: "POST", params: { organizationId }, body },
  );
}

/** Test in the Edit form: the complete configuration; `keep` uses the stored secret, `replace` a value for this test only. */
export function testMonitorEdit(
  organizationId: string,
  monitorId: string,
  body: MonitorTestEditBody,
): Promise<MonitorTestResponse> {
  return request(
    "/api/organizations/{organizationId}/monitors/{monitorId}/test",
    monitorTestResponseSchema,
    { method: "POST", params: { organizationId, monitorId }, body },
  );
}
