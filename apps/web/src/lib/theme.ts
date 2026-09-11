import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "nightwatch-theme";

function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

// One store for every consumer (account menu, display tab) so a change in
// one place is reflected everywhere at once.
let current: ThemePreference = readStoredTheme();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Apply and persist a light/dark/system choice. "system" removes data-theme
 * so index.css's prefers-color-scheme block decides, exactly as before this
 * feature existed; "light"/"dark" set data-theme, which index.css's explicit
 * override blocks read. index.html's inline script applies the same
 * persisted value before first paint to avoid a flash of the wrong theme.
 */
export function setTheme(next: ThemePreference): void {
  current = next;
  if (next === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", next);
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable (private mode, etc.) — the choice just won't
    // survive a reload; it still applies for the current page view.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Persisted light/dark/system preference, shared across all consumers. */
export function useTheme(): {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
} {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => "system" as const,
  );
  return { theme, setTheme };
}
