import { randomUUID } from "node:crypto";

import {
  claimNotificationDispatches,
  failNotificationDispatch,
  withAccountContextRaw,
  type Database,
} from "@nightwatch/db";
import { openTestPostgres, type TestPostgres } from "@nightwatch/db/testing";
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
const userId = randomUUID();
const redisPrefix = `dispatch-test-${run}`;
const redisUrl = process.env.REDIS_URL;
if (!redisUrl)
  throw new Error("worker dispatch integration requires REDIS_URL");

const logger = createLogger({ level: "silent", name: "dispatch-db-test" });
let owner!: Database;
let runtime!: Database;
let fixture: TestPostgres | undefined;

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
  fixture = await openTestPostgres("dispatch-worker");
  owner = fixture.owner;
  runtime = fixture.runtime;
}, 180_000);

afterAll(async () => {
  await fixture?.close();
}, 60_000);

describe("notification dispatch scheduler faults", () => {
  it("recovers real enqueue acknowledgement and stale-lease faults without exposing duplicate inbox items", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const queue = new Queue<MaterializeJobData>(IN_APP_MATERIALIZE_QUEUE, {
      connection: redisConnection(redisUrl),
      prefix: redisPrefix,
    });
    let worker: Worker<MaterializeJobData> | undefined;
    const failures: unknown[] = [];
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

      if (!recovered.claimToken)
        throw new Error("missing recovered claim token");
      const expectedJobId = dispatchJobId(dispatchId, recovered.claimToken);
      const completed = Promise.withResolvers<undefined>();
      worker = new Worker<MaterializeJobData>(
        queue.name,
        async (job) => {
          await processMaterialization(
            job.data,
            createMaterializationDependencies(runtime),
          );
        },
        {
          connection: redisConnection(redisUrl),
          concurrency: 3,
          prefix: redisPrefix,
        },
      );
      worker.on("completed", (job) => {
        if (job.id === expectedJobId) completed.resolve(undefined);
      });
      worker.on("failed", (job, error) => {
        if (
          job?.id === expectedJobId &&
          job.attemptsMade >= (job.opts.attempts ?? 1)
        )
          completed.reject(error);
      });
      const onError = (error: Error) => {
        completed.reject(error);
      };
      worker.on("error", onError);
      queue.on("error", onError);
      const deadline = setTimeout(() => {
        completed.reject(
          new Error(`timed out waiting for materialization ${expectedJobId}`),
        );
      }, 20_000);
      try {
        await Promise.all([worker.waitUntilReady(), completed.promise]);
      } finally {
        clearTimeout(deadline);
        try {
          await worker.close();
        } catch (error) {
          failures.push(error);
        }
        queue.off("error", onError);
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
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await worker?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await queue.obliterate({ force: true });
      } catch (error) {
        failures.push(error);
      }
      try {
        await queue.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "dispatch scenario or cleanup failed");
  }, 30_000);
  it("queues every claim in one scheduler batch as a distinct job", async () => {
    const queue = new Queue<MaterializeJobData>(IN_APP_MATERIALIZE_QUEUE, {
      connection: redisConnection(redisUrl),
      prefix: redisPrefix,
    });
    let worker: Worker<MaterializeJobData> | undefined;
    const failures: unknown[] = [];
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
      worker = new Worker<MaterializeJobData>(
        queue.name,
        async (job) => {
          await processMaterialization(
            job.data,
            createMaterializationDependencies(runtime),
          );
        },
        {
          connection: redisConnection(redisUrl),
          concurrency: 2,
          prefix: redisPrefix,
        },
      );
      const expectedJobIds = new Set(jobs.map((job) => job.id));
      worker.on("completed", (job) => {
        if (!job.id || !expectedJobIds.has(job.id)) return;
        completed.add(job.id);
        if (completed.size === expectedJobIds.size) done.resolve(undefined);
      });
      worker.on("failed", (job, error) => {
        if (
          job &&
          expectedJobIds.has(job.id) &&
          job.attemptsMade >= (job.opts.attempts ?? 1)
        )
          done.reject(error);
      });
      const onError = (error: Error) => {
        done.reject(error);
      };
      worker.on("error", onError);
      queue.on("error", onError);
      const deadline = setTimeout(() => {
        done.reject(new Error("timed out waiting for batch materialization"));
      }, 20_000);
      try {
        await Promise.all([worker.waitUntilReady(), done.promise]);
      } finally {
        clearTimeout(deadline);
        try {
          await worker.close();
        } catch (error) {
          failures.push(error);
        }
        queue.off("error", onError);
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
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await worker?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await queue.obliterate({ force: true });
      } catch (error) {
        failures.push(error);
      }
      try {
        await queue.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "dispatch scenario or cleanup failed");
  }, 30_000);
});
