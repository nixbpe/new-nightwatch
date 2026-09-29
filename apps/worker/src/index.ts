import { createDatabase, failNotificationDispatch } from "@nightwatch/db";
import {
  createLogger,
  loadEnv,
  loadMonitorEnv,
  type MonitorEnv,
} from "@nightwatch/shared";
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
import { assertMonitorCheckJob, processMonitorCheck } from "./monitor/checker";
import { createEgressCanary } from "./monitor/egress-canary";
import {
  createMonitorCheckQueue,
  MONITOR_CHECK_QUEUE,
  type MonitorCheckJob,
} from "./monitor/queue";
import { MonitorScheduler, startMonitorSchedule } from "./monitor/scheduler";
import { armHardDeadline, closeWithin } from "./shutdown";

const WORKER_ROLES = [
  "consumer",
  "scheduler",
  "monitor-scheduler",
  "monitor-checker",
] as const;
type WorkerRole = (typeof WORKER_ROLES)[number];

// Inside the 30 s shutdown budget of the spec.
const SHUTDOWN_DEADLINE_MS = 25_000;
// Checks still running after this long are abandoned; their results become gaps.
const CHECKER_DRAIN_MS = 15_000;
const CHECKER_CLOSE_MS = 18_000;
const checkerShutdown = new AbortController();

const env = loadEnv();
const databaseUrl = requireEnvironment("DATABASE_URL");
const logger = createLogger({
  level: env.LOG_LEVEL,
  name: "nightwatch-worker",
});
const roles = workerRoles(process.env.WORKER_ROLES);
const monitorEnv =
  roles.has("monitor-scheduler") || roles.has("monitor-checker")
    ? loadMonitorEnv()
    : null;
const redisUrl = monitorEnv?.REDIS_URL ?? requireEnvironment("REDIS_URL");
const database = createDatabase(databaseUrl);

const worker = roles.has("consumer") ? startConsumer() : null;
const monitorChecker =
  monitorEnv && roles.has("monitor-checker")
    ? startMonitorChecker(monitorEnv)
    : null;
const queue = roles.has("scheduler") ? createDispatchQueue(redisUrl) : null;
const monitorQueue = roles.has("monitor-scheduler")
  ? createMonitorCheckQueue(redisUrl)
  : null;
await Promise.all([
  queue?.waitUntilReady(),
  worker?.waitUntilReady(),
  monitorChecker?.waitUntilReady(),
  monitorQueue?.waitUntilReady(),
]);
const stopSchedule = queue
  ? startDispatchSchedule(
      new NotificationDispatchScheduler(database, queue, logger),
      logger,
    )
  : null;
const monitorSchedule = monitorQueue
  ? startMonitorSchedule(
      new MonitorScheduler(database, monitorQueue, logger),
      logger,
    )
  : null;
let stopping = false;
async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  armHardDeadline(SHUTDOWN_DEADLINE_MS, logger);
  logger.info({ signal }, "worker shutdown requested");
  // The monitor scheduler stops first so no claim is made while closing.
  await monitorSchedule?.stop();
  if (monitorSchedule) logger.info({}, "monitor scheduler stopped");
  stopSchedule?.();
  if (monitorChecker) {
    const abort = setTimeout(() => {
      checkerShutdown.abort();
    }, CHECKER_DRAIN_MS);
    await closeWithin(monitorChecker, CHECKER_CLOSE_MS);
    clearTimeout(abort);
  }
  if (worker) await closeWithin(worker);
  if (queue) await closeWithin(queue);
  if (monitorQueue) await closeWithin(monitorQueue);
  await database.close();
  logger.flush();
  // Abandoned requests would keep the event loop alive until their own timeout.
  if (checkerShutdown.signal.aborted) process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Handlers are registered before this line, so a signal sent once the ready
// line is visible always runs the graceful shutdown.
// e2e and the quality README wait for the in-app line; keep it for those roles.
logger.info(
  { roles: [...roles] },
  worker || queue ? "in-app materialize worker ready" : "monitor worker ready",
);

function requireEnvironment(name: "DATABASE_URL" | "REDIS_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function workerRoles(value: string | undefined): Set<WorkerRole> {
  const roles = new Set<WorkerRole>();
  for (const token of (value ?? "consumer").split(",")) {
    const role = token.trim();
    const known = WORKER_ROLES.find((candidate) => candidate === role);
    if (!known) {
      throw new Error(`WORKER_ROLES has unknown role: ${role}`);
    }
    roles.add(known);
  }
  return roles;
}

function startMonitorChecker(monitor: MonitorEnv): Worker<MonitorCheckJob> {
  const dependencies = {
    database,
    credentialEnv: monitor,
    logger,
    outbound: { testAllowedHosts: monitor.OUTBOUND_TEST_ALLOWED_HOSTS },
    canary: createEgressCanary({
      urls: monitor.MONITOR_EGRESS_CANARY_URLS,
      outbound: { testAllowedHosts: monitor.OUTBOUND_TEST_ALLOWED_HOSTS },
    }),
    signal: checkerShutdown.signal,
  };
  // attempts is 1: a failed job is logged and never retried.
  const checker = new Worker<MonitorCheckJob>(
    MONITOR_CHECK_QUEUE,
    async (job) => {
      assertMonitorCheckJob(job.data);
      await processMonitorCheck(job.data, dependencies);
    },
    { connection: redisConnection(redisUrl), concurrency: 20 },
  );
  checker.on("failed", (job) => {
    logger.error(
      { tenantId: job?.data.tenantId, monitorId: job?.data.monitorId },
      "monitor check job failed",
    );
  });
  return checker;
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
