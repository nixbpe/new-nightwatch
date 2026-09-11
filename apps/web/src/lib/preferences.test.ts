import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultPreferences,
  formatDateTime,
  PREFERENCES_KEY,
  readPreferences,
  usePreferences,
  writePreferences,
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
