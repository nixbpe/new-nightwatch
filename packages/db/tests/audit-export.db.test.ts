import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimAuditExport,
  createDatabase,
  failStaleAuditExports,
  findStaleAuditExports,
  insertAuditExportNotificationIntent,
  purgeAuditExports,
  runMigrations,
  withTenantUserContextRaw,
} from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "audit export database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

// claim_audit_export() claims across every Organization, so this file runs in
// its own database on the shared cluster (see monitor.db.test.ts).
const databaseName = `audit_export_db_${randomUUID().replaceAll("-", "")}`;
const isolatedOwnerUrl = new URL(ownerUrl);
isolatedOwnerUrl.pathname = `/${databaseName}`;
const isolatedRuntimeUrl = new URL(runtimeUrl);
isolatedRuntimeUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: ownerUrl });
const owner = new Client({ connectionString: isolatedOwnerUrl.toString() });
const database = createDatabase(isolatedRuntimeUrl.toString());
const ownerDatabase = createDatabase(isolatedOwnerUrl.toString());
const sourceMigrations = new URL("../migrations", import.meta.url).pathname;
const EXPORT_MIGRATION = "0021_audit_exports.sql";
let migrationsCopyDir: string | undefined;
let adminConnected = false;
let ownerConnected = false;

const run = randomUUID().slice(0, 8);
const tenantA = randomUUID();
const tenantB = randomUUID();
const userA1 = `exp-a1-${run}`;
const userA2 = `exp-a2-${run}`;
const userB1 = `exp-b1-${run}`;

const idempotentRole = (_match: string, role: string, options: string) =>
  `do $role$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role}${options}; end if; end $role$;`;

async function copyMigrations(skip?: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "nightwatch-export-migrations-"));
  for (const name of await readdir(sourceMigrations)) {
    if (name === skip) continue;
    const sql = (await readFile(join(sourceMigrations, name), "utf8")).replace(
      /create role (\w+)([^;]*);/g,
      idempotentRole,
    );
    await writeFile(join(target, name), sql);
  }
  return target;
}

type ExportSeed = {
  tenantId: string;
  userId: string;
  state?: "queued" | "running" | "ready" | "failed";
  /** SQL interval, applied to created_at (and to the ledger). */
  age?: string;
  attempts?: number;
  /** SQL interval for claimed_until relative to now(); negative = expired. */
  lease?: string;
  fileExpiresIn?: string;
  purged?: boolean;
};

/** Inserts a request and its ledger row as the owner (bypasses RLS). */
async function seedExport(seed: ExportSeed): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `insert into audit_exports
       (id, tenant_id, requested_by, format, filters, time_zone, snapshot_at,
        created_at, content, file_expires_at, content_purged_at)
     values ($1, $2, $3, 'csv', '{"q":"secret search"}'::jsonb, 'UTC', now(),
             now() - $4::interval, $5, now() + $6::interval, $7)`,
    [
      id,
      seed.tenantId,
      seed.userId,
      seed.age ?? "0 seconds",
      seed.purged ? null : Buffer.from("file bytes"),
      seed.fileExpiresIn ?? "24 hours",
      seed.purged ? new Date() : null,
    ],
  );
  await owner.query(
    `insert into audit_export_jobs
       (export_id, tenant_id, requested_by, state, attempt_count, claim_token,
        claimed_until, created_at)
     values ($1, $2, $3, $4::text, $5,
             case when $4::text = 'running' then gen_random_uuid() end,
             case when $4::text = 'running' then now() + $6::interval end,
             now() - $7::interval)`,
    [
      id,
      seed.tenantId,
      seed.userId,
      seed.state ?? "queued",
      seed.attempts ?? 0,
      seed.lease ?? "10 minutes",
      seed.age ?? "0 seconds",
    ],
  );
  return id;
}

async function clearExports(): Promise<void> {
  await owner.query("delete from audit_exports");
}

async function jobState(id: string) {
  const result = await owner.query<{
    state: string;
    attempt_count: number;
    claim_token: string | null;
  }>(
    "select state, attempt_count, claim_token from audit_export_jobs where export_id = $1",
    [id],
  );
  return result.rows[0];
}

