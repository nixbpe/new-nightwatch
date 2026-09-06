import type { HelloResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, fetchHello } from "../lib/api/client";
import { HelloPage } from "./HelloPage";

vi.mock("../lib/api/client", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchHello: vi.fn() };
});

const fetchHelloMock = vi.mocked(fetchHello);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HelloPage />
    </QueryClientProvider>,
  );
}

describe("HelloPage", () => {
  afterEach(() => {
    fetchHelloMock.mockReset();
  });

  it("shows a loading state while the request is pending", () => {
    const { promise } = Promise.withResolvers<HelloResponse>();
    fetchHelloMock.mockReturnValue(promise);
    renderPage();
    expect(screen.getByText("Loading greeting…")).toBeInTheDocument();
  });

  it("renders the typed greeting and server timestamp on success", async () => {
    fetchHelloMock.mockResolvedValue({
      message: "Hello from NightWatch",
      timestamp: "2026-09-06T12:00:00.000Z",
    });
    renderPage();
    expect(
      await screen.findByText("Hello from NightWatch"),
    ).toBeInTheDocument();
    expect(screen.getByRole("time")).toHaveAttribute(
      "dateTime",
      "2026-09-06T12:00:00.000Z",
    );
  });

  it("renders an alert with the error message on failure", async () => {
    fetchHelloMock.mockRejectedValue(
      new ApiError("INTERNAL_ERROR", "Internal server error", 500),
    );
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the greeting.");
    expect(alert).toHaveTextContent("Internal server error");
  });
});
