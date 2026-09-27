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

const memberDirectoryLoaderClaims = new WeakMap<QueryClient, bigint>();
let memberDirectoryLoaderOrdinal = 0n;

export function createMemberDirectoryLoaderClaim(): bigint {
  return ++memberDirectoryLoaderOrdinal;
}

export function claimMemberDirectoryLoader(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  if ((memberDirectoryLoaderClaims.get(queryClient) ?? -1n) >= claim) {
    return false;
  }
  memberDirectoryLoaderClaims.set(queryClient, claim);
  return true;
}

export function hasMemberDirectoryLoaderClaim(
  queryClient: QueryClient,
  claim: bigint,
): boolean {
  return memberDirectoryLoaderClaims.get(queryClient) === claim;
}

// A server-confirmed organization scope makes every older directory gate stale.
export function publishTenantScope(queryClient: QueryClient): void {
  memberDirectoryLoaderClaims.set(queryClient, ++memberDirectoryLoaderOrdinal);
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
