// End-to-end runs of the monitor-checker role: a real Worker process, the real
// scheduler with an injected 1 s poll, a throwaway Postgres and Redis. The
// child resolves names through test-dns-preload.ts (a local stub of the SSRF
// helper's lookup), so no production code path is bypassed.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "@nightwatch/shared";
import type { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createMonitorCheckQueue,
  MONITOR_CHECK_JOB_OPTIONS,
  monitorCheckJobId,
  type MonitorCheckJob,
} from "./queue";
import { MonitorScheduler, startMonitorSchedule } from "./scheduler";
import {
  rows,
  seedMonitor,
  startTarget,
  startTestDatabase,
  startTestRedis,
  TARGET_HOST,
  updateMonitor,
  type SeededMonitor,
  type Target,
  type TestDatabase,
  type TestRedis,
} from "./test-harness";

const workerEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const preload = fileURLToPath(
  new URL("./test-dns-preload.ts", import.meta.url),
);
const silent = createLogger({ level: "silent", name: "checker-process-test" });

let db!: TestDatabase;
let redis!: TestRedis;
let queue!: Queue<MonitorCheckJob>;
let dnsDir = "";
let dnsFile = "";
const children: WorkerProcess[] = [];
const stops: { stop(): Promise<void> }[] = [];
const targets: Target[] = [];

