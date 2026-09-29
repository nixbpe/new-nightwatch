import {
  MONITOR_LIST_DEFAULT_LIMIT,
  MONITOR_RECENT_EVENTS_DEFAULT,
  monitorListResponseSchema,
  monitorRecentEventsResponseSchema,
  type MonitorHealthName,
  type MonitorListResponse,
} from "@nightwatch/api-contract";

import type { z } from "zod";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request } from "./client";

export type MonitorRecentEventsResponse = z.infer<
  typeof monitorRecentEventsResponseSchema
>;

export const MONITOR_LIST_PAGE_SIZE = MONITOR_LIST_DEFAULT_LIMIT;
export const MONITOR_RECENT_EVENTS_LIMIT = MONITOR_RECENT_EVENTS_DEFAULT;
// The Overview and its recent-events card refetch on this interval without announcing it.
export const MONITOR_REFETCH_INTERVAL_MS = 30_000;

export type MonitorListParams = {
  limit: number;
  offset: number;
  health?: MonitorHealthName;
  q?: string;
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
  checks: (
    organizationId: string,
    monitorId: string,
    page: { limit: number; offset: number },
  ) =>
    [
      ...TENANT_QUERY_PREFIX,
      "monitors",
      organizationId,
      "checks",
      monitorId,
      page,
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
  responseTimes: (organizationId: string, monitorId: string, range: string) =>
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
