import type { MeContextResponse } from "@nightwatch/api-contract";
import type { QueryClient } from "@tanstack/react-query";

import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import {
  claimContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
  getQueryClientIdentity,
  publishContextPublication,
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

// One query per identity deduplicates parallel loaders. Every new navigation
// resolves afresh; static cached context cannot grant tenant admission.
export function contextQueryOptions(queryClient: QueryClient) {
  return {
    queryKey: ME_CONTEXT_QUERY_KEY,
    retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim);
      const previous =
        queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY);
      try {
        // A required fresh bootstrap retires in-flight tenant work immediately,
        // before a delayed resolver can confirm (or reject) its cached scope.
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
        const changed =
          previous !== undefined &&
          (previous.lastActiveTenantId !== context.lastActiveTenantId ||
            JSON.stringify(previous.organizations) !==
              JSON.stringify(context.organizations));
        if (changed) {
          await queryClient.cancelQueries({ queryKey: ["tenant"] });
          signal.throwIfAborted();
          if (!hasContextPublicationClaim(queryClient, claim)) {
            throw new Error("Context publication superseded");
          }
          queryClient.removeQueries({ queryKey: ["tenant"] });
        }
        publishContextPublication(queryClient, claim);
        return context;
      } catch (error) {
        if (!signal.aborted && hasContextPublicationClaim(queryClient, claim)) {
          await queryClient.cancelQueries({ queryKey: ["tenant"] });
          if (hasContextPublicationClaim(queryClient, claim)) {
            queryClient.removeQueries({ queryKey: ["tenant"] });
          }
        }
        throw error;
      }
    },
  };
}
