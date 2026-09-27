import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  claimNotificationDispatches,
  createDatabase,
  failNotificationDispatch,
  runMigrations,
  withAccountContextRaw,
  type Database,
} from "@nightwatch/db";
import { createLogger } from "@nightwatch/shared";
import { Queue, Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  dispatchJobId,
  IN_APP_MATERIALIZE_QUEUE,
  NotificationDispatchScheduler,
  redisConnection,
  type DispatchQueue,
} from "./dispatch";
import {
  createMaterializationDependencies,
  processMaterialization,
  type MaterializeJobData,
} from "./materialize";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const run = randomUUID();
const ownerPassword = `owner-${randomUUID()}`;
const runtimePassword = `runtime-${randomUUID()}`;
const postgresContainer = `nightwatch-dispatch-postgres-${run}`;
const initRolesScript = fileURLToPath(
  new URL("../../../scripts/db/init/001-roles.sh", import.meta.url),
);
const migrationsDir = new URL(
  "../../../packages/db/migrations",
  import.meta.url,
).pathname;
const userId = randomUUID();
const redisPrefix = `dispatch-test-${run}`;
const redisUrl = process.env.REDIS_URL;
if (!redisUrl)
  throw new Error("worker dispatch integration requires REDIS_URL");

const logger = createLogger({ level: "silent", name: "dispatch-db-test" });
let owner!: Database;
let runtime!: Database;
let ownerInitialized = false;
let runtimeInitialized = false;
let postgresStarted = false;

type DockerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
function docker(args: string[], allowFailure = false): Promise<DockerResult> {
  const { promise, reject, resolve } = Promise.withResolvers<DockerResult>();
  const process = spawn("docker", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  process.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  process.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  process.once("error", reject);
  process.once("close", (exitCode) => {
    const result = {
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    };
    if (result.exitCode !== 0 && !allowFailure)
      reject(
        new Error(
          result.stderr ||
            result.stdout ||
            `docker exited with ${String(result.exitCode)}`,
        ),
      );
    else resolve(result);
  });
  return promise;
}

async function publishedPort(
  container: string,
  target: string,
): Promise<number> {
  const { stdout } = await docker(["port", container, target]);
  const port = /:(\d+)\s*$/.exec(stdout)?.[1];
  if (!port) throw new Error(`missing published port for ${container}`);
  return Number(port);
}

// Wait for the service readiness signal instead of a fixed startup delay.
async function waitFor(
  container: string,
  readinessCommand: string,
): Promise<void> {
  await docker([
    "exec",
    "--env",
    `READINESS_COMMAND=${readinessCommand}`,
    container,
    "sh",
    "-ceu",
    `timeout 40 sh -ceu 'until sh -ceu "$READINESS_COMMAND"; do sleep 0.1; done'`,
  ]);
}

function databaseUrl(username: string, password: string, port: number): string {
  const url = new URL("postgres://localhost/nightwatch");
  url.username = username;
  url.password = password;
  url.port = String(port);
  return url.toString();
}

async function state(id: string) {
  const result = await owner.sql.query<{
    status: string;
    claimToken: string | null;
    attemptCount: number;
    failureReason: string | null;
    failureSummary: string | null;
  }>(
    `select status, claim_token as "claimToken", attempt_count as "attemptCount",
            failure_reason as "failureReason", failure_summary as "failureSummary"
     from notification_dispatch_ledger where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`missing dispatch ${id}`);
  return row;
}
async function visible(): Promise<{
  items: {
    id: Uuid;
    intentId: Uuid;
    readAt: Date | null;
  }[];
  unreadCount: number;
}> {
  return withAccountContextRaw(runtime, userId, async (client) => {
    const result = await client.query<{
      id: Uuid;
      intentId: Uuid;
      readAt: Date | null;
    }>(
      `select id, intent_id as "intentId", read_at as "readAt"
       from notification_inbox_items
       where scope_kind = 'account' and recipient_user_id = $1
         and expires_at > now()
         and exists (
           select 1 from notification_dispatch_ledger as d
           where d.intent_id = notification_inbox_items.intent_id
             and d.status = 'completed'
         )
       order by occurred_at desc, id desc`,
      [userId],
    );
    return {
      items: result.rows,
      unreadCount: result.rows.filter((item) => item.readAt === null).length,
    };
  });
}
async function markVisibleItemRead(itemId: string): Promise<Date | null> {
  return withAccountContextRaw(runtime, userId, async (client) => {
    const result = await client.query<{ readAt: Date | null }>(
      `update notification_inbox_items set read_at = coalesce(read_at, now())
       where id = $1 and recipient_user_id = $2
         and scope_kind = 'account' and expires_at > now()
         and exists (
           select 1 from notification_dispatch_ledger as d
           where d.intent_id = notification_inbox_items.intent_id
             and d.status = 'completed'
         )
       returning read_at as "readAt"`,
      [itemId, userId],
    );
    return result.rows[0]?.readAt ?? null;
  });
}
function acknowledgementFaultDatabase(): Database {
  const sql = new Proxy(runtime.sql, {
    get(target, property, receiver): unknown {
      if (property !== "query") return Reflect.get(target, property, receiver);
      const query = target.query.bind(target);
      return (text: string, values?: unknown[]) => {
        if (text.includes("mark_notification_dispatch_enqueued"))
          throw new Error("injected acknowledgement query failure");
        return query(text, values);
      };
    },
  });
  return { ...runtime, sql };
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
  // Probe over TCP: the init-time server is socket-only and restarts after init
  // scripts, so a socket probe can pass before the final server is up.
  await waitFor(
    postgresContainer,
    "pg_isready -h 127.0.0.1 -U nightwatch_owner -d nightwatch >/dev/null && " +
      `psql -h 127.0.0.1 -U nightwatch_owner -d nightwatch -Atqc "select 1 from pg_roles where rolname = 'nightwatch'" | grep -qx 1`,
  );
  const postgresPort = await publishedPort(postgresContainer, "5432/tcp");
  const ownerUrl = databaseUrl("nightwatch_owner", ownerPassword, postgresPort);
  const runtimeUrl = databaseUrl("nightwatch", runtimePassword, postgresPort);
  await runMigrations({
    url: ownerUrl,
    migrationsDir,
    log: () => undefined,
  });
  owner = createDatabase(ownerUrl);
  ownerInitialized = true;
  runtime = createDatabase(runtimeUrl);
  runtimeInitialized = true;
}, 60_000);

afterAll(async () => {
  try {
    if (runtimeInitialized) await runtime.close();
  } finally {
    try {
      if (ownerInitialized) await owner.close();
    } finally {
      if (postgresStarted)
        await docker(["rm", "--force", postgresContainer], true);
    }
  }
}, 60_000);

describe("notification dispatch scheduler faults", () => {
  it("recovers real enqueue acknowledgement and stale-lease faults without exposing duplicate inbox items", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const queue = new Queue<MaterializeJobData>(IN_APP_MATERIALIZE_QUEUE, {
      connection: redisConnection(redisUrl),
      prefix: redisPrefix,
    });
    const transportFailureQueue: DispatchQueue = {
      add: () =>
        Promise.reject(
          new Error("injected Redis transport failure before queue.add"),
        ),
      waitUntilReady: () => queue.waitUntilReady(),
      close: () => queue.close(),
    };
    try {
      const origin = `dispatch-fault:${run}:${intentId}`;
      await owner.sql.query(
        `insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)`,
        [userId, "Dispatch Tester", `dispatch-${run}@example.test`],
      );
      await owner.sql.query(
        `insert into notification_intents (id, scope_kind, user_id, origin, event_type, occurred_at) values ($1, 'account', $2, $3, 'PASSWORD_CHANGED', now())`,
        [intentId, userId, origin],
      );
      await owner.sql.query(
        `insert into notification_intent_recipients (intent_id, origin, recipient_user_id, scope_kind, user_id) values ($1, $2, $3, 'account', $3)`,
        [intentId, origin, userId],
      );
      await owner.sql.query(
        `insert into notification_dispatch_ledger (id, intent_id, scope_kind, user_id) values ($1, $2, 'account', $3)`,
        [dispatchId, intentId, userId],
      );
      await expect(visible()).resolves.toMatchObject({
        items: [],
        unreadCount: 0,
      });

      const manualClaimToken = randomUUID();
      await expect(
        claimNotificationDispatches(runtime, {
          claimToken: manualClaimToken,
          limit: 1,
        }),
      ).resolves.toMatchObject([{ id: dispatchId }]);
      await expect(state(dispatchId)).resolves.toMatchObject({
        status: "claimed",
        claimToken: manualClaimToken,
        attemptCount: 1,
      });
      await expect(visible()).resolves.toMatchObject({ items: [] });
      await expect(
        failNotificationDispatch(runtime, {
          id: dispatchId,
          claimToken: manualClaimToken,
          reason: "QUEUE_ADD_FAILED",
        }),
      ).resolves.toBe(true);

      await new NotificationDispatchScheduler(
        runtime,
        transportFailureQueue,
        logger,
      ).dispatch();
      await expect(state(dispatchId)).resolves.toMatchObject({
        status: "failed",
        attemptCount: 2,
        failureReason: "QUEUE_ADD_FAILED",
        failureSummary: "Unable to submit notification work for delivery.",
      });
      await expect(visible()).resolves.toMatchObject({ items: [] });

      await new NotificationDispatchScheduler(
        acknowledgementFaultDatabase(),
        queue,
        logger,
      ).dispatch();
      await expect(state(dispatchId)).resolves.toMatchObject({
        status: "failed",
        attemptCount: 3,
        failureReason: "QUEUE_ACK_FAILED",
        failureSummary:
          "Notification delivery submission could not be confirmed.",
      });
      const acknowledgementJob = (await queue.getJobs(["waiting"]))[0];
      if (!acknowledgementJob?.id)
        throw new Error("missing acknowledgement queue job");
      expect(acknowledgementJob.data).toMatchObject({
        dispatchId,
        scope: { kind: "account", userId },
      });
      const acknowledgementToken = acknowledgementJob.data.claimToken;
      expect(acknowledgementToken).toEqual(expect.any(String));
      const acknowledgementJobId = dispatchJobId(
        dispatchId,
        acknowledgementToken,
      );
      expect(acknowledgementJob.id).toBe(acknowledgementJobId);
      await queue.add("materialize", acknowledgementJob.data, {
        jobId: acknowledgementJobId,
      });
      await expect(queue.getJobs(["waiting"])).resolves.toHaveLength(1);
      await expect(visible()).resolves.toMatchObject({ items: [] });

      await new NotificationDispatchScheduler(
        runtime,
        queue,
        logger,
      ).dispatch();
      const enqueued = await state(dispatchId);
      expect(enqueued).toMatchObject({
        status: "enqueued",
        attemptCount: 4,
        failureReason: null,
        failureSummary: null,
      });
      await expect(visible()).resolves.toMatchObject({ items: [] });
      await owner.sql.query(
        `update notification_dispatch_ledger set enqueued_at = now() - interval '6 minutes' where id = $1`,
        [dispatchId],
      );
      await new NotificationDispatchScheduler(
        runtime,
        queue,
        logger,
      ).dispatch();
      const recovered = await state(dispatchId);
      expect(recovered).toMatchObject({ status: "enqueued", attemptCount: 5 });
      const jobs = await queue.getJobs(["waiting"]);
      expect(jobs.map((job) => job.data.claimToken)).toEqual(
        expect.arrayContaining([
          acknowledgementToken,
          enqueued.claimToken,
          recovered.claimToken,
        ]),
      );
      expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
      await expect(visible()).resolves.toMatchObject({ items: [] });

      const completed = Promise.withResolvers<undefined>();
      const worker = new Worker<MaterializeJobData>(
        queue.name,
        async (job) => {
          await processMaterialization(
            job.data,
            createMaterializationDependencies(runtime),
          );
          if (job.data.claimToken === recovered.claimToken)
            completed.resolve(undefined);
        },
        {
          connection: redisConnection(redisUrl),
          concurrency: 3,
          prefix: redisPrefix,
        },
      );
      try {
        await worker.waitUntilReady();
        await completed.promise;
      } finally {
        await worker.close();
      }
      await expect(state(dispatchId)).resolves.toMatchObject({
        status: "completed",
        attemptCount: 5,
        failureReason: null,
        failureSummary: null,
      });
      const [inboxItem] = (await visible()).items;
      if (!inboxItem) throw new Error("missing materialized inbox item");
      expect(inboxItem.readAt).toBeNull();
      expect(typeof inboxItem.id).toBe("string");
      await expect(visible()).resolves.toMatchObject({
        items: [{ id: inboxItem.id, intentId, readAt: null }],
        unreadCount: 1,
      });
    } finally {
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }
  });
  it("queues every claim in one scheduler batch as a distinct job", async () => {
    const queue = new Queue<MaterializeJobData>(IN_APP_MATERIALIZE_QUEUE, {
      connection: redisConnection(redisUrl),
      prefix: redisPrefix,
    });
    const batch = [
      { intentId: randomUUID(), dispatchId: randomUUID() },
      { intentId: randomUUID(), dispatchId: randomUUID() },
    ];
    const intents = batch.map(({ intentId }) => intentId);
    const dispatches = batch.map(({ dispatchId }) => dispatchId);
    try {
      await owner.sql.query(
        `insert into "user" (id, name, email, email_verified)
         values ($1, 'Batch Tester', $2, true)
         on conflict (id) do nothing`,
        [userId, `batch-${run}@example.test`],
      );
      for (const { intentId, dispatchId } of batch) {
        const origin = `dispatch-batch:${run}:${intentId}`;
        await owner.sql.query(
          `insert into notification_intents
            (id, scope_kind, user_id, origin, event_type, occurred_at)
           values ($1, 'account', $2, $3, 'PASSWORD_CHANGED', now())`,
          [intentId, userId, origin],
        );
        await owner.sql.query(
          `insert into notification_intent_recipients
            (intent_id, origin, recipient_user_id, scope_kind, user_id)
           values ($1, $2, $3, 'account', $3)`,
          [intentId, origin, userId],
        );
        await owner.sql.query(
          `insert into notification_dispatch_ledger
            (id, intent_id, scope_kind, user_id)
           values ($1, $2, 'account', $3)`,
          [dispatchId, intentId, userId],
        );
      }
      await new NotificationDispatchScheduler(
        runtime,
        queue,
        logger,
      ).dispatch();
      const jobs = await queue.getJobs(["waiting"]);
      expect(jobs.map((job) => job.data.dispatchId).sort()).toEqual(
        [...dispatches].sort(),
      );
      expect(new Set(jobs.map((job) => job.id)).size).toBe(2);

      const completed = new Set<string>();
      const done = Promise.withResolvers<undefined>();
      const worker = new Worker<MaterializeJobData>(
        queue.name,
        async (job) => {
          await processMaterialization(
            job.data,
            createMaterializationDependencies(runtime),
          );
          completed.add(job.data.dispatchId);
          if (completed.size === 2) done.resolve(undefined);
        },
        {
          connection: redisConnection(redisUrl),
          concurrency: 2,
          prefix: redisPrefix,
        },
      );
      try {
        await worker.waitUntilReady();
        await done.promise;
      } finally {
        await worker.close();
      }
      await Promise.all(
        dispatches.map((id) =>
          expect(state(id)).resolves.toMatchObject({ status: "completed" }),
        ),
      );
      const batchVisible = (await visible()).items.filter((item) =>
        intents.includes(item.intentId),
      );
      expect(batchVisible).toHaveLength(2);
      expect(batchVisible.map(({ intentId }) => intentId).sort()).toEqual(
        [...intents].sort(),
      );
      for (const { id, readAt } of batchVisible) {
        expect(typeof id).toBe("string");
        expect(readAt).toBeNull();
      }
      const firstItem = batchVisible[0];
      if (!firstItem) throw new Error("missing first batch inbox item");
      const readAt = await markVisibleItemRead(firstItem.id);
      expect(readAt).toBeInstanceOf(Date);
    } finally {
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }
  });
});
