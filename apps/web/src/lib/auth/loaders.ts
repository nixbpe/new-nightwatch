import type { MeContextResponse } from "@nightwatch/api-contract";

import {
  redirectDocument,
  replace,
  type LoaderFunctionArgs,
} from "react-router";
import type { QueryClient } from "@tanstack/react-query";

import { fetchInvitation, invitationQueryKey } from "../api/invitations";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
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
  peekActiveQueryClientIdentity,
  resolveQueryClientForIdentity,
} from "../queryClient";
import {
  clearReturnTo,
  readInvitation,
  readPostAuthDestination,
} from "./continuation";

type Session = typeof authClient.$Infer.Session;

const organizationMembersLoaderClaims = new WeakMap<QueryClient, bigint>();
let organizationMembersLoaderOrdinal = 0n;

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

export async function organizationMembersLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const invocationOrdinal = ++organizationMembersLoaderOrdinal;
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const organizationId = params.organizationId;
  if (organizationId === undefined) return null;
  const queryClient = resolveQueryClientForIdentity(sessionOrRedirect.user.id);
  if (
    (organizationMembersLoaderClaims.get(queryClient) ?? -1n) >=
    invocationOrdinal
  ) {
    return null;
  }
  organizationMembersLoaderClaims.set(queryClient, invocationOrdinal);
  const previousContext =
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY);
  // A prior context or member query may have started before this membership
  // gate. Cancel it before the direct request can publish.
  await queryClient.cancelQueries({
    queryKey: ME_CONTEXT_QUERY_KEY,
    exact: true,
  });
  if (organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal) {
    return null;
  }
  await queryClient.cancelQueries({ queryKey: ["tenant"] });
  if (organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal) {
    return null;
  }
  // A bookmarked tenant route needs a fresh server membership decision, not a
  // static context cache that could predate a revocation or role change.
  const context = await fetchMeContext().catch(() => undefined);
  if (organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal) {
    return null;
  }
  if (context === undefined) {
    queryClient.removeQueries({ queryKey: ME_CONTEXT_QUERY_KEY, exact: true });
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (
      organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ["tenant"] });
    return null;
  }
  if (!hasSameMembershipScope(previousContext, context)) {
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (
      organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ["tenant"] });
  }
  queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, context);
  const membership = context.organizations.find(
    (organization) => organization.id === organizationId,
  );
  if (
    membership === undefined ||
    (membership.role !== "owner" && membership.role !== "admin")
  ) {
    return null;
  }
  if (organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal) {
    return null;
  }
  await queryClient
    .query({
      queryKey: memberListQueryKey(organizationId, 50, 0),
      queryFn: () => fetchOrganizationMembers(organizationId, 50, 0),
      staleTime: "static",
    })
    .catch(() => undefined);
  if (organizationMembersLoaderClaims.get(queryClient) !== invocationOrdinal) {
    return null;
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
