/**
 * Per-worktree port allocation. Single source of truth for the API and web
 * dev servers and the e2e suite, giving each git worktree a stable default
 * port pair on one machine.
 *
 * - Primary checkout (`.git` is a directory): slot 0 → 3000/4000.
 * - Linked worktree (`.git` is a file): stable slot 1–99 hashed from the
 *   worktree path → 3000+slot / 4000+slot. Hash collisions between worktrees
 *   are possible; dev servers use strict ports and fail loudly — override
 *   with `WEB_PORT`/`API_PORT` in that case.
 *
 * - `WEB_PORT` / `API_PORT` always win (CI, containers, manual override).
 *
 * The same slot drives the local dependency stack (scripts/db.mjs,
 * compose.yaml): PostgreSQL on 5400+slot and Mailpit on 7400+slot (SMTP) /
 * 7500+slot (web UI), overridable with `NW_DB_PORT` / `NW_MAIL_SMTP_PORT` /
 * `NW_MAIL_UI_PORT`. These bases deliberately avoid the fixed service ports
 * 5432/1025/8025 so the stack never shadows a system PostgreSQL or another
 * Mailpit instance.
 *
 * CLI: `bun scripts/ports.mjs` prints `WEB_PORT=… API_PORT=…` for manual
 * single-app runs in a linked worktree.
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BASE_WEB_PORT = 3000;
const BASE_API_PORT = 4000;
const BASE_DB_PORT = 5400;
const BASE_MAIL_SMTP_PORT = 7400;
const BASE_MAIL_UI_PORT = 7500;
const MAX_SLOT = 100;

export function worktreeSlot(rootDir = repoRoot) {
  const gitPath = resolve(rootDir, ".git");
  if (existsSync(gitPath) && statSync(gitPath).isDirectory()) return 0;
  const hash = createHash("sha256").update(rootDir).digest();
  return 1 + (hash.readUInt16LE(0) % (MAX_SLOT - 1));
}

export function resolvePorts(env = process.env) {
  const slot = worktreeSlot();
  return {
    slot,
    webPort: parsePort(env.WEB_PORT) ?? BASE_WEB_PORT + slot,
    apiPort: parsePort(env.API_PORT) ?? BASE_API_PORT + slot,
    dbPort: parsePort(env.NW_DB_PORT) ?? BASE_DB_PORT + slot,
    mailSmtpPort:
      parsePort(env.NW_MAIL_SMTP_PORT) ?? BASE_MAIL_SMTP_PORT + slot,
    mailUiPort: parsePort(env.NW_MAIL_UI_PORT) ?? BASE_MAIL_UI_PORT + slot,
  };
}

function parsePort(value) {
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${JSON.stringify(value)}`);
  }
  return port;
}

if (import.meta.main) {
  const { webPort, apiPort, dbPort, mailSmtpPort, mailUiPort, slot } =
    resolvePorts();
  console.log(
    `WEB_PORT=${webPort} API_PORT=${apiPort} NW_DB_PORT=${dbPort} NW_MAIL_SMTP_PORT=${mailSmtpPort} NW_MAIL_UI_PORT=${mailUiPort} # worktree slot ${slot}`,
  );
}
