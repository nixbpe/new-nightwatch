#!/usr/bin/env bun
/**
 * Root `dev` entrypoint: computes this worktree's ports and runs the turbo
 * dev graph with WEB_PORT/API_PORT injected, so every worktree gets an
 * isolated stack without manual configuration.
 *
 * The auth environment comes from scripts/dev-env.mjs: generated
 * .env.compose.local secrets (written by `bun run db:up`) plus computed
 * per-worktree origins/SMTP, with explicitly exported shell variables
 * always winning. Run `bun run db:up` before `bun run dev` — the API
 * cannot start database-backed features without it.
 */
import { spawn } from "node:child_process";

import { LOCAL_ENV_PATH, resolveDevEnv } from "./dev-env.mjs";

const { env, ports, hasLocalEnv } = resolveDevEnv();

if (!hasLocalEnv) {
  console.warn(
    `[dev] no ${LOCAL_ENV_PATH} — run \`bun run db:up\` first; database/SMTP env will be missing`,
  );
}

// The API listens on PORT (platform convention); the computed apiPort is
// injected as PORT for the API and API_PORT for the web proxy target.
env.WEB_PORT = String(ports.webPort);
env.API_PORT = String(ports.apiPort);
env.PORT = String(ports.apiPort);

console.log(
  `[dev] worktree slot ${ports.slot} → web http://localhost:${ports.webPort} · api http://localhost:${ports.apiPort} · db 127.0.0.1:${ports.dbPort} · mailpit http://localhost:${ports.mailUiPort}`,
);

const child = spawn("turbo", ["run", "dev"], {
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
