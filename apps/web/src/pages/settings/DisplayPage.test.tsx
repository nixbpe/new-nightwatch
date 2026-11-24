import {
  act,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatDateTime,
  PREFERENCES_KEY,
  type Preferences,
} from "../../lib/preferences";
import { useTheme } from "../../lib/theme";
import { DisplayPage } from "./DisplayPage";

const STORED: Preferences = {
  language: "th",
  timeZone: "Asia/Tokyo",
  hourCycle: "h12",
  weekStart: "sunday",
};

// The unsaved-changes guard needs a data router.
function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <DisplayPage />
            <Link to="/other" data-testid="go-other">
              other
            </Link>
          </>
        ),
      },
      { path: "/other", element: <p data-testid="other-page">other</p> },
    ],
    { initialEntries: ["/"] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

describe("DisplayPage", () => {
  afterEach(() => {
    localStorage.removeItem(PREFERENCES_KEY);
    localStorage.removeItem("nightwatch-theme");
    document.documentElement.removeAttribute("data-theme");
  });

  it("the theme control applies immediately and shares the persisted choice", async () => {
    const user = userEvent.setup();
    const other = renderHook(() => useTheme());
    renderPage();

    await user.click(screen.getByTestId("display-theme-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("nightwatch-theme")).toBe("dark");
    expect(other.result.current.theme).toBe("dark");
    expect(screen.getByTestId("display-theme-dark")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    expect(screen.getByTestId("display-theme-dark")).toHaveAttribute(
      "role",
      "radio",
    );
    expect(screen.getByTestId("display-theme-dark")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByTestId("display-theme-system")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("display-theme-system")).toHaveFocus();
    expect(screen.getByTestId("display-theme-system")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("display-theme-system")).toHaveAttribute(
      "tabindex",
      "0",
    );
    await user.click(screen.getByTestId("display-theme-system"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("nightwatch-theme")).toBe("system");
  });

  it("shows the stored preferences and keeps the single-language select honest", () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(STORED));
    renderPage();

    expect(screen.getByTestId("display-time-zone")).toHaveValue("Asia/Tokyo");
    expect(screen.getByTestId("display-hour-cycle")).toHaveValue("h12");
    expect(screen.getByTestId("display-week-start")).toHaveValue("sunday");

    const language = screen.getByTestId("display-language");
    expect(language).toBeDisabled();
    expect(language).toHaveValue("th");
    expect(within(language).getAllByTestId("display-language-th")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("display-save")).toBeDisabled();
  });

  it("saves only after a change, persists to this browser, and cancel restores", async () => {
    const user = userEvent.setup();
    renderPage();
    const save = screen.getByTestId("display-save");
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByTestId("display-hour-cycle"), "h12");
    await user.selectOptions(
      screen.getByTestId("display-time-zone"),
      "Asia/Tokyo",
    );
    expect(save).toBeEnabled();
    await user.click(save);

    expect(screen.getByTestId("display-saved")).toBeVisible();
    // Success is a status message, not an interrupting alert (CMP-10).
    expect(screen.getByTestId("display-saved")).toHaveAttribute(
      "role",
      "status",
    );
    // Both buttons disable themselves; focus stays on the form instead of falling to the body.
    expect(screen.getByTestId("display-time-zone")).toHaveFocus();
    const stored = JSON.parse(
      localStorage.getItem(PREFERENCES_KEY) ?? "{}",
    ) as Preferences;
    expect(stored.timeZone).toBe("Asia/Tokyo");
    expect(stored.hourCycle).toBe("h12");
    expect(stored).toEqual({
      language: "th",
      timeZone: "Asia/Tokyo",
      hourCycle: "h12",
      weekStart: "monday",
    });
    expect(save).toBeDisabled();
    expect(screen.getByTestId("display-cancel")).toBeDisabled();

    await user.selectOptions(
      screen.getByTestId("display-week-start"),
      "sunday",
    );
    expect(save).toBeEnabled();
    await user.click(screen.getByTestId("display-cancel"));
    expect(screen.getByTestId("display-week-start")).toHaveValue("monday");
    expect(save).toBeDisabled();
    expect(screen.getByTestId("display-cancel")).toBeDisabled();
  });

  it("previews the current time in the draft format before it is saved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-04T08:05:00Z"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage();
      const draftOf = (over: Partial<Preferences>): Preferences => ({
        language: "th",
        timeZone: "Asia/Tokyo",
        hourCycle: "h23",
        weekStart: "monday",
        ...over,
      });

      await user.selectOptions(
        screen.getByTestId("display-time-zone"),
        "Asia/Tokyo",
      );
      expect(screen.getByTestId("display-preview")).toHaveTextContent(
        formatDateTime(new Date(), draftOf({})),
      );
      await user.selectOptions(screen.getByTestId("display-hour-cycle"), "h12");
      expect(screen.getByTestId("display-preview")).toHaveTextContent(
        formatDateTime(new Date(), draftOf({ hourCycle: "h12" })),
      );
      expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks before leaving with an unsaved draft, and leaves freely once it is saved", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();

    await user.click(screen.getByTestId("go-other"));
    expect(router.state.location.pathname).toBe("/other");
    await act(() => router.navigate("/"));

    await user.selectOptions(screen.getByTestId("display-hour-cycle"), "h12");
    await user.click(screen.getByTestId("go-other"));
    expect(router.state.location.pathname).toBe("/");
    const dialog = await screen.findByTestId("unsaved-changes-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");

    // Cancel keeps the draft and the page.
    await user.click(within(dialog).getByTestId("confirmation-cancel"));
    expect(screen.queryByTestId("unsaved-changes-dialog")).toBeNull();
    expect(screen.getByTestId("display-hour-cycle")).toHaveValue("h12");

    await user.click(screen.getByTestId("go-other"));
    await user.click(await screen.findByTestId("unsaved-changes-leave"));
    expect(router.state.location.pathname).toBe("/other");
    expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull();

    await act(() => router.navigate("/"));
    await user.selectOptions(screen.getByTestId("display-hour-cycle"), "h12");
    await user.click(screen.getByTestId("display-save"));
    await user.click(screen.getByTestId("go-other"));
    expect(router.state.location.pathname).toBe("/other");
  });

  it("warns the tab close handler only while the draft is unsaved", async () => {
    const user = userEvent.setup();
    renderPage();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    await user.selectOptions(screen.getByTestId("display-hour-cycle"), "h12");
    expect(unload()).toBe(true);
    await user.click(screen.getByTestId("display-cancel"));
    expect(unload()).toBe(false);
  });

  it("labels time zones with their IANA id and current offset", () => {
    renderPage();
    const select = screen.getByTestId("display-time-zone");
    const bangkok = within(select).getByTestId("display-zone-Asia/Bangkok");
    expect(bangkok).toHaveAttribute("value", "Asia/Bangkok");
    expect(bangkok.textContent).toContain("Asia/Bangkok");
    expect(bangkok.textContent).toContain("GMT+7");
  });

  it("offers a way back to the browser's time zone that waits for Save", async () => {
    const user = userEvent.setup();
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const other = browserZone === "Asia/Tokyo" ? "Asia/Bangkok" : "Asia/Tokyo";
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...STORED, timeZone: other }),
    );
    renderPage();

    await user.click(screen.getByTestId("display-time-zone-browser"));

    expect(screen.getByTestId("display-time-zone")).toHaveValue(browserZone);
    expect(screen.getByTestId("display-time-zone")).toHaveFocus();
    expect(screen.queryByTestId("display-time-zone-browser")).toBeNull();
    expect(screen.getByTestId("display-save")).toBeEnabled();
    expect(
      (JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}") as Preferences)
        .timeZone,
    ).toBe(other);
  });

  it("hides the browser time zone button while the zone already matches", () => {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({
        ...STORED,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
    renderPage();
    expect(screen.queryByTestId("display-time-zone-browser")).toBeNull();
  });

  // Keep last: a refused write leaves a forced in-memory snapshot in lib/preferences.ts.
  it("does not claim the choices were remembered when storage refuses the write", async () => {
    const user = userEvent.setup();
    renderPage();
    // A stub, not a spy: happy-dom's Storage ignores prototype spies once another test used it.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("denied", "QuotaExceededError");
      },
    });
    try {
      await user.click(screen.getByTestId("display-theme-dark"));
      expect(screen.getByTestId("display-theme-not-saved")).toBeVisible();

      await user.selectOptions(screen.getByTestId("display-hour-cycle"), "h12");
      await user.click(screen.getByTestId("display-save"));
      expect(screen.getByTestId("display-save-not-persisted")).toBeVisible();
      expect(screen.queryByTestId("display-saved")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
