import type { MeContextResponse } from "@nightwatch/api-contract";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
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
  getQueryClientIdentity,
  hasContextPublicationClaim,
  publishContextPublication,
  subscribeToContextPublication,
} from "../queryClient";

import {
  assertContextIdentity,
  contextQueryOptions,
  recoverInboxScope,
  type InboxScopeRequest,
} from "./bootstrap";

import {
  selfLeaveDestination,
  type SelfLeaveInput,
  type SelfLeaveOrigin,
  type SelfLeaveView,
} from "./selfLeave";

type ConfirmationBinding = Readonly<{
  client: QueryClient;
  identity: ReturnType<typeof getQueryClientIdentity>;
  claim: bigint;
  requiredGeneration: bigint;
}>;
type SelfLeaveSource = SelfLeaveInput & { controller: AbortController };
type SelfLeaveRecord =
  | { kind: "idle" }
  | {
      kind: "confirming" | "refresh-failed";
      source: SelfLeaveSource;
      binding: ConfirmationBinding;
    }
  | {
      kind: "ready";
      source: SelfLeaveSource;
      binding: ConfirmationBinding;
      destination: string | null;
    }
  | {
      kind: "not-left";
      source: SelfLeaveSource;
      binding: ConfirmationBinding;
      notice: "last-owner" | "other";
    };
type ConfirmationOutcome =
  | {
      kind: "confirmed";
      binding: ConfirmationBinding;
      context: MeContextResponse;
    }
  | { kind: "failed"; binding: ConfirmationBinding }
  | { kind: "superseded" };

function sourceCurrent(source: SelfLeaveSource): boolean {
  return (
    !source.controller.signal.aborted &&
    !source.origin.signal.aborted &&
    source.origin.isCurrent()
  );
}

type Membership = MeContextResponse["organizations"][number];

// Switching organization clears this whole prefix so an in-flight response for the old tenant can't repopulate the new view.
export const TENANT_QUERY_PREFIX = ["tenant"] as const;

