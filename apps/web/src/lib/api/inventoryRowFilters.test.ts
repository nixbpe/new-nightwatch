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
      environment: "Non-production",
      exposure: "Internet-facing",
      owner: "ทีม A",
      status: "rejected",
      q: "ubuntu",
      page: 3,
    } as const;

    expect(writeFilters(filters).toString()).toBe(
      `system=${SYSTEM}&layer=DB&environment=Non-production&exposure=Internet-facing&owner=%E0%B8%97%E0%B8%B5%E0%B8%A1+A&status=rejected&q=ubuntu&page=3`,
    );
    expect(readFilters(writeFilters(filters))).toEqual(filters);
    expect(toQuery(filters)).toEqual({
      system: SYSTEM,
      layer: "DB",
      environment: "Non-production",
      exposure: "Internet-facing",
      owner: "ทีม A",
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
    expect(hasFilters({ ...NO_FILTERS, environment: "Production" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, exposure: "Isolated" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, owner: "ทีม" })).toBe(true);
    expect(toQuery(NO_FILTERS)).toEqual({ status: "all", page: 1 });
  });

  it("ignores an Environment or Exposure outside the lists and bounds the Owner", () => {
    expect(
      readFilters(
        new URLSearchParams(
          `environment=staging&exposure=Public&owner=%20${"a".repeat(300)}`,
        ),
      ),
    ).toEqual({ ...NO_FILTERS, owner: "a".repeat(200) });
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
