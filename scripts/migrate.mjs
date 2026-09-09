#!/usr/bin/env bun
/**
 * Root `db:migrate` wrapper. Resolves the same generated development
 * environment as `bun run dev` and `provision:organization`
 * (scripts/dev-env.mjs: .env.compose.local secrets + computed ports, shell
 * env wins, blanks count as unset), then invokes the @nightwatch/db
 * migration CLI, which resolves DATABASE_OWNER_URL before DATABASE_URL
 * (owner-before-app).
 *
 * Fresh-start contract: `bun run db:up` then `bun run db:migrate` works
 * with no exported variables. In CI (no generated file) the explicitly
 * exported job environment is used unchanged. Fails fast when neither
 * DATABASE_OWNER_URL nor DATABASE_URL is available — never falls back to
 * an implied default database.
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
