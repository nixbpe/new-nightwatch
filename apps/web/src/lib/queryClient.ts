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

let contextPublicationOrdinal = 0n;

export type ContextPublicationSnapshot = {
  claim: bigint | null;
  publishedClaim: bigint | null;
  version: number;
};

type ContextPublicationStore = {
  snapshot: ContextPublicationSnapshot;
  listeners: Set<() => void>;
};

const contextPublicationStores = new WeakMap<
  QueryClient,
  ContextPublicationStore
>();

function contextPublicationStore(
  queryClient: QueryClient,
): ContextPublicationStore {
  let store = contextPublicationStores.get(queryClient);
  if (store === undefined) {
    store = {
      snapshot: { claim: null, publishedClaim: null, version: 0 },
      listeners: new Set(),
    };
    contextPublicationStores.set(queryClient, store);
  }
  return store;
}

function notifyContextPublication(store: ContextPublicationStore): void {
  for (const listener of store.listeners) {
    listener();
  }
}

export function getContextPublicationSnapshot(
  queryClient: QueryClient,
): ContextPublicationSnapshot {
  return contextPublicationStore(queryClient).snapshot;
}

export function subscribeToContextPublication(
  queryClient: QueryClient,
  listener: () => void,
): () => void {
  const store = contextPublicationStore(queryClient);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

export function publishContextPublication(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  const store = contextPublicationStore(queryClient);
  if (store.snapshot.claim !== claim) {
    return false;
  }
  store.snapshot = {
    claim,
    publishedClaim: claim,
    version: store.snapshot.version + 1,
  };
  notifyContextPublication(store);
  return true;
}

export function createContextPublicationClaim(): bigint {
  return ++contextPublicationOrdinal;
}

export function claimContextPublication(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  const store = contextPublicationStore(queryClient);
  if (store.snapshot.claim !== null && store.snapshot.claim >= claim) {
    return false;
  }
  store.snapshot = {
    ...store.snapshot,
    claim,
  };
  notifyContextPublication(store);
  return true;
}

export function hasContextPublicationClaim(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  return contextPublicationStore(queryClient).snapshot.claim === claim;
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
