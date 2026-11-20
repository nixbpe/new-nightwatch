import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { detail } from "../detail-test-support";
import { StatusCard } from "./StatusCard";

function uptimeRecord(key: "h24" | "d7" | "d30") {
  const window = within(screen.getByTestId("monitor-status")).getByTestId(
    `monitor-status-window-${key}`,
  );
  return {
    percent: within(window).getByTestId("monitor-status-percent").textContent,
    checks: within(window).getByTestId("monitor-status-checks").textContent,
    coverage: within(window).getByTestId("monitor-status-coverage").textContent,
  };
}

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
    const section = screen.getByTestId("monitor-status");
    const failures = within(section).getByTestId("monitor-status-failures");
    const threshold = within(section).getByTestId(
      "monitor-status-failure-threshold",
    );
    expect(failures.textContent.match(/\d+/g)).toEqual(["1", "3"]);
    expect(threshold.textContent.match(/\d+/g)).toEqual(["3"]);
    expect(failures).toHaveTextContent(/\S/);
    expect(threshold).toHaveTextContent(/\S/);
  });
});

describe("uptime caption (AC-75, AC-14)", () => {
  it("shows the calculation note and actual uptime, checks and coverage of every window", () => {
    const monitor = detail({
      uptime: {
        h24: { percent: 100, checks: 288, coveragePercent: 98.5 },
        d7: { percent: 99.5, checks: 2016, coveragePercent: 91.25 },
        d30: { percent: 99.2, checks: 8640, coveragePercent: 80 },
      },
    });
    render(<StatusCard monitor={monitor} fresh />);
    expect(
      within(screen.getByTestId("monitor-status")).getByTestId(
        "monitor-status-calculation-note",
      ),
    ).toHaveTextContent(/\S/);
    expect(uptimeRecord("h24")).toEqual({
      percent: "100.00%",
      checks: "288",
      coverage: "98.50%",
    });
    expect(uptimeRecord("d7")).toEqual({
      percent: "99.50%",
      checks: "2,016",
      coverage: "91.25%",
    });
    expect(uptimeRecord("d30")).toEqual({
      percent: "99.20%",
      checks: "8,640",
      coverage: "80.00%",
    });
  });
});
