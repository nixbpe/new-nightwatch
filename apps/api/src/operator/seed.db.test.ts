import { notificationListResponseSchema } from "@nightwatch/api-contract";
import { verifyPassword } from "better-auth/crypto";

import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { seedLocalDemo } from "./seed";

const { ownerUrl, runtimeUrl } = requireIntegrationDatabaseUrls();
const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const owner: Database = createDatabase(ownerUrl);
const runtime: Database = createDatabase(runtimeUrl);
const origin = "nightwatch-local-demo-seed-v3:";
const extraUserId = crypto.randomUUID();
const ambientIntentId = `seed-test-ambient:${crypto.randomUUID()}`;
const ambientLedgerId = `seed-test-ledger:${crypto.randomUUID()}`;

async function removeDemo(): Promise<void> {
  await owner.sql.query(
    "delete from notification_intents where id like 'nightwatch-local-demo-seed-v3:%'",
  );
  await owner.sql.query('delete from "user" where id = $1', [extraUserId]);
  await owner.sql.query(
    "delete from notification_dispatch_ledger where id = $1",
    [ambientLedgerId],
  );
  await owner.sql.query("delete from notification_intents where id = $1", [
    ambientIntentId,
  ]);
}

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await removeDemo();
});

afterAll(async () => {
  try {
    await removeDemo();
  } finally {
    await runtime.close();
    await owner.close();
  }
});
async function canonicalGraph(): Promise<unknown> {
  const graph = await owner.sql.query<{ payload: unknown }>(
    `select jsonb_build_object(
       'intents', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]') from notification_intents i where i.id like $1),
       'recipients', (select coalesce(jsonb_agg(to_jsonb(r) order by r.intent_id, r.recipient_user_id), '[]') from notification_intent_recipients r where r.intent_id like $1),
       'inbox', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]') from notification_inbox_items n where n.intent_id like $1),
       'ledgers', (select coalesce(jsonb_agg(to_jsonb(d) order by d.intent_id), '[]') from notification_dispatch_ledger d where d.intent_id like $1)
     ) as payload`,
    [`${origin}%`],
  );
  return graph.rows[0]?.payload;
}

