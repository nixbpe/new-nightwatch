import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { formatTime } from "../../pages/monitors/format";
import { ResponseTimeChart } from "./response-time-chart";
import {
  buildSeries,
  chartWindow,
  describeEntry,
  pausedThroughout,
  summarize,
  summaryText,
  toChartProps,
  type ResponseTimeChartProps,
} from "./response-time-series";

const T = (time: string) => `2026-09-30T${time}:00.000Z`;

function point(time: string, ms: number | null) {
  return { at: T(time), endAt: null, avgMs: ms, maxMs: ms, checks: 1 };
}

/** Three checks, a gap, a pause, then one more check: six selectable steps. */
function props24h(overrides: Partial<ResponseTimeChartProps> = {}) {
  return {
    range: "24h",
    buckets: [
      point("07:00", 182),
      point("07:05", 190),
      point("07:10", 1204),
      {
        at: T("07:12"),
        endAt: T("07:25"),
        avgMs: null,
        maxMs: null,
        checks: 0,
      },
      point("07:45", 200),
    ],
    pauses: [{ from: T("07:25"), to: T("07:40") }],
    configChanges: [],
    ...overrides,
  } satisfies ResponseTimeChartProps;
}

const liveRegion = () => {
  const region = document.querySelector('[aria-live="polite"]');
  if (region === null) throw new Error("no live region");
  return region;
};

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("series", () => {
  it("orders checks, gaps and pauses into one series of steps", () => {
    const series = buildSeries(props24h());
    expect(series.map((entry) => entry.kind)).toEqual([
      "value",
      "value",
      "value",
      "gap",
      "pause",
      "value",
    ]);
  });

  it("words a normal step, a gap, a pause and a check that had no response time", () => {
    const series = buildSeries(
      props24h({
        buckets: [...props24h().buckets, point("07:50", null)],
      }),
    );
    const texts = series.map((entry) => describeEntry("24h", entry));
    expect(texts[0]).toBe(`${formatTime(T("07:00"))} เวลาตอบสนอง 182 ms`);
    expect(texts[3]).toContain("ไม่มีข้อมูล");
    expect(texts[4]).toContain("หยุดชั่วคราว");
    expect(texts[6]).toContain("ตรวจแล้ว ไม่มีเวลาตอบสนอง");
  });

  it("words a check NightWatch could not run as 'ตรวจไม่ได้', apart from a check without a time", () => {
    const { buckets } = toChartProps(
      {
        range: "24h",
        unit: "ms",
        points: [
          { at: T("07:00"), responseTimeMs: null, outcome: "check_error" },
          { at: T("07:05"), responseTimeMs: null, outcome: "fail" },
        ],
        gaps: [],
        pauses: [],
        configChanges: [],
      },
      { dataAsOf: T("08:00"), intervalSeconds: 300 },
    );
    const series = buildSeries({
      range: "24h",
      buckets,
      pauses: [],
      configChanges: [],
    });
    expect(series.map((entry) => entry.kind)).toEqual([
      "check-error",
      "no-response",
    ]);
    const [first] = series;
    if (first === undefined) throw new Error("no entry");
    expect(describeEntry("24h", first)).toContain("ตรวจไม่ได้ (ปัญหาฝั่งระบบ)");
  });

  it("summarizes average, maximum and gaps with adjacent hourly gaps as one", () => {
    const hour = (start: string, avg: number | null, checks: number) => ({
      at: T(start),
      endAt: T(
        start.replace(/^\d\d/, (h) => String(Number(h) + 1).padStart(2, "0")),
      ),
      avgMs: avg,
      maxMs: avg === null ? null : avg * 2,
      checks,
      responseChecks: checks,
    });
    const series = buildSeries({
      range: "7d",
      buckets: [
        hour("01:00", 100, 12),
        hour("02:00", null, 0),
        hour("03:00", null, 0),
        hour("04:00", 300, 12),
        hour("05:00", null, 0),
      ],
      pauses: [],
      configChanges: [],
    });
    const summary = summarize(series);
    expect(summary).toMatchObject({
      averageMs: 200,
      maxMs: 600,
      gapCount: 2,
      gapMinutes: 180,
    });
    expect(summaryText(summary)).toBe(
      "เฉลี่ย 200 ms สูงสุด 600 ms ไม่มีข้อมูล 2 ช่วง รวม 180 นาที",
    );
  });

  it("counts a pause that spans several empty hours once", () => {
    const empty = (from: string, to: string) => ({
      at: T(from),
      endAt: T(to),
      avgMs: null,
      maxMs: null,
      checks: 0,
    });
    const series = buildSeries({
      range: "7d",
      buckets: [
        empty("02:00", "03:00"),
        empty("03:00", "04:00"),
        empty("04:00", "05:00"),
      ],
      pauses: [{ from: T("01:30"), to: T("05:00") }],
      configChanges: [],
    });
    expect(summarize(series)).toMatchObject({ pauseCount: 1, gapCount: 0 });
  });

  it("reads an empty hour inside a pause as a pause, not a gap", () => {
    const series = buildSeries({
      range: "7d",
      buckets: [
        {
          at: T("02:00"),
          endAt: T("03:00"),
          avgMs: null,
          maxMs: null,
          checks: 0,
        },
      ],
      pauses: [{ from: T("01:30"), to: T("04:00") }],
      configChanges: [],
    });
    expect(series.map((entry) => entry.kind)).toEqual(["pause"]);
  });
});

