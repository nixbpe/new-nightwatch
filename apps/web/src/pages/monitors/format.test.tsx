import { describe, expect, it } from "vitest";

import { formatPercent } from "./format";

describe("formatPercent", () => {
  it("always shows 2 decimals", () => {
    expect(formatPercent(41)).toBe("41.00");
    expect(formatPercent(40.77)).toBe("40.77");
    expect(formatPercent(99.99)).toBe("99.99");
    expect(formatPercent(0)).toBe("0.00");
  });

  it("keeps the API's 2-decimal value instead of re-rounding it", () => {
    expect(formatPercent(1.15)).toBe("1.15");
    expect(formatPercent(2.3)).toBe("2.30");
  });
});
