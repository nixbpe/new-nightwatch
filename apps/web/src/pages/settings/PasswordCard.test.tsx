import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordCard } from "./PasswordCard";

const { changePasswordMock } = vi.hoisted(() => ({
  changePasswordMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false }),
    changePassword: changePasswordMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { current: string; next: string; confirm: string },
) {
  await user.type(screen.getByLabelText("รหัสผ่านปัจจุบัน"), values.current);
  await user.type(screen.getByLabelText("รหัสผ่านใหม่"), values.next);
  await user.type(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), values.confirm);
}

describe("PasswordCard", () => {
  beforeEach(() => {
    changePasswordMock.mockReset();
  });

  it("validates length, mismatch and reuse before calling the API", async () => {
    const user = userEvent.setup();
    render(<PasswordCard />);

    await fill(user, { current: "OldPassw0rd!", next: "short", confirm: "x" });
    await user.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));

    expect(
      screen.getByText("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("รหัสผ่านยืนยันไม่ตรงกับรหัสผ่านใหม่"),
    ).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("รหัสผ่านใหม่"));
    await user.type(screen.getByLabelText("รหัสผ่านใหม่"), "OldPassw0rd!");
    expect(
      screen.getByText("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน"),
    ).toBeInTheDocument();
  });

  it("changes the password with other sessions revoked, then resets and confirms", async () => {
    changePasswordMock.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    render(<PasswordCard />);

    await fill(user, {
      current: "OldPassw0rd!",
      next: "NewPassw0rd!!",
      confirm: "NewPassw0rd!!",
    });
    await user.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));

    expect(changePasswordMock).toHaveBeenCalledWith({
      currentPassword: "OldPassw0rd!",
      newPassword: "NewPassw0rd!!",
      revokeOtherSessions: true,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นทุกเครื่องถูกออกจากระบบ",
    );
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveValue("");
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveValue("");
    expect(screen.getByLabelText("ยืนยันรหัสผ่านใหม่")).toHaveValue("");
  });

  it("a rejected current password is reported on that field", async () => {
    changePasswordMock.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        code: "INVALID_PASSWORD",
        message: "Invalid password",
      },
    });
    const user = userEvent.setup();
    render(<PasswordCard />);

    await fill(user, {
      current: "WrongPassw0rd!",
      next: "NewPassw0rd!!",
      confirm: "NewPassw0rd!!",
    });
    await user.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));

    const current = screen.getByLabelText("รหัสผ่านปัจจุบัน");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid password",
    );
    expect(current).toHaveAttribute("aria-invalid", "true");
    // The typed values are kept for a retry.
    expect(current).toHaveValue("WrongPassw0rd!");
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveValue("NewPassw0rd!!");
  });

  it("show/hide toggles reveal each field independently", async () => {
    const user = userEvent.setup();
    render(<PasswordCard />);

    const toggles = screen.getAllByRole("button", { name: "แสดงรหัสผ่าน" });
    expect(toggles).toHaveLength(3);
    const newPasswordToggle = toggles[1];
    if (newPasswordToggle === undefined) {
      throw new Error("expected a toggle for the new-password field");
    }
    await user.click(newPasswordToggle);

    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByRole("button", { name: "ซ่อนรหัสผ่าน" }),
    ).toBeInTheDocument();
  });
});
