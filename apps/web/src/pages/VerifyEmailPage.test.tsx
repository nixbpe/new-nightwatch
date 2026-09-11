import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { fetchInvitation } from "../lib/api/invitations";
import { readInvitation, rememberInvitation } from "../lib/auth/continuation";
import { VerifyEmailPage } from "./VerifyEmailPage";

const { sessionState, sendVerificationEmailMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: Record<string, unknown> } | null,
    isPending: false,
    refetch: vi.fn(),
  },
  sendVerificationEmailMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    sendVerificationEmail: sendVerificationEmailMock,
    signOut: vi.fn(),
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../lib/api/invitations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchInvitation: vi.fn() };
});

const fetchInvitationMock = vi.mocked(fetchInvitation);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/verify-email"]}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    sendVerificationEmailMock.mockResolvedValue({
      data: { status: true },
      error: null,
    });
  });

  afterEach(() => {
    sessionState.data = null;
    sessionState.refetch.mockReset();
    sendVerificationEmailMock.mockReset();
    fetchInvitationMock.mockReset();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("anonymous signup resends to the invited email", async () => {
    // No session exists before verification (requireEmailVerification), so
    // the resend hub must serve anonymous arrivals from the remembered
    // pending invitation.
    rememberInvitation("inv-123");
    fetchInvitationMock.mockResolvedValue({
      invitation: {
        id: "inv-123",
        email: "new@example.com",
        organizationName: "Acme Corp",
        role: "viewer",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    renderPage();

    const emailInput = await screen.findByLabelText("อีเมลที่ใช้สมัครบัญชี");
    await waitFor(() => {
      expect(emailInput).toHaveValue("new@example.com");
    });
    await userEvent.click(
      screen.getByRole("button", { name: "ส่งอีเมลยืนยันอีกครั้ง" }),
    );

    // Generic confirmation only — no account-existence signal.
    expect(
      await screen.findByText(/ส่งอีเมลยืนยันใหม่แล้ว/),
    ).toBeInTheDocument();
  });

  it("signed-in unverified user resends to session email", async () => {
    sessionState.data = {
      user: {
        id: "u-1",
        email: "member@example.com",
        emailVerified: false,
      },
    };
    renderPage();

    expect(
      await screen.findByText(/เราส่งลิงก์ยืนยันไปที่ member@example\.com/),
    ).toBeInTheDocument();
    // No email form for a signed-in user: the session email is authoritative.
    expect(screen.queryByLabelText("อีเมลที่ใช้สมัครบัญชี")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "ส่งอีเมลยืนยันอีกครั้ง" }),
    );

    expect(
      await screen.findByText(/ส่งอีเมลยืนยันใหม่แล้ว/),
    ).toBeInTheDocument();
  });

  it("resend keeps a pending invitation intact", async () => {
    sessionState.data = {
      user: {
        id: "u-1",
        email: "member@example.com",
        emailVerified: false,
      },
    };
    rememberInvitation("inv-123");
    renderPage();

    await screen.findByText(/เราส่งลิงก์ยืนยันไปที่ member@example\.com/);
    await userEvent.click(
      screen.getByRole("button", { name: "ส่งอีเมลยืนยันอีกครั้ง" }),
    );

    // Generic confirmation; the pending invitation stays in storage for the
    // post-verification continuation.
    expect(
      await screen.findByText(/ส่งอีเมลยืนยันใหม่แล้ว/),
    ).toBeInTheDocument();
    expect(readInvitation()).toBe("inv-123");
  });

  it.each([
    ["anonymous", false],
    ["signed-in", true],
  ] as const)(
    "%s resend cooldown expires automatically and cleans up its timer",
    async (_mode, signedIn) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
      const submit = async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "ส่งอีเมลยืนยันอีกครั้ง" }),
        );
        await act(async () => {
          await Promise.resolve();
        });
      };

      if (signedIn) {
        sessionState.data = {
          user: {
            id: "u-1",
            email: "member@example.com",
            emailVerified: false,
          },
        };
      }

      const page = renderPage();
      if (!signedIn) {
        fireEvent.change(screen.getByLabelText("อีเมลที่ใช้สมัครบัญชี"), {
          target: { value: "member@example.com" },
        });
      }

      await submit();

      expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
      const coolingDownButton = screen.getByRole("button", {
        name: "ส่งแล้ว กรุณารอสักครู่",
      });
      expect(coolingDownButton).toBeDisabled();

      const firstCooldownCallIndex = setTimeoutSpy.mock.calls.findIndex(
        ([, delay]) => delay === 60_000,
      );
      expect(firstCooldownCallIndex).toBeGreaterThanOrEqual(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_999);
      });
      expect(
        screen.getByRole("button", { name: "ส่งแล้ว กรุณารอสักครู่" }),
      ).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const readyButton = screen.getByRole("button", {
        name: "ส่งอีเมลยืนยันอีกครั้ง",
      });
      expect(readyButton).toBeEnabled();

      await submit();
      expect(sendVerificationEmailMock).toHaveBeenCalledTimes(2);
      const latestCooldownCallIndex = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .lastIndexOf(60_000);
      expect(latestCooldownCallIndex).toBeGreaterThan(firstCooldownCallIndex);
      const clearCallsBeforeUnmount = clearTimeoutSpy.mock.calls.length;
      page.unmount();
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(
        clearCallsBeforeUnmount,
      );
      vi.advanceTimersByTime(60_000);
    },
  );

  it("shows an error and stays retryable when resend fails", async () => {
    sendVerificationEmailMock.mockResolvedValue({
      data: null,
      error: { message: "ส่งอีเมลยืนยันไม่สำเร็จ" },
    });
    sessionState.data = {
      user: {
        id: "u-1",
        email: "member@example.com",
        emailVerified: false,
      },
    };
    renderPage();

    await screen.findByText(/เราส่งลิงก์ยืนยันไปที่ member@example\.com/);
    await userEvent.click(
      screen.getByRole("button", { name: "ส่งอีเมลยืนยันอีกครั้ง" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ส่งอีเมลยืนยันไม่สำเร็จ",
    );
    // Retry-safe: the resend affordance is still there, no redirect away.
    expect(
      screen.getByRole("button", { name: "ส่งอีเมลยืนยันอีกครั้ง" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("no email prefill when the preview fails", async () => {
    rememberInvitation("inv-gone");
    fetchInvitationMock.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    renderPage();

    const emailInput = await screen.findByLabelText("อีเมลที่ใช้สมัครบัญชี");
    await waitFor(() => {
      expect(fetchInvitationMock).toHaveBeenCalledWith("inv-gone");
    });
    expect(emailInput).toHaveValue("");
  });

  it("moves a verified session on to onboarding", async () => {
    sessionState.data = {
      user: {
        id: "u-1",
        email: "member@example.com",
        emailVerified: true,
      },
    };
    renderPage();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/onboarding",
    );
  });
});
