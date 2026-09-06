import { defineConfig, devices } from "@playwright/test";

import { resolvePorts } from "../scripts/ports.mjs";

// Per-worktree ports (scripts/ports.mjs) let parallel checkouts run the e2e
// suite side by side. Playwright starts both dev servers itself, so
// `bun run e2e` is self-contained on a fresh machine.
const { webPort, apiPort } = resolvePorts();
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun run dev",
      cwd: "../apps/api",
      url: `${apiUrl}/health`,
      env: { PORT: String(apiPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "bun run dev",
      cwd: "../apps/web",
      url: webUrl,
      env: { WEB_PORT: String(webPort), API_PORT: String(apiPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
