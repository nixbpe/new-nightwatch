import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readInvitation,
  readReturnTo,
  rememberReturnTo,
} from "../lib/auth/continuation";
import { SessionQueryProvider } from "../lib/auth/SessionQueryProvider";
import { OnboardingPage } from "./OnboardingPage";

type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

const { sessionState, verifyEmailMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: SessionUser } | null,
    isPending: false,
    refetch: vi.fn(),
  },
  verifyEmailMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    verifyEmail: verifyEmailMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

const VERIFIED_USER: SessionUser = {
  id: "user-1",
  email: "member@example.com",
  emailVerified: true,
};

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname + location.search + location.hash}
    </div>
  );
}

function renderAt(entry: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <SessionQueryProvider>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </SessionQueryProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("OnboardingPage transitions", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    verifyEmailMock.mockReset();
    sessionState.refetch.mockReset();
    sessionStorage.clear();
  });

  it("existing member without an invitation lands on the workspace", async () => {
    // INT-WEB-1: must not wait on any (disabled/invitation) query status.
    sessionState.data = { user: VERIFIED_USER };
    renderAt("/onboarding");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
  });

  it("holds the callback while the token verifies, then routes to explicit acceptance", async () => {
    // INT-WEB-2: no redirect may happen while verifyEmail/refetch are pending.
    const pending = Promise.withResolvers<{ error: null }>();
    verifyEmailMock.mockReturnValue(pending.promise);
    sessionState.refetch.mockResolvedValue(undefined);
    sessionState.data = { user: VERIFIED_USER };

    renderAt("/onboarding?emailVerificationToken=tok-1&invitationId=inv-9");

    expect(screen.getByText("กำลังยืนยันอีเมลของคุณ…")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();

    pending.resolve({ error: null });
    sessionState.data = { user: VERIFIED_USER };

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/accept-invitation/inv-9",
    );
  });

  it("a rejected token renders a retry-safe error instead of redirecting", async () => {
    // INT-WEB-2: network/API failure stays on this page with recovery actions.
    verifyEmailMock.mockResolvedValue({
      error: { message: "ลิงก์ยืนยันหมดอายุแล้ว" },
    });
    sessionState.refetch.mockResolvedValue(undefined);
    renderAt("/onboarding?emailVerificationToken=expired");

    expect(
      await screen.findByRole("heading", { name: "ยืนยันอีเมลไม่สำเร็จ" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ลิงก์ยืนยันหมดอายุแล้ว")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ส่งอีเมลยืนยันใหม่" }),
    ).toBeInTheDocument();
    // Still on the hub: no redirect occurred.
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("anonymous post-verification visitors go to login with the invitation kept", async () => {
    verifyEmailMock.mockResolvedValue({ error: null });
    sessionState.refetch.mockResolvedValue(undefined);

    renderAt("/onboarding?emailVerificationToken=tok-2&invitationId=inv-7");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(readInvitation()).toBe("inv-7");
  });

  it("holds the return until token verification and session refresh settle, then consumes it", async () => {
    const token = Promise.withResolvers<{ error: null }>();
    const refresh = Promise.withResolvers<undefined>();
    verifyEmailMock.mockReturnValue(token.promise);
    sessionState.refetch.mockReturnValue(refresh.promise);
    sessionState.data = { user: VERIFIED_USER };
    rememberReturnTo("/settings/security?tab=sessions#current");
    renderAt("/onboarding?emailVerificationToken=tok-return");

    expect(screen.queryByTestId("location")).toBeNull();
    expect(readReturnTo()).toBe("/settings/security?tab=sessions#current");
    await act(async () => {
      token.resolve({ error: null });
      await token.promise;
    });
    expect(screen.queryByTestId("location")).toBeNull();
    expect(readReturnTo()).toBe("/settings/security?tab=sessions#current");
    await act(async () => {
      refresh.resolve(undefined);
      await refresh.promise;
    });

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    expect(readReturnTo()).toBe("/workspace");
  });
});