beforeAll(async () => {
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database ${databaseName}`);
  await admin.query(
    `grant connect, temporary on database ${databaseName} to nightwatch`,
  );
  migrationsCopyDir = await copyMigrations(EXPORT_MIGRATION);
  await runMigrations({
    url: isolatedOwnerUrl.toString(),
    migrationsDir: migrationsCopyDir,
    log: () => undefined,
  });
  await owner.connect();
  ownerConnected = true;
  await owner.query(
    `insert into organization (id, name, slug) values ($1, 'A', $2), ($3, 'B', $4)`,
    [tenantA, `a-${run}`, tenantB, `b-${run}`],
  );
  for (const [id, tenant] of [
    [userA1, tenantA],
    [userA2, tenantA],
    [userB1, tenantB],
  ] as const) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $1, $2, true, now(), now())`,
      [id, `${id}@example.test`],
    );
    await owner.query(
      `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin')`,
      [`m-${id}`, tenant, id],
    );
  }
}, 180_000);

afterAll(async () => {
  try {
    await database.close();
    await ownerDatabase.close();
    if (ownerConnected) await owner.end();
  } finally {
    try {
      if (adminConnected) {
        try {
          await admin.query(`drop database if exists ${databaseName}`);
        } catch {
          await admin.query(
            `select pg_terminate_backend(pid) from pg_stat_activity
             where datname = $1 and pid <> pg_backend_pid()`,
            [databaseName],
          );
          await admin.query(`drop database if exists ${databaseName}`);
        }
      }
    } finally {
      await admin.end().catch(() => undefined);
      if (migrationsCopyDir) {
        await rm(migrationsCopyDir, { recursive: true, force: true });
      }
    }
  }
}, 60_000);

