import { defineConfig } from "vitest/config";

// test:coverage runs both projects so the gate measures real adapter paths; it
// needs the integration database.
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
      // Server bootstrap is covered by dev-server smoke runs.
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
