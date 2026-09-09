import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "pg";

/**
 * Ordered custom migration runner (architecture §5):
 * `NNNN_description.sql` files, advisory locking, transactional
 * per-migration execution with tracking in `__nightwatch_migrations`.
 * Never `drizzle-kit push`/`migrate`; never rewrite applied migrations —
 * a content change to an applied migration fails the run.
 */

export const MIGRATIONS_TRACKING_TABLE = "__nightwatch_migrations";

/**
 * Advisory lock key identifying the NightWatch migration session.
 * Arbitrary 64-bit constant, shared by every runner process.
 */
const ADVISORY_LOCK_KEY = 0x4e_57_4d_49_47;

const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export type Migration = {
  name: string;
  sql: string;
  sha256: string;
};

export async function listMigrations(
  migrationsDir: string,
): Promise<Migration[]> {
  const entries = await readdir(migrationsDir);
  const names = entries
    .filter((entry) => MIGRATION_NAME_PATTERN.test(entry))
    .sort();
  const migrations: Migration[] = [];
  for (const name of names) {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    migrations.push({ name, sql, sha256: sha256(sql) });
  }
  return migrations;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type MigrationResult = {
  applied: string[];
  alreadyApplied: string[];
};

export async function runMigrations(options: {
  url: string;
  migrationsDir: string;
  log?: (message: string) => void;
}): Promise<MigrationResult> {
  const client = new Client({ connectionString: options.url });
  await client.connect();
  try {
    // Serialize concurrent runners (deploys, operators) on this database.
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      await client.query(
        `create table if not exists ${MIGRATIONS_TRACKING_TABLE} (
          name text primary key,
          sha256 text not null,
          applied_at timestamptz not null default now()
        )`,
      );
      const appliedResult = await client.query<{
        name: string;
        sha256: string;
      }>(`select name, sha256 from ${MIGRATIONS_TRACKING_TABLE}`);
      const applied = new Map(
        appliedResult.rows.map((row) => [row.name, row.sha256] as const),
      );

      const result: MigrationResult = { applied: [], alreadyApplied: [] };
      for (const migration of await listMigrations(options.migrationsDir)) {
        const recordedHash = applied.get(migration.name);
        if (recordedHash !== undefined) {
          if (recordedHash !== migration.sha256) {
            throw new Error(
              `Applied migration ${migration.name} was modified ` +
                "(rewriting applied migrations is prohibited); " +
                "author a new ordered migration instead.",
            );
          }
          result.alreadyApplied.push(migration.name);
          continue;
        }
        // Per-migration transaction: body and tracking row commit or roll
        // back together, so a crash never records an unapplied migration.
        await client.query("begin");
        try {
          await client.query(migration.sql);
          await client.query(
            `insert into ${MIGRATIONS_TRACKING_TABLE} (name, sha256) values ($1, $2)`,
            [migration.name, migration.sha256],
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
        options.log?.(`applied ${migration.name}`);
        result.applied.push(migration.name);
      }
      return result;
    } finally {
      await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
