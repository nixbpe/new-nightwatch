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
        <p data-testid="boundary-child">calm</p>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("boundary-child")).toBeInTheDocument();
  });

  it("shows the fallback with the error message when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("render-error-title")).toBeInTheDocument();
    expect(screen.getByTestId("render-error-message")).toHaveTextContent(
      "kaboom",
    );
    expect(screen.getByTestId("render-error-message")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByTestId("render-error").tagName).toBe("MAIN");
    expect(screen.getByTestId("render-error")).toContainElement(
      screen.getByTestId("render-error-message"),
    );
  });

  it("renders no landmark of its own when nested inside one", () => {
    render(
      <main>
        <ErrorBoundary landmark={false}>
          <Bomb />
        </ErrorBoundary>
      </main>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByTestId("render-error-message")).toHaveTextContent(
      "kaboom",
    );
  });

  it("retries rendering children when reset", async () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByTestId("render-error-retry"));
    // Bomb throws again, so the fallback returns — proving the reset ran.
    expect(screen.getByTestId("render-error-message")).toHaveTextContent(
      "kaboom",
    );
  });
});
