import type { Database } from "./client";

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
