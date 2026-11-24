import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  return (
    <div
      data-testid="location"
      data-notice={(location.state as { notice?: string } | null)?.notice}
    >
      {location.pathname}
    </div>
  );
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

  it("reveals each password field on its own toggle", async () => {
    renderAt("/reset-password?token=reset-tok-3");

    const password = screen.getByTestId("reset-password-password");
    const confirm = screen.getByTestId("reset-password-confirm");
    await userEvent.click(screen.getByTestId("reset-password-password-toggle"));
    expect(password).toHaveAttribute("type", "text");
    expect(confirm).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByTestId("reset-password-confirm-toggle"));
    expect(confirm).toHaveAttribute("type", "text");
  });

  it("consumes the emailed token and continues to login on success", async () => {
    resetPasswordMock.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    renderAt("/reset-password?token=reset-tok-1");

    await fillAndSubmit("brand-new-pass-1");

    const location = await screen.findByTestId("location");
    expect(location).toHaveTextContent("/login");
    expect(location).toHaveAttribute("data-notice", "password-reset");
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
    expect(screen.queryByTestId("location")).toBeNull();
    expect(screen.getByTestId("reset-password-password")).toHaveValue(
      "another-pass-22",
    );
    expect(
      screen.getByTestId("reset-password-request-link"),
    ).toBeInTheDocument();
  });

  it("shows a mismatch under the confirm field and does not offer a new link for it", async () => {
    renderAt("/reset-password?token=reset-tok-2");

    await userEvent.type(
      screen.getByTestId("reset-password-password"),
      "first-pass-123",
    );
    // Typing the first field alone raises nothing on the untouched confirm field.
    expect(screen.queryByTestId("reset-password-confirm-error")).toBeNull();
    await userEvent.type(
      screen.getByTestId("reset-password-confirm"),
      "second-pass-456",
    );

    const fieldError = await screen.findByTestId(
      "reset-password-confirm-error",
    );
    expect(screen.getByTestId("reset-password-confirm")).toHaveAttribute(
      "aria-describedby",
      fieldError.id,
    );
    await userEvent.click(screen.getByTestId("reset-password-submit"));
    expect(resetPasswordMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("reset-password-error")).toBeNull();
    expect(screen.queryByTestId("reset-password-request-link")).toBeNull();

    // Editing the first field to match clears the mismatch without touching confirm.
    await userEvent.clear(screen.getByTestId("reset-password-password"));
    await userEvent.type(
      screen.getByTestId("reset-password-password"),
      "second-pass-456",
    );
    await waitFor(() => {
      expect(screen.queryByTestId("reset-password-confirm-error")).toBeNull();
    });
  });

  it("offers a new link only for a dead token, not for other server errors", async () => {
    resetPasswordMock.mockResolvedValue({
      data: null,
      error: { code: "PASSWORD_TOO_SHORT", message: "Too short", status: 400 },
    });
    renderAt("/reset-password?token=live-tok");

    await fillAndSubmit("brand-new-pass-1");

    expect(await screen.findByTestId("reset-password-error")).toBeVisible();
    expect(screen.queryByTestId("reset-password-request-link")).toBeNull();
  });

  it("a link without a token offers a safe path to request a new one", () => {
    renderAt("/reset-password");

    expect(screen.getByTestId("reset-password-invalid-link")).toBeVisible();
    expect(resetPasswordMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("reset-password-request-link"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("reset-password-password")).toBeNull();
    expect(screen.queryByTestId("reset-password-submit")).toBeNull();
  });
});
