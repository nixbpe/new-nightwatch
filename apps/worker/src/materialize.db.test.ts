import { randomUUID } from "node:crypto";

import {
  createDatabase,
  failNotificationDispatch,
  withAccountContextRaw,
  withTenantContextRaw,
} from "@nightwatch/db";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { redisConnection } from "./dispatch";
import {
  createMaterializationDependencies,
  processMaterialization,
  type MaterializeJobData,
} from "./materialize";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
const redisUrl = process.env.REDIS_URL;

if (!runtimeUrl || !ownerUrl || !redisUrl) {
  throw new Error(
    "worker materialization integration requires DATABASE_URL, DATABASE_OWNER_URL, and REDIS_URL",
  );
}

const runtime = createDatabase(runtimeUrl);
const owner = createDatabase(ownerUrl);
const run = randomUUID();
const tenantId = randomUUID();
const retainedAdminId = randomUUID();
const demotedAdminId = randomUUID();
const promotedMemberId = randomUUID();
const accountId = randomUUID();

async function cleanup(): Promise<void> {
  await owner.sql.query('delete from "user" where id = any($1::text[])', [
    [retainedAdminId, demotedAdminId, promotedMemberId, accountId],
  ]);
  await owner.sql.query("delete from organization where id = $1", [tenantId]);
}

