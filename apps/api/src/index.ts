import { createDatabase } from "@nightwatch/db";
import {
  createLogger,
  loadAuthEnv,
  loadEnv,
  loadMonitorEnv,
} from "@nightwatch/shared";

import { createApp } from "./app";
import { createAuth } from "./auth";
import { createMailer } from "./auth/mailer";
import { createRedisClient } from "./rate-limit";

const env = loadEnv();
const authEnv = loadAuthEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "nightwatch-api" });
const monitorEnv = loadMonitorEnv();
const redis = createRedisClient(monitorEnv.REDIS_URL);
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
});

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
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
