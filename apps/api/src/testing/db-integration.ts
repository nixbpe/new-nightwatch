// Throws, never skips: a skipped integration run would fake a green gate.
export function requireIntegrationDatabaseUrls(): {
  runtimeUrl: string;
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
