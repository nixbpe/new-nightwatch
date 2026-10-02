import { describe, expect, it } from "vitest";

import { DEFAULT_FILTERS, parseAuditFilters } from "../../lib/api/audit-log";
import { customRangeError, hasActiveFilters } from "./filters";

const parse = (search: string) =>
  parseAuditFilters(new URLSearchParams(search));

describe("active filters", () => {
  it("separates the default view from a filtered one", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters(parse("page=4"))).toBe(false);
    expect(hasActiveFilters(parse("range=24h"))).toBe(true);
    expect(hasActiveFilters(parse("q=x"))).toBe(true);
  });
});

describe("custom range validation", () => {
  const custom = (from?: string, to?: string) =>
    parse(`range=custom${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`);

  it("rejects a start after the end", () => {
    expect(
      customRangeError(custom("2026-10-02", "2026-10-01"), undefined),
    ).toBe("start-after-end");
  });

  it("rejects a start before the retained day, compared as dates", () => {
    expect(
      customRangeError(custom("2025-10-02", "2026-10-01"), "2025-10-03"),
    ).toBe("before-retention");
    expect(
      customRangeError(custom("2025-10-03"), "2025-10-03"),
    ).toBeUndefined();
  });

  it("does not guess retention before a list has loaded", () => {
    expect(customRangeError(custom("2020-01-01"), undefined)).toBeUndefined();
    expect(customRangeError(DEFAULT_FILTERS, "2026-01-01")).toBeUndefined();
  });
});
