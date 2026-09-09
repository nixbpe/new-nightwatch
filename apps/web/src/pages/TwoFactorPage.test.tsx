import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readInvitation,
  readReturnTo,
  rememberInvitation,
  rememberReturnTo,
} from "../lib/auth/continuation";
import { SessionQueryProvider } from "../lib/auth/SessionQueryProvider";
import { OnboardingPage } from "./OnboardingPage";
import { TwoFactorPage } from "./TwoFactorPage";

type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

const { sessionState, twoFactorMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: SessionUser } | null,
    isPending: false,
  },
  twoFactorMock: {
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    twoFactor: twoFactorMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

const SIGNED_IN: SessionUser = {
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

function ChallengeHarness() {
  return (
    <MemoryRouter initialEntries={["/two-factor"]}>
      <SessionQueryProvider>
        <Routes>
          <Route path="/two-factor" element={<TwoFactorPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </SessionQueryProvider>
    </MemoryRouter>
  );
}

function renderPage() {
  const view = render(<ChallengeHarness />);
  return {
    resolveSession() {
      sessionState.data = { user: SIGNED_IN };
      view.rerender(<ChallengeHarness />);
    },
  };
}

describe("TwoFactorPage challenge", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    twoFactorMock.verifyTotp.mockReset();
    twoFactorMock.verifyBackupCode.mockReset();
    sessionStorage.clear();
  });

  it("a pending challenge renders the form and cannot show the workspace", () => {
    // Server issues no session while the challenge is pending: the page must
    // stay on the challenge instead of bouncing to /workspace.
    sessionState.data = null;
    renderPage();

    expect(
      screen.getByRole("heading", { name: "ยืนยันตัวตนสองขั้นตอน" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByRole("button", { name: "ยืนยัน" })).toBeInTheDocument();
  });

  it("does not authorize a successful verification response before the full session resolves", async () => {
    rememberInvitation("inv-await-session");
    rememberReturnTo("/settings/security");
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "session-token", user: SIGNED_IN },
      error: null,
    });
    const user = userEvent.setup();
    const page = renderPage();

    await user.type(screen.getByLabelText("รหัสยืนยัน 6 หลัก"), "123456");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    expect(
      screen.getByRole("heading", { name: "ยืนยันตัวตนสองขั้นตอน" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(readInvitation()).toBe("inv-await-session");
    expect(readReturnTo()).toBe("/settings/security");

    page.resolveSession();
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/accept-invitation/inv-await-session",
    );
  });

  it("keeps a deep return when full session arrives before TOTP verification settles", async () => {
    rememberReturnTo("/settings/security?tab=sessions#current");
    const verification = Promise.withResolvers<{
      data: typeof sessionState.data;
      error: null;
    }>();
    twoFactorMock.verifyTotp.mockReturnValue(verification.promise);
    const user = userEvent.setup();
    const page = renderPage();

    await user.type(screen.getByLabelText("รหัสยืนยัน 6 หลัก"), "123456");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));
    expect(screen.queryByTestId("location")).toBeNull();
    page.resolveSession();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    await act(async () => {
      verification.resolve({ data: sessionState.data, error: null });
      await verification.promise;
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );
    expect(readReturnTo()).toBe("/workspace");
  });

  it("an invalid TOTP stays on the challenge with a visible error", async () => {
    sessionState.data = null;
    const user = userEvent.setup();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { message: "รหัสยืนยันไม่ถูกต้อง" },
    });
    renderPage();

    await user.type(screen.getByLabelText("รหัสยืนยัน 6 หลัก"), "000000");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    expect(await screen.findByText("รหัสยืนยันไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByRole("button", { name: "ยืนยัน" })).toBeInTheDocument();
  });

  it.each(["totp", "recovery"] as const)(
    "%s preserves invitation priority across identity remount and late verification completion",
    async (mode) => {
      rememberInvitation("inv-mfa");
      rememberReturnTo("/settings/security");
      const verification = Promise.withResolvers<{
        data: typeof sessionState.data;
        error: null;
      }>();
      const verify =
        mode === "totp"
          ? twoFactorMock.verifyTotp
          : twoFactorMock.verifyBackupCode;
      verify.mockReturnValue(verification.promise);
      const user = userEvent.setup();
      const page = renderPage();

      if (mode === "recovery") {
        await user.click(
          screen.getByRole("radio", { name: /รหัสกู้คืนบัญชี/ }),
        );
      }
      await user.type(
        screen.getByLabelText(
          mode === "totp" ? "รหัสยืนยัน 6 หลัก" : "รหัสกู้คืนบัญชี",
        ),
        mode === "totp" ? "123456" : "backup-code-1",
      );
      await user.click(screen.getByRole("button", { name: "ยืนยัน" }));
      expect(screen.queryByTestId("location")).toBeNull();
      page.resolveSession();

      expect(await screen.findByTestId("location")).toHaveTextContent(
        "/accept-invitation/inv-mfa",
      );
      expect(readInvitation()).toBe("inv-mfa");
      await act(async () => {
        verification.resolve({ data: sessionState.data, error: null });
        await verification.promise;
      });
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/accept-invitation/inv-mfa",
      );
      expect(readInvitation()).toBe("inv-mfa");
      expect(readReturnTo()).toBe("/workspace");
    },
  );

  it("an invalid or replayed recovery code stays pending with a visible error", async () => {
    sessionState.data = null;
    const user = userEvent.setup();
    twoFactorMock.verifyBackupCode.mockResolvedValue({
      data: null,
      error: { message: "รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว" },
    });
    renderPage();

    await user.click(screen.getByRole("radio", { name: /รหัสกู้คืนบัญชี/ }));
    await user.type(screen.getByLabelText("รหัสกู้คืนบัญชี"), "used-code");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    expect(
      await screen.findByText("รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("an already signed-in session is bounced away from the challenge", async () => {
    sessionState.data = { user: SIGNED_IN };
    renderPage();

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
  });
});
