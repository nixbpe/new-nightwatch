import type { MonitorResponseTimesResponse } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import {
  buildSeries,
  describeEntry,
  rangeStats,
  summarize,
  toChartProps,
} from "./response-time-series";

const common = {
  dataAsOf: "2026-06-30T10:30:00.000Z",
  window: { from: "2026-06-23T11:00:00.000Z", to: "2026-06-30T10:30:00.000Z" },
  unit: "ms" as const,
  pauses: [],
  configChanges: [],
};
function short(
  points: Extract<MonitorResponseTimesResponse, { range: "24h" }>["points"],
): MonitorResponseTimesResponse {
  return {
    ...common,
    window: { from: "2026-06-29T10:30:00.000Z", to: common.dataAsOf },
    range: "24h",
    points,
    gaps: [],
  };
}
function point(
  responseTimeMs: number | null,
  outcome: "pass" | "fail" | "check_error" = "pass",
) {
  return { at: "2026-06-30T10:00:00.000Z", responseTimeMs, outcome };
}

describe("rangeStats", () => {
  it("uses measured results including failures and system errors, counts only target checks", () => {
    expect(
      rangeStats(
        short([
          point(10),
          point(20, "fail"),
          point(30),
          point(40, "check_error"),
          point(null, "fail"),
          point(null, "check_error"),
        ]),
      ),
    ).toEqual({ checks: 4, failed: 2, p50Ms: 20, p95Ms: 40 });
  });
  it.each([
    [[], { checks: 0, failed: 0, p50Ms: null, p95Ms: null }],
    [
      [point(null, "fail"), point(null, "fail")],
      { checks: 2, failed: 2, p50Ms: null, p95Ms: null },
    ],
    [
      [point(null, "check_error")],
      { checks: 0, failed: 0, p50Ms: null, p95Ms: null },
    ],
    [[point(0, "check_error")], { checks: 0, failed: 0, p50Ms: 0, p95Ms: 0 }],
    [
      [point(0), point(10), point(10), point(40)],
      { checks: 4, failed: 0, p50Ms: 10, p95Ms: 40 },
    ],
  ])(
    "handles null, single, zero and duplicate populations %#",
    (points, expected) => {
      expect(rangeStats(short(points))).toEqual(expected);
    },
  );
  it.each(["7d", "30d"] as const)(
    "reads %s exact summary instead of hourly averages/counts",
    (range) => {
      expect(
        rangeStats({
          ...common,
          range,
          summary: { checks: 100, failed: 3, p50Ms: 20, p95Ms: 40 },
          buckets: [
            {
              hourStart: common.window.from,
              checks: 100,
              responseChecks: 100,
              avgMs: 22,
              maxMs: 40,
            },
          ],
        }),
      ).toEqual({ checks: 100, failed: 3, p50Ms: 20, p95Ms: 40 });
    },
  );
});

describe("response window", () => {
  it("uses explicit metadata even with no hourly buckets", () => {
    const props = toChartProps(
      {
        ...common,
        range: "7d",
        summary: { checks: 0, failed: 0, p50Ms: null, p95Ms: null },
        buckets: [],
      },
      { intervalSeconds: 60 },
    );
    expect(props.window).toEqual({
      from: "2026-06-23T11:00:00.000Z",
      to: "2026-06-30T10:30:00.000Z",
    });
  });
  it.each(["2026-06-30T10:30:00.000Z", "2026-06-30T10:00:00.000Z"])(
    "clips current hour at %s, including zero-duration instant",
    (to) => {
      const props = toChartProps(
        {
          ...common,
          dataAsOf: to,
          window: { ...common.window, to },
          range: "7d",
          summary: { checks: 1, failed: 0, p50Ms: 10, p95Ms: 10 },
          buckets: [
            {
              hourStart: "2026-06-30T10:00:00.000Z",
              checks: 1,
              responseChecks: 1,
              avgMs: 10,
              maxMs: 10,
            },
          ],
        },
        { intervalSeconds: 60 },
      );
      expect(props.buckets[0]?.endAt).toBe(to);
    },
  );
  it("keeps measured points outside checked-at bounds in KPI population", () => {
    const response = short([
      { ...point(10), at: "2026-06-30T10:31:00.000Z" },
      { ...point(40, "fail"), at: "2026-06-29T10:29:59.999Z" },
    ]);
    const props = toChartProps(response, { intervalSeconds: 60 });
    expect(props.buckets.map((bucket) => bucket.avgMs)).toEqual([40, 10]);
    expect(rangeStats(response)).toEqual({
      checks: 2,
      failed: 1,
      p50Ms: 10,
      p95Ms: 40,
    });
  });
});

it("preserves hourly average weighting and avg/max wording at the exact-hour boundary", () => {
  const to = "2026-06-30T10:00:00.000Z";
  const series = buildSeries(
    toChartProps(
      {
        ...common,
        dataAsOf: to,
        window: { ...common.window, to },
        range: "7d",
        summary: { checks: 10, failed: 0, p50Ms: 20, p95Ms: 100 },
        buckets: [
          {
            hourStart: "2026-06-30T09:00:00.000Z",
            checks: 1,
            responseChecks: 1,
            avgMs: 20,
            maxMs: 20,
          },
          {
            hourStart: to,
            checks: 9,
            responseChecks: 9,
            avgMs: 100,
            maxMs: 100,
          },
        ],
      },
      { intervalSeconds: 60 },
    ),
  );
  expect(summarize(series)).toEqual({
    averageMs: 92,
    hourlyAverageRange: null,
    maxMs: 100,
    gapCount: 0,
    gapMinutes: 0,
    pauseCount: 0,
  });
  const last = series[1];
  if (last === undefined) throw new Error("missing current-hour bucket");
  expect(describeEntry("7d", last)).toContain(
    "เวลาตอบสนองเฉลี่ย 100 ms สูงสุด 100 ms",
  );
});
