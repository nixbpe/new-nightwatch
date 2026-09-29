import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, Socket } from "node:net";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  createDatabase,
  runMigrations,
  withTenantContextRaw,
  type Database,
} from "@nightwatch/db";
import { createLogger } from "@nightwatch/shared";
import type { Queue } from "bullmq";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createMonitorCheckQueue,
  MONITOR_CHECK_JOB_OPTIONS,
  MONITOR_CHECK_QUEUE,
  monitorCheckJobId,
  type MonitorCheckJob,
} from "./queue";
import { MonitorScheduler } from "./scheduler";

const run = randomUUID();
const ownerPassword = `owner-${randomUUID()}`;
const runtimePassword = `runtime-${randomUUID()}`;
const postgresContainer = `nightwatch-monitor-sched-postgres-${run}`;
const initRolesScript = fileURLToPath(
  new URL("../../../../scripts/db/init/001-roles.sh", import.meta.url),
);
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;
const workerEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
let redisPrefix = "";
const redisUrl = process.env.REDIS_URL;
if (!redisUrl)
  throw new Error("monitor scheduler integration requires REDIS_URL");

const silent = createLogger({ level: "silent", name: "monitor-sched-test" });
let owner!: Database;
let runtime!: Database;
let runtimeUrl = "";
let postgresStarted = false;
const tenants: string[] = [];
const queues: Queue<MonitorCheckJob>[] = [];
const unreachable = new Set<Queue<MonitorCheckJob>>();

type DockerResult = { exitCode: number; stdout: string; stderr: string };
function docker(args: string[], allowFailure = false): Promise<DockerResult> {
  const { promise, reject, resolve } = Promise.withResolvers<DockerResult>();
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.once("error", reject);
  child.once("close", (exitCode) => {
    const result = {
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    };
    if (result.exitCode !== 0 && !allowFailure)
      reject(new Error(result.stderr || result.stdout || "docker failed"));
    else resolve(result);
  });
  return promise;
}

function databaseUrl(username: string, password: string, port: number): string {
  const url = new URL("postgres://localhost/nightwatch");
  url.username = username;
  url.password = password;
  url.port = String(port);
  return url.toString();
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function newQueue(url = redisUrl as string): Queue<MonitorCheckJob> {
  const queue = createMonitorCheckQueue(url, { prefix: redisPrefix });
  queue.on("error", () => undefined);
  queues.push(queue);
  return queue;
}

type Fixture = { tenantId: string; monitorIds: string[] };

/** Organization plus monitors with a schedule row; `next` is SQL for next_check_at. */
async function seed(
  next: string | null,
  count = 1,
  intervalSeconds = 60,
): Promise<Fixture> {
  const tenantId = randomUUID();
  tenants.push(tenantId);
  await owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'Sched', $2)",
    [tenantId, `sched-${randomUUID()}`],
  );
  const monitorIds: string[] = [];
  await withTenantContextRaw(runtime, tenantId, async (client) => {
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID();
      monitorIds.push(id);
      await client.query(
        `insert into monitors
           (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
         values ($1, $2, 'm', 'https://target.example.test/health', $3, 10, $4)`,
        [id, tenantId, intervalSeconds, randomUUID()],
      );
      await client.query(
        `insert into monitor_schedule
           (monitor_id, tenant_id, next_check_at, check_config_version,
            interval_seconds, timeout_seconds)
         values ($1, $2, ${next ?? "null"}, 1, $3, 10)`,
        [id, tenantId, intervalSeconds],
      );
    }
  });
  return { tenantId, monitorIds };
}

type ScheduleRow = {
  monitor_id: string;
  claim_token: string | null;
  claimed_until: Date | null;
  next_check_at: Date | null;
};
async function schedules(fixture: Fixture): Promise<ScheduleRow[]> {
  return withTenantContextRaw(runtime, fixture.tenantId, async (client) => {
    const result = await client.query<ScheduleRow>(
      `select monitor_id, claim_token, claimed_until, next_check_at
       from monitor_schedule where monitor_id = any($1::uuid[]) order by monitor_id`,
      [fixture.monitorIds],
    );
    return result.rows;
  });
}

async function jobs(queue: Queue<MonitorCheckJob>) {
  return queue.getJobs(["waiting", "delayed", "active", "prioritized"]);
}

type QueryFn = (text: string, values?: unknown[]) => Promise<unknown>;
/** Runtime database whose queries are counted and can be failed by SQL text. */
function spyDatabase(hooks: { failWhen?: (text: string) => boolean } = {}): {
  database: Database;
  count: (fragment: string) => number;
} {
  const seen: string[] = [];
  const sql = new Proxy(runtime.sql, {
    get(target, property, receiver): unknown {
      if (property !== "query") return Reflect.get(target, property, receiver);
      const query = target.query.bind(target) as QueryFn;
      return (text: string, values?: unknown[]) => {
        seen.push(text);
        if (hooks.failWhen?.(text))
          return Promise.reject(new Error("injected query failure"));
        return query(text, values);
      };
    },
  });
  return {
    database: { ...runtime, sql },
    count: (fragment) => seen.filter((text) => text.includes(fragment)).length,
  };
}