describe("migration 0021 on a database that already holds notifications", () => {
  it("applies, keeps existing notification rows and accepts the two new types for tenant scope only", async () => {
    await owner.query(
      `insert into notification_intents
         (id, scope_kind, tenant_id, origin, event_type, occurred_at)
       values ('legacy-intent-${run}', 'tenant', $1, 'legacy-${run}',
               'ORG-NOTIFICATION-SETTINGS-CHANGED', now())`,
      [tenantA],
    );
    if (!migrationsCopyDir) throw new Error("migration copy missing");
    const sql = (
      await readFile(join(sourceMigrations, EXPORT_MIGRATION), "utf8")
    ).replace(/create role (\w+)([^;]*);/g, idempotentRole);
    await writeFile(join(migrationsCopyDir, EXPORT_MIGRATION), sql);
    await runMigrations({
      url: isolatedOwnerUrl.toString(),
      migrationsDir: migrationsCopyDir,
      log: () => undefined,
    });
    const legacy = await owner.query(
      "select 1 from notification_intents where id = $1",
      [`legacy-intent-${run}`],
    );
    expect(legacy.rowCount).toBe(1);

    for (const eventType of ["AUDIT_EXPORT_READY", "AUDIT_EXPORT_FAILED"]) {
      await owner.query(
        `insert into notification_intents
           (id, scope_kind, tenant_id, origin, event_type, occurred_at, subject_audit_export_id)
         values ($1, 'tenant', $2, $3, $4, now(), gen_random_uuid())`,
        [`i-${eventType}-${run}`, tenantA, `o-${eventType}-${run}`, eventType],
      );
      await owner.query(
        `insert into notification_inbox_items
           (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id,
            event_type, occurred_at, subject_audit_export_id)
         values ($1, $2, $3, $4, 'tenant', $5, $6, now(), gen_random_uuid())`,
        [
          `x-${eventType}-${run}`,
          `i-${eventType}-${run}`,
          `o-${eventType}-${run}`,
          userA1,
          tenantA,
          eventType,
        ],
      );
      await expect(
        owner.query(
          `insert into notification_intents
             (id, scope_kind, user_id, origin, event_type, occurred_at)
           values ($1, 'account', $2, $3, $4, now())`,
          [
            `acct-${eventType}-${run}`,
            userA1,
            `acct-${eventType}-${run}`,
            eventType,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        owner.query(
          `insert into notification_inbox_items
             (id, intent_id, origin, recipient_user_id, scope_kind, user_id,
              event_type, occurred_at)
           values ($1, $2, $3, $4, 'account', $4, $5, now())`,
          [
            `acct-x-${eventType}-${run}`,
            `i-${eventType}-${run}`,
            `acct-x-${eventType}-${run}`,
            userA1,
            eventType,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    expect(
      (
        await owner.query<{ d: Date }>(
          "select audit_export_deadline('2026-10-03T10:00:00Z') as d",
        )
      ).rows[0]?.d.toISOString(),
    ).toBe("2026-10-03T11:00:00.000Z");
  });
});

describe("row level security", () => {
  it("scopes both tables to the Organization and the requesting user", async () => {
    await clearExports();
    const mine = await seedExport({ tenantId: tenantA, userId: userA1 });
    const colleague = await seedExport({ tenantId: tenantA, userId: userA2 });
    const other = await seedExport({ tenantId: tenantB, userId: userB1 });

    const visible = async (tenant: string, user: string) =>
      withTenantUserContextRaw(database, tenant, user, async (client) => ({
        exports: (
          await client.query<{ id: string }>("select id from audit_exports")
        ).rows.map((row) => row.id),
        jobs: (
          await client.query<{ export_id: string }>(
            "select export_id from audit_export_jobs",
          )
        ).rows.map((row) => row.export_id),
      }));
    expect(await visible(tenantA, userA1)).toEqual({
      exports: [mine],
      jobs: [mine],
    });
    expect(await visible(tenantA, userA2)).toEqual({
      exports: [colleague],
      jobs: [colleague],
    });
    // A user of A asking with B's context sees B's own rows only for B's user.
    expect(await visible(tenantB, userA1)).toEqual({ exports: [], jobs: [] });
    expect(await visible(tenantB, userB1)).toEqual({
      exports: [other],
      jobs: [other],
    });
  });

  it("cannot update or delete another user's or another Organization's request", async () => {
    await clearExports();
    const colleague = await seedExport({ tenantId: tenantA, userId: userA2 });
    const other = await seedExport({ tenantId: tenantB, userId: userB1 });
    await withTenantUserContextRaw(
      database,
      tenantA,
      userA1,
      async (client) => {
        for (const id of [colleague, other]) {
          const exportUpdate = await client.query(
            "update audit_exports set failure_code = 'EXPORT_FAILED' where id = $1",
            [id],
          );
          const jobUpdate = await client.query(
            "update audit_export_jobs set state = 'failed' where export_id = $1",
            [id],
          );
          expect([exportUpdate.rowCount, jobUpdate.rowCount]).toEqual([0, 0]);
        }
        await client.query("savepoint s");
        await expect(
          client.query("delete from audit_exports where id = $1", [colleague]),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to savepoint s");
        await expect(
          client.query(
            `insert into audit_exports
             (tenant_id, requested_by, format, filters, time_zone, snapshot_at)
           values ($1, $2, 'csv', '{}', 'UTC', now())`,
            [tenantA, userA2],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      },
    );
    expect(await jobState(colleague)).toMatchObject({ state: "queued" });
    expect(await jobState(other)).toMatchObject({ state: "queued" });
  });

  it("shows nothing without a tenant context or without a user context", async () => {
    await clearExports();
    await seedExport({ tenantId: tenantA, userId: userA1 });
    const client = await database.sql.connect();
    try {
      expect((await client.query("select 1 from audit_exports")).rowCount).toBe(
        0,
      );
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [
        tenantA,
      ]);
      expect((await client.query("select 1 from audit_exports")).rowCount).toBe(
        0,
      );
      expect(
        (await client.query("select 1 from audit_export_jobs")).rowCount,
      ).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("rejects a ledger row whose tenant or requester differs from the request", async () => {
    await clearExports();
    const id = randomUUID();
    await owner.query(
      `insert into audit_exports
         (id, tenant_id, requested_by, format, filters, time_zone, snapshot_at)
       values ($1, $2, $3, 'csv', '{}', 'UTC', now())`,
      [id, tenantA, userA1],
    );
    for (const [tenant, user] of [
      [tenantB, userA1],
      [tenantA, userA2],
    ] as const) {
      await expect(
        owner.query(
          `insert into audit_export_jobs
             (export_id, tenant_id, requested_by, state, created_at)
           values ($1, $2, $3, 'queued', now())`,
          [id, tenant, user],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    }
  });

  it("deletes the ledger row with its request", async () => {
    await clearExports();
    const id = await seedExport({ tenantId: tenantA, userId: userA1 });
    await owner.query("delete from audit_exports where id = $1", [id]);
    expect(await jobState(id)).toBeUndefined();
  });
});

describe("claim_audit_export", () => {
  it("claims a queued request and moves it to running with a lease and a token", async () => {
    await clearExports();
    const id = await seedExport({ tenantId: tenantA, userId: userA1 });
    const claim = await claimAuditExport(database);
    expect(claim).toMatchObject({
      exportId: id,
      tenantId: tenantA,
      requestedBy: userA1,
      exhausted: false,
    });
    expect(await jobState(id)).toMatchObject({
      state: "running",
      attempt_count: 1,
      claim_token: claim?.claimToken,
    });
    expect(await claimAuditExport(database)).toBeNull();
  });

  it("claims a running request only after its lease ran out, and gives it a new token", async () => {
    await clearExports();
    const held = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      state: "running",
      attempts: 1,
      lease: "5 minutes",
    });
    expect(await claimAuditExport(database)).toBeNull();
    await owner.query(
      "update audit_export_jobs set claimed_until = now() - interval '1 second' where export_id = $1",
      [held],
    );
    const before = await jobState(held);
    const claim = await claimAuditExport(database);
    expect(claim?.exportId).toBe(held);
    expect(claim?.claimToken).not.toBe(before?.claim_token);
    expect(await jobState(held)).toMatchObject({ attempt_count: 2 });
  });

  it("never returns ready or failed requests, even past the deadline", async () => {
    await clearExports();
    await seedExport({
      tenantId: tenantA,
      userId: userA1,
      state: "ready",
      age: "3 hours",
    });
    await seedExport({
      tenantId: tenantA,
      userId: userA2,
      state: "failed",
      age: "3 hours",
    });
    expect(await claimAuditExport(database)).toBeNull();
  });

  it("still claims a new request of a requester whose old request is ready past the deadline", async () => {
    await clearExports();
    await seedExport({
      tenantId: tenantA,
      userId: userA1,
      state: "ready",
      age: "3 hours",
    });
    const fresh = await seedExport({ tenantId: tenantA, userId: userA1 });
    expect((await claimAuditExport(database))?.exportId).toBe(fresh);
  });

  it("flags exhaustion on the fourth claim and from minute 50 of the request", async () => {
    await clearExports();
    const fourth = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      attempts: 3,
    });
    expect(await claimAuditExport(database)).toMatchObject({
      exportId: fourth,
      exhausted: true,
    });
    await clearExports();
    const late = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      age: "51 minutes",
    });
    expect(await claimAuditExport(database)).toMatchObject({
      exportId: late,
      exhausted: true,
    });
    await clearExports();
    const early = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      age: "49 minutes",
    });
    expect(await claimAuditExport(database)).toMatchObject({
      exportId: early,
      exhausted: false,
    });
  });

  it("gives two concurrent claimers different requests", async () => {
    await clearExports();
    const a = await seedExport({ tenantId: tenantA, userId: userA1 });
    const b = await seedExport({ tenantId: tenantA, userId: userA2 });
    const claims = await Promise.all([
      claimAuditExport(database),
      claimAuditExport(database),
    ]);
    expect(claims.map((claim) => claim?.exportId).sort()).toEqual(
      [a, b].sort(),
    );
  });

  it("gives the claim role no access to the request itself", async () => {
    await clearExports();
    await seedExport({ tenantId: tenantA, userId: userA1 });
    const client = await ownerDatabase.sql.connect();
    try {
      await client.query("begin");
      await client.query("set local role nightwatch_audit_export_claim_owner");
      await expect(
        client.query("select 1 from audit_exports"),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
      await client.query("begin");
      await client.query("set local role nightwatch_audit_export_claim_owner");
      await expect(
        client.query("select filters from audit_exports"),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
      await client.query("begin");
      await client.query("set local role nightwatch_audit_export_claim_owner");
      expect(
        (await client.query("select export_id from audit_export_jobs"))
          .rowCount,
      ).toBe(1);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});

describe("find_stale_audit_exports and failStaleAuditExports", () => {
  it("lists only in-flight requests past the deadline", async () => {
    await clearExports();
    const lateQueued = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      age: "61 minutes",
    });
    const lateRunning = await seedExport({
      tenantId: tenantB,
      userId: userB1,
      state: "running",
      age: "2 hours",
    });
    await seedExport({ tenantId: tenantA, userId: userA2, age: "30 minutes" });
    await seedExport({
      tenantId: tenantA,
      userId: userA2,
      state: "ready",
      age: "5 hours",
    });
    await seedExport({
      tenantId: tenantB,
      userId: userA1,
      state: "failed",
      age: "5 hours",
    });
    const stale = await findStaleAuditExports(database, { limit: 50 });
    expect(stale.map((row) => row.exportId).sort()).toEqual(
      [lateQueued, lateRunning].sort(),
    );
    expect(stale.find((row) => row.exportId === lateQueued)).toEqual({
      exportId: lateQueued,
      tenantId: tenantA,
      requestedBy: userA1,
    });
    await expect(findStaleAuditExports(database, { limit: 0 })).rejects.toThrow(
      /between 1 and 100/,
    );
  });

  it("fails a late request with one notification, and does nothing a second time or to a ready row", async () => {
    await clearExports();
    await owner.query(
      "delete from notification_intents where origin like 'audit-export:%'",
    );
    const late = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      age: "61 minutes",
    });
    const done = await seedExport({
      tenantId: tenantA,
      userId: userA2,
      state: "ready",
      age: "3 hours",
    });
    const sweep = (user: string, exportId?: string) =>
      withTenantUserContextRaw(database, tenantA, user, (client) =>
        failStaleAuditExports(client, {
          tenantId: tenantA,
          requestedBy: user,
          exportId,
        }),
      );
    expect(await sweep(userA1, late)).toEqual([late]);
    expect(await sweep(userA1, late)).toEqual([]);
    expect(await sweep(userA2, done)).toEqual([]);
    expect(await jobState(late)).toMatchObject({ state: "failed" });
    expect(await jobState(done)).toMatchObject({ state: "ready" });
    const row = (
      await owner.query<{ failure_code: string; completed_at: Date | null }>(
        "select failure_code, completed_at from audit_exports where id = $1",
        [late],
      )
    ).rows[0];
    expect(row?.failure_code).toBe("EXPORT_FAILED");
    expect(row?.completed_at).toBeInstanceOf(Date);
    const intents = await owner.query<{ event_type: string }>(
      "select event_type from notification_intents where origin = $1",
      [`audit-export:${late}:failed`],
    );
    expect(intents.rows).toEqual([{ event_type: "AUDIT_EXPORT_FAILED" }]);
    const recipients = await owner.query<{ recipient_user_id: string }>(
      `select recipient_user_id from notification_intent_recipients where origin = $1`,
      [`audit-export:${late}:failed`],
    );
    expect(recipients.rows).toEqual([{ recipient_user_id: userA1 }]);
  });

  it("writes no notification when the requester is no longer a member (P-07)", async () => {
    await clearExports();
    const gone = `exp-gone-${run}`;
    await owner.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $1, $2, true, now(), now())`,
      [gone, `${gone}@example.test`],
    );
    const id = await seedExport({
      tenantId: tenantA,
      userId: gone,
      age: "61 minutes",
    });
    const failed = await withTenantUserContextRaw(
      database,
      tenantA,
      gone,
      (client) =>
        failStaleAuditExports(client, { tenantId: tenantA, requestedBy: gone }),
    );
    expect(failed).toEqual([id]);
    expect(
      (
        await owner.query(
          "select 1 from notification_intents where origin = $1",
          [`audit-export:${id}:failed`],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("insertAuditExportNotificationIntent is idempotent per export and outcome", async () => {
    await clearExports();
    const id = randomUUID();
    const input = {
      tenantId: tenantA,
      exportId: id,
      requesterUserId: userA1,
      outcome: "ready" as const,
    };
    const insert = () =>
      withTenantUserContextRaw(database, tenantA, userA1, (client) =>
        insertAuditExportNotificationIntent(client, input),
      );
    expect(await insert()).toBe(true);
    expect(await insert()).toBe(false);
    expect(
      (
        await owner.query(
          "select 1 from notification_intents where origin = $1 and subject_audit_export_id = $2",
          [`audit-export:${id}:ready`, id],
        )
      ).rowCount,
    ).toBe(1);
  });
});

describe("retention", () => {
  it("clears expired files even when more than p_limit cleared rows exist, and does not touch a cleared row again", async () => {
    await clearExports();
    await clearExports();
    // Cleared rows far outnumber the limit; the expired one must still be found.
    for (let i = 0; i < 6; i += 1) {
      const id = randomUUID();
      await owner.query(
        `insert into audit_exports
           (id, tenant_id, requested_by, format, filters, time_zone, snapshot_at,
            file_expires_at, content_purged_at)
         values ($1, $2, $3, 'csv', '{}', 'UTC', now(), now() - interval '2 hours', now() - interval '1 hour')`,
        [id, tenantA, userA1],
      );
    }
    const expired = await seedExport({
      tenantId: tenantA,
      userId: userA2,
      state: "ready",
      fileExpiresIn: "-1 minute",
    });
    const stamp = async () =>
      (
        await owner.query<{
          content_purged_at: Date | null;
          has_content: boolean;
        }>(
          "select content_purged_at, content is not null as has_content from audit_exports where id = $1",
          [expired],
        )
      ).rows[0];
    const before = await stamp();
    expect(before).toMatchObject({
      content_purged_at: null,
      has_content: true,
    });
    expect(await purgeAuditExports(database, { limit: 2 })).toBe(1);
    const cleared = await stamp();
    expect(cleared?.has_content).toBe(false);
    expect(cleared?.content_purged_at).toBeInstanceOf(Date);
    expect(await purgeAuditExports(database, { limit: 2 })).toBe(0);
    expect((await stamp())?.content_purged_at).toEqual(
      cleared?.content_purged_at,
    );
  });

  it("deletes requests older than 7 days with their ledger rows, and no younger ones", async () => {
    await clearExports();
    const old = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      state: "failed",
      age: "8 days",
    });
    const young = await seedExport({
      tenantId: tenantA,
      userId: userA2,
      state: "failed",
      age: "6 days",
    });
    expect(
      await purgeAuditExports(database, { limit: 10 }),
    ).toBeGreaterThanOrEqual(1);
    expect(await jobState(old)).toBeUndefined();
    expect(await jobState(young)).toMatchObject({ state: "failed" });
    await expect(purgeAuditExports(database, { limit: 0 })).rejects.toThrow(
      /between 1 and 10000/,
    );
  });

  it("limits the retention role to expired files and to rows older than 7 days, with no read of the file", async () => {
    await clearExports();
    const live = await seedExport({
      tenantId: tenantA,
      userId: userA1,
      state: "ready",
    });
    const expired = await seedExport({
      tenantId: tenantA,
      userId: userA2,
      state: "ready",
      fileExpiresIn: "-1 minute",
    });
    const client = await ownerDatabase.sql.connect();
    const asRetention = async (work: () => Promise<void>) => {
      await client.query("begin");
      try {
        await client.query("set local role nightwatch_audit_retention_owner");
        await work();
      } finally {
        await client.query("rollback");
      }
    };
    try {
      await asRetention(async () => {
        await expect(
          client.query("select content from audit_exports"),
        ).rejects.toMatchObject({ code: "42501" });
      });
      await asRetention(async () => {
        await expect(
          client.query("select filters from audit_exports"),
        ).rejects.toMatchObject({ code: "42501" });
      });
      await asRetention(async () => {
        const liveUpdate = await client.query(
          "update audit_exports set content = null, content_purged_at = now() where id = $1",
          [live],
        );
        const expiredUpdate = await client.query(
          "update audit_exports set content = null, content_purged_at = now() where id = $1",
          [expired],
        );
        expect([liveUpdate.rowCount, expiredUpdate.rowCount]).toEqual([0, 1]);
      });
      await asRetention(async () => {
        expect(
          (
            await client.query(
              "delete from audit_exports where id = any($1::uuid[])",
              [[live, expired]],
            )
          ).rowCount,
        ).toBe(0);
      });
      await asRetention(async () => {
        await expect(
          client.query("select 1 from audit_export_jobs"),
        ).rejects.toMatchObject({ code: "42501" });
      });
    } finally {
      client.release();
    }
  });
});
