import type { InvitationResponse } from "@nightwatch/api-contract";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { fetchInvitation } from "../lib/api/invitations";
import { readInvitation } from "../lib/auth/continuation";
import { requireAnonLoader } from "../lib/auth/loaders";
import { RootLayout } from "../router";
import { AcceptInvitationPage } from "./AcceptInvitationPage";
import { LoginPage } from "./LoginPage";
import { OnboardingPage } from "./OnboardingPage";

type TestSessionData = {
  user: { id: string; email: string; emailVerified: boolean };
} | null;

const { sessionStore, signUpEmailMock, signInEmailMock, acceptInvitationMock } =
  vi.hoisted(() => {
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
      signUpEmailMock: vi.fn(),
      signInEmailMock: vi.fn(),
      acceptInvitationMock: vi.fn(),
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
      signUp: { email: signUpEmailMock },
      signIn: { email: signInEmailMock },
      organization: { acceptInvitation: acceptInvitationMock },
      signOut: vi.fn(),
    }),
  };
});

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../lib/api/invitations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchInvitation: vi.fn() };
});

const fetchInvitationMock = vi.mocked(fetchInvitation);

const invitation: InvitationResponse = {
  invitation: {
    id: "inv-123",
    email: "new@example.com",
    organizationName: "Acme Corp",
    role: "viewer",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/**
 * Data-mode harness: the real anonymous-gate loader and the real root
 * layout (per-identity query boundary + revalidation on identity change),
 * so a session resolving mid-sign-in continues exactly as the app does.
 */
function renderPage(path = "/accept-invitation/inv-123") {
  const router = createMemoryRouter(
    [
      {
        element: <RootLayout />,
        children: [
          {
            path: "/accept-invitation/:invitationId",
            element: <AcceptInvitationPage />,
          },
          { path: "/login", loader: requireAnonLoader, element: <LoginPage /> },
          { path: "/onboarding", element: <OnboardingPage /> },
          { path: "*", element: <LocationProbe /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return {
    resolveSession() {
      act(() => {
        sessionStore.set({
          user: {
            id: "user-1",
            email: "new@example.com",
            emailVerified: true,
          },
        });
      });
    },
  };
}

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    sessionStore.reset();
  });

  afterEach(() => {
    fetchInvitationMock.mockReset();
    signUpEmailMock.mockReset();
    signInEmailMock.mockReset();
    acceptInvitationMock.mockReset();
    sessionStorage.clear();
  });

  it("signup from invitation continues to verification", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    renderPage();

    await screen.findByText("สร้างบัญชีจากคำเชิญ");
    await userEvent.type(screen.getByLabelText("ชื่อที่แสดง"), "สมชาย ใจดี");
    await userEvent.type(
      screen.getByLabelText("รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"),
      "super-secret-1",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "สร้างบัญชีและรอการยืนยันอีเมล" }),
    );

    // Observable continuation: successful signup routes to the resend hub
    // with the invitation remembered for post-verification acceptance.
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
    expect(readInvitation()).toBe("inv-123");
  });

  it("returns from login automatically and keeps the invitation until explicit acceptance succeeds", async () => {
    const signIn = Promise.withResolvers<{
      data: TestSessionData;
      error: null;
    }>();
    const acceptance = Promise.withResolvers<{ data: object; error: null }>();
    fetchInvitationMock.mockResolvedValue(invitation);
    signInEmailMock.mockReturnValue(signIn.promise);
    acceptInvitationMock.mockReturnValue(acceptance.promise);
    const user = userEvent.setup();
    const page = renderPage();

    await user.click(
      await screen.findByRole("link", { name: "เข้าสู่ระบบเพื่อรับคำเชิญ" }),
    );
    await screen.findByRole("heading", { name: "เข้าสู่ระบบ NightWatch" });

    await user.type(screen.getByLabelText("อีเมล"), "new@example.com");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "super-secret-1");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    page.resolveSession();

    // No manual link recovery: the remounted anonymous guard must resume
    // the invitation automatically while the original sign-in still awaits.
    expect(
      await screen.findByRole("heading", { name: "ยอมรับคำเชิญ" }),
    ).toBeInTheDocument();
    expect(readInvitation()).toBe("inv-123");
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    await act(async () => {
      signIn.resolve({ data: sessionStore.get().data, error: null });
      await signIn.promise;
    });
    expect(
      screen.getByRole("heading", { name: "ยอมรับคำเชิญ" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เข้าร่วมองค์กร" }));
    expect(readInvitation()).toBe("inv-123");
    expect(screen.queryByTestId("location")).toBeNull();
    await act(async () => {
      acceptance.resolve({ data: {}, error: null });
      await acceptance.promise;
    });

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    // Acceptance consumed the pending invitation; nothing lingers.
    expect(readInvitation()).toBeNull();
  });

  it("refuses an invitation addressed to a different email", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    sessionStore.set({
      user: {
        id: "user-9",
        email: "other@example.com",
        emailVerified: true,
      },
    });
    renderPage();

    expect(
      await screen.findByText("บัญชีนี้ไม่ตรงกับคำเชิญ"),
    ).toBeInTheDocument();
    // Denied: the acceptance form never renders for the wrong account.
    expect(screen.queryByRole("button", { name: "เข้าร่วมองค์กร" })).toBeNull();
  });

  it("fails safely when the invitation preview cannot be loaded", async () => {
    fetchInvitationMock.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    renderPage();

    expect(
      await screen.findByText(
        "ไม่พบคำเชิญนี้ ตรวจสอบลิงก์จากอีเมลอีกครั้งหรือติดต่อผู้เชิญ",
      ),
    ).toBeInTheDocument();
    // Safe state offers a way back to login, with no signup form exposed.
    expect(
      screen.getByRole("link", { name: "ไปที่หน้าเข้าสู่ระบบ" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "สร้างบัญชีและรอการยืนยันอีเมล" }),
    ).toBeNull();
  });
});
