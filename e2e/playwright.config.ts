import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against real dev servers started via `bun run dev` at the repo root
 * (web on :3000 proxying /api to the API on :4000).
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
