import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { Database } from "@nightwatch/db";

import { monitorCheckJobId } from "./queue";
import { MonitorScheduler, startMonitorSchedule } from "./scheduler";

const logger = { error: () => undefined, warn: () => undefined } as never;

describe("monitor scheduler job ids", () => {
  it("derives a stable job id from monitor id and claim token only", () => {
    const id = monitorCheckJobId("monitor-1", "token-a");
    expect(id).toMatch(/^monitor-check-[0-9a-f]{64}$/);
    expect(monitorCheckJobId("monitor-1", "token-a")).toBe(id);
    expect(monitorCheckJobId("monitor-1", "token-b")).not.toBe(id);
    expect(monitorCheckJobId("monitor-2", "token-a")).not.toBe(id);
  });
});

describe("startMonitorSchedule", () => {
  it("stop waits for the in-flight round and prevents later rounds", async () => {
    let started = 0;
    let finished = 0;
    const gate = Promise.withResolvers<undefined>();
    let inFlight: Promise<void> | null = null;
    const scheduler = {
      round: () => {
        started += 1;
        inFlight = gate.promise.then(() => {
          finished += 1;
        });
        return inFlight;
      },
      idle: async () => {
        await inFlight;
      },
      stop: () => undefined,
    };
    const handle = startMonitorSchedule(scheduler, logger, 5);
    try {
      expect(started).toBe(1);
      expect(finished).toBe(0);
      const stopping = handle.stop();
      await expect(
        Promise.race([
          stopping.then(() => "stopped"),
          new Promise((resolve) =>
            setTimeout(() => {
              resolve("pending");
            }, 0),
          ),
        ]),
      ).resolves.toBe("pending");
      gate.resolve(undefined);
      await stopping;
      expect(finished).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(started).toBe(1);
    } finally {
      gate.resolve(undefined);
      await handle.stop();
    }
  });
});

const workerEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

