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
  await user.type(
    screen.getByTestId("change-current-password"),
    values.current,
  );
  await user.type(screen.getByTestId("change-new-password"), values.next);
  await user.type(
    screen.getByTestId("change-confirm-password"),
    values.confirm,
  );
}

describe("PasswordCard", () => {
  beforeEach(() => {
    changePasswordMock.mockReset();
  });

  it("validates length, mismatch and reuse before calling the API", async () => {
    const user = userEvent.setup();
    render(<PasswordCard />);

    await fill(user, { current: "OldPassw0rd!", next: "short", confirm: "x" });
    await user.click(screen.getByTestId("password-change-submit"));

    expect(screen.getByTestId("change-new-password-error")).toBeInTheDocument();
    expect(
      screen.getByTestId("change-confirm-password-error"),
    ).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId("change-new-password"));
    await user.type(screen.getByTestId("change-new-password"), "OldPassw0rd!");
    expect(screen.getByTestId("change-new-password-error")).toBeInTheDocument();
    await user.click(screen.getByTestId("password-change-submit"));
    expect(changePasswordMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("change-new-password")).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("change-new-password-error").id,
    );
  });

  it("shows a field's error after it loses focus, not while the user is still typing", async () => {
    const user = userEvent.setup();
    render(<PasswordCard />);
    const next = screen.getByTestId("change-new-password");

    await user.type(next, "abc");
    expect(next).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("change-new-password-error")).toBeNull();

    await user.type(screen.getByTestId("change-confirm-password"), "x");
    expect(screen.getByTestId("change-new-password-error")).toBeVisible();
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("change-confirm-password-error")).toBeNull();
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
    await user.click(screen.getByTestId("change-new-password-toggle"));
    await user.click(screen.getByTestId("password-change-submit"));

    expect(changePasswordMock).toHaveBeenCalledWith({
      currentPassword: "OldPassw0rd!",
      newPassword: "NewPassw0rd!!",
      revokeOtherSessions: true,
    });
    expect(await screen.findByTestId("password-change-success")).toBeVisible();
    // Success is a status message, not an interrupting alert (CMP-10).
    expect(screen.getByTestId("password-change-success")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("change-current-password")).toHaveValue("");
    expect(screen.getByTestId("change-new-password")).toHaveValue("");
    expect(screen.getByTestId("change-confirm-password")).toHaveValue("");
    expect(screen.getByTestId("change-new-password")).toHaveAttribute(
      "type",
      "password",
    );
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
    await user.click(screen.getByTestId("password-change-submit"));

    const current = screen.getByTestId("change-current-password");
    expect(
      await screen.findByTestId("change-current-password-error"),
    ).toBeVisible();
    expect(current).toHaveAttribute("aria-invalid", "true");
    expect(current).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("change-current-password-error").id,
    );
    expect(screen.getByTestId("password-change-submit")).toBeEnabled();
    expect(current).toHaveValue("WrongPassw0rd!");
    expect(screen.getByTestId("change-new-password")).toHaveValue(
      "NewPassw0rd!!",
    );
  });

  it("a too-short new password is not reported on the current-password field", async () => {
    changePasswordMock.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        code: "PASSWORD_TOO_SHORT",
        message: "Password too short",
      },
    });
    const user = userEvent.setup();
    render(<PasswordCard />);

    await fill(user, {
      current: "OldPassw0rd!",
      next: "NewPassw0rd!!",
      confirm: "NewPassw0rd!!",
    });
    await user.click(screen.getByTestId("password-change-submit"));

    expect(await screen.findByTestId("password-change-error")).toBeVisible();
    expect(screen.queryByTestId("change-current-password-error")).toBeNull();
    expect(screen.getByTestId("change-current-password")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("show/hide toggles reveal each field independently", async () => {
    const user = userEvent.setup();
    render(<PasswordCard />);

    const toggles = screen.getAllByTestId(
      /^change-(current|new|confirm)-password-toggle$/,
    );
    expect(toggles).toHaveLength(3);
    const newPasswordToggle = screen.getByTestId("change-new-password-toggle");
    await user.click(newPasswordToggle);

    expect(screen.getByTestId("change-new-password")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByTestId("change-current-password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByTestId("change-new-password-toggle"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("change-confirm-password")).toHaveAttribute(
      "type",
      "password",
    );
    await user.click(newPasswordToggle);
    expect(screen.getByTestId("change-new-password")).toHaveAttribute(
      "type",
      "password",
    );
  });
});
