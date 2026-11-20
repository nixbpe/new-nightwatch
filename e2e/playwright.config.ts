import { defineConfig, devices } from "@playwright/test";

import { resolvePorts } from "../scripts/ports.mjs";
import {
  FAKECLOUD_IMAGE,
  fakecloudEndpoint,
  fakecloudPort,
} from "./support/fakecloud";

// Per-worktree ports (scripts/ports.mjs) let parallel checkouts run the e2e
// suite side by side.
const { webPort, apiPort } = resolvePorts();
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;
const FAKECLOUD_CONTAINER = `nw-e2e-fakecloud-${String(fakecloudPort())}`;

// Runtime configuration is forwarded from the caller only — never fabricated
// here. APP_URL/BETTER_AUTH_URL/CORS_ORIGIN fall back to the resolved dev
// origins (same computation as scripts/dev.mjs) so the webServer block is
// self-contained; database/auth/Redis values must come from the caller when
// the API or worker needs them. Monitor credential keys may stay unset outside
// production (development fallback); OUTBOUND_TEST_ALLOWED_HOSTS is required by
// e2e/tests/monitors.spec.ts (see scripts/quality/README.md).
const RUNTIME_ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_OWNER_URL",
  "BETTER_AUTH_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "REDIS_URL",
  "REDIS_KEY_PREFIX",
  "CREDENTIAL_ENCRYPTION_KEYS",
  "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION",
  "OUTBOUND_TEST_ALLOWED_HOSTS",
  "MONITOR_EGRESS_CANARY_URLS",
] as const;

function runtimeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of RUNTIME_ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined && value !== "") {
      env[name] = value;
    }
  }
  return env;
}

function apiServerEnv(): Record<string, string> {
  return {
    ...runtimeEnv(),
    PORT: String(apiPort),
    FAKECLOUD_ENDPOINT: fakecloudEndpoint,
    APP_URL: process.env.APP_URL ?? webUrl,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? apiUrl,
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? webUrl,
  };
}

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
    // Local STS/IAM emulator for F-013. Only the test-only API entry below
    // talks to it; the production entry has no way to select it.
    {
      // A container left by a killed run (SIGKILL skips --rm) is removed first.
      command: `docker rm -f ${FAKECLOUD_CONTAINER} >/dev/null 2>&1; exec docker run --rm --name ${FAKECLOUD_CONTAINER} -e FAKECLOUD_IAM=soft -e FAKECLOUD_VERIFY_SIGV4=true -p 127.0.0.1:${String(fakecloudPort())}:4566 ${FAKECLOUD_IMAGE}`,
      url: `${fakecloudEndpoint}/_fakecloud/health`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      timeout: 120_000,
    },
    {
      command: "bun run --cwd apps/worker start",
      cwd: "..",
      env: {
        ...runtimeEnv(),
        WORKER_ROLES:
          "consumer,scheduler,monitor-scheduler,monitor-checker,audit-exporter",
      },
      stdout: "pipe",
      wait: { stdout: /in-app materialize worker ready/ },
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      timeout: 60_000,
    },
    {
      command: "bun src/testing/e2e-server.ts",
      cwd: "../apps/api",
      url: `${apiUrl}/health`,
      env: apiServerEnv(),
      // API log lines reach the run output so a run can be scanned for secrets.
      stdout: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "bun run dev",
      cwd: "../apps/web",
      url: webUrl,
      env: { WEB_PORT: String(webPort), API_PORT: String(apiPort) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
