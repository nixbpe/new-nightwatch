import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequireAnon } from "../components/guards";
import {
  readInvitation,
  readReturnTo,
  rememberInvitation,
} from "../lib/auth/continuation";
import { SessionQueryProvider } from "../lib/auth/SessionQueryProvider";
import { LoginPage } from "./LoginPage";
import { OnboardingPage } from "./OnboardingPage";

const { sessionState, signInEmailMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as {
      user: { id: string; email: string; emailVerified: boolean };
    } | null,
    isPending: false,
  },
  signInEmailMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    signIn: { email: signInEmailMock },
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname + location.search + location.hash}
    </div>
  );
}

function LoginHarness({ from }: { from?: string }) {
  return (
    <MemoryRouter
      initialEntries={[
        from === undefined ? "/login" : { pathname: "/login", state: { from } },
      ]}
    >
      <SessionQueryProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <RequireAnon>
                <LoginPage />
              </RequireAnon>
            }
          />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </SessionQueryProvider>
    </MemoryRouter>
  );
}

function renderPage(from?: string) {
  const view = render(<LoginHarness from={from} />);
  return {
    resolveSession() {
      sessionState.data = {
        user: {
          id: "newly-verified-user",
          email: "member@example.com",
          emailVerified: true,
        },
      };
      view.rerender(<LoginHarness from={from} />);
    },
  };
}

function deferSignIn() {
  const { promise, resolve } = Promise.withResolvers<{
    data: typeof sessionState.data;
    error: null;
  }>();
  signInEmailMock.mockReturnValue(promise);
  return async () => {
    await act(async () => {
      resolve({ data: sessionState.data, error: null });
      await promise;
    });
  };
}

async function submitLogin(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("อีเมล"), email);
  await user.type(screen.getByLabelText("รหัสผ่าน"), password);
  await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
  return user;
}

describe("LoginPage", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    signInEmailMock.mockReset();
    sessionStorage.clear();
  });

  it("invalid credentials keep the entered form and show the error", async () => {
    // A failed attempt must not wipe the form or navigate away: the user
    // corrects a typo, not retypes everything.
    signInEmailMock.mockResolvedValue({
      data: null,
      error: { message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง", status: 401 },
    });
    renderPage();

    await submitLogin("member@example.com", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    );
    expect(screen.getByLabelText("อีเมล")).toHaveValue("member@example.com");
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveValue("wrong-password");
    // Still on the login page, ready for another attempt.
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeEnabled();
  });

  it("an unverified account is offered the resend page instead of a dead end", async () => {
    // EMAIL_NOT_VERIFIED (403) is recoverable: the error links to the
    // anonymous-safe resend hub rather than stranding the user.
    signInEmailMock.mockResolvedValue({
      data: null,
      error: { message: "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ", status: 403 },
    });
    renderPage();

    await submitLogin("new@example.com", "super-secret-1");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ",
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("link", { name: "ไปที่หน้ายืนยันอีเมล" }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
  });

  it("keeps the deep link when session identity remounts before sign-in settles", async () => {
    const finishSignIn = deferSignIn();
    const page = renderPage("/settings/security?tab=sessions#current");

    await submitLogin("member@example.com", "correct-password");
    expect(screen.queryByTestId("location")).toBeNull();
    page.resolveSession();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    expect(screen.queryByLabelText("อีเมล")).toBeNull();
    await finishSignIn();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    expect(readReturnTo()).toBe("/workspace");
  });

  it("resumes explicit invitation acceptance before the old login request settles", async () => {
    // The invitation survives signup/verification. Resolving the full session
    // replaces the anonymous QueryClient subtree while onSubmit still awaits.
    rememberInvitation("inv-9");
    const finishSignIn = deferSignIn();
    const page = renderPage("/settings/security");

    await submitLogin("member@example.com", "correct-password");
    page.resolveSession();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/accept-invitation/inv-9",
    );
    expect(readInvitation()).toBe("inv-9");
    expect(readReturnTo()).toBe("/workspace");
    await finishSignIn();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/accept-invitation/inv-9",
    );
    expect(readInvitation()).toBe("inv-9");
  });

  it("uses the workspace when a resolved sign-in has no continuation", async () => {
    const finishSignIn = deferSignIn();
    const page = renderPage();

    await submitLogin("member@example.com", "correct-password");
    page.resolveSession();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    await finishSignIn();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
  });

  it("a pending second-factor challenge stays put and keeps the return path", async () => {
    // The two-factor plugin owns the redirect to /two-factor; the page must
    // not navigate on its own, must not show an error, and must leave the
    // remembered destination for the post-challenge return.
    signInEmailMock.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    });
    renderPage("/settings/security");

    await submitLogin("member@example.com", "correct-password");

    // No client-side navigation and no error: the challenge is pending.
    expect(
      await screen.findByRole("heading", { name: "เข้าสู่ระบบ NightWatch" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("location")).toBeNull();
    // The intended page survives for TwoFactorPage to return to.
    expect(readReturnTo()).toBe("/settings/security");
  });

  it("an unexpected sign-in failure shows a generic retryable error", async () => {
    signInEmailMock.mockRejectedValue(new Error("network down"));
    renderPage();

    await submitLogin("member@example.com", "correct-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
    );
    expect(screen.queryByTestId("location")).toBeNull();
  });
});
