import type { PoolClient } from "pg";

import type { Database } from "./client";
import { insertAuditExportNotificationIntent } from "./notification";

/** Owner-role only (DB-09): the runtime role has no EXECUTE on this function. */
export async function ensureAuditEventPartitions(
  ownerDatabase: Database,
  input: { monthsAhead: number },
): Promise<void> {
  const { monthsAhead } = input;
  if (!Number.isInteger(monthsAhead) || monthsAhead < 0 || monthsAhead > 12) {
    throw new Error("monthsAhead must be an integer between 0 and 12");
  }
  await ownerDatabase.sql.query("select ensure_audit_event_partitions($1)", [
    monthsAhead,
  ]);
}

export type AuditExportClaim = {
  exportId: string;
  tenantId: string;
  requestedBy: string;
  claimToken: string;
  /** Fourth claim, or past minute 50 of the 60-minute request lifetime. */
  exhausted: boolean;
};

/** Claims at most one queued request, or a running one whose lease ran out. */
export async function claimAuditExport(
  database: Database,
): Promise<AuditExportClaim | null> {
  const result = await database.sql.query<{
    export_id: string;
    tenant_id: string;
    requested_by: string;
    claim_token: string;
    exhausted: boolean;
  }>("select * from claim_audit_export()");
  const row = result.rows[0];
  return row
    ? {
        exportId: row.export_id,
        tenantId: row.tenant_id,
        requestedBy: row.requested_by,
        claimToken: row.claim_token,
        exhausted: row.exhausted,
      }
    : null;
}

/** In-flight requests past `audit_export_deadline()`; read-only. */
export async function findStaleAuditExports(
  database: Database,
  input: { limit: number },
): Promise<{ exportId: string; tenantId: string; requestedBy: string }[]> {
  const result = await database.sql.query<{
    export_id: string;
    tenant_id: string;
    requested_by: string;
  }>("select * from find_stale_audit_exports($1)", [input.limit]);
  return result.rows.map((row) => ({
    exportId: row.export_id,
    tenantId: row.tenant_id,
    requestedBy: row.requested_by,
  }));
}

/**
 * Fails the requester's in-flight requests that outlived the deadline, with
 * the failure notification in the same transaction. Call it on a client whose
 * transaction already holds `app.tenant_id` and `app.user_id`; `exportId`
 * narrows it to one request (the scheduler's per-row sweep). Idempotent: a row
 * that is no longer in flight, or not yet late, is left alone.
 */
export async function failStaleAuditExports(
  client: Pick<PoolClient, "query">,
  input: { tenantId: string; requestedBy: string; exportId?: string },
): Promise<string[]> {
  const stale = await client.query<{ export_id: string }>(
    `update audit_export_jobs set state = 'failed'
     where tenant_id = $1 and requested_by = $2
       and ($3::uuid is null or export_id = $3::uuid)
       and state in ('queued', 'running')
       and now() >= audit_export_deadline(created_at)
     returning export_id`,
    [input.tenantId, input.requestedBy, input.exportId ?? null],
  );
  for (const { export_id: exportId } of stale.rows) {
    await client.query(
      `update audit_exports
       set failure_code = 'EXPORT_FAILED', completed_at = now()
       where id = $1`,
      [exportId],
    );
    await insertAuditExportNotificationIntent(client, {
      tenantId: input.tenantId,
      exportId,
      requesterUserId: input.requestedBy,
      outcome: "failed",
    });
  }
  return stale.rows.map((row) => row.export_id);
}

/** Deletes at most `limit` events past the 365-day cutoff; returns the count. */
export async function purgeExpiredAuditEvents(
  database: Database,
  input: { limit: number },
): Promise<number> {
  const result = await database.sql.query<{ deleted: number }>(
    "select purge_expired_audit_events($1) as deleted",
    [input.limit],
  );
  return result.rows[0]?.deleted ?? 0;
}

/** Clears expired files and deletes requests older than 7 days. */
export async function purgeAuditExports(
  database: Database,
  input: { limit: number },
): Promise<number> {
  const result = await database.sql.query<{ purged: number }>(
    "select purge_audit_exports($1) as purged",
    [input.limit],
  );
  return result.rows[0]?.purged ?? 0;
}
