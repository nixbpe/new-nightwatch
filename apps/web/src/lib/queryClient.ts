import { QueryClient } from "@tanstack/react-query";

import { isInboxScopeChanged } from "./api/notifications";

// `undefined` (not yet resolved) is distinct from null (resolved anonymous).
export type ResolvedIdentity = string | null;

type ClientSlot = {
  identity: ResolvedIdentity;
  client: QueryClient;
};

// Loaders must prefetch into the same per-identity client the tree consumes; a module-level
// singleton would serve one user's cache to the next. `staged` holds a client created before
// the provider commits that identity, so the provider can adopt it and keep the prefetch.
let active: ClientSlot | null = null;
let staged: ClientSlot | null = null;

const contextPublicationClaims = new WeakMap<QueryClient, bigint>();
let contextPublicationOrdinal = 0n;

type ContextPublicationSignal = {
  version: number;
  listeners: Set<() => void>;
};

const contextPublicationSignals = new WeakMap<
  QueryClient,
  ContextPublicationSignal
>();

function contextPublicationSignal(
  queryClient: QueryClient,
): ContextPublicationSignal {
  let signal = contextPublicationSignals.get(queryClient);
  if (signal === undefined) {
    signal = { version: 0, listeners: new Set() };
    contextPublicationSignals.set(queryClient, signal);
  }
  return signal;
}

export function getContextPublicationVersion(queryClient: QueryClient): number {
  return contextPublicationSignal(queryClient).version;
}

export function subscribeToContextPublication(
  queryClient: QueryClient,
  listener: () => void,
): () => void {
  const signal = contextPublicationSignal(queryClient);
  signal.listeners.add(listener);
  return () => {
    signal.listeners.delete(listener);
  };
}

export function publishContextPublication(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  if (!hasContextPublicationClaim(queryClient, claim)) {
    return false;
  }
  const signal = contextPublicationSignal(queryClient);
  signal.version += 1;
  for (const listener of signal.listeners) {
    listener();
  }
  return true;
}

export function createContextPublicationClaim(): bigint {
  return ++contextPublicationOrdinal;
}

export function claimContextPublication(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  if ((contextPublicationClaims.get(queryClient) ?? -1n) >= claim) {
    return false;
  }
  contextPublicationClaims.set(queryClient, claim);
  return true;
}

export function hasContextPublicationClaim(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  return contextPublicationClaims.get(queryClient) === claim;
}

// A server-confirmed organization scope retires every older context publisher.
export function publishTenantScope(queryClient: QueryClient): bigint {
  const claim = createContextPublicationClaim();
  claimContextPublication(queryClient, claim);
  return claim;
}

export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A changed inbox scope recovers via TenantProvider's context refresh; retrying only delays it.
        retry: (failureCount, error) =>
          failureCount < 1 && !isInboxScopeChanged(error),
      },
    },
  });
}

export function peekActiveQueryClientIdentity(): ResolvedIdentity | undefined {
  return active?.identity;
}

// Call only after the gating decision: a redirected loader must not stage clients.
export function resolveQueryClientForIdentity(
  identity: ResolvedIdentity,
): QueryClient {
  if (active !== null && active.identity === identity) {
    return active.client;
  }
  if (staged !== null && staged.identity === identity) {
    return staged.client;
  }
  staged = { identity, client: createSessionQueryClient() };
  return staged.client;
}

// Pure: render passes can be discarded, so nothing is consumed here.
export function peekStagedQueryClient(): ClientSlot | null {
  return staged;
}

// Drops a staged slot whose identity never committed (e.g. superseded by a redirect).
export function publishActiveQueryClient(
  identity: ResolvedIdentity,
  client: QueryClient,
): void {
  active = { identity, client };
  if (staged !== null && staged.identity !== identity) {
    staged = null;
  }
}

export function resetQueryClientRegistry(): void {
  active = null;
  staged = null;
}
