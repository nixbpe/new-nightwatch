import { createLogger, loadEnv } from "@nightwatch/shared";

import { createApp } from "./app";

// Fail-fast: an invalid environment must not start the server.
const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "nightwatch-api" });
const app = createApp({ env, logger });

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "api listening");

function shutdown(signal: "SIGINT" | "SIGTERM"): void {
  logger.info({ signal }, "shutdown requested");
  void server.stop(true);
  logger.flush();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
