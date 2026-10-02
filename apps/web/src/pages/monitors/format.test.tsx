import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  formatTimeWithSeconds,
  formatTimeWithSecondsOrDate,
} from "./format";

const NOW = new Date("2026-09-30T08:00:00.000Z");

describe("formatTimeWithSecondsOrDate", () => {
  it("shows seconds for a check made today", () => {
    const iso = "2026-09-30T07:30:15.000Z";
    expect(formatTimeWithSecondsOrDate(iso, NOW)).toBe(
      formatTimeWithSeconds(iso),
    );
  });

  it("shows the date for a check from a previous day", () => {
    const iso = "2026-09-28T07:30:15.000Z";
    expect(formatTimeWithSecondsOrDate(iso, NOW)).toBe(formatDateTime(iso));
  });
});
