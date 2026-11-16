import type { MeContextResponse } from "@nightwatch/api-contract";
import { redirectDocument, replace } from "react-router";
import { contextQueryOptions } from "../../tenant/bootstrap";
import { authClient } from "../../auth-client";
import {
  peekActiveQueryClientIdentity,
  resolveQueryClientForIdentity,
} from "../../queryClient";

type Session = typeof authClient.$Infer.Session;

// Asks the server, not the cached client atom; any auth error counts as signed out.
export async function loadSession(): Promise<Session | null> {
  try {
    const { data, error } = await authClient.getSession();
    return error !== null ? null : (data ?? null);
  } catch {
    return null;
  }
}

export async function gateVerifiedSession(
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

export async function prefetchMeContext(
  userId: string,
): Promise<MeContextResponse | undefined> {
  const queryClient = resolveQueryClientForIdentity(userId);
  return queryClient
    .query({ ...contextQueryOptions(queryClient), staleTime: 0 })
    .catch(() => undefined);
}
