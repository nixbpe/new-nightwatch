import type { MonitorResponseTimesResponse } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import { rangeStats } from "./response-time-series";

function point(responseTimeMs: number | null, outcome: string) {
  return { at: "2026-10-02T00:00:00.000Z", responseTimeMs, outcome };
}

describe("rangeStats", () => {
  it("computes p50, p95 and failed from the 24h points", () => {
    const points = Array.from({ length: 20 }, (_, i) =>
      point((i + 1) * 10, "pass"),
    );
    points.push(point(null, "fail"), point(null, "check_error"));
    const stats = rangeStats({
      range: "24h",
      points,
      gaps: [],
      pauses: [],
      configChanges: [],
    } as unknown as MonitorResponseTimesResponse);
    expect(stats).toEqual({ checks: 22, p50Ms: 100, p95Ms: 190, failed: 1 });
  });

  it("sums checks for hourly ranges and leaves the rest unknown", () => {
    const stats = rangeStats({
      range: "7d",
      buckets: [{ checks: 60 }, { checks: 30 }],
      pauses: [],
      configChanges: [],
    } as unknown as MonitorResponseTimesResponse);
    expect(stats).toEqual({
      checks: 90,
      p50Ms: null,
      p95Ms: null,
      failed: null,
    });
  });
});
