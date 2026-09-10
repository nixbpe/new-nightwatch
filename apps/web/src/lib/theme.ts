import { useCallback, useEffect, useState } from "react";

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

/**
 * Persisted light/dark/system preference (Step 6), backing the header's
 * theme toggle. "system" removes data-theme so index.css's
 * prefers-color-scheme block decides, exactly as before this feature
 * existed; "light"/"dark" set data-theme, which index.css's explicit
 * override blocks read. index.html's inline script applies the same
 * persisted value before first paint to avoid a flash of the wrong theme.
 */
export function useTheme(): {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
} {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode, etc.) — the choice just won't
      // survive a reload; it still applies for the current page view.
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
