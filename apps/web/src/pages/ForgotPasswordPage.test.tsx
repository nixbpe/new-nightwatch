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
    // Enumeration-safe: the same confirmation whatever the account state.
    requestPasswordResetMock.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByTestId("forgot-password-email"),
      "member@example.com",
    );
    await user.click(screen.getByTestId("forgot-password-submit"));

    expect(
      await screen.findByTestId("forgot-password-success"),
    ).toBeInTheDocument();
    expect(requestPasswordResetMock).toHaveBeenCalledWith({
      email: "member@example.com",
      redirectTo: "/reset-password",
    });
    expect(screen.queryByTestId("forgot-password-email")).toBeNull();
    expect(screen.getByTestId("forgot-password-login")).toBeInTheDocument();
  });

  it("a failed request keeps the form with a retryable error", async () => {
    // A failure must not swallow the entered email; a retry can succeed.
    requestPasswordResetMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Failed to send email" },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByTestId("forgot-password-email"),
      "member@example.com",
    );
    await user.click(screen.getByTestId("forgot-password-submit"));

    expect(await screen.findByTestId("forgot-password-error")).toBeVisible();
    expect(screen.getByTestId("forgot-password-submit")).toBeEnabled();
    expect(screen.getByTestId("forgot-password-email")).toHaveValue(
      "member@example.com",
    );
    expect(screen.queryByTestId("location")).toBeNull();

    requestPasswordResetMock.mockResolvedValueOnce({ data: {}, error: null });
    await user.click(screen.getByTestId("forgot-password-submit"));

    expect(await screen.findByTestId("forgot-password-success")).toBeVisible();
    expect(screen.queryByTestId("forgot-password-email")).toBeNull();
    expect(requestPasswordResetMock).toHaveBeenCalledTimes(2);
    expect(requestPasswordResetMock).toHaveBeenLastCalledWith({
      email: "member@example.com",
      redirectTo: "/reset-password",
    });
  });

  it("an unexpected failure shows the generic error and keeps the form", async () => {
    requestPasswordResetMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByTestId("forgot-password-email"),
      "member@example.com",
    );
    await user.click(screen.getByTestId("forgot-password-submit"));

    expect(await screen.findByTestId("forgot-password-error")).toBeVisible();
    expect(screen.getByTestId("forgot-password-submit")).toBeEnabled();
    expect(screen.getByTestId("forgot-password-email")).toHaveValue(
      "member@example.com",
    );
  });
});
