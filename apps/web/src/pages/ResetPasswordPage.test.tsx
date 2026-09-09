import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResetPasswordPage } from "./ResetPasswordPage";

const { resetPasswordMock } = vi.hoisted(() => ({
  resetPasswordMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false }),
    resetPassword: resetPasswordMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(entry: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(password: string) {
  await userEvent.type(
    screen.getByLabelText("รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"),
    password,
  );
  await userEvent.type(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), password);
  await userEvent.click(
    screen.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" }),
  );
}

describe("ResetPasswordPage", () => {
  afterEach(() => {
    resetPasswordMock.mockReset();
  });

  it("consumes the emailed token and continues to login on success", async () => {
    resetPasswordMock.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    renderAt("/reset-password?token=reset-tok-1");

    await fillAndSubmit("brand-new-pass-1");

    // Observable continuation: a consumed token routes back to login.
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("refuses an expired or replayed token and keeps the form intact", async () => {
    resetPasswordMock.mockResolvedValue({
      data: null,
      error: { message: "โทเค็นไม่ถูกต้องหรือหมดอายุแล้ว" },
    });
    renderAt("/reset-password?token=spent-tok");

    await fillAndSubmit("another-pass-22");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โทเค็นไม่ถูกต้องหรือหมดอายุแล้ว");
    // Retry-safe: still on the page, inputs preserved, request-new-link shown.
    expect(screen.queryByTestId("location")).toBeNull();
    expect(
      screen.getByLabelText("รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"),
    ).toHaveValue("another-pass-22");
    expect(
      screen.getByRole("link", { name: "ขอลิงก์ใหม่" }),
    ).toBeInTheDocument();
  });

  it("a link without a token offers a safe path to request a new one", () => {
    renderAt("/reset-password");

    // Safe state: an error alert with the recovery action and no password
    // form to submit against a missing token.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ขอลิงก์ใหม่" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "บันทึกรหัสผ่านใหม่" }),
    ).toBeNull();
  });
});
