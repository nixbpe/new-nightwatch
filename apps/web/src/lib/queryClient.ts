import { QueryClient } from "@tanstack/react-query";

/**
 * Resolved identity: the signed-in user id, or null for a resolved
 * anonymous session. `undefined` means the session snapshot has not
 * resolved yet — no client is keyed to it.
 */
export type ResolvedIdentity = string | null;

type ClientSlot = {
  identity: ResolvedIdentity;
  client: QueryClient;
};

/**
 * Loader-facing registry for the per-identity QueryClient. Loaders run
 * outside React and must prefetch into the SAME client the rendered tree of
 * that identity will consume — never a module-level singleton, which would
 * serve one user's cache to the next user inside the same SPA session.
 *
 * Two slots bridge the timing gap between loaders and React:
 * - `active`: the client the committed tree is consuming right now,
 *   published by SessionQueryProvider.
 * - `staged`: created when a loader resolves an identity before
 *   SessionQueryProvider has committed it (initial hard load, or a loader
 *   running ahead of the identity swap). The provider ADOPTS the staged
 *   client when it commits that identity, so the prefetch survives.
 */
let active: ClientSlot | null = null;
let staged: ClientSlot | null = null;

/** Defaults shared by every per-identity client (was SessionQueryProvider-local). */
export function createSessionQueryClient(): QueryClient {
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
 * Identity of the QueryClient consumed by the currently committed tree.
 * `undefined` means no provider boundary has committed yet; `null` is the
 * distinct, committed anonymous identity.
 */
export function peekActiveQueryClientIdentity():
  | ResolvedIdentity
  | undefined {
  return active?.identity;
}

/**
 * Loader entry point: the client of the given identity, resolved at run
 * time. Returns the active client when the committed tree already serves
 * this identity; otherwise stages (or reuses) a client the provider will
 * adopt on commit. Call only AFTER the gating decision — a redirected
 * loader must not stage clients.
 */
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

/**
 * The staged slot, for the provider's adoption reads. Pure: render passes
 * can be discarded, so nothing is consumed here — publishActiveQueryClient
 * owns the staged slot's lifecycle once a tree commits.
 */
export function peekStagedQueryClient(): ClientSlot | null {
  return staged;
}

/**
 * SessionQueryProvider publishes the client its committed tree consumes.
 * A staged slot for any other identity is dropped: its loader resolved an
 * identity that never committed (e.g. a follow-up redirect superseded it).
 */
export function publishActiveQueryClient(
  identity: ResolvedIdentity,
  client: QueryClient,
): void {
  active = { identity, client };
  if (staged !== null && staged.identity !== identity) {
    staged = null;
  }
}

/** Test hook: drop all registry state between scenarios. */
export function resetQueryClientRegistry(): void {
  active = null;
  staged = null;
}
