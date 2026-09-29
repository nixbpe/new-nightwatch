import type {
  MeContextResponse,
  NotificationItem,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { InboxScopeChangedError } from "../../lib/api/notifications";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import {
  claimContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
} from "../../lib/queryClient";
import { NotificationsPage } from "../../pages/NotificationsPage";
import { WorkspacePage } from "../../pages/WorkspacePage";
import { fetchOrganizationMembers } from "../../lib/api/members";
import { OrganizationMembersPage } from "../../pages/OrganizationMembersPage";
import { AppShell } from "./AppShell";

// The page header renders scope as a name plus a pill, so match inside the header.
async function findScope(name: string, tag: string) {
  // Re-query on every retry: the page remounts its header across context refreshes.
  return waitFor(() => {
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    if (header === null) {
      throw new Error("page header missing");
    }
    expect(within(header).getByText(name)).toBeInTheDocument();
    expect(within(header).getByText(tag)).toBeInTheDocument();
    return header;
  });
}

const {
  fetchNotificationsMock,
  fetchUnreadCountMock,
  markAllNotificationsReadMock,
  openNotificationMock,
  sessionState,
  signOutMock,
} = vi.hoisted(() => ({
  fetchNotificationsMock: vi.fn(),
  fetchUnreadCountMock: vi.fn(),
  markAllNotificationsReadMock: vi.fn(),
  openNotificationMock: vi.fn(),
  sessionState: {
    data: { user: { email: "napat@example.com", name: "นภัส วงศ์สกุล" } },
    isPending: false,
  },
  signOutMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    signOut: signOutMock,
    organization: { inviteMember: vi.fn() },
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
vi.mock("../../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchNotifications: fetchNotificationsMock,
    fetchUnreadCount: fetchUnreadCountMock,
    markAllNotificationsRead: markAllNotificationsReadMock,
    openNotification: openNotificationMock,
  };
});

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchOrganizationMembersMock = vi.mocked(fetchOrganizationMembers);

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ownerOrg = {
  id: ORG_A,
  name: "Org A",
  slug: "org-a",
  role: "owner" as const,
};
const viewerOrg = {
  id: ORG_B,
  name: "Org B",
  slug: "org-b",
  role: "viewer" as const,
};

function meContext(
  organizations: MeContextResponse["organizations"],
  lastActiveTenantId: string | null = null,
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "นภัส วงศ์สกุล",
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: true,
    },
    organizations,
    lastActiveTenantId,
  };
}

function ThrowingPage(): never {
  throw new Error("boom");
}

function renderShell(
  workspaceElement: ReactNode = <p>เนื้อหาหน้า</p>,
  initialPath = "/workspace",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
          { path: "/workspace", element: workspaceElement },
          {
            path: "/organizations/:organizationId/members",
            element: <OrganizationMembersPage />,
          },
          { path: "/notifications", element: <NotificationsPage /> },
          { path: "/settings/security", element: <p>หน้าความปลอดภัย</p> },
          { path: "/settings/sessions", element: <p>หน้าเซสชัน</p> },
          {
            path: "/organizations/:organizationId/notification-settings",
            element: <p>หน้าตั้งค่าองค์กร</p>,
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  return { queryClient, ...render(<RouterProvider router={router} />) };
}

function mockMobileViewport(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
      }) satisfies MediaQueryList,
  );
}

fetchNotificationsMock.mockResolvedValue({
  items: [],
  nextCursor: null,
  unreadCount: 0,
});
fetchUnreadCountMock.mockResolvedValue({ unreadCount: 0 });

