import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { sql } from "drizzle-orm";

import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  initializeAccountMfaState,
  recordAccountMfaTransition,
  runMigrations,
  withAccountContext,
  type Database,
} from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;

if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "MFA backfill database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

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

afterAll(async () => {
  try {
    await isolatedDatabase?.close();
  } finally {
    try {
      await isolatedOwner?.end();
    } finally {
      try {
        if (adminConnected) {
          try {
            await admin.query(`drop database if exists ${databaseName}`);
          } catch {
            await admin.query(
              `select pg_terminate_backend(pid)
               from pg_stat_activity
               where datname = $1 and pid <> pg_backend_pid()`,
              [databaseName],
            );
            await admin.query(`drop database if exists ${databaseName}`);
          }
        }
      } finally {
        await admin.end().catch(() => undefined);
        await rm(legacyMigrationsDir, { recursive: true, force: true });
      }
    }
  }
}, 60_000);
describe("legacy MFA projection migration", () => {
  it("backfills only effective verified MFA and preserves the first transition", async () => {
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
    await admin.query(
      `grant connect, temporary on database ${databaseName} to nightwatch`,
    );

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
    const raceUser = randomUUID();
    await isolatedOwner.query(
      `insert into "user" (id, name, email, email_verified, two_factor_enabled)
       values
         ($1, 'Verified legacy', $2, true, true),
         ($3, 'Stale projection', $4, true, true),
         ($5, 'Pending legacy', $6, true, true),
         ($7, 'Disabled legacy', $8, true, false),
         ($9, 'Race legacy', $10, true, true)`,
      [
        verifiedUser,
        `${verifiedUser}@example.test`,
        staleProjectionUser,
        `${staleProjectionUser}@example.test`,
        pendingUser,
        `${pendingUser}@example.test`,
        disabledUser,
        `${disabledUser}@example.test`,
        raceUser,
        `${raceUser}@example.test`,
      ],
    );
    await isolatedOwner.query(
      `insert into "twoFactor" (id, user_id, secret, backup_codes, verified)
       values
         ($1, $2, 'test-secret', 'test-codes', true),
         ($3, $4, 'test-secret', 'test-codes', true),
         ($5, $6, 'test-secret', 'test-codes', false),
         ($7, $8, 'test-secret', 'test-codes', true),
         ($9, $10, 'test-secret', 'test-codes', true)`,
      [
        randomUUID(),
        verifiedUser,
        randomUUID(),
        staleProjectionUser,
        randomUUID(),
        pendingUser,
        randomUUID(),
        disabledUser,
        randomUUID(),
        raceUser,
      ],
    );
    await isolatedOwner.query(
      `insert into notification_account_mfa_state (user_id, verified_enabled)
       values ($1, false)`,
      [staleProjectionUser],
    );

    isolatedDatabase = createDatabase(isolatedRuntimeUrl.toString());
    const releaseDisable = Promise.withResolvers<undefined>();
    const baselineLocked = Promise.withResolvers<undefined>();
    let runtimeBackendPid = 0;
    const raceDisable = withAccountContext(
      isolatedDatabase,
      raceUser,
      async (tx) => {
        await initializeAccountMfaState(tx, { userId: raceUser });
        const backend = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        runtimeBackendPid = backend.rows[0]?.pid ?? 0;
        baselineLocked.resolve(undefined);
        await releaseDisable.promise;
        await tx.execute(sql`
          update "user"
          set two_factor_enabled = false
          where id = ${raceUser}
        `);
        await tx.execute(sql`
          delete from "twoFactor"
          where user_id = ${raceUser}
        `);
        return recordAccountMfaTransition(tx, {
          id: randomUUID(),
          dispatchId: randomUUID(),
          userId: raceUser,
          origin: `legacy-race-disable:${databaseName}`,
          transition: "disabled",
          occurredAt: new Date(),
        });
      },
    );
    await baselineLocked.promise;
    await cp(
      join(migrationsDir, "0006_notification_account_mfa_backfill.sql"),
      join(legacyMigrationsDir, "0006_notification_account_mfa_backfill.sql"),
    );
    const migration = runMigrations({
      url: isolatedOwnerUrl.toString(),
      migrationsDir: legacyMigrationsDir,
      log: () => undefined,
    });
    expect(runtimeBackendPid).toBeGreaterThan(0);
    let migrationWaitedOnSourceLock = false;
    const deadline = Date.now() + 5_000;
    try {
      while (Date.now() < deadline) {
        const waiting = await isolatedOwner.query<{ count: number }>(
          `select count(*)::integer as count
           from pg_stat_activity
           where datname = $1
             and wait_event_type = 'Lock'
             and $2 = any(pg_blocking_pids(pid))
             and query like '-- Backfill only the effective verified-MFA baseline%'`,
          [databaseName, runtimeBackendPid],
        );
        if (waiting.rows[0]?.count === 1) {
          migrationWaitedOnSourceLock = true;
          break;
        }
        // This integration race waits for PostgreSQL's real lock manager.
        await sleep(20);
      }
      expect(migrationWaitedOnSourceLock).toBe(true);
    } finally {
      releaseDisable.resolve(undefined);
      await Promise.allSettled([raceDisable, migration]);
    }
    expect(await raceDisable).toEqual({ transitioned: true });
    const result = await migration;
    expect(result.applied).toEqual([
      "0006_notification_account_mfa_backfill.sql",
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
        { user_id: raceUser, verified_enabled: false },
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
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await isolatedOwner.query<{ event_type: string; count: number }>(
          `select event_type, count(*)::integer as count
           from notification_intents
           where user_id = $1
           group by event_type`,
          [raceUser],
        )
      ).rows,
    ).toEqual([{ event_type: "MFA_DISABLED", count: 1 }]);

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
      async (tx) => {
        await initializeAccountMfaState(tx, { userId: verifiedUser });
        await tx.execute(sql`
          update "user"
          set two_factor_enabled = false
          where id = ${verifiedUser}
        `);
        await tx.execute(sql`
          delete from "twoFactor"
          where user_id = ${verifiedUser}
        `);
        return recordAccountMfaTransition(tx, {
          id: randomUUID(),
          dispatchId: randomUUID(),
          userId: verifiedUser,
          origin: `legacy-disable:${databaseName}`,
          transition: "disabled",
          occurredAt: new Date(),
        });
      },
    );
    expect(disable).toEqual({ transitioned: true });
    expect(
      (
        await isolatedOwner.query<{
          two_factor_enabled: boolean | null;
          two_factor_count: number;
        }>(
          `select u.two_factor_enabled,
                  (select count(*)::integer from "twoFactor" where user_id = u.id) as two_factor_count
           from "user" as u
           where u.id = $1`,
          [verifiedUser],
        )
      ).rows,
    ).toEqual([{ two_factor_enabled: false, two_factor_count: 0 }]);
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
  }, 60_000);
});
