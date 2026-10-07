import { useEffect, useReducer } from "react";

import { MONITOR_REFETCH_INTERVAL_MS } from "../../lib/api/monitors";

/**
 * Whether polled data still counts as fresh (CMP-01, Motion principle): the
 * last refresh did not fail, the query is not paused offline, and the data
 * was updated within two poll intervals. The age check covers a query that
 * resumes from a pause or retries while `data` is still the older snapshot,
 * and a page opened from a cached snapshot. One timer re-evaluates at the
 * moment the data reaches the limit; it is replaced when the data updates and
 * cleared on unmount.
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
  return !isError && !isPaused && Date.now() - dataUpdatedAt <= maxAgeMs;
}
