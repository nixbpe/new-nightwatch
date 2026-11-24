import {
  bindQueryClientIdentity,
  claimContextPublication,
  createContextPublicationClaim,
  publishContextPublication,
  failContextPublication,
  resetQueryClientRegistry,
} from "../lib/queryClient";
import { SessionQueryProvider } from "../lib/auth/SessionQueryProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, createMemoryRouter, RouterProvider } from "react-router";
import { AppShell } from "../components/shell/AppShell";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../lib/api/me";
import {
  fetchOrganizationNotificationSettings,
  updateOrganizationNotificationSettings,
} from "../lib/api/notifications";
import { TenantProvider } from "../lib/tenant/TenantProvider";
import { OrganizationNotificationSettingsPage } from "./OrganizationNotificationSettingsPage";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

// The shell's Project switcher reads these; no Project is the quietest state.
vi.mock("../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectList: () => Promise.resolve({ projects: [] }),
  fetchLastProject: () => Promise.resolve({ projectId: null }),
}));
vi.mock("../lib/api/notifications", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchOrganizationNotificationSettings: vi.fn(),
    updateOrganizationNotificationSettings: vi.fn(),
    fetchUnreadCount: vi.fn(() => Promise.resolve({ unreadCount: 0 })),
  };
});
vi.mock("../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(() =>
    Promise.resolve({
      summary: { total: 0 },
      monitors: [],
      page: { limit: 50, offset: 0, total: 0 },
      dataAsOf: "2026-10-06T00:00:00.000Z",
    }),
  ),
}));
const session = vi.hoisted(() => ({ id: "user-1" }));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({
      data: {
        user: {
          id: session.id,
          name: "Test",
          email: "test@nightwatch.invalid",
        },
      },
      isPending: false,
    }),
  }),
}));

vi.mock("../lib/api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchMeContext: vi.fn() };
});

const fetchSettingsMock = vi.mocked(fetchOrganizationNotificationSettings);
const updateSettingsMock = vi.mocked(updateOrganizationNotificationSettings);
const fetchMeContextMock = vi.mocked(fetchMeContext);

