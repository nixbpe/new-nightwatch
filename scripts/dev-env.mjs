import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { readEnvFile } from "./env-file.mjs";
import { repoRoot, resolvePorts } from "./ports.mjs";

/**
 *   1. Explicitly exported shell variables always win (blank values count
 *      as unset, so a copied `.env.example` cannot shadow real config).
 *   2. Generated development secrets come from the gitignored
 *      `.env.compose.local` written once by `bun run db:up`.
 *   3. Localhost origins and SMTP point at this worktree's compose stack
 *      via the computed ports from scripts/ports.mjs.
 *
 * Production configuration is never fabricated here: when the generated
 * file is absent only explicitly supplied variables remain (CI path), and
 * incomplete configuration fails fast in the consuming command.
 */

const LOCAL_REDIS_PORT_BASE = 6380;

export function localRedisPort(slot) {
  return LOCAL_REDIS_PORT_BASE + slot;
}

export const LOCAL_ENV_PATH = resolve(repoRoot, ".env.compose.local");

/**
 * Expected local targets use generated secrets and resolved ports only, never
 * overridable database or Redis URLs from the caller's environment.
 * @param {Record<string, string | undefined>} generatedSecrets
 * @param {Pick<ReturnType<typeof resolvePorts>, "slot" | "dbPort">} resolvedPorts
 */
export function buildLocalComposeUrls(generatedSecrets, resolvedPorts) {
  return {
    ownerUrl: generatedSecrets.NW_OWNER_PASSWORD
      ? `postgres://nightwatch_owner:${generatedSecrets.NW_OWNER_PASSWORD}@127.0.0.1:${resolvedPorts.dbPort}/nightwatch`
      : undefined,
    runtimeUrl: generatedSecrets.NW_DB_PASSWORD
      ? `postgres://nightwatch:${generatedSecrets.NW_DB_PASSWORD}@127.0.0.1:${resolvedPorts.dbPort}/nightwatch`
      : undefined,
    redisUrl: `redis://127.0.0.1:${localRedisPort(resolvedPorts.slot)}`,
  };
}

/**
 * @param {NodeJS.ProcessEnv} [sourceEnv]
 * @returns {{ env: NodeJS.ProcessEnv, ports: ReturnType<typeof resolvePorts>, redisPort: number, hasLocalEnv: boolean }}
 */
export function resolveDevEnv(sourceEnv = process.env) {
  const ports = resolvePorts(sourceEnv);
  const redisPort = localRedisPort(ports.slot);
  const hasLocalEnv = existsSync(LOCAL_ENV_PATH);
  const localEnv = hasLocalEnv ? readEnvFile(LOCAL_ENV_PATH) : {};
  const localUrls = buildLocalComposeUrls(localEnv, ports);

  /** @type {Record<string, string | undefined>} */
  const defaults = {
    APP_URL: `http://localhost:${ports.webPort}`,
    BETTER_AUTH_URL: `http://localhost:${ports.apiPort}`,
    CORS_ORIGIN: `http://localhost:${ports.webPort}`,
    DATABASE_URL: localUrls.runtimeUrl,
    DATABASE_OWNER_URL: localUrls.ownerUrl,
    BETTER_AUTH_SECRET: localEnv.BETTER_AUTH_SECRET,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(ports.mailSmtpPort),
    SMTP_SECURE: "false",
    SMTP_FROM: "NightWatch Dev <noreply@nightwatch.local>",
    REDIS_URL: localUrls.redisUrl,
    // Monitor credential keys: dev uses the built-in development key of
    // loadMonitorEnv() (refused when NODE_ENV=production), so nothing is
    // fabricated here. Canary and OUTBOUND_TEST_ALLOWED_HOSTS stay unset in
    // dev: an unset canary is "unknown" and the allow-list is CI/e2e only.
  };

  const env = { ...sourceEnv };
  for (const [key, value] of Object.entries(defaults)) {
    // Blank assignments (e.g. from a copied .env.example) count as unset so
    // they cannot shadow the generated development defaults.
    if (value !== undefined && (env[key] === undefined || env[key] === "")) {
      env[key] = value;
    }
  }

  return { env, ports, redisPort, hasLocalEnv };
}