describe("AppShell", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    fetchOrganizationMembersMock.mockReset();
    fetchNotificationsMock.mockReset();
    fetchUnreadCountMock.mockReset();
    markAllNotificationsReadMock.mockReset();
    openNotificationMock.mockReset();
    signOutMock.mockReset();
    vi.restoreAllMocks();
    fetchNotificationsMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 0 });
  });

  it("renders org switcher, breadcrumb, nav sections, account block, skip link and routed content", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    renderShell();

    const orgSwitcher = await screen.findByRole("button", {
      name: /Org A/,
    });
    expect(orgSwitcher).toHaveTextContent(/องค์กร\s*เจ้าของ/);

    const breadcrumb = screen.getByRole("navigation", {
      name: "ตำแหน่งปัจจุบัน",
    });
    expect(
      within(breadcrumb).getByRole("link", { name: "Org A" }),
    ).toHaveAttribute("href", "/workspace");
    expect(within(breadcrumb).getByText("ภาพรวม")).toHaveAttribute(
      "aria-current",
      "page",
    );

    // A labelled section, not an accordion: no expandable control.
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(within(nav).getByRole("link", { name: "ภาพรวม" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(
      within(nav).getByRole("link", { name: "การแจ้งเตือน" }),
    ).toHaveAttribute("href", "/notifications");
    expect(
      within(nav).getByRole("link", { name: "การตั้งค่าส่วนตัว" }),
    ).toHaveAttribute("href", "/settings");
    expect(within(nav).getByText("องค์กร")).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "ตั้งค่าการแจ้งเตือน" }),
    ).toHaveAttribute("href", `/organizations/${ORG_A}/notification-settings`);
    // Palette-only sub-destinations never become sidebar rows.
    expect(
      within(nav).queryByRole("link", { name: "เซสชันและอุปกรณ์" }),
    ).toBeNull();
    expect(within(nav).queryByRole("button")).toBeNull();

    expect(
      screen.getByRole("button", { name: "เมนูบัญชีผู้ใช้" }),
    ).toHaveTextContent("napat@example.com");

    expect(
      screen.getByRole("link", { name: "ข้ามไปที่เนื้อหาหลัก" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByText("เนื้อหาหน้า")).toBeInTheDocument();
    expect(screen.getByText("ค้นหาทั้งหมด...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "การแจ้งเตือน" }),
    ).toBeInTheDocument();
  });

  it("shows the organization member destination to a viewer without notification settings", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([viewerOrg], ORG_B));
    renderShell();
    await screen.findByRole("link", { name: "Org B" });

    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(within(nav).getByText("องค์กร")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "สมาชิก" })).toHaveAttribute(
      "href",
      `/organizations/${ORG_B}/members`,
    );
    expect(
      within(nav).queryByRole("link", { name: "ตั้งค่าการแจ้งเตือน" }),
    ).toBeNull();
  });

  it("an organization-scoped route names its own organization even when another one is active", async () => {
    // A bookmarked URL for Org B while Org A is active: the page acts on B, so the crumb says B
    // and the sidebar's org leaf (linking to A) is not current.
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, { ...viewerOrg, role: "owner" as const }], ORG_A),
    );
    renderShell(undefined, `/organizations/${ORG_B}/notification-settings`);
    expect(await screen.findByText("หน้าตั้งค่าองค์กร")).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", {
      name: "ตำแหน่งปัจจุบัน",
    });
    // No /workspace link: it would open A's workspace.
    expect(await within(breadcrumb).findByText("Org B")).toBeInTheDocument();
    expect(
      within(breadcrumb).queryByRole("link", { name: "Org B" }),
    ).toBeNull();
    expect(within(breadcrumb).queryByText("Org A")).toBeNull();
    expect(within(breadcrumb).getByText("ตั้งค่าการแจ้งเตือน")).toHaveAttribute(
      "aria-current",
      "page",
    );

    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    const orgLeaf = within(nav).getByRole("link", {
      name: "ตั้งค่าการแจ้งเตือน",
    });
    expect(orgLeaf).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/notification-settings`,
    );
    expect(orgLeaf).not.toHaveAttribute("aria-current");
  });

  it("a crashing page is caught without losing the shell chrome", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderShell(<ThrowingPage />);

    expect(
      await screen.findByRole("link", { name: "Org A" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ภาพรวม" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");

    consoleError.mockRestore();
  });

  it("the account menu opens upward with focus on its settings link and Escape returns focus", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    const trigger = screen.getByRole("button", { name: "เมนูบัญชีผู้ใช้" });
    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "บัญชีของฉัน" });
    const settings = within(menu).getByRole("menuitem", {
      name: "การตั้งค่าส่วนตัว",
    });
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute("href", "/settings/profile");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(within(menu).queryByText(/2FA/)).toBeNull();
    expect(within(menu).getByText("เจ้าของ")).toBeInTheDocument();
    expect(
      within(menu).getByRole("group", { name: "ธีม" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "ออกจากระบบ" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "บัญชีของฉัน" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("makes the mobile drawer modal and inert, and wraps focus in both directions", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    mockMobileViewport();
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    const opener = screen.getByRole("button", { name: "เปิดเมนู" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "เมนูหลัก" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const close = within(dialog).getByRole("button", { name: "ปิดเมนู" });
    expect(close).toHaveFocus();

    const background = screen.getByText("เนื้อหาหน้า").closest("[inert]");
    expect(background).not.toBeNull();
    expect(background).toContainElement(opener);

    const last = within(dialog).getByRole("button", {
      name: "เมนูบัญชีผู้ใช้",
    });
    last.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it("closes the mobile drawer without locking the page when the viewport reaches sm", async () => {
    let desktop = false;
    const listeners = new Set<EventListenerOrEventListenerObject>();
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query): MediaQueryList =>
        ({
          matches: query === "(min-width: 640px)" ? desktop : false,
          media: query,
          onchange: null,
          addEventListener: (
            _type: string,
            listener: EventListenerOrEventListenerObject,
          ) => {
            listeners.add(listener);
          },
          removeEventListener: (
            _type: string,
            listener: EventListenerOrEventListenerObject,
          ) => {
            listeners.delete(listener);
          },
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: () => true,
        }) satisfies MediaQueryList,
    );
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: "เปิดเมนู" }));
    expect(
      screen.getByRole("dialog", { name: "เมนูหลัก" }),
    ).toBeInTheDocument();

    desktop = true;
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener(new Event("change"));
      } else {
        listener.handleEvent(new Event("change"));
      }
    }

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "เมนูหลัก" })).toBeNull();
    });
    expect(screen.getByText("เนื้อหาหน้า").closest("[inert]")).toBeNull();
  });

  it("restores mobile drawer focus after close control, backdrop, Escape, and navigation closes", async () => {
    mockMobileViewport();
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    const opener = screen.getByRole("button", { name: "เปิดเมนู" });
    const openDrawer = async () => {
      await user.click(opener);
      return screen.getByRole("dialog", { name: "เมนูหลัก" });
    };
    const expectFocusRestored = async () => {
      await waitFor(() => {
        expect(opener).toHaveFocus();
      });
    };

    let dialog = await openDrawer();
    await user.click(within(dialog).getByRole("button", { name: "ปิดเมนู" }));
    await expectFocusRestored();

    dialog = await openDrawer();
    await user.click(
      within(dialog).getByRole("button", {
        name: "ปิดเมนูด้วยฉากหลัง",
      }),
    );
    await expectFocusRestored();

    await openDrawer();
    await user.keyboard("{Escape}");
    await expectFocusRestored();

    await user.keyboard("{Enter}");
    dialog = screen.getByRole("dialog", { name: "เมนูหลัก" });
    await user.click(within(dialog).getByRole("link", { name: "ภาพรวม" }));
    await expectFocusRestored();
  });

  it("follows a remote organization switch over this tab's earlier selection", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_B),
    );
    const user = userEvent.setup();
    renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");

    // Another session switches back to Org A after this tab selected B.
    fetchUnreadCountMock.mockRejectedValue(new InboxScopeChangedError());
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    await user.click(screen.getByRole("button", { name: /Org A/ }));
    await user.click(
      within(screen.getByRole("menu", { name: "สลับองค์กร" })).getByRole(
        "menuitemradio",
        { name: /Org B/ },
      ),
    );

    expect(updateActiveOrganizationMock).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(fetchMeContextMock.mock.calls.length).toBeGreaterThan(1);
    });
    await findScope("Org A", "เจ้าของ");
  });

  it("switching organization from the sidebar publishes the new tenant only after the PATCH succeeds", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_B),
    );
    const user = userEvent.setup();
    const { queryClient } = renderShell(<WorkspacePage />);
    const directLoaderClaim = createContextPublicationClaim();
    expect(claimContextPublication(queryClient, directLoaderClaim)).toBe(true);

    await findScope("Org A", "เจ้าของ");

    await user.click(screen.getByRole("button", { name: /Org A/ }));
    const menu = screen.getByRole("menu", { name: "สลับองค์กร" });
    expect(
      within(menu).getByRole("menuitemradio", { name: /Org A/ }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(
      within(menu).getByRole("menuitemradio", { name: /Org B/ }),
    );

    await findScope("Org B", "ผู้ชม");
    expect(hasContextPublicationClaim(queryClient, directLoaderClaim)).toBe(
      false,
    );
    expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
      organizationId: ORG_B,
    });
    expect(screen.getByRole("button", { name: /Org B/ })).toHaveTextContent(
      /องค์กร\s*ผู้ชม/,
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
      ).getByRole("link", { name: "Org B" }),
    ).toBeInTheDocument();
  });

  it("a denied switch keeps the current organization", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "denied", 403),
    );
    const user = userEvent.setup();
    renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");

    await user.click(screen.getByRole("button", { name: /Org A/ }));
    await user.click(
      within(screen.getByRole("menu", { name: "สลับองค์กร" })).getByRole(
        "menuitemradio",
        { name: /Org B/ },
      ),
    );

    await waitFor(() => {
      expect(updateActiveOrganizationMock).toHaveBeenCalled();
    });
    await findScope("Org A", "เจ้าของ");
    expect(screen.getByRole("button", { name: /Org A/ })).toBeInTheDocument();
  });

  it("retires role-dependent shell controls after a permission denial refreshes an owner to viewer", async () => {
    const downgradedOrg = { ...ownerOrg, role: "viewer" as const };
    const denial = Promise.withResolvers<never>();
    fetchMeContextMock
      .mockResolvedValueOnce(meContext([ownerOrg], ORG_A))
      .mockResolvedValueOnce(meContext([downgradedOrg], ORG_A));
    fetchOrganizationMembersMock.mockImplementationOnce(() => denial.promise);

    renderShell(<WorkspacePage />, `/organizations/${ORG_A}/members`);

    expect(
      await screen.findByRole("link", { name: "ตั้งค่าการแจ้งเตือน" }),
    ).toBeInTheDocument();
    denial.reject(new ApiError("PERMISSION_DENIED", "role downgraded", 403));
    await findScope("Org A", "ผู้ชม");
    expect(
      screen.queryByRole("link", { name: "ตั้งค่าการแจ้งเตือน" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
    expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();
  });

  it("⌘K includes every owner destination and navigates from a filtered result", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = screen.getByRole("dialog", { name: "ค้นหาทั้งหมด" });
    const input = within(dialog).getByRole("combobox", {
      name: "ค้นหาทั้งหมด",
    });
    expect(input).toHaveFocus();
    expect(within(dialog).getAllByRole("option")).toHaveLength(9);
    for (const name of [
      "ภาพรวม",
      "การแจ้งเตือน",
      "การตั้งค่าส่วนตัว",
      "โปรไฟล์",
      "ความปลอดภัย",
      "เซสชันและอุปกรณ์",
      "การแสดงผล",
      "สมาชิก",
      "ตั้งค่าการแจ้งเตือน",
    ]) {
      expect(
        within(dialog).getByRole("option", {
          name: new RegExp(`^${name}`),
        }),
      ).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent("ค้นหาใน Org A");

    await user.keyboard("เซสชัน");
    const filteredOptions = within(dialog).getAllByRole("option");
    expect(filteredOptions).toHaveLength(1);
    expect(filteredOptions[0]).toHaveTextContent("เซสชันและอุปกรณ์");
    expect(filteredOptions[0]).toHaveTextContent("การตั้งค่าส่วนตัว");

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "ค้นหาทั้งหมด" })).toBeNull();
    expect(await screen.findByText("หน้าเซสชัน")).toBeInTheDocument();
  });

  it("the header search field opens the same palette and Escape returns focus to it", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    const field = screen.getByRole("button", { name: /ค้นหาทั้งหมด\.\.\./ });
    await user.click(field);
    expect(
      screen.getByRole("dialog", { name: "ค้นหาทั้งหมด" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "ค้นหาทั้งหมด" })).toBeNull();
    expect(field).toHaveFocus();
  });

  it("uses the server unread count when marking all notifications read", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    let resolveUnreadCount!: (value: { unreadCount: number }) => void;
    const unreadCount = new Promise<{ unreadCount: number }>((resolve) => {
      resolveUnreadCount = resolve;
    });
    fetchUnreadCountMock.mockReturnValue(unreadCount);
    fetchNotificationsMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 1,
    });
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    const panel = screen.getByRole("dialog", { name: "การแจ้งเตือน" });
    const markAll = within(panel).getByRole("button", {
      name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
    });
    expect(markAll).toBeDisabled();

    resolveUnreadCount({ unreadCount: 1 });
    expect(
      await screen.findByLabelText("1 รายการยังไม่อ่าน"),
    ).toHaveTextContent("1");
    expect(markAll).toBeEnabled();
    await user.click(markAll);
    expect(markAllNotificationsReadMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the context when the server resolves another inbox scope", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockRejectedValue(new InboxScopeChangedError());
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await vi.waitFor(() => {
      expect(fetchMeContextMock.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("falls back to the list unread count when the count request fails", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockRejectedValue(new Error("count down"));
    fetchNotificationsMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 2,
    });
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));

    expect(
      await screen.findByLabelText("2 รายการยังไม่อ่าน"),
    ).toHaveTextContent("2");
    expect(
      screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านทั้งหมด" }),
    ).toBeEnabled();
  });

  it("ignores further popover row clicks while an open is pending", async () => {
    const first: NotificationItem = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope: "account",
      organizationId: null,
      eventType: "PASSWORD_CHANGED",
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: null,
      category: null,
    };
    const second: NotificationItem = {
      ...first,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      eventType: "MFA_ENABLED",
    };
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 2 });
    fetchNotificationsMock.mockResolvedValue({
      items: [first, second],
      nextCursor: null,
      unreadCount: 2,
    });
    openNotificationMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await user.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );
    await user.click(
      screen.getByRole("button", {
        name: /เปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว/,
      }),
    );

    expect(openNotificationMock).toHaveBeenCalledTimes(1);
    expect(openNotificationMock.mock.calls[0]?.[0]).toBe(first.id);
  });

  it("shows a popover mark-all failure and keeps the action retryable", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
    fetchNotificationsMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 1,
    });
    markAllNotificationsReadMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await screen.findByLabelText("1 รายการยังไม่อ่าน");
    const markAll = screen.getByRole("button", {
      name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
    });
    await user.click(markAll);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ทำเครื่องหมายว่าอ่านทั้งหมดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    );
    expect(markAll).toBeEnabled();
  });

  it("opens a selected popover notification in the center with its persisted read state", async () => {
    const notification: NotificationItem = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope: "account",
      organizationId: null,
      eventType: "PASSWORD_CHANGED",
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: null,
      category: null,
    };
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
    fetchNotificationsMock.mockResolvedValue({
      items: [notification],
      nextCursor: null,
      unreadCount: 1,
    });
    openNotificationMock.mockResolvedValue({
      ...notification,
      readAt: "2026-09-25T03:01:00.000Z",
    });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("link", { name: "Org A" });
    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await user.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );

    expect(await screen.findByText("อ่านแล้ว")).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", {
      name: "ตำแหน่งปัจจุบัน",
    });
    expect(within(breadcrumb).getByText("การแจ้งเตือน")).toBeInTheDocument();
  });

  it("lists monitor notifications in the popover with title, icon and monitor link", async () => {
    const monitorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const base = {
      scope: "organization" as const,
      organizationId: ORG_A,
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: null,
      category: "monitor" as const,
      subject: { monitorId, monitorName: "Checkout" },
    };
    const items: NotificationItem[] = [
      {
        ...base,
        id: "10000000-0000-4000-8000-000000000001",
        eventType: "MONITOR_DOWN",
        reason: "http_status",
        sslNotAfter: null,
      },
      {
        ...base,
        id: "10000000-0000-4000-8000-000000000002",
        eventType: "MONITOR_RECOVERED",
        reason: null,
        sslNotAfter: null,
      },
      ...(["CAUTION", "DANGER", "EXPIRED"] as const).map(
        (level, index): NotificationItem => ({
          ...base,
          id: `10000000-0000-4000-8000-00000000000${String(index + 3)}`,
          eventType: `MONITOR_SSL_${level}`,
          reason: null,
          sslNotAfter: "2026-10-20T00:00:00.000Z",
        }),
      ),
    ];
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 5 });
    fetchNotificationsMock.mockResolvedValue({
      items,
      nextCursor: null,
      unreadCount: 5,
    });
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("link", { name: "Org A" });
    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    const popover = await screen.findByRole("dialog", {
      name: "การแจ้งเตือน",
    });
    const rows = within(popover).getAllByRole("listitem");

    expect(
      rows.map((row) => within(row).getByRole("button").textContent),
    ).toEqual([
      expect.stringContaining("มอนิเตอร์ Checkout ล่ม"),
      expect.stringContaining("มอนิเตอร์ Checkout กลับมาทำงานแล้ว"),
      expect.stringContaining("ใกล้หมดอายุ (เหลือไม่เกิน 30 วัน)"),
      expect.stringContaining("ใกล้หมดอายุมาก (เหลือไม่เกิน 7 วัน)"),
      expect.stringContaining("หมดอายุแล้ว"),
    ]);
    for (const row of rows) {
      expect(row.querySelector("svg")).not.toBeNull();
      expect(
        within(row).getByRole("link", { name: "เปิดมอนิเตอร์" }),
      ).toHaveAttribute(
        "href",
        `/organizations/${ORG_A}/monitors/${monitorId}`,
      );
    }
  });

  it("shows a popover open failure while keeping the list for retry", async () => {
    const notification: NotificationItem = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope: "account",
      organizationId: null,
      eventType: "PASSWORD_CHANGED",
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: null,
      category: null,
    };
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
    fetchNotificationsMock.mockResolvedValue({
      items: [notification],
      nextCursor: null,
      unreadCount: 1,
    });
    openNotificationMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderShell();

    await screen.findByRole("link", { name: "Org A" });
    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await user.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "เปิดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    );
    expect(
      screen.getByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    ).toBeInTheDocument();
  });

  it("with no membership the logo slot falls back to the product mark", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([]));
    renderShell(<WorkspacePage />);

    await screen.findByRole("heading", {
      name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
    });
    expect(screen.getByText("NightWatch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /องค์กร:/ })).toBeNull();
  });
});
