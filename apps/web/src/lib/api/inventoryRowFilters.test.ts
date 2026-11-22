import { describe, expect, it } from "vitest";

import {
  hasFilters,
  NO_FILTERS,
  readFilters,
  toQuery,
  writeFilters,
} from "./inventoryRowFilters";

const SYSTEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

describe("row filters in the URL", () => {
  it("keeps the filters and the page through the address", () => {
    const filters = {
      system: SYSTEM,
      layer: "DB",
      status: "rejected",
      q: "ubuntu",
      page: 3,
    } as const;

    expect(writeFilters(filters).toString()).toBe(
      `system=${SYSTEM}&layer=DB&status=rejected&q=ubuntu&page=3`,
    );
    expect(readFilters(writeFilters(filters))).toEqual(filters);
    expect(toQuery(filters)).toEqual({
      system: SYSTEM,
      layer: "DB",
      status: "rejected",
      q: "ubuntu",
      page: 3,
    });
  });

  it("leaves defaults out of the address", () => {
    expect(writeFilters(NO_FILTERS).toString()).toBe("");
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, page: 2 })).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, status: "duplicate" })).toBe(true);
  });

  it("ignores each bad value on its own and keeps the good ones", () => {
    expect(
      readFilters(
        new URLSearchParams(
          `system=nope&layer=Kernel&status=all&q=%20redis%20&page=-4`,
        ),
      ),
    ).toEqual({ ...NO_FILTERS, q: "redis" });
    expect(
      readFilters(new URLSearchParams(`status=rejected&page=2&layer=OS`)),
    ).toEqual({ ...NO_FILTERS, status: "rejected", page: 2, layer: "OS" });
  });
});
