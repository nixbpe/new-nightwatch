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

vi.mock("../lib/api/invitations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchInvitation: vi.fn() };
});

const fetchInvitationMock = vi.mocked(fetchInvitation);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(state?: unknown) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: "/verify-email", state }]}>
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

  it("shows a loading status, not a blank page, while the session resolves", () => {
    sessionState.isPending = true;
    renderPage();

    expect(screen.getByTestId("verify-email-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("verify-email-page")).toBeNull();
  });

  it("anonymous signup resends to the invited email", async () => {
    // No session exists before verification, so the hub serves anonymous arrivals from the remembered invitation.
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

    const emailInput = await screen.findByTestId("verify-email-email");
    await waitFor(() => {
      expect(emailInput).toHaveValue("new@example.com");
    });
    await userEvent.click(screen.getByTestId("verify-email-resend"));

    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      email: "new@example.com",
      callbackURL: "/onboarding?invitationId=inv-123",
    });
    expect(await screen.findByTestId("verify-email-sent")).toBeInTheDocument();
  });

  it("a signup hand-off prefills the address and says where the link went", async () => {
    renderPage({ email: "new@example.com", sent: true });

    expect(await screen.findByTestId("verify-email-email")).toHaveValue(
      "new@example.com",
    );
    expect(screen.getByTestId("verify-email-recipient")).toHaveTextContent(
      "new@example.com",
    );
    await userEvent.click(screen.getByTestId("verify-email-resend"));
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      email: "new@example.com",
      callbackURL: "/onboarding",
    });
  });

  it("a sign-in refusal prefills the address but does not claim an email was sent", async () => {
    renderPage({ email: "typed@example.com" });

    expect(await screen.findByTestId("verify-email-email")).toHaveValue(
      "typed@example.com",
    );
    expect(screen.getByTestId("verify-email-recipient")).not.toHaveTextContent(
      "typed@example.com",
    );
  });

  it("ignores hand-off state of the wrong shape", async () => {
    renderPage({ email: 42, sent: "yes" });

    expect(await screen.findByTestId("verify-email-email")).toHaveValue("");
  });

  it("counts the seconds left on the resend button", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
    renderPage();
    fireEvent.change(screen.getByTestId("verify-email-email"), {
      target: { value: "member@example.com" },
    });
    fireEvent.click(screen.getByTestId("verify-email-resend"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("verify-email-resend")).toHaveTextContent("60");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("verify-email-resend")).toHaveTextContent("50");
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
      await screen.findByTestId("verify-email-recipient"),
    ).toHaveTextContent("member@example.com");
    expect(screen.queryByTestId("verify-email-email")).toBeNull();
    await userEvent.click(screen.getByTestId("verify-email-resend"));

    expect(await screen.findByTestId("verify-email-sent")).toBeInTheDocument();
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

    await screen.findByTestId("verify-email-recipient");
    await userEvent.click(screen.getByTestId("verify-email-resend"));

    expect(await screen.findByTestId("verify-email-sent")).toBeInTheDocument();
    expect(readInvitation()).toBe("inv-123");
  });

  it.each([
    ["anonymous", false],
    ["signed-in", true],
  ] as const)(
    "%s resend cooldown expires automatically after 60s, then allows another resend",
    async (_mode, signedIn) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
      const submit = async () => {
        fireEvent.click(screen.getByTestId("verify-email-resend"));
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
        fireEvent.change(screen.getByTestId("verify-email-email"), {
          target: { value: "member@example.com" },
        });
      }

      await submit();

      expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
      const coolingDownButton = screen.getByTestId("verify-email-resend");
      expect(coolingDownButton).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_999);
      });
      expect(screen.getByTestId("verify-email-resend")).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const readyButton = screen.getByTestId("verify-email-resend");
      expect(readyButton).toBeEnabled();

      await submit();
      expect(sendVerificationEmailMock).toHaveBeenCalledTimes(2);
      page.unmount();
      vi.advanceTimersByTime(60_000);
    },
  );

  it("continue re-checks the session and stays put with a notice while unverified", async () => {
    sessionState.data = {
      user: { id: "u-1", email: "member@example.com", emailVerified: false },
    };
    sessionState.refetch.mockResolvedValue(undefined);
    renderPage();
    await screen.findByTestId("verify-email-recipient");
    expect(screen.queryByTestId("verify-email-not-verified")).toBeNull();
    const before = sessionState.refetch.mock.calls.length;

    await userEvent.click(screen.getByTestId("verify-email-continue"));

    expect(
      await screen.findByTestId("verify-email-not-verified"),
    ).toHaveAttribute("role", "status");
    expect(sessionState.refetch.mock.calls.length).toBe(before + 1);
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByTestId("verify-email-continue")).toBeEnabled();
  });

  it("an anonymous visitor gets one way to sign in and no unverifiable continue", async () => {
    renderPage();

    expect(screen.queryByTestId("verify-email-continue")).toBeNull();
    await userEvent.click(await screen.findByTestId("verify-email-login"));
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("shows an error and stays retryable when resend fails", async () => {
    sendVerificationEmailMock.mockResolvedValue({
      data: null,
      error: { message: "Failed to send verification email" },
    });
    sessionState.data = {
      user: {
        id: "u-1",
        email: "member@example.com",
        emailVerified: false,
      },
    };
    renderPage();

    await screen.findByTestId("verify-email-recipient");
    await userEvent.click(screen.getByTestId("verify-email-resend"));

    expect(
      await screen.findByTestId("verify-email-resend-error"),
    ).toBeVisible();
    expect(screen.getByTestId("verify-email-recipient")).toHaveTextContent(
      "member@example.com",
    );
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      email: "member@example.com",
      callbackURL: "/onboarding",
    });
    expect(screen.getByTestId("verify-email-resend")).toBeEnabled();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("no email prefill when the preview fails", async () => {
    rememberInvitation("inv-gone");
    fetchInvitationMock.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    renderPage();

    const emailInput = await screen.findByTestId("verify-email-email");
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