function scheduler(queue: Queue<MonitorCheckJob>, logger = silent) {
  return new MonitorScheduler(runtime, queue, logger);
}

function captureLogger(): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
} {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: createLogger({ level: "warn", name: "capture" }, stream),
    lines,
  };
}

beforeAll(async () => {
  postgresStarted = true;
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    postgresContainer,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_USER=nightwatch_owner",
    "--env",
    `POSTGRES_PASSWORD=${ownerPassword}`,
    "--env",
    "POSTGRES_DB=nightwatch",
    "--env",
    `NW_DB_PASSWORD=${runtimePassword}`,
    "--volume",
    `${initRolesScript}:/docker-entrypoint-initdb.d/001-roles.sh:ro`,
    "postgres:17.11-alpine",
  ]);
  await docker([
    "exec",
    postgresContainer,
    "sh",
    "-ceu",
    `timeout 40 sh -ceu 'until pg_isready -h 127.0.0.1 -U nightwatch_owner -d nightwatch >/dev/null && psql -h 127.0.0.1 -U nightwatch_owner -d nightwatch -Atqc "select 1 from pg_roles where rolname = '"'"'nightwatch'"'"'" | grep -qx 1; do sleep 0.1; done'`,
  ]);
  const { stdout } = await docker(["port", postgresContainer, "5432/tcp"]);
  const port = Number(/:(\d+)\s*$/.exec(stdout)?.[1]);
  const ownerUrl = databaseUrl("nightwatch_owner", ownerPassword, port);
  runtimeUrl = databaseUrl("nightwatch", runtimePassword, port);
  await runMigrations({ url: ownerUrl, migrationsDir, log: () => undefined });
  owner = createDatabase(ownerUrl);
  runtime = createDatabase(runtimeUrl);
}, 90_000);

beforeEach(() => {
  // Every scenario gets its own key space so job counts are exact.
  redisPrefix = `monitor-sched-test-${run}-${randomUUID()}`;
});

afterEach(async () => {
  // Rows of the previous scenario must not be claimable by the next one.
  await owner.sql.query("delete from organization where id = any($1::uuid[])", [
    tenants.splice(0),
  ]);
});

