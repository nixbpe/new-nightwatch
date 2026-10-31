import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { expect, it } from "vitest";

import { createDatabase, runMigrations, withTenantContextRaw } from "../src";

it("applies 0027 on 0026, preserves null legacy snapshots and enforces runtime RLS and hostname checks", async () => {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const runtimeUrl = process.env.DATABASE_URL;
  if (!ownerUrl || !runtimeUrl)
    throw new Error("hostname migration test requires owner/runtime URLs");
  const name = `notification_hostname_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: ownerUrl });
  const scopedOwnerUrl = new URL(ownerUrl);
  scopedOwnerUrl.pathname = `/${name}`;
  const scopedRuntimeUrl = new URL(runtimeUrl);
  scopedRuntimeUrl.pathname = `/${name}`;
  const owner = new Client({ connectionString: scopedOwnerUrl.toString() });
  const runtime = createDatabase(scopedRuntimeUrl.toString());
  const dir = await mkdtemp(join(tmpdir(), "nightwatch-hostname-migrations-"));
  const source = new URL("../migrations/", import.meta.url);
  const migration = "0027_notification_monitor_hostname.sql";
  let created = false;
  try {
    await admin.connect();
    await admin.query(`create database ${name}`);
    created = true;
    await admin.query(
      `grant connect, temporary on database ${name} to nightwatch`,
    );
    for (const file of (await readdir(source)).filter(
      (file) => /^\d{4}_.*\.sql$/.test(file) && file < migration,
    )) {
      // Shared cluster: reuse existing restricted function-owner roles, never alter them.
      const sql = (await readFile(new URL(file, source), "utf8")).replace(
        /create role (\w+)([^;]*);/g,
        (_match, role: string, options: string) =>
          `do $role$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role}${options}; end if; end $role$;`,
      );
      await writeFile(join(dir, file), sql);
    }
    await runMigrations({
      url: scopedOwnerUrl.toString(),
      migrationsDir: dir,
      log: () => undefined,
    });
    await owner.connect();
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
    await writeFile(
      join(dir, migration),
      await readFile(new URL(migration, source), "utf8"),
    );
    await runMigrations({
      url: scopedOwnerUrl.toString(),
      migrationsDir: dir,
      log: () => undefined,
    });
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
  } finally {
    await runtime.close();
    await owner.end().catch(() => undefined);
    if (created) await admin.query(`drop database ${name}`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
