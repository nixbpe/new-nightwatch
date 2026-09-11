import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { WorkspacePage } from "../../pages/WorkspacePage";
import { AppShell } from "./AppShell";

const { sessionState, signOutMock } = vi.hoisted(() => ({
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

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);

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

function renderShell(workspaceElement: ReactNode = <p>เนื้อหาหน้า</p>) {
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
          { path: "/settings/security", element: <p>หน้าความปลอดภัย</p> },
          { path: "/settings/sessions", element: <p>หน้าเซสชัน</p> },
        ],
      },
    ],
    { initialEntries: ["/workspace"] },
  );
  return render(<RouterProvider router={router} />);
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

describe("AppShell", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    signOutMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders org switcher, breadcrumb, nav sections, account block, skip link and routed content", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    renderShell();

    // Sidebar top: the active organization and the user's role in it.
    const orgSwitcher = await screen.findByRole("button", {
      name: /Org A/,
    });
    expect(orgSwitcher).toHaveTextContent("องค์กร · เจ้าของ");

    // Header breadcrumb is rooted at the organization.
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

    // Nav: a labelled section, not an accordion — no expandable control.
    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(within(nav).getByRole("link", { name: "ภาพรวม" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(within(nav).getByText("ตั้งค่า")).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "การตั้งค่าส่วนตัว" }),
    ).toHaveAttribute("href", "/settings");
    // Palette-only sub-destinations never become sidebar rows.
    expect(
      within(nav).queryByRole("link", { name: "เซสชันและอุปกรณ์" }),
    ).toBeNull();
    expect(within(nav).queryByRole("button")).toBeNull();

    // Sidebar bottom: the account block.
    expect(
      screen.getByRole("button", { name: "เมนูบัญชีผู้ใช้" }),
    ).toHaveTextContent("napat@example.com");

    expect(
      screen.getByRole("link", { name: "ข้ามไปที่เนื้อหาหลัก" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByText("เนื้อหาหน้า")).toBeInTheDocument();
    // The header shows the search-all field and notifications only.
    expect(screen.getByText("ค้นหาทั้งหมด...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "การแจ้งเตือน" }),
    ).toBeInTheDocument();
  });

  it("a crashing page is caught without losing the shell chrome", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderShell(<ThrowingPage />);

    // Header breadcrumb (org link) and sidebar nav survive.
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
    // One settings link (its tabs hold profile/security/sessions/display);
    // it is the first enabled item, so focus lands there.
    const settings = within(menu).getByRole("menuitem", {
      name: "การตั้งค่าส่วนตัว",
    });
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute("href", "/settings/profile");
    // Exactly two actionable items: the settings link and sign-out.
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

  it("switching organization from the sidebar publishes the new tenant only after the PATCH succeeds", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_B),
    );
    const user = userEvent.setup();
    renderShell(<WorkspacePage />);
    await screen.findByRole("heading", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: /Org A/ }));
    const menu = screen.getByRole("menu", { name: "สลับองค์กร" });
    expect(
      within(menu).getByRole("menuitemradio", { name: /Org A/ }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(
      within(menu).getByRole("menuitemradio", { name: /Org B/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "Org B" }),
    ).toBeInTheDocument();
    expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
      organizationId: ORG_B,
    });
    // The switcher and breadcrumb follow the published tenant.
    expect(screen.getByRole("button", { name: /Org B/ })).toHaveTextContent(
      "องค์กร · ผู้ชม",
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
    await screen.findByRole("heading", { name: "Org A" });

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
    expect(screen.getByRole("heading", { name: "Org A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Org A/ })).toBeInTheDocument();
  });

  it("⌘K opens search-all; a filtered page result navigates and the palette closes", async () => {
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
    // 2 sidebar destinations + the 4 settings tabs (palette-only entries).
    expect(within(dialog).getAllByRole("option")).toHaveLength(6);
    expect(dialog).toHaveTextContent("ค้นหาใน Org A");

    await user.keyboard("เซสชัน");
    const options = within(dialog).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("เซสชันและอุปกรณ์");
    // Grouped under the leaf it belongs to.
    expect(options[0]).toHaveTextContent("การตั้งค่าส่วนตัว");

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

  it("the notifications button opens an honest empty state, not sample items", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderShell();
    await screen.findByRole("link", { name: "Org A" });

    await user.click(screen.getByRole("button", { name: "การแจ้งเตือน" }));
    const panel = screen.getByRole("dialog", { name: "การแจ้งเตือน" });
    expect(panel).toHaveTextContent("ยังไม่มีการแจ้งเตือน");
    expect(
      within(panel).getByRole("button", {
        name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
      }),
    ).toBeDisabled();
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
