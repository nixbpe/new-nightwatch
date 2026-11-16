import type { AuditLogListResponse } from "@nightwatch/api-contract";
import { type LoaderFunctionArgs } from "react-router";
import {
  fetchAuditActors,
  fetchAuditEvent,
  fetchAuditEvents,
  floorToMinute,
  parseAuditFilters,
  toListParams,
  auditLogQueryKeys,
  customRangeError,
} from "../../api/audit-log";
import { formatAuditDate, readPreferences } from "../../preferences";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

// WEB-04: prefetch only for an Organization the user belongs to with a role that may read the log;
// anything else renders the page's own denied state and must not trigger a request.
async function resolveAuditReader(
  request: Request,
  organizationId: string | undefined,
): Promise<Response | { userId: string; organizationId: string } | null> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  if (organizationId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  const role = context?.organizations.find(
    (organization) => organization.id === organizationId,
  )?.role;
  return role === "owner" || role === "admin" || role === "auditor"
    ? { userId: sessionOrRedirect.user.id, organizationId }
    : null;
}

export async function auditLogLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const reader = await resolveAuditReader(request, params.organizationId);
  if (reader === null || reader instanceof Response) {
    return reader;
  }
  const filters = parseAuditFilters(new URL(request.url).searchParams);
  const preferences = readPreferences();
  const listParams = toListParams(filters, {
    now: floorToMinute(new Date()),
    timeZone: preferences.timeZone,
  });
  const queryClient = resolveQueryClientForIdentity(reader.userId);
  // An invalid custom range sends no request. The retained day is the one the page
  // knows too: the latest list already in the cache, if any.
  const known = queryClient
    .getQueriesData<AuditLogListResponse>({
      queryKey: auditLogQueryKeys
        .events(reader.organizationId, { offset: 0 })
        .slice(0, 4),
    })
    .find(([, data]) => data !== undefined)?.[1];
  const validRange =
    customRangeError(
      filters,
      known === undefined
        ? undefined
        : formatAuditDate(new Date(known.retainedFrom), preferences),
    ) === undefined;
  await Promise.all([
    validRange
      ? queryClient
          .query({
            queryKey: auditLogQueryKeys.events(
              reader.organizationId,
              listParams,
            ),
            queryFn: () => fetchAuditEvents(reader.organizationId, listParams),
            staleTime: "static",
            retry: false,
          })
          .catch(() => undefined)
      : Promise.resolve(),
    queryClient
      .query({
        queryKey: auditLogQueryKeys.actors(reader.organizationId),
        queryFn: () => fetchAuditActors(reader.organizationId),
        staleTime: "static",
        retry: false,
      })
      .catch(() => undefined),
  ]);
  return null;
}

// A missing or foreign event is left to the page, which shows the uniform "not found" state.
export async function auditLogEventLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const reader = await resolveAuditReader(request, params.organizationId);
  const eventId = params.eventId;
  if (reader === null || reader instanceof Response) {
    return reader;
  }
  if (eventId === undefined) {
    return null;
  }
  await resolveQueryClientForIdentity(reader.userId)
    .query({
      queryKey: auditLogQueryKeys.event(reader.organizationId, eventId),
      queryFn: () => fetchAuditEvent(reader.organizationId, eventId),
      staleTime: "static",
      retry: false,
    })
    .catch(() => undefined);
  return null;
}
