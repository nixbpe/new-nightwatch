import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient } from "@tanstack/react-query";

import { ME_CONTEXT_QUERY_KEY } from "./api/me";
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

const clientIdentities = new WeakMap<QueryClient, ResolvedIdentity>();

export function bindQueryClientIdentity(
  client: QueryClient,
  identity: ResolvedIdentity,
): void {
  const previous = clientIdentities.get(client);
  if (previous !== undefined && previous !== identity) {
    throw new Error("Query client identity cannot change");
  }
  clientIdentities.set(client, identity);
}

export function getQueryClientIdentity(
  client: QueryClient,
): ResolvedIdentity | undefined {
  return clientIdentities.get(client);
}

let contextPublicationOrdinal = 0n;

export type ScopeHint =
  { kind: "unknown" } | { kind: "known"; scope: string | null };
export type ScopeRecovery =
  { kind: "none" } | { kind: "recovered"; scope: string | null };
export type Admission =
  | { kind: "retired" }
  | { kind: "unresolved" }
  | { kind: "confirming"; cause: "bootstrap" | "membership" }
  | { kind: "confirming"; cause: "scope-recovery"; scopeHint: ScopeHint }
  | {
      kind: "confirmed";
      context: MeContextResponse;
      scopeRecovery: ScopeRecovery;
    }
  | { kind: "failed"; cause: "bootstrap" | "membership"; error: Error }
  | {
      kind: "failed";
      cause: "scope-recovery";
      scopeHint: ScopeHint;
      error: Error;
    };

export type ContextPublicationSnapshot = {
  admission: Admission;
  requiredGeneration: bigint | null;
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
      snapshot: {
        claim: null,
        publishedClaim: null,
        version: 0,
        requiredGeneration: null,
        admission: { kind: "unresolved" },
      },
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
  context: MeContextResponse,
): boolean {
  const store = contextPublicationStore(queryClient);
  if (store.snapshot.claim !== claim) {
    return false;
  }
  const pending = store.snapshot.admission;
  const scopeRecovery: ScopeRecovery =
    pending.kind === "confirming" &&
    pending.cause === "scope-recovery" &&
    pending.scopeHint.kind === "known"
      ? { kind: "recovered", scope: pending.scopeHint.scope }
      : { kind: "none" };
  store.snapshot = {
    claim,
    requiredGeneration: store.snapshot.requiredGeneration,
    publishedClaim: claim,
    admission: { kind: "confirmed", context, scopeRecovery },
    version: store.snapshot.version + 1,
  };
  queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, context);
  notifyContextPublication(store);
  return store.snapshot.claim === claim;
}

export function failContextPublication(
  queryClient: QueryClient,
  claim: bigint,
  error: unknown,
): void {
  const store = contextPublicationStore(queryClient);
  if (
    store.snapshot.claim !== claim ||
    store.snapshot.admission.kind !== "confirming"
  )
    return;
  store.snapshot = {
    ...store.snapshot,
    admission: {
      ...store.snapshot.admission,
      kind: "failed",
      error:
        error instanceof Error ? error : new Error("Context resolution failed"),
    },
  };
  notifyContextPublication(store);
}

export function retireContextPublication(queryClient: QueryClient): void {
  const store = contextPublicationStore(queryClient);
  if (store.snapshot.admission.kind === "retired") return;
  const claim = createContextPublicationClaim();
  store.snapshot = {
    ...store.snapshot,
    claim,
    requiredGeneration: claim,
    admission: { kind: "retired" },
  };
  notifyContextPublication(store);
}

export function createContextPublicationClaim(): bigint {
  return ++contextPublicationOrdinal;
}

export function claimContextPublication(
  queryClient: QueryClient,
  claim: bigint,
  intent:
    | "switch"
    | "bootstrap"
    | "membership"
    | { kind: "scope-recovery"; scopeHint: ScopeHint },
): boolean {
  const store = contextPublicationStore(queryClient);
  if (
    store.snapshot.admission.kind === "retired" ||
    (store.snapshot.claim !== null && store.snapshot.claim >= claim)
  ) {
    return false;
  }
  if (
    intent === "membership" &&
    store.snapshot.admission.kind !== "confirmed" &&
    !(
      (store.snapshot.admission.kind === "confirming" ||
        store.snapshot.admission.kind === "failed") &&
      store.snapshot.admission.cause === "membership"
    )
  )
    intent = "bootstrap";
  store.snapshot = {
    ...store.snapshot,
    claim,
    requiredGeneration:
      intent === "switch" ? store.snapshot.requiredGeneration : claim,
    admission:
      typeof intent !== "string"
        ? {
            kind: "confirming",
            cause: "scope-recovery",
            scopeHint: intent.scopeHint,
          }
        : intent === "switch"
          ? store.snapshot.admission
          : intent === "bootstrap" &&
              store.snapshot.admission.kind === "confirming" &&
              store.snapshot.admission.cause === "scope-recovery"
            ? store.snapshot.admission
            : { kind: "confirming", cause: intent },
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
  claimContextPublication(queryClient, claim, "switch");
  return claim;
}

export function createSessionQueryClient(
  identity?: ResolvedIdentity,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A changed inbox scope recovers via TenantProvider's context refresh; retrying only delays it.
        retry: (failureCount, error) =>
          failureCount < 1 && !isInboxScopeChanged(error),
      },
    },
  });
  if (identity !== undefined) bindQueryClientIdentity(client, identity);
  return client;
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
  staged = { identity, client: createSessionQueryClient(identity) };
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
  bindQueryClientIdentity(client, identity);
  active = { identity, client };
  if (staged !== null && staged.identity !== identity) {
    staged = null;
  }
}

export function resetQueryClientRegistry(): void {
  active = null;
  staged = null;
}
