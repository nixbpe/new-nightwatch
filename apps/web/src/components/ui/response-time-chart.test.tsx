import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { formatTime } from "../../pages/monitors/format";
import { ResponseTimeChart } from "./response-time-chart";
import {
  buildSeries,
  describeEntry,
  summarize,
  summaryText,
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

  it("summarizes average, maximum and gaps with adjacent hourly gaps as one", () => {
    const hour = (start: string, avg: number | null, checks: number) => ({
      at: T(start),
      endAt: T(
        start.replace(/^\d\d/, (h) => String(Number(h) + 1).padStart(2, "0")),
      ),
      avgMs: avg,
      maxMs: avg === null ? null : avg * 2,
      checks,
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
