import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimNotificationDispatches,
  completeNotificationDispatch,
  createDatabase,
  failNotificationDispatch,
  insertAccountNotificationIntent,
  insertMonitorNotificationIntent,
  markNotificationDispatchEnqueued,
  purgeExpiredNotificationInboxItems,
  recordAccountMfaTransition,
  requeueStaleNotificationDispatches,
  resolveNotificationDispatchClaim,
  runMigrations,
  type Database,
  withAccountContext,
  withAccountContextRaw,
  withTenantContext,
  withTenantContextRaw,
} from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;

if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "notification database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = randomUUID();
const accountA = randomUUID();
const accountB = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
let ownerConnected = false;

beforeAll(async () => {
  await runMigrations({
    url: ownerUrl,
    migrationsDir: new URL("../migrations", import.meta.url).pathname,
    log: () => undefined,
  });
  await owner.connect();
  ownerConnected = true;
  await owner.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Account A', $2, true), ($3, 'Account B', $4, true)`,
    [
      accountA,
      `notification-a-${run}@example.test`,
      accountB,
      `notification-b-${run}@example.test`,
    ],
  );
  await owner.query(
    `insert into organization (id, name, slug)
     values ($1, 'Tenant A', $2), ($3, 'Tenant B', $4)`,
    [tenantA, `notification-a-${run}`, tenantB, `notification-b-${run}`],
  );
});

afterAll(async () => {
  if (ownerConnected) {
    await owner.query('delete from "user" where id = any($1::text[])', [
      [accountA, accountB],
    ]);
    await owner.query("delete from organization where id = any($1::uuid[])", [
      [tenantA, tenantB],
    ]);
    await owner.end();
  }
  await database.close();
});

