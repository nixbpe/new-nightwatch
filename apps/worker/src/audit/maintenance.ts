import {
  purgeAuditExports,
  purgeExpiredAuditEvents,
  type Database,
} from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

export const AUDIT_MAINTENANCE_INTERVAL_MS = 60 * 60_000;
export const AUDIT_EVENT_PURGE_LIMIT = 5000;
export const AUDIT_EXPORT_PURGE_LIMIT = 500;
/** The log warns when fewer months than this are ready after the current one. */
export const AUDIT_PARTITION_MONTHS_AHEAD_MIN = 2;

/** `YYYYMM` of the next `count` months after the current UTC month. */
export function auditPartitionSuffixesAhead(
  now: Date,
  count = AUDIT_PARTITION_MONTHS_AHEAD_MIN,
): string[] {
  const suffixes: string[] = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    suffixes.push(
      `${String(month.getUTCFullYear())}${String(month.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return suffixes;
}

/** Hourly: events past 365 days, expired files and old requests, and the partition horizon. */
export async function runAuditMaintenance(
  database: Database,
  logger: Logger,
  now: Date = new Date(),
): Promise<void> {
  try {
    let deleted: number;
    do {
      deleted = await purgeExpiredAuditEvents(database, {
        limit: AUDIT_EVENT_PURGE_LIMIT,
      });
    } while (deleted === AUDIT_EVENT_PURGE_LIMIT);
    await purgeAuditExports(database, { limit: AUDIT_EXPORT_PURGE_LIMIT });
  } catch {
    logger.error({}, "audit retention purge failed");
  }
  try {
    const present = await database.sql.query<{ relname: string }>(
      `select c.relname
       from pg_inherits as i
       join pg_class as c on c.oid = i.inhrelid
       join pg_class as parent on parent.oid = i.inhparent
       where parent.relnamespace = 'public'::regnamespace
         and parent.relname = 'audit_events'`,
    );
    const names = new Set(present.rows.map((row) => row.relname));
    const missing = auditPartitionSuffixesAhead(now)
      .map((suffix) => `audit_events_p${suffix}`)
      .filter((name) => !names.has(name));
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
