import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../api/me";
import { isInboxScopeChanged } from "../api/notifications";
import {
  claimContextPublication,
  createContextPublicationClaim,
  getContextPublicationSnapshot,
  hasContextPublicationClaim,
  publishContextPublication,
  subscribeToContextPublication,
} from "../queryClient";

import { assertContextIdentity, contextQueryOptions } from "./bootstrap";

type Membership = MeContextResponse["organizations"][number];

// Switching organization clears this whole prefix so an in-flight response for the old tenant can't repopulate the new view.
export const TENANT_QUERY_PREFIX = ["tenant"] as const;

type TenantContextValue = {
  me: MeContextResponse | undefined;
  mePending: boolean;
  meError: Error | null;
  retryMe: () => Promise<void>;
  refreshMembershipContext: () => Promise<MeContextResponse | null>;
  activeOrg: Membership | null;
  serverActiveOrgId: string | null;
  switchOrg: (organizationId: string) => Promise<boolean>;
  orgSwitchPending: boolean;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const value = useContext(TenantContext);
  if (value === null) {
    throw new Error("useTenant must be used inside <TenantProvider>");
  }
  return value;
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [membershipContextUnavailable, setMembershipContextUnavailable] =
    useState(false);
  const [orgSwitchPending, setOrgSwitchPending] = useState(false);
  const switchQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSwitchIntent = useRef(0);
  const publication = useSyncExternalStore(
    useCallback(
      (listener) => subscribeToContextPublication(queryClient, listener),
      [queryClient],
    ),
    useCallback(
      () => getContextPublicationSnapshot(queryClient),
      [queryClient],
    ),
  );

  const meQuery = useQuery({
    ...contextQueryOptions(queryClient),
    refetchOnMount: false,
  });

  useEffect(() => {
    const livePublication = getContextPublicationSnapshot(queryClient);
    if (
      meQuery.data !== undefined &&
      (!membershipContextUnavailable ||
        (publication.publishedClaim !== null &&
          livePublication.claim === publication.publishedClaim &&
          livePublication.publishedClaim === publication.publishedClaim))
    ) {
      setMembershipContextUnavailable(false);
    }
  }, [meQuery.data, membershipContextUnavailable, publication, queryClient]);

  useEffect(() => {
    const refreshOnScopeChange = (error: unknown) => {
      if (isInboxScopeChanged(error)) {
        void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
      }
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        refreshOnScopeChange(event.action.error);
      }
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        refreshOnScopeChange(event.action.error);
      }
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient]);

  const memberships = membershipContextUnavailable
    ? undefined
    : meQuery.isError
      ? undefined
      : meQuery.data?.organizations;
  const lastActiveTenantId = membershipContextUnavailable
    ? null
    : (meQuery.data?.lastActiveTenantId ?? null);

  const activeOrg: Membership | null =
    memberships?.find((org) => org.id === lastActiveTenantId) ?? null;
  const serverActiveOrgId = activeOrg?.id ?? null;

  const refreshMembershipContext =
    useCallback(async (): Promise<MeContextResponse | null> => {
      const claim = createContextPublicationClaim();
      if (!claimContextPublication(queryClient, claim)) {
        return null;
      }
      setMembershipContextUnavailable(true);
      await queryClient.cancelQueries({
        queryKey: ME_CONTEXT_QUERY_KEY,
        exact: true,
      });
      if (!hasContextPublicationClaim(queryClient, claim)) {
        return null;
      }
      await queryClient.cancelQueries({ queryKey: TENANT_QUERY_PREFIX });
      if (!hasContextPublicationClaim(queryClient, claim)) {
        return null;
      }
      queryClient.removeQueries({ queryKey: TENANT_QUERY_PREFIX });
      try {
        const updated = await fetchMeContext();
        assertContextIdentity(queryClient, updated);
        if (!hasContextPublicationClaim(queryClient, claim)) {
          return null;
        }
        queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, updated);
        publishContextPublication(queryClient, claim);
        setMembershipContextUnavailable(false);
        return updated;
      } catch {
        return null;
      }
    }, [queryClient]);

  const switchOrg = async (organizationId: string): Promise<boolean> => {
    if (
      memberships?.some((org) => org.id === organizationId) !== true ||
      organizationId === serverActiveOrgId
    ) {
      return false;
    }
    const intent = ++latestSwitchIntent.current;
    setOrgSwitchPending(true);
    const switchOperation = switchQueue.current.then(async () => {
      const claim = createContextPublicationClaim();
      if (!claimContextPublication(queryClient, claim)) {
        return false;
      }
      try {
        await queryClient.cancelQueries({
          queryKey: ME_CONTEXT_QUERY_KEY,
          exact: true,
        });
        if (!hasContextPublicationClaim(queryClient, claim)) return false;
        const updated = await updateActiveOrganization({ organizationId });
        assertContextIdentity(queryClient, updated);
        if (!hasContextPublicationClaim(queryClient, claim)) {
          return false;
        }
        await queryClient.cancelQueries({ queryKey: TENANT_QUERY_PREFIX });
        if (!hasContextPublicationClaim(queryClient, claim)) {
          return false;
        }
        queryClient.removeQueries({ queryKey: TENANT_QUERY_PREFIX });
        queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, updated);
        publishContextPublication(queryClient, claim);
        setMembershipContextUnavailable(false);
        return latestSwitchIntent.current === intent;
      } catch {
        return false;
      }
    });
    switchQueue.current = switchOperation.then(
      () => undefined,
      () => undefined,
    );
    return switchOperation.finally(() => {
      if (latestSwitchIntent.current === intent) {
        setOrgSwitchPending(false);
      }
    });
  };

  const retryMe = async (): Promise<void> => {
    await refreshMembershipContext();
  };

  const value: TenantContextValue = {
    me:
      membershipContextUnavailable || meQuery.isError
        ? undefined
        : meQuery.data,
    mePending: meQuery.isPending,
    meError: meQuery.error,
    retryMe,
    refreshMembershipContext,
    activeOrg,
    serverActiveOrgId,
    switchOrg,
    orgSwitchPending,
  };

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}