describe("notification database scopes", () => {
  it("enforces account context and exposes only bounded ledger claims", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    const occurredAt = new Date();

    await withAccountContext(database, accountA, async (tx) => {
      await insertAccountNotificationIntent(tx, {
        id: intentId,
        dispatchId,
        userId: accountA,
        origin: `password-change:${run}`,
        eventType: "PASSWORD_CHANGED",
        occurredAt,
      });
    });

    const expiry = await owner.query<{ correct: boolean }>(
      `select expires_at = occurred_at + interval '30 days' as correct
       from notification_intents where id = $1`,
      [intentId],
    );
    expect(expiry.rows).toEqual([{ correct: true }]);

    const crossAccount = await withAccountContext(
      database,
      accountB,
      async (tx) => tx.execute(sql`select id from notification_intents`),
    );
    expect(crossAccount.rows).toEqual([]);
    await expect(
      database.sql.query(
        `insert into notification_intents
          (id, scope_kind, user_id, origin, event_type, occurred_at)
         values ($1, 'account', $2, $3, 'PASSWORD_CHANGED', now())`,
        [randomUUID(), accountB, `missing-context:${run}`],
      ),
    ).rejects.toThrow();
    await expect(
      database.sql.query("select * from notification_dispatch_ledger"),
    ).rejects.toThrow();

    await expect(
      claimNotificationDispatches(database, {
        claimToken: randomUUID(),
        limit: 0,
      }),
    ).rejects.toThrow("claim limit must be an integer between 1 and 100");

    const claimToken = randomUUID();
    await owner.query(
      `update notification_dispatch_ledger
       set status = 'claimed', claim_token = $1, claimed_at = now()
       where id = $2`,
      [claimToken, dispatchId],
    );
    await expect(
      markNotificationDispatchEnqueued(database, {
        id: dispatchId,
        claimToken,
      }),
    ).resolves.toBe(true);
    await expect(
      resolveNotificationDispatchClaim(database, {
        id: dispatchId,
        claimToken,
      }),
    ).resolves.toEqual({
      intentId,
      scopeKind: "account",
      tenantId: null,
      userId: accountA,
    });
    await expect(
      completeNotificationDispatch(database, { id: dispatchId, claimToken }),
    ).resolves.toBe(true);

    await withAccountContextRaw(database, accountA, async (client) => {
      const result = await client.query<{ user_id: string }>(
        "select current_setting('app.user_id', true) as user_id",
      );
      expect(result.rows).toEqual([{ user_id: accountA }]);
    });
    const client = await database.sql.connect();
    try {
      const result = await client.query<{ user_id: string }>(
        "select current_setting('app.user_id', true) as user_id",
      );
      expect(result.rows).toEqual([{ user_id: "" }]);
    } finally {
      client.release();
    }
  });

  it("forces tenant context and rolls back account intent with its transaction", async () => {
    await withTenantContext(database, tenantA, async (tx) => {
      await tx.execute(
        sql`insert into notification_org_settings (tenant_id) values (${tenantA})`,
      );
    });
    const crossTenant = await withTenantContext(database, tenantB, async (tx) =>
      tx.execute(sql`select tenant_id from notification_org_settings`),
    );
    expect(crossTenant.rows).toEqual([]);
    await expect(
      withTenantContext(database, tenantB, async (tx) =>
        tx.execute(
          sql`insert into notification_org_settings (tenant_id) values (${tenantA})`,
        ),
      ),
    ).rejects.toThrow();

    const rolledBackIntentId = randomUUID();
    await expect(
      withAccountContext(database, accountA, async (tx) => {
        await insertAccountNotificationIntent(tx, {
          id: rolledBackIntentId,
          dispatchId: randomUUID(),
          userId: accountA,
          origin: `rollback:${run}`,
          eventType: "MFA_ENABLED",
          occurredAt: new Date("2026-09-25T00:00:00.000Z"),
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    const result = await owner.query<{ count: string }>(
      "select count(*) from notification_intents where id = $1",
      [rolledBackIntentId],
    );
    expect(result.rows).toEqual([{ count: "0" }]);
  });

  it("requeues a stale runtime claim so it can be claimed again", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    await withAccountContext(database, accountA, async (tx) => {
      await insertAccountNotificationIntent(tx, {
        id: intentId,
        dispatchId,
        userId: accountA,
        origin: `requeue:${run}`,
        eventType: "PASSWORD_CHANGED",
        occurredAt: new Date(),
      });
    });
    await owner.query(
      `update notification_dispatch_ledger
       set created_at = '2000-01-01T00:00:00.000Z'
       where id = $1`,
      [dispatchId],
    );

    const firstClaimToken = randomUUID();
    await expect(
      claimNotificationDispatches(database, {
        claimToken: firstClaimToken,
        limit: 1,
      }),
    ).resolves.toEqual([
      {
        id: dispatchId,
        intentId,
        scopeKind: "account",
        tenantId: null,
        userId: accountA,
      },
    ]);
    await owner.query(
      `update notification_dispatch_ledger
       set claimed_at = '2000-01-01T00:00:00.000Z'
       where id = $1`,
      [dispatchId],
    );

    await expect(
      requeueStaleNotificationDispatches(database, {
        claimedBefore: new Date("2001-01-01T00:00:00.000Z"),
        limit: 1,
      }),
    ).resolves.toEqual([dispatchId]);

    await expect(
      claimNotificationDispatches(database, {
        claimToken: randomUUID(),
        limit: 1,
      }),
    ).resolves.toEqual([
      {
        id: dispatchId,
        intentId,
        scopeKind: "account",
        tenantId: null,
        userId: accountA,
      },
    ]);
  });

  it("records safe dispatch failure reasons and clears them when recovered", async () => {
    const intentId = randomUUID();
    const dispatchId = randomUUID();
    await withAccountContext(database, accountA, async (tx) => {
      await insertAccountNotificationIntent(tx, {
        id: intentId,
        dispatchId,
        userId: accountA,
        origin: `failure-summary:${run}`,
        eventType: "PASSWORD_CHANGED",
        occurredAt: new Date(),
      });
    });

    const firstToken = randomUUID();
    await owner.query(
      `update notification_dispatch_ledger
       set status = 'claimed', claim_token = $1, claimed_at = now()
       where id = $2`,
      [firstToken, dispatchId],
    );
    await expect(
      failNotificationDispatch(database, {
        id: dispatchId,
        claimToken: firstToken,
        reason: "QUEUE_ADD_FAILED",
      }),
    ).resolves.toBe(true);
    await expect(
      owner.query(
        `select status, failure_reason, failure_summary
         from notification_dispatch_ledger where id = $1`,
        [dispatchId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "failed",
          failure_reason: "QUEUE_ADD_FAILED",
          failure_summary: "Unable to submit notification work for delivery.",
        },
      ],
    });
    await expect(
      database.sql.query("select fail_notification_dispatch($1, $2, $3)", [
        dispatchId,
        firstToken,
        "raw://credential@example.test",
      ]),
    ).rejects.toThrow("invalid notification dispatch failure reason");

    const recoveredToken = randomUUID();
    const recovered = await claimNotificationDispatches(database, {
      claimToken: recoveredToken,
      limit: 100,
    });
    expect(recovered).toContainEqual(
      expect.objectContaining({ id: dispatchId }),
    );
    await expect(
      owner.query(
        `select status, failure_reason, failure_summary
         from notification_dispatch_ledger where id = $1`,
        [dispatchId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { status: "claimed", failure_reason: null, failure_summary: null },
      ],
    });
    await expect(
      markNotificationDispatchEnqueued(database, {
        id: dispatchId,
        claimToken: recoveredToken,
      }),
    ).resolves.toBe(true);
    await expect(
      completeNotificationDispatch(database, {
        id: dispatchId,
        claimToken: recoveredToken,
      }),
    ).resolves.toBe(true);
    await expect(
      owner.query(
        `select status, failure_reason, failure_summary
         from notification_dispatch_ledger where id = $1`,
        [dispatchId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { status: "completed", failure_reason: null, failure_summary: null },
      ],
    });
  });

  it("holds exhausted and invalid-scope failures instead of reclaiming them", async () => {
    for (const reason of [
      "MATERIALIZATION_EXHAUSTED",
      "INVALID_SCOPE",
    ] as const) {
      const dispatchId = randomUUID();
      await withAccountContext(database, accountA, async (tx) => {
        await insertAccountNotificationIntent(tx, {
          id: randomUUID(),
          dispatchId,
          userId: accountA,
          origin: `terminal-failure:${reason}:${run}`,
          eventType: "PASSWORD_CHANGED",
          occurredAt: new Date(),
        });
      });
      const token = randomUUID();
      await owner.query(
        `update notification_dispatch_ledger
         set status = 'claimed', claim_token = $1, claimed_at = now()
         where id = $2`,
        [token, dispatchId],
      );
      // Only acknowledged work can be exhausted by materialization.
      if (reason === "MATERIALIZATION_EXHAUSTED") {
        await expect(
          markNotificationDispatchEnqueued(database, {
            id: dispatchId,
            claimToken: token,
          }),
        ).resolves.toBe(true);
      }
      await expect(
        failNotificationDispatch(database, {
          id: dispatchId,
          claimToken: token,
          reason,
        }),
      ).resolves.toBe(true);

      const claimed = await claimNotificationDispatches(database, {
        claimToken: randomUUID(),
        limit: 100,
      });
      expect(claimed).not.toContainEqual(
        expect.objectContaining({ id: dispatchId }),
      );
      await expect(
        owner.query(
          `select status, failure_reason from notification_dispatch_ledger
           where id = $1`,
          [dispatchId],
        ),
      ).resolves.toMatchObject({
        rows: [{ status: "failed", failure_reason: reason }],
      });
    }
  });

  it("leaves pre-acknowledgement exhaustion for stale-claim recovery", async () => {
    const dispatchId = randomUUID();
    await withAccountContext(database, accountA, async (tx) => {
      await insertAccountNotificationIntent(tx, {
        id: randomUUID(),
        dispatchId,
        userId: accountA,
        origin: `pre-ack-exhausted:${run}`,
        eventType: "PASSWORD_CHANGED",
        occurredAt: new Date(),
      });
    });
    const token = randomUUID();
    await owner.query(
      `update notification_dispatch_ledger
       set status = 'claimed', claim_token = $1,
           claimed_at = '2000-01-01T00:00:00.000Z'
       where id = $2`,
      [token, dispatchId],
    );

    // The scheduler died after queue.add but before the enqueue ack.
    await expect(
      failNotificationDispatch(database, {
        id: dispatchId,
        claimToken: token,
        reason: "MATERIALIZATION_EXHAUSTED",
      }),
    ).resolves.toBe(false);
    await expect(
      owner.query(
        `select status, failure_reason from notification_dispatch_ledger
         where id = $1`,
        [dispatchId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: "claimed", failure_reason: null }],
    });

    await expect(
      requeueStaleNotificationDispatches(database, {
        claimedBefore: new Date("2001-01-01T00:00:00.000Z"),
        limit: 100,
      }),
    ).resolves.toContain(dispatchId);
    const reclaimed = await claimNotificationDispatches(database, {
      claimToken: randomUUID(),
      limit: 100,
    });
    expect(reclaimed).toContainEqual(
      expect.objectContaining({ id: dispatchId }),
    );
  });

  it("lets the runtime update only inbox read state", async () => {
    await expect(
      database.sql.query(
        "update notification_inbox_items set read_at = read_at where false",
      ),
    ).resolves.toBeDefined();
    for (const column of [
      "recipient_user_id",
      "event_type",
      "occurred_at",
      "actor_display_name",
    ]) {
      await expect(
        database.sql.query(
          `update notification_inbox_items set ${column} = ${column} where false`,
        ),
      ).rejects.toThrow("permission denied");
    }
  });

  it("exposes completed dispatch existence only in its verified scope", async () => {
    const accountIntentId = randomUUID();
    const accountDispatchId = randomUUID();
    const failedAccountIntentId = randomUUID();
    const failedAccountDispatchId = randomUUID();
    const tenantIntentId = randomUUID();
    const tenantDispatchId = randomUUID();
    const pendingTenantIntentId = randomUUID();
    const pendingTenantDispatchId = randomUUID();

    await withAccountContext(database, accountA, async (tx) => {
      await insertAccountNotificationIntent(tx, {
        id: accountIntentId,
        dispatchId: accountDispatchId,
        userId: accountA,
        origin: `visibility-account:${run}`,
        eventType: "PASSWORD_CHANGED",
        occurredAt: new Date(),
      });
      await insertAccountNotificationIntent(tx, {
        id: failedAccountIntentId,
        dispatchId: failedAccountDispatchId,
        userId: accountA,
        origin: `visibility-failed:${run}`,
        eventType: "MFA_ENABLED",
        occurredAt: new Date(),
      });
    });
    await owner.query(
      `insert into notification_intents
        (id, scope_kind, tenant_id, origin, event_type, occurred_at)
       values
        ($1, 'tenant', $2, $3, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now()),
        ($4, 'tenant', $2, $5, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now())`,
      [
        tenantIntentId,
        tenantA,
        `visibility-tenant:${run}`,
        pendingTenantIntentId,
        `visibility-tenant-pending:${run}`,
      ],
    );
    await owner.query(
      `insert into notification_dispatch_ledger
        (id, intent_id, scope_kind, tenant_id, status)
       values
        ($1, $2, 'tenant', $3, 'completed'),
        ($4, $5, 'tenant', $3, 'pending')`,
      [
        tenantDispatchId,
        tenantIntentId,
        tenantA,
        pendingTenantDispatchId,
        pendingTenantIntentId,
      ],
    );
    await owner.query(
      `update notification_dispatch_ledger
       set status = 'failed'
       where id = $1`,
      [failedAccountDispatchId],
    );

    const allIntentIds = [
      accountIntentId,
      failedAccountIntentId,
      tenantIntentId,
      pendingTenantIntentId,
    ];
    const noContext = await database.sql.query<{ intent_id: string }>(
      `select intent_id from notification_dispatch_ledger
       where intent_id = any($1::text[])`,
      [allIntentIds],
    );
    expect(noContext.rows).toEqual([]);

    await withAccountContextRaw(database, accountA, async (client) => {
      const beforeComplete = await client.query<{ intent_id: string }>(
        `select intent_id from notification_dispatch_ledger
         where intent_id = any($1::text[])`,
        [allIntentIds],
      );
      expect(beforeComplete.rows).toEqual([]);
      await expect(
        client.query(
          `select id, claim_token, attempt_count, failure_reason, failure_summary
           from notification_dispatch_ledger
           where intent_id = $1`,
          [accountIntentId],
        ),
      ).rejects.toThrow();
    });

    const claimToken = randomUUID();
    await owner.query(
      `update notification_dispatch_ledger
       set status = 'claimed', claim_token = $1, claimed_at = now()
       where id = $2`,
      [claimToken, accountDispatchId],
    );
    await expect(
      resolveNotificationDispatchClaim(database, {
        id: accountDispatchId,
        claimToken,
      }),
    ).resolves.toEqual({
      intentId: accountIntentId,
      scopeKind: "account",
      tenantId: null,
      userId: accountA,
    });
    await withAccountContextRaw(database, accountA, async (client) => {
      const claimed = await client.query<{ intent_id: string }>(
        `select intent_id from notification_dispatch_ledger
         where intent_id = $1`,
        [accountIntentId],
      );
      expect(claimed.rows).toEqual([]);
    });

    await expect(
      markNotificationDispatchEnqueued(database, {
        id: accountDispatchId,
        claimToken,
      }),
    ).resolves.toBe(true);
    await withAccountContextRaw(database, accountA, async (client) => {
      const enqueued = await client.query<{ intent_id: string }>(
        `select intent_id from notification_dispatch_ledger
         where intent_id = $1`,
        [accountIntentId],
      );
      expect(enqueued.rows).toEqual([]);
    });

    await expect(
      completeNotificationDispatch(database, {
        id: accountDispatchId,
        claimToken,
      }),
    ).resolves.toBe(true);

    await withAccountContextRaw(database, accountA, async (client) => {
      const visible = await client.query<{ intent_id: string; status: string }>(
        `select intent_id, status from notification_dispatch_ledger
         where intent_id = any($1::text[])`,
        [allIntentIds],
      );
      expect(visible.rows).toEqual([
        { intent_id: accountIntentId, status: "completed" },
      ]);
    });
    await withAccountContextRaw(database, accountB, async (client) => {
      const crossAccount = await client.query<{ intent_id: string }>(
        `select intent_id from notification_dispatch_ledger
         where intent_id = any($1::text[])`,
        [allIntentIds],
      );
      expect(crossAccount.rows).toEqual([]);
    });
    await withTenantContextRaw(database, tenantA, async (client) => {
      const visible = await client.query<{ intent_id: string; status: string }>(
        `select intent_id, status from notification_dispatch_ledger
         where intent_id = any($1::text[])`,
        [allIntentIds],
      );
      expect(visible.rows).toEqual([
        { intent_id: tenantIntentId, status: "completed" },
      ]);
    });
    await withTenantContextRaw(database, tenantB, async (client) => {
      const crossTenant = await client.query<{ intent_id: string }>(
        `select intent_id from notification_dispatch_ledger
         where intent_id = any($1::text[])`,
        [allIntentIds],
      );
      expect(crossTenant.rows).toEqual([]);
    });
  });
});

describe("monitor notification schema", () => {
  const MONITOR_EVENT_TYPES = [
    "MONITOR_DOWN",
    "MONITOR_RECOVERED",
    "MONITOR_SSL_CAUTION",
    "MONITOR_SSL_DANGER",
    "MONITOR_SSL_EXPIRED",
  ];
  const tenantM = randomUUID();
  const users = {
    owner: randomUUID(),
    admin: randomUUID(),
    viewer: randomUUID(),
    auditor: randomUUID(),
  };

  beforeAll(async () => {
    await owner.query(
      `insert into organization (id, name, slug) values ($1, 'Tenant M', $2)`,
      [tenantM, `notification-m-${run}`],
    );
    for (const [role, id] of Object.entries(users)) {
      await owner.query(
        `insert into "user" (id, name, email, email_verified)
         values ($1, $2, $3, true)`,
        [id, role, `monitor-${role}-${run}@example.test`],
      );
      await owner.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [randomUUID(), tenantM, id, role === "admin" ? "viewer,admin" : role],
      );
    }
  });

  afterAll(async () => {
    await owner.query("delete from organization where id = $1", [tenantM]);
    await owner.query('delete from "user" where id = any($1::text[])', [
      Object.values(users),
    ]);
  });

  it("keeps exactly one event_type and one scope CHECK per table", async () => {
    for (const table of ["notification_intents", "notification_inbox_items"]) {
      const result = await owner.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
         where conrelid = $1::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%event_type%'
         order by conname`,
        [table],
      );
      expect(result.rows.map((row) => row.conname)).toEqual([
        `${table}_event_type_check`,
        `${table}_scope_check`,
      ]);
      for (const row of result.rows) {
        for (const type of MONITOR_EVENT_TYPES) expect(row.def).toContain(type);
      }
    }
  });

  it("accepts old event types and monitor types in tenant scope only", async () => {
    const insertIntent = (
      scope: "tenant" | "account",
      eventType: string,
    ): Promise<unknown> =>
      owner.query(
        `insert into notification_intents
           (id, scope_kind, tenant_id, user_id, origin, event_type, occurred_at)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [
          randomUUID(),
          scope,
          scope === "tenant" ? tenantM : null,
          scope === "account" ? users.owner : null,
          `check-${randomUUID()}`,
          eventType,
        ],
      );

    await insertIntent("tenant", "ORG-NOTIFICATION-SETTINGS-CHANGED");
    await insertIntent("account", "PASSWORD_CHANGED");
    await insertIntent("account", "MFA_ENABLED");
    await insertIntent("account", "MFA_DISABLED");
    for (const type of MONITOR_EVENT_TYPES) {
      await insertIntent("tenant", type);
      await expect(insertIntent("account", type)).rejects.toThrow(
        "notification_intents_scope_check",
      );
    }
    await expect(insertIntent("tenant", "PASSWORD_CHANGED")).rejects.toThrow(
      "notification_intents_scope_check",
    );
    await expect(insertIntent("tenant", "MONITOR_UNKNOWN")).rejects.toThrow(
      "notification_intents_event_type_check",
    );
  });

  it("snapshots owners and admins and stores the monitor subject without a monitor row", async () => {
    const monitorId = randomUUID();
    const origin = `monitor:${monitorId}:incident:${run}:down`;
    const input = {
      tenantId: tenantM,
      monitorId,
      monitorName: "Checkout",
      eventType: "MONITOR_DOWN" as const,
      origin,
      occurredAt: new Date(),
      reason: "http_status",
      sslNotAfter: null,
    };
    const created = await withTenantContextRaw(database, tenantM, (client) =>
      insertMonitorNotificationIntent(client, input),
    );
    const replay = await withTenantContextRaw(database, tenantM, (client) =>
      insertMonitorNotificationIntent(client, input),
    );
    expect({ created, replay }).toEqual({ created: true, replay: false });

    const rows = await owner.query(
      `select intent.subject_monitor_id, intent.subject_monitor_name,
              intent.monitor_reason, count(distinct ledger.id)::int as ledgers,
              array_agg(recipient.recipient_user_id order by recipient.recipient_user_id) as recipients
       from notification_intents intent
       join notification_intent_recipients recipient on recipient.intent_id = intent.id
       join notification_dispatch_ledger ledger on ledger.intent_id = intent.id
       where intent.origin = $1
       group by intent.id`,
      [origin],
    );
    expect(rows.rows).toEqual([
      {
        subject_monitor_id: monitorId,
        subject_monitor_name: "Checkout",
        monitor_reason: "http_status",
        ledgers: 1,
        recipients: [users.owner, users.admin].sort(),
      },
    ]);
  });
});

