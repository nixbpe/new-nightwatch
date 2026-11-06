import { afterEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@nightwatch/db";

import { runAuditMaintenance, startAuditMaintenance } from "./maintenance";

const now = new Date("2026-12-31T23:59:59Z");

function setup() {
  const events = vi.fn(() => Promise.resolve(0));
  const exports = vi.fn(() => Promise.resolve(0));
  const catalog = vi.fn(() =>
    Promise.resolve([
      "audit_events_p202702",
      "monitor_check_results_p202701",
      "monitor_check_results_p202702",
    ]),
  );
  const query = vi.fn(async (...[text]: [string, unknown[]?]) => {
    if (text === "select purge_expired_audit_events($1) as deleted") {
      return { rows: [{ deleted: await events() }] };
    }
    if (text === "select purge_audit_exports($1) as purged") {
      return { rows: [{ purged: await exports() }] };
    }
    if (text.includes("pg_inherits")) {
      return { rows: (await catalog()).map((relname) => ({ relname })) };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const database = { sql: { query } } as unknown as Database;
  const logger = { error: vi.fn(), warn: vi.fn() };
  return { database, logger, events, exports, catalog, query };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runAuditMaintenance", () => {
  it("drains events then exports before the read-only two-month audit horizon check", async () => {
    const f = setup();
    f.events.mockResolvedValueOnce(5000).mockResolvedValueOnce(3);
    f.exports.mockResolvedValueOnce(500).mockResolvedValueOnce(1);
    await runAuditMaintenance(f.database, f.logger as never, now);
    expect(
      f.query.mock.calls.map(([text, values]) => [
        text.includes("pg_inherits") ? "catalog" : text,
        values,
      ]),
    ).toEqual([
      ["select purge_expired_audit_events($1) as deleted", [5000]],
      ["select purge_expired_audit_events($1) as deleted", [5000]],
      ["select purge_audit_exports($1) as purged", [500]],
      ["select purge_audit_exports($1) as purged", [500]],
      ["catalog", [["audit_events"]]],
    ]);
    expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith(
      {
        missing: ["audit_events_p202701"],
        monthsAheadRequired: 2,
      },
      "audit_events partitions ahead are below the required horizon; run db:partitions",
    );
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it("does not warn when the full audit horizon is present", async () => {
    const f = setup();
    f.catalog.mockResolvedValue([
      "audit_events_p202701",
      "audit_events_p202702",
    ]);
    await runAuditMaintenance(f.database, f.logger as never, now);
    expect(f.logger.warn).not.toHaveBeenCalled();
  });

  it.each(["events", "exports"] as const)(
    "checks partitions even when %s purge fails",
    async (phase) => {
      const f = setup();
      f[phase].mockRejectedValueOnce(new Error("secret connection string"));
      await expect(
        runAuditMaintenance(f.database, f.logger as never, now),
      ).resolves.toBeUndefined();
      expect(f.events).toHaveBeenCalledOnce();
      expect(f.exports).toHaveBeenCalledTimes(phase === "events" ? 0 : 1);
      expect(f.catalog).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
        {},
        "audit retention purge failed",
      );
      expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith(
        {
          missing: ["audit_events_p202701"],
          monthsAheadRequired: 2,
        },
        "audit_events partitions ahead are below the required horizon; run db:partitions",
      );
    },
  );

  it("logs a catalog failure and checks again on the next run without skipping purges", async () => {
    const f = setup();
    f.catalog.mockRejectedValueOnce(new Error("secret connection string"));
    await runAuditMaintenance(f.database, f.logger as never, now);
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith(
      {},
      "audit partition check failed",
    );
    expect(f.logger.warn).not.toHaveBeenCalled();
    await runAuditMaintenance(f.database, f.logger as never, now);
    expect(f.events).toHaveBeenCalledTimes(2);
    expect(f.exports).toHaveBeenCalledTimes(2);
    expect(f.catalog).toHaveBeenCalledTimes(2);
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });

  it("leaves each purge's remaining work after 100 full batches and still checks partitions", async () => {
    const f = setup();
    f.events.mockResolvedValue(5000);
    f.exports.mockResolvedValue(500);
    f.catalog.mockResolvedValue([
      "audit_events_p202701",
      "audit_events_p202702",
    ]);
    await runAuditMaintenance(f.database, f.logger as never, now);
    expect(f.events).toHaveBeenCalledTimes(100);
    expect(f.exports).toHaveBeenCalledTimes(100);
    expect(f.catalog).toHaveBeenCalledOnce();
    expect(f.logger.warn.mock.calls).toEqual([
      [
        { what: "audit events", batches: 100 },
        "audit purge stopped at the batch guard; the rest is left for the next run",
      ],
      [
        { what: "audit exports", batches: 100 },
        "audit purge stopped at the batch guard; the rest is left for the next run",
      ],
    ]);
  });
});

describe("startAuditMaintenance", () => {
  it("runs immediately and hourly, and stops future runs when disposed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = setup();
    const stop = startAuditMaintenance(f.database, f.logger as never);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(f.catalog).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3_599_999);
      expect(f.catalog).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.catalog).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(f.catalog).toHaveBeenCalledTimes(2);
      expect(f.events).toHaveBeenCalledTimes(2);
      expect(f.exports).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });
});
