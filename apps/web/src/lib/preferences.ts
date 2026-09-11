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

/** Per-device display preferences; browser storage only, by decision. */
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

/** Corrupt, missing or unreadable storage all fall back to the defaults. */
export function readPreferences(): Preferences {
  return parse(readRaw());
}

const listeners = new Set<() => void>();

export function writePreferences(next: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota): the choice still applies
    // to subscribers for this page view.
    cache = { raw: null, value: next, forced: true };
  }
  for (const listener of listeners) {
    listener();
  }
}

// Snapshot cache so useSyncExternalStore sees a stable reference while the
// stored string is unchanged.
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

/**
 * Absolute date-time in the user's zone and hour cycle, Thai locale (Buddhist
 * year, abbreviated month) — e.g. "10 ก.ย. 2569 14:12".
 */
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
