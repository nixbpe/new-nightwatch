import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openIsolatedAuditDatabase } from "./test-support";

let isolated: Awaited<ReturnType<typeof openIsolatedAuditDatabase>> | undefined;
const run = crypto.randomUUID().slice(0, 8);
const legacyTenant = crypto.randomUUID();
const tenantA = crypto.randomUUID();
const legacyCreatedAt = "2026-01-15T00:00:00Z";
const legacyUser = `legacy-user-${run}`;
const legacyMember = `legacy-member-${run}`;
const legacyMonitor = crypto.randomUUID();
const migrations = new URL(
  "../../../../packages/db/migrations/",
  import.meta.url,
);

beforeAll(async () => {
  isolated = await openIsolatedAuditDatabase({ history: "before-audit-log" });
}, 180_000);

afterAll(async () => {
  await isolated?.close();
}, 60_000);

describe("migration 0020 on a database that already holds F-004 to F-006 data", () => {
  it("applies, keeps existing rows, stamps the recording start and creates 3 months of partitions", async () => {
    if (!isolated) throw new Error("historical fixture was not opened");
    const { owner } = isolated;
    const canonical = await Promise.all(
      (await readdir(migrations))
        .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
        .sort()
        .map(async (name) => ({
          name,
          sha256: createHash("sha256")
            .update(await readFile(new URL(name, migrations)))
            .digest("hex"),
        })),
    );
    const ledger = async () =>
      (
        await owner.query<{ name: string; sha256: string }>(
          "select name, sha256 from __nightwatch_migrations order by name",
        )
      ).rows;
    expect(await ledger()).toEqual(canonical.slice(0, 19));
    expect((await ledger()).at(-1)?.name).toBe("0019_monitor_event_feed.sql");
    expect(
      (await owner.query("select to_regclass('public.audit_events') as audit"))
        .rows,
    ).toEqual([{ audit: null }]);
    expect(
      (
        await owner.query(
          "select count(*)::int as n from pg_roles where rolname = 'nightwatch_audit_retention_owner'",
        )
      ).rows,
    ).toEqual([{ n: 0 }]);

    await owner.query(
      `insert into organization (id, name, slug, created_at)
       values ($1, 'Legacy', $2, $3)`,
      [legacyTenant, `legacy-${run}`, legacyCreatedAt],
    );
    await owner.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Legacy user', $2, true, now(), now())`,
      [legacyUser, `legacy-${run}@example.test`],
    );
    await owner.query(
      `insert into member (id, organization_id, user_id, role)
       values ($1, $2, $3, 'owner')`,
      [legacyMember, legacyTenant, legacyUser],
    );
    await owner.query(
      `insert into monitors
         (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
       values ($1, $2, 'legacy monitor', 'https://target.example.test/', 60, 10, $3)`,
      [legacyMonitor, legacyTenant, crypto.randomUUID()],
    );
    const legacyRows = async () =>
      (
        await owner.query<{ legacy: unknown }>(
          `select jsonb_build_object(
         'organization', (select to_jsonb(o) - 'audit_recording_started_at' from organization o where id = $1),
         'user', (select to_jsonb(u) from "user" u where id = $2),
         'member', (select to_jsonb(m) from member m where id = $3),
         'monitor', (select to_jsonb(m) from monitors m where id = $4)
       ) as legacy`,
          [legacyTenant, legacyUser, legacyMember, legacyMonitor],
        )
      ).rows;
    const before = await legacyRows();
    const monitorCount = await owner.query(
      "select count(*)::int as n from monitors where tenant_id = $1",
      [legacyTenant],
    );
    expect(monitorCount.rows).toEqual([{ n: 1 }]);
    const migrationStarted = (
      await owner.query<{ at: Date }>("select clock_timestamp() as at")
    ).rows[0];
    if (!migrationStarted) throw new Error("missing database time");
    await isolated.advanceTo("0020_organization_audit_log.sql");
    expect(await ledger()).toEqual(canonical.slice(0, 20));
    expect((await ledger()).at(-1)?.name).toBe(
      "0020_organization_audit_log.sql",
    );
    expect(await legacyRows()).toEqual(before);
    expect(
      (
        await owner.query(
          "select count(*)::int as n from monitors where tenant_id = $1",
          [legacyTenant],
        )
      ).rows,
    ).toEqual(monitorCount.rows);
    await owner.query(
      "insert into organization (id, name, slug) values ($1, 'A', $2)",
      [tenantA, `a-${run}`],
    );
    const started = await owner.query<{
      id: string;
      started: Date;
      created_at: Date;
    }>(
      `select id, audit_recording_started_at as started, created_at from organization
       where id = any($1::uuid[])`,
      [[legacyTenant, tenantA]],
    );
    const checkedAt = (await owner.query<{ now: Date }>("select now() as now"))
      .rows[0];
    const legacy = started.rows.find((row) => row.id === legacyTenant);
    const fresh = started.rows.find((row) => row.id === tenantA);
    if (!checkedAt || !legacy || !fresh)
      throw new Error("missing organization timestamps");
    expect(legacy.started.getTime()).toBeGreaterThan(
      new Date(legacyCreatedAt).getTime(),
    );
    expect(legacy.started.getTime()).toBeGreaterThanOrEqual(
      migrationStarted.at.getTime(),
    );
    expect(legacy.started.getTime()).toBeLessThanOrEqual(
      checkedAt.now.getTime(),
    );
    expect(fresh.started).toEqual(fresh.created_at);
    expect(
      Math.abs(fresh.started.getTime() - checkedAt.now.getTime()),
    ).toBeLessThan(60_000);

    const expected = [-1, 0, 1, 2, 3].map((offset) => {
      const at = new Date(
        Date.UTC(
          checkedAt.now.getUTCFullYear(),
          checkedAt.now.getUTCMonth() + offset,
          1,
        ),
      );
      return `audit_events_p${String(at.getUTCFullYear())}${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    const partitions = await owner.query<{ name: string }>(
      `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
       where i.inhparent = 'public.audit_events'::regclass order by c.relname`,
    );
    expect(partitions.rows.map((row) => row.name)).toEqual(expected.sort());
  }, 180_000);
});
