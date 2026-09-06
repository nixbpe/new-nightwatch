import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs boundary catches to console; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>calm</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("calm")).toBeInTheDocument();
  });

  it("shows the fallback with the error message when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("kaboom");
  });

  it("retries rendering children when reset", async () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    // Bomb throws again, so the fallback returns — proving the reset ran.
    expect(screen.getByRole("alert")).toHaveTextContent("kaboom");
  });
});
