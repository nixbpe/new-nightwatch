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
    ["no active Organization", { activeOrg: null }, "workspace-access-needed"],
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
