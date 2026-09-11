import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toDataURL } from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MfaCard } from "./MfaCard";

const { twoFactorMock } = vi.hoisted(() => ({
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
    twoFactorMock.disable.mockReset();
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

  it("links a wrong TOTP code to its exact server validation alert", async () => {
    const user = await reachScanStep();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: /ถัดไป: ยืนยันรหัสแรก/ }),
    );
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { message: "รหัสยืนยันไม่ถูกต้อง" },
    });

    const code = screen.getByLabelText(/รหัสยืนยัน 6 หลัก/);
    await user.type(code, "123456");
    await user.click(
      screen.getByRole("button", { name: /ยืนยันและเปิดใช้งาน/ }),
    );

    const alert = await screen.findByRole("alert");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "first-totp-server-error");
    expect(alert).toHaveAttribute("id", "first-totp-server-error");
    expect(alert).toHaveTextContent("รหัสยืนยันไม่ถูกต้อง");

    await user.clear(code);
    expect(code).toHaveAttribute(
      "aria-describedby",
      "first-totp-error first-totp-server-error",
    );
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

  it("step 2 renders a QR image generated from the real otpauth URI on a white tile", async () => {
    await reachScanStep();

    const qr = await screen.findByRole("img", {
      name: "คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน",
    });
    expect(qr).toHaveAttribute("src", "data:image/png;base64,QR");
    expect(vi.mocked(toDataURL)).toHaveBeenCalledWith(TOTP_URI, {
      margin: 0,
      width: 168,
    });
  });

  it("copies the raw secret and the codes to the clipboard with a transient confirmation", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const user = await reachScanStep();

    await user.click(screen.getByRole("button", { name: /^คัดลอก$/ }));
    expect(writeText).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");
    expect(
      await screen.findByRole("button", { name: "คัดลอกแล้ว" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "คัดลอกทั้งหมด" }));
    expect(writeText).toHaveBeenLastCalledWith("code-1\ncode-2");
    writeText.mockRestore();
  });

  it("downloads the codes as a text file", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:codes");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = await reachScanStep();

    await user.click(screen.getByRole("button", { name: /ดาวน์โหลด \.txt/ }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(await (blob as Blob).text()).toContain("code-1\ncode-2");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:codes");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });
});

describe("MfaCard enabled state", () => {
  beforeEach(() => {
    twoFactorMock.enable.mockReset();
    twoFactorMock.verifyTotp.mockReset();
    twoFactorMock.generateBackupCodes.mockReset();
    twoFactorMock.disable.mockReset();
  });

  it("disable asks for the password, calls the API, and hands the flip to the server's answer", async () => {
    const refreshStatus = vi.fn().mockResolvedValue(false);
    twoFactorMock.disable.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    const user = userEvent.setup();
    const { rerender } = render(
      <MfaCard enabled refreshStatus={refreshStatus} />,
    );

    await user.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    const password = screen.getByLabelText(
      "ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน",
    );
    expect(password).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("การปิด MFA");
    await user.type(password, "CurrentPassw0rd!");
    await user.click(
      screen.getByRole("button", { name: "ปิดใช้งานยืนยันสองขั้นตอน" }),
    );

    expect(twoFactorMock.disable).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    rerender(<MfaCard enabled={false} refreshStatus={refreshStatus} />);
    expect(await screen.findByText("ปิดอยู่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดใช้งาน" })).toHaveFocus();
  });

  it("a wrong password on disable keeps the panel open with a field-level error", async () => {
    twoFactorMock.disable.mockResolvedValue({
      data: null,
      error: { message: "รหัสผ่านไม่ถูกต้อง" },
    });
    const user = userEvent.setup();
    render(<MfaCard enabled refreshStatus={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    const password = screen.getByLabelText(
      "ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน",
    );
    await user.type(password, "nope");
    await user.click(
      screen.getByRole("button", { name: "ปิดใช้งานยืนยันสองขั้นตอน" }),
    );

    expect(await screen.findByText("รหัสผ่านไม่ถูกต้อง")).toBeInTheDocument();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("เปิดอยู่")).toBeInTheDocument();
  });

  it("only one panel is open at a time, and cancelling returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<MfaCard enabled refreshStatus={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /สร้างชุดใหม่/ }));
    expect(screen.getByLabelText(/รหัสผ่านปัจจุบัน/)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "ปิดใช้งาน" }));
    expect(screen.queryByLabelText(/จำเป็นสำหรับสร้างรหัสกู้คืน/)).toBeNull();
    expect(
      screen.getByLabelText("ยืนยันรหัสผ่านปัจจุบันเพื่อปิดใช้งาน"),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByRole("button", { name: "ปิดใช้งาน" })).toHaveFocus();
  });
});
