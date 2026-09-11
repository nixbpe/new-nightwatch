import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMeContext } from "../../lib/api/me";
import { settingsIndexLoader } from "../../lib/auth/loaders";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { SecurityPage } from "./SecurityPage";
import { SETTINGS_TABS } from "./settings-tabs";
import { SettingsLayout } from "./SettingsLayout";

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    data: {
      user: {
        id: "user-1",
        email: "napat@example.com",
        emailVerified: true,
        name: "นภัส วงศ์สกุล",
      },
    },
    isPending: false,
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    getSession: vi.fn(),
    twoFactor: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../../lib/api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});

const fetchMeContextMock = vi.mocked(fetchMeContext);

function meContext(
  organizations: MeContextResponse["organizations"],
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "นภัส วงศ์สกุล",
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId: organizations[0]?.id ?? null,
  };
}

const ORG_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Org A",
  slug: "org-a",
  role: "owner" as const,
};

function renderSettings(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: (
          <QueryClientProvider client={queryClient}>
            <TenantProvider>
              <SettingsLayout />
            </TenantProvider>
          </QueryClientProvider>
        ),
        children: [
          { index: true, loader: settingsIndexLoader },
          { path: "profile", element: <p>หน้าโปรไฟล์</p> },
          { path: "security", element: <SecurityPage /> },
          { path: "sessions", element: <p>หน้าเซสชัน</p> },
          { path: "display", element: <p>หน้าการแสดงผล</p> },
        ],
      },
      { path: "*", element: <p>ไม่พบหน้านี้</p> },
    ],
    { initialEntries: [initialEntry] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

describe("SettingsLayout", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
  });

  it("renders the header with the user's name and the organization scope note, plus one tab per settings route", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ORG_A]));
    renderSettings("/settings/profile");

    expect(
      screen.getByRole("heading", { name: "การตั้งค่าส่วนตัว" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("นภัส วงศ์สกุล · บัญชีของฉัน"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ไม่ใช่การตั้งค่าขององค์กร Org A/),
    ).toBeInTheDocument();

    const tablist = screen.getByRole("tablist", { name: "หมวดการตั้งค่า" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(
      SETTINGS_TABS.map((tab) => tab.path),
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      SETTINGS_TABS.map((tab) => tab.label),
    );
  });

  it("marks the tab for the current URL as selected and swaps the routed content on click", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ORG_A]));
    const user = userEvent.setup();
    renderSettings("/settings/sessions");

    expect(
      screen.getByRole("tab", { name: "เซสชันและอุปกรณ์" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "โปรไฟล์" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByText("หน้าเซสชัน")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "การแสดงผล" }));

    expect(await screen.findByText("หน้าการแสดงผล")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "การแสดงผล" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("/settings lands on the first tab", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ORG_A]));
    const { router } = renderSettings("/settings");

    expect(await screen.findByText("หน้าโปรไฟล์")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/profile");
  });

  it("/settings/security renders the existing security page inside the layout", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ORG_A]));
    renderSettings("/settings/security");

    expect(
      await screen.findByRole("heading", { name: "ความปลอดภัยของบัญชี" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ความปลอดภัย" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("omits the organization note when the user has no membership", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([]));
    renderSettings("/settings/profile");

    expect(await screen.findByText("หน้าโปรไฟล์")).toBeInTheDocument();
    expect(
      screen.getByText("ใช้กับบัญชีของคุณในทุกองค์กร"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ไม่ใช่การตั้งค่าขององค์กร/)).toBeNull();
  });
});
