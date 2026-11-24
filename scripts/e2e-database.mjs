import { spawn } from "node:child_process";

import { createDatabase } from "../packages/db/src/index.ts";
import { prepareTestDatabase } from "../packages/db/tests/support/snapshot.ts";
import { createRedisClient } from "../apps/api/src/rate-limit/redis.ts";
import {
  buildLocalComposeUrls,
  LOCAL_ENV_PATH,
  localRedisPort,
  resolveDevEnv,
} from "./dev-env.mjs";
import { readEnvFile } from "./env-file.mjs";
import { repoRoot } from "./ports.mjs";

const [action, name] = process.argv.slice(2);
if (
  !["prepare", "cleanup"].includes(action) ||
  !/^nw_e2e_[0-9a-f]{32}$/.test(name ?? "")
) {
  throw new Error(
    "Expected prepare|cleanup and a generated nw_e2e_<32 hex digits> name",
  );
}
const { env, ports, hasLocalEnv } = resolveDevEnv();
if (!hasLocalEnv)
  throw new Error("Run bun run db:up and bun run db:migrate first");
const local = readEnvFile(LOCAL_ENV_PATH);
const redisPort = localRedisPort(ports.slot);
const { ownerUrl, runtimeUrl, redisUrl } = buildLocalComposeUrls(local, ports);
if (!ownerUrl || !runtimeUrl) {
  throw new Error("E2E bootstrap requires generated local Compose passwords");
}
if (
  env.DATABASE_OWNER_URL !== ownerUrl ||
  env.DATABASE_URL !== runtimeUrl ||
  env.REDIS_URL !== redisUrl
) {
  throw new Error(
    "E2E bootstrap requires this worktree's local Compose database and Redis URLs",
  );
}
const owner = createDatabase(ownerUrl);
const targetOwnerUrl = new URL(ownerUrl);
const targetRuntimeUrl = new URL(runtimeUrl);
targetOwnerUrl.pathname = `/${name}`;
targetRuntimeUrl.pathname = `/${name}`;

async function postgresCommand(args, input) {
  const child = spawn(
    "docker",
    [
      "compose",
      "-f",
      `${repoRoot}/compose.yaml`,
      "-p",
      `nw-dev-${ports.slot}`,
      "exec",
      "-T",
      "postgres",
      ...args,
    ],
    {
      env: {
        ...env,
        NW_SLOT: String(ports.slot),
        NW_DB_PORT: String(ports.dbPort),
        NW_REDIS_PORT: String(redisPort),
        NW_MAIL_SMTP_PORT: String(ports.mailSmtpPort),
        NW_MAIL_UI_PORT: String(ports.mailUiPort),
        ...local,
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((resolve, reject) => {
    child.stdin.on("error", reject);
    child.stdin.end(input);
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`PostgreSQL bootstrap command exited with ${code}`)),
    );
  });
  return output;
}

async function prepare() {
  await prepareTestDatabase({
    ownerUrl,
    name,
    migrationsDir: `${repoRoot}/packages/db/migrations`,
    command: postgresCommand,
  });
  console.log(
    JSON.stringify({
      DATABASE_OWNER_URL: targetOwnerUrl.toString(),
      DATABASE_URL: targetRuntimeUrl.toString(),
      REDIS_URL: env.REDIS_URL,
      REDIS_KEY_PREFIX: name,
    }),
  );
}

async function cleanup() {
  await owner.sql.query(`drop database if exists "${name}" with (force)`);
  const redis = createRedisClient(env.REDIS_URL);
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${name}:*`,
        "COUNT",
        500,
      );
      cursor = next;
      if (keys.length) await redis.unlink(...keys);
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
}

try {
  if (action === "prepare") await prepare();
  else await cleanup();
} finally {
  await owner.close();
}