describe("local demo seed against PostgreSQL", () => {
  it("refreshes only its canonical graph, serializes reruns, and refuses extra descendants", async () => {
    await seedLocalDemo(ownerUrl, runtimeUrl);
    const first = await owner.sql.query<{
      intents: number;
      recipients: number;
      inbox: number;
      read: number;
      unread: number;
      ledgers: number;
      latest: Date;
    }>(
      `select
         (select count(*)::int from notification_intents where id like $1) as intents,
         (select count(*)::int from notification_intent_recipients where intent_id like $1) as recipients,
         (select count(*)::int from notification_inbox_items where intent_id like $1) as inbox,
         (select count(*)::int from notification_inbox_items where intent_id like $1 and read_at is not null) as read,
         (select count(*)::int from notification_inbox_items where intent_id like $1 and read_at is null) as unread,
         (select count(*)::int from notification_dispatch_ledger where intent_id like $1) as ledgers,
         (select max(occurred_at) from notification_intents where id like $1) as latest`,
      [`${origin}%`],
    );
    const [firstRow] = first.rows;
    if (!firstRow || !(firstRow.latest instanceof Date)) {
      throw new Error("seed did not produce a latest notification timestamp");
    }
    expect({
      intents: firstRow.intents,
      recipients: firstRow.recipients,
      inbox: firstRow.inbox,
      read: firstRow.read,
      unread: firstRow.unread,
      ledgers: firstRow.ledgers,
    }).toEqual({
      intents: 16,
      recipients: 28,
      inbox: 28,
      read: 12,
      unread: 16,
      ledgers: 16,
    });
    const seededItems = await owner.sql.query<{
      id: string;
      scope_kind: "account" | "tenant";
      tenant_id: string | null;
      event_type:
        | "PASSWORD_CHANGED"
        | "MFA_ENABLED"
        | "MFA_DISABLED"
        | "ORG-NOTIFICATION-SETTINGS-CHANGED";
      occurred_at: Date;
      read_at: Date | null;
    }>(
      `select id, scope_kind, tenant_id, event_type, occurred_at, read_at
       from notification_inbox_items
       where intent_id like $1
       order by occurred_at desc, id desc`,
      [`${origin}%`],
    );
    expect(() =>
      notificationListResponseSchema.parse({
        items: seededItems.rows.map((item) =>
          item.scope_kind === "account"
            ? {
                id: item.id,
                scope: "account",
                organizationId: null,
                eventType: item.event_type,
                occurredAt: item.occurred_at.toISOString(),
                readAt: item.read_at?.toISOString() ?? null,
                actor: null,
                category: null,
              }
            : {
                id: item.id,
                scope: "organization",
                organizationId: item.tenant_id,
                eventType: item.event_type,
                occurredAt: item.occurred_at.toISOString(),
                readAt: item.read_at?.toISOString() ?? null,
                actor: { displayName: "Unknown actor" },
                category: "notification-settings",
              },
        ),
        nextCursor: null,
        unreadCount: firstRow.unread,
        organizationId: "7b0a2d01-60c2-4b32-9b17-1e9e87000001",
      }),
    ).not.toThrow();
    expect(
      (
        await owner.sql.query<{
          organizations: number;
          users: number;
          accounts: number;
          memberships: number;
        }>(
          `select
             (select count(*)::int from organization where id = any($1::uuid[])) as organizations,
             (select count(*)::int from "user" where id = any($2::text[]) and email_verified) as users,
             (select count(*)::int from account where id like $3) as accounts,
             (select count(*)::int from member where id like $4) as memberships`,
          [
            [
              "7b0a2d01-60c2-4b32-9b17-1e9e87000001",
              "7b0a2d01-60c2-4b32-9b17-1e9e87000002",
            ],
            [
              "6b0a2d01-60c2-4b32-9b17-1e9e87000001",
              "6b0a2d01-60c2-4b32-9b17-1e9e87000002",
              "6b0a2d01-60c2-4b32-9b17-1e9e87000003",
              "6b0a2d01-60c2-4b32-9b17-1e9e87000004",
            ],
            `${origin}account:%`,
            `${origin}member:%`,
          ],
        )
      ).rows,
    ).toEqual([{ organizations: 2, users: 4, accounts: 4, memberships: 8 }]);

    await Promise.all([
      seedLocalDemo(ownerUrl, runtimeUrl),
      seedLocalDemo(ownerUrl, runtimeUrl),
    ]);
    const refreshed = await owner.sql.query<{ latest: Date }>(
      "select max(occurred_at) as latest from notification_intents where id like $1",
      [`${origin}%`],
    );
    const refreshedLatest = refreshed.rows[0]?.latest;
    if (!(refreshedLatest instanceof Date)) {
      throw new Error(
        "seed rerun did not produce a latest notification timestamp",
      );
    }
    expect(refreshedLatest.getTime()).toBeGreaterThan(
      firstRow.latest.getTime(),
    );

    await owner.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Seed conflict', $2, true, now(), now())`,
      [extraUserId, `seed-conflict-${extraUserId}@nightwatch.invalid`],
    );
    await owner.sql.query(
      `insert into notification_intent_recipients
         (intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id)
       values ($1, $1, $2, 'tenant', $3::uuid, null)`,
      [
        `${origin}intent:nightwatch-demo-alpha:recent`,
        extraUserId,
        "7b0a2d01-60c2-4b32-9b17-1e9e87000001",
      ],
    );
    const graphBeforeRefusal = await owner.sql.query<{ graph: unknown }>(
      `select jsonb_agg(row_to_json(graph)) as graph from (
         select intent.id, recipient.recipient_user_id, inbox.id as inbox_id, ledger.id as ledger_id
         from notification_intents as intent
         left join notification_intent_recipients as recipient on recipient.intent_id = intent.id
         left join notification_inbox_items as inbox on inbox.intent_id = intent.id and inbox.recipient_user_id = recipient.recipient_user_id
         left join notification_dispatch_ledger as ledger on ledger.intent_id = intent.id
         where intent.id like $1 order by intent.id, recipient.recipient_user_id
       ) as graph`,
      [`${origin}%`],
    );
    await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
      "refusing cleanup",
    );
    await expect(
      owner.sql.query<{ graph: unknown }>(
        `select jsonb_agg(row_to_json(graph)) as graph from (
           select intent.id, recipient.recipient_user_id, inbox.id as inbox_id, ledger.id as ledger_id
           from notification_intents as intent
           left join notification_intent_recipients as recipient on recipient.intent_id = intent.id
           left join notification_inbox_items as inbox on inbox.intent_id = intent.id and inbox.recipient_user_id = recipient.recipient_user_id
           left join notification_dispatch_ledger as ledger on ledger.intent_id = intent.id
           where intent.id like $1 order by intent.id, recipient.recipient_user_id
         ) as graph`,
        [`${origin}%`],
      ),
    ).resolves.toEqual(graphBeforeRefusal);
    await owner.sql.query(
      "delete from notification_intent_recipients where intent_id = $1 and recipient_user_id = $2",
      [`${origin}intent:nightwatch-demo-alpha:recent`, extraUserId],
    );
    await owner.sql.query(
      "update notification_intents set actor_user_id = $1, actor_display_name = 'Foreign actor' where id = $2",
      [extraUserId, `${origin}intent:nightwatch-demo-alpha:older`],
    );
    await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
      "refusing cleanup",
    );
    expect(
      (
        await owner.sql.query(
          "select actor_user_id, actor_display_name from notification_intents where id = $1",
          [`${origin}intent:nightwatch-demo-alpha:older`],
        )
      ).rows,
    ).toEqual([
      { actor_user_id: extraUserId, actor_display_name: "Foreign actor" },
    ]);
    await owner.sql.query(
      "update notification_intents set actor_user_id = null, actor_display_name = null where id = $1",
      [`${origin}intent:nightwatch-demo-alpha:older`],
    );
    await owner.sql.query('update "user" set name = $1 where id = $2', [
      "Foreign demo owner",
      "6b0a2d01-60c2-4b32-9b17-1e9e87000001",
    ]);
    await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
      "seed identity conflicts",
    );
    expect(
      (
        await owner.sql.query('select name from "user" where id = $1', [
          "6b0a2d01-60c2-4b32-9b17-1e9e87000001",
        ])
      ).rows,
    ).toEqual([{ name: "Foreign demo owner" }]);
    await owner.sql.query('update "user" set name = $1 where id = $2', [
      "Demo Owner",
      "6b0a2d01-60c2-4b32-9b17-1e9e87000001",
    ]);

    await owner.sql.query(
      `insert into notification_intents
         (id, scope_kind, user_id, origin, event_type, occurred_at)
       values ($1, 'account', $2, $1, 'PASSWORD_CHANGED', now())`,
      [ambientIntentId, extraUserId],
    );
    await owner.sql.query(
      `insert into notification_dispatch_ledger
         (id, intent_id, scope_kind, user_id, status)
       values ($1, $2, 'account', $3, 'pending')`,
      [ambientLedgerId, ambientIntentId, extraUserId],
    );
    await seedLocalDemo(ownerUrl, runtimeUrl);
    expect(
      (
        await owner.sql.query(
          "select status from notification_dispatch_ledger where id = $1",
          [ambientLedgerId],
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);

    await expect(
      runtime.sql.query(
        `insert into notification_intents
           (id, scope_kind, user_id, origin, event_type, occurred_at)
         values ($1, 'account', $2, $1, 'PASSWORD_CHANGED', now())`,
        [`seed-test-denied:${crypto.randomUUID()}`, extraUserId],
      ),
    ).rejects.toThrow();
    await expect(
      runtime.sql.query(
        `insert into notification_intents
           (id, scope_kind, tenant_id, origin, event_type, occurred_at)
         values ($1, 'tenant', $2::uuid, $1, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now())`,
        [
          `seed-test-denied:${crypto.randomUUID()}`,
          "7b0a2d01-60c2-4b32-9b17-1e9e87000001",
        ],
      ),
    ).rejects.toThrow();
  });
  it("recovers full runtime graphs after injected runtime and finalization failures", async () => {
    const runtimeFailure = new Date("2026-09-26T12:00:00.000Z");
    await expect(
      seedLocalDemo(ownerUrl, runtimeUrl, {
        now: runtimeFailure,
        fault: "after-runtime",
      }),
    ).rejects.toThrow("injected seed runtime failure");
    expect(
      (
        await owner.sql.query(
          "select count(*)::int as ledgers from notification_dispatch_ledger where intent_id like $1",
          [`${origin}%`],
        )
      ).rows,
    ).toEqual([{ ledgers: 0 }]);
    await seedLocalDemo(ownerUrl, runtimeUrl, {
      now: new Date("2026-09-26T12:01:00.000Z"),
    });
    await expect(
      seedLocalDemo(ownerUrl, runtimeUrl, {
        now: new Date("2026-09-26T12:02:00.000Z"),
        fault: "during-finalization",
      }),
    ).rejects.toThrow("injected seed finalization failure");
    expect(
      (
        await owner.sql.query(
          "select count(*)::int as ledgers from notification_dispatch_ledger where intent_id like $1",
          [`${origin}%`],
        )
      ).rows,
    ).toEqual([{ ledgers: 0 }]);
    await seedLocalDemo(ownerUrl, runtimeUrl, {
      now: new Date("2026-09-26T12:03:00.000Z"),
    });
    expect(
      (
        await owner.sql.query(
          `select count(*)::int as intents,
                  (select count(*)::int from notification_intent_recipients where intent_id like $1) as recipients,
                  (select count(*)::int from notification_inbox_items where intent_id like $1) as inbox,
                  (select count(*)::int from notification_dispatch_ledger where intent_id like $1) as ledgers
             from notification_intents where id like $1`,
          [`${origin}%`],
        )
      ).rows,
    ).toEqual([{ intents: 16, recipients: 28, inbox: 28, ledgers: 16 }]);
  });

  it("refuses canonical graph timestamp and read-state tampering without mutation", async () => {
    const intentId = `${origin}intent:nightwatch-demo-alpha:older`;
    for (const mutation of [
      "update notification_inbox_items set occurred_at = occurred_at + interval '1 minute' where intent_id = $1",
      "update notification_inbox_items set expires_at = expires_at + interval '1 minute' where intent_id = $1",
      "update notification_inbox_items set read_at = occurred_at + interval '1 minute' where intent_id = $1",
    ]) {
      await owner.sql.query(mutation, [intentId]);
      const before = await canonicalGraph();
      await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
        "refusing cleanup",
      );
      await expect(canonicalGraph()).resolves.toEqual(before);
      await owner.sql.query(
        "delete from notification_intents where id like $1",
        [`${origin}%`],
      );
      await seedLocalDemo(ownerUrl, runtimeUrl);
    }
  });
  it("repairs canonical credential and active-organization drift without accepting foreign identity aliases", async () => {
    const ownerId = "6b0a2d01-60c2-4b32-9b17-1e9e87000001";
    await owner.sql.query(
      "update account set password = 'malformed' where id = $1",
      [`${origin}account:owner`],
    );
    await owner.sql.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      ["7b0a2d01-60c2-4b32-9b17-1e9e87000002", ownerId],
    );
    await seedLocalDemo(ownerUrl, runtimeUrl);
    const account = await owner.sql.query<{ password: string | null }>(
      "select password from account where id = $1",
      [`${origin}account:owner`],
    );
    const password = account.rows[0]?.password;
    if (!password) throw new Error("seed did not restore canonical credential");
    await expect(
      verifyPassword({ hash: password, password: "nightwatch-demo-password" }),
    ).resolves.toBe(true);
    expect(
      (
        await owner.sql.query(
          'select last_active_tenant_id from "user" where id = $1',
          [ownerId],
        )
      ).rows,
    ).toEqual([
      { last_active_tenant_id: "7b0a2d01-60c2-4b32-9b17-1e9e87000001" },
    ]);
    await owner.sql.query('update "user" set email = $1 where id = $2', [
      "OWNER@nightwatch.invalid",
      ownerId,
    ]);
    const before = await canonicalGraph();
    await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
      "seed identity conflicts",
    );
    await expect(canonicalGraph()).resolves.toEqual(before);
    await owner.sql.query('update "user" set email = $1 where id = $2', [
      "owner@nightwatch.invalid",
      ownerId,
    ]);
  });
  it("refuses stale migration state before any seed mutation", async () => {
    await seedLocalDemo(ownerUrl, runtimeUrl);
    const before = await canonicalGraph();
    const latest = await owner.sql.query<{ name: string }>(
      "select name from __nightwatch_migrations order by name desc limit 1",
    );
    const migration = latest.rows[0]?.name;
    if (!migration) throw new Error("expected applied migration state");
    await owner.sql.query(
      "delete from __nightwatch_migrations where name = $1",
      [migration],
    );
    await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
      "database migrations are not current",
    );
    await expect(canonicalGraph()).resolves.toEqual(before);
    await runMigrations({ url: ownerUrl, migrationsDir });
  });
  it("refuses every lower-email ownership collision before identity mutation", async () => {
    const ownerId = "6b0a2d01-60c2-4b32-9b17-1e9e87000001";
    const canonicalEmail = "owner@nightwatch.invalid";
    for (const foreignEmail of [
      "OWNER@nightwatch.invalid",
      "foreign-owner@nightwatch.invalid",
    ]) {
      await owner.sql.query('update "user" set email = $1 where id = $2', [
        foreignEmail,
        ownerId,
      ]);
      const before = await owner.sql.query(
        'select to_jsonb("user") as user from "user" where id = $1',
        [ownerId],
      );
      await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
        "seed identity conflicts",
      );
      await expect(
        owner.sql.query(
          'select to_jsonb("user") as user from "user" where id = $1',
          [ownerId],
        ),
      ).resolves.toEqual(before);
      await owner.sql.query('update "user" set email = $1 where id = $2', [
        canonicalEmail,
        ownerId,
      ]);
    }
    const foreignId = crypto.randomUUID();
    await owner.sql.query('delete from "user" where id = $1', [ownerId]);
    await owner.sql.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [foreignId, "Foreign owner", canonicalEmail],
    );
    const before = await owner.sql.query(
      'select to_jsonb("user") as user from "user" where id = $1',
      [foreignId],
    );
    await expect(seedLocalDemo(ownerUrl, runtimeUrl)).rejects.toThrow(
      "seed identity conflicts",
    );
    await expect(
      owner.sql.query(
        'select to_jsonb("user") as user from "user" where id = $1',
        [foreignId],
      ),
    ).resolves.toEqual(before);
    await owner.sql.query('delete from "user" where id = $1', [foreignId]);
    await seedLocalDemo(ownerUrl, runtimeUrl);
  });
});
