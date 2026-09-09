import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { authClient } from "../auth-client";

function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

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
   * Query-consuming subtree key. The initial unresolved lifetime and the
   * first resolved identity share epoch 0, so hydrating the session never
   * remounts or detaches anything (e.g. TenantProvider's freshly mounted
   * /me query on an authenticated hard reload). Each later identity change
   * bumps the epoch, remounting the subtree synchronously with its new
   * client so a new identity can never render against the retired one.
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
 * has committed, and only ever the retired one. BrowserRouter lives
 * outside this boundary (see App.tsx), so navigation state and pending
 * invitation flows (carried in sessionStorage) survive identity changes.
 */
export function SessionQueryProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const identity: ResolvedIdentity | undefined = isPending
    ? undefined
    : (data?.user.id ?? null);

  const [boundary, setBoundary] = useState<SessionBoundary>(() => ({
    identity: undefined,
    client: createSessionQueryClient(),
    epoch: 0,
  }));
  const [retired, setRetired] = useState<QueryClient[]>([]);

  if (identity !== undefined && boundary.identity !== identity) {
    if (boundary.identity === undefined) {
      // Initial hydration: adopt the first resolved identity while keeping
      // the same client and epoch — nothing is cancelled, cleared, or
      // remounted.
      setBoundary({ ...boundary, identity });
    } else {
      // Resolved identity change (login, logout, account switch): move to
      // a fresh client and remount the query subtree in the same commit.
      setRetired([...retired, boundary.client]);
      setBoundary({
        identity,
        client: createSessionQueryClient(),
        epoch: boundary.epoch + 1,
      });
    }
  }

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
  }, [retired]);

  return (
    <QueryClientProvider client={boundary.client} key={boundary.epoch}>
      {children}
    </QueryClientProvider>
  );
}
