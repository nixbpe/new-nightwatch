import { useSyncExternalStore } from "react";
import { z } from "zod";

export const PREFERENCES_KEY = "nightwatch-preferences";

const preferencesSchema = z.object({
  language: z.literal("th"),
  timeZone: z
    .string()
    .min(1)
    .refine(
      (timeZone) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone });
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid IANA time zone." },
    ),
  hourCycle: z.enum(["h23", "h12"]),
  weekStart: z.enum(["monday", "sunday"]),
});

/** Per-device; browser storage only, by decision. */
export type Preferences = z.infer<typeof preferencesSchema>;

export function defaultPreferences(): Preferences {
  let timeZone = "Asia/Bangkok";
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved !== "") {
      timeZone = resolved;
    }
  } catch {
    // Keep the Thai default when the runtime cannot resolve a zone.
  }
  return { language: "th", timeZone, hourCycle: "h23", weekStart: "monday" };
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(PREFERENCES_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Preferences {
  if (raw === null) {
    return defaultPreferences();
  }
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultPreferences();
  } catch {
    return defaultPreferences();
  }
}

export function readPreferences(): Preferences {
  return parse(readRaw());
}

const listeners = new Set<() => void>();

export function writePreferences(next: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota): the choice still applies for this page view.
    cache = { raw: null, value: next, forced: true };
  }
  for (const listener of listeners) {
    listener();
  }
}

// useSyncExternalStore needs a stable reference while the stored string is unchanged.
let cache: { raw: string | null; value: Preferences; forced: boolean } | null =
  null;

function getSnapshot(): Preferences {
  const raw = readRaw();
  if (cache !== null && (cache.forced || cache.raw === raw)) {
    return cache.value;
  }
  cache = { raw, value: parse(raw), forced: false };
  return cache.value;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PREFERENCES_KEY) {
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePreferences(): {
  preferences: Preferences;
  save: (next: Preferences) => void;
} {
  const preferences = useSyncExternalStore(
    subscribe,
    getSnapshot,
    defaultPreferences,
  );
  return { preferences, save: writePreferences };
}

// Thai locale (Buddhist year), e.g. "10 ก.ย. 2569 14:12".
export function formatDateTime(date: Date, preferences: Preferences): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: preferences.timeZone,
    hourCycle: preferences.hourCycle,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("th-TH", options).format(date);
  } catch {
    const defaults = defaultPreferences();
    return new Intl.DateTimeFormat("th-TH", {
      ...options,
      timeZone: defaults.timeZone,
      hourCycle: defaults.hourCycle,
    }).format(date);
  }
}

type AuditParts = Record<
  "year" | "month" | "day" | "hour" | "minute" | "second",
  string
>;

// Audit times are Gregorian, Latin digits and 24-hour whatever the display preferences say (F-007).
function auditParts(date: Date, timeZone: string): AuditParts {
  const make = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = make(timeZone);
  } catch {
    formatter = make(defaultPreferences().timeZone);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return parts as AuditParts;
}

/** `YYYY-MM-DD HH:mm:ss` in the preference time zone. */
export function formatAuditTimestamp(
  date: Date,
  preferences: Preferences,
): string {
  return `${formatAuditDate(date, preferences)} ${formatAuditTime(date, preferences)}`;
}

/** `YYYY-MM-DD` in the preference time zone. */
export function formatAuditDate(date: Date, preferences: Preferences): string {
  const p = auditParts(date, preferences.timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `HH:mm:ss` in the preference time zone. */
export function formatAuditTime(date: Date, preferences: Preferences): string {
  const p = auditParts(date, preferences.timeZone);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** The instant a wall-clock day boundary (`YYYY-MM-DD`, start or end of day) falls on in `timeZone`. */
export function zonedDayBoundary(
  day: string,
  timeZone: string,
  boundary: "start" | "end",
): Date {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const wall =
    boundary === "start"
      ? Date.UTC(year, month - 1, date, 0, 0, 0, 0)
      : Date.UTC(year, month - 1, date, 23, 59, 59, 999);
  const offsetAt = (instant: number) => {
    const p = auditParts(new Date(instant), timeZone);
    const asUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    return asUtc - Math.floor(instant / 1000) * 1000;
  };
  // Two passes settle the offset when the day boundary sits next to a DST change.
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}
