import { useEffect, useReducer, useState } from "react";

import { MONITOR_REFETCH_INTERVAL_MS } from "../../lib/api/monitors";

/**
 * Whether polled data still counts as fresh (CMP-01, Motion principle). All of:
 * the last refresh did not fail, the query is not paused offline, no pause is
 * waiting for a success after it, and the data was updated within two poll
 * intervals.
 *
 * A pause leaves the snapshot from before it as `data`, and the query reports
 * `fetching` again as soon as it is online, so `isPaused` alone is not enough.
 * The first pause seen is kept as `pausedAt`, whatever its length; a later
 * pause, a failed fetch or a retry does not move it. It clears only when
 * `dataUpdatedAt` passes it, that is when a success landed after the pause
 * began (a response from a fetch started before the pause counts, as it is
 * data newer than the pause). The age limit covers a fetch that hangs or
 * retries with no pause, and a page opened from a cached snapshot; one timer
 * re-evaluates at the moment the data reaches the limit, is replaced when the
 * data updates and is cleared on unmount.
 */
export function useDataFresh({
  isError,
  isPaused,
  dataUpdatedAt,
}: {
  isError: boolean;
  isPaused: boolean;
  dataUpdatedAt: number;
}): boolean {
  const maxAgeMs = 2 * MONITOR_REFETCH_INTERVAL_MS;
  // State set while rendering, as `useOrganizationSwitched` does, so a flag never shows for a frame behind its cause.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  if (pausedAt === null && isPaused) {
    setPausedAt(Date.now());
  } else if (pausedAt !== null && dataUpdatedAt > pausedAt) {
    setPausedAt(null);
  }
  // A re-run after the timer fires checks the limit again, so an early timer does not leave the data fresh.
  const [rechecks, recheck] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const remaining = dataUpdatedAt + maxAgeMs - Date.now();
    if (remaining < 0) return;
    const timer = setTimeout(recheck, remaining + 1);
    return () => {
      clearTimeout(timer);
    };
  }, [dataUpdatedAt, maxAgeMs, rechecks]);
  return (
    !isError &&
    !isPaused &&
    pausedAt === null &&
    Date.now() - dataUpdatedAt <= maxAgeMs
  );
}
