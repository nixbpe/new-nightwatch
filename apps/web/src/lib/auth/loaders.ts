import {
  redirectDocument,
  replace,
  type LoaderFunctionArgs,
} from "react-router";

import { fetchInvitation, invitationQueryKey } from "../api/invitations";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import { authClient } from "../auth-client";
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

/**
 * Fresh server-side session snapshot for loader gating. Unlike the
 * component guards, which read the (possibly stale) client-side session
 * atom, a loader always asks the server — so the forced recheck
 * RequireVerified performed after the email-verification callback is
 * inherent here: one fresh read, then admit or bounce. An unreachable or
 * erroring auth endpoint resolves to anonymous, matching the old guard's
 * data-null bounce.
 */
async function loadSession(): Promise<Session | null> {
  try {
    const { data, error } = await authClient.getSession();
    return error !== null ? null : (data ?? null);
  } catch {
    return null;
  }
}

/** "/" carries no page of its own; the workspace decides admission. */
export function rootLoader(): Response {
  return replace("/workspace");
}

/**
 * Anonymous-only gate (login, forgot/reset password). A signed-in arrival
 * continues to its post-auth destination — a remembered pending invitation
 * wins over the return path — consuming the return path exactly once, as
 * PostAuthRedirect did for in-page transitions. Redirects REPLACE the
 * history entry, matching the old <Navigate replace> guards.
 */
export async function requireAnonLoader(): Promise<null | Response> {
  const session = await loadSession();
  if (session === null) {
    return null;
  }
  const destination = readPostAuthDestination();
  clearReturnTo();
  return replace(destination);
}

/**
 * Auth + verified-email gate for protected routes. Bounces anonymous
 * arrivals to /login carrying the intended path (query included) so the
 * login continuation can resume it; bounces the unverified to the resend
 * hub. Redirect targets and replace semantics are identical to the old
 * RequireAuth/RequireVerified component guards.
 */
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
  if (activeIdentity !== undefined && activeIdentity !== session.user.id) {
    return redirectDocument(request.url);
  }
  return session;
}

/**
 * Prefetch the me/context contract — the primary data of both protected
 * pages — into the current identity's client, so the in-tree useQuery
 * consumes the cache instead of render-then-fetching. `staleTime: "static"`
 * is the non-deprecated ensureQueryData: return cached data when present,
 * fetch once when absent. A failed prefetch must not replace the page with
 * the router error boundary: the in-tree query surfaces the same error
 * state (with retry UI) as before.
 */
async function prefetchMeContext(userId: string): Promise<void> {
  await resolveQueryClientForIdentity(userId)
    .query({
      queryKey: ME_CONTEXT_QUERY_KEY,
      queryFn: fetchMeContext,
      staleTime: "static",
    })
    .catch(() => undefined);
}

/** /workspace — TenantProvider's me/context query is the prefetched primary data. */
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

/** /settings/* layout route — verified-session gate + me/context prefetch shared by every settings tab. */
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

/**
 * /verify-email — reachable anonymously (resend hub), so no gate. The one
 * prefetchable fetch is the remembered invitation's public preview that
 * prefills the anonymous email entry; signed-in visitors never run that
 * query, so nothing is staged for them.
 */
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
    // An unknown/expired invitation safely yields no prefill on the page;
    // it must not become a router-level error.
    .catch(() => undefined);
  return null;
}
