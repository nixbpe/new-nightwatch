#!/usr/bin/env bun
import {
  readSeedConfig,
  seedLocalDemo,
} from "../apps/api/src/operator/seed.ts";
import { readEnvFile } from "./env-file.mjs";
import { LOCAL_ENV_PATH, resolveDevEnv } from "./dev-env.mjs";

const { env, ports, hasLocalEnv } = resolveDevEnv();
if (!hasLocalEnv) {
  console.error(
    `[seed] local Compose environment is required: run \`bun run db:up\` first (${LOCAL_ENV_PATH})`,
  );
  process.exit(1);
}
const localEnv = readEnvFile(LOCAL_ENV_PATH);

const expectedOwnerUrl = localEnv.NW_OWNER_PASSWORD
  ? `postgres://nightwatch_owner:${localEnv.NW_OWNER_PASSWORD}@127.0.0.1:${ports.dbPort}/nightwatch`
  : undefined;
const expectedRuntimeUrl = localEnv.NW_DB_PASSWORD
  ? `postgres://nightwatch:${localEnv.NW_DB_PASSWORD}@127.0.0.1:${ports.dbPort}/nightwatch`
  : undefined;
if (
  !expectedOwnerUrl ||
  !expectedRuntimeUrl ||
  env.DATABASE_OWNER_URL !== expectedOwnerUrl ||
  env.DATABASE_URL !== expectedRuntimeUrl
) {
  console.error(
    "[seed] DATABASE_OWNER_URL and DATABASE_URL must exactly match this worktree's local Compose targets",
  );
  process.exit(1);
}

const config = readSeedConfig(env, expectedOwnerUrl, expectedRuntimeUrl);
await seedLocalDemo(config.ownerUrl, config.runtimeUrl);
console.log(
  "Demo seed complete: 2 organizations, 4 users, 16 intents, 28 inbox items.",
);
