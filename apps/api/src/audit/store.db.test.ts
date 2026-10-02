import {
  ensureAuditEventPartitions,
  withTenantContextRaw,
  type Database,
} from "@nightwatch/db";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordAuditEvent } from "./record";
import {
  createAuditPartitionFor,
  dropAuditPartition,
  openIsolatedAuditDatabase,
} from "./test-support";

// Partition create and drop lock the parent table, so this file runs in its
// own database (see openIsolatedAuditDatabase); the other audit suites keep
// writing to the shared database.
const AUDIT_MIGRATION = "0019_organization_audit_log.sql";
let database: Database;
let ownerDatabase: Database;
let owner: Client;
let applyAuditMigration: () => Promise<void>;
let closeDatabase: () => Promise<void>;

const run = crypto.randomUUID().slice(0, 8);
const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();
const legacyTenant = crypto.randomUUID();
const legacyCreatedAt = "2026-01-15T00:00:00Z";

async function partitionNames(): Promise<string[]> {
  const result = await owner.query<{ name: string }>(
    `select c.relname as name from pg_inherits i
     join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.audit_events'::regclass order by c.relname`,
  );
  return result.rows.map((row) => row.name);
}

function monthName(date: Date): string {
  return `audit_events_p${String(date.getUTCFullYear())}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

async function dbNow(): Promise<Date> {
  const result = await owner.query<{ now: Date }>("select now() as now");
  return must(result.rows[0]).now;
}

/** Inserts through the runtime role with an explicit age, so the row lands in
 * whatever partition covers `now() - age`. */
async function seedEvent(tenantId: string, age: string): Promise<string> {
  return withTenantContextRaw(database, tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into audit_events
         (tenant_id, occurred_at, actor_user_id, actor_role, action, category,
          target_type, target_id)
       values ($1, now() - $2::interval, $3, 'owner',
               'organization.member.revoke', 'member', 'member', $3)
       returning id`,
      [tenantId, age, `seed-${run}`],
    );
    return must(result.rows[0]).id;
  });
}

async function ownerRows(tenantId: string): Promise<{ id: string }[]> {
  return (
    await owner.query<{ id: string }>(
      "select id from audit_events where tenant_id = $1",
      [tenantId],
    )
  ).rows;
}

const createdPartitions: string[] = [];
async function ensurePartitionFor(at: Date): Promise<void> {
  const { name, created } = await createAuditPartitionFor(owner, at);
  if (created) createdPartitions.push(name);
}

beforeAll(async () => {
  // Everything before F-007 first, with data that must survive 0019.
  ({
    database,
    ownerDatabase,
    owner,
    applySkipped: applyAuditMigration,
    close: closeDatabase,
  } = await openIsolatedAuditDatabase({ skip: AUDIT_MIGRATION }));
  await owner.query(
    `insert into organization (id, name, slug, created_at)
     values ($1, 'Legacy', $2, $3)`,
    [legacyTenant, `legacy-${run}`, legacyCreatedAt],
  );
  await owner.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Legacy user', $2, true, now(), now())`,
    [`legacy-user-${run}`, `legacy-${run}@example.test`],
  );
  await owner.query(
    `insert into member (id, organization_id, user_id, role)
     values ($1, $2, $3, 'owner')`,
    [`legacy-member-${run}`, legacyTenant, `legacy-user-${run}`],
  );
  await owner.query(
    `insert into monitors
       (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
     values ($1, $2, 'legacy monitor', 'https://target.example.test/', 60, 10, $3)`,
    [crypto.randomUUID(), legacyTenant, crypto.randomUUID()],
  );
}, 180_000);

afterAll(async () => {
  for (const name of createdPartitions) {
    await dropAuditPartition(owner, name).catch(() => undefined);
  }
  await closeDatabase();
}, 60_000);

