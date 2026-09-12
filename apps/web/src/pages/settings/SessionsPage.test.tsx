import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateTime, PREFERENCES_KEY } from "../../lib/preferences";
import type { SessionRow } from "../../lib/sessions/sessions";
import { SessionsPage } from "./SessionsPage";

const { authMock, sessionState } = vi.hoisted(() => ({
  authMock: {
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
  },
  sessionState: {
    data: null as {
      session: { token: string };
      user: { id: string; email: string };
    } | null,
    isPending: true,
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    ...authMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

const NOW = Date.now();
const STORED_PREFERENCES = {
  language: "th",
  timeZone: "Asia/Tokyo",
  hourCycle: "h12",
  weekStart: "sunday",
} as const;

function session(
  overrides: Partial<SessionRow> & { token: string; id: string },
): SessionRow {
  return {
    createdAt: new Date(NOW - 86_400_000),
    updatedAt: new Date(NOW - 7_200_000),
    expiresAt: new Date(NOW + 86_400_000),
    ipAddress: "171.99.12.48",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    ...overrides,
  };
}

const CURRENT = session({ id: "s-current", token: "tok-current" });
const PHONE = session({
  id: "s-phone",
  token: "tok-phone-secret",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipAddress: "49.228.101.7",
  updatedAt: new Date(NOW - 3 * 86_400_000),
});
const UNKNOWN = session({
  id: "s-unknown",
  token: "tok-unknown-secret",
  userAgent: null,
  // better-auth records "" (not null) for a localhost client.
  ipAddress: "",
  updatedAt: new Date(NOW - 60 * 60_000),
});

function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected an item at index ${String(index)}`);
  }
  return item;
}

function expectVisibleAbsoluteTime(item: HTMLElement, row: SessionRow): void {
  const value = formatDateTime(row.updatedAt, STORED_PREFERENCES);
  const time = item.querySelector(
    `time[datetime="${row.updatedAt.toISOString()}"]`,
  );

  expect(time).not.toBeNull();
  if (time === null) {
    throw new Error("expected a timestamp");
  }

  expect(time).toBeVisible();
  expect(time.textContent).toBe(value);
  expect(time).not.toHaveClass("sr-only");
  expect(time).not.toHaveAttribute("aria-hidden", "true");
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionsPage />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("SessionsPage", () => {
  beforeEach(() => {
    authMock.listSessions.mockReset();
    authMock.revokeSession.mockReset();
    authMock.revokeOtherSessions.mockReset();
    sessionState.data = {
      session: { token: "tok-current" },
      user: { id: "user-1", email: "me@example.com" },
    };
    sessionState.isPending = false;
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(STORED_PREFERENCES));
  });

  afterEach(() => {
    localStorage.removeItem(PREFERENCES_KEY);
  });

  it("lists current and other sessions with visible, accessible absolute timestamps", async () => {
    authMock.listSessions.mockResolvedValue({
      data: [PHONE, UNKNOWN, CURRENT],
      error: null,
    });
    const { container } = renderPage();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Chrome 129 · macOS");
    expect(items[0]).toHaveTextContent("อุปกรณ์นี้");
    expect(items[0]).toHaveTextContent("171.99.12.48");
    expectVisibleAbsoluteTime(nth(items, 0), CURRENT);
    expect(within(nth(items, 0)).queryByRole("button")).toBeNull();
    // Most recently active other session next (1 h ago before 3 days ago).
    expect(items[1]).toHaveTextContent("อุปกรณ์ที่ไม่รู้จัก");
    expect(items[1]).toHaveTextContent("ไม่ทราบ IP");
    expect(items[2]).toHaveTextContent("Safari 18 · iOS");
    expectVisibleAbsoluteTime(nth(items, 2), PHONE);
    expect(container.textContent).not.toContain("tok-");
    expect(
      screen.getByRole("button", { name: "ออกจากระบบทุกอุปกรณ์อื่น" }),
    ).toBeInTheDocument();
  });

  it("shows rows without current-device claims or revoke controls while the session is pending", async () => {
    sessionState.data = null;
    sessionState.isPending = true;
    authMock.listSessions.mockResolvedValue({
      data: [PHONE, CURRENT],
      error: null,
    });
    const { queryClient, rerender } = renderPage();

    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("อุปกรณ์นี้")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    sessionState.data = {
      session: { token: "tok-current" },
      user: { id: "user-1", email: "me@example.com" },
    };
    sessionState.isPending = false;
    rerender(
      <QueryClientProvider client={queryClient}>
        <SessionsPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText("อุปกรณ์นี้")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ออกจากระบบทุกอุปกรณ์อื่น" }),
    ).toBeInTheDocument();
  });

  it("shows rows without current-device claims or revoke controls when no listed session matches", async () => {
    sessionState.data = {
      session: { token: "tok-not-listed" },
      user: { id: "user-1", email: "me@example.com" },
    };
    authMock.listSessions.mockResolvedValue({
      data: [PHONE, CURRENT],
      error: null,
    });
    renderPage();

    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("อุปกรณ์นี้")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows no destructive controls when more than one row matches the current token", async () => {
    authMock.listSessions.mockResolvedValue({
      data: [
        CURRENT,
        session({ id: "s-duplicate-current", token: "tok-current" }),
      ],
      error: null,
    });
    renderPage();

    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("อุปกรณ์นี้")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("revoking one session asks for confirmation, calls the API with that token, and refetches", async () => {
    authMock.listSessions
      .mockResolvedValueOnce({ data: [CURRENT, PHONE], error: null })
      .mockResolvedValueOnce({ data: [CURRENT], error: null });
    authMock.revokeSession.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    const user = userEvent.setup();
    renderPage();

    const phoneRow = nth(await screen.findAllByRole("listitem"), 1);
    await user.click(
      within(phoneRow).getByRole("button", { name: /ออกจากระบบ/ }),
    );
    const confirm = within(phoneRow).getByRole("button", {
      name: "ยืนยันออกจากระบบ",
    });
    expect(confirm).toHaveFocus();
    await user.click(confirm);

    expect(authMock.revokeSession).toHaveBeenCalledWith({
      token: "tok-phone-secret",
    });
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ไม่มีอุปกรณ์อื่นเข้าสู่ระบบอยู่",
    );
    expect(authMock.listSessions).toHaveBeenCalledTimes(2);
  });

  it("cancelling a confirm returns focus to the row's button", async () => {
    authMock.listSessions.mockResolvedValue({
      data: [CURRENT, PHONE],
      error: null,
    });
    const user = userEvent.setup();
    renderPage();

    const phoneRow = nth(await screen.findAllByRole("listitem"), 1);
    await user.click(
      within(phoneRow).getByRole("button", { name: /ออกจากระบบ/ }),
    );
    await user.click(within(phoneRow).getByRole("button", { name: "ยกเลิก" }));

    expect(
      within(phoneRow).getByRole("button", { name: /ออกจากระบบ/ }),
    ).toHaveFocus();
    expect(authMock.revokeSession).not.toHaveBeenCalled();
  });

  it("revoking all others calls the API and leaves only this device", async () => {
    authMock.listSessions
      .mockResolvedValueOnce({ data: [CURRENT, PHONE, UNKNOWN], error: null })
      .mockResolvedValueOnce({ data: [CURRENT], error: null });
    authMock.revokeOtherSessions.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "ออกจากระบบทุกอุปกรณ์อื่น" }),
    );
    await user.click(
      screen.getByRole("button", { name: "ยืนยันออกจากระบบ 2 อุปกรณ์" }),
    );

    expect(authMock.revokeOtherSessions).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(
      screen.queryByRole("button", { name: "ออกจากระบบทุกอุปกรณ์อื่น" }),
    ).toBeNull();
  });

  it("a failed revoke keeps the row and shows the message", async () => {
    authMock.listSessions.mockResolvedValue({
      data: [CURRENT, PHONE],
      error: null,
    });
    authMock.revokeSession.mockResolvedValue({
      data: null,
      error: { message: "Session not found" },
    });
    const user = userEvent.setup();
    renderPage();

    const phoneRow = nth(await screen.findAllByRole("listitem"), 1);
    await user.click(
      within(phoneRow).getByRole("button", { name: /ออกจากระบบ/ }),
    );
    await user.click(
      within(phoneRow).getByRole("button", { name: "ยืนยันออกจากระบบ" }),
    );

    expect(await within(phoneRow).findByRole("alert")).toHaveTextContent(
      "Session not found",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(authMock.listSessions).toHaveBeenCalledTimes(1);
  });

  it("a failed load offers a retry", async () => {
    authMock.listSessions
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: [CURRENT], error: null });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
  });
});
