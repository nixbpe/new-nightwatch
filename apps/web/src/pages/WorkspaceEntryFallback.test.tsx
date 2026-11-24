import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, replace } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { guardUnassignedNetwork } from "../test/guard-network";
import { useTenant } from "../lib/tenant/TenantProvider";
import { WorkspaceEntryFallback } from "./WorkspaceEntryFallback";
import { context } from "./monitors/detail-test-support";

guardUnassignedNetwork();
vi.mock("../lib/tenant/TenantProvider", () => ({ useTenant: vi.fn() }));
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  vi.resetAllMocks();
});
function tenant(overrides: Partial<ReturnType<typeof useTenant>> = {}) {
  const me = context();
  vi.mocked(useTenant).mockReturnValue({
    me,
    activeOrg: me.organizations[0] ?? null,
    mePending: false,
    meError: null,
    retryMe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ReturnType<typeof useTenant>);
}
function renderEntry(
  loader = vi.fn<() => null | Response>().mockReturnValue(null),
) {
  const router = createMemoryRouter(
    [
      { path: "/workspace", loader, element: <WorkspaceEntryFallback /> },
      {
        path: "/organizations/:organizationId/projects/:projectId/overview",
        element: <div data-testid="destination">overview</div>,
      },
    ],
    { initialEntries: ["/workspace"] },
  );
  routers.push(router);
  render(<RouterProvider router={router} />);
  return { router, loader };
}

describe("WorkspaceEntryFallback", () => {
  it.each([
    [
      "identity retired or navigation aborted",
      { mePending: true },
      "workspace-context-loading",
    ],
    [
      "context failed",
      { me: undefined, meError: new Error("offline") },
      "workspace-context-error",
    ],
    [
      "no membership",
      { activeOrg: null, me: context("owner", []) },
      "workspace-access-needed",
    ],
    [
      "memberships but none selected",
      { activeOrg: null },
      "workspace-org-choice",
    ],
    ["last Project failed", {}, "workspace-entry-error"],
  ] as const)(
    "shows the four loader-null states without monitor data and never navigates by itself (AC-07): %s",
    async (_name, state, testId) => {
      tenant(state);
      const { router, loader } = renderEntry();
      await screen.findByTestId(testId);
      expect(router.state.location.pathname).toBe("/workspace");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("project-overview-summary")).toBeNull();
      expect(screen.queryByTestId("workspace-project")).toBeNull();
    },
  );
  it("offers a way to the Projects list when the last Project cannot be opened", async () => {
    tenant();
    const organizationId = vi.mocked(useTenant)().activeOrg?.id;
    const { router } = renderEntry();
    await screen.findByTestId("workspace-entry-error");
    expect(screen.queryByTestId("project-overview-summary")).toBeNull();
    const link = screen.getByTestId("workspace-entry-projects");
    expect(link.getAttribute("href")).toBe(
      `/organizations/${organizationId ?? ""}/projects`,
    );
    expect(router.state.location.pathname).toBe("/workspace");
  });

  it("does not show the raw context error message", async () => {
    tenant({ me: undefined, meError: new Error("upstream 503 raw detail") });
    renderEntry();
    await screen.findByTestId("workspace-context-alert");
    expect(screen.queryByText(/upstream 503 raw detail/)).toBeNull();
  });

  it("retry re-runs the workspace loader and lands on the overview", async () => {
    tenant();
    const loader = vi
      .fn<() => null | Response>()
      .mockReturnValueOnce(null)
      .mockReturnValue(replace("/organizations/org/projects/project/overview"));
    renderEntry(loader);
    await userEvent.click(await screen.findByTestId("workspace-entry-retry"));
    await screen.findByTestId("destination");
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("with no membership, retry refetches the context then re-runs the entry loader", async () => {
    const retryMe = vi.fn().mockResolvedValue(undefined);
    tenant({ activeOrg: null, me: context("owner", []), retryMe });
    const { loader } = renderEntry();
    await userEvent.click(await screen.findByTestId("workspace-access-retry"));

    expect(retryMe).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  it("with memberships but none selected, choosing one switches to it and re-runs the entry loader", async () => {
    const switchOrg = vi.fn().mockResolvedValue(true);
    tenant({ activeOrg: null, switchOrg });
    const { loader } = renderEntry();

    const options = await screen.findAllByTestId("workspace-org-option");
    expect(options).toHaveLength(2);
    expect(screen.queryByTestId("workspace-access-retry")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Beta \(/ }));

    expect(switchOrg).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  it("retries context before revalidating the entry loader", async () => {
    const retry = Promise.withResolvers<undefined>();
    const retryMe = vi.fn(() => retry.promise);
    tenant({ me: undefined, retryMe });
    const { loader } = renderEntry();
    await userEvent.click(await screen.findByTestId("workspace-context-retry"));
    expect(retryMe).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
    retry.resolve(undefined);
    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
