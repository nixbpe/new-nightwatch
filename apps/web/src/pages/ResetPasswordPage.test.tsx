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
  await userEvent.type(screen.getByTestId("reset-password-password"), password);
  await userEvent.type(screen.getByTestId("reset-password-confirm"), password);
  await userEvent.click(screen.getByTestId("reset-password-submit"));
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

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(resetPasswordMock).toHaveBeenCalledWith({
      newPassword: "brand-new-pass-1",
      token: "reset-tok-1",
    });
  });

  it("refuses an expired or replayed token and keeps the form intact", async () => {
    resetPasswordMock.mockResolvedValue({
      data: null,
      error: { code: "INVALID_TOKEN", message: "Invalid token" },
    });
    renderAt("/reset-password?token=spent-tok");

    await fillAndSubmit("another-pass-22");

    const alert = await screen.findByTestId("reset-password-error");
    expect(alert).toBeVisible();
    expect(resetPasswordMock).toHaveBeenCalledWith({
      newPassword: "another-pass-22",
      token: "spent-tok",
    });
    expect(screen.getByTestId("reset-password-submit")).toBeEnabled();
    // Retry-safe: still on the page, inputs preserved, request-new-link shown.
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByTestId("reset-password-password")).toHaveValue(
      "another-pass-22",
    );
    expect(
      screen.getByTestId("reset-password-request-link"),
    ).toBeInTheDocument();
  });

  it("a link without a token offers a safe path to request a new one", () => {
    renderAt("/reset-password");

    // No password form to submit against a missing token.
    expect(screen.getByTestId("reset-password-invalid-link")).toBeVisible();
    expect(resetPasswordMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("reset-password-request-link"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("reset-password-password")).toBeNull();
    expect(screen.queryByTestId("reset-password-submit")).toBeNull();
  });
});