const empty = (from: string, to: string) => ({
  at: T(from),
  endAt: T(to),
  avgMs: null,
  maxMs: null,
  checks: 0,
});

describe("series gaps, pauses and averages", () => {
  it("merges adjacent empty hours into one step so its label can show", () => {
    const props = {
      range: "7d",
      buckets: [
        empty("01:00", "02:00"),
        empty("02:00", "03:00"),
        empty("03:00", "04:00"),
        { ...empty("04:00", "05:00"), avgMs: 100, maxMs: 100, checks: 12 },
      ],
      pauses: [],
      configChanges: [],
    } satisfies ResponseTimeChartProps;
    const series = buildSeries(props);
    expect(series.map((entry) => [entry.kind, entry.end - entry.at])).toEqual([
      ["gap", 3 * 3_600_000],
      ["value", 3_600_000],
    ]);
    const { container } = render(<ResponseTimeChart {...props} />);
    expect(container.querySelectorAll('[data-chart-part="gap"]')).toHaveLength(
      1,
    );
    expect(container.querySelector("svg")).toHaveTextContent("ไม่มีข้อมูล");
  });

  it("reads an empty hour as a pause only when a pause covers the whole hour", () => {
    const kinds = (pauseFrom: string) =>
      buildSeries({
        range: "7d",
        buckets: [empty("10:00", "11:00")],
        pauses: [{ from: T(pauseFrom), to: T("12:00") }],
        configChanges: [],
      }).map((entry) => entry.kind);
    expect(kinds("10:55")).toEqual(["gap"]);
    expect(kinds("09:30")).toEqual(["pause"]);
    expect(kinds("10:00")).toEqual(["pause"]);
  });

  it("marks a check without a response time and a system-side check error, with legend entries", () => {
    const { container } = render(
      <ResponseTimeChart
        {...props24h({
          buckets: [
            point("07:00", 182),
            { ...point("07:05", null) },
            { ...point("07:10", null), checkError: true },
          ],
          pauses: [],
        })}
      />,
    );
    expect(
      container.querySelectorAll('[data-chart-part="no-response"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-chart-part="check-error"]'),
    ).toHaveLength(1);
    expect(screen.getByText(/× ตรวจแล้ว ไม่มีเวลาตอบสนอง/)).toBeInTheDocument();
    expect(screen.getByText(/○ ตรวจไม่ได้/)).toBeInTheDocument();
  });

  it("weights the overall average by responseChecks, not by checks", () => {
    const hour = (start: string, end: string, avg: number, rc: number) => ({
      at: T(start),
      endAt: T(end),
      avgMs: avg,
      maxMs: avg,
      checks: 12,
      responseChecks: rc,
    });
    const summary = summarize(
      buildSeries({
        range: "7d",
        // Both hours ran 12 checks, but only 2 of the first had a response time.
        buckets: [
          hour("01:00", "02:00", 1000, 2),
          hour("02:00", "03:00", 100, 10),
        ],
        pauses: [],
        configChanges: [],
      }),
    );
    expect(summary.averageMs).toBeCloseTo((1000 * 2 + 100 * 10) / 12, 5);
  });

  it("shows the range of hourly averages, not an overall average, when the count is absent", () => {
    const summary = summarize(
      buildSeries({
        range: "7d",
        buckets: [
          { ...empty("01:00", "02:00"), avgMs: 100, maxMs: 150, checks: 12 },
          { ...empty("02:00", "03:00"), avgMs: 300, maxMs: 500, checks: 1 },
        ],
        pauses: [],
        configChanges: [],
      }),
    );
    expect(summary.averageMs).toBeNull();
    expect(summaryText(summary)).toContain(
      "ค่าเฉลี่ยรายชั่วโมง 100 ms ถึง 300 ms สูงสุด 500 ms",
    );
    expect(summaryText(summary)).not.toContain("เฉลี่ย 200");
  });

  it("says in the legend that hours with only system-side errors read as no data, for 7 d and 30 d only", () => {
    const note = /ชั่วโมงที่มีเฉพาะผลตรวจไม่ได้/;
    const { unmount } = render(<ResponseTimeChart {...props24h()} />);
    expect(screen.queryByText(note)).toBeNull();
    unmount();
    render(
      <ResponseTimeChart
        {...props24h({ range: "7d", buckets: [empty("01:00", "02:00")] })}
      />,
    );
    expect(screen.getByText(note)).toBeInTheDocument();
  });
});

