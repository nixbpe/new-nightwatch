import type { MeContextResponse } from "@nightwatch/api-contract";

import {
  redirectDocument,
  replace,
  type LoaderFunctionArgs,
} from "react-router";

import { fetchInvitation, invitationQueryKey } from "../api/invitations";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import {
  fetchMonitorDetail,
  fetchMonitorList,
  monitorQueryKeys,
  MONITOR_LIST_PAGE_SIZE,
} from "../api/monitors";
import { fetchOrganizationMembers, memberListQueryKey } from "../api/members";
import { authClient } from "../auth-client";
import {
  fetchNotifications,
  fetchOrganizationNotificationSettings,
  notificationQueryKey,
  organizationNotificationSettingsQueryKey,
} from "../api/notifications";
import { fetchSessions, SESSIONS_QUERY_KEY } from "../sessions/sessions";
import {
  claimContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
  peekActiveQueryClientIdentity,
  publishContextPublication,
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

// staleTime "static" reuses cached data; a failed prefetch is left to the
// page's own query error state instead of the router error boundary.
async function prefetchMeContext(
  userId: string,
): Promise<MeContextResponse | undefined> {
  return resolveQueryClientForIdentity(userId)
    .query({
      queryKey: ME_CONTEXT_QUERY_KEY,
      queryFn: fetchMeContext,
      staleTime: "static",
    })
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
  await prefetchMeContext(sessionOrRedirect.user.id);
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
  const activeOrganizationId =
    context?.organizations.some(
      (organization) => organization.id === context.lastActiveTenantId,
    ) === true
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
    !claimContextPublication(queryClient, claim)
  ) {
    return null;
  }
  const previousContext =
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY);
  // A prior context or member query may have started before this membership
  // gate. Cancel it before the direct request can publish.
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
  // A bookmarked tenant route needs a fresh server membership decision, not a
  // static context cache that could predate a revocation or role change.
  const context = await fetchMeContext().catch(() => undefined);
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  if (context === undefined) {
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
  queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, context);
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  publishContextPublication(queryClient, claim);
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
