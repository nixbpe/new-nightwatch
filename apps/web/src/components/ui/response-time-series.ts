import type { MonitorResponseTimesResponse } from "@nightwatch/api-contract";

import {
  formatDateTime,
  formatNumber,
  formatTime,
} from "../../pages/monitors/format";

export type ChartRange = MonitorResponseTimesResponse["range"];

/** One plotted step: a 24 h check, an hourly bucket, or a gap interval from the API. */
export type ChartBucket = {
  at: string;
  /** Set for an interval (a gap, an hourly bucket); a single check has none. */
  endAt: string | null;
  avgMs: number | null;
  maxMs: number | null;
  /** Checks behind the value; 0 means nothing was recorded. */
  checks: number;
  /** The check could not run on NightWatch's side; it says nothing about the target (AC-39). */
  checkError?: boolean;
  /** Results that had a response time; weights the hourly average. Absent means it cannot be weighted. */
  responseChecks?: number;
};
export type ChartInterval = { from: string; to: string };
export type ChartConfigChange = {
  at: string;
  urlChanged: boolean;
  url?: string;
};

export type ResponseTimeChartProps = {
  range: ChartRange;
  buckets: ChartBucket[];
  pauses: ChartInterval[];
  configChanges: ChartConfigChange[];
  /** The full window the label promises; the x-axis spans it even where nothing was recorded. */
  window?: ChartInterval;
  /** With `window`, a 24 h stretch without results longer than twice this is drawn as no data. */
  intervalSeconds?: number;
};

const HOUR_MS = 3_600_000;
const RANGE_MS: Record<ChartRange, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
};

/** Maps the API's two shapes (24 h points and gaps, 7 d and 30 d hourly buckets) to chart props. */
export function toChartProps(
  response: MonitorResponseTimesResponse,
  context: { dataAsOf: string; intervalSeconds: number },
): ResponseTimeChartProps {
  const { range, pauses, configChanges } = response;
  const end = Date.parse(context.dataAsOf);
  const window = {
    from: new Date(end - RANGE_MS[range]).toISOString(),
    to: context.dataAsOf,
  };
  const { intervalSeconds } = context;
  if (response.range === "24h") {
    const points: ChartBucket[] = response.points.map((point) => ({
      at: point.at,
      endAt: null,
      avgMs: point.responseTimeMs,
      maxMs: point.responseTimeMs,
      checks: 1,
      responseChecks: point.responseTimeMs === null ? 0 : 1,
      checkError: point.outcome === "check_error",
    }));
    const gaps: ChartBucket[] = response.gaps.map((gap) => ({
      at: gap.from,
      endAt: gap.to,
      avgMs: null,
      maxMs: null,
      checks: 0,
    }));
    return {
      range,
      buckets: [...points, ...gaps].sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at),
      ),
      pauses,
      configChanges,
      window,
      intervalSeconds,
    };
  }
  return {
    range,
    buckets: response.buckets.map((bucket) => ({
      at: bucket.hourStart,
      endAt: new Date(Date.parse(bucket.hourStart) + HOUR_MS).toISOString(),
      avgMs: bucket.avgMs,
      maxMs: bucket.maxMs,
      checks: bucket.checks,
      responseChecks: bucket.responseChecks,
    })),
    pauses,
    configChanges,
    window,
    intervalSeconds,
  };
}

export type SeriesKind =
  "value" | "no-response" | "check-error" | "gap" | "pause";

export type SeriesEntry = {
  /** Kind and start time: stable across refetches, unlike an array index. */
  key: string;
  kind: SeriesKind;
  at: number;
  end: number;
  avgMs: number | null;
  maxMs: number | null;
  checks: number;
  /** Results with a response time behind `avgMs`; null when the API did not say. */
  responseChecks: number | null;
  changes: ChartConfigChange[];
};

type Span = { from: number; to: number };

/** A pause counts for an empty hour only when it covers the whole hour. */
function coveredBy(at: number, end: number, spans: readonly Span[]): boolean {
  return spans.some((span) => span.from <= at && span.to >= end);
}

/** The parts of `span` that no blocker covers. */
function subtract(span: Span, blockers: readonly Span[]): Span[] {
  let pieces = [span];
  for (const blocker of blockers) {
    pieces = pieces.flatMap((piece) => {
      if (blocker.to <= piece.from || blocker.from >= piece.to) return [piece];
      const rest: Span[] = [];
      if (blocker.from > piece.from) {
        rest.push({ from: piece.from, to: blocker.from });
      }
      if (blocker.to < piece.to) rest.push({ from: blocker.to, to: piece.to });
      return rest;
    });
  }
  return pieces;
}

function spanEntry(kind: "gap" | "pause", span: Span): SeriesEntry {
  return {
    key: `${kind}:${String(span.from)}`,
    kind,
    at: span.from,
    end: span.to,
    avgMs: null,
    maxMs: null,
    checks: 0,
    responseChecks: null,
    changes: [],
  };
}

