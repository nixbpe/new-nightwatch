import { contextQueryOptions } from "../../lib/tenant/bootstrap";
import {
  markAllNotificationsRead,
  openNotification,
} from "../../lib/api/notifications";
import { guardUnassignedNetwork } from "../../test/guard-network";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type {
  MeContextResponse,
  NotificationItem,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { InboxScopeChangedError } from "../../lib/api/notifications";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import {
  retireContextPublication,
  getContextPublicationSnapshot,
  publishContextPublication,
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
  fetchMonitorListMock,
  fetchNotificationsMock,
  fetchUnreadCountMock,
  markAllNotificationsReadMock,
  openNotificationMock,
  sessionState,
  signOutMock,
} = vi.hoisted(() => ({
  fetchMonitorListMock: vi.fn(),
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

vi.mock("../../lib/api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});
vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(async (organizationId: string) =>
    (await import("../../test/pendingInvitations")).emptyPendingInvitationList(
      organizationId,
    ),
  ),
}));
vi.mock("../../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorList: fetchMonitorListMock,
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

guardUnassignedNetwork();
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
          { path: "/workspace", element: workspaceElement },
          {
            path: "/organizations/:organizationId/members",
            element: <OrganizationMembersPage />,
          },
          { path: "/notifications", element: <NotificationsPage /> },
          {
            path: "/organizations/:organizationId/monitors",
            element: <p>หน้ามอนิเตอร์</p>,
          },
          { path: "/settings/security", element: <p>หน้าความปลอดภัย</p> },
          { path: "/settings/sessions", element: <p>หน้าเซสชัน</p> },
          {
            path: "/organizations/:organizationId/notification-settings",
            element: <p>หน้าตั้งค่าองค์กร</p>,
          },
          {
            path: "/organizations/:organizationId/audit-log",
            element: <p>หน้าบันทึกกิจกรรม</p>,
          },
          {
            path: "/organizations/:organizationId/audit-log/:eventId",
            element: <p>หน้ารายละเอียดบันทึกกิจกรรม</p>,
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  return { queryClient, router, ...render(<RouterProvider router={router} />) };
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
// The sidebar reads `summary.total`; the overview page also renders the full response.
const monitorList = (total: number) => ({
  summary: { up: 0, down: 0, unknown: 0, paused: 0, total, limit: 50 },
  monitors: [],
  page: { limit: 50, offset: 0, total },
  dataAsOf: "2026-10-02T05:00:00.000Z",
});
fetchMonitorListMock.mockResolvedValue(monitorList(0));

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
    fetchMonitorListMock.mockReset();
    fetchMonitorListMock.mockResolvedValue(monitorList(0));
  });

  it("shows nav counts without changing the link names, and hides unknown ones", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchMonitorListMock.mockResolvedValue(monitorList(24));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 3 });
    renderShell();

    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });
    const monitors = await within(nav).findByRole("link", {
      name: "ตรวจสถานะบริการ",
    });
    await waitFor(() => {
      expect(monitors).toHaveTextContent("24");
    });
    const inbox = within(nav).getByRole("link", { name: "การแจ้งเตือน" });
    await waitFor(() => {
      expect(inbox).toHaveTextContent("3");
    });
    expect(within(monitors).getByText("24")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("hides a nav count whose request failed", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchMonitorListMock.mockRejectedValue(new Error("list down"));
    fetchUnreadCountMock.mockRejectedValue(new Error("count down"));
    renderShell();

    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });
    await waitFor(() => {
      expect(fetchMonitorListMock).toHaveBeenCalled();
    });
    expect(nav.querySelector('[data-slot="nav-count"]')).toBeNull();
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
    fetchUnreadCountMock.mockRejectedValueOnce(new InboxScopeChangedError());
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

  it("switching organization on the monitors route moves the page to the new organization", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_B),
    );
    const user = userEvent.setup();
    renderShell(undefined, `/organizations/${ORG_A}/monitors`);
    await screen.findByRole("button", { name: /Org A/ });

    await user.click(screen.getByRole("button", { name: /Org A/ }));
    await user.click(
      within(screen.getByRole("menu", { name: "สลับองค์กร" })).getByRole(
        "menuitemradio",
        { name: /Org B/ },
      ),
    );

    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    await vi.waitFor(() => {
      expect(
        within(nav).getByRole("link", { name: "ตรวจสถานะบริการ" }),
      ).toHaveAttribute("href", `/organizations/${ORG_B}/monitors`);
    });
    // The page acts on the URL's organization, so the crumb follows only if the URL moved.
    const breadcrumb = screen.getByRole("navigation", {
      name: "ตำแหน่งปัจจุบัน",
    });
    expect(await within(breadcrumb).findByText("Org B")).toBeInTheDocument();
  });

  it.each([
    [
      "owner",
      "list",
      `/organizations/${ORG_A}/audit-log?range=30d&page=2`,
      `/organizations/${ORG_B}/audit-log`,
    ],
    [
      "auditor",
      "detail",
      `/organizations/${ORG_A}/audit-log/evt-1`,
      `/organizations/${ORG_B}/audit-log`,
    ],
    [
      "admin",
      "list",
      `/organizations/${ORG_A}/audit-log`,
      `/organizations/${ORG_B}/audit-log`,
    ],
  ] as const)(
    "switching to an organization where the role is %s moves the audit log %s to its list without filters (OD-14)",
    async (role, _page, from, to) => {
      const other = { ...viewerOrg, role };
      fetchMeContextMock.mockResolvedValue(meContext([ownerOrg, other], ORG_A));
      updateActiveOrganizationMock.mockResolvedValue(
        meContext([ownerOrg, other], ORG_B),
      );
      const user = userEvent.setup();
      const { router } = renderShell(undefined, from);
      await screen.findByRole("button", { name: /Org A/ });

      await user.click(screen.getByRole("button", { name: /Org A/ }));
      await user.click(
        within(screen.getByRole("menu", { name: "สลับองค์กร" })).getByRole(
          "menuitemradio",
          { name: /Org B/ },
        ),
      );
      await vi.waitFor(() => {
        expect(
          router.state.location.pathname + router.state.location.search,
        ).toBe(to);
      });
    },
  );

  it.each([
    `/organizations/${ORG_A}/audit-log?range=30d`,
    `/organizations/${ORG_A}/audit-log/evt-1`,
  ])(
    "switching to an organization where the role is viewer sends %s to /workspace (OD-14)",
    async (from) => {
      fetchMeContextMock.mockResolvedValue(
        meContext([ownerOrg, viewerOrg], ORG_A),
      );
      updateActiveOrganizationMock.mockResolvedValue(
        meContext([ownerOrg, viewerOrg], ORG_B),
      );
      const user = userEvent.setup();
      const { router } = renderShell(undefined, from);
      await screen.findByRole("button", { name: /Org A/ });

      await user.click(screen.getByRole("button", { name: /Org A/ }));
      await user.click(
        within(screen.getByRole("menu", { name: "สลับองค์กร" })).getByRole(
          "menuitemradio",
          { name: /Org B/ },
        ),
      );
      await vi.waitFor(() => {
        expect(router.state.location.pathname).toBe("/workspace");
      });
      expect(router.state.location.search).toBe("");
    },
  );

  it("switching organization from the sidebar publishes the new tenant only after the PATCH succeeds", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_B),
    );
    const user = userEvent.setup();
    const { queryClient } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const stalePatchClaim = createContextPublicationClaim();
    expect(
      claimContextPublication(queryClient, stalePatchClaim, "switch"),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /Org A/ }));
    const menu = screen.getByRole("menu", { name: "สลับองค์กร" });
    expect(
      within(menu).getByRole("menuitemradio", { name: /Org A/ }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(
      within(menu).getByRole("menuitemradio", { name: /Org B/ }),
    );

    await findScope("Org B", "ผู้ชม");
    expect(hasContextPublicationClaim(queryClient, stalePatchClaim)).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: /Org B/ })).toHaveTextContent(
      /องค์กร\s*ผู้ชม/,
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
      ).getByRole("link", { name: "Org B" }),
    ).toBeInTheDocument();
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

  it.each(["owner", "admin", "viewer", "auditor"] as const)(
    "shows the monitors leaf in the sidebar and ⌘K to a %s",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(
        meContext([{ ...ownerOrg, role }], ORG_A),
      );
      const user = userEvent.setup();
      renderShell();
      await screen.findByRole("link", { name: "Org A" });

      const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
      expect(
        within(nav).getByRole("link", { name: "ตรวจสถานะบริการ" }),
      ).toHaveAttribute("href", `/organizations/${ORG_A}/monitors`);

      await user.keyboard("{Meta>}k{/Meta}");
      const dialog = screen.getByRole("dialog", { name: "ค้นหาทั้งหมด" });
      await user.keyboard("ตรวจสถานะ");
      const options = within(dialog).getAllByRole("option");
      expect(options).toHaveLength(1);
      await user.keyboard("{Enter}");
      expect(await screen.findByText("หน้ามอนิเตอร์")).toBeInTheDocument();
    },
  );

  it.each([
    ["owner", true],
    ["admin", true],
    ["auditor", true],
    ["viewer", false],
  ] as const)(
    "shows the audit log leaf in the sidebar and ⌘K to a %s: %s (AC-01)",
    async (role, visible) => {
      fetchMeContextMock.mockResolvedValue(
        meContext([{ ...ownerOrg, role }], ORG_A),
      );
      const user = userEvent.setup();
      renderShell();
      await screen.findByRole("link", { name: "Org A" });

      const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
      const leaf = within(nav).queryByRole("link", { name: "บันทึกกิจกรรม" });
      await user.keyboard("{Meta>}k{/Meta}");
      const dialog = screen.getByRole("dialog", { name: "ค้นหาทั้งหมด" });
      await user.keyboard("บันทึกกิจกรรม");
      if (!visible) {
        expect(leaf).toBeNull();
        expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
        return;
      }
      expect(leaf).toHaveAttribute("href", `/organizations/${ORG_A}/audit-log`);
      expect(within(dialog).getAllByRole("option")).toHaveLength(1);
      await user.keyboard("{Enter}");
      expect(await screen.findByText("หน้าบันทึกกิจกรรม")).toBeInTheDocument();
    },
  );

  it("keeps the audit log leaf current and the breadcrumb named on a detail route", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderShell(undefined, `/organizations/${ORG_A}/audit-log/evt-1`);
    expect(
      await screen.findByText("หน้ารายละเอียดบันทึกกิจกรรม"),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(
      await within(nav).findByRole("link", { name: "บันทึกกิจกรรม" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(
        screen.getByRole("navigation", { name: "ตำแหน่งปัจจุบัน" }),
      ).getByText("บันทึกกิจกรรม"),
    ).toBeInTheDocument();
  });

  it("omits the monitors leaf when there is no active organization", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([], null));
    renderShell();
    await screen.findByRole("navigation", { name: "เมนูหลัก" });

    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(
      within(nav).queryByRole("link", { name: "ตรวจสถานะบริการ" }),
    ).toBeNull();
  });

  it("marks the monitors leaf current on the monitors route", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderShell(undefined, `/organizations/${ORG_A}/monitors`);
    expect(await screen.findByText("หน้ามอนิเตอร์")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(
      await within(nav).findByRole("link", { name: "ตรวจสถานะบริการ" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("link", { name: "ภาพรวม" }),
    ).not.toHaveAttribute("aria-current");
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
    expect(within(dialog).getAllByRole("option")).toHaveLength(11);
    for (const name of [
      "ภาพรวม",
      "ตรวจสถานะบริการ",
      "การแจ้งเตือน",
      "การตั้งค่าส่วนตัว",
      "โปรไฟล์",
      "ความปลอดภัย",
      "เซสชันและอุปกรณ์",
      "การแสดงผล",
      "สมาชิก",
      "ตั้งค่าการแจ้งเตือน",
      "บันทึกกิจกรรม",
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
    fetchUnreadCountMock.mockRejectedValueOnce(new InboxScopeChangedError());
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
  it.each(["organization", "account"] as const)(
    "permanent current %s inbox mismatch stops automatic recovery, drops tenant view and supports explicit retry",
    async (scope) => {
      const ctx = meContext(
        scope === "account" ? [] : [ownerOrg],
        scope === "account" ? null : ORG_A,
      );
      fetchMeContextMock.mockResolvedValue(ctx);
      fetchUnreadCountMock.mockRejectedValue(new InboxScopeChangedError());
      const { queryClient, router } = renderShell(
        <p>Protected tenant content</p>,
      );
      await screen.findByText("โหลดข้อมูลองค์กรไม่สำเร็จ กรุณาลองใหม่");
      expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
        "failed",
      );
      expect(screen.queryByText("Protected tenant content")).toBeNull();
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
      expect(fetchUnreadCountMock).toHaveBeenCalledTimes(2);
      fetchUnreadCountMock.mockResolvedValue({ unreadCount: 4 });
      await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
      await screen.findByText("Protected tenant content");
      expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
        "confirmed",
      );
      expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
      expect(screen.getByRole("link", { name: "การแจ้งเตือน" })).toBeVisible();
      router.dispose();
      await queryClient.cancelQueries();
      queryClient.clear();
    },
  );
  it("concurrent known query and mark-all errors dedupe required recovery; late old-generation error cannot withdraw B", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const query = Promise.withResolvers<{ unreadCount: number }>();
    fetchUnreadCountMock.mockReturnValueOnce(query.promise);
    const mutation = Promise.withResolvers<never>();
    markAllNotificationsReadMock.mockReturnValueOnce(mutation.promise);
    const resolving = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockReturnValueOnce(resolving.promise);
    const operation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: markAllNotificationsRead })
      .execute(ORG_A)
      .catch(() => undefined);
    const request = queryClient
      .invalidateQueries({ queryKey: ["tenant", "notifications", ORG_A] })
      .catch(() => undefined);
    await act(async () => {
      query.reject(new InboxScopeChangedError());
      await query.promise.catch(() => undefined);
    });
    await waitFor(() => {
      expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
        "confirming",
      );
    });
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolving.resolve(meContext([ownerOrg, viewerOrg], ORG_B));
      await resolving.promise;
    });
    await findScope("Org B", "ผู้ชม");
    await act(async () => {
      mutation.reject(new InboxScopeChangedError());
      await operation;
      await request;
    });
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "confirmed",
    );
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    await findScope("Org B", "ผู้ชม");
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("removed old query completion cannot trigger a resolver or displace confirmed B", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const late = Promise.withResolvers<never>();
    const request = queryClient
      .query({
        queryKey: ["tenant", "notifications", ORG_A, "late"],
        queryFn: () => late.promise,
        retry: false,
      })
      .catch(() => undefined);
    queryClient.removeQueries({
      queryKey: ["tenant", "notifications", ORG_A, "late"],
      exact: true,
    });
    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim, "bootstrap");
      publishContextPublication(
        queryClient,
        claim,
        meContext([ownerOrg, viewerOrg], ORG_B),
      );
    });
    await findScope("Org B", "ผู้ชม");
    await act(async () => {
      late.reject(new InboxScopeChangedError());
      await request;
    });
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    await findScope("Org B", "ผู้ชม");
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("unknown open-notification errors recover conservatively without manufacturing repeated-current failure", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    openNotificationMock.mockRejectedValue(new InboxScopeChangedError());
    for (const id of ["first", "second"]) {
      await act(async () => {
        await queryClient
          .getMutationCache()
          .build(queryClient, { mutationFn: openNotification })
          .execute(id)
          .catch(() => undefined);
      });
      await waitFor(() => {
        expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
          "confirmed",
        );
      });
    }
    expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
    await findScope("Org A", "เจ้าของ");
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });

  it("unsupported query scope fails closed immediately without automatic resolver loop and explicit retry restores admission", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    await act(async () => {
      await queryClient
        .query({
          queryKey: ["tenant", "unsupported"],
          retry: false,
          queryFn: () => Promise.reject(new InboxScopeChangedError()),
        })
        .catch(() => undefined);
    });
    await screen.findByText("โหลดข้อมูลองค์กรไม่สำเร็จ กรุณาลองใหม่");
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "failed",
    );
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    await findScope("Org A", "เจ้าของ");
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("overlapping refetch old error is discarded by real query cancellation and cannot relabel newer same-object request", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const old = Promise.withResolvers<{ unreadCount: number }>(),
      fresh = Promise.withResolvers<{ unreadCount: number }>();
    fetchUnreadCountMock
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    let first: Promise<void>;
    act(() => {
      first = queryClient.invalidateQueries({
        queryKey: ["tenant", "notifications", ORG_A],
      });
    });
    await waitFor(() => {
      expect(fetchUnreadCountMock).toHaveBeenCalledTimes(2);
    });
    let second: Promise<void>;
    act(() => {
      second = queryClient.invalidateQueries({
        queryKey: ["tenant", "notifications", ORG_A],
      });
    });
    await waitFor(() => {
      expect(fetchUnreadCountMock).toHaveBeenCalledTimes(3);
    });
    await act(async () => {
      fresh.resolve({ unreadCount: 5 });
      await fresh.promise;
    });
    await act(async () => {
      old.reject(new InboxScopeChangedError());
      await old.promise.catch(() => undefined);
      await Promise.all([first, second]);
    });
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "confirmed",
    );
    await findScope("Org A", "เจ้าของ");
    expect(
      screen.getByRole("link", { name: "การแจ้งเตือน" }),
    ).toHaveTextContent("5");
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("concurrent unattributed open mutations dedupe while required scope recovery is pending", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const first = Promise.withResolvers<never>(),
      second = Promise.withResolvers<never>(),
      fresh = Promise.withResolvers<MeContextResponse>();
    openNotificationMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    fetchMeContextMock.mockReturnValueOnce(fresh.promise);
    const one = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: openNotification })
      .execute("first")
      .catch(() => undefined);
    const two = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: openNotification })
      .execute("second")
      .catch(() => undefined);
    await act(async () => {
      first.reject(new InboxScopeChangedError());
      await one;
    });
    await waitFor(() => {
      expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
        "confirming",
      );
    });
    await act(async () => {
      second.reject(new InboxScopeChangedError());
      await two;
    });
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      fresh.resolve(meContext([ownerOrg], ORG_A));
      await fresh.promise;
    });
    await findScope("Org A", "เจ้าของ");
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "confirmed",
    );
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });

  it("scope recovery failure cannot be overwritten by late in-flight PATCH", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const patch = Promise.withResolvers<MeContextResponse>(),
      fresh = Promise.withResolvers<MeContextResponse>();
    updateActiveOrganizationMock.mockReturnValueOnce(patch.promise);
    await userEvent.click(screen.getByRole("button", { name: /Org A/ }));
    await userEvent.click(
      within(screen.getByRole("menu", { name: "สลับองค์กร" })).getByRole(
        "menuitemradio",
        { name: /Org B/ },
      ),
    );
    fetchMeContextMock.mockReturnValueOnce(fresh.promise);
    fetchUnreadCountMock.mockRejectedValueOnce(new InboxScopeChangedError());
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: ["tenant", "notifications", ORG_A],
      });
    });
    await waitFor(() => {
      expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
        "confirming",
      );
    });
    await act(async () => {
      fresh.reject(new Error("Resolver failed"));
      await fresh.promise.catch(() => undefined);
    });
    await screen.findByText("โหลดข้อมูลองค์กรไม่สำเร็จ กรุณาลองใหม่");
    await act(async () => {
      patch.resolve(meContext([ownerOrg, viewerOrg], ORG_B));
      await patch.promise;
    });
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "failed",
    );
    expect(screen.queryByRole("heading", { name: /Org B/ })).toBeNull();
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("retired client rejects late mutation scope errors without reviving its publication", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const { queryClient, router } = renderShell(<WorkspacePage />);
    await findScope("Org A", "เจ้าของ");
    const late = Promise.withResolvers<never>();
    markAllNotificationsReadMock.mockReturnValueOnce(late.promise);
    const operation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: markAllNotificationsRead })
      .execute(ORG_A)
      .catch(() => undefined);
    act(() => {
      retireContextPublication(queryClient);
    });
    await act(async () => {
      late.reject(new InboxScopeChangedError());
      await operation;
    });
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "retired",
    );
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: /Org A/ })).toBeNull();
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it.each(["success", "failure"] as const)(
    "cached account-only notifications are withheld during current required %s, never fall back or keep mutation/link controls",
    async (outcome) => {
      fetchMeContextMock.mockResolvedValue(meContext([], null));
      fetchUnreadCountMock.mockResolvedValue({ unreadCount: 7 });
      fetchNotificationsMock.mockResolvedValue({
        items: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            scope: "account",
            organizationId: null,
            eventType: "PASSWORD_CHANGED",
            occurredAt: "2026-09-25T03:00:00.000Z",
            readAt: null,
            actor: null,
            category: null,
          },
        ],
        nextCursor: null,
        unreadCount: 7,
      });
      const { queryClient, router } = renderShell(
        <p>Current account content</p>,
      );
      await screen.findByLabelText("7 รายการยังไม่อ่าน");
      await userEvent.click(
        screen.getByRole("button", { name: "การแจ้งเตือน" }),
      );
      const panel = screen.getByRole("dialog", { name: "การแจ้งเตือน" });
      await within(panel).findByRole("button", { name: /รหัสผ่าน/ });
      expect(
        within(panel).getByRole("button", {
          name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
        }),
      ).toBeEnabled();
      const required = Promise.withResolvers<MeContextResponse>();
      fetchMeContextMock.mockReturnValueOnce(required.promise);
      act(() => {
        void queryClient
          .query({ ...contextQueryOptions(queryClient), staleTime: 0 })
          .catch(() => undefined);
      });
      await waitFor(() => {
        expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
          "confirming",
        );
      });
      expect(screen.queryByLabelText("7 รายการยังไม่อ่าน")).toBeNull();
      expect(
        within(panel).queryByRole("button", { name: /รหัสผ่าน/ }),
      ).toBeNull();
      expect(
        within(panel).getByRole("button", {
          name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
        }),
      ).toBeDisabled();
      expect(
        within(panel).queryByRole("link", { name: "ดูการแจ้งเตือนทั้งหมด" }),
      ).toBeNull();
      expect(screen.queryByText("ยังไม่มีการแจ้งเตือน")).toBeNull();
      expect(fetchUnreadCountMock).toHaveBeenCalledTimes(1);
      expect(fetchNotificationsMock).toHaveBeenCalledTimes(1);
      expect(markAllNotificationsReadMock).not.toHaveBeenCalled();
      expect(openNotificationMock).not.toHaveBeenCalled();
      if (outcome === "failure") {
        await act(async () => {
          required.reject(new Error("Current resolver unavailable"));
          await required.promise.catch(() => undefined);
        });
        await screen.findByText("โหลดข้อมูลองค์กรไม่สำเร็จ กรุณาลองใหม่");
        expect(screen.queryByLabelText("7 รายการยังไม่อ่าน")).toBeNull();
        expect(
          within(panel).queryByRole("button", { name: /รหัสผ่าน/ }),
        ).toBeNull();
        expect(screen.queryByText("ยังไม่มีการแจ้งเตือน")).toBeNull();
        fetchMeContextMock.mockResolvedValueOnce(meContext([], null));
        await userEvent.click(
          within(panel).getByRole("button", { name: "ลองใหม่" }),
        );
      } else {
        await act(async () => {
          required.resolve(meContext([], null));
          await required.promise;
        });
      }
      await screen.findByLabelText("7 รายการยังไม่อ่าน");
      await within(panel).findByRole("button", { name: /รหัสผ่าน/ });
      expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
        "confirmed",
      );
      expect(
        within(panel).getByRole("button", {
          name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
        }),
      ).toBeEnabled();
      router.dispose();
      await queryClient.cancelQueries();
      queryClient.clear();
    },
  );
  it.each(["same-scope-generation", "retirement"] as const)(
    "late popover open after %s cannot invalidate or navigate under updated hook callbacks",
    async (transition) => {
      const item: NotificationItem = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        scope: "account",
        organizationId: null,
        eventType: "PASSWORD_CHANGED",
        occurredAt: "2026-09-25T03:00:00.000Z",
        readAt: null,
        actor: null,
        category: null,
      };
      fetchMeContextMock.mockResolvedValue(meContext([], null));
      fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
      fetchNotificationsMock.mockResolvedValue({
        items: [item],
        nextCursor: null,
        unreadCount: 1,
      });
      const late = Promise.withResolvers<NotificationItem>();
      openNotificationMock.mockReturnValueOnce(late.promise);
      const { queryClient, router } = renderShell(
        <p>Current account content</p>,
      );
      await screen.findByLabelText("1 รายการยังไม่อ่าน");
      await userEvent.click(
        screen.getByRole("button", { name: "การแจ้งเตือน" }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
      );
      expect(openNotificationMock).toHaveBeenCalledTimes(1);
      if (transition === "retirement") {
        act(() => {
          retireContextPublication(queryClient);
        });
      } else {
        await act(async () => {
          await queryClient.query({
            ...contextQueryOptions(queryClient),
            staleTime: 0,
          });
        });
        await screen.findByText("Current account content");
      }
      const reads = fetchNotificationsMock.mock.calls.length,
        counts = fetchUnreadCountMock.mock.calls.length;
      await act(async () => {
        late.resolve({ ...item, readAt: "2026-09-25T03:01:00.000Z" });
        await late.promise;
      });
      expect(router.state.location.pathname).toBe("/workspace");
      expect(fetchNotificationsMock).toHaveBeenCalledTimes(reads);
      expect(fetchUnreadCountMock).toHaveBeenCalledTimes(counts);
      router.dispose();
      await queryClient.cancelQueries();
      queryClient.clear();
    },
  );
  it("reset and consecutive popover opens keep completion ownership on the latest actual invocation", async () => {
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
      id: first.id,
      eventType: first.eventType,
    };
    fetchMeContextMock.mockResolvedValue(meContext([], null));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
    fetchNotificationsMock.mockResolvedValue({
      items: [first],
      nextCursor: null,
      unreadCount: 1,
    });
    const old = Promise.withResolvers<NotificationItem>(),
      latest = Promise.withResolvers<NotificationItem>();
    openNotificationMock
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const { queryClient, router } = renderShell(<p>Current account content</p>);
    await screen.findByLabelText("1 รายการยังไม่อ่าน");
    await userEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await userEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    await userEvent.click(
      await screen.findByRole("button", {
        name: /มีการเปลี่ยนรหัสผ่าน/,
      }),
    );
    expect(openNotificationMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      old.resolve({ ...first, readAt: "2026-09-25T03:01:00.000Z" });
      await old.promise;
    });
    expect(router.state.location.pathname).toBe("/workspace");
    await act(async () => {
      latest.resolve({ ...second, readAt: "2026-09-25T03:01:00.000Z" });
      await latest.promise;
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/notifications");
    });
    expect(router.state.location.state).toMatchObject({
      notificationId: second.id,
    });
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("open remains pending through deferred invalidation and rejects navigation after a required generation wins during that await", async () => {
    const item: NotificationItem = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope: "account",
      organizationId: null,
      eventType: "PASSWORD_CHANGED",
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: null,
      category: null,
    };
    fetchMeContextMock.mockResolvedValue(meContext([], null));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
    fetchNotificationsMock.mockResolvedValue({
      items: [item],
      nextCursor: null,
      unreadCount: 1,
    });
    const opened = Promise.withResolvers<NotificationItem>();
    openNotificationMock.mockReturnValueOnce(opened.promise);
    const { queryClient, router } = renderShell(<p>Current account content</p>);
    await screen.findByLabelText("1 รายการยังไม่อ่าน");
    await userEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    const row = await screen.findByRole("button", {
      name: /มีการเปลี่ยนรหัสผ่าน/,
    });
    await userEvent.click(row);
    const refreshing = Promise.withResolvers<{
      items: NotificationItem[];
      nextCursor: null;
      unreadCount: number;
    }>();
    fetchNotificationsMock.mockReturnValueOnce(refreshing.promise);
    await act(async () => {
      opened.resolve({ ...item, readAt: "2026-09-25T03:01:00.000Z" });
      await opened.promise;
    });
    await waitFor(() => {
      expect(fetchNotificationsMock).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(row);
    expect(openNotificationMock).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/workspace");
    await act(async () => {
      await queryClient.query({
        ...contextQueryOptions(queryClient),
        staleTime: 0,
      });
    });
    await act(async () => {
      refreshing.resolve({ items: [item], nextCursor: null, unreadCount: 1 });
      await refreshing.promise;
    });
    expect(router.state.location.pathname).toBe("/workspace");
    expect(getContextPublicationSnapshot(queryClient).admission.kind).toBe(
      "confirmed",
    );
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("current command mark-all refreshes its real scoped inbox; an old same-scope completion cannot invalidate a newer generation", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([], null));
    fetchUnreadCountMock.mockResolvedValue({ unreadCount: 1 });
    fetchNotificationsMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 1,
    });
    const { queryClient, router } = renderShell(<p>Current account content</p>);
    await screen.findByLabelText("1 รายการยังไม่อ่าน");
    await userEvent.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    const button = screen.getByRole("button", {
      name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
    });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    markAllNotificationsReadMock.mockResolvedValueOnce({
      markedCount: 1,
    });
    await userEvent.click(button);
    await waitFor(() => {
      expect(fetchNotificationsMock).toHaveBeenCalledTimes(2);
    });
    expect(markAllNotificationsReadMock.mock.calls[0]?.[0]).toBeNull();
    const old = Promise.withResolvers<{
      markedCount: number;
    }>();
    markAllNotificationsReadMock.mockReturnValueOnce(old.promise);
    await userEvent.click(button);
    await waitFor(() => {
      expect(markAllNotificationsReadMock).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await queryClient.query({
        ...contextQueryOptions(queryClient),
        staleTime: 0,
      });
    });
    const reads = fetchNotificationsMock.mock.calls.length,
      counts = fetchUnreadCountMock.mock.calls.length;
    await act(async () => {
      old.resolve({ markedCount: 1 });
      await old.promise;
    });
    expect(fetchNotificationsMock).toHaveBeenCalledTimes(reads);
    expect(fetchUnreadCountMock).toHaveBeenCalledTimes(counts);
    expect(router.state.location.pathname).toBe("/workspace");
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
});
