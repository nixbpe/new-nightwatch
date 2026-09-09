import { fileURLToPath } from "node:url";

import { runMigrations } from "./migrator";

/**
 * CLI entry (`bun run --filter @nightwatch/db migrate`, aliased from the
 * root as `db:migrate`; bundled form: `bun build` via the `build:migrate`
 * script, then run `dist-migrate/migrate.js`).
 *
 * Operator contract (environment):
 * - DATABASE_OWNER_URL — owner-role connection for DDL; required unless
 *   DATABASE_URL is set (which is then used as a fallback).
 * - DATABASE_URL — runtime application URL; fallback only.
 * - MIGRATIONS_DIR — optional directory of ordered `NNNN_*.sql` files.
 *   Defaults to the package's ../migrations (valid for source runs). The
 *   bundled image must set it explicitly, e.g.
 *   `MIGRATIONS_DIR=/app/migrations bun dist-migrate/migrate.js`, because
 *   import.meta.url resolution does not survive bundling.
 *
 * Migrations require the owner role; the runtime role is non-owner
 * NOBYPASSRLS.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "db migrate: DATABASE_OWNER_URL (or DATABASE_URL) is required",
    );
    process.exit(1);
  }
  // The bundled build (build:migrate) cannot resolve ../migrations via
  // import.meta.url, so the image/operator may point at the directory
  // explicitly; source runs keep the default next to the package.
  const migrationsDir =
    process.env.MIGRATIONS_DIR ??
    fileURLToPath(new URL("../migrations", import.meta.url));
  const result = await runMigrations({
    url,
    migrationsDir,
    log: (message) => {
      console.log(`db migrate: ${message}`);
    },
  });
  console.log(
    `db migrate: done (${String(result.applied.length)} applied, ` +
      `${String(result.alreadyApplied.length)} already applied)`,
  );
}

main().catch((error: unknown) => {
  console.error("db migrate: failed", error);
  process.exit(1);
});
