import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultPreferences,
  formatAuditDate,
  formatAuditTime,
  formatAuditTimestamp,
  formatDateTime,
  PREFERENCES_KEY,
  readPreferences,
  usePreferences,
  writePreferences,
  zonedDayBoundary,
  type Preferences,
} from "./preferences";

const STORED: Preferences = {
  language: "th",
  timeZone: "Asia/Tokyo",
  hourCycle: "h12",
  weekStart: "sunday",
};

describe("preferences storage", () => {
  afterEach(() => {
    localStorage.removeItem(PREFERENCES_KEY);
    vi.restoreAllMocks();
  });

  it("falls back to defaults when nothing is stored", () => {
    expect(readPreferences()).toEqual(defaultPreferences());
    expect(defaultPreferences().language).toBe("th");
    expect(defaultPreferences().hourCycle).toBe("h23");
    expect(defaultPreferences().weekStart).toBe("monday");
    expect(defaultPreferences().timeZone).not.toBe("");
  });

  it("falls back to defaults on corrupt or off-schema storage", () => {
    localStorage.setItem(PREFERENCES_KEY, "{not json");
    expect(readPreferences()).toEqual(defaultPreferences());

    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ language: "en", timeZone: "", hourCycle: "h25" }),
    );
    expect(readPreferences()).toEqual(defaultPreferences());
  });

  it("falls back to defaults for a stored non-IANA time zone", () => {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...STORED, timeZone: "Mars/Olympus" }),
    );

    expect(readPreferences()).toEqual(defaultPreferences());
  });

  it("falls back to defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPreferences()).toEqual(defaultPreferences());
  });

  it("round-trips a saved value", () => {
    writePreferences(STORED);
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "")).toEqual(
      STORED,
    );
    expect(readPreferences()).toEqual(STORED);
  });

  it("usePreferences re-renders subscribers when a value is saved", () => {
    const { result } = renderHook(() => usePreferences());
    expect(result.current.preferences).toEqual(defaultPreferences());

    act(() => {
      result.current.save(STORED);
    });

    expect(result.current.preferences).toEqual(STORED);
  });
});

describe("formatDateTime", () => {
  // 2026-09-10 07:12 UTC = 14:12 in Bangkok, 16:12 in Tokyo.
  const instant = new Date("2026-09-10T07:12:00Z");
  const base = defaultPreferences();

  it("uses the chosen time zone and a 24-hour clock", () => {
    const bangkok = formatDateTime(instant, {
      ...base,
      timeZone: "Asia/Bangkok",
      hourCycle: "h23",
    });
    expect(bangkok).toContain("14:12");
    // Thai locale renders the Buddhist year.
    expect(bangkok).toContain("2569");

    const tokyo = formatDateTime(instant, {
      ...base,
      timeZone: "Asia/Tokyo",
      hourCycle: "h23",
    });
    expect(tokyo).toContain("16:12");
  });

  it("switches to a 12-hour clock on request", () => {
    const twelve = formatDateTime(instant, {
      ...base,
      timeZone: "Asia/Bangkok",
      hourCycle: "h12",
    });
    expect(twelve).not.toContain("14:12");
    expect(twelve).toMatch(/2:12/);
  });

  it("falls back to the runtime defaults for an invalid time zone", () => {
    const invalid = formatDateTime(instant, {
      ...base,
      timeZone: "Mars/Olympus",
      hourCycle: "h12",
    });
    const expected = formatDateTime(instant, defaultPreferences());

    expect(invalid).toBe(expected);
  });
});

