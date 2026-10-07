import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { detail } from "../detail-test-support";
import { ConfigCard } from "./ConfigCard";
import { StatusCard } from "./StatusCard";

describe("detail labels (TYP-04)", () => {
  it("writes the uptime windows and the method term in Thai", () => {
    const monitor = detail();
    render(
      <>
        <StatusCard monitor={monitor} fresh />
        <ConfigCard monitor={monitor} />
      </>,
    );
    for (const label of [
      "ความพร้อมใช้งาน 24 ชม.",
      "ความพร้อมใช้งาน 7 วัน",
      "ความพร้อมใช้งาน 30 วัน",
      "เมธอด",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("failure threshold note", () => {
  it("shows one recorded failure and states that down status starts at the stored threshold of 3 failures", () => {
    const monitor = detail({
      health: "up",
      consecutiveFailures: 1,
      alerts: {
        failureThreshold: 3,
        downEnabled: true,
        sslEnabled: true,
        sslCautionDays: 30,
      },
    });
    render(<StatusCard monitor={monitor} fresh />);
    expect(screen.getByText(/ล้มเหลว 1 ครั้ง/)).toBeInTheDocument();
    expect(
      screen.getByText(/จะเปลี่ยนเป็นล่มเมื่อล้มเหลวติดกันครบ\s*3\s*ครั้ง/),
    ).toBeInTheDocument();
  });
});

describe("uptime caption (AC-75, AC-14)", () => {
  it("keeps the existing caption word for word and the checks and coverage of every window", () => {
    const monitor = detail({
      uptime: {
        h24: { percent: 100, checks: 288, coveragePercent: 98.5 },
        d7: { percent: 99.5, checks: 2016, coveragePercent: 91.25 },
        d30: { percent: 99.2, checks: 8640, coveragePercent: 80 },
      },
    });
    render(<StatusCard monitor={monitor} fresh />);
    const caption = screen.getByText(/^คำนวณจากการตรวจที่มีผล/);
    expect(caption.textContent).toBe(
      "คำนวณจากการตรวจที่มีผล ไม่รวมช่วงหยุดชั่วคราวและช่วงที่ตรวจไม่ได้ ช่วงไม่มีข้อมูลไม่นับเป็นปกติ",
    );
    expect(caption).toHaveClass("text-xs", "text-foreground-secondary");
    const windows = [
      ["ความพร้อมใช้งาน 24 ชม.", "288", "98.50%"],
      ["ความพร้อมใช้งาน 7 วัน", "2,016", "91.25%"],
      ["ความพร้อมใช้งาน 30 วัน", "8,640", "80.00%"],
    ] as const;
    for (const [label, checks, coverage] of windows) {
      const cell = screen.getByText(label).parentElement as HTMLElement;
      expect(cell).toHaveTextContent(`จากการตรวจ ${checks} ครั้ง`);
      expect(cell).toHaveTextContent(`ครอบคลุม ${coverage}`);
    }
  });
});

describe("data-as-of dot (AC-81)", () => {
  function dotOf() {
    const line = screen.getByText(/^ข้อมูล ณ/);
    const dot = line.previousElementSibling as HTMLElement;
    return { line, dot };
  }

  it("pulses in Primary while the data is fresh", () => {
    render(<StatusCard monitor={detail()} fresh />);
    const { dot } = dotOf();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("live-pulse", "bg-primary", "size-[6px]");
    expect(dot).not.toHaveClass("bg-foreground-secondary");
  });

  it("stays as a neutral dot with no pulse once the last refresh failed", () => {
    const { container } = render(
      <StatusCard monitor={detail()} fresh={false} />,
    );
    const { line, dot } = dotOf();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("bg-foreground-secondary");
    expect(dot).not.toHaveClass("live-pulse");
    expect(dot).not.toHaveClass("bg-primary");
    expect(dot.className).not.toMatch(/glow|shadow|animate/);
    expect(container.querySelector(".live-pulse")).toBeNull();
    // The dot never carries the meaning: the written label stays.
    expect(line).toHaveTextContent("ข้อมูล ณ");
  });
});
