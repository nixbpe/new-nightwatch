import { createDatabase } from "@nightwatch/db";
import {
  createLogger,
  loadAuthEnv,
  loadEnv,
  loadMonitorEnv,
  type StsVerifier,
} from "@nightwatch/shared";

import { createApp } from "./app";
import { createAuth } from "./auth";
import { createMailer } from "./auth/mailer";
import { createRedisClient } from "./rate-limit";
import { API_IDLE_TIMEOUT_SECONDS } from "./server-options";

/**
 * Boots the API process. The caller supplies the STS verifier: src/index.ts
 * the real one, the e2e entry in src/testing/ a fakecloud one. This module
 * never imports src/testing/ (guarded by entry-isolation.test.ts).
 */
export async function startApi({
  awsSts,
  awsPrincipalArn,
}: {
  awsSts: StsVerifier;
  /** Overrides NIGHTWATCH_AWS_PRINCIPAL_ARN; the e2e entry names its emulator user. */
  awsPrincipalArn?: string;
}): Promise<void> {
  const env = loadEnv();
  const authEnv = loadAuthEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    name: "nightwatch-api",
  });
  const monitorEnv = loadMonitorEnv();
  const redis = createRedisClient(
    monitorEnv.REDIS_URL,
    logger,
    env.REDIS_KEY_PREFIX,
  );
  const database = createDatabase(authEnv.DATABASE_URL);
  const mailer = createMailer(authEnv, logger);
  await mailer.verify();
  const auth = createAuth({ env, authEnv, logger, database, mailer });
  const app = createApp({
    env,
    authEnv,
    logger,
    auth,
    database,
    mailer,
    redis,
    outbound: { testAllowedHosts: monitorEnv.OUTBOUND_TEST_ALLOWED_HOSTS },
    credentialEnv: monitorEnv,
    awsSts,
    awsPrincipalArn:
      awsPrincipalArn ?? env.NIGHTWATCH_AWS_PRINCIPAL_ARN ?? null,
  });

  const server = Bun.serve({
    port: env.PORT,
    idleTimeout: API_IDLE_TIMEOUT_SECONDS,
    fetch: app.fetch,
  });
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "api listening");

  function shutdown(signal: "SIGINT" | "SIGTERM"): void {
    logger.info({ signal }, "shutdown requested");
    void server.stop(true);
    redis.disconnect();
    void database.close().finally(() => {
      logger.flush();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}