async function createUser(id: string, name: string): Promise<void> {
  await owner.sql.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, $2, $3, true)`,
    [
      id,
      name,
      `${name.toLowerCase().replaceAll(" ", "-")}-${run}@example.test`,
    ],
  );
}

async function ledger(dispatchId: string): Promise<{
  status: string;
  claimToken: string | null;
  attemptCount: number;
  failureReason: string | null;
  failureSummary: string | null;
}> {
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
    [dispatchId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`missing dispatch ${dispatchId}`);
  return row;
}

beforeAll(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await owner.close();
    await runtime.close();
  }
});

describe("worker tenant materialization and recovery", () => {
  it("uses the committed tenant claim with the original recipient snapshot and current membership", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const origin = `worker-tenant-snapshot:${run}:${intentId}`;
    const dependencies = createMaterializationDependencies(runtime);
    await owner.sql.query(
      "insert into organization (id, name, slug) values ($1, $2, $3)",
      [tenantId, "Worker Tenant", `worker-tenant-${run}`],
    );
    await createUser(retainedAdminId, "Retained Admin");
    await createUser(demotedAdminId, "Demoted Admin");
    await createUser(promotedMemberId, "Promoted Member");
    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role)
         values ($1, $2, $3, 'owner,viewer'), ($4, $2, $5, 'admin'), ($6, $2, $7, 'member')`,
      [
        randomUUID(),
        tenantId,
        retainedAdminId,
        randomUUID(),
        demotedAdminId,
        randomUUID(),
        promotedMemberId,
      ],
    );
    await owner.sql.query(
      `insert into notification_intents
          (id, scope_kind, tenant_id, origin, event_type, occurred_at, actor_user_id, actor_display_name)
         values ($1, 'tenant', $2, $3, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now(), $4, 'Actor')`,
      [intentId, tenantId, origin, retainedAdminId],
    );
    await owner.sql.query(
      `insert into notification_intent_recipients
          (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
         values ($1, $2, $3, 'tenant', $4), ($1, $2, $5, 'tenant', $4)`,
      [intentId, origin, retainedAdminId, tenantId, demotedAdminId],
    );
    await owner.sql.query(
      `insert into notification_dispatch_ledger
          (id, intent_id, scope_kind, tenant_id)
         values ($1, $2, 'tenant', $3)`,
      [dispatchId, intentId, tenantId],
    );
    const claimToken = randomUUID();
    await owner.sql.query(
      `update notification_dispatch_ledger
         set status = 'enqueued', claim_token = $1, claimed_at = now(), enqueued_at = now(),
             attempt_count = 1
         where id = $2`,
      [claimToken, dispatchId],
    );
    await expect(ledger(dispatchId)).resolves.toMatchObject({
      status: "enqueued",
      claimToken,
    });

    await owner.sql.query(
      `update member set role = case user_id
           when $1 then 'member'
           when $2 then 'admin'
           else role end
         where organization_id = $3 and user_id = any($4::text[])`,
      [
        demotedAdminId,
        promotedMemberId,
        tenantId,
        [demotedAdminId, promotedMemberId],
      ],
    );
    await processMaterialization(
      {
        dispatchId,
        claimToken,
        scope: { kind: "tenant", tenantId },
      },
      dependencies,
    );
    await expect(ledger(dispatchId)).resolves.toMatchObject({
      status: "completed",
    });
    const visible = await withTenantContextRaw(
      runtime,
      tenantId,
      async (client) =>
        client.query<{
          id: string;
          recipientUserId: string;
        }>(
          `select id, recipient_user_id as "recipientUserId"
           from notification_inbox_items
           where intent_id = $1 and recipient_user_id = $2
             and exists (
               select 1 from member
               where organization_id = $3 and user_id = $2
             )
           order by recipient_user_id`,
          [intentId, retainedAdminId, tenantId],
        ),
    );
    expect(visible.rows).toHaveLength(1);
    const visibleItem = visible.rows[0];
    if (!visibleItem) throw new Error("missing materialized tenant inbox item");
    expect(visibleItem.recipientUserId).toBe(retainedAdminId);
    z.uuid().parse(visibleItem.id);
  });

  it("recovers an exhausted enqueue and acknowledgement failure without duplicating or unread-ing the inbox item", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const origin = `worker-recovery:${run}:${intentId}`;
    await createUser(accountId, "Recovery Account");
    await owner.sql.query(
      `insert into notification_intents
        (id, scope_kind, user_id, origin, event_type, occurred_at)
       values ($1, 'account', $2, $3, 'PASSWORD_CHANGED', now())`,
      [intentId, accountId, origin],
    );
    await owner.sql.query(
      `insert into notification_intent_recipients
        (intent_id, origin, recipient_user_id, scope_kind, user_id)
       values ($1, $2, $3, 'account', $3)`,
      [intentId, origin, accountId],
    );
    await owner.sql.query(
      `insert into notification_dispatch_ledger
        (id, intent_id, scope_kind, user_id)
       values ($1, $2, 'account', $3)`,
      [dispatchId, intentId, accountId],
    );

    await owner.sql.query(
      `update notification_dispatch_ledger
       set status = 'failed', claim_token = null, attempt_count = 1
       where id = $1`,
      [dispatchId],
    );
    let claimToken = randomUUID();
    await owner.sql.query(
      `update notification_dispatch_ledger
       set status = 'enqueued', claim_token = $1, claimed_at = now(), enqueued_at = now()
       where id = $2`,
      [claimToken, dispatchId],
    );
    const staleToken = randomUUID();
    const realDependencies = createMaterializationDependencies(runtime);
    await expect(
      processMaterialization(
        {
          dispatchId,
          claimToken,
          scope: { kind: "account", userId: accountId },
        },
        {
          ...realDependencies,
          async resolveClaim(id, token) {
            const claim = await realDependencies.resolveClaim(id, token);
            await owner.sql.query(
              "update notification_dispatch_ledger set claim_token = $1 where id = $2",
              [staleToken, dispatchId],
            );
            return claim;
          },
        },
      ),
    ).rejects.toThrow("acknowledgement failed");
    claimToken = staleToken;
    await expect(
      withAccountContextRaw(runtime, accountId, async (client) =>
        client.query(
          "select id from notification_inbox_items where intent_id = $1",
          [intentId],
        ),
      ),
    ).resolves.toMatchObject({ rows: [] });
    const exhausted = Promise.withResolvers<undefined>();
    const retryQueue = new Queue<MaterializeJobData>(
      `worker-retry-${run}-${dispatchId}`,
      { connection: redisConnection(redisUrl) },
    );
    const retryWorker = new Worker<MaterializeJobData>(
      retryQueue.name,
      async (job) =>
        processMaterialization(job.data, {
          ...createMaterializationDependencies(runtime),
          materializeAndComplete: () =>
            Promise.reject(new Error("injected acknowledgement failure")),
        }),
      { connection: redisConnection(redisUrl), concurrency: 1 },
    );
    retryWorker.on("failed", (job) => {
      if (job?.id !== dispatchId || job.attemptsMade < (job.opts.attempts ?? 1))
        return;
      void failNotificationDispatch(runtime, {
        id: dispatchId,
        claimToken,
        reason: "MATERIALIZATION_EXHAUSTED",
      }).then(
        (failed) => {
          if (failed) exhausted.resolve(undefined);
          else
            exhausted.reject(
              new Error("exhausted BullMQ retries did not fail dispatch"),
            );
        },
        (error: unknown) => {
          exhausted.reject(error);
        },
      );
    });
    try {
      await retryWorker.waitUntilReady();
      await retryQueue.add(
        "materialize",
        {
          dispatchId,
          claimToken,
          scope: { kind: "account", userId: accountId },
        },
        // Real BullMQ retry timing cannot be faked across Redis.
        {
          attempts: 2,
          backoff: { type: "fixed", delay: 1 },
          jobId: dispatchId,
        },
      );
      await exhausted.promise;
    } finally {
      await retryWorker.close();
      try {
        await retryQueue.obliterate({ force: true });
      } finally {
        await retryQueue.close();
      }
    }
    await expect(ledger(dispatchId)).resolves.toMatchObject({
      status: "failed",
      failureReason: "MATERIALIZATION_EXHAUSTED",
      failureSummary:
        "Notification delivery work exhausted processing retries.",
    });
    const inbox = await withAccountContextRaw(
      runtime,
      accountId,
      async (client) =>
        client.query<{ id: string; readAt: Date | null }>(
          `select id, read_at as "readAt"
           from notification_inbox_items
           where intent_id = $1 and recipient_user_id = $2`,
          [intentId, accountId],
        ),
    );
    expect(inbox.rows).toEqual([]);

    const recoveredToken = randomUUID();
    await owner.sql.query(
      `update notification_dispatch_ledger
       set status = 'enqueued', claim_token = $1, claimed_at = now(), enqueued_at = now()
       where id = $2`,
      [recoveredToken, dispatchId],
    );
    await processMaterialization(
      {
        dispatchId,
        claimToken: recoveredToken,
        scope: { kind: "account", userId: accountId },
      },
      createMaterializationDependencies(runtime),
    );

    await expect(ledger(dispatchId)).resolves.toMatchObject({
      status: "completed",
      attemptCount: 1,
      failureReason: null,
      failureSummary: null,
    });
    const recoveredInbox = await withAccountContextRaw(
      runtime,
      accountId,
      async (client) =>
        client.query<{ id: string; readAt: Date | null }>(
          `select id, read_at as "readAt"
           from notification_inbox_items
           where intent_id = $1 and recipient_user_id = $2`,
          [intentId, accountId],
        ),
    );
    expect(recoveredInbox.rows).toHaveLength(1);
    const recoveredItem = recoveredInbox.rows[0];
    if (!recoveredItem) throw new Error("missing inbox item after recovery");
    const inboxId = z.uuid().parse(recoveredItem.id);
    expect(recoveredItem.readAt).toBeNull();

    const preservedReadAt = new Date("2026-09-25T01:02:03.000Z");
    await owner.sql.query(
      "update notification_inbox_items set read_at = $1 where id = $2",
      [preservedReadAt, inboxId],
    );

    const replayToken = randomUUID();
    await owner.sql.query(
      `update notification_dispatch_ledger
       set status = 'enqueued', claim_token = $1, claimed_at = now(), enqueued_at = now()
       where id = $2`,
      [replayToken, dispatchId],
    );
    await processMaterialization(
      {
        dispatchId,
        claimToken: replayToken,
        scope: { kind: "account", userId: accountId },
      },
      createMaterializationDependencies(runtime),
    );
    await expect(
      withAccountContextRaw(runtime, accountId, async (client) =>
        client.query<{ id: string; readAt: Date | null }>(
          `select id, read_at as "readAt"
           from notification_inbox_items
           where intent_id = $1 and recipient_user_id = $2`,
          [intentId, accountId],
        ),
      ),
    ).resolves.toMatchObject({
      rows: [{ id: inboxId, readAt: preservedReadAt }],
    });

    await expect(
      failNotificationDispatch(runtime, {
        id: dispatchId,
        claimToken: recoveredToken,
        reason: "MATERIALIZATION_EXHAUSTED",
      }),
    ).resolves.toBe(false);
  });
  it("waits behind a role-change organization lock before applying current membership", async () => {
    const raceTenant = randomUUID();
    const founder = randomUUID();
    const recipient = randomUUID();
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const origin = `worker-lock-race:${run}:${intentId}`;
    const lockClient = await owner.sql.connect();
    let materializing: Promise<void> | undefined;
    try {
      await owner.sql.query(
        "insert into organization (id, name, slug) values ($1, $2, $3)",
        [raceTenant, "Race Tenant", `worker-race-${run}`],
      );
      await createUser(founder, "Race Founder");
      await createUser(recipient, "Race Recipient");
      await owner.sql.query(
        `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner'), ($4, $2, $5, 'admin')`,
        [randomUUID(), raceTenant, founder, randomUUID(), recipient],
      );
      await owner.sql.query(
        `insert into notification_intents (id, scope_kind, tenant_id, origin, event_type, occurred_at, actor_user_id) values ($1, 'tenant', $2, $3, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now(), $4)`,
        [intentId, raceTenant, origin, founder],
      );
      await owner.sql.query(
        `insert into notification_intent_recipients (intent_id, origin, recipient_user_id, scope_kind, tenant_id) values ($1, $2, $3, 'tenant', $4)`,
        [intentId, origin, recipient, raceTenant],
      );
      await owner.sql.query(
        `insert into notification_dispatch_ledger (id, intent_id, scope_kind, tenant_id)
         values ($1, $2, 'tenant', $3)`,
        [dispatchId, intentId, raceTenant],
      );
      const claimToken = randomUUID();
      await owner.sql.query(
        `update notification_dispatch_ledger
         set status = 'enqueued', claim_token = $1, claimed_at = now(), enqueued_at = now()
         where id = $2`,
        [claimToken, dispatchId],
      );
      const backend = await lockClient.query<{ pid: number }>(
        "select pg_backend_pid()::int as pid",
      );
      const backendPid = backend.rows[0]?.pid;
      if (!backendPid) throw new Error("lock client has no backend PID");
      await lockClient.query("begin");
      await lockClient.query(
        "select 1 from organization where id = $1 for update",
        [raceTenant],
      );
      await lockClient.query(
        "select pg_advisory_xact_lock(hashtext($1)::bigint)",
        [`notification-membership:${raceTenant}`],
      );
      await lockClient.query(
        "update member set role = 'member' where organization_id = $1 and user_id = $2",
        [raceTenant, recipient],
      );
      materializing = processMaterialization(
        {
          dispatchId,
          claimToken,
          scope: { kind: "tenant", tenantId: raceTenant },
        },
        createMaterializationDependencies(runtime),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const activity = await owner.sql.query<{ blocked: boolean }>(
          `select exists(
             select 1 from pg_stat_activity
             where $1 = any(pg_blocking_pids(pid))
               and wait_event_type = 'Lock'
               and query like 'select 1 from organization%'
           ) as blocked`,
          [backendPid],
        );
        waiting = activity.rows[0]?.blocked === true;
      }
      expect(waiting).toBe(true);
      await lockClient.query("commit");
      await materializing;
      await expect(ledger(dispatchId)).resolves.toMatchObject({
        status: "completed",
      });
      await withTenantContextRaw(runtime, raceTenant, async (client) => {
        await client.query(
          "select 1 from organization where id = $1 for update",
          [raceTenant],
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtext($1)::bigint)",
          [`notification-membership:${raceTenant}`],
        );
        await client.query(
          "update member set role = 'admin' where organization_id = $1 and user_id = $2",
          [raceTenant, recipient],
        );
      });
      await expect(
        owner.sql.query(
          "select id from notification_inbox_items where intent_id = $1",
          [intentId],
        ),
      ).resolves.toMatchObject({ rows: [] });
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      try {
        await materializing;
      } finally {
        await owner.sql.query('delete from "user" where id = any($1::text[])', [
          [founder, recipient],
        ]);
        await owner.sql.query("delete from organization where id = $1", [
          raceTenant,
        ]);
      }
    }
  });
});