describe("24 h window", () => {
  const window = { from: T("00:00"), to: T("12:00") };
  const base = {
    range: "24h",
    pauses: [],
    configChanges: [],
    window,
    intervalSeconds: 300,
  } satisfies Partial<ResponseTimeChartProps>;

  it("draws the stretch from the last result to now as no data for a stale monitor", () => {
    const series = buildSeries({
      ...base,
      buckets: [point("00:05", 100), point("07:00", 120)],
    });
    expect(series.map((entry) => entry.kind)).toEqual([
      "value",
      "value",
      "gap",
    ]);
    const trailing = series[2];
    expect(trailing?.end).toBe(Date.parse(window.to));
    expect(trailing && describeEntry("24h", trailing)).toContain("ไม่มีข้อมูล");
    const { container } = render(
      <ResponseTimeChart
        {...base}
        buckets={[point("00:05", 100), point("07:00", 120)]}
      />,
    );
    expect(container.querySelectorAll('[data-chart-part="gap"]')).toHaveLength(
      1,
    );
  });

  it("draws a leading stretch and ignores stretches within twice the interval or inside a pause", () => {
    const kinds = (first: string, pauses: ResponseTimeChartProps["pauses"]) =>
      buildSeries({
        ...base,
        pauses,
        buckets: [point(first, 100), point("11:55", 100)],
      }).map((entry) => entry.kind);
    expect(kinds("03:00", [])).toEqual(["gap", "value", "value"]);
    // 8 minutes is under 2 x 5 minutes: no gap.
    expect(kinds("00:08", [])).toEqual(["value", "value"]);
    // The leading hours are a pause, so they are not also a gap.
    expect(kinds("03:00", [{ from: T("00:00"), to: T("03:00") }])).toEqual([
      "pause",
      "value",
      "value",
    ]);
  });

  it("treats a window with no results at all as one gap, and a fully paused one as a pause", () => {
    expect(
      buildSeries({ ...base, buckets: [] }).map((entry) => entry.kind),
    ).toEqual(["gap"]);
    expect(
      buildSeries({
        ...base,
        buckets: [],
        pauses: [window],
      }).map((entry) => entry.kind),
    ).toEqual(["pause"]);
    expect(pausedThroughout({ ...base, buckets: [], pauses: [window] })).toBe(
      true,
    );
    expect(pausedThroughout({ ...base, buckets: [], pauses: [] })).toBe(false);
    // The pauses come from a later read: a sliver at the window's edge is still "throughout".
    expect(
      pausedThroughout({
        ...base,
        buckets: [],
        pauses: [{ from: T("00:02"), to: window.to }],
      }),
    ).toBe(true);
    expect(
      pausedThroughout({
        ...base,
        buckets: [],
        pauses: [{ from: T("02:00"), to: window.to }],
      }),
    ).toBe(false);
  });
});

