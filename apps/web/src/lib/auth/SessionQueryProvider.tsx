import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { authClient } from "../auth-client";
import {
  bindQueryClientIdentity,
  retireContextPublication,
  createSessionQueryClient,
  peekStagedQueryClient,
  publishActiveQueryClient,
} from "../queryClient";

// `undefined` (not yet resolved) is distinct from null (resolved anonymous).
type ResolvedIdentity = string | null;

type SessionBoundary = {
  identity: ResolvedIdentity | undefined;
  client: QueryClient;
  // Identity the adopted loader-staged client was prefetched for; on mismatch it must be discarded, never relabeled.
  stagedIdentity: ResolvedIdentity | undefined;
  // Epoch 0 is shared by the unresolved and first resolved identity so hydration never remounts (e.g. TenantProvider's /me query); later changes bump it.
  epoch: number;
};

// Each identity gets its own QueryClient so one user's tenant data is never served to the next.
// The swap happens during render so no effect pass shows the new identity against the old cache.
// The router lives outside this boundary so navigation and pending invitations survive the swap.
export function SessionQueryProvider({
  children,
  onResolvedIdentityChange,
}: {
  children: ReactNode;
  // Fires only when a client was retired; clean initial hydration never fires it.
  onResolvedIdentityChange?: () => void;
}) {
  const { data, isPending } = authClient.useSession();
  const identity: ResolvedIdentity | undefined = isPending
    ? undefined
    : (data?.user.id ?? null);

  const [boundary, setBoundary] = useState<SessionBoundary>(() => {
    // Adopt a loader-staged client so its prefetch survives hydration, remembering whom it was staged for.
    const staged = peekStagedQueryClient();
    return {
      identity: undefined,
      client: staged?.client ?? createSessionQueryClient(identity),
      stagedIdentity: staged?.identity,
      epoch: 0,
    };
  });
  const [retired, setRetired] = useState<QueryClient[]>([]);

  if (identity !== undefined && boundary.identity !== identity) {
    // Only peek: render passes can be discarded, so the registry is mutated after commit.
    const staged = peekStagedQueryClient();
    const stagedClient =
      staged !== null && staged.identity === identity
        ? staged.client
        : undefined;
    const adoptedMismatch =
      boundary.stagedIdentity !== undefined &&
      boundary.stagedIdentity !== identity;
    if (boundary.identity === undefined && !adoptedMismatch) {
      bindQueryClientIdentity(boundary.client, identity);
      setBoundary({ ...boundary, identity });
    } else {
      setRetired([...retired, boundary.client]);
      setBoundary({
        identity,
        client: stagedClient ?? createSessionQueryClient(identity),
        stagedIdentity: undefined,
        epoch: boundary.epoch + 1,
      });
    }
  }

  // Declared before the retirement effect so the revalidation it triggers never races the publish.
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
    const outgoing = retired;
    setRetired([]);
    for (const client of outgoing) {
      retireContextPublication(client);
      void client.cancelQueries().then(() => {
        client.clear();
      });
    }
    // Gate decisions from the old session are stale; let the router re-run them.
    onResolvedIdentityChange?.();
  }, [retired, onResolvedIdentityChange]);

  return (
    <QueryClientProvider client={boundary.client} key={boundary.epoch}>
      {children}
    </QueryClientProvider>
  );
}