describe("worker-first membership serialization", () => {
  it("commits materialization before a concurrent demotion can change the recipient", async () => {
    const raceTenant = randomUUID();
    const founder = randomUUID();
    const recipient = randomUUID();
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const origin = `worker-first-race:${run}:${intentId}`;
    const claimToken = randomUUID();
    const ledgerHolder = await owner.sql.connect();
    const allowDemotion = Promise.withResolvers<undefined>();
    let worker: Promise<void> | undefined;
    let demotion: Promise<void> | undefined;
    let demotionHasLocks = false;

    const waitFor = async (
      description: string,
      condition: () => Promise<boolean>,
    ): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await condition()) return;
      }
      throw new Error(`timed out waiting for ${description}`);
    };

    try {
      await owner.sql.query(
        "insert into organization (id, name, slug) values ($1, $2, $3)",
        [raceTenant, "Worker First Tenant", `worker-first-${run}`],
      );
      await createUser(founder, "Worker First Founder");
      await createUser(recipient, "Worker First Recipient");
      await owner.sql.query(
        `insert into member (id, organization_id, user_id, role)
         values ($1, $2, $3, 'owner'), ($4, $2, $5, 'admin')`,
        [randomUUID(), raceTenant, founder, randomUUID(), recipient],
      );
      await owner.sql.query(
        `insert into notification_intents
          (id, scope_kind, tenant_id, origin, event_type, occurred_at, actor_user_id)
         values ($1, 'tenant', $2, $3, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now(), $4)`,
        [intentId, raceTenant, origin, founder],
      );
      await owner.sql.query(
        `insert into notification_intent_recipients
          (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
         values ($1, $2, $3, 'tenant', $4)`,
        [intentId, origin, recipient, raceTenant],
      );
      await owner.sql.query(
        `insert into notification_dispatch_ledger (id, intent_id, scope_kind, tenant_id)
         values ($1, $2, 'tenant', $3)`,
        [dispatchId, intentId, raceTenant],
      );
      await owner.sql.query(
        `update notification_dispatch_ledger
         set status = 'enqueued', claim_token = $1, claimed_at = now(), enqueued_at = now()
         where id = $2`,
        [claimToken, dispatchId],
      );

      const dependencies = createMaterializationDependencies(runtime);
      await expect(
        dependencies.resolveClaim(dispatchId, claimToken),
      ).resolves.toMatchObject({
        intentId,
        scope: { kind: "tenant", tenantId: raceTenant },
      });
      const holderBackend = await ledgerHolder.query<{ pid: number }>(
        "select pg_backend_pid()::int as pid",
      );
      const holderPid = holderBackend.rows[0]?.pid;
      if (!holderPid) throw new Error("ledger holder has no backend PID");
      await ledgerHolder.query("begin");
      await ledgerHolder.query(
        "select id from notification_dispatch_ledger where id = $1 for update",
        [dispatchId],
      );

      worker = processMaterialization(
        {
          dispatchId,
          claimToken,
          scope: { kind: "tenant", tenantId: raceTenant },
        },
        dependencies,
      );

      let workerPid: number | undefined;
      await waitFor(
        "worker completion blocked by the claimed ledger row",
        async () => {
          const activity = await owner.sql.query<{ pid: number }>(
            `select pid
           from pg_stat_activity
           where $1 = any(pg_blocking_pids(pid))
             and wait_event_type = 'Lock'
             and query like '%complete_notification_dispatch%'
           limit 1`,
            [holderPid],
          );
          workerPid = activity.rows[0]?.pid;
          return workerPid !== undefined;
        },
      );
      if (!workerPid) throw new Error("blocked worker has no backend PID");

      demotion = withTenantContextRaw(runtime, raceTenant, async (client) => {
        await client.query(
          "select 1 from organization where id = $1 for update",
          [raceTenant],
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtext($1)::bigint)",
          [`notification-membership:${raceTenant}`],
        );
        demotionHasLocks = true;
        await allowDemotion.promise;
        await client.query(
          "update member set role = 'member' where organization_id = $1 and user_id = $2",
          [raceTenant, recipient],
        );
      });
      await waitFor(
        "demotion blocked by the worker organization lock",
        async () => {
          const activity = await owner.sql.query<{ blocked: boolean }>(
            `select exists(
             select 1
             from pg_stat_activity
             where $1 = any(pg_blocking_pids(pid))
               and wait_event_type = 'Lock'
               and query like 'select 1 from organization%'
           ) as blocked`,
            [workerPid],
          );
          return activity.rows[0]?.blocked === true;
        },
      );
      await expect(ledger(dispatchId)).resolves.toMatchObject({
        status: "enqueued",
      });
      await expect(
        withTenantContextRaw(runtime, raceTenant, async (client) =>
          client.query(
            "select id from notification_inbox_items where intent_id = $1",
            [intentId],
          ),
        ),
      ).resolves.toMatchObject({ rows: [] });

      await ledgerHolder.query("commit");
      await worker;
      await expect(ledger(dispatchId)).resolves.toMatchObject({
        status: "completed",
      });
      await waitFor(
        "demotion to acquire the released organization lock",
        async () => {
          await owner.sql.query("select 1");
          return demotionHasLocks;
        },
      );
      await expect(
        owner.sql.query<{ count: number }>(
          `select count(*)::int as count
           from notification_inbox_items
           where intent_id = $1 and recipient_user_id = $2`,
          [intentId, recipient],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });

      allowDemotion.resolve(undefined);
      await demotion;
      await expect(
        owner.sql.query<{ role: string }>(
          "select role from member where organization_id = $1 and user_id = $2",
          [raceTenant, recipient],
        ),
      ).resolves.toMatchObject({ rows: [{ role: "member" }] });
    } finally {
      allowDemotion.resolve(undefined);
      await ledgerHolder.query("rollback").catch(() => undefined);
      ledgerHolder.release();
      await worker?.catch(() => undefined);
      await demotion?.catch(() => undefined);
      await owner.sql.query('delete from "user" where id = any($1::text[])', [
        [founder, recipient],
      ]);
      await owner.sql.query("delete from organization where id = $1", [
        raceTenant,
      ]);
    }
  });
});
