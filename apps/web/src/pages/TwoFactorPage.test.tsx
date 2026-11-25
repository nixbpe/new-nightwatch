import { act, render, screen, waitFor } from "@testing-library/react";
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
    // No session exists while the challenge is pending; the page must not bounce to /workspace.
    sessionState.data = null;
    renderPage();

    expect(screen.getByTestId("two-factor-page")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByTestId("two-factor-submit")).toBeInTheDocument();
  });

  it("names the empty code field by its label alone and describes it by the error", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("two-factor-submit"));

    const code = screen.getByRole("textbox", {
      name: "รหัสยืนยัน 6 หลักจากแอปยืนยันตัวตน",
    });
    expect(code).toBeInvalid();
    expect(code).toHaveAccessibleDescription("กรุณากรอกรหัสยืนยัน");
  });

  it("offers a way back to sign-in when the challenge cannot be completed", async () => {
    // The challenge cookie expires on its own; without this link the error that says
    // "sign in again" leaves the user on a page with no way to do it.
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("two-factor-login"));

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
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

    await user.type(screen.getByTestId("two-factor-code"), "123456");
    await user.click(screen.getByTestId("two-factor-submit"));

    expect(screen.getByTestId("two-factor-page")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(readInvitation()).toBe("inv-await-session");
    expect(readReturnTo()).toBe("/settings/security");

    page.resolveSession();
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/accept-invitation/inv-await-session",
    );
  });

  it("keeps the submit pending after a successful verification until the session arrives", async () => {
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "session-token", user: SIGNED_IN },
      error: null,
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByTestId("two-factor-code"), "123456");
    await user.click(screen.getByTestId("two-factor-submit"));

    await waitFor(() => {
      expect(twoFactorMock.verifyTotp).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("two-factor-submit")).toBeDisabled();
  });

  it("lets the user submit again after a refused code", async () => {
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: "INVALID_CODE", status: 401 },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByTestId("two-factor-code"), "123456");
    await user.click(screen.getByTestId("two-factor-submit"));

    expect(await screen.findByTestId("two-factor-error")).toBeVisible();
    expect(screen.getByTestId("two-factor-submit")).toBeEnabled();
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

    await user.type(screen.getByTestId("two-factor-code"), "123456");
    await user.click(screen.getByTestId("two-factor-submit"));
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

  it("a pasted code with spaces is sent as six digits", async () => {
    twoFactorMock.verifyTotp.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("two-factor-code"));
    await user.paste("123 456");
    expect(screen.getByTestId("two-factor-code")).toHaveValue("123456");
    await user.click(screen.getByTestId("two-factor-submit"));

    expect(twoFactorMock.verifyTotp).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: false,
    });
  });

  it("puts the cursor in the code field in both modes and keeps recovery codes as typed", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByTestId("two-factor-code")).toHaveFocus();

    await user.click(screen.getByTestId("two-factor-mode-recovery"));
    const recovery = screen.getByTestId("two-factor-code");
    expect(recovery).toHaveFocus();
    await user.type(recovery, "ab-12 cd");
    expect(recovery).toHaveValue("ab-12 cd");
    // Recovery codes are case-sensitive: a phone keyboard must not capitalise or correct them.
    expect(recovery).toHaveAttribute("autocapitalize", "none");
    expect(recovery).toHaveAttribute("spellcheck", "false");
  });

  it("starts on the app code and switches to a recovery code and back, clearing the field and error", async () => {
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: "INVALID_CODE", message: "Invalid code" },
    });
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByTestId("two-factor-code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    await user.type(screen.getByTestId("two-factor-code"), "000000");
    await user.click(screen.getByTestId("two-factor-submit"));
    expect(await screen.findByTestId("two-factor-error")).toBeVisible();

    await user.click(screen.getByTestId("two-factor-mode-recovery"));
    expect(screen.queryByTestId("two-factor-error")).toBeNull();
    expect(screen.getByTestId("two-factor-code")).toHaveValue("");
    expect(screen.getByTestId("two-factor-code")).toHaveAttribute(
      "autocomplete",
      "off",
    );

    await user.click(screen.getByTestId("two-factor-mode-totp"));
    expect(screen.getByTestId("two-factor-code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    expect(screen.getByTestId("two-factor-code")).toHaveFocus();
  });

  it("a lockout shows its message without marking the code wrong or taking focus", async () => {
    sessionState.data = null;
    const user = userEvent.setup();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: "ACCOUNT_TEMPORARILY_LOCKED", status: 429 },
    });
    renderPage();

    await user.type(screen.getByTestId("two-factor-code"), "000000");
    await user.click(screen.getByTestId("two-factor-submit"));

    expect(await screen.findByTestId("two-factor-error")).toBeVisible();
    expect(screen.getByTestId("two-factor-code")).not.toBeInvalid();
    expect(
      screen.getByTestId("two-factor-code"),
    ).not.toHaveAccessibleDescription(
      screen.getByTestId("two-factor-error").textContent,
    );
    expect(screen.getByTestId("two-factor-code")).not.toHaveFocus();
  });

  it("an invalid TOTP stays on the challenge with a visible error", async () => {
    sessionState.data = null;
    const user = userEvent.setup();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: "INVALID_CODE", message: "Invalid code" },
    });
    renderPage();

    await user.type(screen.getByTestId("two-factor-code"), "000000");
    await user.click(screen.getByTestId("two-factor-submit"));

    expect(await screen.findByTestId("two-factor-error")).toBeVisible();
    expect(screen.getByTestId("two-factor-code")).toHaveValue("000000");
    expect(screen.getByTestId("two-factor-code")).toHaveFocus();
    expect(screen.getByTestId("two-factor-code")).toBeInvalid();
    expect(screen.getByTestId("two-factor-code")).toHaveAccessibleDescription(
      screen.getByTestId("two-factor-error").textContent,
    );
    expect(twoFactorMock.verifyTotp).toHaveBeenCalledWith({
      code: "000000",
      trustDevice: false,
    });
    expect(twoFactorMock.verifyBackupCode).not.toHaveBeenCalled();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByTestId("two-factor-submit")).toBeInTheDocument();
  });

  it.each([
    ["totp", "123456"],
    ["recovery", "backup-code-1"],
  ] as const)(
    "%s sends an explicit trust-device choice without admitting a session",
    async (mode, code) => {
      const verify =
        mode === "totp"
          ? twoFactorMock.verifyTotp
          : twoFactorMock.verifyBackupCode;
      const otherVerify =
        mode === "totp"
          ? twoFactorMock.verifyBackupCode
          : twoFactorMock.verifyTotp;
      verify.mockResolvedValue({ data: null, error: null });
      const user = userEvent.setup();
      renderPage();

      if (mode === "recovery") {
        await user.click(screen.getByTestId("two-factor-mode-recovery"));
      }
      expect(screen.getByTestId("two-factor-trust-device")).not.toBeChecked();
      await user.click(screen.getByTestId("two-factor-trust-device"));
      expect(screen.getByTestId("two-factor-trust-device")).toBeChecked();
      await user.type(screen.getByTestId("two-factor-code"), code);
      await user.click(screen.getByTestId("two-factor-submit"));

      expect(verify).toHaveBeenCalledExactlyOnceWith({
        code,
        trustDevice: true,
      });
      expect(otherVerify).not.toHaveBeenCalled();
      expect(screen.getByTestId("two-factor-page")).toBeInTheDocument();
      expect(screen.queryByTestId("location")).toBeNull();
    },
  );

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
        await user.click(screen.getByTestId("two-factor-mode-recovery"));
      }
      await user.type(
        screen.getByTestId("two-factor-code"),
        mode === "totp" ? "123456" : "backup-code-1",
      );
      await user.click(screen.getByTestId("two-factor-submit"));
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

  it.each(["totp", "recovery"] as const)(
    "AUTH-01 %s back navigation ignores late challenge completion",
    async (mode) => {
      rememberInvitation("inv-cancel");
      rememberReturnTo("/settings/security");
      const pending = Promise.withResolvers<{ error: null }>();
      const verify =
        mode === "totp"
          ? twoFactorMock.verifyTotp
          : twoFactorMock.verifyBackupCode;
      verify.mockReturnValueOnce(pending.promise);
      renderPage();
      if (mode === "recovery")
        await userEvent.click(screen.getByTestId("two-factor-mode-recovery"));
      await userEvent.type(
        screen.getByTestId("two-factor-code"),
        mode === "totp" ? "123456" : "backup-code-1",
      );
      await userEvent.click(screen.getByTestId("two-factor-submit"));
      expect(screen.getByTestId("two-factor-submit")).toBeDisabled();
      await userEvent.click(screen.getByTestId("two-factor-login"));
      await act(async () => {
        pending.resolve({ error: null });
        await pending.promise;
      });
      expect(screen.getByTestId("location")).toHaveTextContent("/login");
      expect(readInvitation()).toBe("inv-cancel");
      expect(readReturnTo()).toBe("/settings/security");
    },
  );

  it("an invalid or replayed recovery code stays pending with a visible error", async () => {
    sessionState.data = null;
    const user = userEvent.setup();
    twoFactorMock.verifyBackupCode.mockResolvedValue({
      data: null,
      error: { code: "INVALID_BACKUP_CODE", message: "Invalid backup code" },
    });
    renderPage();

    await user.click(screen.getByTestId("two-factor-mode-recovery"));
    await user.type(screen.getByTestId("two-factor-code"), "used-code");
    await user.click(screen.getByTestId("two-factor-submit"));

    expect(await screen.findByTestId("two-factor-error")).toBeVisible();
    expect(screen.getByTestId("two-factor-code")).toHaveValue("used-code");
    expect(screen.getByTestId("two-factor-mode-totp")).toBeInTheDocument();
    expect(screen.queryByTestId("two-factor-mode-recovery")).toBeNull();
    expect(screen.getByTestId("two-factor-submit")).toBeEnabled();
    expect(twoFactorMock.verifyBackupCode).toHaveBeenCalledWith({
      code: "used-code",
      trustDevice: false,
    });
    expect(twoFactorMock.verifyTotp).not.toHaveBeenCalled();
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