describe("7 d and 30 d as the API shapes them", () => {
  const HOUR = 3_600_000;
  const dataAsOf = "2026-09-30T07:32:05.000Z";
  const asOf = Date.parse(dataAsOf);
  // The hourly read starts at the next whole hour after now minus 7 d and runs to the current hour.
  const start = Math.ceil((asOf - 7 * 24 * HOUR) / HOUR) * HOUR;
  const hours = Array.from(
    { length: Math.ceil((asOf - start) / HOUR) },
    (_, index) => start + index * HOUR,
  );
  const response = (
    overrides: Partial<{ pauses: { from: string; to: string }[] }> = {},
  ) => ({
    range: "7d" as const,
    unit: "ms" as const,
    buckets: hours.map((hour) => ({
      hourStart: new Date(hour).toISOString(),
      avgMs: null,
      maxMs: null,
      checks: 0,
      responseChecks: 0,
    })),
    pauses: [],
    configChanges: [],
    ...overrides,
  });
  const context = { dataAsOf, intervalSeconds: 900 };

  it("reads a monitor paused for the whole window as one pause, with the current hour inside it", () => {
    // The pause started before the window and is still going: it ends at the read time.
    const props = toChartProps(
      response({
        pauses: [
          {
            from: new Date(start - 5 * HOUR).toISOString(),
            to: new Date(asOf + 3000).toISOString(),
          },
        ],
      }),
      context,
    );
    expect(pausedThroughout(props)).toBe(true);
    const series = buildSeries(props);
    expect(series.map((entry) => entry.kind)).toEqual(["pause"]);
    expect(series[0]?.end).toBe(asOf);
    expect(summarize(series)).toMatchObject({ gapCount: 0, pauseCount: 1 });
  });

  it("measures the window from the API's rounded start, not from now minus the range", () => {
    const props = toChartProps(response(), context);
    expect(props.window?.from).toBe(new Date(start).toISOString());
    expect(Date.parse(props.window?.from ?? "")).toBeGreaterThan(
      asOf - 7 * 24 * HOUR,
    );
  });

  it("does not call a partly paused window paused throughout", () => {
    const props = toChartProps(
      response({
        pauses: [
          {
            from: new Date(asOf - 3 * HOUR).toISOString(),
            to: new Date(asOf).toISOString(),
          },
        ],
      }),
      context,
    );
    expect(pausedThroughout(props)).toBe(false);
  });

  it("starts at creation: earlier hours are not drawn or counted as no data", () => {
    const createdAt = new Date(asOf - 2.5 * HOUR).toISOString();
    const props = toChartProps(response(), { ...context, createdAt });
    const series = buildSeries(props);
    // Three hours touch the monitor's life; the first counts from creation, the last ends at now.
    expect(series.map((entry) => entry.kind)).toEqual(["gap"]);
    expect(series[0]?.at).toBe(Date.parse(createdAt));
    expect(series[0]?.end).toBe(asOf);
    expect(chartWindow(props)?.from).toBe(Date.parse(createdAt));
    const full = buildSeries(toChartProps(response(), context));
    expect(summarize(full).gapMinutes).toBeGreaterThan(
      summarize(series).gapMinutes * 50,
    );
  });
});

describe("pause slack applies to the clipped current hour only", () => {
  const window = { from: T("08:00"), to: T("10:30") };
  const kinds = (
    pause: { from: string; to: string },
    bucket: { at: string; endAt: string },
  ) =>
    buildSeries({
      range: "7d",
      buckets: [{ ...bucket, avgMs: null, maxMs: null, checks: 0 }],
      pauses: [pause],
      configChanges: [],
      window,
      intervalSeconds: 900,
    }).map((entry) => entry.kind);

  it("does not call a past hour a pause when the pause covered only part of it", () => {
    // The monitor ran 29 minutes of this hour (interval 15 min, so slack would be 30 min).
    expect(
      kinds(
        { from: T("09:00"), to: T("09:31") },
        { at: T("09:00"), endAt: T("10:00") },
      ),
    ).toEqual(["gap"]);
  });

  it("calls a past hour a pause when a pause covers all of it", () => {
    expect(
      kinds(
        { from: T("08:30"), to: T("10:00") },
        { at: T("09:00"), endAt: T("10:00") },
      ),
    ).toEqual(["pause"]);
  });

  it("still gives slack to the current hour clipped at the read time", () => {
    // The hour 10:00-11:00 is clipped to 10:30; the ongoing pause ends at the read time.
    expect(
      kinds(
        { from: T("09:00"), to: T("10:29") },
        { at: T("10:00"), endAt: T("11:00") },
      ),
    ).toEqual(["pause"]);
  });

  it("does not give that slack to the current hour when the pause ended long before", () => {
    expect(
      kinds(
        { from: T("09:00"), to: T("09:50") },
        { at: T("10:00"), endAt: T("11:00") },
      ),
    ).toEqual(["gap"]);
  });
});

