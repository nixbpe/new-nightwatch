import type { InventoryRowSource } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import type { Preferences } from "../../lib/preferences";
import { sourceLabel, sourceWho } from "./rowSource";

const auckland: Preferences = {
  language: "th",
  timeZone: "Pacific/Auckland",
  hourCycle: "h23",
  weekStart: "monday",
};
const bangkok: Preferences = { ...auckland, timeZone: "Asia/Bangkok" };
const source = (
  overrides: Partial<InventoryRowSource>,
): InventoryRowSource => ({
  kind: "import",
  fileName: "inventory-q4.xlsx",
  changedBy: "สมชาย",
  changedAt: "2026-11-21T20:30:00.000Z",
  ...overrides,
});

describe("row source (S7.5)", () => {
  it("names the file of an import and the edit of a change made in the system", () => {
    expect(sourceLabel(source({}))).toBe("import จาก inventory-q4.xlsx");
    expect(sourceLabel(source({ kind: "manual", fileName: null }))).toBe(
      "แก้ในระบบ",
    );
  });

  it("shows the actor and the time in the viewer's time zone, a different day from UTC", () => {
    expect(sourceWho(source({}), auckland)).toBe("สมชาย · 2026-11-22 09:30");
    expect(sourceWho(source({}), bangkok)).toBe("สมชาย · 2026-11-22 03:30");
  });

  it("keeps the time and says the account is gone when the actor no longer exists", () => {
    expect(sourceWho(source({ changedBy: null }), auckland)).toBe(
      "ผู้ใช้ที่ถูกลบแล้ว · 2026-11-22 09:30",
    );
  });
});
