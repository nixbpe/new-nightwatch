import {
  auditLogActorsResponseSchema,
  auditLogEventResponseSchema,
  auditLogListResponseSchema,
  type AuditCategory,
  type AuditLogActorsResponse,
  type AuditLogEventResponse,
  type AuditLogListResponse,
} from "@nightwatch/api-contract";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request } from "./client";

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
