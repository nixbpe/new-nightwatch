import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
// Coverage is always measured; thresholds gate only when COVERAGE_GATE=1.
// The gate turns on at the first domain feature (see scripts/quality).
const gate = process.env.COVERAGE_GATE === "1";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/**", "src/pages/**", "src/components/**"],
      exclude: ["src/**/*.test.*", "src/test/**"],
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
