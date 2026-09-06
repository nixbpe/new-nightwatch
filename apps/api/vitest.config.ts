import { defineConfig } from "vitest/config";

// Coverage is always measured; thresholds gate only when COVERAGE_GATE=1.
// The gate turns on at the first domain feature (see scripts/quality).
const gate = process.env.COVERAGE_GATE === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
