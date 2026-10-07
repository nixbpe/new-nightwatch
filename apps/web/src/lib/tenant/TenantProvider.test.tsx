import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import { bindQueryClientIdentity } from "../queryClient";
import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../api/me";
import {
  claimContextPublication,
  createContextPublicationClaim,
  getContextPublicationSnapshot,
  publishActiveQueryClient,
  publishContextPublication,
  resetQueryClientRegistry,
  subscribeToContextPublication,
} from "../queryClient";
import { organizationMembersLoader } from "../auth/loaders";
import { TenantProvider, useTenant } from "./TenantProvider";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(() =>
    Promise.resolve({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
          emailVerified: true,
        },
      },
      error: null,
    }),
  ),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ getSession: getSessionMock }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);

const me: MeContextResponse = {
  user: {
    id: "user-1",
    name: "ผู้ใช้ทดสอบ",
    email: "user@example.com",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [
    { id: "org-a", name: "Org A", slug: "org-a", role: "viewer" },
    { id: "org-b", name: "Org B", slug: "org-b", role: "admin" },
  ],
  lastActiveTenantId: "org-b",
};

function Probe() {
  const {
    activeOrg,
    serverActiveOrgId,
    switchOrg,
    orgSwitchPending,
    mePending,
    meError,
    refreshMembershipContext,
    retryMe,
  } = useTenant();
  return (
    <div>
      <span data-testid="pending">{String(mePending)}</span>
      <span data-testid="switch-pending">{String(orgSwitchPending)}</span>
      <span data-testid="error">{meError?.message ?? "none"}</span>
      <span data-testid="active">{activeOrg?.id ?? "none"}</span>
      <span data-testid="server-active">
        server:{serverActiveOrgId ?? "none"}
      </span>
      <button type="button" onClick={() => void switchOrg("org-a")}>
        switch-a
      </button>
      <button type="button" onClick={() => void switchOrg("org-b")}>
        switch-b
      </button>
      <button type="button" onClick={() => void switchOrg("org-c")}>
        switch-unknown
      </button>
      <button type="button" onClick={() => void retryMe()}>
        retry
      </button>
      <button type="button" onClick={() => void refreshMembershipContext()}>
        refresh membership
      </button>
    </div>
  );
}

function renderProvider(queryClient = new QueryClient()) {
  bindQueryClientIdentity(queryClient, "user-1");
  return render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <Probe />
      </TenantProvider>
    </QueryClientProvider>,
  );
}

