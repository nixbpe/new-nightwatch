import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../api/me";

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

  const memberships = meQuery.data?.organizations;
  const lastActiveTenantId = meQuery.data?.lastActiveTenantId ?? null;

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

  // Guard, tenant-cache retirement and success ordering are behavioral
  // contracts; React Compiler handles render-performance memoization.
  const switchOrg = async (
    organizationId: string,
  ): Promise<boolean> => {
    if (
      memberships?.some((org) => org.id === organizationId) !== true ||
      organizationId === activeOrg?.id
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
    switchOrg,
    orgSwitchPending,
  };

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}
