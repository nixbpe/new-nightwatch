import { afterEach, describe, expect, it } from "vitest";

import { defaultPreferences, writePreferences } from "../../lib/preferences";
import {
  formatDateTimeSeconds,
  formatPercent,
  formatTime,
  formatTimeOrDate,
  timeZone,
} from "./format";

function usePreferencesOf(zone: string, hourCycle: "h23" | "h12") {
  writePreferences({ ...defaultPreferences(), timeZone: zone, hourCycle });
}

describe("monitor times follow Settings > Display", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("formats in the preference time zone, not the browser zone", () => {
    usePreferencesOf("Asia/Bangkok", "h23");
    expect(timeZone()).toBe("Asia/Bangkok");
    expect(formatTime("2026-11-23T00:00:00Z")).toMatch(/^07:00/);

    usePreferencesOf("America/New_York", "h23");
    expect(timeZone()).toBe("America/New_York");
    expect(formatTime("2026-11-23T00:00:00Z")).toMatch(/^19:00/);
  });

  it("follows the 12/24-hour choice", () => {
    usePreferencesOf("Asia/Bangkok", "h12");
    const text = formatTime("2026-11-23T12:00:00Z");
    expect(text).toMatch(/^07:00/);
    expect(text).not.toMatch(/^07:00 น\.$/);
  });

  it("window bounds use the same zone as the header", () => {
    usePreferencesOf("Asia/Tokyo", "h23");
    expect(formatDateTimeSeconds("2026-11-23T00:00:00Z")).toContain("09:00:00");
  });

  it("a Settings change applies to the next call without reloading", () => {
    usePreferencesOf("Asia/Bangkok", "h23");
    const before = formatTime("2026-11-23T00:00:00Z");
    usePreferencesOf("Asia/Tokyo", "h23");
    expect(formatTime("2026-11-23T00:00:00Z")).not.toBe(before);
    expect(timeZone()).toBe("Asia/Tokyo");
  });

  it("decides 'today' in the preference zone", () => {
    // UTC+14 differs from any zone a runner uses: 10:30Z on the 23rd and 00:00Z on the 24th
    // are two UTC days but both fall on the 24th in this zone.
    usePreferencesOf("Pacific/Kiritimati", "h23");
    const now = new Date("2026-11-24T00:00:00Z");
    expect(formatTimeOrDate("2026-11-23T10:30:00Z", now)).toMatch(/^00:30/);
  });
});

describe("formatPercent", () => {
  it("always shows 2 decimals", () => {
    expect(formatPercent(41)).toBe("41.00");
    expect(formatPercent(40.77)).toBe("40.77");
    expect(formatPercent(99.99)).toBe("99.99");
    expect(formatPercent(0)).toBe("0.00");
  });

  it("keeps the API's 2-decimal value instead of re-rounding it", () => {
    expect(formatPercent(1.15)).toBe("1.15");
    expect(formatPercent(2.3)).toBe("2.30");
  });
});
