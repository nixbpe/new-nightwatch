import type { MeContextResponse } from "@nightwatch/api-contract";
import type { QueryClient } from "@tanstack/react-query";

import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import {
  claimContextPublication,
  failContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
  getQueryClientIdentity,
  publishContextPublication,
  getContextPublicationSnapshot,
  type ScopeHint,
  type ContextPublicationSnapshot,
} from "../queryClient";

export function assertContextIdentity(
  queryClient: QueryClient,
  context: MeContextResponse,
): void {
  const identity = getQueryClientIdentity(queryClient);
  if (
    identity === undefined ||
    identity === null ||
    context.user.id !== identity
  ) {
    throw new Error("Context identity does not match the verified session");
  }
}

export function contextScopeChanged(
  previous: MeContextResponse | undefined,
  context: MeContextResponse,
): boolean {
  return (
    previous !== undefined &&
    (previous.user.id !== context.user.id ||
      previous.lastActiveTenantId !== context.lastActiveTenantId ||
      JSON.stringify(previous.organizations) !==
        JSON.stringify(context.organizations))
  );
}

// A mounted history observer owns its private chunks while its page withdraws presentation.
// Other failed-admission caches retain the existing retirement semantics.
export function discardUnconfirmedTenantQueries(
  queryClient: QueryClient,
): void {
  queryClient.removeQueries({
    queryKey: ["tenant"],
    predicate: (query) =>
      !(
        query.queryKey[1] === "monitors" &&
        query.queryKey[3] === "checks-history" &&
        query.getObserversCount() > 0
      ),
  });
}

// One query per identity deduplicates parallel loaders. Every new navigation
// resolves afresh; static cached context cannot grant tenant admission.
export function contextQueryOptions(queryClient: QueryClient) {
  return {
    queryKey: ME_CONTEXT_QUERY_KEY,
    retry: false,
    retryOnMount: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim, "bootstrap");
      const previous =
        queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY);
      try {
        await queryClient.cancelQueries({ queryKey: ["tenant"] });
        signal.throwIfAborted();
        if (!hasContextPublicationClaim(queryClient, claim)) {
          throw new Error("Context publication superseded");
        }
        const context = await fetchMeContext({ signal });
        assertContextIdentity(queryClient, context);
        signal.throwIfAborted();
        if (!hasContextPublicationClaim(queryClient, claim)) {
          throw new Error("Context publication superseded");
        }
        const changed = contextScopeChanged(previous, context);
        if (changed) {
          await queryClient.cancelQueries({ queryKey: ["tenant"] });
          signal.throwIfAborted();
          if (!hasContextPublicationClaim(queryClient, claim)) {
            throw new Error("Context publication superseded");
          }
          queryClient.removeQueries({ queryKey: ["tenant"] });
        }
        if (!publishContextPublication(queryClient, claim, context)) {
          throw new Error("Context publication superseded");
        }
        signal.throwIfAborted();
        return context;
      } catch (error) {
        failContextPublication(queryClient, claim, error);
        if (!signal.aborted && hasContextPublicationClaim(queryClient, claim)) {
          await queryClient.cancelQueries({ queryKey: ["tenant"] });
          if (hasContextPublicationClaim(queryClient, claim))
            discardUnconfirmedTenantQueries(queryClient);
        }
        throw error;
      }
    },
  };
}

export type InboxScopeRequest = Readonly<
  Pick<ContextPublicationSnapshot, "requiredGeneration" | "publishedClaim"> & {
    actor: "query" | "mutation";
    identity: ReturnType<typeof getQueryClientIdentity>;
    scopeHint: Readonly<ScopeHint>;
  }
>;

export async function recoverInboxScope(
  queryClient: QueryClient,
  error: Error,
  request: InboxScopeRequest,
): Promise<void> {
  const publication = getContextPublicationSnapshot(queryClient);
  if (
    publication.requiredGeneration !== request.requiredGeneration ||
    publication.publishedClaim !== request.publishedClaim ||
    getQueryClientIdentity(queryClient) !== request.identity ||
    publication.admission.kind !== "confirmed"
  )
    return;
  const admission = publication.admission;
  const currentScope = admission.context.organizations.some(
    (org) => org.id === admission.context.lastActiveTenantId,
  )
    ? admission.context.lastActiveTenantId
    : null;
  if (
    request.scopeHint.kind === "known" &&
    request.scopeHint.scope !== currentScope
  )
    return;
  const repeated =
    request.scopeHint.kind === "known" &&
    admission.scopeRecovery.kind === "recovered" &&
    admission.scopeRecovery.scope === request.scopeHint.scope;
  const claim = createContextPublicationClaim();
  if (
    !claimContextPublication(queryClient, claim, {
      kind: "scope-recovery",
      scopeHint: request.scopeHint,
    })
  )
    return;
  if (
    repeated ||
    (request.actor === "query" && request.scopeHint.kind === "unknown")
  ) {
    failContextPublication(queryClient, claim, error);
    await queryClient.cancelQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
    if (!hasContextPublicationClaim(queryClient, claim)) return;
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (hasContextPublicationClaim(queryClient, claim))
      queryClient.removeQueries({ queryKey: ["tenant"] });
  } else {
    await queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
  }
}
