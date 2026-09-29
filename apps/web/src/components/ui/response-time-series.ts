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
};

const HOUR_MS = 3_600_000;

/** Maps the API's two shapes (24 h points and gaps, 7 d and 30 d hourly buckets) to chart props. */
export function toChartProps(
  response: MonitorResponseTimesResponse,
): ResponseTimeChartProps {
  const { range, pauses, configChanges } = response;
  if (response.range === "24h") {
    const points: ChartBucket[] = response.points.map((point) => ({
      at: point.at,
      endAt: null,
      avgMs: point.responseTimeMs,
      maxMs: point.responseTimeMs,
      checks: 1,
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
    })),
    pauses,
    configChanges,
  };
}

export type SeriesKind = "value" | "no-response" | "gap" | "pause";

export type SeriesEntry = {
  /** Kind and start time: stable across refetches, unlike an array index. */
  key: string;
  kind: SeriesKind;
  at: number;
  end: number;
  avgMs: number | null;
  maxMs: number | null;
  checks: number;
  changes: ChartConfigChange[];
};

function overlapsPause(
  at: number,
  end: number,
  pauses: readonly { from: number; to: number }[],
): boolean {
  return pauses.some((pause) => at < pause.to && end > pause.from);
}

/**
 * The single ordered series that the line, the live text, the summary and the
 * table all read, so they can never disagree. A bucket with no checks is a
 * pause when a pause covers it and a gap otherwise; a check without a time
 * (it failed before any response) is neither, so its text says so.
 */
export function buildSeries(props: ResponseTimeChartProps): SeriesEntry[] {
  const pauses = props.pauses.map((pause) => ({
    from: Date.parse(pause.from),
    to: Date.parse(pause.to),
  }));
  const entries: SeriesEntry[] = props.buckets.map((bucket) => {
    const at = Date.parse(bucket.at);
    const end = bucket.endAt === null ? at : Date.parse(bucket.endAt);
    let kind: SeriesKind = "value";
    if (bucket.checks === 0) {
      kind = overlapsPause(at, end, pauses) ? "pause" : "gap";
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
      changes: [],
    };
  });
  // Hourly buckets already stand for the pauses they cover; a 24 h series has none to stand for them.
  if (props.range === "24h") {
    for (const pause of pauses) {
      entries.push({
        key: `pause:${String(pause.from)}`,
        kind: "pause",
        at: pause.from,
        end: pause.to,
        avgMs: null,
        maxMs: null,
        checks: 0,
        changes: [],
      });
    }
  }
  entries.sort((a, b) => a.at - b.at || a.end - b.end);
  // A change belongs to the last step that started at or before it.
  for (const change of props.configChanges) {
    const at = Date.parse(change.at);
    let owner = entries[0];
    for (const entry of entries) {
      if (entry.at <= at) owner = entry;
    }
    owner?.changes.push(change);
  }
  return entries;
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
    case "value": {
      const value = entry.avgMs ?? 0;
      return entry.end > entry.at
        ? `${time} เวลาตอบสนองเฉลี่ย ${ms(value)} สูงสุด ${ms(entry.maxMs ?? value)}`
        : `${time} เวลาตอบสนอง ${ms(value)}`;
    }
  }
}

export type SeriesSummary = {
  averageMs: number | null;
  maxMs: number | null;
  gapCount: number;
  gapMinutes: number;
  pauseCount: number;
};

/** Adjacent hourly gaps (or pauses) are one; the total is the recorded span of no data. */
export function summarize(series: readonly SeriesEntry[]): SeriesSummary {
  let weighted = 0;
  let weight = 0;
  let max: number | null = null;
  let gapCount = 0;
  let gapMs = 0;
  let pauseCount = 0;
  let previous: SeriesEntry | undefined;
  for (const entry of series) {
    if (entry.kind === "value" && entry.avgMs !== null) {
      weighted += entry.avgMs * entry.checks;
      weight += entry.checks;
      const top = entry.maxMs ?? entry.avgMs;
      max = max === null ? top : Math.max(max, top);
    }
    if (entry.kind === "gap") {
      gapMs += entry.end - entry.at;
      if (previous?.kind !== "gap" || previous.end !== entry.at) gapCount += 1;
    }
    if (entry.kind === "pause") {
      if (previous?.kind !== "pause" || previous.end !== entry.at) {
        pauseCount += 1;
      }
    }
    previous = entry;
  }
  return {
    averageMs: weight === 0 ? null : weighted / weight,
    maxMs: max,
    gapCount,
    gapMinutes: Math.round(gapMs / 60_000),
    pauseCount,
  };
}

export function summaryText(summary: SeriesSummary): string {
  const parts: string[] = [];
  if (summary.averageMs !== null && summary.maxMs !== null) {
    parts.push(`เฉลี่ย ${ms(summary.averageMs)} สูงสุด ${ms(summary.maxMs)}`);
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

export const RANGE_LABELS: Record<ChartRange, string> = {
  "24h": "24 ชม.ล่าสุด",
  "7d": "7 วันล่าสุด",
  "30d": "30 วันล่าสุด",
};
