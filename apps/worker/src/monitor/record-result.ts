import { withTenantContextRaw, type Database } from "@nightwatch/db";
import type { CheckResult } from "@nightwatch/shared";

/** The transaction handle of `withTenantContextRaw`. */
export type TenantClient = Parameters<
  Parameters<typeof withTenantContextRaw>[2]
>[0];

export type RecordInput = {
  tenantId: string;
  monitorId: string;
  claimToken: string;
  checkConfigVersion: number;
  scheduledFor: Date;
  /** Interval that applied when the check ran. */
  intervalSeconds: number;
  result: CheckResult;
};

export type RecordOutcome = "recorded" | "discarded" | "duplicate";

/**
 * Transaction B of a check. A result is kept only while the claim that
 * produced it is still the monitor's current one: Pause, Delete and an Edit
 * that affects checks clear or replace it, and the late result is dropped.
 *
 * Lock order (Concurrency): organization FOR SHARE, monitors FOR UPDATE,
 * monitor_schedule, monitor_incidents.
 */
export async function recordCheckResult(
  database: Database,
  input: RecordInput,
): Promise<RecordOutcome> {
  return withTenantContextRaw(database, input.tenantId, async (client) => {
    await client.query("select id from organization where id = $1 for share", [
      input.tenantId,
    ]);
    const monitor = await client.query(
      "select id from monitors where id = $1 and tenant_id = $2 for update",
      [input.monitorId, input.tenantId],
    );
    if (monitor.rows.length === 0) return "discarded";

    const claim = await client.query(
      `update monitor_schedule set claim_token = null
       where monitor_id = $1 and claim_token = $2 and check_config_version = $3`,
      [input.monitorId, input.claimToken, input.checkConfigVersion],
    );
    if (claim.rowCount === 0) return "discarded";

    const inserted = await insertResult(client, input);
    if (!inserted) return "duplicate";
    return "recorded";
  });
}

async function insertResult(
  client: TenantClient,
  input: RecordInput,
): Promise<boolean> {
  const { result } = input;
  const inserted = await client.query(
    `insert into monitor_check_results
       (monitor_id, tenant_id, scheduled_for, checked_at, outcome, http_status,
        response_time_ms, failure_reason, tls_reason, assertions, url_masked,
        check_config_version, interval_seconds, evaluated_from_prefix)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
     on conflict (monitor_id, scheduled_for) do nothing`,
    [
      input.monitorId,
      input.tenantId,
      input.scheduledFor,
      result.checkedAt,
      result.outcome,
      result.httpStatus,
      result.responseTimeMs === null ? null : Math.round(result.responseTimeMs),
      result.failureReason,
      result.tlsReason,
      JSON.stringify(result.assertions),
      result.url,
      input.checkConfigVersion,
      input.intervalSeconds,
      result.evaluatedFromPrefix,
    ],
  );
  return inserted.rowCount === 1;
}
