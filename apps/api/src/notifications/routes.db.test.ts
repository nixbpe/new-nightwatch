import {
  markAllReadResponseSchema,
  notificationDetailSchema,
  notificationListResponseSchema,
} from "@nightwatch/api-contract";
import { createDatabase, runMigrations } from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app";
import type { Auth, AuthSession } from "../auth";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const owner = createDatabase(ownerUrl);
const runtime = createDatabase(runtimeUrl);
const run = crypto.randomUUID().slice(0, 8);
const userId = crypto.randomUUID();
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const revokedOrg = crypto.randomUUID();
const token = `notification-${run}`;
const session: AuthSession = {
  user: {
    id: userId,
    email: `notification-${run}@example.test`,
    name: "Notification Tester",
    emailVerified: true,
  },
  session: {
    id: crypto.randomUUID(),
    token,
    expiresAt: new Date("2030-01-01"),
  },
};
const auth: Auth = {
  handler: () => Promise.resolve(new Response("not used")),
  getSession: () => Promise.resolve(session),
};
const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: runtimeUrl,
  BETTER_AUTH_SECRET: `notification-cursor-${run}-0123456789`,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "Test <test@example.test>",
};
const app = createApp({
  env,
  authEnv,
  auth,
  database: runtime,
  logger: createLogger({ level: "silent", name: "notification-db-test" }),
});

async function request(path: string, method = "GET") {
  const response = await app.request(`http://localhost${path}`, { method });
  const body: unknown = await response.json();
  return { response, body };
}

async function seedItem(input: {
  id?: string;
  scope: "account" | "tenant";
  organizationId?: string;
  occurredAt: string;
  readAt?: string;
  dispatchStatus?: "pending" | "claimed" | "enqueued" | "failed" | "completed";
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const origin = `notification-test:${id}`;
  const tenant = input.scope === "tenant" ? input.organizationId : null;
  const user = input.scope === "account" ? userId : null;
  const event =
    input.scope === "tenant"
      ? "ORG-NOTIFICATION-SETTINGS-CHANGED"
      : "PASSWORD_CHANGED";
  await owner.sql.query(
    `insert into notification_intents
      (id, scope_kind, tenant_id, user_id, origin, event_type, occurred_at, actor_display_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.scope,
      tenant,
      user,
      origin,
      event,
      input.occurredAt,
      input.scope === "tenant" ? "Actor" : null,
    ],
  );
  await owner.sql.query(
    `insert into notification_intent_recipients
      (intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, origin, userId, input.scope, tenant, user],
  );
  await owner.sql.query(
    `insert into notification_inbox_items
      (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id,
       event_type, occurred_at, actor_display_name, read_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      id,
      origin,
      userId,
      input.scope,
      tenant,
      user,
      event,
      input.occurredAt,
      input.scope === "tenant" ? "Actor" : null,
      input.readAt ?? null,
    ],
  );
  await owner.sql.query(
    `insert into notification_dispatch_ledger
      (id, intent_id, scope_kind, tenant_id, user_id, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      `dispatch:${id}`,
      id,
      input.scope,
      tenant,
      user,
      input.dispatchStatus ?? "completed",
    ],
  );
  return id;
}

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
});

beforeEach(async () => {
  await owner.sql.query('delete from "user" where id = $1', [userId]);
  for (const [id, slug] of [
    [orgA, `notification-a-${run}`],
    [orgB, `notification-b-${run}`],
    [revokedOrg, `notification-revoked-${run}`],
  ]) {
    await owner.sql.query("delete from organization where id = $1", [id]);
    await owner.sql.query(
      "insert into organization (id, name, slug) values ($1, $2, $3)",
      [id, slug, slug],
    );
  }
  await owner.sql.query(
    'insert into "user" (id, name, email, email_verified, last_active_tenant_id) values ($1, $2, $3, true, $4)',
    [userId, session.user.name, session.user.email, orgA],
  );
  await owner.sql.query(
    "insert into session (id, token, user_id, expires_at, active_organization_id) values ($1, $2, $3, $4, $5)",
    [session.session.id, token, userId, session.session.expiresAt, orgA],
  );
  await owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'member')",
    [crypto.randomUUID(), orgA, userId],
  );
  await owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'member')",
    [crypto.randomUUID(), orgB, userId],
  );
});