describe("audit timestamps", () => {
  const prefs = (timeZone: string): Preferences => ({
    ...STORED,
    timeZone,
    hourCycle: "h12",
  });
  const instant = new Date("2026-10-02T07:01:55.000Z");

  it("renders Gregorian year, seconds and 24-hour time in the preference zone", () => {
    expect(formatAuditTimestamp(instant, prefs("Asia/Bangkok"))).toBe(
      "2026-10-02 14:01:55",
    );
    expect(formatAuditTimestamp(instant, prefs("America/New_York"))).toBe(
      "2026-10-02 03:01:55",
    );
    expect(formatAuditDate(instant, prefs("Pacific/Auckland"))).toBe(
      "2026-10-02",
    );
    expect(formatAuditTime(instant, prefs("Asia/Kolkata"))).toBe("12:31:55");
  });

  it("shows midnight as 00 and moves the date with the zone", () => {
    const midnight = new Date("2026-10-01T17:00:00.000Z");
    expect(formatAuditTimestamp(midnight, prefs("Asia/Bangkok"))).toBe(
      "2026-10-02 00:00:00",
    );
    expect(formatAuditDate(midnight, prefs("UTC"))).toBe("2026-10-01");
  });

  it("falls back to the default zone for an unknown one", () => {
    expect(formatAuditDate(instant, prefs("Not/AZone"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  // The local calendar date of an instant, from Intl directly (not from our own helpers).
  const localDate = (instant: Date, timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);

  it("starts a day where midnight does not exist (Havana, 2026-03-08)", () => {
    const start = zonedDayBoundary("2026-03-08", "America/Havana", "start");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(localDate(start, "America/Havana")).toBe("2026-03-08");
    expect(localDate(new Date(start.getTime() - 1), "America/Havana")).toBe(
      "2026-03-07",
    );
    const end = zonedDayBoundary("2026-03-08", "America/Havana", "end");
    expect(end.toISOString()).toBe("2026-03-09T03:59:59.999Z");
  });

  it.each([
    ["America/Havana", "2026-03-07"],
    ["America/Havana", "2026-03-08"],
    ["America/Havana", "2026-03-09"],
    // Chile falls back at 24:00, so 23:00 on 2026-04-04 happens twice.
    ["America/Santiago", "2026-04-03"],
    ["America/Santiago", "2026-04-04"],
    ["America/Santiago", "2026-04-05"],
    // Spring forward at midnight, fall back at midnight, a half-hour shift and a plain zone.
    ["America/Asuncion", "2026-10-04"],
    ["Asia/Beirut", "2026-03-29"],
    ["Australia/Lord_Howe", "2026-04-05"],
    ["Australia/Lord_Howe", "2026-10-04"],
    ["Asia/Bangkok", "2026-10-02"],
    ["America/New_York", "2026-11-01"],
    ["Pacific/Auckland", "2026-09-27"],
  ])(
    "%s %s: start and end are the first and last instants of that local day",
    (timeZone, day) => {
      const start = zonedDayBoundary(day, timeZone, "start");
      const end = zonedDayBoundary(day, timeZone, "end");
      expect(localDate(start, timeZone)).toBe(day);
      expect(localDate(new Date(start.getTime() - 1), timeZone)).not.toBe(day);
      expect(localDate(end, timeZone)).toBe(day);
      expect(localDate(new Date(end.getTime() + 1), timeZone)).not.toBe(day);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    },
  );

  it("maps a calendar day to its boundaries in the zone", () => {
    expect(
      zonedDayBoundary("2026-10-02", "Asia/Bangkok", "start").toISOString(),
    ).toBe("2026-10-01T17:00:00.000Z");
    expect(
      zonedDayBoundary("2026-10-02", "Asia/Bangkok", "end").toISOString(),
    ).toBe("2026-10-02T16:59:59.999Z");
    // DST starts 2026-03-08 in New York: the day is 23 hours long.
    expect(
      zonedDayBoundary("2026-03-08", "America/New_York", "start").toISOString(),
    ).toBe("2026-03-08T05:00:00.000Z");
    expect(
      zonedDayBoundary("2026-03-08", "America/New_York", "end").toISOString(),
    ).toBe("2026-03-09T03:59:59.999Z");
  });
});
