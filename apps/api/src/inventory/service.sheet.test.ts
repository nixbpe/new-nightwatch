import { describe, expect, it } from "vitest";

import { sheetName } from "./service";

describe("sheetName", () => {
  it("keeps Excel's 31-unit limit for emoji, apostrophes and collisions", () => {
    const used = new Set<string>();
    const names = ["😀".repeat(20), "'ทีม'", "ทีม:A/B", "same", "SAME", ""].map(
      (owner) => sheetName(owner, used),
    );
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/^'|'$|[[\]:*?/\\]/);
    }
    expect(names[1]).toBe("ทีม");
    expect(names[2]).toBe("ทีม A B");
    expect(names.slice(3, 5)).toEqual(["same", "SAME 2"]);
    expect(names[5]).toBe("(ไม่ระบุ Owner)");
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length,
    );
  });
});
