import type { Database } from "./client";

export type MonitorCheckClaim = {
  monitorId: string;
  tenantId: string;
  claimToken: string;
  checkConfigVersion: number;
  scheduledFor: Date;
};

/** Claims up to `limit` due monitors across Organizations (bounded 1..100). */
export async function claimDueMonitorChecks(
  database: Database,
  input: { limit: number },
): Promise<MonitorCheckClaim[]> {
  assertBoundedInteger(input.limit, 1, 100, "claim limit");
  const result = await database.sql.query<{
    monitor_id: string;
    tenant_id: string;
    claim_token: string;
    check_config_version: number;
    scheduled_for: Date;
  }>("select * from claim_due_monitor_checks($1)", [input.limit]);
  return result.rows.map((row) => ({
    monitorId: row.monitor_id,
    tenantId: row.tenant_id,
    claimToken: row.claim_token,
    checkConfigVersion: row.check_config_version,
    scheduledFor: row.scheduled_for,
  }));
}

/** Deletes at most `limit` rows past the 30-day retention; returns the count. */
export async function purgeExpiredMonitorData(
  database: Database,
  input: { limit: number },
): Promise<number> {
  assertBoundedInteger(input.limit, 1, 1000, "purge limit");
  const result = await database.sql.query<{ deleted: number }>(
    "select purge_expired_monitor_data($1) as deleted",
    [input.limit],
  );
  return result.rows[0]?.deleted ?? 0;
}

/** Owner-role only (DB-09): the runtime role has no EXECUTE on this function. */
export async function ensureMonitorPartitions(
  ownerDatabase: Database,
  input: { monthsAhead: number },
): Promise<void> {
  assertBoundedInteger(input.monthsAhead, 0, 12, "monthsAhead");
  await ownerDatabase.sql.query("select ensure_monitor_partitions($1)", [
    input.monthsAhead,
  ]);
}

function assertBoundedInteger(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${label} must be an integer between ${String(min)} and ${String(max)}`,
    );
  }
}
