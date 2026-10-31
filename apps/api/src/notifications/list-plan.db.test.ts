import assert from "node:assert/strict";
import { createDatabase, runMigrations } from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { notificationListStatement } from "./service";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);
beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.connect();
});
afterAll(async () => {
  await owner.end();
  await database.close();
});

describe("notification list runtime-role measured plans", () => {
  it.each([
    [200, 2000],
    [5000, 20000],
  ])(
    "C-%i with %i other-recipient tenant rows",
    async (visible, others) => {
      const org = crypto.randomUUID();
      const user = crypto.randomUUID();
      const other = crypto.randomUUID();
      const project = crypto.randomUUID();
      const monitor = crypto.randomUUID();
      const client = await database.sql.connect();
      try {
        await owner.query(
          "insert into organization (id, name, slug) values ($1, 'Plan', $2)",
          [org, `plan-${org}`],
        );
        for (const id of [user, other]) {
          await owner.query(
            `insert into "user" (id, name, email, email_verified) values ($1, 'Plan', $2, true)`,
            [id, `${id}@example.test`],
          );
          await owner.query(
            "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
            [crypto.randomUUID(), org, id],
          );
        }
        await owner.query(
          `create temporary table notification_plan_seed as
        select gen_random_uuid()::text as id,
          case when i <= $1 then $3::text else $4::text end as recipient,
          case when i <= $1 and i % 10 = 6 then 'account' else 'tenant' end as scope_kind,
          case when i <= $1 and i % 10 = 6 then 'PASSWORD_CHANGED'
            when i <= $1 and i % 10 >= 7 then 'ORG-NOTIFICATION-SETTINGS-CHANGED' else 'MONITOR_DOWN' end as event_type,
          now() - case when i % 4 = 0 then interval '1 day' else interval '10 days' end - i * interval '1 microsecond' as occurred_at,
          case when i % 10 < 3 then null::timestamptz else now() end as read_at
        from generate_series(1, $1::int + $2::int) as g(i)`,
          [visible, others, user, other],
        );
        await owner.query(
          `insert into notification_intents
        (id, origin, scope_kind, tenant_id, user_id, event_type, occurred_at,
         subject_project_id, subject_monitor_id, subject_monitor_name, monitor_reason)
        select id, id, scope_kind, case when scope_kind = 'tenant' then $1::uuid end,
          case when scope_kind = 'account' then recipient end, event_type, occurred_at,
          case when event_type = 'MONITOR_DOWN' then $2::uuid end,
          case when event_type = 'MONITOR_DOWN' then $3::uuid end,
          case when event_type = 'MONITOR_DOWN' then 'Snapshot' end,
          case when event_type = 'MONITOR_DOWN' then 'timeout' end
        from notification_plan_seed`,
          [org, project, monitor],
        );
        await owner.query(
          `insert into notification_intent_recipients (intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id)
        select id, id, recipient, scope_kind, case when scope_kind = 'tenant' then $1::uuid end,
          case when scope_kind = 'account' then recipient end from notification_plan_seed`,
          [org],
        );
        await owner.query(
          `insert into notification_dispatch_ledger (id, intent_id, scope_kind, tenant_id, user_id, status)
        select id, id, scope_kind, case when scope_kind = 'tenant' then $1::uuid end,
          case when scope_kind = 'account' then recipient end, 'completed' from notification_plan_seed`,
          [org],
        );
        await owner.query(`insert into notification_inbox_items
        (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id, event_type, occurred_at, read_at,
         subject_project_id, subject_monitor_id, subject_monitor_name, monitor_reason)
        select s.id, s.id, s.id, s.recipient, i.scope_kind, i.tenant_id, i.user_id, i.event_type, i.occurred_at, s.read_at,
          i.subject_project_id, i.subject_monitor_id, i.subject_monitor_name, i.monitor_reason
        from notification_plan_seed s join notification_intents i on i.id = s.id`);
        const cardinality = await owner.query<{ seeded: number }>(
          "select count(*)::int as seeded from notification_plan_seed",
        );
        assert(cardinality.rows[0]);
        expect(cardinality.rows[0].seeded).toBe(visible + others);
        await owner.query(
          "analyze notification_inbox_items; analyze notification_dispatch_ledger",
        );
        await client.query("begin");
        await client.query(
          "select set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
          [user, org],
        );
        const role = (
          await client.query<{
            current_user: string;
            rolsuper: boolean;
            rolbypassrls: boolean;
          }>(
            "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
          )
        ).rows[0];
        assert(role);
        expect(role.rolsuper).toBe(false);
        expect(role.rolbypassrls).toBe(false);
        const middle = (
          await client.query<{ occurredAt: string; id: string }>(
            `select occurred_at::text as "occurredAt", id from notification_inbox_items
        where recipient_user_id = $1 and event_type = 'MONITOR_DOWN' and read_at is null
        order by occurred_at desc, id desc offset $2 limit 1`,
            [user, Math.floor(visible * 0.15)],
          )
        ).rows[0];
        for (const [label, filters, anchor] of [
          ["all first", { status: "all" as const, category: null }, undefined],
          [
            "unread monitor first",
            { status: "unread" as const, category: "monitor" as const },
            undefined,
          ],
          [
            "unread monitor middle",
            { status: "unread" as const, category: "monitor" as const },
            middle,
          ],
        ] as const) {
          const statement = notificationListStatement(
            { userId: user, organizationId: org },
            filters,
            21,
            anchor,
          );
          const plan = await client.query<{ "QUERY PLAN": string }>(
            `explain (analyze, buffers, format text) ${statement.text}`,
            statement.values,
          );
          console.log(
            `C-${String(visible)}: ${label}; seeded=${String(visible + others)}; runtime=${role.current_user}\n${plan.rows.map((row) => row["QUERY PLAN"]).join("\n")}`,
          );
          const response = (
            await client.query<{
              items: unknown[];
              total: string;
              unread: string;
              unreadCount: string;
            }>(statement.text, statement.values)
          ).rows[0];
          assert(response);
          expect(response.items.length).toBeLessThanOrEqual(21);
          expect(Number(response.total)).toBe(
            filters.category === null ? visible : visible * 0.6,
          );
          expect(Number(response.unread)).toBeLessThanOrEqual(
            Number(response.total),
          );
          expect(Number(response.unreadCount)).toBe(visible * 0.3);
        }
        await client.query("rollback");
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
        await owner.query("drop table if exists notification_plan_seed");
        await owner.query("delete from organization where id = $1", [org]);
        await owner.query('delete from "user" where id = any($1::text[])', [
          [user, other],
        ]);
      }
    },
    120_000,
  );
});
