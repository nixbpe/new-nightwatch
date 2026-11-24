import assert from "node:assert/strict";
import type { PoolClient } from "pg";

import { createDatabase } from "../../src/client";
import { listMigrations } from "../../src/migrator";

export type PostgresCommand = (
  args: string[],
  input?: string,
) => Promise<string>;

// Copies schema and the checksummed ledger from one snapshot, never app data or roles.
export async function prepareTestDatabase(options: {
  ownerUrl: string;
  name: string;
  migrationsDir: string;
  command: PostgresCommand;
}): Promise<void> {
  const { ownerUrl, name, migrationsDir, command } = options;
  if (!/^nw_(?:e2e|plan)_[0-9a-f]{32}$/.test(name))
    throw new Error("Invalid disposable database name");
  const owner = createDatabase(ownerUrl);
  const targetUrl = new URL(ownerUrl);
  targetUrl.pathname = `/${name}`;
  const target = createDatabase(targetUrl.toString());
  let source: PoolClient | undefined;
  try {
    source = await owner.sql.connect();
    await source.query("begin isolation level repeatable read read only");
    const ledger = (
      await source.query<{ name: string; sha256: string; applied_at: Date }>(
        "select name, sha256, applied_at from __nightwatch_migrations",
      )
    ).rows;
    const migrations = await listMigrations(migrationsDir);
    if (
      ledger.length !== migrations.length ||
      migrations.some(
        (migration) =>
          !ledger.some(
            (row) =>
              row.name === migration.name && row.sha256 === migration.sha256,
          ),
      )
    )
      throw new Error(
        "Local schema must match repository migrations; run bun run db:migrate first",
      );
    const snapshotRow = (
      await source.query<{ snapshot: string }>(
        "select pg_export_snapshot() as snapshot",
      )
    ).rows[0];
    assert(snapshotRow);
    const snapshot = snapshotRow.snapshot;
    const schema = await command([
      "pg_dump",
      "-U",
      new URL(ownerUrl).username,
      "-d",
      decodeURIComponent(new URL(ownerUrl).pathname.slice(1)),
      "--schema-only",
      `--snapshot=${snapshot}`,
    ]);
    await owner.sql.query(
      `create database "${name}" owner nightwatch_owner template template0`,
    );
    await command(
      [
        "psql",
        "-U",
        new URL(ownerUrl).username,
        "-d",
        name,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      schema,
    );
    for (const row of ledger)
      await target.sql.query(
        "insert into __nightwatch_migrations (name, sha256, applied_at) values ($1, $2, $3)",
        [row.name, row.sha256, row.applied_at],
      );
  } finally {
    try {
      if (source) {
        try {
          await source.query("rollback");
        } finally {
          source.release();
        }
      }
    } finally {
      try {
        await target.close();
      } finally {
        await owner.close();
      }
    }
  }
}
