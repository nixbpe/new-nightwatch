import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
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
    // Reactive stand-in for the better-auth session atom: mutations notify subscribers.
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
  // vi.mock factories are hoisted above static imports, so react must be imported lazily.
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

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname + location.search + location.hash}
    </div>
  );
}

// Real anonymous-gate loader and root layout, so a session resolving mid-sign-in continues as in the app.
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
  await user.type(await screen.findByTestId("login-email"), email);
  await user.type(screen.getByTestId("login-password"), password);
  await user.click(screen.getByTestId("login-submit"));
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

    await user.click(await screen.findByTestId("login-submit"));

    const email = screen.getByTestId("login-email");
    const password = screen.getByTestId("login-password");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", "login-email-error");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute(
      "aria-describedby",
      "login-password-error",
    );
    expect(screen.getByTestId("login-email-error")).toHaveAttribute(
      "id",
      "login-email-error",
    );
    expect(screen.getByTestId("login-password-error")).toHaveAttribute(
      "id",
      "login-password-error",
    );
    expect(signInEmailMock).not.toHaveBeenCalled();
  });
  it("submits the entered credentials unchanged", async () => {
    renderPage();
    await screen.findByTestId("login-submit");

    signInEmailMock.mockResolvedValue({ data: null, error: null });
    await submitLogin("member@example.com", "correct-password");
    expect(signInEmailMock).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "correct-password",
    });
  });
  it("prevents a duplicate sign-in while the first request is pending", async () => {
    const finishSignIn = deferSignIn();
    const user = userEvent.setup();
    renderPage();

    await user.type(
      await screen.findByTestId("login-email"),
      "member@example.com",
    );
    await user.type(screen.getByTestId("login-password"), "correct-password");
    const submit = screen.getByTestId("login-submit");
    await user.dblClick(submit);

    expect(signInEmailMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("login-submit")).toBeDisabled();
    await finishSignIn();
  });

  it("invalid credentials keep the entered form and show the error", async () => {
    // A failed attempt must not wipe the form or navigate away.
    signInEmailMock.mockResolvedValue({
      data: null,
      error: {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
        status: 401,
      },
    });
    renderPage();

    await submitLogin("member@example.com", "wrong-password");

    expect(await screen.findByTestId("login-auth-error")).toBeVisible();
    expect(signInEmailMock).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "wrong-password",
    });
    expect(screen.getByTestId("login-email")).toHaveValue("member@example.com");
    expect(screen.getByTestId("login-password")).toHaveValue("wrong-password");
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByTestId("login-submit")).toBeEnabled();
  });

  it.each([
    [
      "EMAIL_NOT_VERIFIED with a 403 status",
      {
        code: "EMAIL_NOT_VERIFIED",
        message: "Email not verified",
        status: 403,
      },
    ],
    [
      "EMAIL_NOT_VERIFIED without a 403 status",
      { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
    ],
    ["a 403 without a code", { message: "Forbidden", status: 403 }],
  ] as const)(
    // Each of these is recoverable: the error links to the anonymous-safe resend hub.
    "offers the resend page instead of a dead end for %s",
    async (_label, error) => {
      signInEmailMock.mockResolvedValue({ data: null, error });
      renderPage();

      await submitLogin("new@example.com", "super-secret-1");

      expect(await screen.findByTestId("login-auth-error")).toBeVisible();
      expect(screen.getByTestId("login-email")).toHaveValue("new@example.com");
      expect(screen.getByTestId("login-password")).toHaveValue(
        "super-secret-1",
      );
      expect(screen.queryByTestId("location")).toBeNull();
      expect(screen.getByTestId("login-submit")).toBeEnabled();
      expect(screen.getByTestId("login-verify-email")).toBeInTheDocument();
    },
  );

  it("the resend link navigates to the verify-email page", async () => {
    signInEmailMock.mockResolvedValue({
      data: null,
      error: {
        code: "EMAIL_NOT_VERIFIED",
        message: "Email not verified",
        status: 403,
      },
    });
    renderPage();

    await submitLogin("new@example.com", "super-secret-1");
    await screen.findByTestId("login-auth-error");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("login-verify-email"));
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
    expect(screen.queryByTestId("login-email")).toBeNull();
    await finishSignIn();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    expect(readReturnTo()).toBe("/workspace");
  });

  it("falls back to the workspace for an encoded backslash continuation", async () => {
    const finishSignIn = deferSignIn();
    const page = renderPage("/%5C%5Cevil.example");

    await submitLogin("member@example.com", "correct-password");
    page.resolveSession();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    expect(readReturnTo()).toBe("/workspace");
    await finishSignIn();
  });

  it("resumes explicit invitation acceptance before the old login request settles", async () => {
    // Resolving the full session replaces the anonymous QueryClient subtree while onSubmit still awaits.
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
    // The two-factor plugin owns the redirect; the page must not navigate or show an error, and
    // must keep the remembered destination for the post-challenge return.
    signInEmailMock.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    });
    renderPage("/settings/security");

    await submitLogin("member@example.com", "correct-password");

    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("login-auth-error")).toBeNull();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(readReturnTo()).toBe("/settings/security");
  });

  it("an unexpected sign-in failure shows a generic retryable error", async () => {
    signInEmailMock.mockRejectedValue(new Error("network down"));
    renderPage();

    await submitLogin("member@example.com", "correct-password");

    expect(await screen.findByTestId("login-auth-error")).toBeVisible();
    expect(screen.getByTestId("login-email")).toHaveValue("member@example.com");
    expect(screen.getByTestId("login-password")).toHaveValue(
      "correct-password",
    );
    expect(screen.getByTestId("login-submit")).toBeEnabled();
    expect(screen.queryByTestId("location")).toBeNull();
  });
});
