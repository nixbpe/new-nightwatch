/**
 * Shared entry contract for explicit database integration tests
 * (`*.db.test.ts`, run by the `integration` vitest project via
 * `bun run test:integration`).
 *
 * Refusal, never silence: integration tests REQUIRE an explicitly supplied
 * test database. A missing variable throws with the exact contract instead
 * of skipping — a silently skipped integration run would fake a green gate.
 *
 * Environment contract — BOTH URLs are required before any database work:
 * - DATABASE_URL — runtime-role connection (non-owner, NOBYPASSRLS) against
 *   a disposable/dedicated test database. Required.
 * - DATABASE_OWNER_URL — owner-role connection for paths that must exercise
 *   owner privileges (migrations, provisioning DDL). Required; the runtime
 *   role must never be borrowed for owner work, so there is no fallback.
 * - MIGRATIONS_DIR — override for the ordered `NNNN_*.sql` directory when
 *   the default repo-relative resolution does not apply.
 */
export function requireIntegrationDatabaseUrls(): {
  /** Runtime-role connection (non-owner, NOBYPASSRLS). */
  runtimeUrl: string;
  /** Owner-role connection for migrations/provisioning DDL. */
  ownerUrl: string;
} {
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl) {
    throw new Error(
      "Integration tests require an explicit test database: set DATABASE_URL " +
        "(runtime-role URL against a disposable/dedicated test database). " +
        "Refusing to run without it — integration tests never silently skip.",
    );
  }
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    throw new Error(
      "Integration tests require an explicit owner-role connection: set " +
        "DATABASE_OWNER_URL (owner-role URL for migrations/provisioning DDL " +
        "against the same disposable test database). Refusing to fall back " +
        "to the runtime role — owner work must never borrow its grants.",
    );
  }
  return { runtimeUrl, ownerUrl };
}
