import { bindQueryClientIdentity } from "../lib/queryClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, createMemoryRouter, RouterProvider } from "react-router";
import { AppShell } from "../components/shell/AppShell";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { fetchMeContext } from "../lib/api/me";
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
vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({
      data: { user: { name: "Test", email: "test@nightwatch.invalid" } },
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
) {
  fetchMeContextMock.mockResolvedValue({
    user: {
      id: "user-1",
      name: "นภัส วงศ์สกุล",
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [{ id: ORG_A, name: "Org A", slug: "org-a", role: "owner" }],
    lastActiveTenantId: ORG_A,
  });
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
          <QueryClientProvider client={queryClient}>
            <TenantProvider>
              <AppShell />
            </TenantProvider>
          </QueryClientProvider>
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
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  fetchSettingsMock.mockReset();
  updateSettingsMock.mockReset();
  fetchMeContextMock.mockReset();
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
    expect(
      screen.getByTestId("organization-notifications-slug"),
    ).toHaveTextContent("org-a");
  });

  it("sends the loaded version with a changed owner setting", async () => {
    fetchSettingsMock
      .mockResolvedValueOnce({
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version: 4,
      })
      .mockResolvedValue({
        organizationId: ORG_A,
        settingsChangedEnabled: false,
        monitorAlertsEnabled: true,
        version: 5,
      });
    updateSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: false,
      monitorAlertsEnabled: true,
      version: 5,
    });
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByTestId(
      "organization-notifications-settings-changed",
    );
    await user.click(toggle);
    await user.click(screen.getByTestId("organization-notifications-save"));

    expect(updateSettingsMock).toHaveBeenCalledWith(ORG_A, {
      settingsChangedEnabled: false,
      expectedVersion: 4,
    });
    expect(
      await screen.findByTestId("organization-notifications-settings-changed"),
    ).not.toBeChecked();
    expect(
      await screen.findByTestId("organization-notifications-success"),
    ).toBeInTheDocument();
  });

  it("shows the monitor alerts checkbox and saves only that toggle", async () => {
    fetchSettingsMock
      .mockResolvedValueOnce({
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
        version: 6,
      })
      .mockResolvedValue({
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: false,
        version: 7,
      });
    updateSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: false,
      version: 7,
    });
    const user = userEvent.setup();
    renderPage();

    const monitorToggle = await screen.findByTestId(
      "organization-notifications-monitor-alerts",
    );
    expect(monitorToggle).toBeChecked();
    expect(
      screen.getByTestId("organization-notifications-save"),
    ).toBeDisabled();

    await user.click(monitorToggle);
    await user.click(screen.getByTestId("organization-notifications-save"));

    expect(updateSettingsMock).toHaveBeenCalledWith(ORG_A, {
      monitorAlertsEnabled: false,
      expectedVersion: 6,
    });
    expect(
      await screen.findByTestId("organization-notifications-monitor-alerts"),
    ).not.toBeChecked();
    expect(
      await screen.findByTestId("organization-notifications-success"),
    ).toBeInTheDocument();
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
    await user.click(
      screen.getByTestId("organization-notifications-save-retry"),
    );
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
});