describe("TenantProvider", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    getSessionMock.mockReset();
    resetQueryClientRegistry();
  });

  it.each(["failure", "success"] as const)(
    "retires manual refresh pending when a shared resolver supersedes it with %s",
    async (outcome) => {
      const manual = Promise.withResolvers<MeContextResponse>();
      const shared = Promise.withResolvers<MeContextResponse>();
      fetchMeContextMock
        .mockResolvedValueOnce(me)
        .mockReturnValueOnce(manual.promise)
        .mockReturnValueOnce(shared.promise);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      renderProvider(queryClient);
      await screen.findByText("org-b");
      await userEvent.click(
        screen.getByRole("button", { name: "refresh membership" }),
      );
      await waitFor(() => {
        expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
      });
      act(() => {
        void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
      });
      await waitFor(() => {
        expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
      });
      await act(async () => {
        if (outcome === "failure")
          shared.reject(new Error("shared resolver failed"));
        else shared.resolve({ ...me, lastActiveTenantId: "org-a" });
        await shared.promise.catch(() => undefined);
      });
      await waitFor(() => {
        expect(screen.getByTestId("pending")).toHaveTextContent("false");
      });
      if (outcome === "failure")
        expect(screen.getByTestId("error")).toHaveTextContent(
          "shared resolver failed",
        );
      expect(screen.getByTestId("active")).toHaveTextContent(
        outcome === "failure" ? "none" : "org-a",
      );
      await act(async () => {
        manual.resolve(me);
        await manual.promise;
      });
      expect(screen.getByTestId("pending")).toHaveTextContent("false");
      expect(screen.getByTestId("active")).toHaveTextContent(
        outcome === "failure" ? "none" : "org-a",
      );
      if (outcome === "failure") {
        fetchMeContextMock.mockResolvedValueOnce({
          ...me,
          lastActiveTenantId: "org-a",
        });
        await userEvent.click(screen.getByRole("button", { name: "retry" }));
        await waitFor(() => {
          expect(screen.getByTestId("active")).toHaveTextContent("org-a");
        });
      }
    },
  );

  it("withdraws warm cached scope during required bootstrap and recovers after failure/retry", async () => {
    const resolver = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockReturnValueOnce(resolver.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderProvider(queryClient);
    await screen.findByText("org-b");
    act(() => {
      void queryClient
        .query({
          queryKey: ["tenant", "notifications", "org-b", "scope-check"],
          queryFn: () =>
            Promise.reject(new ApiError("INBOX_SCOPE_CHANGED", "changed", 409)),
          retry: false,
        })
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
    await act(async () => {
      resolver.reject(new Error("resolver unavailable"));
      await resolver.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(screen.getByTestId("pending")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    fetchMeContextMock.mockResolvedValueOnce({
      ...me,
      lastActiveTenantId: "org-a",
    });
    await userEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("org-a"),
    );
  });

  it.each(["success", "superseded"] as const)(
    "warm-cache required bootstrap %s retires old tenant work and publishes only current scope",
    async (outcome) => {
      const resolver = Promise.withResolvers<MeContextResponse>();
      const lateTenant = Promise.withResolvers<string>();
      fetchMeContextMock
        .mockResolvedValueOnce(me)
        .mockReturnValueOnce(resolver.promise);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      renderProvider(queryClient);
      await screen.findByText("org-b");
      let tenantSignal: AbortSignal | undefined;
      const tenantRequest = queryClient
        .query({
          queryKey: ["tenant", "org-b", "deferred"],
          queryFn: ({ signal }) => {
            tenantSignal = signal;
            return lateTenant.promise;
          },
        })
        .catch(() => undefined);
      act(() => {
        void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
      });
      await waitFor(() => {
        expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByTestId("active")).toHaveTextContent("none");
      expect(screen.getByTestId("pending")).toHaveTextContent("true");
      expect(tenantSignal?.aborted).toBe(true);
      if (outcome === "superseded") {
        fetchMeContextMock.mockResolvedValueOnce({
          ...me,
          organizations: [],
          lastActiveTenantId: null,
        });
        await userEvent.click(
          screen.getByRole("button", { name: "refresh membership" }),
        );
        await waitFor(() =>
          expect(screen.getByTestId("pending")).toHaveTextContent("false"),
        );
      }
      await act(async () => {
        resolver.resolve({ ...me, lastActiveTenantId: "org-a" });
        lateTenant.resolve("late old org");
        await resolver.promise;
        await tenantRequest;
      });
      await waitFor(() =>
        expect(screen.getByTestId("pending")).toHaveTextContent("false"),
      );
      expect(screen.getByTestId("active")).toHaveTextContent(
        outcome === "success" ? "org-a" : "none",
      );
      expect(
        queryClient.getQueryData(["tenant", "org-b", "deferred"]),
      ).toBeUndefined();
      expect(
        queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
          ?.lastActiveTenantId,
      ).toBe(outcome === "success" ? "org-a" : null);
    },
  );

  it("prefers lastActiveTenantId over the first membership", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    renderProvider();
    expect(await screen.findByText("org-b")).toBeInTheDocument();
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:org-b",
    );
  });

  it("keeps the inbox scope personal-only when the server has no active organization", async () => {
    fetchMeContextMock.mockResolvedValue({ ...me, lastActiveTenantId: null });
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("pending")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:none",
    );
  });

  it("allows an explicit membership switch without a usable fallback", async () => {
    const personalOnly = { ...me, lastActiveTenantId: null };
    fetchMeContextMock.mockResolvedValue(personalOnly);
    updateActiveOrganizationMock.mockResolvedValue({
      ...personalOnly,
      lastActiveTenantId: "org-a",
    });
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("pending")).toHaveTextContent("false"),
    );

    await userEvent.click(screen.getByRole("button", { name: "switch-a" }));

    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
        organizationId: "org-a",
      });
    });
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:org-a",
    );
  });

  it("publishes a switch only after PATCH succeeds and clears tenant caches", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    const updated: MeContextResponse = { ...me, lastActiveTenantId: "org-a" };
    updateActiveOrganizationMock.mockResolvedValue(updated);
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenant", "org-b", "widgets"], { stale: true });
    renderProvider(queryClient);
    await screen.findByText("org-b");

    await userEvent.click(screen.getByRole("button", { name: "switch-a" }));

    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-a");
    });
    expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
      organizationId: "org-a",
    });
    expect(
      queryClient.getQueryData(["tenant", "org-b", "widgets"]),
    ).toBeUndefined();
  });

  it("retires a deferred old-tenant response before publishing the confirmed switch", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    updateActiveOrganizationMock.mockResolvedValue({
      ...me,
      lastActiveTenantId: "org-a",
    });
    const queryClient = new QueryClient();
    let resolveOldTenant!: (value: { source: string }) => void;
    const oldTenant = new Promise<{ source: string }>((resolve) => {
      resolveOldTenant = resolve;
    });
    void queryClient
      .query({
        queryKey: ["tenant", "org-b", "notifications"],
        queryFn: () => oldTenant,
      })
      .catch(() => undefined);
    renderProvider(queryClient);
    await screen.findByText("org-b");

    await userEvent.click(screen.getByRole("button", { name: "switch-a" }));
    await waitFor(() => {
      expect(screen.getByTestId("server-active")).toHaveTextContent(
        "server:org-a",
      );
    });
    resolveOldTenant({ source: "org-b" });
    await Promise.resolve();

    expect(
      queryClient.getQueryData(["tenant", "org-b", "notifications"]),
    ).toBeUndefined();
  });

  it("keeps a newer revoked context when an earlier switch response resolves last", async () => {
    const staleSwitchContext: MeContextResponse = {
      ...me,
      lastActiveTenantId: "org-a",
    };
    const revokedContext: MeContextResponse = {
      ...me,
      organizations: [],
      lastActiveTenantId: null,
    };
    const pendingSwitch = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce(revokedContext);
    updateActiveOrganizationMock.mockImplementationOnce(
      () => pendingSwitch.promise,
    );
    const queryClient = new QueryClient();
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-b");

    await user.click(screen.getByRole("button", { name: "switch-a" }));
    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
        organizationId: "org-a",
      });
    });
    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
        revokedContext,
      );
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });
    const publicationAfterRefresh = getContextPublicationSnapshot(queryClient);

    pendingSwitch.resolve(staleSwitchContext);
    await pendingSwitch.promise;

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
        revokedContext,
      );
    });
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:none",
    );
    expect(getContextPublicationSnapshot(queryClient)).toBe(
      publicationAfterRefresh,
    );
  });

  it("serializes overlapping switches and retains the latest successful response", async () => {
    const initialContext: MeContextResponse = {
      ...me,
      organizations: [
        ...me.organizations,
        { id: "org-c", name: "Org C", slug: "org-c", role: "viewer" },
      ],
      lastActiveTenantId: "org-c",
    };
    const switchA = Promise.withResolvers<MeContextResponse>();
    const switchB = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockResolvedValue(initialContext);
    updateActiveOrganizationMock
      .mockImplementationOnce(() => switchA.promise)
      .mockImplementationOnce(() => switchB.promise);
    const queryClient = new QueryClient();
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-c");

    await user.click(screen.getByRole("button", { name: "switch-a" }));
    await user.click(screen.getByRole("button", { name: "switch-b" }));
    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenCalledOnce();
      expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
        organizationId: "org-a",
      });
    });

    switchA.resolve({ ...initialContext, lastActiveTenantId: "org-a" });
    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenNthCalledWith(2, {
        organizationId: "org-b",
      });
    });
    switchB.resolve({ ...initialContext, lastActiveTenantId: "org-b" });

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual({
        ...initialContext,
        lastActiveTenantId: "org-b",
      });
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
      expect(screen.getByTestId("switch-pending")).toHaveTextContent("false");
    });
  });

  it("retains the earlier successful switch when the queued latest switch fails", async () => {
    const initialContext: MeContextResponse = {
      ...me,
      organizations: [
        ...me.organizations,
        { id: "org-c", name: "Org C", slug: "org-c", role: "viewer" },
      ],
      lastActiveTenantId: "org-c",
    };
    const switchA = Promise.withResolvers<MeContextResponse>();
    const switchB = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockResolvedValue(initialContext);
    updateActiveOrganizationMock
      .mockImplementationOnce(() => switchA.promise)
      .mockImplementationOnce(() => switchB.promise);
    const queryClient = new QueryClient();
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-c");

    await user.click(screen.getByRole("button", { name: "switch-a" }));
    await user.click(screen.getByRole("button", { name: "switch-b" }));
    switchA.resolve({ ...initialContext, lastActiveTenantId: "org-a" });
    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenNthCalledWith(2, {
        organizationId: "org-b",
      });
    });
    switchB.reject(new ApiError("FORBIDDEN", "denied", 403));
    await switchB.promise.catch(() => undefined);

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual({
        ...initialContext,
        lastActiveTenantId: "org-a",
      });
      expect(screen.getByTestId("active")).toHaveTextContent("org-a");
      expect(screen.getByTestId("server-active")).toHaveTextContent(
        "server:org-a",
      );
      expect(screen.getByTestId("switch-pending")).toHaveTextContent("false");
    });
  });

  it("keeps the previous tenant and cached context when the PATCH fails", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    updateActiveOrganizationMock.mockRejectedValue(
      new ApiError("FORBIDDEN", "denied", 403),
    );
    const queryClient = new QueryClient();
    renderProvider(queryClient);
    await screen.findByText("org-b");

    await userEvent.click(screen.getByRole("button", { name: "switch-a" }));

    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenCalled();
    });
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(me);
    expect(screen.getByTestId("active")).toHaveTextContent("org-b");
  });

  it("ignores switches to organizations the user does not belong to", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    renderProvider();
    await screen.findByText("org-b");

    await userEvent.click(
      screen.getByRole("button", { name: "switch-unknown" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
    });
    expect(updateActiveOrganizationMock).not.toHaveBeenCalled();
  });

  it("retires stale scope after a failed membership refresh until retry confirms a replacement", async () => {
    const aContext: MeContextResponse = {
      ...me,
      lastActiveTenantId: "org-a",
    };
    const organizationB = me.organizations.find(
      (organization) => organization.id === "org-b",
    );
    if (organizationB === undefined) {
      throw new Error("Org B fixture is required for this test");
    }
    const bContext: MeContextResponse = {
      ...me,
      organizations: [organizationB],
      lastActiveTenantId: "org-b",
    };
    fetchMeContextMock
      .mockResolvedValueOnce(aContext)
      .mockRejectedValueOnce(new Error("context unavailable"))
      .mockResolvedValueOnce(bContext);
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenant", "org-a", "members"], { stale: true });
    renderProvider(queryClient);
    await screen.findByText("org-a");

    await userEvent.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:none",
    );
    expect(
      queryClient.getQueryData(["tenant", "org-a", "members"]),
    ).toBeUndefined();

    await userEvent.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
    });
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:org-b",
    );
  });

  it("keeps a fresh membership context after a cancelled older context query resolves", async () => {
    const [staleOrganization, freshOrganization] = me.organizations;
    if (staleOrganization === undefined || freshOrganization === undefined) {
      throw new Error("race fixture requires organizations A and B");
    }
    const staleA: MeContextResponse = {
      ...me,
      organizations: [staleOrganization],
      lastActiveTenantId: "org-a",
    };
    const freshB: MeContextResponse = {
      ...me,
      organizations: [freshOrganization],
      lastActiveTenantId: "org-b",
    };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce(freshB);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const oldQuery = queryClient
      .query({
        queryKey: ME_CONTEXT_QUERY_KEY,
        queryFn: fetchMeContext,
      })
      .catch(() => undefined);
    renderProvider(queryClient);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
    });

    oldRequest.resolve(staleA);
    await oldQuery;

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(freshB);
    });
    expect(screen.getByTestId("active")).toHaveTextContent("org-b");
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:org-b",
    );
  });

  it("keeps the newest revoked membership context when an older refresh resolves last", async () => {
    const privilegedContext: MeContextResponse = {
      ...me,
      organizations: [
        { id: "org-a", name: "Org A", slug: "org-a", role: "owner" },
      ],
      lastActiveTenantId: "org-a",
    };
    const revokedContext: MeContextResponse = {
      ...me,
      organizations: [],
      lastActiveTenantId: null,
    };
    const olderRefresh = Promise.withResolvers<MeContextResponse>();
    const newerRefresh = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockImplementationOnce(() => newerRefresh.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-b");

    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
    });

    newerRefresh.resolve(revokedContext);
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });
    olderRefresh.resolve(privilegedContext);
    await olderRefresh.promise;

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
        revokedContext,
      );
    });
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:none",
    );
  });

  it("keeps a newer restricted directory context when an older membership refresh resolves last", async () => {
    const privilegedA: MeContextResponse = {
      ...me,
      organizations: [
        { id: "org-a", name: "Org A", slug: "org-a", role: "owner" },
      ],
      lastActiveTenantId: "org-a",
    };
    const restrictedB: MeContextResponse = {
      ...me,
      organizations: [
        { id: "org-b", name: "Org B", slug: "org-b", role: "viewer" },
      ],
      lastActiveTenantId: "org-b",
    };
    const olderRefresh = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockResolvedValueOnce(restrictedB);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    publishActiveQueryClient(me.user.id, queryClient);
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-b");

    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });

    await organizationMembersLoader({
      params: { organizationId: "org-a" },
      request: new Request("http://localhost/organizations/org-a/members"),
    } as never);
    olderRefresh.resolve(privilegedA);
    await olderRefresh.promise;

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
        restrictedB,
      );
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
      expect(screen.getByTestId("server-active")).toHaveTextContent(
        "server:org-b",
      );
    });
  });

  it("restores the shell context when a newer directory loader republishes a deep-equal context", async () => {
    const olderRefresh = Promise.withResolvers<MeContextResponse>();
    const deepEqualContext: MeContextResponse = {
      ...me,
      user: { ...me.user },
      organizations: me.organizations.map((organization) => ({
        ...organization,
      })),
    };
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockResolvedValueOnce(deepEqualContext);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    publishActiveQueryClient(me.user.id, queryClient);
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-b");

    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });

    await organizationMembersLoader({
      params: { organizationId: "org-a" },
      request: new Request("http://localhost/organizations/org-a/members"),
    } as never);

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBe(me);
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
      expect(screen.getByTestId("server-active")).toHaveTextContent(
        "server:org-b",
      );
    });

    olderRefresh.resolve({ ...me, lastActiveTenantId: "org-a" });
    await olderRefresh.promise;
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBe(me);
  });

  it("keeps membership unavailable when a newer refresh supersedes a published directory context before effects run", async () => {
    const firstRefresh = Promise.withResolvers<MeContextResponse>();
    const currentRefresh = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => currentRefresh.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    publishActiveQueryClient(me.user.id, queryClient);
    renderProvider(queryClient);
    await screen.findByText("org-b");

    await userEvent.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });

    act(() => {
      const loaderClaim = createContextPublicationClaim();
      expect(
        claimContextPublication(queryClient, loaderClaim, "bootstrap"),
      ).toBe(true);
      expect(publishContextPublication(queryClient, loaderClaim, me)).toBe(
        true,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "refresh membership" }),
      );
    });
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });

    currentRefresh.resolve({ ...me, lastActiveTenantId: "org-a" });
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-a");
    });
    firstRefresh.resolve(me);
  });

  it("observes a directory publication between render and subscription", async () => {
    const queryClient = new QueryClient();
    const claim = createContextPublicationClaim();
    expect(claimContextPublication(queryClient, claim, "bootstrap")).toBe(true);

    function SnapshotProbe() {
      const publication = useSyncExternalStore(
        (listener) => subscribeToContextPublication(queryClient, listener),
        () => getContextPublicationSnapshot(queryClient),
      );
      return (
        <span data-testid="publication-version">{publication.version}</span>
      );
    }

    function LayoutPublisher() {
      useLayoutEffect(() => {
        publishContextPublication(queryClient, claim, me);
      }, []);
      return null;
    }

    render(
      <>
        <SnapshotProbe />
        <LayoutPublisher />
      </>,
    );

    expect(await screen.findByTestId("publication-version")).toHaveTextContent(
      "1",
    );
  });

  it("ignores old query client publications after changing identity clients", async () => {
    const oldClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const newClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const stalledRefresh = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockImplementationOnce(() => stalledRefresh.promise);
    const view = renderProvider(oldClient);
    await screen.findByText("org-b");
    bindQueryClientIdentity(newClient, "user-1");
    const newClientClaim = createContextPublicationClaim();
    claimContextPublication(newClient, newClientClaim, "bootstrap");
    publishContextPublication(newClient, newClientClaim, me);

    view.rerender(
      <QueryClientProvider client={newClient}>
        <TenantProvider>
          <Probe />
        </TenantProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("org-b");
    await userEvent.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });

    const oldClaim = createContextPublicationClaim();
    expect(claimContextPublication(oldClient, oldClaim, "bootstrap")).toBe(
      true,
    );
    expect(publishContextPublication(oldClient, oldClaim, me)).toBe(true);

    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });

  it("keeps membership unavailable when the newest refresh fails before an older refresh resolves", async () => {
    const privilegedContext: MeContextResponse = {
      ...me,
      organizations: [
        { id: "org-a", name: "Org A", slug: "org-a", role: "owner" },
      ],
      lastActiveTenantId: "org-a",
    };
    const olderRefresh = Promise.withResolvers<MeContextResponse>();
    const newerRefresh = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockImplementationOnce(() => newerRefresh.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderProvider(queryClient);
    const user = userEvent.setup();
    await screen.findByText("org-b");

    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    await user.click(
      screen.getByRole("button", { name: "refresh membership" }),
    );
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
    });

    newerRefresh.reject(new Error("context unavailable"));
    await newerRefresh.promise.catch(() => undefined);
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });
    olderRefresh.resolve(privilegedContext);
    await olderRefresh.promise;

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(me);
    });
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:none",
    );
  });

  it.each(["switch", "refresh"] as const)(
    "rejects a foreign identity's late %s response without publishing it",
    async (operation) => {
      const completion = Promise.withResolvers<MeContextResponse>();
      fetchMeContextMock
        .mockResolvedValueOnce(me)
        .mockReturnValueOnce(completion.promise);
      updateActiveOrganizationMock.mockReturnValueOnce(completion.promise);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      renderProvider(queryClient);
      await screen.findByText("org-b");
      await userEvent.click(
        screen.getByRole("button", {
          name: operation === "switch" ? "switch-a" : "refresh membership",
        }),
      );
      await waitFor(() => {
        if (operation === "switch")
          expect(updateActiveOrganizationMock).toHaveBeenCalledTimes(1);
        else expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
      });
      await act(async () => {
        completion.resolve({
          ...me,
          user: { ...me.user, id: "user-b" },
          lastActiveTenantId: "org-a",
        });
        await completion.promise;
      });
      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(me);
      expect(screen.getByTestId("active")).toHaveTextContent(
        operation === "switch" ? "org-b" : "none",
      );
    },
  );

  it("a failed context load exposes the error and retryMe recovers", async () => {
    fetchMeContextMock.mockRejectedValueOnce(new Error("server exploded"));
    fetchMeContextMock.mockResolvedValue(me);
    renderProvider(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByText("server exploded")).toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    expect(screen.getByTestId("active")).toHaveTextContent("none");

    await userEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-b");
    });
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });
});
