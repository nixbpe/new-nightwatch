#!/usr/bin/env bun
/**
 * Root `db:migrate` wrapper; environment resolution lives in scripts/dev-env.mjs.
 * The @nightwatch/db CLI resolves DATABASE_OWNER_URL before DATABASE_URL
 * (owner-before-app). Fails fast when neither URL is available.
 * Run `bun run db:up` then `bun run db:migrate` for local development.
 */
import { spawn } from "node:child_process";

import { LOCAL_ENV_PATH, resolveDevEnv } from "./dev-env.mjs";

const { env } = resolveDevEnv();

if (!env.DATABASE_OWNER_URL && !env.DATABASE_URL) {
  console.error(
    "[migrate] no database URL: run `bun run db:up` first " +
      `(generates ${LOCAL_ENV_PATH}) or export DATABASE_OWNER_URL / DATABASE_URL`,
  );
  process.exit(1);
}

const child = spawn("bun", ["run", "--filter", "@nightwatch/db", "migrate"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
