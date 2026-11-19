import type { Database } from "@nightwatch/db";
import { openTestPostgres } from "@nightwatch/db/testing";

export async function openIsolatedDatabase(): Promise<{
  database: Database;
  owner: Database;
  close: () => Promise<void>;
}> {
  const fixture = await openTestPostgres("audit-worker");
  return {
    database: fixture.runtime,
    owner: fixture.owner,
    close: () => fixture.close(),
  };
}

export async function ensureAuditPartitionFor(
  owner: Database,
  at: Date,
): Promise<void> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const name = `audit_events_p${String(start.getUTCFullYear())}${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  const exists = await owner.sql.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [`public.${name}`],
  );
  if (exists.rows[0]?.present) return;
  await owner.sql.query(
    `create table public.${name} partition of public.audit_events
       for values from ('${start.toISOString()}') to ('${end.toISOString()}')`,
  );
  await owner.sql.query(`alter table public.${name} enable row level security`);
  await owner.sql.query(`alter table public.${name} force row level security`);
}