describe("migration 0019 on a database that already holds F-004 to F-006 data", () => {
  it("applies, keeps existing rows, stamps the recording start and creates 3 months of partitions", async () => {
    const before = await owner.query(
      "select count(*)::int as n from monitors where tenant_id = $1",
      [legacyTenant],
    );
    await applyAuditMigration();
    await owner.query(
      `insert into organization (id, name, slug) values ($1, 'A', $2), ($3, 'B', $4)`,
      [tenantA, `a-${run}`, tenantB, `b-${run}`],
    );

    const started = await owner.query<{
      id: string;
      started: Date;
    }>(
      `select id, audit_recording_started_at as started from organization
       where id = any($1::uuid[])`,
      [[legacyTenant, tenantA]],
    );
    const checkedAt = await dbNow();
    const startedOf = (id: string) =>
      must(started.rows.find((row) => row.id === id)).started.getTime();
    // An Organization created before the migration starts recording when the
    // migration ran, not at its created_at; a new one starts at creation.
    expect(startedOf(legacyTenant)).toBeGreaterThan(
      new Date(legacyCreatedAt).getTime(),
    );
    expect(startedOf(legacyTenant)).toBeLessThanOrEqual(checkedAt.getTime());
    expect(Math.abs(startedOf(tenantA) - checkedAt.getTime())).toBeLessThan(
      60_000,
    );

    expect(
      (
        await owner.query(
          "select count(*)::int as n from monitors where tenant_id = $1",
          [legacyTenant],
        )
      ).rows[0],
    ).toEqual(before.rows[0]);

    const now = new Date();
    const expected = [-1, 0, 1, 2, 3].map((offset) =>
      monthName(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)),
      ),
    );
    expect(await partitionNames()).toEqual(expected.sort());
  });

  it("db:partitions logic is repeatable and has no default partition", async () => {
    const before = await partitionNames();
    await ensureAuditEventPartitions(ownerDatabase, { monthsAhead: 3 });
    await ensureAuditEventPartitions(ownerDatabase, { monthsAhead: 3 });
    expect(await partitionNames()).toEqual(before);
    expect(before.some((name) => name.includes("default"))).toBe(false);
    // Four months past the horizon has no partition, so the insert fails loudly.
    await expect(seedEvent(tenantA, "-130 days")).rejects.toThrow(
      /no partition of relation "audit_events" found/,
    );
  });
});

describe("partition retention", () => {
  it("drops a partition whose whole range ended more than 366 days ago and keeps newer ones", async () => {
    const now = await dbNow();
    const tooOld = new Date(now.getTime() - 400 * 24 * 3600 * 1000);
    const stillNeeded = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
    await ensurePartitionFor(tooOld);
    await ensurePartitionFor(stillNeeded);
    expect(await partitionNames()).toContain(monthName(tooOld));

    await ensureAuditEventPartitions(ownerDatabase, { monthsAhead: 3 });

    const names = await partitionNames();
    expect(names).not.toContain(monthName(tooOld));
    expect(names).toContain(monthName(stillNeeded));
    expect(names).toContain(monthName(now));
  });
});

