/**
 * Root `dev` entrypoint: computes this worktree's ports and runs the turbo
 * dev graph with WEB_PORT/API_PORT injected, so every worktree gets an
 * isolated stack without manual configuration.
 */
import { spawn } from "node:child_process";
import { resolvePorts } from "./ports.mjs";

// The API listens on PORT (platform convention); the computed apiPort is
// injected as PORT for the API and API_PORT for the web proxy target.

const { slot, webPort, apiPort } = resolvePorts(process.env);

console.log(
  `[dev] worktree slot ${slot} → web http://localhost:${webPort} · api http://localhost:${apiPort}`,
);

const child = spawn("turbo", ["run", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    PORT: String(apiPort),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
