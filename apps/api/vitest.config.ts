import { defineConfig } from "vitest/config";

// Two explicit projects keep database work honest:
// - "unit" (`bun run test`): no database required, ever.
// - "integration" (`bun run test:integration`): `*.db.test.ts` against an
//   explicitly supplied test database. BOTH URLs are required before any
//   database work: DATABASE_URL (runtime role, non-owner NOBYPASSRLS) and
//   DATABASE_OWNER_URL (owner role for migrations/provisioning DDL; no
//   fallback to the runtime role). Missing env throws a refusal — never a
//   silent skip (see src/testing/db-integration.ts).
//
// Coverage is always measured; thresholds gate only when COVERAGE_GATE=1.
// `bun run test:coverage` intentionally runs BOTH projects so the gate
// measures real factory/adapter paths, which requires the integration
// environment above (documented for root/CI wiring in scripts/quality).
const gate = process.env.COVERAGE_GATE === "1";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.db.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**"],
      // Server bootstrap (Bun.serve + signal handlers) is verified by dev-server
      // smoke runs, not unit tests.
      exclude: ["src/index.ts", "src/**/*.test.ts"],
      thresholds: gate
        ? {
            lines: 80,
            functions: 80,
            statements: 80,
            branches: 70,
          }
        : undefined,
    },
  },
});