describe("notification dispatch function security", () => {
  it("uses dedicated restricted owners and preserves scoped dispatch and expiry work", async () => {
    const intentId = randomUUID();
    const unexpiredIntentId = randomUUID();
    const dispatchId = randomUUID();
    const expiredInboxId = randomUUID();
    const unexpiredInboxId = randomUUID();
    const claimToken = randomUUID();

    const functions = await owner.query<{
      function_name: string;
      owner: string;
      public_execute: boolean;
      runtime_execute: boolean;
    }>(
      `select
         procedure.proname as function_name,
         role.rolname as owner,
         has_function_privilege('public', procedure.oid, 'execute') as public_execute,
         has_function_privilege('nightwatch', procedure.oid, 'execute') as runtime_execute
       from pg_proc as procedure
       join pg_roles as role on role.oid = procedure.proowner
       where procedure.pronamespace = 'public'::regnamespace
         and procedure.proname = any($1::text[])
       order by procedure.proname`,
      [
        [
          "claim_notification_dispatches",
          "complete_notification_dispatch",
          "create_notification_dispatch",
          "fail_notification_dispatch",
          "mark_notification_dispatch_enqueued",
          "purge_expired_notification_inbox_items",
          "requeue_stale_notification_dispatches",
          "resolve_notification_dispatch_claim",
        ],
      ],
    );
    expect(functions.rows).toEqual([
      {
        function_name: "claim_notification_dispatches",
        owner: "nightwatch_notification_ledger_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "complete_notification_dispatch",
        owner: "nightwatch_notification_ledger_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "create_notification_dispatch",
        owner: "nightwatch_notification_dispatch_origin_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "fail_notification_dispatch",
        owner: "nightwatch_notification_ledger_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "mark_notification_dispatch_enqueued",
        owner: "nightwatch_notification_ledger_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "purge_expired_notification_inbox_items",
        owner: "nightwatch_notification_expiry_purge_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "requeue_stale_notification_dispatches",
        owner: "nightwatch_notification_ledger_owner",
        public_execute: false,
        runtime_execute: true,
      },
      {
        function_name: "resolve_notification_dispatch_claim",
        owner: "nightwatch_notification_ledger_owner",
        public_execute: false,
        runtime_execute: true,
      },
    ]);

    const roles = await owner.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      `select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       from pg_roles
       where rolname = any($1::text[])
       order by rolname`,
      [
        [
          "nightwatch_notification_dispatch_origin_owner",
          "nightwatch_notification_expiry_purge_owner",
          "nightwatch_notification_ledger_owner",
        ],
      ],
    );
    expect(roles.rows).toEqual([
      {
        rolname: "nightwatch_notification_dispatch_origin_owner",
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: "nightwatch_notification_expiry_purge_owner",
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: "nightwatch_notification_ledger_owner",
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);

    const privileges = await owner.query<{
      role_name: string;
      ledger_select: boolean;
      ledger_update: boolean;
      intents_select: boolean;
      inbox_select: boolean;
      inbox_update: boolean;
      inbox_delete: boolean;
    }>(
      `select
         role_name,
         has_table_privilege(role_name, 'notification_dispatch_ledger', 'select') as ledger_select,
         has_table_privilege(role_name, 'notification_dispatch_ledger', 'update') as ledger_update,
         has_table_privilege(role_name, 'notification_intents', 'select') as intents_select,
         has_table_privilege(role_name, 'notification_inbox_items', 'select') as inbox_select,
         has_table_privilege(role_name, 'notification_inbox_items', 'update') as inbox_update,
         has_table_privilege(role_name, 'notification_inbox_items', 'delete') as inbox_delete
       from unnest($1::text[]) as role_name
       order by role_name`,
      [
        [
          "nightwatch_notification_dispatch_origin_owner",
          "nightwatch_notification_expiry_purge_owner",
          "nightwatch_notification_ledger_owner",
        ],
      ],
    );
    expect(privileges.rows).toEqual([
      {
        role_name: "nightwatch_notification_dispatch_origin_owner",
        ledger_select: true,
        ledger_update: false,
        intents_select: true,
        inbox_select: false,
        inbox_update: false,
        inbox_delete: false,
      },
      {
        role_name: "nightwatch_notification_expiry_purge_owner",
        ledger_select: false,
        ledger_update: false,
        intents_select: false,
        inbox_select: true,
        inbox_update: true,
        inbox_delete: true,
      },
      {
        role_name: "nightwatch_notification_ledger_owner",
        ledger_select: true,
        ledger_update: true,
        intents_select: false,
        inbox_select: false,
        inbox_update: false,
        inbox_delete: false,
      },
    ]);

    const rls = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relname = any($1::text[])
       order by relname`,
      [
        [
          "notification_dispatch_ledger",
          "notification_inbox_items",
          "notification_intents",
        ],
      ],
    );
    expect(rls.rows).toEqual([
      {
        relname: "notification_dispatch_ledger",
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: "notification_inbox_items",
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: "notification_intents",
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
    ]);

    await owner.query(
      `insert into notification_intents
        (id, scope_kind, user_id, origin, event_type, occurred_at)
       values
        ($1, 'account', $2, $3, 'PASSWORD_CHANGED', now()),
        ($4, 'account', $2, $5, 'PASSWORD_CHANGED', now())`,
      [
        intentId,
        accountA,
        `security-owner:${run}`,
        unexpiredIntentId,
        `security-unexpired:${run}`,
      ],
    );
    await expect(
      database.sql.query("select create_notification_dispatch($1, $2)", [
        dispatchId,
        intentId,
      ]),
    ).rejects.toThrow("notification dispatch intent is outside current scope");
    await expect(
      withAccountContextRaw(database, accountB, (client) =>
        client.query("select create_notification_dispatch($1, $2)", [
          dispatchId,
          intentId,
        ]),
      ),
    ).rejects.toThrow("notification dispatch intent is outside current scope");
    await withAccountContextRaw(database, accountA, async (client) => {
      await client.query("select create_notification_dispatch($1, $2)", [
        dispatchId,
        intentId,
      ]);
    });

    await owner.query(
      `update notification_dispatch_ledger
       set created_at = '1900-01-01T00:00:00.000Z'
       where id = $1`,
      [dispatchId],
    );
    const claimed = await claimNotificationDispatches(database, {
      claimToken,
      limit: 100,
    });
    expect(claimed).toContainEqual({
      id: dispatchId,
      intentId,
      scopeKind: "account",
      tenantId: null,
      userId: accountA,
    });
    await owner.query(
      `update notification_dispatch_ledger
       set claimed_at = '1900-01-01T00:00:00.000Z'
       where id = $1`,
      [dispatchId],
    );
    await expect(
      requeueStaleNotificationDispatches(database, {
        claimedBefore: new Date("2000-01-01T00:00:00.000Z"),
        limit: 100,
      }),
    ).resolves.toContain(dispatchId);
    const recoveredToken = randomUUID();
    await claimNotificationDispatches(database, {
      claimToken: recoveredToken,
      limit: 100,
    });
    await expect(
      resolveNotificationDispatchClaim(database, {
        id: dispatchId,
        claimToken: recoveredToken,
      }),
    ).resolves.toEqual({
      intentId,
      scopeKind: "account",
      tenantId: null,
      userId: accountA,
    });

    await owner.query(
      `insert into notification_inbox_items
        (id, intent_id, origin, recipient_user_id, scope_kind, user_id, event_type, occurred_at)
       values
         ($1, $2, $3, $4, 'account', $4, 'PASSWORD_CHANGED', now()),
         ($5, $6, $7, $4, 'account', $4, 'PASSWORD_CHANGED', now())`,
      [
        expiredInboxId,
        intentId,
        `security-owner:${run}`,
        accountA,
        unexpiredInboxId,
        unexpiredIntentId,
        `security-unexpired:${run}`,
      ],
    );
    await owner.query(
      `update notification_inbox_items
       set expires_at = now() - interval '1 second'
       where id = $1`,
      [expiredInboxId],
    );
    await expect(
      purgeExpiredNotificationInboxItems(database, { limit: 100 }),
    ).resolves.toContain(expiredInboxId);
    await expect(
      owner.query(
        "select id from notification_inbox_items where id = any($1::text[]) order by id",
        [[expiredInboxId, unexpiredInboxId]],
      ),
    ).resolves.toMatchObject({ rows: [{ id: unexpiredInboxId }] });
  });
});

describe("legacy MFA projection migration", () => {
  it("backfills only effective verified MFA and preserves the first transition", async () => {
    const databaseName = `notification_mfa_backfill_${randomUUID().replaceAll("-", "")}`;
    const migrationsDir = new URL("../migrations", import.meta.url).pathname;
    const legacyMigrationsDir = await mkdtemp(
      join(tmpdir(), "nightwatch-legacy-migrations-"),
    );
    const isolatedOwnerUrl = new URL(ownerUrl);
    isolatedOwnerUrl.pathname = `/${databaseName}`;
    const isolatedRuntimeUrl = new URL(runtimeUrl);
    isolatedRuntimeUrl.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: ownerUrl });
    let adminConnected = false;
    let isolatedOwner: Client | undefined;
    let isolatedDatabase: Database | undefined;

    try {
      await Promise.all(
        (await readdir(migrationsDir))
          .filter((name) => name <= "0005_notification_dispatch_visibility.sql")
          .map((name) =>
            cp(join(migrationsDir, name), join(legacyMigrationsDir, name)),
          ),
      );
      await admin.connect();
      adminConnected = true;
      await admin.query(`create database ${databaseName}`);

      await runMigrations({
        url: isolatedOwnerUrl.toString(),
        migrationsDir: legacyMigrationsDir,
        log: () => undefined,
      });
      isolatedOwner = new Client({
        connectionString: isolatedOwnerUrl.toString(),
      });
      await isolatedOwner.connect();

      const verifiedUser = randomUUID();
      const staleProjectionUser = randomUUID();
      const pendingUser = randomUUID();
      const disabledUser = randomUUID();
      await isolatedOwner.query(
        `insert into "user" (id, name, email, email_verified, two_factor_enabled)
         values
           ($1, 'Verified legacy', $2, true, true),
           ($3, 'Stale projection', $4, true, true),
           ($5, 'Pending legacy', $6, true, true),
           ($7, 'Disabled legacy', $8, true, false)`,
        [
          verifiedUser,
          `${verifiedUser}@example.test`,
          staleProjectionUser,
          `${staleProjectionUser}@example.test`,
          pendingUser,
          `${pendingUser}@example.test`,
          disabledUser,
          `${disabledUser}@example.test`,
        ],
      );
      await isolatedOwner.query(
        `insert into "twoFactor" (id, user_id, secret, backup_codes, verified)
         values
           ($1, $2, 'test-secret', 'test-codes', true),
           ($3, $4, 'test-secret', 'test-codes', true),
           ($5, $6, 'test-secret', 'test-codes', false),
           ($7, $8, 'test-secret', 'test-codes', true)`,
        [
          randomUUID(),
          verifiedUser,
          randomUUID(),
          staleProjectionUser,
          randomUUID(),
          pendingUser,
          randomUUID(),
          disabledUser,
        ],
      );
      await isolatedOwner.query(
        `insert into notification_account_mfa_state (user_id, verified_enabled)
         values ($1, false)`,
        [staleProjectionUser],
      );
      expect(
        (
          await isolatedOwner.query(
            "select count(*)::integer as count from notification_account_mfa_state",
          )
        ).rows,
      ).toEqual([{ count: 1 }]);

      await Promise.all(
        [
          "0006_notification_account_mfa_backfill.sql",
          "0007_notification_dispatch_failure_summary.sql",
        ].map((name) =>
          cp(join(migrationsDir, name), join(legacyMigrationsDir, name)),
        ),
      );
      const result = await runMigrations({
        url: isolatedOwnerUrl.toString(),
        migrationsDir: legacyMigrationsDir,
        log: () => undefined,
      });
      expect(result.applied).toEqual([
        "0006_notification_account_mfa_backfill.sql",
        "0007_notification_dispatch_failure_summary.sql",
      ]);
      expect(
        (
          await isolatedOwner.query<{
            user_id: string;
            verified_enabled: boolean;
          }>(
            `select user_id, verified_enabled
             from notification_account_mfa_state
             order by user_id`,
          )
        ).rows,
      ).toEqual(
        [
          { user_id: verifiedUser, verified_enabled: true },
          { user_id: staleProjectionUser, verified_enabled: true },
        ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
      );
      expect(
        (
          await isolatedOwner.query(
            `select count(*)::integer as count
             from notification_intents
             where event_type in ('MFA_ENABLED', 'MFA_DISABLED')`,
          )
        ).rows,
      ).toEqual([{ count: 0 }]);

      isolatedDatabase = createDatabase(isolatedRuntimeUrl.toString());
      const reEnrollment = await withAccountContext(
        isolatedDatabase,
        verifiedUser,
        async (tx) =>
          recordAccountMfaTransition(tx, {
            id: randomUUID(),
            dispatchId: randomUUID(),
            userId: verifiedUser,
            origin: `legacy-reenrollment:${databaseName}`,
            transition: "enabled",
            occurredAt: new Date(),
          }),
      );
      expect(reEnrollment).toEqual({ transitioned: false });

      const disable = await withAccountContext(
        isolatedDatabase,
        verifiedUser,
        async (tx) =>
          recordAccountMfaTransition(tx, {
            id: randomUUID(),
            dispatchId: randomUUID(),
            userId: verifiedUser,
            origin: `legacy-disable:${databaseName}`,
            transition: "disabled",
            occurredAt: new Date(),
          }),
      );
      expect(disable).toEqual({ transitioned: true });
      expect(
        (
          await isolatedOwner.query<{ event_type: string }>(
            `select event_type from notification_intents
             where user_id = $1
             order by created_at`,
            [verifiedUser],
          )
        ).rows,
      ).toEqual([{ event_type: "MFA_DISABLED" }]);
    } finally {
      await isolatedDatabase?.close();
      await isolatedOwner?.end();
      if (adminConnected) {
        await admin.query(
          `select pg_terminate_backend(pid)
           from pg_stat_activity
           where datname = $1 and pid <> pg_backend_pid()`,
          [databaseName],
        );
        await admin.query(`drop database if exists ${databaseName}`);
      }
      await admin.end().catch(() => undefined);
      await rm(legacyMigrationsDir, { recursive: true, force: true });
    }
  });
});
