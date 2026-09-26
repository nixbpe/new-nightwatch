import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../api/me";
import { isInboxScopeChanged } from "../api/notifications";

type Membership = MeContextResponse["organizations"][number];

/**
 * All tenant-scoped query caches live under this prefix. Switching the
 * active organization cancels and clears the whole prefix so an in-flight
 * response for the previous tenant can never repopulate the new view.
 */
export const TENANT_QUERY_PREFIX = ["tenant"] as const;

type TenantContextValue = {
  me: MeContextResponse | undefined;
  mePending: boolean;
  meError: Error | null;
  retryMe: () => Promise<void>;
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
  const [orgSwitchPending, setOrgSwitchPending] = useState(false);

  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });

  // Organization selection is account-global: when an inbox request finds
  // the server resolving another scope (another session switched), refresh
  // the context so every tenant view re-keys to the server's scope.
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

  const memberships = meQuery.data?.organizations;
  const lastActiveTenantId = meQuery.data?.lastActiveTenantId ?? null;

  // A refreshed server mirror (e.g. another session switched the
  // account-global organization) supersedes this tab's earlier local choice;
  // otherwise the header and notifications would show different tenants.
  const [mirrorSeen, setMirrorSeen] = useState(lastActiveTenantId);
  if (mirrorSeen !== lastActiveTenantId) {
    setMirrorSeen(lastActiveTenantId);
    setSelectedOrgId(null);
  }

  // Selection precedence: valid in-memory choice, then the persisted
  // last-active tenant when still a membership, then the first membership.
  // React Compiler memoizes this derivation; the precedence order is
  // load-bearing and must not change.
  const activeOrg: Membership | null =
    memberships === undefined || memberships.length === 0
      ? null
      : (memberships.find((org) => org.id === selectedOrgId) ??
        memberships.find((org) => org.id === lastActiveTenantId) ??
        memberships[0] ??
        null);

  // Inbox scope comes only from the server-confirmed active mirror. The UI
  // falls back to a membership for navigation, but that fallback must never
  // make organization notifications visible or alter an inbox request.
  const serverActiveOrgId =
    memberships?.some((org) => org.id === lastActiveTenantId) === true
      ? lastActiveTenantId
      : null;

  // Guard, tenant-cache retirement and success ordering are behavioral
  // contracts; React Compiler handles render-performance memoization.
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
      // PATCH succeeded: retire the previous tenant's queries before
      // any new state publishes, so an in-flight response for the old
      // organization can never repopulate the new view.
      await queryClient.cancelQueries({ queryKey: TENANT_QUERY_PREFIX });
      queryClient.removeQueries({ queryKey: TENANT_QUERY_PREFIX });
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, updated);
      setSelectedOrgId(organizationId);
      return true;
    } catch {
      // Keep the previous tenant; the caller surfaces the error.
      return false;
    } finally {
      setOrgSwitchPending(false);
    }
  };

  const { refetch: refetchMe } = meQuery;
  const retryMe = async (): Promise<void> => {
    await refetchMe();
  };

  const value: TenantContextValue = {
    me: meQuery.data,
    mePending: meQuery.isPending,
    meError: meQuery.error,
    retryMe,
    activeOrg,
    serverActiveOrgId,
    switchOrg,
    orgSwitchPending,
  };

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}
