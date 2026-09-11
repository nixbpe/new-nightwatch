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

    await user.click(screen.getByRole("button", { name: "มืด" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("nightwatch-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "มืด" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "ตามระบบ" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("every useTheme consumer (e.g. the account menu) sees the choice made here", async () => {
    const user = userEvent.setup();
    const other = renderHook(() => useTheme());
    render(<DisplayPage />);

    await user.click(screen.getByRole("button", { name: "มืด" }));

    expect(other.result.current.theme).toBe("dark");
  });

  it("shows the stored preferences and keeps the single-language select honest", () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(STORED));
    render(<DisplayPage />);

    expect(screen.getByLabelText("โซนเวลา")).toHaveValue("Asia/Tokyo");
    expect(screen.getByLabelText("รูปแบบเวลา")).toHaveValue("h12");
    expect(screen.getByLabelText("วันแรกของสัปดาห์")).toHaveValue("sunday");

    const language = screen.getByLabelText("ภาษา");
    expect(language).toBeDisabled();
    expect(language.querySelectorAll("option")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    ).toBeDisabled();
  });

  it("saves only after a change, persists to this browser, and cancel restores", async () => {
    const user = userEvent.setup();
    render(<DisplayPage />);
    const save = screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" });
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("รูปแบบเวลา"), "h12");
    await user.selectOptions(screen.getByLabelText("โซนเวลา"), "Asia/Tokyo");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "บันทึกแล้ว — ใช้กับเบราว์เซอร์นี้",
    );
    const stored = JSON.parse(
      localStorage.getItem(PREFERENCES_KEY) ?? "{}",
    ) as Preferences;
    expect(stored.timeZone).toBe("Asia/Tokyo");
    expect(stored.hourCycle).toBe("h12");
    expect(save).toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText("วันแรกของสัปดาห์"),
      "sunday",
    );
    expect(save).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByLabelText("วันแรกของสัปดาห์")).toHaveValue("monday");
    expect(save).toBeDisabled();
  });

  it("labels time zones with their current offset", () => {
    render(<DisplayPage />);
    const select = screen.getByLabelText("โซนเวลา");
    const bangkok = within(select)
      .getAllByRole("option")
      .find((option) => option.getAttribute("value") === "Asia/Bangkok");
    expect(bangkok?.textContent).toBe("Bangkok (GMT+7)");
  });
});
