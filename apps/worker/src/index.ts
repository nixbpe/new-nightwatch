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
const roles = workerRoles(process.env.WORKER_ROLES);
const database = createDatabase(databaseUrl);

const worker = roles.has("consumer") ? startConsumer() : null;
const queue = roles.has("scheduler") ? createDispatchQueue(redisUrl) : null;
await Promise.all([queue?.waitUntilReady(), worker?.waitUntilReady()]);
const stopSchedule = queue
  ? startDispatchSchedule(
      new NotificationDispatchScheduler(database, queue, logger),
      logger,
    )
  : null;
logger.info({ roles: [...roles] }, "in-app materialize worker ready");

let stopping = false;
async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker shutdown requested");
  stopSchedule?.();
  await worker?.close();
  await queue?.close();
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

/**
 * Roles are selected explicitly. The default starts only the main
 * consumer; a combined consumer+scheduler process must opt in.
 */
function workerRoles(value: string | undefined): Set<"consumer" | "scheduler"> {
  const roles = new Set<"consumer" | "scheduler">();
  for (const token of (value ?? "consumer").split(",")) {
    const role = token.trim();
    if (role !== "consumer" && role !== "scheduler") {
      throw new Error(`WORKER_ROLES has unknown role: ${role}`);
    }
    roles.add(role);
  }
  return roles;
}

function startConsumer(): Worker<MaterializeJobData> {
  const dependencies = createMaterializationDependencies(database);
  const consumer = new Worker<MaterializeJobData>(
    IN_APP_MATERIALIZE_QUEUE,
    async (job) => {
      assertMaterializeJobData(job.data);
      await processMaterialization(job.data, dependencies);
    },
    { connection: redisConnection(redisUrl), concurrency: 5 },
  );

  consumer.on("failed", (job) => {
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
          failed
            ? "notification materialization exhausted retries"
            : "notification materialization exhausted before enqueue acknowledgement; left for stale-claim recovery",
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
  return consumer;
}