afterAll(async () => {
  for (const queue of queues) {
    if (unreachable.has(queue)) {
      // Never connected: disconnect() would wait for a connection that never comes.
      void queue.disconnect().catch(() => undefined);
      continue;
    }
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
  await runtime.close();
  await owner.close();
  if (postgresStarted) await docker(["rm", "--force", postgresContainer], true);
}, 60_000);

describe("monitor scheduler", () => {
  it("enqueues one job per due monitor when two schedulers race (AC-37, AC-54)", async () => {
    const fixture = await seed("now()", 25);
    const queueA = newQueue();
    const queueB = newQueue();
    await Promise.all([scheduler(queueA).round(), scheduler(queueB).round()]);
    await scheduler(queueA).round();

    const enqueued = await jobs(queueA);
    const rows = await schedules(fixture);
    expect(enqueued).toHaveLength(25);
    expect(new Set(enqueued.map((job) => job.id)).size).toBe(25);
    expect(new Set(rows.map((row) => row.claim_token)).size).toBe(25);
    const expectedIds = rows.map((row) =>
      monitorCheckJobId(row.monitor_id, row.claim_token as string),
    );
    expect(enqueued.map((job) => job.id).sort()).toEqual(expectedIds.sort());
    for (const job of enqueued) {
      expect(Object.keys(job.data).sort()).toEqual([
        "checkConfigVersion",
        "claimToken",
        "monitorId",
        "scheduledFor",
        "tenantId",
      ]);
      expect(job.opts.attempts).toBe(1);
      expect(job.name).toBe("check");
    }
    expect(MONITOR_CHECK_QUEUE).toBe("monitor-check");
  });

  it("claims at most 500 monitors per round (50 batches of 10)", async () => {
    await seed("now()", 501);
    const queue = newQueue();
    const single = scheduler(queue);
    await single.round();
    expect(await jobs(queue)).toHaveLength(500);
    await single.round();
    expect(await jobs(queue)).toHaveLength(501);
  }, 60_000);

  it("adding the same claim twice yields one job", async () => {
    const queue = newQueue();
    const options = { ...MONITOR_CHECK_JOB_OPTIONS, jobId: "monitor-check-x" };
    const data = {
      tenantId: randomUUID(),
      monitorId: randomUUID(),
      claimToken: randomUUID(),
      checkConfigVersion: 1,
      scheduledFor: new Date().toISOString(),
    };
    await queue.add("check", data, options);
    await queue.add("check", data, options);
    expect(await jobs(queue)).toHaveLength(1);
  });

  it("ends the round at the first enqueue failure; unqueued claims recover after the lease (F-01)", async () => {
    const fixture = await seed("now()", 11);
    const deadQueue = newQueue(
      `redis://127.0.0.1:${String(await closedPort())}`,
    );
    unreachable.add(deadQueue);
    let adds = 0;
    const counting = {
      add: (...args: Parameters<typeof deadQueue.add>) => {
        adds += 1;
        return deadQueue.add(...args);
      },
      waitUntilReady: () => deadQueue.waitUntilReady(),
      close: () => deadQueue.close(),
    };
    const started = Date.now();
    await new MonitorScheduler(runtime, counting, silent, {
      enqueueTimeoutMs: 300,
    }).round();

    expect(adds).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    const claimed = await schedules(fixture);
    expect(claimed.filter((row) => row.claim_token !== null)).toHaveLength(10);

    await withTenantContextRaw(runtime, fixture.tenantId, (client) =>
      client.query(
        `update monitor_schedule set claimed_until = now() - interval '1 second',
           next_check_at = now() - interval '1 second' where monitor_id = any($1::uuid[])`,
        [fixture.monitorIds],
      ),
    );
    const live = newQueue();
    await scheduler(live).round();
    expect(await jobs(live)).toHaveLength(11);
  }, 30_000);

  it("re-claims after Redis was down during enqueue once the lease expires (AC-37)", async () => {
    const fixture = await seed("now()", 1);
    const deadQueue = newQueue(
      `redis://127.0.0.1:${String(await closedPort())}`,
    );
    unreachable.add(deadQueue);
    const live = newQueue();
    await new MonitorScheduler(runtime, deadQueue, silent, {
      enqueueTimeoutMs: 300,
    }).round();

    const [claimed] = await schedules(fixture);
    expect(claimed?.claim_token).not.toBeNull();
    expect(await jobs(live)).toHaveLength(0);

    // Lease still valid: the next round must not claim again.
    await scheduler(live).round();
    expect(await jobs(live)).toHaveLength(0);

    await withTenantContextRaw(runtime, fixture.tenantId, (client) =>
      client.query(
        `update monitor_schedule set claimed_until = now() - interval '1 second',
           next_check_at = now() - interval '1 second' where monitor_id = $1`,
        [fixture.monitorIds[0]],
      ),
    );
    await scheduler(live).round();
    const enqueued = await jobs(live);
    const [reclaimed] = await schedules(fixture);
    expect(enqueued).toHaveLength(1);
    expect(reclaimed?.claim_token).not.toBe(claimed?.claim_token);
    expect(enqueued[0]?.id).toBe(
      monitorCheckJobId(
        fixture.monitorIds[0] as string,
        reclaimed?.claim_token as string,
      ),
    );
  }, 30_000);

  it("returns one job per monitor after a 10 minute stop, without back-fill (AC-37)", async () => {
    const fixture = await seed("now() - interval '10 minutes'", 3);
    const queue = newQueue();
    await scheduler(queue).round();
    await scheduler(queue).round();

    expect(await jobs(queue)).toHaveLength(3);
    for (const row of await schedules(fixture)) {
      expect(row.next_check_at?.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("does not claim paused monitors with NULL next_check_at (AC-19)", async () => {
    const paused = await seed(null, 2);
    const due = await seed("now()", 1);
    const queue = newQueue();
    await scheduler(queue).round();

    const enqueued = await jobs(queue);
    expect(enqueued.map((job) => job.data.monitorId)).toEqual(due.monitorIds);
    for (const row of await schedules(paused)) {
      expect(row.claim_token).toBeNull();
      expect(row.next_check_at).toBeNull();
    }
  });

  it("purges expired monitor data every round, even when the claim fails (AC-41)", async () => {
    const fixture = await seed(null, 1);
    await withTenantContextRaw(runtime, fixture.tenantId, (client) =>
      client.query(
        `insert into monitor_events (monitor_id, tenant_id, kind, occurred_at)
         values ($1, $2, 'paused', now() - interval '40 days')`,
        [fixture.monitorIds[0], fixture.tenantId],
      ),
    );
    const spy = spyDatabase({
      failWhen: (text) => text.includes("claim_due_monitor_checks"),
    });
    const faulty = new MonitorScheduler(spy.database, newQueue(), silent);
    await faulty.round();
    await faulty.round();
    await faulty.round();

    expect(spy.count("purge_expired_monitor_data")).toBe(3);
    const remaining = await withTenantContextRaw(
      runtime,
      fixture.tenantId,
      (client) =>
        client.query("select 1 from monitor_events where monitor_id = $1", [
          fixture.monitorIds[0],
        ]),
    );
    expect(remaining.rowCount).toBe(0);
  });

  it("runs one round at a time per scheduler", async () => {
    await seed("now()", 3);
    const real = newQueue();
    let adds = 0;
    const slow = {
      add: async (...args: Parameters<typeof real.add>) => {
        adds += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return real.add(...args);
      },
      waitUntilReady: () => real.waitUntilReady(),
      close: () => real.close(),
    };
    const spy = spyDatabase();
    const single = new MonitorScheduler(spy.database, slow, silent);
    await Promise.all([single.round(), single.round(), single.round()]);
    expect(spy.count("claim_due_monitor_checks")).toBe(1);
    expect(adds).toBe(3);
    expect(await jobs(real)).toHaveLength(3);
  });

  it("warns when fewer than 2 months of partitions exist ahead (AC-60)", async () => {
    const quiet = captureLogger();
    await new MonitorScheduler(runtime, newQueue(), quiet.logger).round();
    expect(quiet.lines.filter((line) => line.includes("partitions"))).toEqual(
      [],
    );

    const late = captureLogger();
    const farFuture = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const lagging = new MonitorScheduler(runtime, newQueue(), late.logger, {
      now: () => farFuture,
    });
    await lagging.round();
    await lagging.round();
    const warnings = late.lines.filter((line) =>
      line.includes("partitions ahead"),
    );
    expect(warnings).toHaveLength(1);
    const entry = JSON.parse(warnings[0] as string) as { missing: string[] };
    expect(entry.missing.length).toBe(4);
  });

  it("retries the partition check next round after its query failed (F-02)", async () => {
    let failed = false;
    const spy = spyDatabase({
      failWhen: (text) => {
        if (!text.includes("pg_inherits") || failed) return false;
        failed = true;
        return true;
      },
    });
    const capture = captureLogger();
    const lagging = new MonitorScheduler(
      spy.database,
      newQueue(),
      capture.logger,
      {
        now: () => new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
      },
    );
    await lagging.round();
    expect(
      capture.lines.some((line) => line.includes("partitions ahead")),
    ).toBe(false);
    await lagging.round();
    expect(
      capture.lines.some((line) => line.includes("partitions ahead")),
    ).toBe(true);
  });
});

describe("worker shutdown", () => {
  it("stops the monitor scheduler on SIGTERM and exits cleanly", async () => {
    const child = spawn("bun", ["run", workerEntry], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: runtimeUrl,
        REDIS_URL: redisUrl,
        WORKER_ROLES: "monitor-scheduler",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const ready = Promise.withResolvers<undefined>();
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("worker ready")) ready.resolve(undefined);
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) =>
      child.once("close", resolve),
    );
    await ready.promise;
    child.kill("SIGTERM");

    expect(await exited).toBe(0);
    const requested = output.indexOf("worker shutdown requested");
    const stopped = output.indexOf("monitor scheduler stopped");
    expect(requested).toBeGreaterThan(-1);
    expect(stopped).toBeGreaterThan(requested);
    expect(output).not.toContain("failed");
  }, 30_000);

  it("exits 0 on SIGTERM while an enqueue is in flight (F-06)", async () => {
    // A TCP relay to Redis that can be blackholed after startup keeps the
    // child's add() pending without writing into the shared Redis.
    const target = new URL(redisUrl);
    let blackhole = false;
    const sockets = new Set<Socket>();
    const relay = createServer((client) => {
      const upstream = new Socket();
      sockets.add(client).add(upstream);
      upstream.connect(Number(target.port), target.hostname);
      client.on("data", (chunk) => {
        if (!blackhole) upstream.write(chunk);
      });
      upstream.on("data", (chunk) => client.write(chunk));
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const address = relay.address();
    const relayPort = typeof address === "object" && address ? address.port : 0;
    const child = spawn("bun", ["run", workerEntry], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: runtimeUrl,
        REDIS_URL: `redis://127.0.0.1:${String(relayPort)}`,
        WORKER_ROLES: "monitor-scheduler",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const ready = Promise.withResolvers<undefined>();
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("worker ready")) ready.resolve(undefined);
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) =>
      child.once("close", resolve),
    );
    try {
      await ready.promise;
      blackhole = true;
      const fixture = await seed("now()", 1);
      // The next 10 s round claims the monitor; its add() then hangs.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const [row] = await schedules(fixture);
        if (row?.claim_token) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const [claimed] = await schedules(fixture);
      expect(claimed?.claim_token).not.toBeNull();
      child.kill("SIGTERM");

      expect(await exited).toBe(0);
      expect(output).toContain("monitor scheduler stopped");
      expect(output).not.toContain("round failed");
    } finally {
      child.kill("SIGKILL");
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => relay.close(resolve));
    }
  }, 60_000);
});
