import { describe, expect, it, vi } from "vitest";

import type { Database } from "@nightwatch/db";

import {
  missingPartitionNames,
  partitionSuffixesAhead,
} from "./partition-horizon";

const now = new Date("2026-12-31T23:59:59Z");

function databaseWith(names: string[]) {
  const query = vi.fn().mockResolvedValue({
    rows: names.map((relname) => ({ relname })),
  });
  return { database: { sql: { query } } as unknown as Database, query };
}

describe("partitionSuffixesAhead", () => {
  it.each([
    ["2026-09-30T00:00:00Z", 2, ["202610", "202611"]],
    ["2026-11-15T00:00:00Z", 2, ["202612", "202701"]],
    ["2026-12-31T23:59:59Z", 2, ["202701", "202702"]],
    ["2026-12-31T23:30:00-02:00", 3, ["202702", "202703", "202704"]],
    ["2028-01-31T23:59:59Z", 3, ["202802", "202803", "202804"]],
    ["2026-12-31T23:59:59Z", 0, []],
  ])(
    "lists future UTC months from %s with count %i",
    (date, count, expected) => {
      expect(partitionSuffixesAhead(new Date(date), count)).toEqual(expected);
    },
  );
});

describe("missingPartitionNames", () => {
  it("reports a partial horizon in parent then month order, excluding current and past months", async () => {
    const { database, query } = databaseWith([
      "monitor_check_hourly_p202702",
      "monitor_check_results_p202701",
      "monitor_check_results_p202612",
      "monitor_check_hourly_p202611",
      "audit_events_p202702",
    ]);
    await expect(
      missingPartitionNames(
        database,
        ["monitor_check_results", "monitor_check_hourly"],
        now,
        3,
      ),
    ).resolves.toEqual([
      "monitor_check_results_p202702",
      "monitor_check_results_p202703",
      "monitor_check_hourly_p202701",
      "monitor_check_hourly_p202703",
    ]);
    expect(query).toHaveBeenCalledOnce();
    const [text, values] = query.mock.calls[0] as [string, unknown[]];
    expect(text.trim().startsWith("select c.relname")).toBe(true);
    expect(text).toContain("from pg_inherits as i");
    expect(text).toContain("c.oid = i.inhrelid");
    expect(text).toContain("parent.oid = i.inhparent");
    expect(text).toContain("parent.relnamespace = 'public'::regnamespace");
    expect(text).toContain("parent.relname = any($1::text[])");
    expect(values).toEqual([["monitor_check_results", "monitor_check_hourly"]]);
  });

  it("does not let another parent's matching months satisfy the audit horizon", async () => {
    const { database, query } = databaseWith([
      "monitor_check_results_p202701",
      "monitor_check_results_p202702",
      "monitor_check_hourly_p202701",
      "audit_events_p202702",
    ]);
    await expect(
      missingPartitionNames(database, ["audit_events"], now, 2),
    ).resolves.toEqual(["audit_events_p202701"]);
    expect(query.mock.calls[0]?.[1]).toEqual([["audit_events"]]);
  });

  it("returns no missing names for a complete horizon", async () => {
    const { database } = databaseWith([
      "audit_events_p202701",
      "audit_events_p202702",
    ]);
    await expect(
      missingPartitionNames(database, ["audit_events"], now, 2),
    ).resolves.toEqual([]);
  });

  it("propagates catalog failures without reporting false missing names", async () => {
    const { database, query } = databaseWith([]);
    const failure = new Error("catalog unavailable");
    query.mockRejectedValueOnce(failure);
    await expect(
      missingPartitionNames(database, ["audit_events"], now, 2),
    ).rejects.toBe(failure);
    expect(query).toHaveBeenCalledOnce();
  });
});
