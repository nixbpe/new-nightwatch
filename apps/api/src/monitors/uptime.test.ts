import { describe, expect, it } from "vitest";

import {
  computeGaps,
  computeUptime,
  derivePauses,
  roundUpToHour,
  windowStart,
} from "./uptime";

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = at("2026-06-30T10:30:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("windowStart", () => {
  it("24 h starts exactly 24 h ago", () => {
    expect(windowStart("24h", NOW)).toEqual(ago(DAY));
  });

  it("7 d and 30 d round up to the next hour boundary", () => {
    expect(windowStart("7d", NOW).toISOString()).toBe(
      "2026-06-23T11:00:00.000Z",
    );
    expect(windowStart("30d", NOW).toISOString()).toBe(
      "2026-05-31T11:00:00.000Z",
    );
  });

  it("stays put when the start is already on the hour", () => {
    const onHour = at("2026-06-30T10:00:00.000Z");
    expect(windowStart("7d", onHour).toISOString()).toBe(
      "2026-06-23T10:00:00.000Z",
    );
    expect(roundUpToHour(onHour)).toEqual(onHour);
  });
});

describe("derivePauses (pause fixtures)", () => {
  const start = windowStart("30d", NOW);

  it("paused 40 days ago and still paused: paused for the whole window", () => {
    expect(derivePauses([], "paused", start, NOW)).toEqual([
      { from: start, to: NOW },
    ]);
  });

  it("paused 40 days ago, resumed 10 days ago: paused from the start to the resume", () => {
    const resumed = ago(10 * DAY);
    expect(
      derivePauses(
        [
          { kind: "paused", at: ago(40 * DAY) },
          { kind: "resumed", at: resumed },
        ],
        "active",
        start,
        NOW,
      ),
    ).toEqual([{ from: start, to: resumed }]);
  });

  it("paused 40 days ago, resumed 35 days ago: not paused inside the window", () => {
    expect(
      derivePauses(
        [
          { kind: "paused", at: ago(40 * DAY) },
          { kind: "resumed", at: ago(35 * DAY) },
        ],
        "active",
        start,
        NOW,
      ),
    ).toEqual([]);
  });

  it("pauses that open and close inside the window, and one still open", () => {
    const pauses = derivePauses(
      [
        { kind: "resumed", at: ago(3 * HOUR) },
        { kind: "paused", at: ago(2 * HOUR) },
        { kind: "resumed", at: ago(HOUR) },
        { kind: "paused", at: ago(HOUR / 2) },
      ],
      "paused",
      windowStart("24h", NOW),
      NOW,
    );
    expect(pauses).toEqual([
      { from: ago(DAY), to: ago(3 * HOUR) },
      { from: ago(2 * HOUR), to: ago(HOUR) },
      { from: ago(HOUR / 2), to: NOW },
    ]);
  });

  it("ignores a repeated paused or resumed event", () => {
    expect(
      derivePauses(
        [
          { kind: "paused", at: ago(3 * HOUR) },
          { kind: "paused", at: ago(2 * HOUR) },
          { kind: "resumed", at: ago(HOUR) },
          { kind: "resumed", at: ago(HOUR / 2) },
        ],
        "active",
        windowStart("24h", NOW),
        NOW,
      ),
    ).toEqual([{ from: ago(3 * HOUR), to: ago(HOUR) }]);
  });
});

