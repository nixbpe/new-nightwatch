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

// One shared store so every consumer (account menu, display tab) updates at once.
let current: ThemePreference = readStoredTheme();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// "system" removes data-theme so prefers-color-scheme decides; index.html applies the stored
// value before first paint to avoid a theme flash.
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
    // Storage unavailable (private mode): the choice applies but won't survive a reload.
  }
  for (const listener of listeners) {
    listener();
  }
}

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
