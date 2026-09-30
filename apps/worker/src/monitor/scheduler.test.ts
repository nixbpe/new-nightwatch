import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Database } from "@nightwatch/db";

import { monitorCheckJobId } from "./queue";
import {
  aheadSuffixes,
  MonitorScheduler,
  MONITOR_SCHEDULER_INTERVAL_MS,
  startMonitorSchedule,
} from "./scheduler";

const logger = { error: () => undefined, warn: () => undefined } as never;

describe("monitor scheduler constants and ids", () => {
  it("polls every 10 seconds in production", () => {
    expect(MONITOR_SCHEDULER_INTERVAL_MS).toBe(10_000);
  });

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
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stopping = handle.stop();
    gate.resolve(undefined);
    await stopping;
    const startedAtStop = started;
    expect(finished).toBe(started);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started).toBe(startedAtStop);
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

describe("aheadSuffixes", () => {
  it.each([
    ["2026-09-30T00:00:00Z", ["202610", "202611"]],
    ["2026-11-15T00:00:00Z", ["202612", "202701"]],
    ["2026-12-31T23:59:59Z", ["202701", "202702"]],
  ])("lists the next two UTC months after %s", (now, expected) => {
    expect(aheadSuffixes(new Date(now))).toEqual(expected);
  });
});

describe("MonitorScheduler stop", () => {
  it("claims nothing more and enqueues nothing once stop() is called mid-round", async () => {
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
    expect(added).toEqual([]);
    // A later round is a no-op too.
    await scheduler.round();
    expect(claims).toBe(1);
  });
});
