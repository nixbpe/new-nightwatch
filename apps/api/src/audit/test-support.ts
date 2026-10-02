import type { Client } from "pg";

function partitionName(month: Date): string {
  const year = month.getUTCFullYear();
  const number = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `audit_events_p${String(year)}${number}`;
}

/**
 * Creates the `audit_events` partition holding `at` (UTC month) with the
 * owner connection, so a test can seed events older than the months
 * `ensure_audit_event_partitions` creates. Returns the partition name and
 * whether this call created it; drop only what you created.
 *
 * Creating or dropping a partition locks the parent table. Call it only on a
 * database no other suite writes to.
 */
export async function createAuditPartitionFor(
  owner: Client,
  at: Date,
): Promise<{ name: string; created: boolean }> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const name = partitionName(start);
  const exists = await owner.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${name}`],
  );
  if (exists.rows[0]?.present) return { name, created: false };
  await owner.query(
    `create table public.${name} partition of public.audit_events
       for values from ('${start.toISOString()}') to ('${end.toISOString()}')`,
  );
  await owner.query(`alter table public.${name} enable row level security`);
  await owner.query(`alter table public.${name} force row level security`);
  return { name, created: true };
}

export async function dropAuditPartition(
  owner: Client,
  name: string,
): Promise<void> {
  if (!/^audit_events_p\d{6}$/.test(name)) {
    throw new Error(`refusing to drop ${name}: not an audit partition`);
  }
  await owner.query(`drop table if exists public.${name}`);
}
