export const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type UptimeRange = "24h" | "7d" | "30d";
const RANGE_MS: Record<UptimeRange, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

export type Interval = { from: Date; to: Date };

export function roundUpToHour(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * The 24 h window reads raw results and starts exactly 24 h ago. The 7 d and
 * 30 d windows read hourly rollups and start at the next hour boundary, so the
 * read never asks for a bucket that purge may already have deleted. Uptime,
 * expected seconds, pauses and buckets all use this one start.
 */
export function windowStart(range: UptimeRange, now: Date): Date {
  const start = new Date(now.getTime() - RANGE_MS[range]);
  return range === "24h" ? start : roundUpToHour(start);
}

/**
 * Pause intervals inside [start, now]. Events older than the retention window
 * are gone, so "paused at the start" is inferred: the first paused/resumed event
 * in the window is `resumed`, or the window holds none and the monitor is paused
 * now.
 */
export function derivePauses(
  events: { kind: "paused" | "resumed"; at: Date }[],
  currentStatus: "active" | "paused",
  start: Date,
  now: Date,
): Interval[] {
  const inWindow = events
    .filter((event) => event.at >= start && event.at <= now)
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  const first = inWindow[0];
  let openSince: Date | null =
    first === undefined
      ? currentStatus === "paused"
        ? start
        : null
      : first.kind === "resumed"
        ? start
        : null;
  const pauses: Interval[] = [];
  for (const event of inWindow) {
    if (event.kind === "paused") {
      openSince ??= event.at;
    } else if (openSince !== null) {
      pauses.push({ from: openSince, to: event.at });
      openSince = null;
    }
  }
  if (openSince !== null) pauses.push({ from: openSince, to: now });
  return pauses;
}

function overlapMs(interval: Interval, from: Date, to: Date): number {
  return Math.max(
    0,
    Math.min(interval.to.getTime(), to.getTime()) -
      Math.max(interval.from.getTime(), from.getTime()),
  );
}

export type UptimeAggregate = {
  /** Results that count: pass and fail, never check_error. */
  checks: number;
  passed: number;
  coveredSeconds: number;
};

export type UptimeWindow = {
  percent: number | null;
  checks: number;
  coveragePercent: number;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

// A failure must never show as 100 %, so a rounded value below 100 stays there.
function percentOf(part: number, whole: number): number {
  if (part >= whole) return 100;
  return Math.min(99.99, round2((part / whole) * 100));
}

/**
 * Uptime and coverage (Jobs, Uptime and coverage). `expected_seconds` runs from
 * max(window start, created_at) to now, less the paused time.
 */
export function computeUptime(
  aggregate: UptimeAggregate,
  window: { start: Date; createdAt: Date; now: Date; pauses: Interval[] },
): UptimeWindow {
  const from =
    window.createdAt > window.start ? window.createdAt : window.start;
  const pausedMs = window.pauses.reduce(
    (sum, pause) => sum + overlapMs(pause, from, window.now),
    0,
  );
  const expectedSeconds =
    (window.now.getTime() - from.getTime() - pausedMs) / 1000;
  return {
    percent:
      aggregate.checks === 0
        ? null
        : percentOf(aggregate.passed, aggregate.checks),
    checks: aggregate.checks,
    coveragePercent:
      expectedSeconds <= 0
        ? 0
        : percentOf(aggregate.coveredSeconds, expectedSeconds),
  };
}

/**
 * Spans between consecutive pass|fail results longer than 2 x the earlier
 * result's interval, less any pause. Only the part outside a pause counts, so
 * a pause followed by the first check after Resume is not a gap.
 */
export function computeGaps(
  results: { at: Date; intervalSeconds: number }[],
  pauses: Interval[],
): Interval[] {
  const gaps: Interval[] = [];
  for (let index = 1; index < results.length; index += 1) {
    const before = results[index - 1];
    const after = results[index];
    if (before === undefined || after === undefined) continue;
    const limitMs = 2 * before.intervalSeconds * 1000;
    let cursor = before.at;
    const pieces: Interval[] = [];
    const inside = pauses
      .filter((pause) => pause.to > before.at && pause.from < after.at)
      .sort((left, right) => left.from.getTime() - right.from.getTime());
    for (const pause of inside) {
      if (pause.from > cursor) pieces.push({ from: cursor, to: pause.from });
      if (pause.to > cursor) cursor = pause.to;
    }
    if (after.at > cursor) pieces.push({ from: cursor, to: after.at });
    for (const piece of pieces) {
      if (piece.to.getTime() - piece.from.getTime() > limitMs) {
        gaps.push(piece);
      }
    }
  }
  return gaps;
}