function renderPage(
  extra: React.ReactNode = null,
  bootstrap?: ReturnType<
    typeof Promise.withResolvers<Awaited<ReturnType<typeof fetchMeContext>>>
  >,
  sessionBoundary = false,
) {
  const context: Awaited<ReturnType<typeof fetchMeContext>> = {
    user: {
      id: "user-1",
      name: "นภัส วงศ์สกุล",
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [{ id: ORG_A, name: "Org A", slug: "org-a", role: "owner" }],
    lastActiveTenantId: ORG_A,
  };
  fetchMeContextMock.mockResolvedValue(context);
  if (bootstrap !== undefined)
    fetchMeContextMock.mockReturnValueOnce(bootstrap.promise);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  const router = createMemoryRouter(
    [
      {
        element: (
          <TenantProvider>
            <AppShell />
          </TenantProvider>
        ),
        children: [
          {
            path: "/organizations/:organizationId/notification-settings",
            element: (
              <>
                {extra}
                <OrganizationNotificationSettingsPage />
              </>
            ),
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${ORG_A}/notification-settings`] },
  );
  function Harness({ identity = "user-1" }: { identity?: string }) {
    session.id = identity;
    return sessionBoundary ? (
      <SessionQueryProvider>
        <RouterProvider router={router} />
      </SessionQueryProvider>
    ) : (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  }
  const view = render(<Harness />);
  return {
    ...view,
    router,
    queryClient,
    context,
    replaceIdentity: (identity: string) => {
      view.rerender(<Harness identity={identity} />);
    },
  };
}

afterEach(() => {
  fetchSettingsMock.mockReset();
  updateSettingsMock.mockReset();
  fetchMeContextMock.mockReset();
  session.id = "user-1";
  resetQueryClientRegistry();
});

describe("OrganizationNotificationSettingsPage", () => {
  it("does not request settings before the shell's deferred verified bootstrap", async () => {
    const bootstrap =
      Promise.withResolvers<Awaited<ReturnType<typeof fetchMeContext>>>();
    renderPage(null, bootstrap);
    expect(
      await screen.findByTestId("shell-admission-loading"),
    ).toBeInTheDocument();
    expect(fetchSettingsMock).not.toHaveBeenCalled();
    bootstrap.resolve({
      user: {
        id: "user-1",
        name: "Test",
        email: "test@nightwatch.invalid",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [
        { id: ORG_A, name: "Org A", slug: "org-a", role: "owner" },
      ],
      lastActiveTenantId: ORG_A,
    });
    fetchSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 1,
    });
    expect(
      await screen.findByTestId("organization-notifications-settings-changed"),
    ).toBeInTheDocument();
    expect(fetchSettingsMock).toHaveBeenCalledWith(ORG_A);
  });
  it("names the route organization in the page scope line", async () => {
    fetchSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 1,
    });
    renderPage();
    expect(
      await within(screen.getByTestId("shell-main")).findByTestId("page-scope"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("shell-main")).getByTestId("page-scope"),
    ).toHaveTextContent("Org A");
    expect(
      screen.getByTestId("organization-notifications-settings"),
    ).toHaveAttribute("data-organization-id", ORG_A);
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-slug"),
    ).toBeInTheDocument();
    // CVE alerts are not user-switchable (E-005 r8): shown as a fact, never as a control.
    const cveInfo = screen.getByTestId("organization-notifications-cve-info");
    expect(cveInfo.querySelector("input")).toBeNull();
    expect(
      screen.getByTestId("organization-notifications-slug"),
    ).toHaveTextContent("org-a");
  });

  it.each([
    [
      "sends the loaded version with a changed owner setting",
      "organization-notifications-settings-changed",
      4,
      { settingsChangedEnabled: false, monitorAlertsEnabled: true, version: 5 },
      { settingsChangedEnabled: false, expectedVersion: 4 },
    ],
    [
      "shows the monitor alerts checkbox and saves only that toggle",
      "organization-notifications-monitor-alerts",
      6,
      { settingsChangedEnabled: true, monitorAlertsEnabled: false, version: 7 },
      { monitorAlertsEnabled: false, expectedVersion: 6 },
    ],
  ] as const)("%s", async (_label, testId, version, saved, expectedPatch) => {
    fetchSettingsMock
      .mockResolvedValueOnce({
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version,
      })
      .mockResolvedValue({ organizationId: ORG_A, ...saved });
    updateSettingsMock.mockResolvedValue({ organizationId: ORG_A, ...saved });
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByTestId(testId);
    expect(toggle).toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-save"),
    ).toBeDisabled();

    await user.click(toggle);
    await user.click(screen.getByTestId("organization-notifications-save"));

    expect(updateSettingsMock).toHaveBeenCalledWith(ORG_A, expectedPatch);
    expect(await screen.findByTestId(testId)).not.toBeChecked();
    expect(
      await screen.findByTestId("organization-notifications-success"),
    ).toBeInTheDocument();
  });

  it("drops the saved message when the form is edited again", async () => {
    const saved = {
      organizationId: ORG_A,
      settingsChangedEnabled: false,
      monitorAlertsEnabled: true,
      version: 2,
    };
    fetchSettingsMock
      .mockResolvedValueOnce({
        ...saved,
        settingsChangedEnabled: true,
        version: 1,
      })
      .mockResolvedValue(saved);
    updateSettingsMock.mockResolvedValue(saved);
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    expect(
      await screen.findByTestId("organization-notifications-success"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    );
    expect(
      screen.queryByTestId("organization-notifications-success"),
    ).toBeNull();
  });

  it("shows a distinct permission denial and optimistic-concurrency conflict", async () => {
    fetchSettingsMock.mockRejectedValueOnce(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderPage();
    expect(
      await screen.findByTestId("organization-notifications-denied-alert"),
    ).toHaveRole("alert");
    expect(
      screen.queryByTestId("organization-notifications-settings-changed"),
    ).toBeNull();
    expect(updateSettingsMock).not.toHaveBeenCalled();

    fetchSettingsMock.mockReset();
    fetchSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 4,
    });
    updateSettingsMock.mockRejectedValue(
      new ApiError("SETTINGS_VERSION_CONFLICT", "conflict", 409),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    expect(
      await screen.findByTestId("organization-notifications-version-conflict"),
    ).toHaveRole("alert");
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(updateSettingsMock).toHaveBeenCalledWith(ORG_A, {
      settingsChangedEnabled: false,
      expectedVersion: 4,
    });
    expect(
      screen.queryByTestId("organization-notifications-save-retry"),
    ).toBeNull();
    await user.click(screen.getByTestId("organization-notifications-reload"));
    await vi.waitFor(() =>
      expect(
        screen.getByTestId("organization-notifications-settings-changed"),
      ).toBeChecked(),
    );
    expect(
      screen.getByTestId("organization-notifications-save"),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("organization-notifications-version-conflict"),
    ).toBeNull();
    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("retries a failed save with the same draft and version instead of reloading", async () => {
    fetchSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 4,
    });
    updateSettingsMock
      .mockRejectedValueOnce(new ApiError("INTERNAL", "boom", 500))
      .mockResolvedValue({
        organizationId: ORG_A,
        settingsChangedEnabled: false,
        monitorAlertsEnabled: true,
        version: 5,
      });
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    const retry = await screen.findByTestId(
      "organization-notifications-save-retry",
    );
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(fetchSettingsMock).toHaveBeenCalledTimes(1);
    await user.click(retry);
    await vi.waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    });
    expect(updateSettingsMock).toHaveBeenNthCalledWith(2, ORG_A, {
      settingsChangedEnabled: false,
      expectedVersion: 4,
    });
  });

  it("retires the failed submission on edit and saves the visible draft", async () => {
    const initial = {
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 4,
    };
    const saved = {
      organizationId: ORG_A,
      settingsChangedEnabled: false,
      monitorAlertsEnabled: false,
      version: 5,
    };
    const retry = Promise.withResolvers<typeof saved>();
    fetchSettingsMock.mockResolvedValue(initial);
    updateSettingsMock
      .mockRejectedValueOnce(new ApiError("INTERNAL", "boom", 500))
      .mockReturnValueOnce(retry.promise);
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    expect(
      await screen.findByTestId("organization-notifications-save-retry"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    );
    expect(
      screen.queryByTestId("organization-notifications-save-retry"),
    ).toBeNull();
    expect(
      screen.queryByTestId("organization-notifications-save-error"),
    ).toBeNull();
    await user.click(screen.getByTestId("organization-notifications-save"));
    expect(updateSettingsMock).toHaveBeenNthCalledWith(2, ORG_A, {
      settingsChangedEnabled: false,
      monitorAlertsEnabled: false,
      expectedVersion: 4,
    });
    fetchSettingsMock.mockResolvedValue(saved);
    retry.resolve(saved);
    await vi.waitFor(() =>
      expect(
        screen.getByTestId("organization-notifications-success"),
      ).toHaveTextContent("บันทึกแล้ว"),
    );
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-save"),
    ).toBeDisabled();
  });

  it("disables the actual checkboxes while a save is pending", async () => {
    const saved = {
      organizationId: ORG_A,
      settingsChangedEnabled: false,
      monitorAlertsEnabled: true,
      version: 5,
    };
    fetchSettingsMock.mockResolvedValue({
      ...saved,
      settingsChangedEnabled: true,
      version: 4,
    });
    const pending = Promise.withResolvers<typeof saved>();
    updateSettingsMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderPage();
    const settingsChanged = await screen.findByTestId(
      "organization-notifications-settings-changed",
    );
    const monitorAlerts = screen.getByTestId(
      "organization-notifications-monitor-alerts",
    );
    await user.click(settingsChanged);
    await user.click(screen.getByTestId("organization-notifications-save"));
    await vi.waitFor(() => expect(settingsChanged).toBeDisabled());
    expect(monitorAlerts).toBeDisabled();
    await user.click(settingsChanged);
    await user.click(monitorAlerts);
    expect(settingsChanged).not.toBeChecked();
    expect(monitorAlerts).toBeChecked();
    expect(updateSettingsMock).toHaveBeenCalledExactlyOnceWith(ORG_A, {
      settingsChangedEnabled: false,
      expectedVersion: 4,
    });
    fetchSettingsMock.mockResolvedValue(saved);
    pending.resolve(saved);
    await vi.waitFor(() => expect(settingsChanged).toBeEnabled());
    expect(settingsChanged).not.toBeChecked();
    expect(monitorAlerts).toBeChecked();
  });

  it("drops an unsaved draft when navigating to another organization", async () => {
    fetchSettingsMock.mockImplementation((organizationId) =>
      Promise.resolve({
        organizationId,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version: organizationId === ORG_A ? 4 : 9,
      }),
    );
    const user = userEvent.setup();
    renderPage(
      <Link
        data-testid="test-notifications-navigate-b"
        to={`/organizations/${ORG_B}/notification-settings`}
      >
        องค์กร B
      </Link>,
    );

    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    await user.click(screen.getByTestId("test-notifications-navigate-b"));

    await vi.waitFor(() => {
      expect(fetchSettingsMock).toHaveBeenCalledWith(ORG_B);
    });
    expect(
      await screen.findByTestId("organization-notifications-settings-changed"),
    ).toBeChecked();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("keeps the current A operation locked through the old A response and authoritative refetch after A to B to A", async () => {
    fetchSettingsMock.mockImplementation((organizationId) =>
      Promise.resolve({
        organizationId,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version: organizationId === ORG_A ? 4 : 9,
      }),
    );
    const oldSave =
      Promise.withResolvers<
        Awaited<ReturnType<typeof updateOrganizationNotificationSettings>>
      >();
    const currentSave =
      Promise.withResolvers<
        Awaited<ReturnType<typeof updateOrganizationNotificationSettings>>
      >();
    updateSettingsMock
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValueOnce(currentSave.promise);
    const user = userEvent.setup();
    const { router } = renderPage();
    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    expect(updateSettingsMock).toHaveBeenNthCalledWith(1, ORG_A, {
      settingsChangedEnabled: false,
      expectedVersion: 4,
    });
    await act(() =>
      router.navigate(`/organizations/${ORG_B}/notification-settings`),
    );
    expect(
      await screen.findByTestId("organization-notifications-settings"),
    ).toHaveAttribute("data-organization-id", ORG_B);
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).toBeChecked();
    await act(() =>
      router.navigate(`/organizations/${ORG_A}/notification-settings`),
    );
    await user.click(
      await screen.findByTestId("organization-notifications-monitor-alerts"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    expect(updateSettingsMock).toHaveBeenNthCalledWith(2, ORG_A, {
      monitorAlertsEnabled: false,
      expectedVersion: 4,
    });
    const requestsBeforeOldResponse = fetchSettingsMock.mock.calls.length;
    const authoritativeRead =
      Promise.withResolvers<
        Awaited<ReturnType<typeof fetchOrganizationNotificationSettings>>
      >();
    fetchSettingsMock.mockReturnValueOnce(authoritativeRead.promise);
    await act(async () => {
      oldSave.resolve({
        organizationId: ORG_A,
        settingsChangedEnabled: false,
        monitorAlertsEnabled: true,
        version: 5,
      });
      await oldSave.promise;
    });
    await vi.waitFor(() =>
      expect(
        screen.getByTestId("organization-notifications-save"),
      ).toBeDisabled(),
    );
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("organization-notifications-success"),
    ).toBeNull();
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
    expect(fetchSettingsMock).toHaveBeenCalledTimes(
      requestsBeforeOldResponse + 1,
    );
    expect(fetchSettingsMock).toHaveBeenLastCalledWith(ORG_A);
    await act(async () => {
      authoritativeRead.resolve({
        organizationId: ORG_A,
        settingsChangedEnabled: false,
        monitorAlertsEnabled: true,
        version: 5,
      });
      await authoritativeRead.promise;
    });
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("organization-notifications-success"),
    ).toBeNull();
    await act(async () => {
      currentSave.reject(
        new ApiError("SETTINGS_VERSION_CONFLICT", "conflict", 409),
      );
      await currentSave.promise.catch(() => {});
    });
    expect(
      await screen.findByTestId("organization-notifications-version-conflict"),
    ).toHaveRole("alert");
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).not.toBeChecked();
    expect(
      screen.queryByTestId("organization-notifications-success"),
    ).toBeNull();
    expect(updateSettingsMock).toHaveBeenCalledTimes(2);
  });

  it.each(["user-2", "user-1"])(
    "isolates an old completion from a replacement client ending as %s",
    async (destination) => {
      const initial = {
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version: 4,
      };
      fetchSettingsMock.mockResolvedValue(initial);
      const oldSave = Promise.withResolvers<typeof initial>();
      const currentSave = Promise.withResolvers<typeof initial>();
      updateSettingsMock
        .mockReturnValueOnce(oldSave.promise)
        .mockReturnValueOnce(currentSave.promise);
      const user = userEvent.setup();
      const { replaceIdentity, context } = renderPage(null, undefined, true);
      await user.click(
        await screen.findByTestId(
          "organization-notifications-settings-changed",
        ),
      );
      await user.click(screen.getByTestId("organization-notifications-save"));
      fetchMeContextMock.mockResolvedValue({
        ...context,
        user: { ...context.user, id: "user-2" },
      });
      replaceIdentity("user-2");
      await screen.findByTestId("organization-notifications-settings-changed");
      if (destination === "user-1") {
        fetchMeContextMock.mockResolvedValue(context);
        replaceIdentity("user-1");
        await screen.findByTestId(
          "organization-notifications-settings-changed",
        );
      }
      await user.click(
        screen.getByTestId("organization-notifications-monitor-alerts"),
      );
      await user.click(screen.getByTestId("organization-notifications-save"));
      expect(updateSettingsMock).toHaveBeenNthCalledWith(2, ORG_A, {
        monitorAlertsEnabled: false,
        expectedVersion: 4,
      });
      const reads = fetchSettingsMock.mock.calls.length;
      await act(async () => {
        oldSave.resolve({
          organizationId: ORG_A,
          settingsChangedEnabled: false,
          monitorAlertsEnabled: true,
          version: 5,
        });
        await oldSave.promise;
      });
      expect(
        screen.getByTestId("organization-notifications-monitor-alerts"),
      ).not.toBeChecked();
      expect(
        screen.getByTestId("organization-notifications-settings-changed"),
      ).toBeChecked();
      expect(
        screen.getByTestId("organization-notifications-save"),
      ).toBeDisabled();
      expect(
        screen.queryByTestId("organization-notifications-success"),
      ).toBeNull();
      expect(fetchSettingsMock).toHaveBeenCalledTimes(reads);
      expect(updateSettingsMock).toHaveBeenNthCalledWith(1, ORG_A, {
        settingsChangedEnabled: false,
        expectedVersion: 4,
      });
      expect(updateSettingsMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        currentSave.reject(
          new ApiError("SETTINGS_VERSION_CONFLICT", "conflict", 409),
        );
        await currentSave.promise.catch(() => {});
      });
      expect(
        await screen.findByTestId(
          "organization-notifications-version-conflict",
        ),
      ).toHaveRole("alert");
      expect(
        screen.getByTestId("organization-notifications-monitor-alerts"),
      ).not.toBeChecked();
      expect(
        screen.queryByTestId("organization-notifications-success"),
      ).toBeNull();
    },
  );

  it.each([false, true])(
    "withdraws settings conservatively during same-org publication (transient failure: %s)",
    async (fail) => {
      fetchSettingsMock.mockResolvedValue({
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version: 4,
      });
      const user = userEvent.setup();
      const { queryClient } = renderPage();
      await user.click(
        await screen.findByTestId(
          "organization-notifications-settings-changed",
        ),
      );
      const context =
        queryClient.getQueryData<Awaited<ReturnType<typeof fetchMeContext>>>(
          ME_CONTEXT_QUERY_KEY,
        );
      if (context === undefined) throw new Error("Expected verified bootstrap");
      const claim = createContextPublicationClaim();
      act(() => {
        claimContextPublication(queryClient, claim, "membership");
      });
      expect(
        await screen.findByTestId("shell-admission-loading"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("organization-notifications-settings"),
      ).toBeNull();
      expect(
        screen.queryByTestId("organization-notifications-denied"),
      ).toBeNull();
      if (fail) {
        act(() => {
          failContextPublication(
            queryClient,
            claim,
            new ApiError("INTERNAL", "transient", 500),
          );
        });
        expect(
          await screen.findByTestId("shell-admission-error"),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("organization-notifications-denied"),
        ).toBeNull();
      } else {
        act(() => {
          publishContextPublication(queryClient, claim, context);
        });
        expect(
          await screen.findByTestId(
            "organization-notifications-settings-changed",
          ),
        ).toBeChecked();
        // Existing shell policy remounts settings: this is baseline proof, not a new retention policy.
        expect(
          screen.getByTestId("organization-notifications-save"),
        ).toBeDisabled();
      }
      expect(updateSettingsMock).not.toHaveBeenCalled();
    },
  );

  it("keeps a pending save locked when same-org publication retains known authority", async () => {
    const initial = {
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 4,
    };
    const saved = {
      organizationId: ORG_A,
      settingsChangedEnabled: false,
      monitorAlertsEnabled: true,
      version: 5,
    };
    fetchSettingsMock.mockResolvedValue(initial);
    const pending = Promise.withResolvers<typeof saved>();
    updateSettingsMock.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    const { queryClient, context } = renderPage();
    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    await user.click(screen.getByTestId("organization-notifications-save"));
    const claim = createContextPublicationClaim();
    act(() => {
      claimContextPublication(queryClient, claim, "switch");
    });
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("organization-notifications-save"),
    ).toBeDisabled();
    act(() => {
      publishContextPublication(queryClient, claim, context);
    });
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-monitor-alerts"),
    ).toBeDisabled();
    expect(
      screen.queryByTestId("organization-notifications-success"),
    ).toBeNull();
    expect(updateSettingsMock).toHaveBeenCalledExactlyOnceWith(ORG_A, {
      settingsChangedEnabled: false,
      expectedVersion: 4,
    });
    fetchSettingsMock.mockResolvedValue(saved);
    await act(async () => {
      pending.resolve(saved);
      await pending.promise;
    });
    await vi.waitFor(() =>
      expect(
        screen.getByTestId("organization-notifications-monitor-alerts"),
      ).toBeEnabled(),
    );
    expect(
      screen.getByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-save"),
    ).toBeDisabled();
  });

  it("withdraws private controls when a settings refetch returns a known 403 after an edit", async () => {
    fetchSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 4,
    });
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    await user.click(
      await screen.findByTestId("organization-notifications-settings-changed"),
    );
    fetchSettingsMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "withdrawn", 403),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ["tenant"] }));
    expect(
      await screen.findByTestId("organization-notifications-denied"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-notifications-settings"),
    ).toBeNull();
    expect(
      screen.queryByTestId("organization-notifications-save-retry"),
    ).toBeNull();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });
});
