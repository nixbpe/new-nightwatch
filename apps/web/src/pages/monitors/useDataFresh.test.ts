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

// A pause leaves the snapshot from before it as `data`, and the query reports `fetching` again as soon as it is online (Codex 4202350103). Until a success lands after the pause the data is not fresh, however short the pause was.
describe("useDataFresh after a pause", () => {
  type Input = Parameters<typeof useDataFresh>[0];
  const setup = (initial: Input = state()) =>
    renderHook(({ input }) => useDataFresh(input), {
      initialProps: { input: initial },
    });
  const moveOn = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it.each([
    ["short (under the age limit)", 5_000],
    ["long (over the age limit)", LIMIT_MS + 30_000],
  ])(
    "keeps a %s pause stale after it resumes until a success lands",
    (_name, pauseMs) => {
      const { result, rerender } = setup();
      const snapshot = Date.now();
      rerender({ input: state({ isPaused: true, dataUpdatedAt: snapshot }) });
      expect(result.current).toBe(false);
      moveOn(pauseMs);
      // Online again: `fetching`, no longer paused, `data` still the snapshot.
      rerender({ input: state({ dataUpdatedAt: snapshot }) });
      expect(result.current).toBe(false);
      moveOn(1_000);
      rerender({ input: state({ dataUpdatedAt: Date.now() }) });
      expect(result.current).toBe(true);
    },
  );

  it("stays stale through a failed fetch and a second pause until the final success", () => {
    const { result, rerender } = setup();
    const snapshot = Date.now();
    rerender({ input: state({ isPaused: true, dataUpdatedAt: snapshot }) });
    moveOn(3_000);
    rerender({ input: state({ dataUpdatedAt: snapshot }) });
    expect(result.current).toBe(false);
    moveOn(3_000);
    rerender({ input: state({ isError: true, dataUpdatedAt: snapshot }) });
    expect(result.current).toBe(false);
    moveOn(3_000);
    rerender({ input: state({ isPaused: true, dataUpdatedAt: snapshot }) });
    expect(result.current).toBe(false);
    moveOn(3_000);
    // Resumed again, retrying: not an error any more, still no success.
    rerender({ input: state({ dataUpdatedAt: snapshot }) });
    expect(result.current).toBe(false);
    moveOn(1_000);
    rerender({ input: state({ dataUpdatedAt: Date.now() }) });
    expect(result.current).toBe(true);
  });

  it("keeps the first pause through several toggles with no success in between", () => {
    const { result, rerender } = setup();
    const snapshot = Date.now();
    for (let toggle = 0; toggle < 3; toggle += 1) {
      rerender({ input: state({ isPaused: true, dataUpdatedAt: snapshot }) });
      expect(result.current).toBe(false);
      moveOn(4_000);
      rerender({ input: state({ dataUpdatedAt: snapshot }) });
      expect(result.current).toBe(false);
      moveOn(4_000);
    }
    // The snapshot itself never clears it, however long the toggling went on.
    expect(result.current).toBe(false);
    // `pausedAt` is the first pause: a success stamped after it, even before the later pauses, clears it.
    rerender({ input: state({ dataUpdatedAt: snapshot + 1_000 }) });
    expect(result.current).toBe(true);
  });

  it("clears on a success from a fetch started before the pause but landing after it began", () => {
    // Intended: `dataUpdatedAt > pausedAt` is the rule, so a response that lands after the pause began counts as data newer than the pause.
    const { result, rerender } = setup();
    const snapshot = Date.now();
    moveOn(2_000);
    rerender({ input: state({ isPaused: true, dataUpdatedAt: snapshot }) });
    expect(result.current).toBe(false);
    moveOn(1_000);
    // The response lands, stamped after the pause began, and the query is no longer paused.
    rerender({ input: state({ dataUpdatedAt: Date.now() }) });
    expect(result.current).toBe(true);
  });

  it("does not flicker while a routine poll is in flight with no pause", () => {
    const { result, rerender } = setup();
    const seen: boolean[] = [];
    for (let poll = 0; poll < 5; poll += 1) {
      moveOn(MONITOR_REFETCH_INTERVAL_MS / 2);
      // The poll is in flight: same data, no pause, no error.
      rerender({
        input: state({
          dataUpdatedAt: Date.now() - MONITOR_REFETCH_INTERVAL_MS / 2,
        }),
      });
      seen.push(result.current);
      moveOn(MONITOR_REFETCH_INTERVAL_MS / 2);
      rerender({ input: state({ dataUpdatedAt: Date.now() }) });
      seen.push(result.current);
    }
    expect(seen.every(Boolean)).toBe(true);
  });

  it("returns to fresh after a failed refetch once new data arrives", () => {
    const { result, rerender } = setup();
    const snapshot = Date.now();
    rerender({ input: state({ isError: true, dataUpdatedAt: snapshot }) });
    expect(result.current).toBe(false);
    moveOn(1_000);
    rerender({ input: state({ dataUpdatedAt: Date.now() }) });
    expect(result.current).toBe(true);
  });

  it("clears its timer and updates nothing when unmounted during a pending resumed fetch", () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { rerender, unmount } = setup();
    const snapshot = Date.now();
    rerender({ input: state({ isPaused: true, dataUpdatedAt: snapshot }) });
    rerender({ input: state({ dataUpdatedAt: snapshot }) });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    moveOn(LIMIT_MS * 2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("forgets the pause on a remount, so freshness falls back to the age rule", () => {
    // Accepted: a remount during a pending resumed fetch loses the pause history.
    const { unmount } = setup(state({ isPaused: true }));
    unmount();
    const { result } = setup(state());
    expect(result.current).toBe(true);
  });
});
