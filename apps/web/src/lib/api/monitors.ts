import {
  MONITOR_HISTORY_DEFAULT_LIMIT,
  MONITOR_LIMIT_PER_PROJECT,
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

// Overview list: one request returns every monitor of the Project (the per-Project cap fits one page).
// The Workspace shares it with the list so both use the same query key.
export const OVERVIEW_LIST_PARAMS = {
  limit: MONITOR_LIMIT_PER_PROJECT,
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
  // `all` of an Organization covers every Project's monitors; `project` only one Project's.
  all: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "monitors", organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...TENANT_QUERY_PREFIX, "monitors", organizationId, projectId] as const,
  list: (
    organizationId: string,
    projectId: string,
    params: MonitorListParams,
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "list",
      {
        limit: params.limit,
        offset: params.offset,
        health: params.health,
        q: params.q,
        ...(params.sort === undefined ? {} : { sort: params.sort }),
      },
    ] as const,
  recentEvents: (organizationId: string, projectId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "recent-events",
    ] as const,
  detail: (organizationId: string, projectId: string, monitorId: string) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "detail",
      monitorId,
    ] as const,
  // `useInfiniteQuery` of the checks history page: its own shape, never shared with a single-page query.
  checksHistory: (
    organizationId: string,
    projectId: string,
    monitorId: string,
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "checks-history",
      monitorId,
    ] as const,
  incidents: (
    organizationId: string,
    projectId: string,
    monitorId: string,
    page: { limit: number; offset: number },
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "incidents",
      monitorId,
      page,
    ] as const,
  events: (
    organizationId: string,
    projectId: string,
    monitorId: string,
    page: { limit: number; offset: number },
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "events",
      monitorId,
      page,
    ] as const,
  lastResponse: (
    organizationId: string,
    projectId: string,
    monitorId: string,
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "last-response",
      monitorId,
    ] as const,
  responseTimes: (
    organizationId: string,
    projectId: string,
    monitorId: string,
    range: MonitorResponseRange,
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      projectId,
      "response-times",
      monitorId,
      range,
    ] as const,
};

export function fetchMonitorList(
  organizationId: string,
  projectId: string,
  params: MonitorListParams,
): Promise<MonitorListResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors",
    monitorListResponseSchema,
    {
      params: { organizationId, projectId },
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
  projectId: string,
  limit: number = MONITOR_RECENT_EVENTS_LIMIT,
): Promise<MonitorRecentEventsResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/recent-events",
    monitorRecentEventsResponseSchema,
    { params: { organizationId, projectId }, query: { limit } },
  );
}

export type MonitorResponseRange = "24h" | "7d" | "30d";

export function fetchMonitorDetail(
  organizationId: string,
  projectId: string,
  monitorId: string,
): Promise<MonitorDetailResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}",
    monitorDetailResponseSchema,
    { params: { organizationId, projectId, monitorId } },
  );
}

export function fetchMonitorChecks(
  organizationId: string,
  projectId: string,
  monitorId: string,
  page: { limit: number; offset: number },
): Promise<MonitorChecksResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/checks",
    monitorChecksResponseSchema,
    { params: { organizationId, projectId, monitorId }, query: page },
  );
}

export function fetchMonitorIncidents(
  organizationId: string,
  projectId: string,
  monitorId: string,
  page: { limit: number; offset: number },
): Promise<MonitorIncidentsResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/incidents",
    monitorIncidentsResponseSchema,
    { params: { organizationId, projectId, monitorId }, query: page },
  );
}

export function fetchMonitorEvents(
  organizationId: string,
  projectId: string,
  monitorId: string,
  page: { limit: number; offset: number },
): Promise<MonitorEventsResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/events",
    monitorEventsResponseSchema,
    { params: { organizationId, projectId, monitorId }, query: page },
  );
}

/** Project admin, Organization Owner or Admin only: the caller must not request it for anyone else. */
export function fetchMonitorLastResponse(
  organizationId: string,
  projectId: string,
  monitorId: string,
): Promise<MonitorLastResponseResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/last-response",
    monitorLastResponseResponseSchema,
    { params: { organizationId, projectId, monitorId } },
  );
}

export function fetchMonitorResponseTimes(
  organizationId: string,
  projectId: string,
  monitorId: string,
  range: MonitorResponseRange,
): Promise<MonitorResponseTimesResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/response-times",
    monitorResponseTimesResponseSchema,
    { params: { organizationId, projectId, monitorId }, query: { range } },
  );
}

export function pauseMonitor(
  organizationId: string,
  projectId: string,
  monitorId: string,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/pause",
    monitorWriteResponseSchema,
    { method: "POST", params: { organizationId, projectId, monitorId } },
  );
}

export function resumeMonitor(
  organizationId: string,
  projectId: string,
  monitorId: string,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/resume",
    monitorWriteResponseSchema,
    { method: "POST", params: { organizationId, projectId, monitorId } },
  );
}

export function deleteMonitor(
  organizationId: string,
  projectId: string,
  monitorId: string,
): Promise<undefined> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}",
    undefined,
    { method: "DELETE", params: { organizationId, projectId, monitorId } },
  );
}

export function createMonitor(
  organizationId: string,
  projectId: string,
  body: MonitorCreateBody,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors",
    monitorWriteResponseSchema,
    { method: "POST", params: { organizationId, projectId }, body },
  );
}

export function updateMonitor(
  organizationId: string,
  projectId: string,
  monitorId: string,
  body: MonitorEditBody,
): Promise<MonitorWriteResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}",
    monitorWriteResponseSchema,
    { method: "PATCH", params: { organizationId, projectId, monitorId }, body },
  );
}

/** Test of a configuration that is not saved yet; nothing is stored. */
export function testMonitorDraft(
  organizationId: string,
  projectId: string,
  body: MonitorTestCreateBody,
): Promise<MonitorTestResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/test",
    monitorTestResponseSchema,
    { method: "POST", params: { organizationId, projectId }, body },
  );
}

/** Test in the Edit form: the complete configuration; `keep` uses the stored secret, `replace` a value for this test only. */
export function testMonitorEdit(
  organizationId: string,
  projectId: string,
  monitorId: string,
  body: MonitorTestEditBody,
): Promise<MonitorTestResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/monitors/{monitorId}/test",
    monitorTestResponseSchema,
    { method: "POST", params: { organizationId, projectId, monitorId }, body },
  );
}