/** Runs the Worker entry with the given roles; role checks fail before any connection. */
function runWorker(
  roles: string,
): Promise<{ code: number | null; output: string }> {
  const { promise, resolve } = Promise.withResolvers<{
    code: number | null;
    output: string;
  }>();
  const child = spawn("bun", ["run", workerEntry], {
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
      REDIS_URL: "redis://127.0.0.1:1",
      WORKER_ROLES: roles,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.once("close", (code) => {
    resolve({ code, output });
  });
  return promise;
}

describe("WORKER_ROLES parsing", () => {
  it("still fails for an unknown role", async () => {
    const result = await runWorker("consumer,bogus");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("WORKER_ROLES has unknown role: bogus");
  });
});

describe("MonitorScheduler partition horizon", () => {
  function setup() {
    let now = new Date("2026-12-31T23:59:59Z");
    const catalog = vi.fn(() =>
      Promise.resolve({
        rows: [
          { relname: "monitor_check_results_p202701" },
          { relname: "monitor_check_hourly_p202702" },
          { relname: "audit_events_p202702" },
        ],
      }),
    );
    const query = vi.fn(async (text: string) => {
      if (text.includes("pg_inherits")) return catalog();
      return { rows: [] };
    });
    const database = { sql: { query } } as unknown as Database;
    const log = { error: vi.fn(), warn: vi.fn() };
    const scheduler = new MonitorScheduler(
      database,
      {} as never,
      log as never,
      {
        now: () => now,
      },
    );
    return {
      catalog,
      query,
      log,
      scheduler,
      setNow: (date: string) => {
        now = new Date(date);
      },
    };
  }

  it("warns with the two-month default horizon and rechecks exactly hourly from the successful query's start", async () => {
    const f = setup();
    const catalogGate = Promise.withResolvers<undefined>();
    const catalogStarted = Promise.withResolvers<undefined>();
    f.catalog.mockImplementationOnce(async () => {
      catalogStarted.resolve(undefined);
      await catalogGate.promise;
      return { rows: [] };
    });
    const round = f.scheduler.round();
    await catalogStarted.promise;
    f.setNow("2027-01-01T00:29:59Z");
    catalogGate.resolve(undefined);
    await round;
    expect(f.log.warn).toHaveBeenCalledWith(
      {
        missing: [
          "monitor_check_results_p202701",
          "monitor_check_results_p202702",
          "monitor_check_hourly_p202701",
          "monitor_check_hourly_p202702",
        ],
        monthsAheadRequired: 2,
      },
      "monitor partitions ahead are below the required horizon; run db:partitions",
    );
    f.setNow("2027-01-01T00:59:58.999Z");
    await f.scheduler.round();
    expect(f.catalog).toHaveBeenCalledOnce();
    expect(f.log.warn).toHaveBeenCalledOnce();
    f.setNow("2027-01-01T00:59:59Z");
    await f.scheduler.round();
    expect(f.catalog).toHaveBeenCalledTimes(2);
    expect(f.log.warn).toHaveBeenLastCalledWith(
      {
        missing: [
          "monitor_check_results_p202702",
          "monitor_check_results_p202703",
          "monitor_check_hourly_p202703",
        ],
        monthsAheadRequired: 2,
      },
      "monitor partitions ahead are below the required horizon; run db:partitions",
    );
    expect(
      f.query.mock.calls.map(([text]) =>
        text.includes("pg_inherits") ? "catalog" : text,
      ),
    ).toEqual([
      "catalog",
      "select * from claim_due_monitor_checks($1)",
      "select purge_expired_monitor_data($1) as deleted",
      "select * from claim_due_monitor_checks($1)",
      "select purge_expired_monitor_data($1) as deleted",
      "catalog",
      "select * from claim_due_monitor_checks($1)",
      "select purge_expired_monitor_data($1) as deleted",
    ]);
  });

  it("retries a failed catalog query next round while claims and purge continue", async () => {
    const f = setup();
    f.catalog.mockRejectedValueOnce(new TypeError("secret connection string"));
    await f.scheduler.round();
    expect(f.log.warn).not.toHaveBeenCalled();
    expect(f.log.error).toHaveBeenCalledWith(
      { errorName: "TypeError" },
      "partition check failed",
    );
    await f.scheduler.round();
    await f.scheduler.round();
    expect(f.catalog).toHaveBeenCalledTimes(2);
    expect(f.log.warn).toHaveBeenCalledOnce();
    expect(f.log.warn).toHaveBeenCalledWith(
      {
        missing: [
          "monitor_check_results_p202702",
          "monitor_check_hourly_p202701",
        ],
        monthsAheadRequired: 2,
      },
      "monitor partitions ahead are below the required horizon; run db:partitions",
    );
    expect(
      f.query.mock.calls.map(([text]) =>
        text.includes("pg_inherits") ? "catalog" : text,
      ),
    ).toEqual([
      "catalog",
      "select * from claim_due_monitor_checks($1)",
      "select purge_expired_monitor_data($1) as deleted",
      "catalog",
      "select * from claim_due_monitor_checks($1)",
      "select purge_expired_monitor_data($1) as deleted",
      "select * from claim_due_monitor_checks($1)",
      "select purge_expired_monitor_data($1) as deleted",
    ]);
  });

  it("keeps the successful query timestamp even if warning emission fails", async () => {
    const f = setup();
    f.log.warn.mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });
    await f.scheduler.round();
    await f.scheduler.round();
    expect(f.catalog).toHaveBeenCalledOnce();
    expect(f.log.error).toHaveBeenCalledWith(
      { errorName: "Error" },
      "partition check failed",
    );
  });
});

describe("MonitorScheduler stop", () => {
  it("enqueues the batch it already claimed and claims no more once stop() is called mid-round", async () => {
    let claims = 0;
    const firstClaim = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const row = () => ({
      monitor_id: "m",
      tenant_id: "t",
      claim_token: "c",
      check_config_version: 1,
      scheduled_for: new Date(),
    });
    const database = {
      sql: {
        query: async (text: string) => {
          if (!text.includes("claim_due_monitor_checks")) return { rows: [] };
          claims += 1;
          firstClaim.resolve(undefined);
          await release.promise;
          // A full batch, so an unstopped round would go on claiming.
          return { rows: Array.from({ length: 10 }, row) };
        },
      },
    } as unknown as Database;
    const added: string[] = [];
    const queue = {
      add: (name: string) => {
        added.push(name);
        return Promise.resolve();
      },
      waitUntilReady: () => Promise.resolve(),
      close: () => Promise.resolve(),
    } as never;
    const scheduler = new MonitorScheduler(database, queue, logger);

    const round = scheduler.round();
    await firstClaim.promise;
    scheduler.stop();
    release.resolve(undefined);
    await round;

    expect(claims).toBe(1);
    expect(added).toHaveLength(10);
    await scheduler.round();
    expect(claims).toBe(1);
  });
});
