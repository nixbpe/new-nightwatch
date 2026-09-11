import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SecurityPage } from "./SecurityPage";

type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

const { sessionState, meState, fetchMeContextMock, twoFactorMock } = vi.hoisted(
  () => ({
    sessionState: {
      data: null as { user: SessionUser } | null,
      isPending: false,
    },
    meState: { twoFactorEnabled: false },
    fetchMeContextMock: vi.fn<() => Promise<MeContextResponse>>(),
    twoFactorMock: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
  }),
);

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

vi.mock("../../lib/api/me", () => ({
  ME_CONTEXT_QUERY_KEY: ["me", "context"],
  fetchMeContext: () => fetchMeContextMock(),
}));

const SIGNED_IN: SessionUser = {
  id: "user-1",
  email: "member@example.com",
  emailVerified: true,
};

const TOTP_URI =
  "otpauth://totp/NightWatch:member@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NightWatch";

/**
 * Schema-valid me/context fixture. The server contract alone decides the
 * visible two-factor status, so the mock transport re-reads the flag on
 * every call: a refetch after verification observes the real
 * pending→verified transition instead of a client-side success shortcut.
 */
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
  sessionState.data = null;
  sessionState.isPending = false;
  meState.twoFactorEnabled = false;
  twoFactorMock.enable.mockReset();
  twoFactorMock.verifyTotp.mockReset();
  twoFactorMock.generateBackupCodes.mockReset();
  fetchMeContextMock.mockReset();
  fetchMeContextMock.mockImplementation(() =>
    Promise.resolve(meContextFixture()),
  );
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={["/settings/security"]}>
        <Routes>
          <Route path="/settings/security" element={<SecurityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function enroll() {
  const user = userEvent.setup();
  twoFactorMock.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: ["code-1", "code-2"] },
    error: null,
  });
  renderPage();
  await user.type(
    await screen.findByLabelText("รหัสผ่านปัจจุบัน"),
    "CurrentPassw0rd!",
  );
  await user.click(
    screen.getByRole("button", { name: "เปิดใช้งานยืนยันสองขั้นตอน" }),
  );
  await screen.findByText(
    /ยืนยันสองขั้นตอนจะยังไม่เปิดใช้งานจนกว่ารหัสแรกจะถูกต้อง/,
  );
  return user;
}

describe("SecurityPage enrollment", () => {
  beforeEach(resetAuthMocks);

  it("reports pending after enable alone — never claims enabled before first-code verification", async () => {
    // SEC-001: enable returns URI + backup codes but the server keeps
    // twoFactorEnabled=false until verifyTotp succeeds.
    sessionState.data = { user: SIGNED_IN };
    await enroll();

    expect(screen.getByText("ยังไม่ได้เปิดใช้งาน")).toBeInTheDocument();
    expect(screen.queryByText("เปิดใช้งานแล้ว")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    ).toBeNull();
  });

  it("a wrong first code stays pending with a visible error", async () => {
    sessionState.data = { user: SIGNED_IN };
    const user = await enroll();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { message: "รหัสยืนยันไม่ถูกต้อง" },
    });

    await user.type(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/), "000000");
    await user.click(
      screen.getByRole("button", { name: "ยืนยันรหัสแรกและเปิดใช้งาน" }),
    );

    expect(await screen.findByText("รหัสยืนยันไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่ได้เปิดใช้งาน")).toBeInTheDocument();
    // Retry stays possible without re-enrolling; no enabled/recovery UI.
    expect(
      screen.getByRole("button", { name: "ยืนยันรหัสแรกและเปิดใช้งาน" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("เปิดใช้งานแล้ว")).toBeNull();
  });

  it("shows enabled only after the server confirms twoFactorEnabled", async () => {
    sessionState.data = { user: SIGNED_IN };
    const user = await enroll();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "session-token", user: {} },
      error: null,
    });
    meState.twoFactorEnabled = true;

    await user.type(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/), "123456");
    await user.click(
      screen.getByRole("button", { name: "ยืนยันรหัสแรกและเปิดใช้งาน" }),
    );

    expect(await screen.findByText("เปิดใช้งานแล้ว")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/ยังไม่เปิดใช้งานจนกว่ารหัสแรกจะถูกต้อง/),
    ).toBeNull();
  });

  it("a failed status lookup shows a retryable error instead of enrollment controls", async () => {
    // A pending/failed me/context lookup must not masquerade as a known
    // "disabled" status with an active enable form.
    sessionState.data = { user: SIGNED_IN };
    fetchMeContextMock.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(
        "ไม่สามารถตรวจสอบสถานะยืนยันสองขั้นตอนได้ กรุณาลองใหม่อีกครั้ง",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "เปิดใช้งานยืนยันสองขั้นตอน" }),
    ).toBeNull();
    expect(screen.queryByText("ยังไม่ได้เปิดใช้งาน")).toBeNull();

    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

    expect(
      await screen.findByRole("button", {
        name: "เปิดใช้งานยืนยันสองขั้นตอน",
      }),
    ).toBeInTheDocument();
  });
});

describe("SecurityPage recovery regeneration", () => {
  beforeEach(resetAuthMocks);

  it("regeneration with the current password displays the new one-time codes", async () => {
    sessionState.data = { user: SIGNED_IN };
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("เปิดใช้งานแล้ว");
    twoFactorMock.generateBackupCodes.mockResolvedValue({
      data: { status: true, backupCodes: ["new-1", "new-2"] },
      error: null,
    });

    await user.type(
      screen.getByLabelText(/รหัสผ่านปัจจุบัน/),
      "CurrentPassw0rd!",
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    );

    expect(await screen.findByText("new-1")).toBeInTheDocument();
    expect(screen.getByText("new-2")).toBeInTheDocument();
  });

  it("invalid credentials on regeneration keep the displayed codes and show an error", async () => {
    sessionState.data = { user: SIGNED_IN };
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("เปิดใช้งานแล้ว");
    twoFactorMock.generateBackupCodes
      .mockResolvedValueOnce({
        data: { status: true, backupCodes: ["kept-1", "kept-2"] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "รหัสผ่านไม่ถูกต้อง" },
      });

    await user.type(
      screen.getByLabelText(/รหัสผ่านปัจจุบัน/),
      "CurrentPassw0rd!",
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    );
    expect(await screen.findByText("kept-1")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/รหัสผ่านปัจจุบัน/),
      "WrongPassw0rd!",
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    );

    expect(await screen.findByText("รหัสผ่านไม่ถูกต้อง")).toBeInTheDocument();
    // Existing displayed state is not replaced by a false success.
    expect(screen.getByText("kept-1")).toBeInTheDocument();
    expect(screen.getByText("kept-2")).toBeInTheDocument();
  });
});
