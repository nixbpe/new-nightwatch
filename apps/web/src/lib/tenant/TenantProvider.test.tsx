import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../api/me";
import {
  publishActiveQueryClient,
  resetQueryClientRegistry,
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
    mePending,
    meError,
    refreshMembershipContext,
    retryMe,
  } = useTenant();
  return (
    <div>
      <span data-testid="pending">{String(mePending)}</span>
      <span data-testid="error">{meError?.message ?? "none"}</span>
      <span data-testid="active">{activeOrg?.id ?? "none"}</span>
      <span data-testid="server-active">
        server:{serverActiveOrgId ?? "none"}
      </span>
      <button type="button" onClick={() => void switchOrg("org-a")}>
        switch-a
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

    expect(await screen.findByText("org-a")).toBeInTheDocument();
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:none",
    );
  });

  it("switches from a navigation fallback so the server can establish its active organization", async () => {
    const personalOnly = { ...me, lastActiveTenantId: null };
    fetchMeContextMock.mockResolvedValue(personalOnly);
    updateActiveOrganizationMock.mockResolvedValue({
      ...personalOnly,
      lastActiveTenantId: "org-a",
    });
    renderProvider();
    await screen.findByText("org-a");

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

  it("clears an unavailable membership latch when a pending PATCH confirms a switch", async () => {
    const confirmedB: MeContextResponse = {
      ...me,
      lastActiveTenantId: "org-a",
    };
    const pendingSwitch = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockResolvedValueOnce(me)
      .mockRejectedValueOnce(new Error("context unavailable"));
    updateActiveOrganizationMock.mockImplementationOnce(
      () => pendingSwitch.promise,
    );
    renderProvider();
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
      expect(screen.getByTestId("active")).toHaveTextContent("none");
    });

    pendingSwitch.resolve(confirmedB);

    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("org-a");
    });
    expect(screen.getByTestId("server-active")).toHaveTextContent(
      "server:org-a",
    );
  });

  it("keeps the previous tenant when the PATCH fails", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    updateActiveOrganizationMock.mockRejectedValue(
      new ApiError("FORBIDDEN", "denied", 403),
    );
    renderProvider();
    await screen.findByText("org-b");

    await userEvent.click(screen.getByRole("button", { name: "switch-a" }));

    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenCalled();
    });
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

  it("a failed context load exposes the error and retryMe recovers", async () => {
    // A failed /me lookup is an explicit, retryable error, never a perpetual pending state.
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
