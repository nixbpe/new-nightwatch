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

vi.mock("qrcode", () => ({
  toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,QR")),
}));

const TOTP_URI =
  "otpauth://totp/NightWatch:member@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NightWatch";
const SECRET_GROUPED = "JBSW Y3DP EHPK 3PXP";

async function reachScanStep(refreshStatus = vi.fn()) {
  const user = userEvent.setup();
  twoFactorMock.enable.mockResolvedValue({
    data: {
      method: "totp",
      totpURI: TOTP_URI,
      backupCodes: ["code-1", "code-2"],
    },
    error: null,
  });
  render(<MfaCard enabled={false} refreshStatus={refreshStatus} />);
  await user.click(screen.getByTestId("mfa-enable-open"));
  await user.type(
    screen.getByTestId("mfa-enable-password"),
    "CurrentPassw0rd!",
  );
  await user.click(screen.getByTestId("mfa-enable-submit"));
  expect(await screen.findByTestId("mfa-secret")).toHaveTextContent(
    SECRET_GROUPED,
  );
  expect(screen.getByTestId("mfa-card").tagName).toBe("SECTION");
  expect(screen.getByTestId("mfa-card")).toHaveAttribute(
    "aria-labelledby",
    "mfa-card-title",
  );
  expect(screen.getByTestId("mfa-card")).toHaveAccessibleName();
  expect(
    screen.getAllByTestId("mfa-recovery-code").map((node) => node.textContent),
  ).toEqual(["code-1", "code-2"]);
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
    expect(screen.getByTestId("mfa-recovery-codes")).toHaveTextContent(
      "code-1",
    );
    expect(screen.getByTestId("mfa-recovery-codes")).toHaveTextContent(
      "code-2",
    );
    expect(screen.getByTestId("mfa-step-scan")).toHaveAttribute(
      "aria-current",
      "step",
    );

    const next = screen.getByTestId("mfa-scan-next");
    expect(next).toBeDisabled();
    await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
    expect(next).toBeEnabled();
    await user.click(next);
    expect(screen.getByTestId("mfa-verify-code")).toBeInTheDocument();
  });

  it("cancelling discards the draft — the secret and codes leave the DOM", async () => {
    const user = await reachScanStep();
    await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
    await user.click(screen.getByTestId("mfa-scan-next"));
    await user.click(screen.getByTestId("mfa-verify-back"));
    expect(screen.getByTestId("mfa-secret")).toHaveTextContent(SECRET_GROUPED);

    await user.click(screen.getByTestId("mfa-scan-back"));
    // Back to the password step: a new enable call would mint a new secret.
    expect(screen.queryByTestId("mfa-secret")).toBeNull();
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
    expect(screen.getByTestId("mfa-enable-password")).toBeInTheDocument();

    await user.click(screen.getByTestId("mfa-enable-cancel"));
    expect(screen.getByTestId("mfa-enable-open")).toBeInTheDocument();
    expect(screen.getByTestId("mfa-status-disabled")).toBeInTheDocument();
  });

  it("a wrong password on enable is a field-level error and stays on step 1", async () => {
    const user = userEvent.setup();
    twoFactorMock.enable.mockResolvedValue({
      data: null,
      error: { code: "INVALID_PASSWORD", message: "Invalid password" },
    });
    render(<MfaCard enabled={false} refreshStatus={vi.fn()} />);
    await user.click(screen.getByTestId("mfa-enable-open"));
    const password = screen.getByTestId("mfa-enable-password");
    await user.type(password, "nope");
    await user.click(screen.getByTestId("mfa-enable-submit"));

    expect(
      await screen.findByTestId("mfa-enable-password-error"),
    ).toBeVisible();
    expect(screen.getByTestId("mfa-enable-password-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("mfa-enable-password-error").id,
    );
    expect(password).toHaveValue("nope");
    expect(twoFactorMock.enable).toHaveBeenCalledWith({ password: "nope" });
    expect(screen.getByTestId("mfa-step-password")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.queryByTestId("mfa-secret")).toBeNull();
  });

  it("a non-TOTP enable response is an enable error and never reaches the scan step", async () => {
    const user = userEvent.setup();
    twoFactorMock.enable.mockResolvedValue({
      data: { method: "otp" },
      error: null,
    });
    render(<MfaCard enabled={false} refreshStatus={vi.fn()} />);
    await user.click(screen.getByTestId("mfa-enable-open"));
    await user.type(
      screen.getByTestId("mfa-enable-password"),
      "CurrentPassw0rd!",
    );
    await user.click(screen.getByTestId("mfa-enable-submit"));

    expect(
      await screen.findByTestId("mfa-enable-password-error"),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("mfa-step-password")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.queryByTestId("mfa-secret")).toBeNull();
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
    expect(twoFactorMock.enable).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
  });

  it("links a wrong TOTP code to its exact server validation alert", async () => {
    const user = await reachScanStep();
    await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
    await user.click(screen.getByTestId("mfa-scan-next"));
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: null,
      error: { code: "INVALID_CODE", message: "Invalid code" },
    });

    const code = screen.getByTestId("mfa-verify-code");
    await user.type(code, "123456");
    await user.click(screen.getByTestId("mfa-verify-submit"));

    const alert = await screen.findByTestId("mfa-verify-server-error");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "first-totp-server-error");
    expect(alert).toHaveAttribute("id", "first-totp-server-error");
    expect(alert).toBeVisible();
    expect(alert).toHaveAttribute("role", "alert");
    expect(code).toHaveValue("123456");
    expect(twoFactorMock.verifyTotp).toHaveBeenCalledWith({ code: "123456" });

    await user.clear(code);
    expect(code).toHaveAttribute(
      "aria-describedby",
      "first-totp-error first-totp-server-error",
    );
  });

  it("a verified code that the server still reports as disabled shows the refresh guard, not success", async () => {
    const refreshStatus = vi.fn().mockResolvedValue(false);
    const user = await reachScanStep(refreshStatus);
    await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
    await user.click(screen.getByTestId("mfa-scan-next"));
    twoFactorMock.verifyTotp.mockResolvedValue({
      data: { token: "t", user: {} },
      error: null,
    });

    await user.type(screen.getByTestId("mfa-verify-code"), "123456");
    await user.click(screen.getByTestId("mfa-verify-submit"));

    expect(await screen.findByTestId("mfa-verify-guard")).toBeVisible();
    expect(screen.getByTestId("mfa-verify-guard")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    expect(twoFactorMock.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    expect(screen.getByTestId("mfa-verify-code")).toHaveValue("");
    expect(screen.getByTestId("mfa-step-verify")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.queryByTestId("mfa-status-enabled")).toBeNull();
  });

  it("the code field accepts digits only, six at most", async () => {
    const user = await reachScanStep();
    await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
    await user.click(screen.getByTestId("mfa-scan-next"));

    const code = screen.getByTestId("mfa-verify-code");
    await user.type(code, "12ab34567");
    expect(code).toHaveValue("123456");
  });

  it("step 2 renders a QR image generated from the real otpauth URI on a white tile", async () => {
    await reachScanStep();

    const qr = await screen.findByTestId("mfa-qr");
    expect(qr).toHaveAttribute("src", "data:image/png;base64,QR");
    expect(vi.mocked(toDataURL)).toHaveBeenCalledWith(
      TOTP_URI,
      expect.anything(),
    );
  });

  it("copies the raw secret and the codes to the clipboard with a transient confirmation", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const user = await reachScanStep();

    await user.click(screen.getByTestId("mfa-secret-copy-ready"));
    expect(writeText).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");
    expect(
      await screen.findByTestId("mfa-secret-copy-done"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("mfa-codes-copy-ready"));
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

    await user.click(screen.getByTestId("mfa-codes-download"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(await (blob as Blob).text()).toContain("code-1\ncode-2");
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0]).toHaveAttribute(
      "download",
      "nightwatch-recovery-codes.txt",
    );
    expect(click.mock.instances[0]).toHaveAttribute("href", "blob:codes");
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

    await user.click(screen.getByTestId("mfa-disable-open"));
    const password = screen.getByTestId("mfa-disable-password");
    expect(password).toHaveFocus();
    expect(screen.getByTestId("mfa-disable-warning")).toBeVisible();
    expect(screen.getByTestId("mfa-disable-warning")).toHaveAttribute(
      "role",
      "alert",
    );
    await user.type(password, "CurrentPassw0rd!");
    await user.click(screen.getByTestId("mfa-disable-submit"));

    expect(twoFactorMock.disable).toHaveBeenCalledWith({
      password: "CurrentPassw0rd!",
    });
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    rerender(<MfaCard enabled={false} refreshStatus={refreshStatus} />);
    expect(
      await screen.findByTestId("mfa-status-disabled"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mfa-enable-open")).toHaveFocus();
  });

  it("a wrong password on disable keeps the panel open with a field-level error", async () => {
    twoFactorMock.disable.mockResolvedValue({
      data: null,
      error: { code: "INVALID_PASSWORD", message: "Invalid password" },
    });
    const user = userEvent.setup();
    render(<MfaCard enabled refreshStatus={vi.fn()} />);

    await user.click(screen.getByTestId("mfa-disable-open"));
    const password = screen.getByTestId("mfa-disable-password");
    await user.type(password, "nope");
    await user.click(screen.getByTestId("mfa-disable-submit"));

    expect(
      await screen.findByTestId("mfa-disable-password-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mfa-disable-password-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("mfa-disable-password-error").id,
    );
    expect(password).toHaveValue("nope");
    expect(twoFactorMock.disable).toHaveBeenCalledWith({ password: "nope" });
    expect(screen.getByTestId("mfa-status-enabled")).toBeInTheDocument();
  });

  it("only one panel is open at a time, and cancelling returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<MfaCard enabled refreshStatus={vi.fn()} />);

    await user.click(screen.getByTestId("mfa-regenerate-open"));
    expect(screen.getByTestId("mfa-regenerate-password")).toHaveFocus();
    await user.click(screen.getByTestId("mfa-disable-open"));
    expect(screen.queryByTestId("mfa-regenerate-password")).toBeNull();
    expect(screen.getByTestId("mfa-disable-password")).toHaveFocus();

    await user.click(screen.getByTestId("mfa-disable-cancel"));
    expect(screen.getByTestId("mfa-disable-open")).toHaveFocus();
  });
});
