import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
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

/** Walk the inline enrolment to the verification step. */
async function enroll() {
  const user = userEvent.setup();
  twoFactorMock.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: ["code-1", "code-2"] },
    error: null,
  });
  renderPage();
  await user.click(await screen.findByRole("button", { name: "เปิดใช้งาน" }));
  await user.type(
    screen.getByLabelText("รหัสผ่านปัจจุบัน"),
    "CurrentPassw0rd!",
  );
  await user.click(
    screen.getByRole("button", { name: /ถัดไป: สแกนคิวอาร์โค้ด/ }),
  );
  await screen.findByText("2. เก็บรหัสกู้คืนไว้ในที่ปลอดภัย");
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }),
  );
  await screen.findByLabelText(/รหัสยืนยัน 6 หลัก/);
  return user;
}

describe("SecurityPage enrollment", () => {
  beforeEach(resetAuthMocks);

  it("reports pending after enable alone — never claims enabled before first-code verification", async () => {
    // SEC-001: enable returns URI + backup codes but the server keeps
    // twoFactorEnabled=false until verifyTotp succeeds.
    await enroll();

    expect(screen.getByText("กำลังตั้งค่า")).toBeInTheDocument();
    expect(screen.queryByText("เปิดอยู่")).toBeNull();
    expect(screen.queryByRole("button", { name: /สร้างชุดใหม่/ })).toBeNull();
  });

  it("a wrong first code stays on the verification step with a visible error", async () => {
    const user = await enroll();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { message: "รหัสยืนยันไม่ถูกต้อง" },
    });

    await user.type(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/), "000000");
    await user.click(
      screen.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "รหัสยืนยันไม่ถูกต้อง",
    );
    expect(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("กำลังตั้งค่า")).toBeInTheDocument();
    // Retry stays possible without re-enrolling; no enabled/recovery UI.
    expect(
      screen.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("เปิดอยู่")).toBeNull();
  });

  it("shows enabled only after the server confirms twoFactorEnabled", async () => {
    const user = await enroll();
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "session-token", user: {} },
      error: null,
    });
    meState.twoFactorEnabled = true;

    await user.type(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/), "123456");
    await user.click(
      screen.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }),
    );

    expect(await screen.findByText("เปิดอยู่")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /สร้างชุดใหม่/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "เปิดใช้งานยืนยันสองขั้นตอนแล้ว",
    );
    // The enrolment draft (secret, codes) is gone with the step UI.
    expect(screen.queryByText(/JBSW Y3DP/)).toBeNull();
    expect(screen.queryByText("code-1")).toBeNull();
    expect(screen.queryByLabelText(/รหัสยืนยัน 6 หลัก/)).toBeNull();
  });

  it("a failed status lookup shows a retryable error instead of enrollment controls", async () => {
    // A pending/failed me/context lookup must not masquerade as a known
    // "disabled" status with an active enable button.
    fetchMeContextMock.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(
        "ไม่สามารถตรวจสอบสถานะยืนยันสองขั้นตอนได้ กรุณาลองใหม่อีกครั้ง",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดใช้งาน" })).toBeNull();
    expect(screen.queryByText("ปิดอยู่")).toBeNull();

    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

    expect(
      await screen.findByRole("button", { name: "เปิดใช้งาน" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ปิดอยู่")).toBeInTheDocument();
  });
});

describe("SecurityPage recovery regeneration", () => {
  beforeEach(resetAuthMocks);

  it("regeneration with the current password displays the new one-time codes", async () => {
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("เปิดอยู่");
    twoFactorMock.generateBackupCodes.mockResolvedValue({
      data: { status: true, backupCodes: ["new-1", "new-2"] },
      error: null,
    });

    await user.click(screen.getByRole("button", { name: /สร้างชุดใหม่/ }));
    await user.type(
      screen.getByLabelText(/รหัสผ่านปัจจุบัน/),
      "CurrentPassw0rd!",
    );
    await user.click(
      screen.getByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    );

    expect(await screen.findByText("new-1")).toBeInTheDocument();
    expect(screen.getByText("new-2")).toBeInTheDocument();
    expect(twoFactorMock.generateBackupCodes).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
    // One-time reveal: "เรียบร้อย" puts the codes away.
    await user.click(screen.getByRole("button", { name: "เรียบร้อย" }));
    expect(screen.queryByText("new-1")).toBeNull();
    expect(
      screen.getByRole("button", { name: /สร้างชุดใหม่/ }),
    ).toBeInTheDocument();
  });

  it("invalid credentials on regeneration show an error and never a false set of codes", async () => {
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("เปิดอยู่");
    twoFactorMock.generateBackupCodes
      .mockResolvedValueOnce({
        data: null,
        error: { message: "รหัสผ่านไม่ถูกต้อง" },
      })
      .mockResolvedValueOnce({
        data: { status: true, backupCodes: ["kept-1", "kept-2"] },
        error: null,
      });

    await user.click(screen.getByRole("button", { name: /สร้างชุดใหม่/ }));
    const password = screen.getByLabelText(/รหัสผ่านปัจจุบัน/);
    await user.type(password, "WrongPassw0rd!");
    await user.click(
      screen.getByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "รหัสผ่านไม่ถูกต้อง",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("kept-1")).toBeNull();
    // The panel stays open for a retry with the right password.
    await user.clear(password);
    await user.type(password, "CurrentPassw0rd!");
    await user.click(
      screen.getByRole("button", { name: "สร้างรหัสกู้คืนใหม่" }),
    );

    expect(await screen.findByText("kept-1")).toBeInTheDocument();
    expect(screen.getByText("kept-2")).toBeInTheDocument();
  });

  it("disabling flips the card to off only after the server confirms", async () => {
    meState.twoFactorEnabled = true;
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("เปิดอยู่");
    twoFactorMock.disable.mockImplementation(() => {
      meState.twoFactorEnabled = false;
      return Promise.resolve({ data: { status: true }, error: null });
    });

    await user.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    await user.type(
      screen.getByLabelText("ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน"),
      "CurrentPassw0rd!",
    );
    await user.click(
      screen.getByRole("button", { name: "ปิดใช้งานยืนยันสองขั้นตอน" }),
    );

    expect(await screen.findByText("ปิดอยู่")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "เปิดใช้งาน" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("เปิดอยู่")).toBeNull();
  });
});
