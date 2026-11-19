import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { withTenantContextRaw } from "../src";
import { openTestPostgres } from "./support/postgres";

it("applies 0027 on 0026, preserves null legacy snapshots and enforces runtime RLS and hostname checks", async () => {
  const fixture = await openTestPostgres(
    "notification-hostname",
    "0026_project_monitors.sql",
  );
  const errors: unknown[] = [];
  try {
    const owner = fixture.owner.sql;
    const runtime = fixture.runtime;
    const org = randomUUID();
    const user = randomUUID();
    const intent = randomUUID();
    const project = randomUUID();
    await owner.query(
      "insert into organization (id, name, slug) values ($1, 'Legacy', 'legacy')",
      [org],
    );
    await owner.query(
      "insert into \"user\" (id, name, email) values ($1, 'Legacy', 'legacy@example.test')",
      [user],
    );
    await owner.query(
      `insert into notification_intents (id, origin, scope_kind, tenant_id, event_type, occurred_at, subject_project_id)
      values ($1, $1, 'tenant', $2, 'MONITOR_DOWN', now(), $3)`,
      [intent, org, project],
    );
    await owner.query(
      `insert into notification_inbox_items (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, event_type, occurred_at, subject_project_id)
      values ($1, $1, $1, $2, 'tenant', $3, 'MONITOR_DOWN', now(), $4)`,
      [intent, user, org, project],
    );
    expect(
      (await fixture.advanceTo("0027_notification_monitor_hostname.sql"))
        .applied,
    ).toEqual(["0027_notification_monitor_hostname.sql"]);
    for (const table of [
      "notification_intents",
      "notification_inbox_items",
    ] as const) {
      expect(
        (
          await owner.query(
            `select subject_monitor_hostname from ${table} where id = $1`,
            [intent],
          )
        ).rows,
      ).toEqual([{ subject_monitor_hostname: null }]);
    }
    await withTenantContextRaw(runtime, org, async (client) => {
      const role = (
        await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
        )
      ).rows[0];
      expect(role).toMatchObject({ rolsuper: false, rolbypassrls: false });
      // Runtime INSERT grants already cover new columns. No policy/grant expansion is needed.
      const id = randomUUID();
      await client.query(
        `insert into notification_intents (id, origin, scope_kind, tenant_id, event_type, occurred_at, subject_project_id, subject_monitor_hostname)
        values ($1, $1, 'tenant', $2, 'MONITOR_DOWN', now(), $3, 'snapshot.example.com')`,
        [id, org, project],
      );
      await client.query(
        `insert into notification_inbox_items (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, event_type, occurred_at, subject_project_id, subject_monitor_hostname)
        values ($1, $1, $1, $2, 'tenant', $3, 'MONITOR_DOWN', now(), $4, 'snapshot.example.com')`,
        [id, user, org, project],
      );
      expect(
        (
          await client.query(
            "select subject_monitor_hostname from notification_inbox_items where id = $1",
            [id],
          )
        ).rows,
      ).toEqual([{ subject_monitor_hostname: "snapshot.example.com" }]);
    });
    await withTenantContextRaw(runtime, randomUUID(), async (client) => {
      expect(
        (
          await client.query(
            "select subject_monitor_hostname from notification_inbox_items",
          )
        ).rows,
      ).toEqual([]);
    });
    for (const hostname of ["", "a".repeat(254)]) {
      await expect(
        owner.query(
          "update notification_intents set subject_monitor_hostname = $1 where id = $2",
          [hostname, intent],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      owner.query(
        `insert into notification_intents (id, origin, scope_kind, tenant_id, event_type, occurred_at, subject_monitor_hostname)
      values ($1, $1, 'tenant', $2, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now(), 'forbidden.example.com')`,
        [randomUUID(), org],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await fixture.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, "fixture assertions and cleanup failed");
}, 180_000);
