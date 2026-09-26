import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationNotificationSettings,
  updateOrganizationNotificationSettings,
} from "../lib/api/notifications";
import { OrganizationNotificationSettingsPage } from "./OrganizationNotificationSettingsPage";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

vi.mock("../lib/api/notifications", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchOrganizationNotificationSettings: vi.fn(),
    updateOrganizationNotificationSettings: vi.fn(),
  };
});

const fetchSettingsMock = vi.mocked(fetchOrganizationNotificationSettings);
const updateSettingsMock = vi.mocked(updateOrganizationNotificationSettings);

function renderPage(extra: React.ReactNode = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/organizations/${ORG_A}/notification-settings`]}
      >
        <Routes>
          <Route
            path="/organizations/:organizationId/notification-settings"
            element={
              <>
                {extra}
                <OrganizationNotificationSettingsPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  fetchSettingsMock.mockReset();
  updateSettingsMock.mockReset();
});

describe("OrganizationNotificationSettingsPage", () => {
  it("sends the loaded version with a changed owner setting", async () => {
    fetchSettingsMock
      .mockResolvedValueOnce({
        organizationId: ORG_A,
        settingsChangedEnabled: true,
        version: 4,
      })
      .mockResolvedValue({
        organizationId: ORG_A,
        settingsChangedEnabled: false,
        version: 5,
      });
    updateSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: false,
      version: 5,
    });
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole("checkbox");
    await user.click(toggle);
    await user.click(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    );

    expect(await screen.findByRole("checkbox")).not.toBeChecked();
  });

  it("shows a distinct permission denial and optimistic-concurrency conflict", async () => {
    fetchSettingsMock.mockRejectedValueOnce(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderPage();
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์จัดการการตั้งค่านี้"),
    ).toBeInTheDocument();

    fetchSettingsMock.mockReset();
    fetchSettingsMock.mockResolvedValue({
      organizationId: ORG_A,
      settingsChangedEnabled: true,
      version: 4,
    });
    updateSettingsMock.mockRejectedValue(
      new ApiError("SETTINGS_VERSION_CONFLICT", "conflict", 409),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    );
    expect(
      await screen.findByText("การตั้งค่าถูกเปลี่ยนโดยผู้อื่น กรุณาโหลดใหม่"),
    ).toBeInTheDocument();
  });

  it("drops an unsaved draft when navigating to another organization", async () => {
    fetchSettingsMock.mockImplementation((organizationId) =>
      Promise.resolve({
        organizationId,
        settingsChangedEnabled: true,
        version: organizationId === ORG_A ? 4 : 9,
      }),
    );
    const user = userEvent.setup();
    renderPage(
      <Link to={`/organizations/${ORG_B}/notification-settings`}>
        องค์กร B
      </Link>,
    );

    await user.click(await screen.findByRole("checkbox"));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("link", { name: "องค์กร B" }));

    await vi.waitFor(() => {
      expect(fetchSettingsMock).toHaveBeenCalledWith(ORG_B);
    });
    expect(await screen.findByRole("checkbox")).toBeChecked();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });
});
