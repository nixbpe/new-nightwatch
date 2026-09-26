import type {
  MarkAllReadResponse,
  NotificationListResponse,
} from "@nightwatch/api-contract";
import { createDatabase, runMigrations } from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listInbox, markAllInboxRead } from "./service";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = crypto.randomUUID().slice(0, 8);
const userId = crypto.randomUUID();
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const token = `lock-order-${run}`;
const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

async function seedItem(
  input: {
    id: string;
    scope: "account" | "tenant";
    organizationId?: string;
    occurredAt: string;
  },
  client = owner,
) {
  const origin = `notification-lock-order:${input.id}`;
  const tenantId = input.scope === "tenant" ? input.organizationId : null;
  const scopedUserId = input.scope === "account" ? userId : null;
  const eventType =
    input.scope === "tenant"
      ? "ORG-NOTIFICATION-SETTINGS-CHANGED"
      : "PASSWORD_CHANGED";
  await client.query(
    `insert into notification_intents
      (id, scope_kind, tenant_id, user_id, origin, event_type, occurred_at, actor_display_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.scope,
      tenantId,
      scopedUserId,
      origin,
      eventType,
      input.occurredAt,
      null,
    ],
  );
  await client.query(
    `insert into notification_intent_recipients
      (intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.id, origin, userId, input.scope, tenantId, scopedUserId],
  );
  await client.query(
    `insert into notification_inbox_items
      (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id, event_type, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.id,
      origin,
      userId,
      input.scope,
      tenantId,
      scopedUserId,
      eventType,
      input.occurredAt,
    ],
  );
  await client.query(
    `insert into notification_dispatch_ledger
      (id, intent_id, scope_kind, tenant_id, user_id, status)
     values ($1, $2, $3, $4, $5, 'completed')`,
    [`dispatch:${input.id}`, input.id, input.scope, tenantId, scopedUserId],
  );
}

async function waitForListToBlock(switcherPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await owner.query<{ pid: number }>(
      `select pid
       from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query like '%select id from organization where id = $1 for share%'
         and $1 = any(pg_blocking_pids(pid))`,
      [switcherPid],
    );
    if (blocked.rows.length > 0) return;
    // PostgreSQL exposes blocked lock acquisition only by polling its live activity view.
    const delay = Promise.withResolvers<undefined>();
    setTimeout(() => {
      delay.resolve(undefined);
    }, 25);
    await delay.promise;
  }
  throw new Error(
    "notification list did not block on the active-organization switch",
  );
}

async function waitForNullScopeListToBlock(switcherPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await owner.query<{ pid: number }>(
      `select pid
       from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query like '%from "user"%'
         and query like '%for update%'
         and $1 = any(pg_blocking_pids(pid))`,
      [switcherPid],
    );
    if (blocked.rows.length > 0) return;
    const delay = Promise.withResolvers<undefined>();
    setTimeout(() => {
      delay.resolve(undefined);
    }, 25);
    await delay.promise;
  }
  throw new Error(
    "personal-only notification list did not block on the active-organization switch",
  );
}
async function waitForMarkAllUpdateToBlock(lockerPid: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await owner.query<{ pid: number }>(
      `select pid
       from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and $1 = any(pg_blocking_pids(pid))`,
      [lockerPid],
    );
    const markAllPid = blocked.rows[0]?.pid;
    if (markAllPid) return markAllPid;
    const delay = Promise.withResolvers<undefined>();
    setTimeout(() => {
      delay.resolve(undefined);
    }, 25);
    await delay.promise;
  }
  throw new Error("mark-all did not block at its notification update");
}
async function waitForClientToBlock(
  clientPid: number,
  blockerPid: number,
  description: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await owner.query<{ pid: number }>(
      `select pid from pg_stat_activity
       where pid = $1 and $2 = any(pg_blocking_pids(pid))`,
      [clientPid, blockerPid],
    );
    if (blocked.rows.length > 0) return;
    const delay = Promise.withResolvers<undefined>();
    setTimeout(() => {
      delay.resolve(undefined);
    }, 25);
    await delay.promise;
  }
  throw new Error(`${description} did not block on mark-all`);
}

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.connect();
  for (const [id, slug] of [
    [orgA, `lock-a-${run}`],
    [orgB, `lock-b-${run}`],
  ]) {
    await owner.query(
      "insert into organization (id, name, slug) values ($1, $2, $3)",
      [id, slug, slug],
    );
  }
  await owner.query(
    `insert into "user" (id, name, email, email_verified, last_active_tenant_id)
     values ($1, $2, $3, true, $4)`,
    [userId, "Lock Tester", `lock-${run}@example.test`, orgA],
  );
  await owner.query(
    `insert into session (id, token, user_id, expires_at, active_organization_id)
     values ($1, $2, $3, now() + interval '1 hour', $4)`,
    [crypto.randomUUID(), token, userId, orgA],
  );
  for (const organizationId of [orgA, orgB]) {
    await owner.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [crypto.randomUUID(), organizationId, userId],
    );
  }
});

beforeEach(async () => {
  await owner.query("delete from notification_intents where origin like $1", [
    `notification-lock-order:%-${run}`,
  ]);
  await owner.query("delete from session where user_id = $1 and token <> $2", [
    userId,
    token,
  ]);
  await owner.query(
    'update "user" set last_active_tenant_id = $1 where id = $2',
    [orgA, userId],
  );
  await owner.query(
    "update session set active_organization_id = $1 where token = $2",
    [orgA, token],
  );
});

afterAll(async () => {
  await owner.query('delete from "user" where id = $1', [userId]);
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [orgA, orgB],
  ]);
  await owner.end();
  await database.sql.end();
});

describe("notification active-scope lock order", () => {
  it("retries a blocked list and mark-all against the committed active organization", async () => {
    const personalId = `personal-${run}`;
    const orgAId = `org-a-${run}`;
    const orgBId = `org-b-${run}`;
    await seedItem({
      id: personalId,
      scope: "account",
      occurredAt: "2026-09-25T03:00:00.000Z",
    });
    await seedItem({
      id: orgAId,
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T02:00:00.000Z",
    });
    await seedItem({
      id: orgBId,
      scope: "tenant",
      organizationId: orgB,
      occurredAt: "2026-09-25T01:00:00.000Z",
    });

    const switcher = new Client({ connectionString: ownerUrl });
    let transactionOpen = false;
    let list: Promise<NotificationListResponse> | undefined;
    let markAll: Promise<MarkAllReadResponse> | undefined;
    try {
      await switcher.connect();
      await switcher.query("begin");
      transactionOpen = true;
      const lock = await switcher.query<{ pid: number }>(
        "select pg_backend_pid() as pid from organization where id = $1 for update",
        [orgA],
      );
      const switcherPid = lock.rows[0]?.pid;
      if (!switcherPid)
        throw new Error("switcher backend PID was not returned");
      await switcher.query(
        "select pg_advisory_xact_lock(hashtext($1)::bigint)",
        [`notification-membership:${orgA}`],
      );
      await switcher.query(
        "select 1 from member where organization_id = $1 and user_id = $2 for update",
        [orgA, userId],
      );

      list = listInbox(
        { database, cursorSecret: "lock-order-secret" },
        { userId, sessionToken: token, limit: 20 },
      );
      await waitForListToBlock(switcherPid);

      markAll = markAllInboxRead(
        { database, cursorSecret: "lock-order-secret" },
        { userId, sessionToken: token, expectedOrganizationId: orgB },
      );
      await switcher.query(
        'update "user" set last_active_tenant_id = $1 where id = $2',
        [orgB, userId],
      );
      await switcher.query(
        "update session set active_organization_id = $1 where token = $2",
        [orgB, token],
      );
      await switcher.query("commit");
      transactionOpen = false;

      const [response, marked] = await Promise.all([list, markAll]);
      expect(response.items.map((item) => item.id).sort()).toEqual(
        [orgBId, personalId].sort(),
      );
      expect(marked).toEqual({ markedCount: 2 });
      const mirror = await owner.query<{
        organizationId: string | null;
        activeOrganizationId: string | null;
      }>(
        `select u.last_active_tenant_id as "organizationId",
                s.active_organization_id as "activeOrganizationId"
         from "user" u join session s on s.user_id = u.id where u.id = $1`,
        [userId],
      );
      expect(mirror.rows[0]).toEqual({
        organizationId: orgB,
        activeOrganizationId: orgB,
      });
      const reads = await owner.query<{ id: string; readAt: Date | null }>(
        `select id, read_at as "readAt" from notification_inbox_items
         where id = any($1::text[]) order by id`,
        [[personalId, orgAId, orgBId]],
      );
      expect(
        reads.rows
          .filter((row) => row.readAt !== null)
          .map((row) => row.id)
          .sort(),
      ).toEqual([orgBId, personalId].sort());
    } finally {
      if (transactionOpen)
        await switcher.query("rollback").catch(() => undefined);
      await Promise.allSettled(
        [list, markAll].filter((promise) => promise !== undefined),
      );
      await switcher.end();
    }
  });

  it("retries a personal-only resolution when a valid organization switch commits first", async () => {
    const personalId = `personal-null-${run}`;
    const orgBId = `org-b-null-${run}`;
    const secondToken = `lock-order-second-${run}`;
    await seedItem({
      id: personalId,
      scope: "account",
      occurredAt: "2026-09-25T05:00:00.000Z",
    });
    await seedItem({
      id: orgBId,
      scope: "tenant",
      organizationId: orgB,
      occurredAt: "2026-09-25T04:00:00.000Z",
    });
    await owner.query(
      'update "user" set last_active_tenant_id = null where id = $1',
      [userId],
    );
    await owner.query(
      "update session set active_organization_id = $1 where user_id = $2",
      [orgA, userId],
    );
    await owner.query(
      `insert into session (id, token, user_id, expires_at, active_organization_id)
       values ($1, $2, $3, now() + interval '1 hour', $4)`,
      [crypto.randomUUID(), secondToken, userId, orgA],
    );

    const switcher = new Client({ connectionString: ownerUrl });
    let transactionOpen = false;
    let list: Promise<NotificationListResponse> | undefined;
    try {
      await switcher.connect();
      await switcher.query("begin");
      transactionOpen = true;
      const lock = await switcher.query<{ pid: number }>(
        'select pg_backend_pid() as pid from "user" where id = $1 for update',
        [userId],
      );
      const switcherPid = lock.rows[0]?.pid;
      if (!switcherPid)
        throw new Error("switcher backend PID was not returned");

      list = listInbox(
        { database, cursorSecret: "lock-order-secret" },
        { userId, sessionToken: token, limit: 20 },
      );
      await waitForNullScopeListToBlock(switcherPid);
      await switcher.query(
        'update "user" set last_active_tenant_id = $1 where id = $2',
        [orgB, userId],
      );
      await switcher.query(
        "update session set active_organization_id = $1 where user_id = $2",
        [orgB, userId],
      );
      await switcher.query("commit");
      transactionOpen = false;

      const response = await list;
      expect(response.items.map((item) => item.id).sort()).toEqual(
        [orgBId, personalId].sort(),
      );
      const mirrors = await owner.query<{
        organizationId: string | null;
        activeOrganizationId: string | null;
      }>(
        `select u.last_active_tenant_id as "organizationId",
                s.active_organization_id as "activeOrganizationId"
         from "user" u join session s on s.user_id = u.id
         where u.id = $1 order by s.token`,
        [userId],
      );
      expect(mirrors.rows).toEqual([
        { organizationId: orgB, activeOrganizationId: orgB },
        { organizationId: orgB, activeOrganizationId: orgB },
      ]);
    } finally {
      if (transactionOpen)
        await switcher.query("rollback").catch(() => undefined);
      await Promise.allSettled(
        [list].filter((promise) => promise !== undefined),
      );
      await switcher.end();
    }
  });
});

describe("notification mark-all atomic scope", () => {
  it("keeps pending late inserts unread until a follow-up mark-all", async () => {
    const baselinePersonalId = `atomic-baseline-personal-${run}`;
    const baselineActiveId = `atomic-baseline-active-${run}`;
    const inactiveId = `atomic-inactive-${run}`;
    const latePersonalId = `atomic-late-personal-${run}`;
    const lateActiveId = `atomic-late-active-${run}`;
    await seedItem({
      id: baselinePersonalId,
      scope: "account",
      occurredAt: "2026-09-25T07:00:00.000Z",
    });
    await seedItem({
      id: baselineActiveId,
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T06:00:00.000Z",
    });
    await seedItem({
      id: inactiveId,
      scope: "tenant",
      organizationId: orgB,
      occurredAt: "2026-09-25T05:00:00.000Z",
    });

    const locker = new Client({ connectionString: ownerUrl });
    const latePersonal = new Client({ connectionString: ownerUrl });
    const lateActive = new Client({ connectionString: ownerUrl });
    let lockerTransactionOpen = false;
    let latePersonalTransactionOpen = false;
    let lateActiveTransactionOpen = false;
    let markAll: Promise<MarkAllReadResponse> | undefined;
    let latePersonalInsert: Promise<void> | undefined;
    let lateActiveInsert: Promise<void> | undefined;
    try {
      await Promise.all([
        locker.connect(),
        latePersonal.connect(),
        lateActive.connect(),
      ]);
      await locker.query("begin");
      lockerTransactionOpen = true;
      const lock = await locker.query<{ pid: number }>(
        `select pg_backend_pid() as pid from notification_inbox_items
         where id = $1 for update`,
        [baselinePersonalId],
      );
      const lockerPid = lock.rows[0]?.pid;
      if (!lockerPid) throw new Error("locker backend PID was not returned");

      markAll = markAllInboxRead(
        { database, cursorSecret: "atomic-mark-all-secret" },
        { userId, sessionToken: token, expectedOrganizationId: orgA },
      );
      void markAll.catch(() => undefined);
      const markAllPid = await waitForMarkAllUpdateToBlock(lockerPid);

      await latePersonal.query("begin");
      latePersonalTransactionOpen = true;
      const personalPid = await latePersonal.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const latePersonalPid = personalPid.rows[0]?.pid;
      if (!latePersonalPid)
        throw new Error("late personal backend PID was not returned");
      latePersonalInsert = seedItem(
        {
          id: latePersonalId,
          scope: "account",
          occurredAt: "2026-09-25T04:00:00.000Z",
        },
        latePersonal,
      );
      void latePersonalInsert.catch(() => undefined);
      await waitForClientToBlock(
        latePersonalPid,
        markAllPid,
        "late personal insert",
      );

      await lateActive.query("begin");
      lateActiveTransactionOpen = true;
      const activePid = await lateActive.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const lateActivePid = activePid.rows[0]?.pid;
      if (!lateActivePid)
        throw new Error("late active backend PID was not returned");
      lateActiveInsert = seedItem(
        {
          id: lateActiveId,
          scope: "tenant",
          organizationId: orgA,
          occurredAt: "2026-09-25T03:00:00.000Z",
        },
        lateActive,
      );
      void lateActiveInsert.catch(() => undefined);
      await waitForClientToBlock(
        lateActivePid,
        markAllPid,
        "late active insert",
      );

      await locker.query("commit");
      lockerTransactionOpen = false;
      expect(await markAll).toEqual({ markedCount: 2 });

      await latePersonalInsert;
      await latePersonal.query("commit");
      latePersonalTransactionOpen = false;
      await lateActiveInsert;
      await lateActive.query("commit");
      lateActiveTransactionOpen = false;

      const reads = await owner.query<{ id: string; readAt: Date | null }>(
        `select id, read_at as "readAt" from notification_inbox_items
         where id = any($1::text[])`,
        [
          [
            baselinePersonalId,
            baselineActiveId,
            inactiveId,
            latePersonalId,
            lateActiveId,
          ],
        ],
      );
      expect(
        Object.fromEntries(
          reads.rows.map((row) => [row.id, row.readAt !== null]),
        ),
      ).toEqual({
        [baselinePersonalId]: true,
        [baselineActiveId]: true,
        [inactiveId]: false,
        [latePersonalId]: false,
        [lateActiveId]: false,
      });
      expect(
        await markAllInboxRead(
          { database, cursorSecret: "atomic-mark-all-secret" },
          { userId, sessionToken: token, expectedOrganizationId: orgA },
        ),
      ).toEqual({ markedCount: 2 });
      expect(
        await markAllInboxRead(
          { database, cursorSecret: "atomic-mark-all-secret" },
          { userId, sessionToken: token, expectedOrganizationId: orgA },
        ),
      ).toEqual({ markedCount: 0 });
    } finally {
      if (lockerTransactionOpen)
        await locker.query("rollback").catch(() => undefined);
      await Promise.allSettled(
        [markAll, latePersonalInsert, lateActiveInsert].filter(
          (promise) => promise !== undefined,
        ),
      );
      if (latePersonalTransactionOpen)
        await latePersonal.query("rollback").catch(() => undefined);
      if (lateActiveTransactionOpen)
        await lateActive.query("rollback").catch(() => undefined);
      await Promise.all([locker.end(), latePersonal.end(), lateActive.end()]);
    }
  });

  it("marks only personal and newly verified active-organization rows after an organization switch", async () => {
    const personalId = `switch-personal-${run}`;
    const oldActiveId = `switch-old-active-${run}`;
    const newActiveId = `switch-new-active-${run}`;
    await seedItem({
      id: personalId,
      scope: "account",
      occurredAt: "2026-09-25T09:00:00.000Z",
    });
    await seedItem({
      id: oldActiveId,
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T08:00:00.000Z",
    });
    await seedItem({
      id: newActiveId,
      scope: "tenant",
      organizationId: orgB,
      occurredAt: "2026-09-25T07:00:00.000Z",
    });
    await owner.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      [orgB, userId],
    );
    await owner.query(
      "update session set active_organization_id = $1 where token = $2",
      [orgB, token],
    );

    expect(
      await markAllInboxRead(
        { database, cursorSecret: "atomic-mark-all-secret" },
        { userId, sessionToken: token, expectedOrganizationId: orgB },
      ),
    ).toEqual({ markedCount: 2 });
    const reads = await owner.query<{ id: string; readAt: Date | null }>(
      `select id, read_at as "readAt" from notification_inbox_items
       where id = any($1::text[])`,
      [[personalId, oldActiveId, newActiveId]],
    );
    expect(
      Object.fromEntries(
        reads.rows.map((row) => [row.id, row.readAt !== null]),
      ),
    ).toEqual({
      [personalId]: true,
      [oldActiveId]: false,
      [newActiveId]: true,
    });
  });
});

describe("notification pagination precision", () => {
  it("rejects mark-all for a scope the caller did not see and marks nothing", async () => {
    const orgAId = `notification-lock-order:scope-a-${run}`;
    await seedItem({
      id: orgAId,
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T01:00:00.000Z",
    });
    // Another session switched the account-global selection to orgB.
    await owner.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      [orgB, userId],
    );

    await expect(
      markAllInboxRead(
        { database, cursorSecret: "scope-guard-secret" },
        { userId, sessionToken: token, expectedOrganizationId: orgA },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "INBOX_SCOPE_CHANGED" });
    const unread = await owner.query<{ count: string }>(
      `select count(*)::text as count from notification_inbox_items
       where recipient_user_id = $1 and read_at is not null
         and origin like $2`,
      [userId, `notification-lock-order:%-${run}`],
    );
    expect(unread.rows[0]?.count).toBe("0");
  });

  it("returns each mixed-scope microsecond row once across limit-one pages", async () => {
    const occurredAt = new Date(Date.now() - 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "");
    const newestId = `precision-account-newest-${run}`;
    const middleId = `precision-tenant-middle-${run}`;
    const oldestId = `precision-account-oldest-${run}`;
    await seedItem({
      id: newestId,
      scope: "account",
      occurredAt: `${occurredAt}.000900Z`,
    });
    await seedItem({
      id: middleId,
      scope: "tenant",
      organizationId: orgA,
      occurredAt: `${occurredAt}.000800Z`,
    });
    await seedItem({
      id: oldestId,
      scope: "account",
      occurredAt: `${occurredAt}.000700Z`,
    });

    const first = await listInbox(
      { database, cursorSecret: "precision-secret" },
      { userId, sessionToken: token, limit: 1 },
    );
    const second = await listInbox(
      { database, cursorSecret: "precision-secret" },
      { userId, sessionToken: token, limit: 1, cursor: first.nextCursor ?? "" },
    );
    const third = await listInbox(
      { database, cursorSecret: "precision-secret" },
      {
        userId,
        sessionToken: token,
        limit: 1,
        cursor: second.nextCursor ?? "",
      },
    );

    expect(first).toMatchObject({
      items: [{ id: newestId, occurredAt: `${occurredAt}.000Z` }],
      unreadCount: 3,
    });
    expect(second).toMatchObject({
      items: [{ id: middleId, occurredAt: `${occurredAt}.000Z` }],
      unreadCount: 3,
    });
    expect(third).toMatchObject({
      items: [{ id: oldestId, occurredAt: `${occurredAt}.000Z` }],
      nextCursor: null,
      unreadCount: 3,
    });
    expect([first.nextCursor, second.nextCursor]).not.toContain(null);
  });
});
