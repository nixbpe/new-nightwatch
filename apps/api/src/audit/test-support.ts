import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

function partitionName(month: Date): string {
  const year = month.getUTCFullYear();
  const number = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `audit_events_p${String(year)}${number}`;
}

/**
 * Creates the `audit_events` partition holding `at` (UTC month) with the
 * owner connection, so a test can seed events older than the months
 * `ensure_audit_event_partitions` creates. Returns the partition name and
 * whether this call created it; drop only what you created.
 *
 * Creating or dropping a partition locks the parent table. Call it only on a
 * database no other suite writes to.
 */
export async function createAuditPartitionFor(
  owner: Client,
  at: Date,
): Promise<{ name: string; created: boolean }> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const name = partitionName(start);
  const exists = await owner.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${name}`],
  );
  if (exists.rows[0]?.present) return { name, created: false };
  await owner.query(
    `create table public.${name} partition of public.audit_events
       for values from ('${start.toISOString()}') to ('${end.toISOString()}')`,
  );
  await owner.query(`alter table public.${name} enable row level security`);
  await owner.query(`alter table public.${name} force row level security`);
  return { name, created: true };
}

export async function dropAuditPartition(
  owner: Client,
  name: string,
): Promise<void> {
  if (!/^audit_events_p\d{6}$/.test(name)) {
    throw new Error(`refusing to drop ${name}: not an audit partition`);
  }
  await owner.query(`drop table if exists public.${name}`);
}

const IDEMPOTENT_ROLE = /create role (\w+)([^;]*);/g;
const idempotentRole = (_match: string, role: string, options: string) =>
  `do $role$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role}${options}; end if; end $role$;`;

/**
 * A migrated database of its own on the shared cluster, for tests that create
 * or drop `audit_events` partitions (those lock the parent table). `close`
 * drops it, and so does a failed setup. Roles are cluster-global, so `create
 * role` is made idempotent in the migration copy (architecture DB-13).
 *
 * `skip` leaves one migration file out; `applySkipped` runs it later, for a
 * test that needs data in place before that migration.
 */
export async function openIsolatedAuditDatabase(options?: {
  skip?: string;
}): Promise<{
  database: Database;
  ownerDatabase: Database;
  owner: Client;
  applySkipped: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
  const name = `audit_db_${crypto.randomUUID().replaceAll("-", "")}`;
  const ownerTarget = new URL(ownerUrl);
  ownerTarget.pathname = `/${name}`;
  const runtimeTarget = new URL(runtimeUrl);
  runtimeTarget.pathname = `/${name}`;
  const source = new URL("../../../../packages/db/migrations", import.meta.url)
    .pathname;
  const admin = new Client({ connectionString: ownerUrl });
  const owner = new Client({ connectionString: ownerTarget.toString() });
  const database = createDatabase(runtimeTarget.toString());
  const ownerDatabase = createDatabase(ownerTarget.toString());
  let copy: string | undefined;
  let adminConnected = false;
  let ownerConnected = false;

  const close = async (): Promise<void> => {
    await database.close().catch(() => undefined);
    await ownerDatabase.close().catch(() => undefined);
    if (ownerConnected) await owner.end().catch(() => undefined);
    if (adminConnected) {
      try {
        try {
          await admin.query(`drop database if exists ${name}`);
        } catch {
          await admin.query(
            `select pg_terminate_backend(pid) from pg_stat_activity
             where datname = $1 and pid <> pg_backend_pid()`,
            [name],
          );
          await admin.query(`drop database if exists ${name}`);
        }
      } finally {
        await admin.end().catch(() => undefined);
      }
    }
    if (copy) await rm(copy, { recursive: true, force: true });
  };

  const migrate = () =>
    runMigrations({
      url: ownerTarget.toString(),
      migrationsDir: copy ?? "",
      log: () => undefined,
    });

  try {
    await admin.connect();
    adminConnected = true;
    await admin.query(`create database ${name}`);
    await admin.query(
      `grant connect, temporary on database ${name} to nightwatch`,
    );
    copy = await mkdtemp(join(tmpdir(), "nightwatch-audit-migrations-"));
    for (const file of await readdir(source)) {
      if (file === options?.skip) continue;
      const sql = (await readFile(join(source, file), "utf8")).replace(
        IDEMPOTENT_ROLE,
        idempotentRole,
      );
      await writeFile(join(copy, file), sql);
    }
    await migrate();
    await owner.connect();
    ownerConnected = true;
  } catch (error) {
    await close();
    throw error;
  }

  return {
    database,
    ownerDatabase,
    owner,
    applySkipped: async () => {
      if (!options?.skip || !copy) throw new Error("no migration was skipped");
      const sql = (await readFile(join(source, options.skip), "utf8")).replace(
        IDEMPOTENT_ROLE,
        idempotentRole,
      );
      await writeFile(join(copy, options.skip), sql);
      await migrate();
    },
    close,
  };
}
