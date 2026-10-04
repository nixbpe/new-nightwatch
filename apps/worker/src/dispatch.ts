import { createHash, randomUUID } from "node:crypto";

import {
  claimNotificationDispatches,
  failNotificationDispatch,
  failStaleAuditExports,
  findStaleAuditExports,
  markNotificationDispatchEnqueued,
  purgeExpiredNotificationInboxItems,
  requeueStaleNotificationDispatches,
  withTenantUserContextRaw,
  type Database,
  type NotificationDispatchClaim,
  type NotificationDispatchFailureReason,
} from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";
import { Queue, type ConnectionOptions } from "bullmq";

import type { MaterializeJobData, NotificationScope } from "./materialize";

export const IN_APP_MATERIALIZE_QUEUE = "in-app-materialize";
export const DISPATCH_BATCH_SIZE = 10;
export const DISPATCH_INTERVAL_MS = 60_000;
export const DISPATCH_CLAIM_LEASE_MS = 5 * 60_000;
export const STALE_AUDIT_EXPORT_SWEEP_LIMIT = 50;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
};

export type DispatchQueue = Pick<
  Queue<MaterializeJobData>,
  "add" | "waitUntilReady" | "close"
>;

export class NotificationDispatchScheduler {
  #running = false;

  constructor(
    private readonly database: Database,
    private readonly queue: DispatchQueue,
    private readonly logger: Logger,
  ) {}

  async dispatch(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      await purgeExpiredNotificationInboxItems(this.database, {
        limit: DISPATCH_BATCH_SIZE,
      });
      await requeueStaleNotificationDispatches(this.database, {
        claimedBefore: new Date(Date.now() - DISPATCH_CLAIM_LEASE_MS),
        limit: DISPATCH_BATCH_SIZE,
      });
      const claimToken = randomUUID();
      const claims = await claimNotificationDispatches(this.database, {
        claimToken,
        limit: DISPATCH_BATCH_SIZE,
      });
      for (const claim of claims) {
        await this.enqueueClaim(claim, claimToken);
      }
    } finally {
      // After the dispatch steps, whatever they did: an export stuck as
      // generating is failed even while the audit-exporter role is down.
      await this.sweepStaleAuditExports();
      this.#running = false;
    }
  }

  /**
   * Fails the audit exports that outlived `audit_export_deadline()`, one
   * transaction per request with its failure notification (P-08). Never
   * throws: a fault here is logged and the next cycle tries again.
   */
  async sweepStaleAuditExports(): Promise<void> {
    try {
      const stale = await findStaleAuditExports(this.database, {
        limit: STALE_AUDIT_EXPORT_SWEEP_LIMIT,
      });
      for (const row of stale) {
        try {
          await withTenantUserContextRaw(
            this.database,
            row.tenantId,
            row.requestedBy,
            (client) =>
              failStaleAuditExports(client, {
                tenantId: row.tenantId,
                requestedBy: row.requestedBy,
                exportId: row.exportId,
              }),
          );
        } catch {
          this.logger.error(
            { exportId: row.exportId },
            "stale audit export sweep failed for a request",
          );
        }
      }
    } catch {
      this.logger.error({}, "stale audit export sweep failed");
    }
  }

  private async enqueueClaim(
    claim: NotificationDispatchClaim,
    claimToken: string,
  ): Promise<void> {
    const scope = claimScope(claim);
    if (!scope) {
      await this.recordFailure(claim.id, claimToken, "INVALID_SCOPE");
      this.logger.error(
        { dispatchId: claim.id, reason: "INVALID_SCOPE" },
        "invalid notification dispatch scope",
      );
      return;
    }
    try {
      await this.queue.add(
        "materialize",
        { dispatchId: claim.id, claimToken, scope },
        { ...JOB_OPTIONS, jobId: dispatchJobId(claim.id, claimToken) },
      );
    } catch {
      await this.recordFailure(claim.id, claimToken, "QUEUE_ADD_FAILED");
      this.logger.error(
        { dispatchId: claim.id, reason: "QUEUE_ADD_FAILED" },
        "notification dispatch enqueue failed",
      );
      return;
    }

    try {
      const marked = await markNotificationDispatchEnqueued(this.database, {
        id: claim.id,
        claimToken,
      });
      if (!marked) {
        throw new Error("notification dispatch enqueue acknowledgement failed");
      }
    } catch {
      await this.recordFailure(claim.id, claimToken, "QUEUE_ACK_FAILED");
      this.logger.error(
        { dispatchId: claim.id, reason: "QUEUE_ACK_FAILED" },
        "notification dispatch enqueue acknowledgement failed",
      );
    }
  }

  private async recordFailure(
    id: string,
    claimToken: string,
    reason: NotificationDispatchFailureReason,
  ): Promise<void> {
    try {
      const failed = await failNotificationDispatch(this.database, {
        id,
        claimToken,
        reason,
      });
      if (!failed) {
        this.logger.error(
          { dispatchId: id, reason },
          "notification dispatch failure compensation did not apply",
        );
      }
    } catch {
      this.logger.error(
        { dispatchId: id, reason },
        "notification dispatch failure compensation failed",
      );
    }
  }
}

export function createDispatchQueue(
  redisUrl: string,
  options: { prefix?: string } = {},
): Queue<MaterializeJobData> {
  return new Queue(IN_APP_MATERIALIZE_QUEUE, {
    connection: redisConnection(redisUrl),
    prefix: options.prefix,
  });
}

export function startDispatchSchedule(
  scheduler: NotificationDispatchScheduler,
  logger: Logger,
): () => void {
  const run = () => {
    void scheduler.dispatch().catch(() => {
      logger.error({}, "notification dispatcher cycle failed");
    });
  };
  run();
  const timer = setInterval(run, DISPATCH_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}

export function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss");
  }
  const database =
    url.pathname === "" || url.pathname === "/"
      ? 0
      : Number(url.pathname.slice(1));
  if (!Number.isInteger(database) || database < 0) {
    throw new Error("REDIS_URL database must be a non-negative integer");
  }
  return {
    host: url.hostname,
    port: url.port === "" ? 6379 : Number(url.port),
    username:
      url.username === "" ? undefined : decodeURIComponent(url.username),
    password:
      url.password === "" ? undefined : decodeURIComponent(url.password),
    db: database,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export function dispatchJobId(dispatchId: string, claimToken: string): string {
  const digest = createHash("sha256")
    .update(dispatchId)
    .update("\0")
    .update(claimToken)
    .digest("hex");
  return `dispatch-${digest}`;
}

function claimScope(
  claim: NotificationDispatchClaim,
): NotificationScope | null {
  if (
    claim.scopeKind === "account" &&
    claim.tenantId === null &&
    claim.userId
  ) {
    return { kind: "account", userId: claim.userId };
  }
  if (claim.scopeKind === "tenant" && claim.userId === null && claim.tenantId) {
    return { kind: "tenant", tenantId: claim.tenantId };
  }
  return null;
}
