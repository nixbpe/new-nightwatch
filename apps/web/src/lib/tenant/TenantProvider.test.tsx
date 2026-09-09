import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { updateActiveOrganization } from "../api/me";
import { TenantProvider, useTenant } from "./TenantProvider";

vi.mock("../api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});

import { fetchMeContext } from "../api/me";

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
  const { activeOrg, switchOrg, mePending, meError, retryMe } = useTenant();
  return (
    <div>
      <span data-testid="pending">{String(mePending)}</span>
      <span data-testid="error">{meError?.message ?? "none"}</span>
      <span data-testid="active">{activeOrg?.id ?? "none"}</span>
      <button type="button" onClick={() => void switchOrg("org-a")}>
        switch-a
      </button>
      <button type="button" onClick={() => void switchOrg("org-c")}>
        switch-unknown
      </button>
      <button type="button" onClick={() => void retryMe()}>
        retry
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
  });

  it("prefers lastActiveTenantId over the first membership", async () => {
    fetchMeContextMock.mockResolvedValue(me);
    renderProvider();
    expect(await screen.findByText("org-b")).toBeInTheDocument();
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

  it("a failed context load exposes the error and retryMe recovers", async () => {
    // SEC-C2-UI-002 regression: a failed /me lookup is an explicit,
    // retryable error — never a perpetual pending state.
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
