import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordPage } from "./ForgotPasswordPage";

const { sessionState, requestPasswordResetMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: Record<string, unknown> } | null,
    isPending: false,
  },
  requestPasswordResetMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    requestPasswordReset: requestPasswordResetMock,
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ForgotPasswordPage", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionState.isPending = false;
    requestPasswordResetMock.mockReset();
  });

  it("a submitted email is answered with the generic confirmation", async () => {
    // Enumeration-safe: the same confirmation whatever the account state,
    // and the form is replaced by it.
    requestPasswordResetMock.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("อีเมล"), "member@example.com");
    await user.click(
      screen.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }),
    );

    expect(
      await screen.findByText(
        /หากอีเมลนี้มีบัญชีในระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้โดยเร็ว/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("อีเมล")).toBeNull();
    expect(
      screen.getByRole("link", { name: "กลับไปเข้าสู่ระบบ" }),
    ).toBeInTheDocument();
  });

  it("a failed request keeps the form with a retryable error", async () => {
    // Transport/server failure must not swallow the entered email nor
    // strand the user: the error shows and a retry can succeed.
    requestPasswordResetMock.mockResolvedValueOnce({
      data: null,
      error: { message: "ส่งอีเมลไม่สำเร็จ" },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("อีเมล"), "member@example.com");
    await user.click(
      screen.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ส่งอีเมลไม่สำเร็จ",
    );
    expect(screen.getByLabelText("อีเมล")).toHaveValue("member@example.com");
    expect(screen.queryByTestId("location")).toBeNull();

    requestPasswordResetMock.mockResolvedValueOnce({ data: {}, error: null });
    await user.click(
      screen.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }),
    );

    expect(
      await screen.findByText(/หากอีเมลนี้มีบัญชีในระบบ/),
    ).toBeInTheDocument();
  });

  it("an unexpected failure shows the generic error and keeps the form", async () => {
    requestPasswordResetMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("อีเมล"), "member@example.com");
    await user.click(
      screen.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
    );
    expect(screen.getByLabelText("อีเมล")).toHaveValue("member@example.com");
  });
});
