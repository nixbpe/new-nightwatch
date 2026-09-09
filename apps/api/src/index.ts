import { createDatabase } from "@nightwatch/db";
import { createLogger, loadAuthEnv, loadEnv } from "@nightwatch/shared";

import { createApp } from "./app";
import { createAuth } from "./auth";
import { createMailer } from "./auth/mailer";

// Fail-fast: an invalid environment must not start the server.
const env = loadEnv();
const authEnv = loadAuthEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "nightwatch-api" });
const database = createDatabase(authEnv.DATABASE_URL);
const mailer = createMailer(authEnv, logger);
// Fail-fast: refuse to serve when the SMTP server is unreachable.
await mailer.verify();
const auth = createAuth({ env, authEnv, logger, database, mailer });
const app = createApp({ env, authEnv, logger, auth, database });

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "api listening");

function shutdown(signal: "SIGINT" | "SIGTERM"): void {
  logger.info({ signal }, "shutdown requested");
  void server.stop(true);
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
