import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabase, runMigrations, type Database } from "@nightwatch/db";

const idempotentRole = (_match: string, role: string, options: string) =>
  `do $role$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role}${options}; end if; end $role$;`;

/**
 * A migrated database of its own on the shared cluster. The exporter claims
 * across every Organization and tests create partitions for past months, so
 * neither can share a database with other suites. `close` drops it, and so
 * does a failed setup.
 */
export async function openIsolatedDatabase(): Promise<{
  database: Database;
  owner: Database;
  close: () => Promise<void>;
}> {
  const runtimeUrl = process.env.DATABASE_URL;
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!runtimeUrl || !ownerUrl) {
    throw new Error(
      "audit worker integration requires DATABASE_URL and DATABASE_OWNER_URL",
    );
  }
  const name = `audit_worker_${randomUUID().replaceAll("-", "")}`;
  const ownerTarget = new URL(ownerUrl);
  ownerTarget.pathname = `/${name}`;
  const runtimeTarget = new URL(runtimeUrl);
  runtimeTarget.pathname = `/${name}`;
  const source = new URL("../../../../packages/db/migrations", import.meta.url)
    .pathname;
  const admin = createDatabase(ownerUrl);
  const database = createDatabase(runtimeTarget.toString());
  let owner: Database | undefined;
  let copy: string | undefined;
  let created = false;

  const close = async (): Promise<void> => {
    await database.close().catch(() => undefined);
    await owner?.close().catch(() => undefined);
    try {
      if (created) {
        try {
          await admin.sql.query(`drop database if exists ${name}`);
        } catch {
          await admin.sql.query(
            `select pg_terminate_backend(pid) from pg_stat_activity
             where datname = $1 and pid <> pg_backend_pid()`,
            [name],
          );
          await admin.sql.query(`drop database if exists ${name}`);
        }
      }
    } finally {
      await admin.close().catch(() => undefined);
    }
    if (copy) await rm(copy, { recursive: true, force: true });
  };

  try {
    await admin.sql.query(`create database ${name}`);
    created = true;
    await admin.sql.query(
      `grant connect, temporary on database ${name} to nightwatch`,
    );
    copy = await mkdtemp(join(tmpdir(), "nightwatch-worker-migrations-"));
    for (const file of await readdir(source)) {
      const sql = (await readFile(join(source, file), "utf8")).replace(
        /create role (\w+)([^;]*);/g,
        idempotentRole,
      );
      await writeFile(join(copy, file), sql);
    }
    await runMigrations({
      url: ownerTarget.toString(),
      migrationsDir: copy,
      log: () => undefined,
    });
    owner = createDatabase(ownerTarget.toString());
  } catch (error) {
    await close();
    throw error;
  }
  return { database, owner, close };
}

/** Creates the `audit_events` partition that holds `at`, if it does not exist. */
export async function ensureAuditPartitionFor(
  owner: Database,
  at: Date,
): Promise<void> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const name = `audit_events_p${String(start.getUTCFullYear())}${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  const exists = await owner.sql.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${name}`],
  );
  if (exists.rows[0]?.present) return;
  await owner.sql.query(
    `create table public.${name} partition of public.audit_events
       for values from ('${start.toISOString()}') to ('${end.toISOString()}')`,
  );
  await owner.sql.query(`alter table public.${name} enable row level security`);
  await owner.sql.query(`alter table public.${name} force row level security`);
}
