import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  getContextPublicationSnapshot,
  subscribeToContextPublication,
} from "../../lib/queryClient";

/**
 * Stale-scope guard for one Organization's member page. The scope retires when
 * a server-confirmed publication switches away from this Organization or the
 * page unmounts; after that no in-flight completion may touch notices,
 * confirmations or caches. `isCurrentScope` is the synchronous check for async
 * completions, `scopeCurrent` the render-time value.
 */
export function useOrganizationScope(organizationId: string) {
  const queryClient = useQueryClient();
  const publicationVersion = useRef(
    getContextPublicationSnapshot(queryClient).version,
  );
  const lastPublishedOrganizationId = useRef(
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
      ?.lastActiveTenantId ?? null,
  );
  const retired = useRef(false);
  const unmounted = useRef(false);
  const isCurrentScope = useCallback(() => {
    const version = getContextPublicationSnapshot(queryClient).version;
    if (version !== publicationVersion.current) {
      const published =
        queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
          ?.lastActiveTenantId ?? null;
      if (
        published !== lastPublishedOrganizationId.current &&
        published !== organizationId
      ) {
        retired.current = true;
      }
      lastPublishedOrganizationId.current = published;
      publicationVersion.current = version;
    }
    return !retired.current && !unmounted.current;
  }, [organizationId, queryClient]);
  const scopeCurrent = useSyncExternalStore(
    useCallback(
      (listener) =>
        subscribeToContextPublication(queryClient, () => {
          isCurrentScope();
          listener();
        }),
      [queryClient, isCurrentScope],
    ),
    isCurrentScope,
  );
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);
  return { isCurrentScope, scopeCurrent };
}
