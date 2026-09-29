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
  syncThemeColor();
}

// Canvas tokens from docs/design-system.md; the meta keeps browser chrome on the same plane.
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  const explicit = document.documentElement.getAttribute("data-theme");
  const dark =
    explicit === "dark" ||
    (explicit !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  meta.setAttribute("content", dark ? "#0b0c0e" : "#f7f8fa");
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