afterAll(async () => {
  await owner.sql.query('delete from "user" where id = $1', [userId]);
  await owner.sql.end();
  await runtime.sql.end();
});

describe("notification inbox API", () => {
  it("paginates a scoped inbox and rejects tampered and switched-scope cursors", async () => {
    await seedItem({
      scope: "account",
      occurredAt: "2026-09-25T03:00:00.000Z",
    });
    await seedItem({
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T02:00:00.000Z",
    });
    await seedItem({
      scope: "account",
      occurredAt: "2026-09-25T01:00:00.000Z",
    });
    const first = await request("/api/notifications?limit=2");
    expect(first.response.status).toBe(200);
    const firstBody = notificationListResponseSchema.parse(first.body);
    expect(firstBody.items).toHaveLength(2);
    const cursor = firstBody.nextCursor;
    if (!cursor) throw new Error("first page should have a cursor");
    expect(
      (await request(`/api/notifications?limit=2&cursor=${cursor}`)).response
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/notifications?limit=2&cursor=${cursor.slice(0, -1)}A`,
        )
      ).response.status,
    ).toBe(400);
    await owner.sql.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      [orgB, userId],
    );
    expect(
      (await request(`/api/notifications?limit=2&cursor=${cursor}`)).response
        .status,
    ).toBe(400);
  });

  it("falls back to personal rows, isolates mark-all, and preserves read timestamps", async () => {
    const personal = await seedItem({
      scope: "account",
      occurredAt: "2026-09-25T03:00:00.000Z",
    });
    const organization = await seedItem({
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T02:00:00.000Z",
    });
    const otherOrganization = await seedItem({
      scope: "tenant",
      organizationId: orgB,
      occurredAt: "2026-09-25T01:00:00.000Z",
    });
    const expired = await seedItem({
      scope: "account",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const markAll = await request("/api/notifications/read-all", "POST");
    expect(markAll.response.status).toBe(200);
    expect(markAllReadResponseSchema.parse(markAll.body)).toEqual({
      markedCount: 2,
    });
    const states = await owner.sql.query<{ id: string; readAt: Date | null }>(
      'select id, read_at as "readAt" from notification_inbox_items where id = any($1::text[]) order by id',
      [[personal, organization, otherOrganization, expired]],
    );
    expect(states.rows.filter((row) => row.readAt !== null)).toHaveLength(2);
    expect(
      states.rows.find((row) => row.id === otherOrganization)?.readAt,
    ).toBeNull();
    expect(states.rows.find((row) => row.id === expired)?.readAt).toBeNull();
    const firstOpen = await request(
      `/api/notifications/${personal}/open`,
      "POST",
    );
    const secondOpen = await request(
      `/api/notifications/${personal}/open`,
      "POST",
    );
    expect(notificationDetailSchema.parse(secondOpen.body)).toEqual(
      notificationDetailSchema.parse(firstOpen.body),
    );
    const expiredOpen = await request(
      `/api/notifications/${expired}/open`,
      "POST",
    );
    expect(expiredOpen.response.status).toBe(404);
    const secondToken = `notification-revoked-${run}-${crypto.randomUUID()}`;
    await owner.sql.query(
      "insert into session (id, token, user_id, expires_at, active_organization_id) values ($1, $2, $3, $4, $5)",
      [
        crypto.randomUUID(),
        secondToken,
        userId,
        session.session.expiresAt,
        revokedOrg,
      ],
    );
    await owner.sql.query(
      "update session set active_organization_id = $1 where user_id = $2",
      [revokedOrg, userId],
    );
    await owner.sql.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      [revokedOrg, userId],
    );
    // A former member with a stale mirror is resolved before any
    // organization lock, so another transaction holding the row cannot block
    // the personal fallback.
    const lockHolder = await owner.sql.connect();
    let fallback: Awaited<ReturnType<typeof request>>;
    try {
      await lockHolder.query("begin");
      await lockHolder.query(
        "select id from organization where id = $1 for update",
        [revokedOrg],
      );
      fallback = await request("/api/notifications");
    } finally {
      await lockHolder.query("rollback");
      lockHolder.release();
    }
    expect(fallback.response.status).toBe(200);
    const fallbackBody = notificationListResponseSchema.parse(fallback.body);
    expect(fallbackBody.items.map((item) => item.scope)).toEqual(["account"]);
    const mirror = await owner.sql.query<{
      activeOrganizationId: string | null;
      lastActiveTenantId: string | null;
    }>(
      `select s.active_organization_id as "activeOrganizationId",
              u.last_active_tenant_id as "lastActiveTenantId"
       from session s join "user" u on u.id = s.user_id
       where s.user_id = $1 order by s.token`,
      [userId],
    );
    expect(mirror.rows).toEqual([
      { activeOrganizationId: null, lastActiveTenantId: null },
      { activeOrganizationId: null, lastActiveTenantId: null },
    ]);
    const foreignOpen = await request(
      `/api/notifications/${otherOrganization}/open`,
      "POST",
    );
    expect(foreignOpen.response.status).toBe(404);
    expect(foreignOpen.body).toEqual(expiredOpen.body);
  });

  it("clears every stale session mirror when the user has no active organization", async () => {
    const personal = await seedItem({
      scope: "account",
      occurredAt: "2026-09-25T03:00:00.000Z",
    });
    const staleOrganization = await seedItem({
      scope: "tenant",
      organizationId: orgA,
      occurredAt: "2026-09-25T02:00:00.000Z",
    });
    const secondToken = `notification-second-${run}-${crypto.randomUUID()}`;
    await owner.sql.query(
      "insert into session (id, token, user_id, expires_at, active_organization_id) values ($1, $2, $3, $4, $5)",
      [
        crypto.randomUUID(),
        secondToken,
        userId,
        session.session.expiresAt,
        orgA,
      ],
    );

    const scoped = notificationListResponseSchema.parse(
      (await request("/api/notifications?limit=1")).body,
    );
    if (!scoped.nextCursor)
      throw new Error("scoped inbox should have a cursor");
    await owner.sql.query(
      'update "user" set last_active_tenant_id = null where id = $1',
      [userId],
    );

    const staleCursor = await request(
      `/api/notifications?limit=1&cursor=${scoped.nextCursor}`,
    );
    expect(staleCursor.response.status).toBe(400);
    const personalOnly = notificationListResponseSchema.parse(
      (await request("/api/notifications")).body,
    );
    expect(personalOnly.items.map((item) => item.id)).toEqual([personal]);
    expect((await request("/api/notifications/unread-count")).body).toEqual({
      unreadCount: 1,
    });
    expect(
      markAllReadResponseSchema.parse(
        (await request("/api/notifications/read-all", "POST")).body,
      ),
    ).toEqual({
      markedCount: 1,
    });

    const mirrors = await owner.sql.query<{
      activeOrganizationId: string | null;
    }>(
      `select active_organization_id as "activeOrganizationId"
       from session where user_id = $1 order by token`,
      [userId],
    );
    expect(mirrors.rows).toEqual([
      { activeOrganizationId: null },
      { activeOrganizationId: null },
    ]);
    const reads = await owner.sql.query<{ id: string; readAt: Date | null }>(
      `select id, read_at as "readAt" from notification_inbox_items
       where id = any($1::text[]) order by id`,
      [[personal, staleOrganization]],
    );
    expect(
      reads.rows.find((row) => row.id === personal)?.readAt,
    ).not.toBeNull();
    expect(
      reads.rows.find((row) => row.id === staleOrganization)?.readAt,
    ).toBeNull();
  });

  it("hides incomplete dispatches in personal and active organization scopes until completion", async () => {
    const incomplete = await Promise.all([
      seedItem({
        scope: "account",
        occurredAt: "2026-09-25T04:00:00.000Z",
        dispatchStatus: "pending",
      }),
      seedItem({
        scope: "tenant",
        organizationId: orgA,
        occurredAt: "2026-09-25T03:00:00.000Z",
        dispatchStatus: "claimed",
      }),
      seedItem({
        scope: "account",
        occurredAt: "2026-09-25T02:00:00.000Z",
        dispatchStatus: "enqueued",
      }),
      seedItem({
        scope: "tenant",
        organizationId: orgA,
        occurredAt: "2026-09-25T01:00:00.000Z",
        dispatchStatus: "failed",
      }),
    ]);

    const list = await request("/api/notifications");
    expect(notificationListResponseSchema.parse(list.body)).toMatchObject({
      items: [],
      unreadCount: 0,
    });
    const unreadCount = await request("/api/notifications/unread-count");
    expect(unreadCount.response.status).toBe(200);
    expect(unreadCount.body).toMatchObject({ unreadCount: 0 });
    for (const id of incomplete) {
      for (const [path, method] of [
        [`/api/notifications/${id}/open`, "POST"],
        [`/api/notifications/${id}/read`, "PATCH"],
      ] as const) {
        const hidden = await request(path, method);
        expect(hidden.response.status).toBe(404);
        expect(hidden.body).toMatchObject({
          error: { code: "NOTIFICATION_NOT_FOUND" },
        });
      }
    }
    expect(
      markAllReadResponseSchema.parse(
        (await request("/api/notifications/read-all", "POST")).body,
      ),
    ).toEqual({
      markedCount: 0,
    });
    const hiddenReads = await owner.sql.query<{ readAt: Date | null }>(
      'select read_at as "readAt" from notification_inbox_items where id = any($1::text[])',
      [incomplete],
    );
    expect(hiddenReads.rows.every((row) => row.readAt === null)).toBe(true);

    await owner.sql.query(
      "update notification_dispatch_ledger set status = 'completed' where intent_id = any($1::text[])",
      [incomplete],
    );
    const completed = notificationListResponseSchema.parse(
      (await request("/api/notifications")).body,
    );
    expect(completed.items.map((item) => item.id).sort()).toEqual(
      [...incomplete].sort(),
    );
    expect(completed.unreadCount).toBe(4);
    const read = await request(
      `/api/notifications/${incomplete[0]}/read`,
      "PATCH",
    );
    expect(read.response.status).toBe(200);
    expect((await request("/api/notifications/unread-count")).body).toEqual({
      unreadCount: 3,
    });
  });

  it("moves every session mirror of the user when the active organization changes", async () => {
    await owner.sql.query(
      "insert into session (id, token, user_id, expires_at, active_organization_id) values ($1, $2, $3, $4, $5)",
      [
        crypto.randomUUID(),
        `notification-other-${run}-${crypto.randomUUID()}`,
        userId,
        session.session.expiresAt,
        orgA,
      ],
    );
    await owner.sql.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      [orgA, userId],
    );
    await owner.sql.query(
      "update session set active_organization_id = $1 where user_id = $2",
      [orgA, userId],
    );

    const response = await app.request("http://localhost/api/me/active-org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: orgB }),
    });
    expect(response.status).toBe(200);

    const mirrors = await owner.sql.query<{
      activeOrganizationId: string | null;
    }>(
      `select active_organization_id as "activeOrganizationId"
       from session where user_id = $1`,
      [userId],
    );
    expect(mirrors.rows.length).toBeGreaterThan(1);
    expect(mirrors.rows.every((row) => row.activeOrganizationId === orgB)).toBe(
      true,
    );
  });
});
