#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { resolveDevEnv } from "./dev-env.mjs";
import { repoRoot } from "./ports.mjs";

const args = process.argv.slice(2);
const name = `nw_e2e_${randomUUID().replaceAll("-", "")}`;
const localEnv = resolveDevEnv().env;
let child;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill("SIGINT");
  });
}

async function command(executable, argv, env, capture = false) {
  const running = spawn(executable, argv, {
    cwd: repoRoot,
    env,
    stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
  });
  child = running;
  let output = "";
  running.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    running.once("error", reject);
    running.once("close", (code) => resolve(code ?? 1));
  });
  child = undefined;
  if (code !== 0) throw new Error(`${executable} exited with ${code}`);
  return output.trim();
}

async function browserPorts() {
  const servers = [createServer(), createServer()];
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "localhost", resolve);
        }),
    ),
  );
  const ports = servers.map((server) => String(server.address().port));
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  return ports;
}

async function playwright(env) {
  await command(
    "node",
    [
      "e2e/node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "e2e/playwright.config.ts",
      ...args,
    ],
    env,
  );
}

async function main() {
  if (
    process.env.CI ||
    process.env.E2E_EXTERNAL_SERVICES === "1" ||
    args.some((arg) => ["--list", "--help", "-h"].includes(arg))
  ) {
    await playwright(localEnv);
    return;
  }
  try {
    const namespace = JSON.parse(
      await command(
        "bun",
        ["scripts/e2e-database.mjs", "prepare", name],
        localEnv,
        true,
      ),
    );
    if (interrupted) return;
    const [webPort, apiPort] = await browserPorts();
    const env = {
      ...localEnv,
      ...namespace,
      BETTER_AUTH_SECRET: randomUUID(),
      E2E_EMAIL: `settings-${name}@nightwatch.invalid`,
      E2E_PASSWORD: `Nightwatch-${randomUUID()}!`,
      E2E_REQUIRE_CREDENTIALS: "1",
      WEB_PORT: webPort,
      API_PORT: apiPort,
      APP_URL: `http://localhost:${webPort}`,
      BETTER_AUTH_URL: `http://localhost:${apiPort}`,
      CORS_ORIGIN: `http://localhost:${webPort}`,
      OUTBOUND_TEST_ALLOWED_HOSTS:
        process.env.OUTBOUND_TEST_ALLOWED_HOSTS || "127.0.0.1.nip.io",
    };
    await command("bun", ["run", "db:migrate"], env);
    if (!interrupted) await command("bun", ["run", "db:partitions"], env);
    if (!interrupted)
      await command(
        "bun",
        ["apps/api/src/operator/provision-e2e-fixture.ts"],
        env,
      );
    if (!interrupted) await playwright(env);
  } finally {
    await command(
      "bun",
      ["scripts/e2e-database.mjs", "cleanup", name],
      localEnv,
    );
  }
}

try {
  await main();
  if (interrupted) process.exitCode = 130;
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
}
