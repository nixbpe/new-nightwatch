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
        <StatusCard monitor={monitor} />
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
    render(<StatusCard monitor={monitor} />);
    expect(screen.getByText(/ล้มเหลว 1 ครั้ง/)).toBeInTheDocument();
    expect(
      screen.getByText(/จะเปลี่ยนเป็นล่มเมื่อล้มเหลวติดกันครบ\s*3\s*ครั้ง/),
    ).toBeInTheDocument();
  });
});
