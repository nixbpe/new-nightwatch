#!/usr/bin/env bun
import {
  readSeedConfig,
  seedLocalDemo,
} from "../apps/api/src/operator/seed.ts";
import { readEnvFile } from "./env-file.mjs";
import {
  buildLocalComposeUrls,
  LOCAL_ENV_PATH,
  resolveDevEnv,
} from "./dev-env.mjs";

const { env, ports, hasLocalEnv } = resolveDevEnv();
if (!hasLocalEnv) {
  console.error(
    `[seed] local Compose environment is required: run \`bun run db:up\` first (${LOCAL_ENV_PATH})`,
  );
  process.exit(1);
}
const localEnv = readEnvFile(LOCAL_ENV_PATH);

const { ownerUrl: expectedOwnerUrl, runtimeUrl: expectedRuntimeUrl } =
  buildLocalComposeUrls(localEnv, ports);
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
