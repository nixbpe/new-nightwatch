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
