import { createDatabase, failNotificationDispatch } from "@nightwatch/db";
import { createLogger, loadEnv } from "@nightwatch/shared";
import { Worker } from "bullmq";

import {
  createDispatchQueue,
  IN_APP_MATERIALIZE_QUEUE,
  NotificationDispatchScheduler,
  redisConnection,
  startDispatchSchedule,
} from "./dispatch";
import {
  assertMaterializeJobData,
  createMaterializationDependencies,
  processMaterialization,
  type MaterializeJobData,
} from "./materialize";

const env = loadEnv();
const databaseUrl = requireEnvironment("DATABASE_URL");
const redisUrl = requireEnvironment("REDIS_URL");
const logger = createLogger({
  level: env.LOG_LEVEL,
  name: "nightwatch-worker",
});
const database = createDatabase(databaseUrl);
const queue = createDispatchQueue(redisUrl);
const dependencies = createMaterializationDependencies(database);
const worker = new Worker<MaterializeJobData>(
  IN_APP_MATERIALIZE_QUEUE,
  async (job) => {
    assertMaterializeJobData(job.data);
    await processMaterialization(job.data, dependencies);
  },
  { connection: redisConnection(redisUrl), concurrency: 5 },
);

worker.on("failed", (job) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  void failNotificationDispatch(database, {
    id: job.data.dispatchId,
    claimToken: job.data.claimToken,
    reason: "MATERIALIZATION_EXHAUSTED",
  })
    .then((failed) => {
      logger.error(
        {
          dispatchId: job.data.dispatchId,
          failed,
          reason: "MATERIALIZATION_EXHAUSTED",
        },
        "notification materialization exhausted retries",
      );
    })
    .catch(() => {
      logger.error(
        {
          dispatchId: job.data.dispatchId,
          reason: "MATERIALIZATION_EXHAUSTED",
        },
        "notification failure compensation failed",
      );
    });
});

await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
const scheduler = new NotificationDispatchScheduler(database, queue, logger);
const stopSchedule = startDispatchSchedule(scheduler, logger);
logger.info("in-app materialize worker ready");

let stopping = false;
async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker shutdown requested");
  stopSchedule();
  await worker.close();
  await queue.close();
  await database.close();
  logger.flush();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

function requireEnvironment(name: "DATABASE_URL" | "REDIS_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}
