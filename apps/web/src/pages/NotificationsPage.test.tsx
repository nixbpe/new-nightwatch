import type { NotificationItem } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNotifications,
  markAllNotificationsRead,
  openNotification,
} from "../lib/api/notifications";
import { ApiError } from "../lib/api/client";
import { NotificationsPage } from "./NotificationsPage";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
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

let userId = "user-a";
let serverActiveOrgId: string | null = ORG_A;

vi.mock("../lib/tenant/TenantProvider", () => ({
  useTenant: () => ({
    me: { user: { id: userId } },
    serverActiveOrgId,
  }),
}));
vi.mock("../lib/api/notifications", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchNotifications: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    openNotification: vi.fn(),
  };
});

const fetchNotificationsMock = vi.mocked(fetchNotifications);
const markAllNotificationsReadMock = vi.mocked(markAllNotificationsRead);
const openNotificationMock = vi.mocked(openNotification);

function page(queryClient: QueryClient) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <NotificationsPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { ...render(page(queryClient)), queryClient };
}

afterEach(() => {
  userId = "user-a";
  serverActiveOrgId = ORG_A;
  fetchNotificationsMock.mockReset();
  markAllNotificationsReadMock.mockReset();
  openNotificationMock.mockReset();
});

describe("NotificationsPage", () => {
  it("opens a notification, persists the read mutation, and shows the read detail", async () => {
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: [notification],
      nextCursor: null,
      unreadCount: 1,
    });
    openNotificationMock.mockResolvedValue({
      ...notification,
      readAt: "2026-09-25T03:01:00.000Z",
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );

    expect(await screen.findByText("อ่านแล้ว")).toBeInTheDocument();
  });

  it("clears an open detail when the server-confirmed organization changes", async () => {
    fetchNotificationsMock.mockImplementation((organizationId) =>
      Promise.resolve({
        organizationId,
        items: organizationId === ORG_A ? [notification] : [],
        nextCursor: null,
        unreadCount: organizationId === ORG_A ? 1 : 0,
      }),
    );
    openNotificationMock.mockResolvedValue({
      ...notification,
      readAt: "2026-09-25T03:01:00.000Z",
    });
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );
    expect(await screen.findByText("อ่านแล้ว")).toBeInTheDocument();

    serverActiveOrgId = ORG_B;
    view.rerender(page(view.queryClient));

    expect(screen.queryByText("อ่านแล้ว")).not.toBeInTheDocument();
  });

  it("ignores an old organization open completion after the organization changes", async () => {
    let resolveOpen!: (item: NotificationItem) => void;
    const opened = new Promise<NotificationItem>((resolve) => {
      resolveOpen = resolve;
    });
    fetchNotificationsMock.mockImplementation((organizationId) =>
      Promise.resolve({
        organizationId,
        items: organizationId === ORG_A ? [notification] : [],
        nextCursor: null,
        unreadCount: organizationId === ORG_A ? 1 : 0,
      }),
    );
    openNotificationMock.mockReturnValue(opened);
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(
      await screen.findByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    );
    serverActiveOrgId = ORG_B;
    view.rerender(page(view.queryClient));
    resolveOpen({ ...notification, readAt: "2026-09-25T03:01:00.000Z" });

    await waitFor(() => {
      expect(screen.queryByText("อ่านแล้ว")).not.toBeInTheDocument();
    });
  });

  it("rechecks a history detail through POST /open and never renders an expired item", async () => {
    serverActiveOrgId = null;
    fetchNotificationsMock.mockResolvedValue({
      organizationId: null,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    openNotificationMock.mockRejectedValue(
      new ApiError("NOTIFICATION_NOT_FOUND", "expired", 404),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/notifications",
            state: {
              notificationId: notification.id,
              notificationOrganizationId: null,
              notificationScope: "account",
            },
          },
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <NotificationsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("ไม่พบการแจ้งเตือนนี้")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่อ่าน")).not.toBeInTheDocument();
  });

  it("loads a next page and keeps mark-all enabled for server-global unread items", async () => {
    const pageTwoUnread: NotificationItem = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      scope: "organization",
      organizationId: ORG_A,
      eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED",
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: { displayName: "Unread page two" },
      category: "notification-settings",
    };
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...notification,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      readAt: "2026-09-25T03:01:00.000Z",
    }));
    fetchNotificationsMock.mockImplementation((organizationId, cursor) => {
      if (cursor === "cursor-1") {
        return Promise.resolve({
          organizationId,
          items: [pageTwoUnread],
          nextCursor: null,
          unreadCount: 1,
        });
      }
      return Promise.resolve({
        organizationId,
        items: firstPage,
        nextCursor: "cursor-1",
        unreadCount: 1,
      });
    });
    markAllNotificationsReadMock.mockResolvedValue({ markedCount: 1 });
    openNotificationMock.mockResolvedValue({
      ...pageTwoUnread,
      readAt: "2026-09-25T03:02:00.000Z",
    });
    const user = userEvent.setup();
    renderPage();

    const markAll = await screen.findByRole("button", {
      name: "ทำเครื่องหมายว่าอ่านทั้งหมด",
    });
    expect(markAll).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Unread page two/ }),
    );

    expect(await screen.findByText("อ่านแล้ว")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "กลับไปที่การแจ้งเตือน" }),
    );
    await user.click(markAll);
  });

  it("drops retained pages when a refetched first page changes", async () => {
    const pageTwo: NotificationItem = {
      ...notification,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      scope: "organization",
      organizationId: ORG_A,
      eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED",
      actor: { displayName: "Stale page two" },
      category: "notification-settings",
    };
    let firstPageVersion = 1;
    fetchNotificationsMock.mockImplementation((organizationId, cursor) =>
      Promise.resolve(
        cursor === "cursor-1"
          ? {
              organizationId,
              items: [pageTwo],
              nextCursor: null,
              unreadCount: 0,
            }
          : {
              organizationId,
              items: [
                {
                  ...notification,
                  readAt:
                    firstPageVersion === 1 ? null : notification.occurredAt,
                },
              ],
              nextCursor: "cursor-1",
              unreadCount: 0,
            },
      ),
    );
    const user = userEvent.setup();
    const { queryClient } = renderPage();

    await user.click(
      await screen.findByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" }),
    );
    expect(
      await screen.findByRole("button", { name: /Stale page two/ }),
    ).toBeInTheDocument();

    firstPageVersion = 2;
    await act(() => queryClient.refetchQueries({ type: "active" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Stale page two/ }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" }),
    ).toBeInTheDocument();
  });

  it("shows a next-page failure, keeps loaded rows and retries", async () => {
    const pageTwo: NotificationItem = {
      ...notification,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      scope: "organization",
      organizationId: ORG_A,
      eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED",
      actor: { displayName: "Retried page two" },
      category: "notification-settings",
    };
    let pageTwoAttempts = 0;
    fetchNotificationsMock.mockImplementation((organizationId, cursor) => {
      if (cursor === "cursor-1") {
        pageTwoAttempts += 1;
        return pageTwoAttempts === 1
          ? Promise.reject(new Error("network down"))
          : Promise.resolve({
              organizationId,
              items: [pageTwo],
              nextCursor: null,
              unreadCount: 0,
            });
      }
      return Promise.resolve({
        organizationId,
        items: [notification],
        nextCursor: "cursor-1",
        unreadCount: 0,
      });
    });
    const user = userEvent.setup();
    renderPage();

    const loadMore = await screen.findByRole("button", {
      name: "โหลดการแจ้งเตือนเพิ่มเติม",
    });
    await user.click(loadMore);

    expect(
      await screen.findByText("โหลดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /มีการเปลี่ยนรหัสผ่าน/ }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" }),
    );
    expect(
      await screen.findByRole("button", { name: /Retried page two/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("โหลดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"),
    ).not.toBeInTheDocument();
  });

  it("refetches a cached next page after mark-all so its unread row becomes read", async () => {
    const pageTwoReadAt = "2026-09-25T03:02:00.000Z";
    let pageTwo: NotificationItem = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      scope: "organization",
      organizationId: ORG_A,
      eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED",
      occurredAt: "2026-09-25T03:00:00.000Z",
      readAt: null,
      actor: { displayName: "Unread page two" },
      category: "notification-settings",
    };
    let unreadCount = 1;
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...notification,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      readAt: "2026-09-25T03:01:00.000Z",
    }));
    fetchNotificationsMock.mockImplementation((organizationId, cursor) =>
      Promise.resolve({
        organizationId,
        items: cursor === "cursor-1" ? [pageTwo] : firstPage,
        nextCursor: cursor === "cursor-1" ? null : "cursor-1",
        unreadCount,
      }),
    );
    markAllNotificationsReadMock.mockImplementation(() => {
      pageTwo = { ...pageTwo, readAt: pageTwoReadAt };
      unreadCount = 0;
      return Promise.resolve({ markedCount: 1 });
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" }),
    );
    const unreadRow = await screen.findByRole("button", {
      name: /Unread page two/,
    });
    expect(within(unreadRow).getByLabelText("ยังไม่อ่าน")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านทั้งหมด" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านทั้งหมด" }),
      ).toBeDisabled();
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Unread page two/ }),
      ).not.toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "โหลดการแจ้งเตือนเพิ่มเติม" }),
    );
    const readRow = await screen.findByRole("button", {
      name: /Unread page two/,
    });
    expect(
      within(readRow).queryByLabelText("ยังไม่อ่าน"),
    ).not.toBeInTheDocument();
  });

  it("keeps an empty inbox distinct from a failed inbox request", async () => {
    fetchNotificationsMock.mockResolvedValueOnce({
      organizationId: ORG_A,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    renderPage();
    expect(await screen.findByText("ยังไม่มีการแจ้งเตือน")).toBeInTheDocument();

    fetchNotificationsMock.mockReset();
    fetchNotificationsMock.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(
      await screen.findByText("โหลดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"),
    ).toBeInTheDocument();
  });
});
