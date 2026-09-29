import {
  claimDueMonitorChecks,
  purgeExpiredMonitorData,
  type Database,
  type MonitorCheckClaim,
} from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

import {
  MONITOR_CHECK_JOB_OPTIONS,
  monitorCheckJobId,
  type MonitorCheckJob,
  type MonitorCheckQueue,
} from "./queue";

export const MONITOR_SCHEDULER_INTERVAL_MS = 10_000;
export const MONITOR_CLAIM_BATCH_SIZE = 10;
export const MONITOR_MAX_BATCHES_PER_ROUND = 50;
export const MONITOR_PURGE_LIMIT = 500;
export const MONITOR_PARTITION_MONTHS_AHEAD_MIN = 2;

const ENQUEUE_TIMEOUT_MS = 5_000;
const PARTITION_CHECK_INTERVAL_MS = 60 * 60_000;
const PARTITIONED_TABLES = ["monitor_check_results", "monitor_check_hourly"];

export type MonitorSchedulerOptions = {
  /** Test seam; production uses the wall clock. */
  now?: () => Date;
  enqueueTimeoutMs?: number;
};

export class MonitorScheduler {
  #running: Promise<void> | null = null;
  #lastPartitionCheck: number | null = null;
  readonly #now: () => Date;
  readonly #enqueueTimeoutMs: number;

  constructor(
    private readonly database: Database,
    private readonly queue: MonitorCheckQueue,
    private readonly logger: Logger,
    options: MonitorSchedulerOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#enqueueTimeoutMs = options.enqueueTimeoutMs ?? ENQUEUE_TIMEOUT_MS;
  }

  /** Runs one round; a round that is still in flight makes this a no-op. */
  round(): Promise<void> {
    if (this.#running) return Promise.resolve();
    const running = this.#round().finally(() => {
      this.#running = null;
    });
    this.#running = running;
    return running;
  }

  /** Resolves once the in-flight round, if any, has finished. */
  async idle(): Promise<void> {
    await this.#running;
  }

  async #round(): Promise<void> {
    await this.#guard("partition check failed", () => this.#checkPartitions());
    await this.#guard("monitor claim round failed", () => this.#claimRound());
    await this.#guard("monitor purge failed", async () => {
      await purgeExpiredMonitorData(this.database, {
        limit: MONITOR_PURGE_LIMIT,
      });
    });
  }

  async #guard(message: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      // Messages can carry connection strings; log only the error name.
      this.logger.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        message,
      );
    }
  }

  async #claimRound(): Promise<void> {
    for (let batch = 0; batch < MONITOR_MAX_BATCHES_PER_ROUND; batch += 1) {
      // Each claim commits before any enqueue: no transaction spans Redis.
      const claims = await claimDueMonitorChecks(this.database, {
        limit: MONITOR_CLAIM_BATCH_SIZE,
      });
      for (const claim of claims) {
        // Redis is unavailable: stop claiming. The rest of this batch
        // keeps its lease and is claimed again once the lease expires.
        if (!(await this.#enqueue(claim))) return;
      }
      if (claims.length < MONITOR_CLAIM_BATCH_SIZE) return;
    }
  }

  async #enqueue(claim: MonitorCheckClaim): Promise<boolean> {
    const job: MonitorCheckJob = {
      tenantId: claim.tenantId,
      monitorId: claim.monitorId,
      claimToken: claim.claimToken,
      checkConfigVersion: claim.checkConfigVersion,
      scheduledFor: claim.scheduledFor.toISOString(),
    };
    try {
      await withTimeout(
        this.queue.add("check", job, {
          ...MONITOR_CHECK_JOB_OPTIONS,
          jobId: monitorCheckJobId(claim.monitorId, claim.claimToken),
        }),
        this.#enqueueTimeoutMs,
      );
      return true;
    } catch {
      // The lease expires and a later round claims the monitor again.
      this.logger.error(
        { monitorId: claim.monitorId, tenantId: claim.tenantId },
        "monitor check enqueue failed",
      );
      return false;
    }
  }

  async #checkPartitions(): Promise<void> {
    const now = this.#now();
    if (
      this.#lastPartitionCheck !== null &&
      now.getTime() - this.#lastPartitionCheck < PARTITION_CHECK_INTERVAL_MS
    ) {
      return;
    }
    const result = await this.database.sql.query<{ relname: string }>(
      `select c.relname
       from pg_inherits as i
       join pg_class as c on c.oid = i.inhrelid
       join pg_class as parent on parent.oid = i.inhparent
       where parent.relnamespace = 'public'::regnamespace
         and parent.relname = any($1::text[])`,
      [PARTITIONED_TABLES],
    );
    this.#lastPartitionCheck = now.getTime();
    const present = new Set(result.rows.map((row) => row.relname));
    const missing = PARTITIONED_TABLES.flatMap((table) =>
      aheadSuffixes(now).flatMap((suffix) =>
        present.has(`${table}_p${suffix}`) ? [] : [`${table}_p${suffix}`],
      ),
    );
    if (missing.length > 0) {
      this.logger.warn(
        { missing, monthsAheadRequired: MONITOR_PARTITION_MONTHS_AHEAD_MIN },
        "monitor partitions ahead are below the required horizon; run db:partitions",
      );
    }
  }
}

/** `YYYYMM` of the next MIN months after the current UTC month. */
export function aheadSuffixes(now: Date): string[] {
  const suffixes: string[] = [];
  for (let offset = 1; offset <= MONITOR_PARTITION_MONTHS_AHEAD_MIN; offset++) {
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    suffixes.push(
      `${String(month.getUTCFullYear())}${String(month.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return suffixes;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timed out"));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export type MonitorScheduleHandle = { stop(): Promise<void> };

/** Interval is injectable for tests only; production uses the 10 s constant. */
export function startMonitorSchedule(
  scheduler: Pick<MonitorScheduler, "round" | "idle">,
  logger: Logger,
  intervalMs: number = MONITOR_SCHEDULER_INTERVAL_MS,
): MonitorScheduleHandle {
  const run = () => {
    void scheduler.round().catch(() => {
      logger.error({}, "monitor scheduler round failed");
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await scheduler.idle();
    },
  };
}
