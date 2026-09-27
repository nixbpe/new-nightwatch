import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  publishTenantScope,
  subscribeToContextPublication,
} from "../queryClient";

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
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [membershipContextUnavailable, setMembershipContextUnavailable] =
    useState(false);
  const [orgSwitchPending, setOrgSwitchPending] = useState(false);
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
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });

  useEffect(() => {
    if (
      meQuery.data !== undefined &&
      (!membershipContextUnavailable ||
        publication.claim === publication.publishedClaim)
    ) {
      setMembershipContextUnavailable(false);
    }
  }, [meQuery.data, membershipContextUnavailable, publication]);

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
    : meQuery.data?.organizations;
  const lastActiveTenantId = membershipContextUnavailable
    ? null
    : (meQuery.data?.lastActiveTenantId ?? null);

  // A refreshed server mirror (another session switched org) supersedes this tab's local choice,
  // otherwise the header and notifications would show different tenants.
  const [mirrorSeen, setMirrorSeen] = useState(lastActiveTenantId);
  if (mirrorSeen !== lastActiveTenantId) {
    setMirrorSeen(lastActiveTenantId);
    setSelectedOrgId(null);
  }

  // Precedence is load-bearing: in-memory choice, then persisted last-active membership, then the first.
  const activeOrg: Membership | null =
    memberships === undefined || memberships.length === 0
      ? null
      : (memberships.find((org) => org.id === selectedOrgId) ??
        memberships.find((org) => org.id === lastActiveTenantId) ??
        memberships[0] ??
        null);

  // Inbox scope uses only the server-confirmed org; the UI fallback must never widen notification visibility.
  const serverActiveOrgId =
    memberships?.some((org) => org.id === lastActiveTenantId) === true
      ? lastActiveTenantId
      : null;

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
        if (!hasContextPublicationClaim(queryClient, claim)) {
          return null;
        }
        queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, updated);
        setSelectedOrgId(null);
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
    setOrgSwitchPending(true);
    try {
      const updated = await updateActiveOrganization({ organizationId });
      const claim = publishTenantScope(queryClient);
      await queryClient.cancelQueries({ queryKey: TENANT_QUERY_PREFIX });
      if (!hasContextPublicationClaim(queryClient, claim)) {
        return false;
      }
      queryClient.removeQueries({ queryKey: TENANT_QUERY_PREFIX });
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, updated);
      setMembershipContextUnavailable(false);
      setSelectedOrgId(organizationId);
      return true;
    } catch {
      return false;
    } finally {
      setOrgSwitchPending(false);
    }
  };

  const retryMe = async (): Promise<void> => {
    await refreshMembershipContext();
  };

  const value: TenantContextValue = {
    me: membershipContextUnavailable ? undefined : meQuery.data,
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
