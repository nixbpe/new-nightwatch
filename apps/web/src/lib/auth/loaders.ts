import type {
  AuditLogListResponse,
  MeContextResponse,
} from "@nightwatch/api-contract";

import {
  redirectDocument,
  replace,
  type LoaderFunctionArgs,
} from "react-router";

import {
  fetchAuditActors,
  fetchAuditEvent,
  fetchAuditEvents,
  floorToMinute,
  parseAuditFilters,
  toListParams,
  auditLogQueryKeys,
  customRangeError,
} from "../api/audit-log";
import { fetchInvitation, invitationQueryKey } from "../api/invitations";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import {
  assertContextIdentity,
  contextQueryOptions,
} from "../tenant/bootstrap";
import {
  fetchMonitorDetail,
  fetchMonitorList,
  monitorQueryKeys,
  MONITOR_LIST_PAGE_SIZE,
  OVERVIEW_LIST_PARAMS,
} from "../api/monitors";
import { fetchOrganizationMembers, memberListQueryKey } from "../api/members";
import { authClient } from "../auth-client";
import { formatAuditDate, readPreferences } from "../preferences";
import {
  fetchNotifications,
  fetchOrganizationNotificationSettings,
  notificationQueryKey,
  organizationNotificationSettingsQueryKey,
} from "../api/notifications";
import { fetchSessions, SESSIONS_QUERY_KEY } from "../sessions/sessions";
import {
  claimContextPublication,
  failContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
  publishContextPublication,
  peekActiveQueryClientIdentity,
  resolveQueryClientForIdentity,
} from "../queryClient";
import {
  clearReturnTo,
  readInvitation,
  readPostAuthDestination,
} from "./continuation";

type Session = typeof authClient.$Infer.Session;

// Asks the server, not the cached client atom; any auth error counts as signed out.
async function loadSession(): Promise<Session | null> {
  try {
    const { data, error } = await authClient.getSession();
    return error !== null ? null : (data ?? null);
  } catch {
    return null;
  }
}

export function rootLoader(): Response {
  return replace("/workspace");
}

export async function requireAnonLoader(): Promise<null | Response> {
  const session = await loadSession();
  if (session === null) {
    return null;
  }
  const destination = readPostAuthDestination();
  clearReturnTo();
  return replace(destination);
}

async function gateVerifiedSession(
  request: Request,
): Promise<Session | Response> {
  const session = await loadSession();
  if (session === null) {
    const url = new URL(request.url);
    const from = url.pathname + url.search;
    return replace(`/login?from=${encodeURIComponent(from)}`);
  }
  if (!session.user.emailVerified) {
    return replace("/verify-email");
  }
  const activeIdentity = peekActiveQueryClientIdentity();
  // Another user's cache is loaded: reload the document to drop it.
  if (activeIdentity !== undefined && activeIdentity !== session.user.id) {
    return redirectDocument(request.url);
  }
  return session;
}

async function prefetchMeContext(
  userId: string,
): Promise<MeContextResponse | undefined> {
  const queryClient = resolveQueryClientForIdentity(userId);
  return queryClient
    .query({ ...contextQueryOptions(queryClient), staleTime: 0 })
    .catch(() => undefined);
}

function hasSameMembershipScope(
  previous: MeContextResponse | undefined,
  fresh: MeContextResponse,
): boolean {
  if (
    previous === undefined ||
    previous.lastActiveTenantId !== fresh.lastActiveTenantId ||
    previous.organizations.length !== fresh.organizations.length
  ) {
    return false;
  }
  return previous.organizations.every((previousOrganization) =>
    fresh.organizations.some(
      (freshOrganization) =>
        freshOrganization.id === previousOrganization.id &&
        freshOrganization.role === previousOrganization.role,
    ),
  );
}

export async function workspaceLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  const organization = context?.organizations.find(
    (item) => item.id === context.lastActiveTenantId,
  );
  if (organization !== undefined) {
    await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
      .query({
        queryKey: monitorQueryKeys.list(organization.id, OVERVIEW_LIST_PARAMS),
        queryFn: () => fetchMonitorList(organization.id, OVERVIEW_LIST_PARAMS),
        staleTime: "static",
      })
      .catch(() => undefined);
  }
  return null;
}

