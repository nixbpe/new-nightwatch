import { describe, expect, it } from "vitest";

import {
  hasFilters,
  NO_FILTERS,
  parseFilters,
  parseView,
  toSearch,
  type FixFilters,
} from "./filters";

describe("view and filters in the URL", () => {
  const all: FixFilters = {
    system: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    isNew: true,
    kev: true,
    severe: true,
    untriaged: true,
  };

  it("round-trips every filter through the query string", () => {
    const search = toSearch("fix", all);
    expect(search.toString()).toBe(
      "system=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1&new=1&kev=1&severity=critical-high&untriaged=1",
    );
    expect(parseFilters(new URLSearchParams(search.toString()))).toEqual(all);
    expect(parseView(search)).toBe("fix");
  });

  it("leaves no key for the default view or an unset filter", () => {
    expect(toSearch("fix", NO_FILTERS).toString()).toBe("");
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, kev: true })).toBe(true);
  });

  it("keeps the view and drops filters on the By-System view", () => {
    const search = toSearch("systems", all);
    expect(search.toString()).toBe("view=systems");
    expect(parseView(search)).toBe("systems");
  });

  it("falls back to the default view and no filter for anything it does not know", () => {
    const params = new URLSearchParams("view=other&kev=yes&severity=low&new=0");
    expect(parseView(params)).toBe("fix");
    expect(parseFilters(params)).toEqual(NO_FILTERS);
  });
});