describe("24 h window clipped to creation", () => {
  const window = { from: T("00:00"), to: T("12:00") };
  const base = {
    range: "24h",
    pauses: [],
    configChanges: [],
    window,
    intervalSeconds: 300,
  } satisfies Partial<ResponseTimeChartProps>;

  it("shows a monitor created 2 h ago as a 2 h span with no pre-creation gap", () => {
    const props = {
      ...base,
      createdAt: T("10:00"),
      buckets: [point("10:05", 100), point("11:55", 100)],
    };
    expect(buildSeries(props).map((entry) => entry.kind)).toEqual([
      "value",
      "value",
    ]);
    expect(chartWindow(props)).toEqual({
      from: Date.parse(T("10:00")),
      to: Date.parse(window.to),
    });
    // Without a creation time the same results leave a long leading gap.
    expect(
      buildSeries({ ...props, createdAt: undefined }).map((e) => e.kind),
    ).toEqual(["gap", "value", "value"]);
  });

  it("still draws a real gap after creation", () => {
    expect(
      buildSeries({
        ...base,
        createdAt: T("10:00"),
        buckets: [point("11:00", 100), point("11:55", 100)],
      }).map((entry) => entry.kind),
    ).toEqual(["gap", "value", "value"]);
  });
});

describe("ResponseTimeChart drawing", () => {
  it("breaks the line at a gap and never bridges it", () => {
    const { container } = render(<ResponseTimeChart {...props24h()} />);
    const path = container.querySelector('[data-chart-part="line"]');
    // Three checks, then a gap and a pause, then a lone check: two segments.
    expect(path?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('[data-chart-part="gap"]')).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll('[data-chart-part="pause"]'),
    ).toHaveLength(1);
    expect(screen.getByText("แถบลาย: ไม่มีข้อมูล")).toBeInTheDocument();
    expect(screen.getByText("แถบเทา: หยุดชั่วคราว")).toBeInTheDocument();
  });

  it("marks a URL change and another config change differently", () => {
    const { container } = render(
      <ResponseTimeChart
        {...props24h({
          configChanges: [
            { at: T("07:03"), urlChanged: true, url: "https://new.example" },
            { at: T("07:08"), urlChanged: false },
          ],
        })}
      />,
    );
    const marks = container.querySelectorAll(
      '[data-chart-part="config-change"]',
    );
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveTextContent("URL");
    expect(marks[0]?.querySelector("title")).toHaveTextContent("เปลี่ยน URL");
    expect(marks[1]).toHaveTextContent("แก้ค่า");
  });

  it.each(["light", "dark"])(
    "takes every colour from a design token in the %s theme",
    (theme) => {
      document.documentElement.dataset.theme = theme;
      const { container } = render(<ResponseTimeChart {...props24h()} />);
      const markup = container.innerHTML;
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(markup).not.toMatch(/rgb\(|hsl\(/i);
      expect(container.querySelector('[data-chart-part="line"]')).toHaveClass(
        "stroke-primary",
      );
      expect(container.querySelector('[data-chart-part="pause"]')).toHaveClass(
        "fill-foreground/10",
      );
    },
  );
});

describe("ResponseTimeChart memo inputs", () => {
  // The same arrays, as structural sharing gives them when only dataAsOf moves.
  const shared = props24h({
    buckets: [point("10:00", 100), point("11:55", 100)],
    pauses: [],
  });
  const gapCount = (container: HTMLElement) =>
    container.querySelectorAll('[data-chart-part="gap"]').length;
  const base = {
    ...shared,
    window: { from: T("00:00"), to: T("12:00") },
    intervalSeconds: 300,
  };

  it("redraws the gaps when only the window moves", () => {
    const { container, rerender } = render(<ResponseTimeChart {...base} />);
    // 10:00 to now is fresh, but 00:00 to 10:00 is a leading gap.
    expect(gapCount(container)).toBe(1);
    rerender(
      <ResponseTimeChart
        {...base}
        window={{ from: T("09:58"), to: T("12:00") }}
      />,
    );
    expect(gapCount(container)).toBe(0);
  });

  it("redraws the gaps when only the interval changes", () => {
    const { container, rerender } = render(
      <ResponseTimeChart
        {...base}
        window={{ from: T("09:40"), to: T("12:00") }}
      />,
    );
    // A 20 minute lead is over 2 x 300 s.
    expect(gapCount(container)).toBe(1);
    rerender(
      <ResponseTimeChart
        {...base}
        window={{ from: T("09:40"), to: T("12:00") }}
        intervalSeconds={900}
      />,
    );
    expect(gapCount(container)).toBe(0);
  });

  it("redraws the clipping when only createdAt changes", () => {
    const { container, rerender } = render(<ResponseTimeChart {...base} />);
    expect(gapCount(container)).toBe(1);
    rerender(<ResponseTimeChart {...base} createdAt={T("09:59")} />);
    expect(gapCount(container)).toBe(0);
  });
});

describe("ResponseTimeChart keyboard", () => {
  it("names the region with unit, range and source and takes focus by Tab", async () => {
    render(<ResponseTimeChart {...props24h()} />);
    const region = screen.getByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ });
    expect(region).toHaveAccessibleName(/หน่วย ms/);
    expect(region).toHaveAccessibleName(/ช่วง 24 ชม.ล่าสุด/);
    expect(region).toHaveAccessibleName(/แหล่ง ผลการตรวจของ NightWatch/);
    await userEvent.setup().tab();
    expect(region).toHaveFocus();
  });

  it("announces a normal point, a gap and a pause as the selection moves", async () => {
    const user = userEvent.setup();
    render(<ResponseTimeChart {...props24h()} />);
    await user.tab();
    expect(liveRegion()).toHaveTextContent("");

    await user.keyboard("{ArrowRight}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:00"))} เวลาตอบสนอง 182 ms`,
    );
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(liveRegion()).toHaveTextContent("ไม่มีข้อมูล");
    await user.keyboard("{ArrowRight}");
    expect(liveRegion()).toHaveTextContent("หยุดชั่วคราว");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:10"))} เวลาตอบสนอง 1,204 ms`,
    );
  });

  it("jumps with Home and End and stops at both ends", async () => {
    const user = userEvent.setup();
    render(<ResponseTimeChart {...props24h()} />);
    await user.tab();
    await user.keyboard("{End}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:45"))} เวลาตอบสนอง 200 ms`,
    );
    await user.keyboard("{ArrowRight}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:45"))} เวลาตอบสนอง 200 ms`,
    );
    await user.keyboard("{Home}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:00"))} เวลาตอบสนอง 182 ms`,
    );
    await user.keyboard("{ArrowLeft}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:00"))} เวลาตอบสนอง 182 ms`,
    );
  });

  it("starts ArrowLeft from the latest point when nothing is selected", async () => {
    const user = userEvent.setup();
    render(<ResponseTimeChart {...props24h()} />);
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(liveRegion()).toHaveTextContent(
      `${formatTime(T("07:45"))} เวลาตอบสนอง 200 ms`,
    );
  });

  it("does not announce again when the data refetches", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ResponseTimeChart {...props24h()} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    const before = liveRegion().textContent;

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(liveRegion(), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    // A refetch: new arrays, the selected step (07:00) still present with a new value.
    rerender(
      <ResponseTimeChart
        {...props24h({
          buckets: [point("07:00", 999), ...props24h().buckets.slice(1)],
        })}
      />,
    );
    await Promise.resolve();
    observer.disconnect();
    expect(mutations).toHaveLength(0);
    expect(liveRegion().textContent).toBe(before);
  });
});
