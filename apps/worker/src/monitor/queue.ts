import { createHash } from "node:crypto";

import { Queue } from "bullmq";

import { redisConnection } from "../dispatch";

export const MONITOR_CHECK_QUEUE = "monitor-check";

/** Routing data only: no URL, header or secret (JOB-01, JOB-05). */
export type MonitorCheckJob = {
  tenantId: string;
  monitorId: string;
  claimToken: string;
  checkConfigVersion: number;
  /** ISO 8601 timestamp of the claimed slot. */
  scheduledFor: string;
};

export const MONITOR_CHECK_JOB_OPTIONS = {
  // A retry after the round has passed would record a stale result.
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
};

export type MonitorCheckQueue = Pick<
  Queue<MonitorCheckJob>,
  "add" | "waitUntilReady" | "close"
>;

export function monitorCheckJobId(
  monitorId: string,
  claimToken: string,
): string {
  const digest = createHash("sha256")
    .update(monitorId)
    .update("\0")
    .update(claimToken)
    .digest("hex");
  return `monitor-check-${digest}`;
}

export function createMonitorCheckQueue(
  redisUrl: string,
  options: { prefix?: string } = {},
): Queue<MonitorCheckJob> {
  return new Queue(MONITOR_CHECK_QUEUE, {
    connection: redisConnection(redisUrl),
    prefix: options.prefix,
  });
}