export async function notificationsLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (context === undefined) return null;
  const activeOrganizationId = context.organizations.some(
    (organization) => organization.id === context.lastActiveTenantId,
  )
    ? context.lastActiveTenantId
    : null;
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: notificationQueryKey(activeOrganizationId),
      queryFn: () => fetchNotifications(activeOrganizationId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

export async function notificationSettingsLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const organizationId = params.organizationId;
  if (organizationId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (context?.organizations.some((org) => org.id === organizationId) !== true)
    return null;
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: organizationNotificationSettingsQueryKey(organizationId),
      queryFn: () => fetchOrganizationNotificationSettings(organizationId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

// Prefetches the first list page only for an Organization the user belongs to;
// the page renders denied for any other and must not trigger a request for it.
export async function monitorsOverviewLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const organizationId = params.organizationId;
  if (organizationId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (
    context?.organizations.some(
      (organization) => organization.id === organizationId,
    ) !== true
  ) {
    return null;
  }
  const listParams = { limit: MONITOR_LIST_PAGE_SIZE, offset: 0 };
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: monitorQueryKeys.list(organizationId, listParams),
      queryFn: () => fetchMonitorList(organizationId, listParams),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

// Same membership check as the Overview loader; a missing or foreign monitor is
// left to the page, which shows the uniform "not found" state.
export async function monitorDetailLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const { organizationId, monitorId } = params;
  if (organizationId === undefined || monitorId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (
    context?.organizations.some(
      (organization) => organization.id === organizationId,
    ) !== true
  ) {
    return null;
  }
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: monitorQueryKeys.detail(organizationId, monitorId),
      queryFn: () => fetchMonitorDetail(organizationId, monitorId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

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
  // AC-11: an invalid custom range sends no request. The retained day is the one the page
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

// The form page gates on role itself (denied state), so this only warms the
// membership context the page reads.
export async function monitorCreateLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  await prefetchMeContext(sessionOrRedirect.user.id);
  return null;
}

// Edit pins the version it loads, so it always starts from a fresh read
// (staleTime 0) rather than a Detail poll that may be 30 s old.
export async function monitorEditLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const { organizationId, monitorId } = params;
  if (organizationId === undefined || monitorId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (
    context?.organizations.some(
      (organization) => organization.id === organizationId,
    ) !== true
  ) {
    return null;
  }
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: monitorQueryKeys.detail(organizationId, monitorId),
      queryFn: () => fetchMonitorDetail(organizationId, monitorId),
      staleTime: 0,
      // A missing monitor is the page's own state; a retry would only delay it.
      retry: false,
    })
    .catch(() => undefined);
  return null;
}

// AbortSignal changes across awaits; keep each check as a fresh read.
function isNavigationAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function organizationMembersLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const claim = createContextPublicationClaim();
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  if (isNavigationAborted(request.signal)) return null;
  const organizationId = params.organizationId;
  if (organizationId === undefined) return null;
  const queryClient = resolveQueryClientForIdentity(sessionOrRedirect.user.id);
  if (
    isNavigationAborted(request.signal) ||
    !claimContextPublication(queryClient, claim, "bootstrap")
  ) {
    return null;
  }
  const previousContext =
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY);
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  await queryClient.cancelQueries({
    queryKey: ME_CONTEXT_QUERY_KEY,
    exact: true,
  });
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  await queryClient.cancelQueries({ queryKey: ["tenant"] });
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  const context = await fetchMeContext()
    .then((fresh) => {
      assertContextIdentity(queryClient, fresh);
      return fresh;
    })
    .catch(() => undefined);
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  if (context === undefined) {
    failContextPublication(
      queryClient,
      claim,
      new Error("Context resolution failed"),
    );
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ME_CONTEXT_QUERY_KEY, exact: true });
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ["tenant"] });
    return null;
  }
  if (!hasSameMembershipScope(previousContext, context)) {
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ["tenant"] });
  }
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  publishContextPublication(queryClient, claim, context);
  const membership = context.organizations.find(
    (organization) => organization.id === organizationId,
  );
  if (
    membership === undefined ||
    (membership.role !== "owner" && membership.role !== "admin")
  ) {
    return null;
  }
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  const memberKey: readonly unknown[] = memberListQueryKey(
    organizationId,
    50,
    0,
  );
  const memberQuery = queryClient.getQueryCache().find({
    queryKey: memberKey,
    exact: true,
  });
  const staleTime = queryClient.defaultQueryOptions({
    queryKey: memberKey,
  }).staleTime;
  if (
    memberQuery === undefined ||
    memberQuery.isStaleByTime(
      typeof staleTime === "function" ? staleTime(memberQuery) : staleTime,
    )
  ) {
    const members = await fetchOrganizationMembers(organizationId, 50, 0).catch(
      () => undefined,
    );
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    if (members !== undefined) {
      queryClient.setQueryData(memberKey, members);
    }
  }
  return null;
}

export function settingsIndexLoader(): Response {
  return replace("/settings/profile");
}

// Runs in parallel with settingsLoader, which does the redirecting.
export async function sessionsLoader(): Promise<null> {
  const session = await loadSession();
  if (session === null || !session.user.emailVerified) {
    return null;
  }
  await resolveQueryClientForIdentity(session.user.id)
    .query({
      queryKey: SESSIONS_QUERY_KEY,
      queryFn: fetchSessions,
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

export async function settingsLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  await prefetchMeContext(sessionOrRedirect.user.id);
  return null;
}

export async function verifyEmailLoader(): Promise<null> {
  const session = await loadSession();
  const invitationId = session === null ? readInvitation() : null;
  if (invitationId === null) {
    return null;
  }
  await resolveQueryClientForIdentity(null)
    .query({
      queryKey: invitationQueryKey(invitationId),
      queryFn: () => fetchInvitation(invitationId),
      retry: false,
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}
