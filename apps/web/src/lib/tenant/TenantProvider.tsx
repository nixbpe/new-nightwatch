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
import {
  isInboxScopeChanged,
  markAllNotificationsRead,
} from "../api/notifications";
import {
  type ScopeHint,
  claimContextPublication,
  failContextPublication,
  createContextPublicationClaim,
  getContextPublicationSnapshot,
  hasContextPublicationClaim,
  publishContextPublication,
  subscribeToContextPublication,
} from "../queryClient";

import {
  assertContextIdentity,
  contextQueryOptions,
  recoverInboxScope,
} from "./bootstrap";

type Membership = MeContextResponse["organizations"][number];

// Switching organization clears this whole prefix so an in-flight response for the old tenant can't repopulate the new view.
export const TENANT_QUERY_PREFIX = ["tenant"] as const;

type TenantContextValue = {
  me: MeContextResponse | undefined;
  mePending: boolean;
  membershipInteraction: boolean;
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

  useQuery({
    ...contextQueryOptions(queryClient),
    refetchOnMount: false,
    refetchOnWindowFocus: () =>
      getContextPublicationSnapshot(queryClient).admission.kind === "confirmed",
    refetchOnReconnect: () =>
      getContextPublicationSnapshot(queryClient).admission.kind === "confirmed",
  });

  useEffect(() => {
    type Request = {
      actor: "query" | "mutation";
      generation: bigint | null;
      scopeHint: ScopeHint;
    };
    const queries = new WeakMap<object, Request>();
    const mutations = new WeakMap<object, Request>();
    const capture = (
      actor: Request["actor"],
      scopeHint: Request["scopeHint"],
    ): Request => ({
      actor,
      generation: getContextPublicationSnapshot(queryClient).requiredGeneration,
      scopeHint,
    });
    const recover = (error: unknown, request: Request | undefined) => {
      if (
        isInboxScopeChanged(error) &&
        error instanceof Error &&
        request !== undefined
      )
        void recoverInboxScope(queryClient, error, request);
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const query = queryClient.getQueryCache().get(event.query.queryHash);
      if (query === undefined || query !== event.query) return;
      if (event.action.type === "fetch") {
        const key = query.queryKey;
        queries.set(
          event.query,
          capture(
            "query",
            key[0] === "tenant" &&
              key[1] === "notifications" &&
              (key[2] === null || typeof key[2] === "string")
              ? { kind: "known", scope: key[2] }
              : { kind: "unknown" },
          ),
        );
      }
      if (event.action.type === "error")
        recover(event.action.error, queries.get(query));
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.action.type === "pending" && !mutations.has(event.mutation)) {
        const variables: unknown = event.mutation.state.variables;
        const commandScope =
          event.mutation.options.meta?.["notificationOperation"] ===
            "read-all" &&
          typeof variables === "object" &&
          variables !== null &&
          "expectedOrganizationId" in variables
            ? variables.expectedOrganizationId
            : undefined;
        const scope: unknown =
          event.mutation.options.mutationFn === markAllNotificationsRead
            ? variables
            : commandScope;
        mutations.set(
          event.mutation,
          capture(
            "mutation",
            scope === null || typeof scope === "string"
              ? { kind: "known", scope }
              : { kind: "unknown" },
          ),
        );
      }
      if (
        event.action.type === "error" &&
        queryClient
          .getMutationCache()
          .getAll()
          .some((mutation) => mutation === event.mutation)
      )
        recover(event.action.error, mutations.get(event.mutation));
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient]);

  const admission = publication.admission;
  const me = admission.kind === "confirmed" ? admission.context : undefined;
  const memberships = me?.organizations;
  const lastActiveTenantId = me?.lastActiveTenantId ?? null;

  const activeOrg: Membership | null =
    memberships?.find((org) => org.id === lastActiveTenantId) ?? null;
  const serverActiveOrgId = activeOrg?.id ?? null;

  const refreshMembershipContext =
    useCallback(async (): Promise<MeContextResponse | null> => {
      const claim = createContextPublicationClaim();
      if (!claimContextPublication(queryClient, claim, "membership")) {
        return null;
      }
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
        if (!publishContextPublication(queryClient, claim, updated))
          return null;
        return updated;
      } catch (error) {
        failContextPublication(queryClient, claim, error);
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
    const acceptedGeneration =
      getContextPublicationSnapshot(queryClient).requiredGeneration;
    const switchAdmissionCurrent = () => {
      const current = getContextPublicationSnapshot(queryClient);
      return (
        current.requiredGeneration === acceptedGeneration &&
        current.admission.kind === "confirmed"
      );
    };
    const intent = ++latestSwitchIntent.current;
    setOrgSwitchPending(true);
    const switchOperation = switchQueue.current.then(async () => {
      if (!switchAdmissionCurrent()) return false;
      const claim = createContextPublicationClaim();
      if (!claimContextPublication(queryClient, claim, "switch")) {
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
        if (!publishContextPublication(queryClient, claim, updated))
          return false;
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
    me,
    mePending:
      admission.kind === "unresolved" || admission.kind === "confirming",
    meError: admission.kind === "failed" ? admission.error : null,
    membershipInteraction:
      (admission.kind === "confirming" || admission.kind === "failed") &&
      admission.cause === "membership",
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
