import {
  purgeAuditExports,
  purgeExpiredAuditEvents,
  type Database,
} from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

import { missingPartitionNames } from "../partition-horizon";

export const AUDIT_MAINTENANCE_INTERVAL_MS = 60 * 60_000;
export const AUDIT_EVENT_PURGE_LIMIT = 5000;
export const AUDIT_EXPORT_PURGE_LIMIT = 500;
/** The log warns when fewer months than this are ready after the current one. */
export const AUDIT_PARTITION_MONTHS_AHEAD_MIN = 2;

export const AUDIT_PURGE_MAX_BATCHES_PER_RUN = 100;

async function drain(
  logger: Logger,
  what: string,
  limit: number,
  purge: () => Promise<number>,
): Promise<void> {
  for (let batch = 1; batch <= AUDIT_PURGE_MAX_BATCHES_PER_RUN; batch += 1) {
    if ((await purge()) < limit) return;
  }
  logger.warn(
    { what, batches: AUDIT_PURGE_MAX_BATCHES_PER_RUN },
    "audit purge stopped at the batch guard; the rest is left for the next run",
  );
}

/** Hourly: events past 365 days, expired files and old requests, and the partition horizon. */
export async function runAuditMaintenance(
  database: Database,
  logger: Logger,
  now: Date = new Date(),
): Promise<void> {
  try {
    await drain(logger, "audit events", AUDIT_EVENT_PURGE_LIMIT, () =>
      purgeExpiredAuditEvents(database, { limit: AUDIT_EVENT_PURGE_LIMIT }),
    );
    await drain(logger, "audit exports", AUDIT_EXPORT_PURGE_LIMIT, () =>
      purgeAuditExports(database, { limit: AUDIT_EXPORT_PURGE_LIMIT }),
    );
  } catch {
    logger.error({}, "audit retention purge failed");
  }
  try {
    const missing = await missingPartitionNames(
      database,
      ["audit_events"],
      now,
      AUDIT_PARTITION_MONTHS_AHEAD_MIN,
    );
    if (missing.length > 0) {
      logger.warn(
        { missing, monthsAheadRequired: AUDIT_PARTITION_MONTHS_AHEAD_MIN },
        "audit_events partitions ahead are below the required horizon; run db:partitions",
      );
    }
  } catch {
    logger.error({}, "audit partition check failed");
  }
}

export function startAuditMaintenance(
  database: Database,
  logger: Logger,
): () => void {
  const run = () => {
    void runAuditMaintenance(database, logger);
  };
  run();
  const timer = setInterval(run, AUDIT_MAINTENANCE_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}
