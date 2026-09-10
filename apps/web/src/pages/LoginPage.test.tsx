import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readInvitation,
  readReturnTo,
  rememberInvitation,
} from "../lib/auth/continuation";
import { requireAnonLoader } from "../lib/auth/loaders";
import { RootLayout } from "../router";
import { LoginPage } from "./LoginPage";
import { OnboardingPage } from "./OnboardingPage";

type TestSessionData = {
  user: { id: string; email: string; emailVerified: boolean };
} | null;

const { sessionStore, signInEmailMock } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: { data: TestSessionData; isPending: boolean } = {
    data: null,
    isPending: false,
  };
  return {
    // Reactive stand-in for the better-auth session atom: mutations notify
    // subscribers so hooks re-read, exactly like the real client.
    sessionStore: {
      get: () => snapshot,
      set(data: TestSessionData) {
        snapshot = { data, isPending: false };
        for (const listener of listeners) {
          listener();
        }
      },
      reset() {
        snapshot = { data: null, isPending: false };
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    signInEmailMock: vi.fn(),
  };
});
vi.mock("better-auth/react", async () => {
  // Dynamic import: vi.mock factories are hoisted above static imports, so
  // react can only be reached lazily inside the factory.
  const { useSyncExternalStore } = await import("react");
  return {
    createAuthClient: () => ({
      useSession: () =>
        useSyncExternalStore(
          (listener) => sessionStore.subscribe(listener),
          sessionStore.get,
        ),
      getSession: () =>
        Promise.resolve({ data: sessionStore.get().data, error: null }),
      signIn: { email: signInEmailMock },
    }),
  };
});

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

/**
 * Data-mode harness: the real anonymous-gate loader and the real root
 * layout (per-identity query boundary + revalidation on identity change),
 * so a session resolving mid-sign-in continues exactly as the app does.
 */
function renderPage(from?: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RootLayout />,
        children: [
          { path: "/login", loader: requireAnonLoader, element: <LoginPage /> },
          { path: "/onboarding", element: <OnboardingPage /> },
          { path: "*", element: <LocationProbe /> },
        ],
      },
    ],
    {
      initialEntries: [
        from === undefined
          ? "/login"
          : `/login?from=${encodeURIComponent(from)}`,
      ],
    },
  );
  render(<RouterProvider router={router} />);
  return {
    resolveSession() {
      act(() => {
        sessionStore.set({
          user: {
            id: "newly-verified-user",
            email: "member@example.com",
            emailVerified: true,
          },
        });
      });
    },
  };
}

function deferSignIn() {
  const { promise, resolve } = Promise.withResolvers<{
    data: TestSessionData;
    error: null;
  }>();
  signInEmailMock.mockReturnValue(promise);
  return async () => {
    await act(async () => {
      resolve({ data: sessionStore.get().data, error: null });
      await promise;
    });
  };
}

async function submitLogin(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("อีเมล"), email);
  await user.type(screen.getByLabelText("รหัสผ่าน"), password);
  await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
  return user;
}

describe("LoginPage", () => {
  afterEach(() => {
    sessionStore.reset();
    signInEmailMock.mockReset();
    sessionStorage.clear();
  });

  it("blocks an empty submission and links adjacent field errors", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "เข้าสู่ระบบ" }),
    );

    const email = screen.getByLabelText(/อีเมล/);
    const password = screen.getByLabelText(/รหัสผ่าน/);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute(
      "aria-describedby",
      "login-email-error",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute(
      "aria-describedby",
      "login-password-error",
    );
    expect(screen.getByText("กรุณากรอกอีเมล")).toHaveAttribute(
      "id",
      "login-email-error",
    );
    expect(screen.getByText("กรุณากรอกรหัสผ่าน")).toHaveAttribute(
      "id",
      "login-password-error",
    );
    expect(signInEmailMock).not.toHaveBeenCalled();
  });
  it("prevents a duplicate sign-in while the first request is pending", async () => {
    const finishSignIn = deferSignIn();
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("อีเมล"), "member@example.com");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "correct-password");
    const submit = screen.getByRole("button", { name: "เข้าสู่ระบบ" });
    await user.dblClick(submit);

    expect(signInEmailMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "กำลังเข้าสู่ระบบ…" }),
    ).toBeDisabled();
    await finishSignIn();
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