describe("365-day purge", () => {
  it("deletes events older than 365 days and keeps events younger than that, per boundary minute", async () => {
    const now = await dbNow();
    await ensurePartitionFor(new Date(now.getTime() - 366 * 24 * 3600 * 1000));
    await ensurePartitionFor(new Date(now.getTime() - 364 * 24 * 3600 * 1000));
    const expired = await seedEvent(tenantA, "365 days 1 minute");
    const expiredLong = await seedEvent(tenantA, "366 days");
    const keptEdge = await seedEvent(tenantA, "364 days 23 hours 59 minutes");
    const kept = await seedEvent(tenantA, "364 days");
    const fresh = await seedEvent(tenantA, "0 seconds");
    const otherTenantExpired = await seedEvent(tenantB, "365 days 1 minute");

    const deleted = await database.sql.query<{ n: number }>(
      "select purge_expired_audit_events(100) as n",
    );
    expect(deleted.rows[0]?.n).toBe(3);

    const remainingA = (await ownerRows(tenantA)).map((row) => row.id);
    expect(remainingA.sort()).toEqual([keptEdge, kept, fresh].sort());
    expect(remainingA).not.toContain(expired);
    expect(remainingA).not.toContain(expiredLong);
    expect(await ownerRows(tenantB)).toHaveLength(0);
    expect(otherTenantExpired).toBeTruthy();
  });

  it("limits one call to p_limit rows and rejects an out-of-range limit", async () => {
    for (let i = 0; i < 3; i += 1) await seedEvent(tenantB, "365 days 1 hour");
    const first = await database.sql.query<{ n: number }>(
      "select purge_expired_audit_events(2) as n",
    );
    expect(first.rows[0]?.n).toBe(2);
    await expect(
      database.sql.query("select purge_expired_audit_events(0)"),
    ).rejects.toThrow(/between 1 and 10000/);
    await expect(
      database.sql.query("select purge_expired_audit_events(10001)"),
    ).rejects.toThrow(/between 1 and 10000/);
    const second = await database.sql.query<{ n: number }>(
      "select purge_expired_audit_events(2) as n",
    );
    expect(second.rows[0]?.n).toBe(1);
  });

  it("the retention owner role cannot see or delete events inside the retention window", async () => {
    const live = await seedEvent(tenantA, "10 days");
    const client = await ownerDatabase.sql.connect();
    try {
      await client.query("begin");
      await client.query("set local role nightwatch_audit_retention_owner");
      const visible = await client.query(
        "select 1 from audit_events where id = $1",
        [live],
      );
      expect(visible.rowCount).toBe(0);
      const removed = await client.query(
        "delete from audit_events where id = $1",
        [live],
      );
      expect(removed.rowCount).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect((await ownerRows(tenantA)).map((row) => row.id)).toContain(live);
  });
});

describe("tenant isolation and append-only grants", () => {
  it("shows each tenant only its own events and nothing without a tenant context", async () => {
    const a = await seedEvent(tenantA, "1 day");
    const b = await seedEvent(tenantB, "1 day");

    const asA = await withTenantContextRaw(database, tenantA, (client) =>
      client.query<{ id: string }>("select id from audit_events"),
    );
    const asB = await withTenantContextRaw(database, tenantB, (client) =>
      client.query<{ id: string }>("select id from audit_events"),
    );
    expect(asA.rows.map((row) => row.id)).toContain(a);
    expect(asA.rows.map((row) => row.id)).not.toContain(b);
    expect(asB.rows.map((row) => row.id)).toContain(b);
    expect(asB.rows.map((row) => row.id)).not.toContain(a);
    // Asking for the other tenant's id by value still returns nothing.
    const probe = await withTenantContextRaw(database, tenantA, (client) =>
      client.query("select 1 from audit_events where id = $1", [b]),
    );
    expect(probe.rowCount).toBe(0);

    const bare = await database.sql.connect();
    try {
      const none = await bare.query("select 1 from audit_events");
      expect(none.rowCount).toBe(0);
    } finally {
      bare.release();
    }
  });

  it("the runtime role cannot update or delete events, own or foreign", async () => {
    const a = await seedEvent(tenantA, "1 day");
    const b = await seedEvent(tenantB, "1 day");
    await withTenantContextRaw(database, tenantA, async (client) => {
      await client.query("savepoint s1");
      await expect(
        client.query(
          "update audit_events set actor_role = 'viewer' where id = $1",
          [a],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint s1");
      await expect(
        client.query("delete from audit_events where id = $1", [a]),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint s1");
      await expect(
        client.query("delete from audit_events where id = $1", [b]),
      ).rejects.toMatchObject({ code: "42501" });
    });
    expect((await ownerRows(tenantA)).map((row) => row.id)).toContain(a);
    expect((await ownerRows(tenantB)).map((row) => row.id)).toContain(b);
  });

  it("the runtime role cannot insert for another tenant or without a tenant context", async () => {
    await withTenantContextRaw(database, tenantA, async (client) => {
      await expect(
        recordAuditEvent(client, {
          organizationId: tenantB,
          actorUserId: "x",
          actorRole: "owner",
          action: "organization.member.revoke",
          target: { type: "member", id: "x" },
          changes: [],
        }),
      ).rejects.toMatchObject({ code: "42501" });
    });
    const bare = await database.sql.connect();
    try {
      await expect(
        recordAuditEvent(bare, {
          organizationId: tenantA,
          actorUserId: "x",
          actorRole: "owner",
          action: "organization.member.revoke",
          target: { type: "member", id: "x" },
          changes: [],
        }),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      bare.release();
    }
  });

  it("rejects an action that does not belong to its category", async () => {
    await withTenantContextRaw(database, tenantA, async (client) => {
      await expect(
        client.query(
          `insert into audit_events
             (tenant_id, actor_user_id, actor_role, category, action, target_type)
           values ($1, 'x', 'owner', 'monitor', 'organization.member.revoke', 'member')`,
          [tenantA],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("the runtime role holds only select and insert on audit_events", async () => {
    const privileges = await owner.query<{ privilege: string }>(
      `select privilege_type as privilege from information_schema.role_table_grants
       where grantee = 'nightwatch' and table_name = 'audit_events'
       order by privilege_type`,
    );
    expect(privileges.rows.map((row) => row.privilege)).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });
});