/** Adjacent gaps (or pauses) become one step, so a run of empty hours is one band with one label. */
function mergeAdjacent(entries: SeriesEntry[]): SeriesEntry[] {
  const merged: SeriesEntry[] = [];
  for (const entry of entries) {
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      (entry.kind === "gap" || entry.kind === "pause") &&
      previous.kind === entry.kind &&
      entry.at <= previous.end
    ) {
      previous.end = Math.max(previous.end, entry.end);
    } else {
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * The single ordered series that the line, the live text, the summary and the
 * table all read, so they can never disagree. A bucket with no checks is a
 * pause only when a pause covers the whole bucket and a gap otherwise; a check
 * without a time (it failed before any response) is neither, so its text says
 * so. In a 24 h series the window's leading and trailing stretches without
 * results, longer than twice the interval and outside pauses, are gaps too, so
 * a stale monitor shows the gap up to now.
 */
export function buildSeries(props: ResponseTimeChartProps): SeriesEntry[] {
  const pauses: Span[] = props.pauses.map((pause) => ({
    from: Date.parse(pause.from),
    to: Date.parse(pause.to),
  }));
  const entries: SeriesEntry[] = props.buckets.map((bucket) => {
    const at = Date.parse(bucket.at);
    const end = bucket.endAt === null ? at : Date.parse(bucket.endAt);
    let kind: SeriesKind = "value";
    if (bucket.checks === 0) {
      kind = coveredBy(at, end, pauses) ? "pause" : "gap";
    } else if (bucket.checkError === true) {
      kind = "check-error";
    } else if (bucket.avgMs === null) {
      kind = "no-response";
    }
    return {
      key: `${kind}:${String(at)}`,
      kind,
      at,
      end,
      avgMs: bucket.avgMs,
      maxMs: bucket.maxMs,
      checks: bucket.checks,
      responseChecks: bucket.responseChecks ?? null,
      changes: [],
    };
  });
  if (props.range === "24h") {
    // Hourly buckets already stand for the pauses they cover; a 24 h series has none.
    for (const pause of pauses) entries.push(spanEntry("pause", pause));
    if (props.window !== undefined && props.intervalSeconds !== undefined) {
      const window: Span = {
        from: Date.parse(props.window.from),
        to: Date.parse(props.window.to),
      };
      const minimum = props.intervalSeconds * 2 * 1000;
      const blockers = entries
        .filter((entry) => entry.kind === "gap" || entry.kind === "pause")
        .map((entry) => ({ from: entry.at, to: entry.end }));
      const checked = entries.filter((entry) => entry.checks > 0);
      const first = Math.min(...checked.map((entry) => entry.at));
      const last = Math.max(...checked.map((entry) => entry.at));
      const stretches: Span[] =
        checked.length === 0
          ? [window]
          : [
              { from: window.from, to: first },
              { from: last, to: window.to },
            ];
      for (const stretch of stretches) {
        for (const piece of subtract(stretch, blockers)) {
          if (piece.to - piece.from > minimum) {
            entries.push(spanEntry("gap", piece));
          }
        }
      }
    }
  }
  entries.sort((a, b) => a.at - b.at || a.end - b.end);
  const series = mergeAdjacent(entries);
  // A change belongs to the last step that started at or before it.
  for (const change of props.configChanges) {
    const at = Date.parse(change.at);
    let owner = series[0];
    for (const entry of series) {
      if (entry.at <= at) owner = entry;
    }
    owner?.changes.push(change);
  }
  return series;
}

/**
 * True when pauses leave no part of the window uncovered. The window comes from
 * the Detail read and the pauses from a later read, so a sliver at either edge
 * (under twice the interval) does not count as uncovered.
 */
export function pausedThroughout(props: ResponseTimeChartProps): boolean {
  if (props.window === undefined) return false;
  const pauses = props.pauses.map((pause) => ({
    from: Date.parse(pause.from),
    to: Date.parse(pause.to),
  }));
  const tolerance = (props.intervalSeconds ?? 30) * 2 * 1000;
  return subtract(
    { from: Date.parse(props.window.from), to: Date.parse(props.window.to) },
    pauses,
  ).every((piece) => piece.to - piece.from <= tolerance);
}

export function hasChecks(series: readonly SeriesEntry[]): boolean {
  return series.some((entry) => entry.checks > 0);
}

function formatAt(range: ChartRange, at: number): string {
  const iso = new Date(at).toISOString();
  return range === "24h" ? formatTime(iso) : formatDateTime(iso);
}

/** Time or time span of an entry, in the page's time zone; the end drops its date when it is the same day. */
export function entryTime(range: ChartRange, entry: SeriesEntry): string {
  const start = formatAt(range, entry.at);
  if (entry.end <= entry.at) return start;
  const sameDay =
    range !== "24h" &&
    new Date(entry.at).toDateString() === new Date(entry.end).toDateString();
  const end = sameDay
    ? formatTime(new Date(entry.end).toISOString())
    : formatAt(range, entry.end);
  return `${start}–${end}`;
}

function ms(value: number): string {
  return `${formatNumber(Math.round(value))} ms`;
}

/** The text a screen reader hears for the selected step; the readout shows the same. */
export function describeEntry(range: ChartRange, entry: SeriesEntry): string {
  const time = entryTime(range, entry);
  switch (entry.kind) {
    case "pause":
      return `${time} หยุดชั่วคราว`;
    case "gap":
      return `${time} ไม่มีข้อมูล`;
    case "no-response":
      return `${time} ตรวจแล้ว ไม่มีเวลาตอบสนอง`;
    case "check-error":
      return `${time} ตรวจไม่ได้ (ปัญหาฝั่งระบบ)`;
    case "value": {
      const value = entry.avgMs ?? 0;
      return entry.end > entry.at
        ? `${time} เวลาตอบสนองเฉลี่ย ${ms(value)} สูงสุด ${ms(entry.maxMs ?? value)}`
        : `${time} เวลาตอบสนอง ${ms(value)}`;
    }
  }
}

export type SeriesSummary = {
  /** Null when the hourly averages cannot be weighted by their response counts. */
  averageMs: number | null;
  hourlyAverageRange: { min: number; max: number } | null;
  maxMs: number | null;
  gapCount: number;
  gapMinutes: number;
  pauseCount: number;
};

/**
 * The overall average is weighted by results that had a response time. An
 * hourly average without that count cannot be averaged again (a busy hour
 * would count as much as a quiet one), so it is reported as a range instead.
 */
export function summarize(series: readonly SeriesEntry[]): SeriesSummary {
  const values = series.filter(
    (entry) => entry.kind === "value" && entry.avgMs !== null,
  );
  const weightOf = (entry: SeriesEntry) =>
    entry.end > entry.at ? entry.responseChecks : 1;
  const weighted = values.every((entry) => weightOf(entry) !== null);
  let sum = 0;
  let weight = 0;
  let max: number | null = null;
  let lowest: number | null = null;
  let highest: number | null = null;
  for (const entry of values) {
    const average = entry.avgMs ?? 0;
    const w = weightOf(entry) ?? 0;
    sum += average * w;
    weight += w;
    max = Math.max(max ?? 0, entry.maxMs ?? average);
    lowest = Math.min(lowest ?? average, average);
    highest = Math.max(highest ?? average, average);
  }
  let gapCount = 0;
  let gapMs = 0;
  let pauseCount = 0;
  for (const entry of series) {
    if (entry.kind === "gap") {
      gapCount += 1;
      gapMs += entry.end - entry.at;
    }
    if (entry.kind === "pause") pauseCount += 1;
  }
  return {
    averageMs: weighted && weight > 0 ? sum / weight : null,
    hourlyAverageRange:
      !weighted && lowest !== null && highest !== null
        ? { min: lowest, max: highest }
        : null,
    maxMs: max,
    gapCount,
    gapMinutes: Math.round(gapMs / 60_000),
    pauseCount,
  };
}

export function summaryText(summary: SeriesSummary): string {
  const parts: string[] = [];
  if (summary.maxMs !== null) {
    if (summary.averageMs !== null) {
      parts.push(`เฉลี่ย ${ms(summary.averageMs)} สูงสุด ${ms(summary.maxMs)}`);
    } else if (summary.hourlyAverageRange !== null) {
      const { min, max } = summary.hourlyAverageRange;
      parts.push(
        `ค่าเฉลี่ยรายชั่วโมง ${ms(min)} ถึง ${ms(max)} สูงสุด ${ms(summary.maxMs)}`,
      );
    }
  }
  parts.push(
    summary.gapCount === 0
      ? "ไม่มีช่วงไม่มีข้อมูล"
      : `ไม่มีข้อมูล ${String(summary.gapCount)} ช่วง รวม ${formatNumber(summary.gapMinutes)} นาที`,
  );
  if (summary.pauseCount > 0) {
    parts.push(`หยุดชั่วคราว ${String(summary.pauseCount)} ช่วง`);
  }
  return parts.join(" ");
}

/** Hours with only NightWatch-side check errors are absent from the hourly rollup (accepted limitation). */
export const HOURLY_CHECK_ERROR_NOTE =
  "ชั่วโมงที่มีเฉพาะผลตรวจไม่ได้ (ปัญหาฝั่งระบบ) แสดงเป็นไม่มีข้อมูล เพราะไม่อยู่ในสรุปรายชั่วโมง";

export const RANGE_LABELS: Record<ChartRange, string> = {
  "24h": "24 ชม.ล่าสุด",
  "7d": "7 วันล่าสุด",
  "30d": "30 วันล่าสุด",
};