type TenantContextValue = {
  selfLeave: SelfLeaveView;
  settleSelfLeave: (input: SelfLeaveInput) => Promise<void>;
  retrySelfLeave: (origin: SelfLeaveOrigin) => Promise<void>;
  deliverSelfLeave: (
    origin: SelfLeaveOrigin,
    navigate: (organizationId: string | null) => void,
  ) => boolean;
  consumeSelfLeaveNotice: (organizationId: string) => void;
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
  const selfLeaveRecord = useRef<SelfLeaveRecord>({ kind: "idle" });
  const [renderedSelfLeave, renderSelfLeave] = useState<SelfLeaveRecord>(
    selfLeaveRecord.current,
  );
  const setSelfLeave = useCallback((record: SelfLeaveRecord) => {
    selfLeaveRecord.current = record;
    renderSelfLeave(record);
  }, []);
  const bindingCurrent = useCallback(
    (binding: ConfirmationBinding) => {
      const current = getContextPublicationSnapshot(queryClient);
      return (
        binding.client === queryClient &&
        getQueryClientIdentity(queryClient) === binding.identity &&
        current.claim === binding.claim &&
        current.requiredGeneration === binding.requiredGeneration &&
        current.admission.kind !== "retired"
      );
    },
    [queryClient],
  );
  useEffect(() => {
    const retire = () => {
      const record = selfLeaveRecord.current;
      if (
        record.kind !== "idle" &&
        (!bindingCurrent(record.binding) || !sourceCurrent(record.source))
      ) {
        record.source.controller.abort();
        setSelfLeave({ kind: "idle" });
      }
    };
    const stop = subscribeToContextPublication(queryClient, retire);
    return () => {
      stop();
      const record = selfLeaveRecord.current;
      if (record.kind !== "idle") record.source.controller.abort();
      selfLeaveRecord.current = { kind: "idle" };
    };
  }, [queryClient, bindingCurrent, setSelfLeave]);
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
    const queries = new WeakMap<object, InboxScopeRequest>();
    const mutations = new WeakMap<object, InboxScopeRequest>();
    const capture = (
      actor: InboxScopeRequest["actor"],
      scopeHint: ScopeHint,
    ): InboxScopeRequest => {
      const publication = getContextPublicationSnapshot(queryClient);
      return {
        actor,
        requiredGeneration: publication.requiredGeneration,
        publishedClaim: publication.publishedClaim,
        identity: getQueryClientIdentity(queryClient),
        scopeHint,
      };
    };
    const recover = (
      error: unknown,
      request: InboxScopeRequest | undefined,
    ) => {
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

  const confirmMembership = useCallback(
    async (source?: SelfLeaveSource): Promise<ConfirmationOutcome> => {
      const claim = createContextPublicationClaim();
      const binding: ConfirmationBinding = {
        client: queryClient,
        identity: getQueryClientIdentity(queryClient),
        claim,
        requiredGeneration: claim,
      };
      if (source !== undefined)
        setSelfLeave({ kind: "confirming", source, binding });
      const owns = () =>
        bindingCurrent(binding) &&
        (source === undefined ||
          (selfLeaveRecord.current.kind !== "idle" &&
            selfLeaveRecord.current.source === source &&
            sourceCurrent(source)));
      if (!claimContextPublication(queryClient, claim, "membership"))
        return { kind: "superseded" };
      await queryClient.cancelQueries({
        queryKey: ME_CONTEXT_QUERY_KEY,
        exact: true,
      });
      if (!owns()) return { kind: "superseded" };
      await queryClient.cancelQueries({ queryKey: TENANT_QUERY_PREFIX });
      if (!owns()) return { kind: "superseded" };
      queryClient.removeQueries({ queryKey: TENANT_QUERY_PREFIX });
      try {
        const context = await fetchMeContext(
          source === undefined
            ? undefined
            : { signal: source.controller.signal },
        );
        if (!owns()) return { kind: "superseded" };
        if (source !== undefined && context.user.id !== binding.identity) {
          failContextPublication(
            queryClient,
            claim,
            new Error("Context identity does not match the verified session"),
          );
          source.controller.abort();
          setSelfLeave({ kind: "idle" });
          return { kind: "superseded" };
        }
        assertContextIdentity(queryClient, context);
        if (!publishContextPublication(queryClient, claim, context) || !owns())
          return { kind: "superseded" };
        return { kind: "confirmed", binding, context };
      } catch (error) {
        if (!owns()) return { kind: "superseded" };
        failContextPublication(queryClient, claim, error);
        return owns() ? { kind: "failed", binding } : { kind: "superseded" };
      }
    },
    [queryClient, bindingCurrent, setSelfLeave],
  );
  const refreshMembershipContext =
    useCallback(async (): Promise<MeContextResponse | null> => {
      const outcome = await confirmMembership();
      return outcome.kind === "confirmed" ? outcome.context : null;
    }, [confirmMembership]);
  const settleSelfLeave = async (input: SelfLeaveInput): Promise<void> => {
    if (input.origin.signal.aborted || !input.origin.isCurrent()) return;
    const previous = selfLeaveRecord.current;
    if (previous.kind !== "idle" && previous.kind !== "refresh-failed") return;
    if (previous.kind !== "idle") previous.source.controller.abort();
    const source: SelfLeaveSource = {
      ...input,
      controller: new AbortController(),
    };
    const retire = () => {
      source.controller.abort();
      const record = selfLeaveRecord.current;
      if (record.kind !== "idle" && record.source === source)
        setSelfLeave({ kind: "idle" });
    };
    input.origin.signal.addEventListener("abort", retire, { once: true });
    source.controller.signal.addEventListener(
      "abort",
      () => {
        input.origin.signal.removeEventListener("abort", retire);
      },
      { once: true },
    );
    const outcome = await confirmMembership(source);
    if (outcome.kind === "superseded" || !sourceCurrent(source)) {
      retire();
      return;
    }
    if (outcome.kind === "failed") {
      setSelfLeave({
        kind: "refresh-failed",
        source,
        binding: outcome.binding,
      });
    } else if (
      outcome.context.organizations.some(
        (organization) => organization.id === input.organizationId,
      )
    ) {
      setSelfLeave({
        kind: "not-left",
        source,
        binding: outcome.binding,
        notice: input.attempt === "last-owner" ? "last-owner" : "other",
      });
    } else {
      setSelfLeave({
        kind: "ready",
        source,
        binding: outcome.binding,
        destination: selfLeaveDestination(outcome.context),
      });
    }
  };
  const retrySelfLeave = async (origin: SelfLeaveOrigin): Promise<void> => {
    const record = selfLeaveRecord.current;
    if (
      record.kind !== "refresh-failed" ||
      record.source.origin !== origin ||
      !bindingCurrent(record.binding) ||
      !sourceCurrent(record.source)
    )
      return;
    await settleSelfLeave(record.source);
  };
  const deliverSelfLeave = (
    origin: SelfLeaveOrigin,
    navigate: (organizationId: string | null) => void,
  ): boolean => {
    const record = selfLeaveRecord.current;
    const current = getContextPublicationSnapshot(queryClient);
    if (
      record.kind !== "ready" ||
      record.source.origin !== origin ||
      !sourceCurrent(record.source) ||
      !bindingCurrent(record.binding) ||
      current.admission.kind !== "confirmed" ||
      current.publishedClaim !== record.binding.claim
    )
      return false;
    record.source.controller.abort();
    setSelfLeave({ kind: "idle" });
    navigate(record.destination);
    return true;
  };
  const consumeSelfLeaveNotice = (organizationId: string) => {
    const record = selfLeaveRecord.current;
    if (
      record.kind === "not-left" &&
      record.source.organizationId === organizationId &&
      bindingCurrent(record.binding) &&
      sourceCurrent(record.source)
    ) {
      record.source.controller.abort();
      setSelfLeave({ kind: "idle" });
    }
  };
  const selfLeave: SelfLeaveView =
    renderedSelfLeave.kind === "idle" ||
    !bindingCurrent(renderedSelfLeave.binding) ||
    !sourceCurrent(renderedSelfLeave.source)
      ? { kind: "idle" }
      : renderedSelfLeave.kind === "not-left"
        ? {
            kind: "not-left",
            organizationId: renderedSelfLeave.source.organizationId,
            notice: renderedSelfLeave.notice,
          }
        : {
            kind: renderedSelfLeave.kind,
            organizationId: renderedSelfLeave.source.organizationId,
          };

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
    const record = selfLeaveRecord.current;
    if (record.kind === "refresh-failed") {
      await retrySelfLeave(record.source.origin);
      return;
    }
    await refreshMembershipContext();
  };

  const value: TenantContextValue = {
    selfLeave,
    settleSelfLeave,
    retrySelfLeave,
    deliverSelfLeave,
    consumeSelfLeaveNotice,
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