describe("computeUptime", () => {
  const start = windowStart("30d", NOW);

  it("a monitor aged 2 h with 24 passing 5-minute checks is 100 % covered in a 30-day window", () => {
    expect(
      computeUptime(
        { checks: 24, passed: 24, coveredSeconds: 24 * 300 },
        { start, createdAt: ago(2 * HOUR), now: NOW, pauses: [] },
      ),
    ).toEqual({ percent: 100, checks: 24, coveragePercent: 100 });
  });

  it("a 1 h pause is not expected time", () => {
    // Created 3 h ago, paused for 1 h: expected 2 h = 7,200 s; 18 checks of 300 s cover 5,400 s.
    const pause = { from: ago(2 * HOUR), to: ago(HOUR) };
    expect(
      computeUptime(
        { checks: 18, passed: 18, coveredSeconds: 18 * 300 },
        { start, createdAt: ago(3 * HOUR), now: NOW, pauses: [pause] },
      ),
    ).toEqual({ percent: 100, checks: 18, coveragePercent: 75 });
  });

  it("no results gives a null percent and zero coverage", () => {
    expect(
      computeUptime(
        { checks: 0, passed: 0, coveredSeconds: 0 },
        { start, createdAt: ago(2 * HOUR), now: NOW, pauses: [] },
      ),
    ).toEqual({ percent: null, checks: 0, coveragePercent: 0 });
  });

  it("uses the window start when the monitor is older than the window", () => {
    // 24 h window, 288 checks of 300 s cover exactly 86,400 s.
    expect(
      computeUptime(
        { checks: 288, passed: 287, coveredSeconds: 288 * 300 },
        {
          start: windowStart("24h", NOW),
          createdAt: ago(90 * DAY),
          now: NOW,
          pauses: [],
        },
      ),
    ).toEqual({ percent: 99.65, checks: 288, coveragePercent: 100 });
  });

  it("caps coverage at 100 and never rounds a failure up to 100 %", () => {
    const window = { start, createdAt: ago(90 * DAY), now: NOW, pauses: [] };
    expect(
      computeUptime(
        { checks: 100_000, passed: 99_999, coveredSeconds: 10 ** 9 },
        window,
      ),
    ).toEqual({ percent: 99.99, checks: 100_000, coveragePercent: 100 });
  });

  it("a monitor created just now has zero expected time", () => {
    expect(
      computeUptime(
        { checks: 0, passed: 0, coveredSeconds: 0 },
        { start, createdAt: NOW, now: NOW, pauses: [] },
      ).coveragePercent,
    ).toBe(0);
  });

  it("hand-computed: 2 fails in 3 checks is 33.33 %", () => {
    expect(
      computeUptime(
        { checks: 3, passed: 1, coveredSeconds: 900 },
        { start, createdAt: ago(HOUR), now: NOW, pauses: [] },
      ),
    ).toEqual({ percent: 33.33, checks: 3, coveragePercent: 25 });
  });
});

describe("computeGaps", () => {
  const result = (minutesAgo: number, intervalSeconds = 60) => ({
    at: ago(minutesAgo * 60_000),
    intervalSeconds,
  });

  it("a 10-minute Worker outage on a 1-minute monitor is one gap", () => {
    const gaps = computeGaps(
      [result(30), result(29), result(19), result(18)],
      [],
    );
    expect(gaps).toEqual([{ from: ago(29 * 60_000), to: ago(19 * 60_000) }]);
  });

  it("a span of exactly 2 x interval is not a gap", () => {
    expect(computeGaps([result(10), result(8)], [])).toEqual([]);
  });

  it("a span inside a pause is not a gap, but an outage beside it is", () => {
    const pause = { from: ago(50 * 60_000), to: ago(20 * 60_000) };
    const results = [result(60), result(51), result(19), result(18), result(5)];
    // 60 to 51 is a 9-minute outage before the pause; 51 to 19 less the pause
    // leaves two 1-minute pieces; 18 to 5 is a 13-minute outage.
    expect(computeGaps(results, [pause])).toEqual([
      { from: ago(60 * 60_000), to: ago(51 * 60_000) },
      { from: ago(18 * 60_000), to: ago(5 * 60_000) },
    ]);
  });

  it("uses the interval of the earlier result", () => {
    expect(computeGaps([result(30, 900), result(10, 60)], [])).toEqual([]);
    expect(computeGaps([result(30, 60), result(10, 900)], [])).toHaveLength(1);
  });
});
