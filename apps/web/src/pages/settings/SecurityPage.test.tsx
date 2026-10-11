import { StrictMode } from "react";
import { contextQueryOptions } from "../../lib/tenant/bootstrap";
import { guardUnassignedNetwork } from "../../test/guard-network";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SecurityPage } from "./SecurityPage";

const { meState, fetchMeContextMock, twoFactorMock } = vi.hoisted(() => ({
  meState: { twoFactorEnabled: false },
  fetchMeContextMock: vi.fn<() => Promise<MeContextResponse>>(),
  twoFactorMock: {
    enable: vi.fn(),
    verifyTotp: vi.fn(),
    generateBackupCodes: vi.fn(),
    disable: vi.fn(),
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false }),
    twoFactor: twoFactorMock,
    changePassword: vi.fn(),
  }),
}));

vi.mock("qrcode", () => ({
  toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,QR")),
}));

vi.mock("../../lib/api/me", () => ({
  ME_CONTEXT_QUERY_KEY: ["me", "context"],
  fetchMeContext: () => fetchMeContextMock(),
}));

const TOTP_URI =
  "otpauth://totp/NightWatch:member@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NightWatch";

// Re-reads the flag on every call so a refetch observes the real pending→verified transition.
function meContextFixture(): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "สมาชิกทดสอบ",
      email: "member@example.com",
      emailVerified: true,
      twoFactorEnabled: meState.twoFactorEnabled,
    },
    organizations: [],
    lastActiveTenantId: null,
  };
}

function resetAuthMocks() {
  meState.twoFactorEnabled = false;
  twoFactorMock.enable.mockReset();
  twoFactorMock.verifyTotp.mockReset();
  twoFactorMock.generateBackupCodes.mockReset();
  twoFactorMock.disable.mockReset();
  fetchMeContextMock.mockReset();
  fetchMeContextMock.mockImplementation(() =>
    Promise.resolve(meContextFixture()),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings/security"]}>
        <Routes>
          <Route path="/settings/security" element={<SecurityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The password card below shares field labels, so scope to the MFA region.
function mfaCard() {
  const card = screen.getByTestId("mfa-card");
  expect(card.tagName).toBe("SECTION");
  expect(card).toHaveAttribute("aria-labelledby", "mfa-card-title");
  expect(card).toHaveAccessibleName();
  return within(card);
}

async function enroll() {
  const user = userEvent.setup();
  twoFactorMock.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: ["code-1", "code-2"] },
    error: null,
  });
  renderPage();
  await user.click(await screen.findByTestId("mfa-enable-open"));
  await user.type(
    mfaCard().getByTestId("mfa-enable-password"),
    "CurrentPassw0rd!",
  );
  await user.click(screen.getByTestId("mfa-enable-submit"));
  await screen.findByTestId("mfa-recovery-codes");
  await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
  await user.click(screen.getByTestId("mfa-scan-next"));
  await screen.findByTestId("mfa-verify-code");
  return user;
}

guardUnassignedNetwork();

