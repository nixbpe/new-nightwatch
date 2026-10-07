import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MONITOR_REFETCH_INTERVAL_MS } from "../../lib/api/monitors";
import { useDataFresh } from "./useDataFresh";

// Every timer is faked here, so the limit is crossed by moving the clock: the poll interval is the real one.
const LIMIT_MS = 2 * MONITOR_REFETCH_INTERVAL_MS;
const START = Date.parse("2026-09-30T08:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

const state = (
  overrides: Partial<Parameters<typeof useDataFresh>[0]> = {},
) => ({
  isError: false,
  isPaused: false,
  dataUpdatedAt: Date.now(),
  ...overrides,
});

describe("useDataFresh", () => {
  it("is fresh up to the limit and turns stale when the timer fires just after it", () => {
    const { result } = renderHook(() =>
      useDataFresh(state({ dataUpdatedAt: START })),
    );
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(LIMIT_MS);
    });
    // Exactly at the limit the data is still fresh.
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });

  it("starts the timer over when the data updates, and stays stale until it does", () => {
    const { result, rerender } = renderHook(
      ({ updatedAt }) => useDataFresh(state({ dataUpdatedAt: updatedAt })),
      { initialProps: { updatedAt: START } },
    );
    act(() => {
      vi.advanceTimersByTime(LIMIT_MS - 10_000);
    });
    rerender({ updatedAt: Date.now() });
    act(() => {
      vi.advanceTimersByTime(LIMIT_MS - 10_000);
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current).toBe(false);
    rerender({ updatedAt: Date.now() });
    expect(result.current).toBe(true);
  });

  it("is stale at once for data older than the limit and schedules no timer", () => {
    const { result } = renderHook(() =>
      useDataFresh(state({ dataUpdatedAt: START - LIMIT_MS - 1 })),
    );
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["the last refresh failed", { isError: true }],
    ["the query is paused", { isPaused: true }],
  ])("is never fresh when %s, even for new data", (_name, overrides) => {
    const { result } = renderHook(() => useDataFresh(state(overrides)));
    expect(result.current).toBe(false);
  });

  it("clears its timer on unmount", () => {
    const { unmount } = renderHook(() => useDataFresh(state()));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
