import type { NotificationItem } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNotifications,
  markAllNotificationsRead,
  openNotification,
} from "../lib/api/notifications";
import { ApiError } from "../lib/api/client";
import { NotificationRows, NotificationsPage } from "./NotificationsPage";

const P = "55555555-5555-4555-8555-555555555555";
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

const MONITOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const monitorBase = {
  scope: "organization" as const,
  organizationId: ORG_A,
  occurredAt: "2026-09-25T03:00:00.000Z",
  readAt: null,
  actor: null,
  category: "monitor" as const,
  subject: {
    projectId: P,
    monitorId: MONITOR_ID,
    monitorName: "Checkout",
    monitorHostname: null,
  },
};
const monitorNotifications: NotificationItem[] = [
  {
    ...monitorBase,
    id: "10000000-0000-4000-8000-000000000001",
    eventType: "MONITOR_DOWN",
    reason: "timeout",
    sslNotAfter: null,
  },
  {
    ...monitorBase,
    id: "10000000-0000-4000-8000-000000000002",
    eventType: "MONITOR_RECOVERED",
    reason: null,
    sslNotAfter: null,
  },
  {
    ...monitorBase,
    id: "10000000-0000-4000-8000-000000000003",
    eventType: "MONITOR_SSL_CAUTION",
    reason: null,
    sslNotAfter: "2026-10-20T00:00:00.000Z",
  },
  {
    ...monitorBase,
    id: "10000000-0000-4000-8000-000000000004",
    eventType: "MONITOR_SSL_DANGER",
    reason: null,
    sslNotAfter: "2026-10-01T00:00:00.000Z",
  },
  {
    ...monitorBase,
    id: "10000000-0000-4000-8000-000000000005",
    eventType: "MONITOR_SSL_EXPIRED",
    reason: null,
    sslNotAfter: "2026-09-25T00:00:00.000Z",
  },
];

const auditBase = {
  scope: "organization" as const,
  organizationId: ORG_A,
  occurredAt: "2026-09-25T03:00:00.000Z",
  readAt: null,
  actor: null,
  category: "audit-log" as const,
};
const auditNotifications: NotificationItem[] = [
  {
    ...auditBase,
    id: "20000000-0000-4000-8000-000000000001",
    eventType: "AUDIT_EXPORT_READY",
  },
  {
    ...auditBase,
    id: "20000000-0000-4000-8000-000000000002",
    eventType: "AUDIT_EXPORT_FAILED",
  },
];

let userId = "user-a";
let serverActiveOrgId: string | null = ORG_A;

