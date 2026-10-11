import { render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PREFERENCES_KEY, type Preferences } from "../../lib/preferences";
import { useTheme } from "../../lib/theme";
import { DisplayPage } from "./DisplayPage";

const STORED: Preferences = {
  language: "th",
  timeZone: "Asia/Tokyo",
  hourCycle: "h12",
  weekStart: "sunday",
};

describe("DisplayPage", () => {
  afterEach(() => {
    localStorage.removeItem(PREFERENCES_KEY);
    localStorage.removeItem("nightwatch-theme");
    document.documentElement.removeAttribute("data-theme");
  });

  it("the theme control applies immediately and shares the persisted choice", async () => {
    const user = userEvent.setup();
    render(<DisplayPage />);

    await user.click(screen.getByTestId("display-theme-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("nightwatch-theme")).toBe("dark");
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

  it("every useTheme consumer (e.g. the account menu) sees the choice made here", async () => {
    const user = userEvent.setup();
    const other = renderHook(() => useTheme());
    render(<DisplayPage />);

    await user.click(screen.getByTestId("display-theme-dark"));

    expect(other.result.current.theme).toBe("dark");
  });

  it("shows the stored preferences and keeps the single-language select honest", () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(STORED));
    render(<DisplayPage />);

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
    render(<DisplayPage />);
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
    expect(screen.getByTestId("display-saved")).toHaveAttribute(
      "role",
      "alert",
    );
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

  it("labels time zones with their current offset", () => {
    render(<DisplayPage />);
    const select = screen.getByTestId("display-time-zone");
    const bangkok = within(select).getByTestId("display-zone-Asia/Bangkok");
    expect(bangkok).toHaveAttribute("value", "Asia/Bangkok");
    expect(bangkok.textContent).toBe("Bangkok (GMT+7)");
  });
});
