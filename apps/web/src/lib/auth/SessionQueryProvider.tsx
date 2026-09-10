import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { authClient } from "../auth-client";
import {
  createSessionQueryClient,
  peekStagedQueryClient,
  publishActiveQueryClient,
} from "../queryClient";

/**
 * Resolved identity: the signed-in user id, or null for a resolved
 * anonymous session. `undefined` means the session snapshot has not
 * resolved yet — the boundary must not treat that as an identity.
 */
type ResolvedIdentity = string | null;

type SessionBoundary = {
  /** Last resolved identity; undefined until the session first resolves. */
  identity: ResolvedIdentity | undefined;
  /** The client serving the current identity. */
  client: QueryClient;
  /**
   * Identity of the loader-staged client the initializer adopted, if any.
   * The loader of the initial URL and the session atom resolve
   * independently; if they disagree, the adopted client holds ANOTHER
   * identity's prefetch and must be discarded, never relabeled.
   */
  stagedIdentity: ResolvedIdentity | undefined;
  /**
   * Query-consuming subtree key. The initial unresolved lifetime and the
   * first resolved identity share epoch 0, so hydrating the session never
   * remounts or detaches anything (e.g. TenantProvider's freshly mounted
   * /me query on an authenticated hard reload). Each later identity change
   * — and a staged-identity mismatch on hydration — bumps the epoch,
   * remounting the subtree synchronously with its new client so a new
   * identity can never render against the retired one.
   */
  epoch: number;
};

/**
 * Per-identity query boundary. Every resolved auth identity (each user,
 * and the anonymous state) gets its own QueryClient lifetime and keyed
 * subtree, so a previous user's tenant data can never be served from
 * cache to the next user within the same SPA session.
 *
 * The swap is decided during render (not in an effect): when the resolved
 * identity differs from the boundary's, the tree re-renders immediately
 * with a fresh client and bumped epoch before React commits, so no
 * effect-phase pass can show the new identity against the old cache.
 * The outgoing client is cancelled and cleared only after the new client
 * has committed, and only ever the retired one. The router lives outside
 * this boundary (see router.tsx), so navigation state and pending
 * invitation flows (carried in sessionStorage) survive identity changes.
 */
export function SessionQueryProvider({
  children,
  onResolvedIdentityChange,
}: {
  children: ReactNode;
  /**
   * Called after a committed swap that retired a client: a
   * resolved→resolved identity change (login, logout, account switch) or
   * a staged-identity mismatch on hydration. The root layout wires this to
   * router revalidation so the data-mode gate loaders observe the new
   * session. Clean initial hydration retires nothing and never fires it.
   */
  onResolvedIdentityChange?: () => void;
}) {
  const { data, isPending } = authClient.useSession();
  const identity: ResolvedIdentity | undefined = isPending
    ? undefined
    : (data?.user.id ?? null);

  const [boundary, setBoundary] = useState<SessionBoundary>(() => {
    // A loader of the initial URL may have staged this identity's client
    // (with its prefetch) before the first render; start from it so the
    // prefetched data survives hydration — but remember WHO it was staged
    // for, so a loader/session disagreement cannot relabel it.
    const staged = peekStagedQueryClient();
    return {
      identity: undefined,
      client: staged?.client ?? createSessionQueryClient(),
      stagedIdentity: staged?.identity,
      epoch: 0,
    };
  });
  const [retired, setRetired] = useState<QueryClient[]>([]);

  if (identity !== undefined && boundary.identity !== identity) {
    // Pure read: a loader that already resolved this identity staged its
    // client (with the prefetch) for adoption. Render passes can be
    // discarded (StrictMode, concurrent aborts), so the registry is only
    // mutated after commit — publishActiveQueryClient drops a staged slot
    // whose identity never commits.
    const staged = peekStagedQueryClient();
    const stagedClient =
      staged !== null && staged.identity === identity
        ? staged.client
        : undefined;
    const adoptedMismatch =
      boundary.stagedIdentity !== undefined &&
      boundary.stagedIdentity !== identity;
    if (boundary.identity === undefined && !adoptedMismatch) {
      // Initial hydration: adopt the first resolved identity while keeping
      // the same client and epoch — nothing is cancelled, cleared, or
      // remounted. The staged client is the one the initializer peeked.
      setBoundary({ ...boundary, identity });
    } else {
      // Retire the outgoing client and remount with the staged or a fresh
      // one — either a resolved identity change (login, logout, account
      // switch) or the hydration mismatch above, where the initializer's
      // adopted client was prefetched for a DIFFERENT identity
      // (loader/session race) and must never be relabeled as this
      // identity's client.
      setRetired([...retired, boundary.client]);
      setBoundary({
        identity,
        client: stagedClient ?? createSessionQueryClient(),
        stagedIdentity: undefined,
        epoch: boundary.epoch + 1,
      });
    }
  }

  // Publish after commit so loaders of subsequent navigations resolve the
  // same client this tree consumes. Declared BEFORE the retirement effect
  // so a revalidation it triggers never races the publish.
  const activeIdentity = boundary.identity;
  const activeClient = boundary.client;
  useEffect(() => {
    if (activeIdentity !== undefined) {
      publishActiveQueryClient(activeIdentity, activeClient);
    }
  }, [activeIdentity, activeClient]);

  useEffect(() => {
    if (retired.length === 0) {
      return;
    }
    // The replacement client has committed; drop the old identities'
    // in-flight queries and caches.
    const outgoing = retired;
    setRetired([]);
    for (const client of outgoing) {
      void client.cancelQueries().then(() => {
        client.clear();
      });
    }
    // A resolved identity swap invalidates every gate decision the active
    // loaders made (login succeeded, session signed out): let the router
    // re-run them against the new session.
    onResolvedIdentityChange?.();
  }, [retired, onResolvedIdentityChange]);

  return (
    <QueryClientProvider client={boundary.client} key={boundary.epoch}>
      {children}
    </QueryClientProvider>
  );
}
