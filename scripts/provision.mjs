#!/usr/bin/env bun
/**
 * Root `provision:organization` wrapper around the @nightwatch/api operator
 * CLI (`provision-organization` package script, owned by OrgAccess). Used
 * once per environment to create the first organization and send its
 * owner an invitation — invitation-only, no positional args, no password.
 *
 *   bun run provision:organization -- \
 *     --name "Acme" --slug acme --owner-email admin@example.com
 *
 * Environment comes from scripts/dev-env.mjs (same convention as
 * `bun run dev` / `db:migrate`): generated .env.compose.local secrets plus
 * computed local origins/SMTP, with explicitly exported shell variables
 * always winning. The operator writes pre-tenant identity/membership rows
 * as the owner role and sends the invitation through configured SMTP, so
 * DATABASE_OWNER_URL (or DATABASE_URL) and SMTP_* must resolve. All
 * arguments are forwarded explicitly to the CLI; nothing is fabricated.
 */
import { spawn } from "node:child_process";

import { LOCAL_ENV_PATH, resolveDevEnv } from "./dev-env.mjs";

const args = process.argv.slice(2);

const { env } = resolveDevEnv();

if (!env.DATABASE_OWNER_URL && !env.DATABASE_URL) {
  console.error(
    "[provision] no database URL: run `bun run db:up` first " +
      `(generates ${LOCAL_ENV_PATH}) or export DATABASE_OWNER_URL / DATABASE_URL`,
  );
  process.exit(1);
}

if (args.length === 0) {
  console.error(
    '[provision] usage: bun run provision:organization -- --name "<org>" --slug <slug> --owner-email <email>',
  );
  process.exit(2);
}

const child = spawn(
  "bun",
  ["run", "--filter", "@nightwatch/api", "provision-organization", ...args],
  { stdio: "inherit", env },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
