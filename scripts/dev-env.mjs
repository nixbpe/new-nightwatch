import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { readEnvFile } from "./env-file.mjs";
import { repoRoot, resolvePorts } from "./ports.mjs";

/**
 * Shared development-environment resolution for the root workflow commands
 * (`dev`, `db:migrate`, operator provisioning). Every consumer gets the same
 * convention, so no command invents a subtly different environment:
 *
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

export const LOCAL_ENV_PATH = resolve(repoRoot, ".env.compose.local");

/**
 * @param {NodeJS.ProcessEnv} [sourceEnv]
 * @returns {{ env: NodeJS.ProcessEnv, ports: ReturnType<typeof resolvePorts>, hasLocalEnv: boolean }}
 */
export function resolveDevEnv(sourceEnv = process.env) {
  const ports = resolvePorts(sourceEnv);
  const hasLocalEnv = existsSync(LOCAL_ENV_PATH);
  const localEnv = hasLocalEnv ? readEnvFile(LOCAL_ENV_PATH) : {};

  /** @type {Record<string, string | undefined>} */
  const defaults = {
    APP_URL: `http://localhost:${ports.webPort}`,
    BETTER_AUTH_URL: `http://localhost:${ports.apiPort}`,
    CORS_ORIGIN: `http://localhost:${ports.webPort}`,
    DATABASE_URL: localEnv.NW_DB_PASSWORD
      ? `postgres://nightwatch:${localEnv.NW_DB_PASSWORD}@127.0.0.1:${ports.dbPort}/nightwatch`
      : undefined,
    DATABASE_OWNER_URL: localEnv.NW_OWNER_PASSWORD
      ? `postgres://nightwatch_owner:${localEnv.NW_OWNER_PASSWORD}@127.0.0.1:${ports.dbPort}/nightwatch`
      : undefined,
    BETTER_AUTH_SECRET: localEnv.BETTER_AUTH_SECRET,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(ports.mailSmtpPort),
    SMTP_SECURE: "false",
    SMTP_FROM: "NightWatch Dev <noreply@nightwatch.local>",
  };

  const env = { ...sourceEnv };
  for (const [key, value] of Object.entries(defaults)) {
    // Blank assignments (e.g. from a copied .env.example) count as unset so
    // they cannot shadow the generated development defaults.
    if (value !== undefined && (env[key] === undefined || env[key] === "")) {
      env[key] = value;
    }
  }

  return { env, ports, hasLocalEnv };
}
