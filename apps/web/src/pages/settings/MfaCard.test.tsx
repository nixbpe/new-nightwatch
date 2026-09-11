import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MfaCard } from "./MfaCard";

const { twoFactorMock } = vi.hoisted(() => ({
  twoFactorMock: {
    enable: vi.fn(),
    verifyTotp: vi.fn(),
    generateBackupCodes: vi.fn(),
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

const TOTP_URI =
  "otpauth://totp/NightWatch:member@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NightWatch";
const SECRET_GROUPED = "JBSW Y3DP EHPK 3PXP";

async function reachScanStep(refreshStatus = vi.fn()) {
  const user = userEvent.setup();
  twoFactorMock.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: ["code-1", "code-2"] },
    error: null,
  });
  render(<MfaCard enabled={false} refreshStatus={refreshStatus} />);
  await user.click(screen.getByRole("button", { name: "เปิดใช้งาน" }));
  await user.type(
    screen.getByLabelText("รหัสผ่านปัจจุบัน"),
    "CurrentPassw0rd!",
  );
  await user.click(
    screen.getByRole("button", { name: /ถัดไป: สแกนคิวอาร์โค้ด/ }),
  );
  await screen.findByText(SECRET_GROUPED);
  return user;
}

describe("MfaCard enrolment steps", () => {
  beforeEach(() => {
    twoFactorMock.enable.mockReset();
    twoFactorMock.verifyTotp.mockReset();
    twoFactorMock.generateBackupCodes.mockReset();
  });

  it("step 2 shows the manual key grouped in fours and the codes, and gates the next step on the acknowledgement", async () => {
    const user = await reachScanStep();

    expect(twoFactorMock.enable).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
    expect(screen.getByText("code-1")).toBeInTheDocument();
    expect(screen.getByText("code-2")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "สแกนและเก็บรหัสกู้คืน",
    );

    const next = screen.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(next).toBeEnabled();
    await user.click(next);
    expect(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/)).toBeInTheDocument();
  });

  it("cancelling discards the draft — the secret and codes leave the DOM", async () => {
    const user = await reachScanStep();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }),
    );
    await user.click(screen.getByRole("button", { name: /ย้อนกลับ/ }));
    expect(screen.getByText(SECRET_GROUPED)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ย้อนกลับ/ }));
    // Back to the password step: a new enable call would mint a new secret.
    expect(screen.queryByText(SECRET_GROUPED)).toBeNull();
    expect(screen.queryByText("code-1")).toBeNull();
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(
      screen.getByRole("button", { name: "เปิดใช้งาน" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ปิดอยู่")).toBeInTheDocument();
  });

  it("a wrong password on enable is a field-level error and stays on step 1", async () => {
    const user = userEvent.setup();
    twoFactorMock.enable.mockResolvedValue({
      data: null,
      error: { message: "รหัสผ่านไม่ถูกต้อง" },
    });
    render(<MfaCard enabled={false} refreshStatus={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "เปิดใช้งาน" }));
    const password = screen.getByLabelText("รหัสผ่านปัจจุบัน");
    await user.type(password, "nope");
    await user.click(
      screen.getByRole("button", { name: /ถัดไป: สแกนคิวอาร์โค้ด/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "รหัสผ่านไม่ถูกต้อง",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(SECRET_GROUPED)).toBeNull();
  });

  it("a verified code that the server still reports as disabled shows the refresh guard, not success", async () => {
    const refreshStatus = vi.fn().mockResolvedValue(false);
    const user = await reachScanStep(refreshStatus);
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }),
    );
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "t", user: {} },
      error: null,
    });

    await user.type(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/), "123456");
    await user.click(
      screen.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยืนยันรหัสแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้",
    );
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("เปิดอยู่")).toBeNull();
  });

  it("the code field accepts digits only, six at most", async () => {
    const user = await reachScanStep();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }),
    );

    const code = screen.getByLabelText(/รหัสยืนยัน 6 หลัก/);
    await user.type(code, "12ab34567");
    expect(code).toHaveValue("123456");
  });
});