vi.mock("../lib/tenant/TenantProvider", () => ({
  useTenant: () => ({
    me: { user: { id: userId }, organizations: [{ id: ORG_A, name: "Acme" }] },
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

function LocationProbe() {
  return (
    <output data-testid="notification-filter-url">
      {useLocation().search}
    </output>
  );
}

function page(queryClient: QueryClient) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <NotificationsPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function renderPage(retry = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry } },
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
  const counts = {
    total: 8,
    unread: 3,
    recent: 5,
    window: {
      days: 7 as const,
      since: "2026-09-18T00:00:00.000Z",
      until: "2026-09-25T00:00:00.000Z",
    },
  };
  it("switches status and category through search params, supports tab keyboard focus and distinguishes no matches", async () => {
    fetchNotificationsMock.mockImplementation((organizationId, filters) =>
      Promise.resolve({
        organizationId,
        items: filters?.category ? [] : [notification],
        nextCursor: null,
        unreadCount: 6,
        counts,
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const unread = await screen.findByTestId(
      "notifications-filter-status-unread",
    );
    expect(unread).toHaveTextContent("3");
    screen.getByTestId("notifications-filter-status-all").focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(
        screen.getByTestId("notifications-filter-status-unread"),
      ).toHaveFocus(),
    );
    expect(fetchNotificationsMock).toHaveBeenLastCalledWith(ORG_A, {
      status: "unread",
      category: null,
    });
    await user.keyboard("{Home}");
    await waitFor(() =>
      expect(
        screen.getByTestId("notifications-filter-status-all"),
      ).toHaveFocus(),
    );
    await user.keyboard("{End}");
    await waitFor(() =>
      expect(
        screen.getByTestId("notifications-filter-status-unread"),
      ).toHaveFocus(),
    );
    await user.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(
        screen.getByTestId("notifications-filter-status-all"),
      ).toHaveFocus(),
    );
    await user.click(
      screen.getByTestId("notifications-filter-category-monitor"),
    );
    expect(
      await screen.findByTestId("notifications-no-match"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("notifications-filter-category-monitor"),
    ).toHaveFocus();
    expect(
      screen.getByTestId("notifications-filter-category-monitor"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("notifications-mark-all")).toBeEnabled();
    expect(screen.getByTestId("notifications-count-recent")).toHaveTextContent(
      "5 รายการใน 7 วัน",
    );
    expect(screen.queryByTestId("notifications-empty")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("notifications-no-match-clear"));
    expect(
      await screen.findByTestId(`notification-row-${notification.id}`),
    ).toBeInTheDocument();
    expect(fetchNotificationsMock).toHaveBeenLastCalledWith(ORG_A, {
      status: "all",
      category: null,
    });
  });

  it.each(["{Enter}", " "])(
    "restores filter activation focus for %s after delayed responses and repeated toggles",
    async (key) => {
      type Page = Awaited<ReturnType<typeof fetchNotifications>>;
      const response = {
        organizationId: ORG_A,
        items: [notification],
        nextCursor: null,
        unreadCount: 6,
        counts,
      };
      fetchNotificationsMock.mockResolvedValue(response);
      const user = userEvent.setup();
      renderPage();
      const chipId = "notifications-filter-category-monitor";
      const chip = await screen.findByTestId(chipId);
      chip.focus();
      const pending = Promise.withResolvers<Page>();
      fetchNotificationsMock.mockImplementationOnce(() => pending.promise);
      await user.keyboard(key);
      expect(screen.getByTestId("notification-filter-url")).toHaveTextContent(
        "?category=monitor",
      );
      expect(fetchNotificationsMock).toHaveBeenLastCalledWith(ORG_A, {
        status: "all",
        category: "monitor",
      });
      expect(screen.queryByTestId(chipId)).not.toBeInTheDocument();
      await act(async () => {
        pending.resolve(response);
        await pending.promise;
      });
      await waitFor(() => expect(screen.getByTestId(chipId)).toHaveFocus());
      await user.keyboard(key);
      await waitFor(() =>
        expect(screen.getByTestId("notification-filter-url")).toHaveTextContent(
          /^$/,
        ),
      );
      expect(screen.getByTestId(chipId)).toHaveFocus();
      expect(screen.getByTestId(chipId)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(fetchNotificationsMock).toHaveBeenLastCalledWith(ORG_A, {
        status: "all",
        category: null,
      });

      const unreadId = "notifications-filter-status-unread";
      screen.getByTestId(unreadId).focus();
      const statusPending = Promise.withResolvers<Page>();
      fetchNotificationsMock.mockImplementationOnce(
        () => statusPending.promise,
      );
      await user.keyboard(key);
      expect(screen.getByTestId("notification-filter-url")).toHaveTextContent(
        "?status=unread",
      );
      expect(fetchNotificationsMock).toHaveBeenLastCalledWith(ORG_A, {
        status: "unread",
        category: null,
      });
      await act(async () => {
        statusPending.resolve(response);
        await statusPending.promise;
      });
      await waitFor(() => expect(screen.getByTestId(unreadId)).toHaveFocus());
      const allId = "notifications-filter-status-all";
      screen.getByTestId(allId).focus();
      await user.keyboard(key);
      await waitFor(() => expect(screen.getByTestId(allId)).toHaveFocus());
      expect(screen.getByTestId("notification-filter-url")).toHaveTextContent(
        /^$/,
      );
      expect(fetchNotificationsMock).toHaveBeenLastCalledWith(ORG_A, {
        status: "all",
        category: null,
      });
    },
  );

  it("returns clear-filter focus to the selected default status tab", async () => {
    fetchNotificationsMock.mockImplementation((organizationId, filters) =>
      Promise.resolve({
        organizationId,
        items: filters?.category ? [] : [notification],
        nextCursor: null,
        unreadCount: 6,
        counts,
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByTestId("notifications-filter-category-security"),
    );
    const clear = await screen.findByTestId("notifications-no-match-clear");
    clear.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.getByTestId("notifications-filter-status-all"),
      ).toHaveFocus(),
    );
    expect(screen.getByTestId("notification-filter-url")).toHaveTextContent(
      /^$/,
    );
  });

  it("renders organization name and event-time hostname while legacy rows retain organization name", () => {
    const item = monitorNotifications[0];
    if (!item) throw new Error("expected a monitor fixture");
    if (item.category !== "monitor")
      throw new Error("expected monitor fixture");
    const legacy = { ...item, id: "legacy" };
    const current = {
      ...item,
      subject: { ...item.subject, monitorHostname: "snapshot.example.com" },
    };
    render(
      <MemoryRouter>
        <NotificationRows items={[current, legacy]} onOpen={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Acme")).toHaveLength(2);
    expect(screen.getAllByTestId("notification-monitor-hostname")).toHaveLength(
      1,
    );
    expect(
      screen.getByTestId("notification-monitor-hostname"),
    ).toHaveTextContent("snapshot.example.com");
  });

  it.each([false, true])(
    "recovers INVALID_CURSOR once and handles failed first-page refetch=%s",
    async (failRefetch) => {
      let firstRequests = 0;
      fetchNotificationsMock.mockImplementation((organizationId, options) => {
        if (options?.cursor)
          throw new ApiError("INVALID_CURSOR", "expired", 400);
        firstRequests += 1;
        if (firstRequests > 1 && failRefetch)
          throw new Error("refetch unavailable");
        return Promise.resolve({
          organizationId,
          items: [
            {
              ...notification,
              id: firstRequests === 1 ? "old-first" : "fresh-first",
            },
          ],
          nextCursor: "expired",
          unreadCount: 3,
          counts,
        });
      });
      const user = userEvent.setup();
      const { queryClient } = renderPage(true);
      await user.click(await screen.findByTestId("notifications-load-more"));
      if (failRefetch) {
        expect(
          await screen.findByTestId("notifications-list-error"),
        ).toBeInTheDocument();
      } else {
        expect(
          await screen.findByTestId("notifications-pages-reset"),
        ).toBeInTheDocument();
        expect(
          await screen.findByTestId("notification-row-fresh-first"),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("notification-row-old-first"),
        ).not.toBeInTheDocument();
        expect(
          queryClient
            .getQueryCache()
            .findAll({ queryKey: ["tenant", "notifications", ORG_A, "pages"] }),
        ).toHaveLength(0);
        await user.click(screen.getByTestId("notifications-load-more"));
        expect(
          await screen.findByTestId("notifications-next-error"),
        ).toBeInTheDocument();
      }
      expect(firstRequests).toBe(2);
      expect(
        fetchNotificationsMock.mock.calls.filter(
          ([, options]) => options?.cursor,
        ),
      ).toHaveLength(failRefetch ? 1 : 2);
    },
  );

  it("shows title, icon, context and a monitor link for each monitor event type", async () => {
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: monitorNotifications,
      nextCursor: null,
      counts: {
        total: 5,
        unread: 5,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 5,
    });
    renderPage();

    expect(await screen.findAllByTestId(/^notification-row-/)).toHaveLength(5);
    for (const item of monitorNotifications) {
      const row = screen.getByTestId(`notification-row-${item.id}`);
      expect(row).toHaveAttribute("data-event-type", item.eventType);
      expect(row).toHaveAttribute("data-category", "monitor");
      expect(within(row).getByTestId("notification-title")).toHaveTextContent(
        "Checkout",
      );
      expect(
        within(row).getByTestId("notification-monitor-link"),
      ).toHaveAttribute(
        "href",
        `/organizations/${ORG_A}/projects/${P}/monitors/${MONITOR_ID}`,
      );
    }
    expect(
      within(
        screen.getByTestId(
          "notification-row-10000000-0000-4000-8000-000000000001",
        ),
      ).getByTestId("notification-reason"),
    ).toHaveAttribute("data-reason", "timeout");
    expect(
      within(
        screen.getByTestId(
          "notification-row-10000000-0000-4000-8000-000000000005",
        ),
      ).getByTestId("notification-ssl-expiry"),
    ).toHaveAttribute("datetime", "2026-09-25T00:00:00.000Z");
  });

  it("shows 10 days remaining in the SSL caution title when sslNotAfter is 10 days after occurredAt", async () => {
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: [
        {
          ...monitorBase,
          id: "10000000-0000-4000-8000-000000000006",
          eventType: "MONITOR_SSL_CAUTION",
          reason: null,
          sslNotAfter: "2026-10-05T03:00:00.000Z",
        },
      ],
      nextCursor: null,
      counts: {
        total: 1,
        unread: 1,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 1,
    });
    renderPage();
    expect(
      await within(
        await screen.findByTestId(
          "notification-row-10000000-0000-4000-8000-000000000006",
        ),
      ).findByTestId("notification-title"),
    ).toHaveTextContent(/\b10\b/);
  });

  it("shows audit export results with their title, category, icon and a link to the export list", async () => {
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: auditNotifications,
      nextCursor: null,
      counts: {
        total: 2,
        unread: 2,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 2,
    });
    renderPage();
    expect(await screen.findAllByTestId(/^notification-row-/)).toHaveLength(2);
    for (const item of auditNotifications) {
      const row = screen.getByTestId(`notification-row-${item.id}`);
      expect(row).toHaveAttribute("data-event-type", item.eventType);
      expect(row).toHaveAttribute("data-scope", "organization");
      expect(row).toHaveAttribute("data-category", "audit-log");
      expect(
        within(row).getByTestId("notification-title"),
      ).not.toBeEmptyDOMElement();
      expect(
        within(row).getByTestId("notification-audit-link"),
      ).toHaveAttribute("href", `/organizations/${ORG_A}/audit-log#my-exports`);
    }
  });

  it("opens an audit export notification with a link to the export list", async () => {
    const ready = auditNotifications[0] as NotificationItem;
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: [ready],
      nextCursor: null,
      counts: {
        total: 1,
        unread: 1,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 1,
    });
    openNotificationMock.mockResolvedValue({
      ...ready,
      readAt: "2026-09-25T03:01:00.000Z",
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByTestId(`notification-open-${ready.id}`),
    );

    expect(
      await screen.findByTestId("notification-detail-read"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("notification-detail-read-at")).toHaveAttribute(
      "datetime",
      "2026-09-25T03:01:00.000Z",
    );
  });

  it("opens a monitor notification with its subject, reason and link", async () => {
    const down = monitorNotifications[0] as NotificationItem;
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: [down],
      nextCursor: null,
      counts: {
        total: 1,
        unread: 1,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 1,
    });
    openNotificationMock.mockResolvedValue({
      ...down,
      readAt: "2026-09-25T03:01:00.000Z",
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`notification-open-${down.id}`));

    expect(
      await screen.findByTestId("notification-detail-read"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("notification-detail-read-at")).toHaveAttribute(
      "datetime",
      "2026-09-25T03:01:00.000Z",
    );
    expect(screen.getByTestId("notification-reason")).toHaveAttribute(
      "data-reason",
      "timeout",
    );
    expect(screen.getByTestId("notification-reason")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("notification-monitor-name")).toHaveTextContent(
      "Checkout",
    );
    expect(screen.getByTestId("notification-monitor-link")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/projects/${P}/monitors/${MONITOR_ID}`,
    );
  });

  it("clears an open detail when the server-confirmed organization changes", async () => {
    fetchNotificationsMock.mockImplementation((organizationId) =>
      Promise.resolve({
        organizationId,
        items: organizationId === ORG_A ? [notification] : [],
        nextCursor: null,
        counts: {
          total: organizationId === ORG_A ? 1 : 0,
          unread: organizationId === ORG_A ? 1 : 0,
          recent: 0,
          window: {
            days: 7,
            since: "2026-09-18T00:00:00.000Z",
            until: "2026-09-25T00:00:00.000Z",
          },
        },
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
      await screen.findByTestId(`notification-open-${notification.id}`),
    );
    expect(
      await screen.findByTestId("notification-detail-read"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("notification-detail-read-at")).toHaveAttribute(
      "datetime",
      "2026-09-25T03:01:00.000Z",
    );

    serverActiveOrgId = ORG_B;
    view.rerender(page(view.queryClient));

    expect(
      screen.queryByTestId("notification-detail-read"),
    ).not.toBeInTheDocument();
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
        counts: {
          total: organizationId === ORG_A ? 1 : 0,
          unread: organizationId === ORG_A ? 1 : 0,
          recent: 0,
          window: {
            days: 7,
            since: "2026-09-18T00:00:00.000Z",
            until: "2026-09-25T00:00:00.000Z",
          },
        },
        unreadCount: organizationId === ORG_A ? 1 : 0,
      }),
    );
    openNotificationMock.mockReturnValue(opened);
    const user = userEvent.setup();
    const view = renderPage();

    await user.click(
      await screen.findByTestId(`notification-open-${notification.id}`),
    );
    serverActiveOrgId = ORG_B;
    view.rerender(page(view.queryClient));
    resolveOpen({ ...notification, readAt: "2026-09-25T03:01:00.000Z" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("notification-detail-read"),
      ).not.toBeInTheDocument();
    });
  });

  it("rechecks a history detail through POST /open and never renders an expired item", async () => {
    serverActiveOrgId = null;
    fetchNotificationsMock.mockResolvedValue({
      organizationId: null,
      items: [],
      nextCursor: null,
      counts: {
        total: 0,
        unread: 0,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
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

    expect(
      await screen.findByTestId("notification-detail-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-detail-unread"),
    ).not.toBeInTheDocument();
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
      if (cursor?.cursor === "cursor-1") {
        return Promise.resolve({
          organizationId,
          items: [pageTwoUnread],
          nextCursor: null,
          counts: {
            total: 1,
            unread: 1,
            recent: 0,
            window: {
              days: 7,
              since: "2026-09-18T00:00:00.000Z",
              until: "2026-09-25T00:00:00.000Z",
            },
          },
          unreadCount: 1,
        });
      }
      return Promise.resolve({
        organizationId,
        items: firstPage,
        nextCursor: "cursor-1",
        counts: {
          total: 1,
          unread: 1,
          recent: 0,
          window: {
            days: 7,
            since: "2026-09-18T00:00:00.000Z",
            until: "2026-09-25T00:00:00.000Z",
          },
        },
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

    const markAll = await screen.findByTestId("notifications-mark-all");
    expect(markAll).toBeEnabled();
    await user.click(screen.getByTestId("notifications-load-more"));
    const next = await screen.findByTestId(
      `notification-open-${pageTwoUnread.id}`,
    );
    expect(next).toHaveTextContent("Unread page two");
    await user.click(next);

    expect(
      await screen.findByTestId("notification-detail-read"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("notification-detail-read-at")).toHaveAttribute(
      "datetime",
      "2026-09-25T03:02:00.000Z",
    );
    await user.click(screen.getByTestId("notifications-back"));
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
        cursor?.cursor === "cursor-1"
          ? {
              organizationId,
              items: [pageTwo],
              nextCursor: null,
              counts: {
                total: 0,
                unread: 0,
                recent: 0,
                window: {
                  days: 7,
                  since: "2026-09-18T00:00:00.000Z",
                  until: "2026-09-25T00:00:00.000Z",
                },
              },
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
              counts: {
                total: 0,
                unread: 0,
                recent: 0,
                window: {
                  days: 7,
                  since: "2026-09-18T00:00:00.000Z",
                  until: "2026-09-25T00:00:00.000Z",
                },
              },
              unreadCount: 0,
            },
      ),
    );
    const user = userEvent.setup();
    const { queryClient } = renderPage();

    await user.click(await screen.findByTestId("notifications-load-more"));
    expect(
      await screen.findByTestId(`notification-open-${pageTwo.id}`),
    ).toHaveTextContent("Stale page two");

    firstPageVersion = 2;
    await act(() => queryClient.refetchQueries({ type: "active" }));

    await waitFor(() => {
      expect(
        screen.queryByTestId(`notification-open-${pageTwo.id}`),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("notifications-load-more")).toBeInTheDocument();
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
      if (cursor?.cursor === "cursor-1") {
        pageTwoAttempts += 1;
        return pageTwoAttempts === 1
          ? Promise.reject(new Error("network down"))
          : Promise.resolve({
              organizationId,
              items: [pageTwo],
              nextCursor: null,
              counts: {
                total: 0,
                unread: 0,
                recent: 0,
                window: {
                  days: 7,
                  since: "2026-09-18T00:00:00.000Z",
                  until: "2026-09-25T00:00:00.000Z",
                },
              },
              unreadCount: 0,
            });
      }
      return Promise.resolve({
        organizationId,
        items: [notification],
        nextCursor: "cursor-1",
        counts: {
          total: 0,
          unread: 0,
          recent: 0,
          window: {
            days: 7,
            since: "2026-09-18T00:00:00.000Z",
            until: "2026-09-25T00:00:00.000Z",
          },
        },
        unreadCount: 0,
      });
    });
    const user = userEvent.setup();
    renderPage();

    const loadMore = await screen.findByTestId("notifications-load-more");
    await user.click(loadMore);

    expect(
      await screen.findByTestId("notifications-next-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`notification-open-${notification.id}`),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("notifications-load-more"));
    expect(
      await screen.findByTestId(`notification-open-${pageTwo.id}`),
    ).toHaveTextContent("Retried page two");
    expect(
      screen.queryByTestId("notifications-next-error"),
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
        items: cursor?.cursor === "cursor-1" ? [pageTwo] : firstPage,
        nextCursor: cursor?.cursor === "cursor-1" ? null : "cursor-1",
        unreadCount,
        counts: {
          total: 21,
          unread: unreadCount,
          recent: 0,
          window: {
            days: 7,
            since: "2026-09-18T00:00:00.000Z",
            until: "2026-09-25T00:00:00.000Z",
          },
        },
      }),
    );
    markAllNotificationsReadMock.mockImplementation(() => {
      pageTwo = { ...pageTwo, readAt: pageTwoReadAt };
      unreadCount = 0;
      return Promise.resolve({ markedCount: 1 });
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("notifications-load-more"));
    const unreadRow = await screen.findByTestId(
      `notification-open-${pageTwo.id}`,
    );
    expect(unreadRow).toHaveTextContent("Unread page two");
    expect(
      within(unreadRow).getByTestId("notification-unread"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("notifications-mark-all"));
    await waitFor(() => {
      expect(screen.getByTestId("notifications-mark-all")).toBeDisabled();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(`notification-open-${pageTwo.id}`),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId("notifications-load-more"));
    const readRow = await screen.findByTestId(
      `notification-open-${pageTwo.id}`,
    );
    expect(readRow).toHaveTextContent("Unread page two");
    expect(
      screen.getByTestId(`notification-row-${pageTwo.id}`),
    ).toHaveAttribute("data-read-at", pageTwoReadAt);
    expect(
      within(readRow).queryByTestId("notification-unread"),
    ).not.toBeInTheDocument();
  });

  it("shows a mark-all failure when the inbox scope changed", async () => {
    fetchNotificationsMock.mockResolvedValue({
      organizationId: ORG_A,
      items: [notification],
      nextCursor: null,
      counts: {
        total: 1,
        unread: 1,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 1,
    });
    markAllNotificationsReadMock.mockRejectedValue(
      new ApiError("INBOX_SCOPE_CHANGED", "scope changed", 409),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("notifications-mark-all"));

    expect(markAllNotificationsReadMock.mock.calls[0]?.[0]).toBe(ORG_A);
    expect(
      await screen.findByTestId("notifications-mark-all-error"),
    ).toBeInTheDocument();
  });

  it("keeps an empty inbox distinct from a failed inbox request", async () => {
    fetchNotificationsMock.mockResolvedValueOnce({
      organizationId: ORG_A,
      items: [],
      nextCursor: null,
      counts: {
        total: 0,
        unread: 0,
        recent: 0,
        window: {
          days: 7,
          since: "2026-09-18T00:00:00.000Z",
          until: "2026-09-25T00:00:00.000Z",
        },
      },
      unreadCount: 0,
    });
    renderPage();
    expect(
      await screen.findByTestId("notifications-empty"),
    ).toBeInTheDocument();

    fetchNotificationsMock.mockReset();
    fetchNotificationsMock.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(
      await screen.findByTestId("notifications-list-error"),
    ).not.toBeEmptyDOMElement();
  });

  describe("day grouping", () => {
    function item(id: string, occurredAt: string): NotificationItem {
      return { ...notification, id, occurredAt };
    }
    function setZone(timeZone: string) {
      window.localStorage.setItem(
        "nightwatch-preferences",
        JSON.stringify({
          language: "th",
          timeZone,
          hourCycle: "h23",
          weekStart: "monday",
        }),
      );
    }
    async function renderItems(items: NotificationItem[], now: string) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      fetchNotificationsMock.mockResolvedValue({
        organizationId: ORG_A,
        items,
        nextCursor: null,
        counts: {
          total: 1,
          unread: 1,
          recent: 0,
          window: {
            days: 7,
            since: "2026-09-18T00:00:00.000Z",
            until: "2026-09-25T00:00:00.000Z",
          },
        },
        unreadCount: 1,
      });
      renderPage();
      await screen.findAllByTestId(/^notification-day-\d/);
    }
    afterEach(() => {
      vi.useRealTimers();
      window.localStorage.clear();
    });

    it("labels today, yesterday and older days in the preferred time zone", async () => {
      setZone("Asia/Bangkok");
      await renderItems(
        [
          item(
            "a0000000-0000-4000-8000-000000000001",
            "2026-10-02T02:00:00.000Z",
          ),
          // 2026-10-01 23:30 Bangkok, just before local midnight
          item(
            "a0000000-0000-4000-8000-000000000002",
            "2026-10-01T16:30:00.000Z",
          ),
          item(
            "a0000000-0000-4000-8000-000000000003",
            "2026-09-25T03:00:00.000Z",
          ),
        ],
        "2026-10-02T05:00:00.000Z",
      );

      expect(
        screen
          .getAllByTestId(/^notification-day-\d/)
          .map((group) => group.getAttribute("data-day-key")),
      ).toEqual(["2026-10-02", "2026-10-01", "2026-09-25"]);
      for (const [day, id] of [
        ["2026-10-02", "a0000000-0000-4000-8000-000000000001"],
        ["2026-10-01", "a0000000-0000-4000-8000-000000000002"],
        ["2026-09-25", "a0000000-0000-4000-8000-000000000003"],
      ] as const) {
        const group = screen.getByTestId(`notification-day-${day}`);
        expect(group).toHaveRole("region");
        expect(
          within(group).getByTestId("notification-day-title"),
        ).not.toBeEmptyDOMElement();
        expect(
          within(group).getByTestId(`notification-open-${id}`),
        ).toBeInTheDocument();
      }
      expect(
        within(screen.getByTestId("notification-day-2026-09-25")).getByTestId(
          "notification-day-title",
        ),
      ).toHaveTextContent(/25.*2569/);
    });

    it("splits items at local midnight, not UTC midnight", async () => {
      setZone("America/Los_Angeles");
      await renderItems(
        [
          // 2026-10-02 00:30 LA, today in LA
          item(
            "a0000000-0000-4000-8000-000000000001",
            "2026-10-02T07:30:00.000Z",
          ),
          // 2026-10-01 23:30 LA, yesterday in LA though Oct 2 in UTC
          item(
            "a0000000-0000-4000-8000-000000000002",
            "2026-10-02T06:30:00.000Z",
          ),
        ],
        "2026-10-02T15:00:00.000Z",
      );

      expect(
        within(screen.getByTestId("notification-day-2026-10-02")).getByTestId(
          "notification-open-a0000000-0000-4000-8000-000000000001",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("notification-day-2026-10-01")).getByTestId(
          "notification-open-a0000000-0000-4000-8000-000000000002",
        ),
      ).toBeInTheDocument();
      expect(screen.getAllByTestId(/^notification-day-\d/)).toHaveLength(2);
    });

    it("labels yesterday by calendar date across a DST change", async () => {
      setZone("America/New_York");
      // DST ended 2026-11-01 (25-hour day); now is 2026-11-02 00:30 EST
      await renderItems(
        [
          item(
            "a0000000-0000-4000-8000-000000000001",
            "2026-11-02T05:10:00.000Z",
          ),
          // 2026-11-01 00:30 EDT, the first hour of the 25-hour day
          item(
            "a0000000-0000-4000-8000-000000000002",
            "2026-11-01T04:30:00.000Z",
          ),
        ],
        "2026-11-02T05:30:00.000Z",
      );

      expect(
        within(screen.getByTestId("notification-day-2026-11-01")).getByTestId(
          "notification-open-a0000000-0000-4000-8000-000000000002",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("notification-day-2026-11-02")).getByTestId(
          "notification-open-a0000000-0000-4000-8000-000000000001",
        ),
      ).toBeInTheDocument();
    });

    it("shows the unread dot image", async () => {
      setZone("Asia/Bangkok");
      await renderItems([notification], "2026-09-25T05:00:00.000Z");

      expect(
        within(
          screen.getByTestId(`notification-row-${notification.id}`),
        ).getByTestId("notification-unread"),
      ).toHaveRole("img");
    });

    it("renders no day headings when groupByDay is off", () => {
      render(
        <MemoryRouter>
          <NotificationRows items={[notification]} onOpen={() => undefined} />
        </MemoryRouter>,
      );
      expect(
        screen.queryByTestId("notification-day-title"),
      ).not.toBeInTheDocument();
    });
  });
});