describe("SecurityPage enrollment", () => {
  beforeEach(resetAuthMocks);

  it("keeps failed context stable during StrictMode mount and retries only on page action", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    bindQueryClientIdentity(queryClient, "user-1");
    fetchMeContextMock.mockRejectedValue(new Error("offline"));
    await queryClient
      .query(contextQueryOptions(queryClient))
      .catch(() => undefined);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    const view = render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/settings/security"]}>
            <SecurityPage />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByTestId("security-load-error");
    expect(screen.getByTestId("security-load-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    fetchMeContextMock.mockResolvedValue(meContextFixture());
    await userEvent.setup().click(screen.getByTestId("security-load-retry"));
    await screen.findByTestId("mfa-card");
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await queryClient.query(contextQueryOptions(queryClient));
    });
    expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
    view.unmount();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("shows pending enrollment until the first TOTP code is verified", async () => {
    await enroll();

    expect(screen.getByTestId("mfa-status-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("mfa-status-enabled")).toBeNull();
    expect(screen.queryByTestId("mfa-regenerate-open")).toBeNull();
  });

  it("shows enabled only after the server confirms twoFactorEnabled", async () => {
    const user = await enroll();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "session-token", user: {} },
      error: null,
    });
    meState.twoFactorEnabled = true;

    await user.type(screen.getByTestId("mfa-verify-code"), "123456");
    await user.click(screen.getByTestId("mfa-verify-submit"));

    expect(await screen.findByTestId("mfa-status-enabled")).toBeInTheDocument();
    expect(
      await screen.findByTestId("mfa-regenerate-open"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mfa-enabled-notice")).toBeVisible();
    expect(screen.getByTestId("mfa-enabled-notice")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.queryByTestId("mfa-secret")).toBeNull();
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
    expect(screen.queryByTestId("mfa-verify-code")).toBeNull();
  });

  it("a failed status lookup shows a retryable error instead of enrollment controls", async () => {
    // A failed me/context lookup must not masquerade as a known "disabled" status.
    fetchMeContextMock.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByTestId("security-load-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mfa-enable-open")).toBeNull();
    expect(screen.queryByTestId("mfa-status-disabled")).toBeNull();

    await user.click(screen.getByTestId("security-load-retry"));

    expect(await screen.findByTestId("mfa-enable-open")).toBeInTheDocument();
    expect(screen.getByTestId("mfa-status-disabled")).toBeInTheDocument();
  });
});

describe("SecurityPage recovery regeneration", () => {
  beforeEach(resetAuthMocks);

  it("regeneration with the current password displays the new one-time codes", async () => {
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("mfa-status-enabled");
    twoFactorMock.generateBackupCodes.mockResolvedValue({
      data: { status: true, backupCodes: ["new-1", "new-2"] },
      error: null,
    });

    await user.click(screen.getByTestId("mfa-regenerate-open"));
    await user.type(
      mfaCard().getByTestId("mfa-regenerate-password"),
      "CurrentPassw0rd!",
    );
    await user.click(screen.getByTestId("mfa-regenerate-submit"));

    expect(await screen.findByTestId("mfa-recovery-codes")).toHaveTextContent(
      "new-1",
    );
    expect(screen.getByTestId("mfa-recovery-codes")).toHaveTextContent("new-2");
    expect(
      screen
        .getAllByTestId("mfa-recovery-code")
        .map((node) => node.textContent),
    ).toEqual(["new-1", "new-2"]);
    expect(twoFactorMock.generateBackupCodes).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
    await user.click(screen.getByTestId("mfa-regenerate-done"));
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
    expect(screen.getByTestId("mfa-regenerate-open")).toBeInTheDocument();
  });

  it("invalid credentials on regeneration show an error and never a false set of codes", async () => {
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("mfa-status-enabled");
    twoFactorMock.generateBackupCodes
      .mockResolvedValueOnce({
        data: null,
        error: { code: "INVALID_PASSWORD", message: "Invalid password" },
      })
      .mockResolvedValueOnce({
        data: { status: true, backupCodes: ["kept-1", "kept-2"] },
        error: null,
      });

    await user.click(screen.getByTestId("mfa-regenerate-open"));
    const password = mfaCard().getByTestId("mfa-regenerate-password");
    await user.type(password, "WrongPassw0rd!");
    await user.click(screen.getByTestId("mfa-regenerate-submit"));

    expect(
      await screen.findByTestId("mfa-regenerate-password-error"),
    ).toBeVisible();
    expect(screen.getByTestId("mfa-regenerate-password-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("mfa-regenerate-password-error").id,
    );
    expect(password).toHaveValue("WrongPassw0rd!");
    expect(twoFactorMock.generateBackupCodes).toHaveBeenCalledWith({
      password: "WrongPassw0rd!",
    });
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
    await user.clear(password);
    await user.type(password, "CurrentPassw0rd!");
    await user.click(screen.getByTestId("mfa-regenerate-submit"));

    expect(await screen.findByTestId("mfa-recovery-codes")).toHaveTextContent(
      "kept-1",
    );
    expect(screen.getByTestId("mfa-recovery-codes")).toHaveTextContent(
      "kept-2",
    );
  });

  it("disabling flips the card to off only after the server confirms", async () => {
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("mfa-status-enabled");
    twoFactorMock.disable.mockImplementation(() => {
      meState.twoFactorEnabled = false;
      return Promise.resolve({ data: { status: true }, error: null });
    });

    await user.click(screen.getByTestId("mfa-disable-open"));
    await user.type(
      screen.getByTestId("mfa-disable-password"),
      "CurrentPassw0rd!",
    );
    await user.click(screen.getByTestId("mfa-disable-submit"));

    expect(
      await screen.findByTestId("mfa-status-disabled"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mfa-enable-open")).toBeInTheDocument();
    expect(twoFactorMock.disable).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
    expect(screen.queryByTestId("mfa-status-enabled")).toBeNull();
  });
});
