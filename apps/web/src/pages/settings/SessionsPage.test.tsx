import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateTime, PREFERENCES_KEY } from "../../lib/preferences";
import { UNKNOWN_DEVICE } from "../../lib/sessions/device-label";
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

function expectVisibleAbsoluteTime(item: HTMLElement, row: SessionRow): void {
  const value = formatDateTime(row.updatedAt, STORED_PREFERENCES);
  const time = within(item).getByTestId("session-updated-at");
  expect(time).toHaveAttribute("datetime", row.updatedAt.toISOString());

  expect(time).toBeVisible();
  expect(time.textContent).toBe(value);
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

    const items = await screen.findAllByTestId(/^session-row-/);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual(
      [CURRENT, UNKNOWN, PHONE].map((row) => `session-row-${row.id}`),
    );
    const current = screen.getByTestId(`session-row-${CURRENT.id}`);
    expect(within(current).getByTestId("session-device")).toHaveTextContent(
      "Chrome 129 · macOS",
    );
    expect(within(current).getByTestId("session-current")).toBeVisible();
    expect(within(current).getByTestId("session-ip")).toHaveTextContent(
      "171.99.12.48",
    );
    expectVisibleAbsoluteTime(current, CURRENT);
    expect(within(current).queryByTestId("session-revoke-open")).toBeNull();
    // Most recently active other session next (1 h ago before 3 days ago).
    const unknown = screen.getByTestId(`session-row-${UNKNOWN.id}`);
    expect(within(unknown).getByTestId("session-device")).toHaveTextContent(
      UNKNOWN_DEVICE.label,
    );
    expect(within(unknown).getByTestId("session-ip-unknown")).toBeVisible();
    const phone = screen.getByTestId(`session-row-${PHONE.id}`);
    expect(within(phone).getByTestId("session-device")).toHaveTextContent(
      "Safari 18 · iOS",
    );
    expectVisibleAbsoluteTime(phone, PHONE);
    expect(container.textContent).not.toContain("tok-");
    expect(container.innerHTML).not.toContain("tok-");
    expect(screen.getByTestId("sessions-others-open")).toBeInTheDocument();
  });

  it("shows rows without current-device claims or revoke controls while the session is pending", async () => {
    sessionState.data = null;
    sessionState.isPending = true;
    authMock.listSessions.mockResolvedValue({
      data: [PHONE, CURRENT],
      error: null,
    });
    const { queryClient, rerender } = renderPage();

    expect(await screen.findAllByTestId(/^session-row-/)).toHaveLength(2);
    expect(screen.queryByTestId("session-current")).toBeNull();
    expect(
      screen.queryAllByTestId(
        /^(session-revoke-(open|confirm|cancel)|sessions-others-(open|confirm|cancel))$/,
      ),
    ).toHaveLength(0);

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

    expect(screen.getByTestId("session-current")).toBeInTheDocument();
    expect(screen.getByTestId("sessions-others-open")).toBeInTheDocument();
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

    expect(await screen.findAllByTestId(/^session-row-/)).toHaveLength(2);
    expect(screen.queryByTestId("session-current")).toBeNull();
    expect(
      screen.queryAllByTestId(
        /^(session-revoke-(open|confirm|cancel)|sessions-others-(open|confirm|cancel))$/,
      ),
    ).toHaveLength(0);
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

    expect(await screen.findAllByTestId(/^session-row-/)).toHaveLength(2);
    expect(screen.queryByTestId("session-current")).toBeNull();
    expect(
      screen.queryAllByTestId(
        /^(session-revoke-(open|confirm|cancel)|sessions-others-(open|confirm|cancel))$/,
      ),
    ).toHaveLength(0);
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

    const phoneRow = await screen.findByTestId(`session-row-${PHONE.id}`);
    await user.click(within(phoneRow).getByTestId("session-revoke-open"));
    const confirm = within(phoneRow).getByTestId("session-revoke-confirm");
    expect(confirm).toHaveFocus();
    expect(confirm).toBeEnabled();
    expect(authMock.revokeSession).not.toHaveBeenCalled();
    await user.click(confirm);

    expect(authMock.revokeSession).toHaveBeenCalledWith({
      token: "tok-phone-secret",
    });
    await waitFor(() => {
      expect(screen.getAllByTestId(/^session-row-/)).toHaveLength(1);
    });
    expect(screen.getByTestId("sessions-no-others")).toBeInTheDocument();
    expect(authMock.listSessions).toHaveBeenCalledTimes(2);
  });

  it("cancelling a confirm returns focus to the row's button", async () => {
    authMock.listSessions.mockResolvedValue({
      data: [CURRENT, PHONE],
      error: null,
    });
    const user = userEvent.setup();
    renderPage();

    const phoneRow = await screen.findByTestId(`session-row-${PHONE.id}`);
    await user.click(within(phoneRow).getByTestId("session-revoke-open"));
    await user.click(within(phoneRow).getByTestId("session-revoke-cancel"));

    expect(within(phoneRow).getByTestId("session-revoke-open")).toHaveFocus();
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

    await user.click(await screen.findByTestId("sessions-others-open"));
    await user.click(screen.getByTestId("sessions-others-confirm"));

    expect(authMock.revokeOtherSessions).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getAllByTestId(/^session-row-/)).toHaveLength(1);
    });
    expect(screen.queryByTestId("sessions-others-open")).toBeNull();
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

    const phoneRow = await screen.findByTestId(`session-row-${PHONE.id}`);
    await user.click(within(phoneRow).getByTestId("session-revoke-open"));
    await user.click(within(phoneRow).getByTestId("session-revoke-confirm"));

    expect(
      await within(phoneRow).findByTestId("session-revoke-error"),
    ).toBeVisible();
    expect(
      within(phoneRow).getByTestId("session-revoke-error"),
    ).toHaveAttribute("role", "alert");
    expect(
      within(phoneRow).getByTestId("session-revoke-confirm"),
    ).toBeEnabled();
    expect(authMock.revokeSession).toHaveBeenCalledWith({
      token: "tok-phone-secret",
    });
    expect(screen.getAllByTestId(/^session-row-/)).toHaveLength(2);
    expect(authMock.listSessions).toHaveBeenCalledTimes(1);
  });

  it("a failed load offers a retry", async () => {
    authMock.listSessions
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: [CURRENT], error: null });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId("sessions-load-error")).toBeVisible();
    expect(screen.getByTestId("sessions-load-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await user.click(screen.getByTestId("sessions-load-retry"));
    expect(await screen.findAllByTestId(/^session-row-/)).toHaveLength(1);
  });
});