type WorkerProcess = {
  child: ChildProcess;
  output: string[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

function writeDns(map: Record<string, string>): void {
  writeFileSync(dnsFile, JSON.stringify(map));
}

function spawnWorker(): Promise<WorkerProcess> {
  const output: string[] = [];
  const child = spawn("bun", ["run", "--preload", preload, workerEntry], {
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: db.runtimeUrl,
      REDIS_URL: redis.url,
      WORKER_ROLES: "monitor-checker",
      OUTBOUND_TEST_ALLOWED_HOSTS: TARGET_HOST,
      NW_TEST_DNS_FILE: dnsFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  const worker = { child, output, exited };
  children.push(worker);
  const ready = Promise.withResolvers<WorkerProcess>();
  const onData = (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.join("").includes("monitor worker ready")) {
      ready.resolve(worker);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  void exited.then(() => {
    ready.reject(new Error(`worker exited early: ${output.join("")}`));
  });
  return ready.promise;
}

async function waitFor<T>(
  read: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function resultCount(monitor: SeededMonitor): Promise<number> {
  return rows<{ count: number }>(
    db,
    monitor,
    "select count(*)::int as count from monitor_check_results where monitor_id = $1",
    [monitor.monitorId],
  ).then((found) => found[0]?.count ?? 0);
}

/** A monitor as Create leaves it: due now, not claimed. */
async function seedDue(
  url: string,
  options: { intervalSeconds?: number; timeoutSeconds?: number } = {},
): Promise<SeededMonitor> {
  const monitor = await seedMonitor(db, {
    url,
    timeoutSeconds: 10,
    ...options,
  });
  await updateMonitor(
    db,
    monitor,
    `update monitor_schedule set claim_token = null, claimed_until = null,
       next_check_at = now() where monitor_id = $1`,
    [monitor.monitorId],
  );
  return monitor;
}

function startScheduler(
  intervalMs = 1_000,
  target: ConstructorParameters<typeof MonitorScheduler>[1] = queue,
) {
  const handle = startMonitorSchedule(
    new MonitorScheduler(db.runtime, target, silent),
    silent,
    intervalMs,
  );
  stops.push(handle);
  return handle;
}

beforeAll(async () => {
  [db, redis] = await Promise.all([
    startTestDatabase("checker-process"),
    startTestRedis("checker-process"),
  ]);
  queue = createMonitorCheckQueue(redis.url);
  queue.on("error", () => undefined);
  dnsDir = mkdtempSync(join(tmpdir(), "nw-checker-dns-"));
  dnsFile = join(dnsDir, "hosts.json");
  writeDns({ [TARGET_HOST]: "127.0.0.1" });
}, 120_000);

afterEach(async () => {
  for (const handle of stops.splice(0)) await handle.stop();
  for (const { child, exited } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await exited;
  }
  for (const target of targets.splice(0)) await target.close();
  await queue.obliterate({ force: true }).catch(() => undefined);
  await db.owner.sql.query("delete from organization where name = 'Checker'");
});

afterAll(async () => {
  await queue.close().catch(() => undefined);
  rmSync(dnsDir, { recursive: true, force: true });
  await Promise.all([db.stop(), redis.stop()]);
}, 60_000);

async function target(
  handler?: Parameters<typeof startTarget>[0],
): Promise<Target> {
  const started = await startTarget(handler);
  targets.push(started);
  return started;
}

describe("monitor-checker process", () => {
  it("records the first result at the next poll after Create and after Resume (AC-54)", async () => {
    const answering = await target();
    await spawnWorker();
    // The scheduler is already polling when the monitor is created, so the
    // first result waits for the next poll.
    startScheduler();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const monitor = await seedDue(`${answering.url}/`);
    const created = Date.now();
    await waitFor(
      async () => (await resultCount(monitor)) >= 1,
      10_000,
      "first result after Create",
    );
    const createMs = Date.now() - created;

    // Pause, then Resume as the API does: next_check_at null, then now().
    await updateMonitor(
      db,
      monitor,
      `update monitor_schedule set next_check_at = null, claim_token = null
       where monitor_id = $1`,
      [monitor.monitorId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const pausedCount = await resultCount(monitor);
    await updateMonitor(
      db,
      monitor,
      "update monitor_schedule set next_check_at = now() where monitor_id = $1",
      [monitor.monitorId],
    );
    const resumed = Date.now();
    await waitFor(
      async () => (await resultCount(monitor)) > pausedCount,
      10_000,
      "first result after Resume",
    );
    const resumeMs = Date.now() - resumed;

    // One poll is 1 s here; a slot is never checked twice while paused.
    expect(createMs).toBeLessThan(5_000);
    expect(resumeMs).toBeLessThan(5_000);
    console.info(
      `first result after Create: ${String(createMs)} ms, after Resume: ${String(resumeMs)} ms (poll 1000 ms)`,
    );
  }, 60_000);

  it("two Worker processes never run one claim twice: requests equal recorded rows", async () => {
    const answering = await target();
    await Promise.all([spawnWorker(), spawnWorker()]);
    const monitors: SeededMonitor[] = [];
    for (let index = 0; index < 12; index += 1) {
      monitors.push(
        await seedDue(`${answering.url}/`, {
          intervalSeconds: 3,
          timeoutSeconds: 2,
        }),
      );
    }
    const scheduler = startScheduler(500);
    await waitFor(
      async () => {
        const counts = await Promise.all(monitors.map(resultCount));
        return counts.every((count) => count >= 2);
      },
      20_000,
      "two rounds of results",
    );
    await scheduler.stop();
    // Let in-flight checks finish, then compare what the target saw with the
    // ledger: a claim handled by both Workers would show as an extra request.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const recorded = (await Promise.all(monitors.map(resultCount))).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(answering.requests.length).toBe(recorded);
  }, 60_000);

  it("a job replayed under its real claim and id records no second result", async () => {
    const answering = await target();
    await spawnWorker();
    const monitor = await seedDue(`${answering.url}/`);
    const claimed: MonitorCheckJob[] = [];
    const recording = {
      add: (...args: Parameters<typeof queue.add>) => {
        claimed.push(args[1]);
        return queue.add(...args);
      },
      waitUntilReady: () => queue.waitUntilReady(),
      close: () => queue.close(),
    };
    const scheduler = startScheduler(1_000, recording);
    await waitFor(
      async () => (await resultCount(monitor)) === 1,
      10_000,
      "first result",
    );
    await scheduler.stop();
    const first = claimed.find((job) => job.monitorId === monitor.monitorId);
    if (!first) throw new Error("scheduler did not enqueue the monitor");
    // The finished job left the queue, so its id is free again while the
    // ledger no longer holds that claim: the checker must not record.
    const options = {
      ...MONITOR_CHECK_JOB_OPTIONS,
      jobId: monitorCheckJobId(first.monitorId, first.claimToken),
    };
    await queue.add("check", first, options);
    await queue.add("check", first, options);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await resultCount(monitor)).toBe(1);
    expect(answering.requests).toHaveLength(1);
  }, 60_000);

  it("SIGKILL mid-check leaves no result; after lease expiry the next claim records one", async () => {
    let release = false;
    const slow = await target((_request, response) => {
      const wait = setInterval(() => {
        if (!release) return;
        clearInterval(wait);
        response.statusCode = 200;
        response.end("late");
      }, 25);
    });
    const worker = await spawnWorker();
    const monitor = await seedDue(`${slow.url}/`);
    const scheduler = startScheduler();
    await waitFor(
      () => Promise.resolve(slow.requests.length >= 1),
      10_000,
      "request",
    );
    await scheduler.stop();
    worker.child.kill("SIGKILL");
    await worker.exited;
    expect(await resultCount(monitor)).toBe(0);

    // The lease of the killed check expires; a new Worker picks the claim up.
    release = true;
    await updateMonitor(
      db,
      monitor,
      `update monitor_schedule set claimed_until = now() - interval '1 second',
         next_check_at = now() - interval '1 second' where monitor_id = $1`,
      [monitor.monitorId],
    );
    await spawnWorker();
    startScheduler();
    await waitFor(
      async () => (await resultCount(monitor)) >= 1,
      15_000,
      "result after lease expiry",
    );
    const stored = await rows<{ outcome: string; http_status: number }>(
      db,
      monitor,
      "select outcome, http_status from monitor_check_results where monitor_id = $1",
      [monitor.monitorId],
    );
    expect(stored[0]).toEqual({ outcome: "pass", http_status: 200 });
  }, 60_000);

  it("SIGTERM waits for a running check, records it and exits 0", async () => {
    const slow = await target(
      (_request, response) =>
        void setTimeout(() => {
          response.statusCode = 200;
          response.end("done");
        }, 3_000),
    );
    const worker = await spawnWorker();
    const monitor = await seedDue(`${slow.url}/`);
    const scheduler = startScheduler();
    await waitFor(
      () => Promise.resolve(slow.requests.length >= 1),
      10_000,
      "request",
    );
    await scheduler.stop();
    const signalled = Date.now();
    worker.child.kill("SIGTERM");
    const exit = await worker.exited;
    const waitedMs = Date.now() - signalled;

    expect(exit.code).toBe(0);
    expect(waitedMs).toBeGreaterThan(1_500);
    expect(waitedMs).toBeLessThan(25_000);
    expect(await resultCount(monitor)).toBe(1);
    console.info(`SIGTERM waited ${String(waitedMs)} ms for a 3 s check`);
  }, 60_000);

  it("SIGTERM abandons a check that outlasts the drain window; that slot stays a gap", async () => {
    const hanging = await target(() => undefined);
    const worker = await spawnWorker();
    const monitor = await seedMonitor(db, {
      url: `${hanging.url}/`,
      timeoutSeconds: 30,
      intervalSeconds: 60,
    });
    await updateMonitor(
      db,
      monitor,
      `update monitor_schedule set claim_token = null, claimed_until = null,
         next_check_at = now() where monitor_id = $1`,
      [monitor.monitorId],
    );
    const scheduler = startScheduler();
    await waitFor(
      () => Promise.resolve(hanging.requests.length >= 1),
      10_000,
      "request",
    );
    await scheduler.stop();
    const signalled = Date.now();
    worker.child.kill("SIGTERM");
    const exit = await worker.exited;
    const waitedMs = Date.now() - signalled;

    expect(exit.code).toBe(0);
    expect(waitedMs).toBeGreaterThan(14_000);
    expect(waitedMs).toBeLessThan(25_000);
    expect(await resultCount(monitor)).toBe(0);
    console.info(
      `SIGTERM abandoned a hanging check after ${String(waitedMs)} ms`,
    );
  }, 60_000);

  it("a job that fails is not retried", async () => {
    const answering = await target();
    const worker = await spawnWorker();
    const monitor = await seedMonitor(db, { url: `${answering.url}/` });
    // No partition exists for next year, so recording the result throws.
    const nextYear = new Date(Date.now() + 366 * 86_400_000).toISOString();
    await queue.add(
      "check",
      {
        tenantId: monitor.tenantId,
        monitorId: monitor.monitorId,
        claimToken: monitor.claimToken,
        checkConfigVersion: 1,
        scheduledFor: nextYear,
      },
      {
        ...MONITOR_CHECK_JOB_OPTIONS,
        jobId: monitorCheckJobId(monitor.monitorId, monitor.claimToken),
      },
    );
    await waitFor(
      () =>
        Promise.resolve(
          worker.output.join("").includes("monitor check job failed"),
        ),
      10_000,
      "failed job log",
    );
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const log = worker.output.join("");
    expect(log.split("monitor check job failed").length - 1).toBe(1);
    expect(answering.requests).toHaveLength(1);
    expect(await resultCount(monitor)).toBe(0);
    expect(log).not.toContain(monitor.claimToken);
    // The failed record left the monitor exactly as the claim left it.
    const [state] = await rows<{
      claim_token: string | null;
      consecutive_failures: number;
      last_check_at: Date | null;
      hourly: number;
    }>(
      db,
      monitor,
      `select s.claim_token, m.consecutive_failures, m.last_check_at,
              (select count(*)::int from monitor_check_hourly where monitor_id = m.id) as hourly
       from monitors m join monitor_schedule s on s.monitor_id = m.id where m.id = $1`,
      [monitor.monitorId],
    );
    expect(state).toEqual({
      claim_token: monitor.claimToken,
      consecutive_failures: 0,
      last_check_at: null,
      hourly: 0,
    });
  }, 30_000);

  it("a name that resolves to loopback is blocked_address, counted as fail, and never contacted (AC-62)", async () => {
    const listener = await target();
    writeDns({
      [TARGET_HOST]: "127.0.0.1",
      "rebind.example.test": "127.0.0.1",
    });
    await spawnWorker();
    const monitor = await seedDue(
      `http://rebind.example.test:${String(listener.port)}/health`,
    );
    startScheduler();
    await waitFor(
      async () => (await resultCount(monitor)) >= 1,
      10_000,
      "blocked result",
    );
    const [row] = await rows<{
      outcome: string;
      failure_reason: string;
      url_masked: string;
    }>(
      db,
      monitor,
      "select outcome, failure_reason, url_masked from monitor_check_results where monitor_id = $1 limit 1",
      [monitor.monitorId],
    );
    expect(row).toMatchObject({
      outcome: "fail",
      failure_reason: "blocked_address",
    });
    expect(JSON.stringify(row)).not.toContain("127.0.0.1");
    expect(listener.requests).toHaveLength(0);
    expect(listener.connections()).toBe(0);
  }, 30_000);

  it("SIGTERM with Redis frozen stays inside the 25 s hard deadline", async () => {
    const frozenRedis = await startTestRedis("checker-frozen");
    const output: string[] = [];
    const child = spawn("bun", ["run", "--preload", preload, workerEntry], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: db.runtimeUrl,
        REDIS_URL: frozenRedis.url,
        WORKER_ROLES: "consumer,scheduler,monitor-scheduler,monitor-checker",
        OUTBOUND_TEST_ALLOWED_HOSTS: TARGET_HOST,
        NW_TEST_DNS_FILE: dnsFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<number | null>((resolve) => {
      child.once("close", (code) => {
        resolve(code);
      });
    });
    const ready = Promise.withResolvers<undefined>();
    const onData = (chunk: Buffer) => {
      output.push(chunk.toString());
      if (output.join("").includes("worker ready")) ready.resolve(undefined);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    try {
      await ready.promise;
      await frozenRedis.freeze();
      const signalled = Date.now();
      child.kill("SIGTERM");
      const code = await exited;
      const waitedMs = Date.now() - signalled;
      expect(code).toBe(0);
      expect(waitedMs).toBeLessThan(20_000);
      console.info(
        `SIGTERM with frozen Redis exited after ${String(waitedMs)} ms`,
      );
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await frozenRedis.stop();
    }
  }, 60_000);
});
