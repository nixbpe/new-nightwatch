import { describe, expect, it } from "vitest";

import { NO_FILTERS } from "./filters";
import { selectFix } from "./fixSelect";
import {
  fresh,
  list,
  newItem,
  priority,
  SYSTEM,
  SYSTEM_2,
  component,
} from "./vulnerabilities-test-support";

const placed = (...cves: string[]) =>
  fresh({ items: cves.map((cve) => newItem(cve)) });

describe("selectFix", () => {
  it("counts the tiles from the ranking, not from the filter", () => {
    const view = selectFix(priority(), list(), placed("CVE-2024-0001"), {
      ...NO_FILTERS,
      isNew: true,
    });
    expect(view.tiles).toEqual({ fix: 2, kev: 1, severe: 1, fresh: 1 });
    expect(view.ranked.map((item) => item.cveId)).toEqual(["CVE-2024-0001"]);
  });

  it("puts every new entry in exactly one place", () => {
    const items = [
      newItem("CVE-2024-0001"),
      newItem("CVE-2024-7777", { stillFound: false }),
      newItem("CVE-2024-8888", { stillFound: null }),
      newItem("CVE-2024-9999", { stillFound: true }),
    ];
    const view = selectFix(priority(), list(), fresh({ items }), {
      ...NO_FILTERS,
      isNew: true,
    });
    const count =
      view.ranked.length +
      view.notAffected.length +
      view.gone.length +
      view.unknown.length;
    expect(count).toBe(items.length);
    expect(view.gone.map((item) => item.cveId)).toEqual(["CVE-2024-7777"]);
    expect(view.unknown.map((item) => item.cveId)).toEqual([
      "CVE-2024-8888",
      "CVE-2024-9999",
    ]);
    expect(view.newTotal).toBe(4);
  });

  it("leaves the gone and unknown groups out without the new filter", () => {
    const view = selectFix(
      priority(),
      list(),
      fresh({ items: [newItem("CVE-2024-7777", { stillFound: false })] }),
      NO_FILTERS,
    );
    expect(view.gone).toEqual([]);
    expect(view.ranked).toHaveLength(2);
  });

  it("applies the System filter to the groups through the System of the component", () => {
    const data = list({
      components: [
        ...list().components,
        component({
          systemId: SYSTEM_2,
          system: "HR Portal",
          product: "Quiet",
          mappingId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
        }),
      ],
    });
    const items = fresh({
      items: [newItem("CVE-2024-7777", { stillFound: false })],
    });
    const mine = selectFix(priority(), data, items, {
      ...NO_FILTERS,
      isNew: true,
      system: SYSTEM,
    });
    expect(mine.gone).toHaveLength(1);
    const other = selectFix(priority(), data, items, {
      ...NO_FILTERS,
      isNew: true,
      system: SYSTEM_2,
    });
    expect(other.gone).toHaveLength(0);
  });

  it("drops the groups under 'ยังไม่ triage', which a gone CVE cannot be", () => {
    const view = selectFix(
      priority(),
      list(),
      fresh({ items: [newItem("CVE-2024-7777", { stillFound: false })] }),
      { ...NO_FILTERS, isNew: true, untriaged: true },
    );
    expect(view.gone).toEqual([]);
  });

  it.each([
    ["unknown", null],
    ["gone", false],
  ] as const)(
    "shows a ranked CVE the latest scan reports as %s once, in its group, and keeps the total",
    (_name, stillFound) => {
      // The ranking comes from the earlier finished run; the new list from a newer failed one.
      const view = selectFix(
        priority(),
        list(),
        fresh({ items: [newItem("CVE-2024-0001", { stillFound })] }),
        { ...NO_FILTERS, isNew: true },
      );
      expect(view.ranked).toEqual([]);
      expect(view.notAffected).toEqual([]);
      expect(view.gone.length + view.unknown.length).toBe(1);
      expect(view.newTotal).toBe(1);
      expect(view.tiles.fresh).toBe(0);
    },
  );

  it("keeps a still-found ranked CVE in the ranking and out of the groups", () => {
    const view = selectFix(
      priority(),
      list(),
      fresh({ items: [newItem("CVE-2024-0001")] }),
      { ...NO_FILTERS, isNew: true },
    );
    expect(view.ranked.map((item) => item.cveId)).toEqual(["CVE-2024-0001"]);
    expect(view.gone.length + view.unknown.length).toBe(0);
    expect(view.tiles.fresh).toBe(1);
  });
});
