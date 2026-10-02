#!/usr/bin/env bun
/**
 * Root `db:partitions` wrapper. Calls ensure_monitor_partitions() and
 * ensure_audit_event_partitions() with DATABASE_OWNER_URL only (the runtime
 * role has no EXECUTE, DB-09). Run it
 * after `db:migrate` in every environment and on a schedule (monthly is
 * enough) so partitions exist at least 3 months ahead.
 *
 * The function creates the previous, current and next N month partitions of
 * the monitor result tables and drops partitions older than 31 days. The
 * create or drop needs a lock on the partitioned parent (inferred), so the call
 * runs in one transaction with a lock_timeout: on timeout the transaction
 * rolls back (no partial state), the script exits 1 and a rerun is safe.
 *
 * audit_events (F-007) gets the same previous, current and next N month
 * partitions; its partitions are dropped once their whole range is older than
 * 366 days. A missing audit partition makes every audited mutation fail.
 *
 * Environment: same resolution as `db:migrate` (scripts/dev-env.mjs).
 *   PARTITION_MONTHS_AHEAD  optional, integer 0..12, default 3
 *   PARTITION_LOCK_TIMEOUT_MS  optional, integer 1..30000, default 5000
 */
import { SQL } from "bun";

import { LOCAL_ENV_PATH, resolveDevEnv } from "./dev-env.mjs";

const { env } = resolveDevEnv();

function intFromEnv(name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`[partitions] ${name} must be an integer ${min}..${max}`);
    process.exit(1);
  }
  return value;
}

const monthsAhead = intFromEnv("PARTITION_MONTHS_AHEAD", 3, 0, 12);
const lockTimeoutMs = intFromEnv("PARTITION_LOCK_TIMEOUT_MS", 5000, 1, 30000);

const url = env.DATABASE_OWNER_URL;
if (!url) {
  console.error(
    "[partitions] DATABASE_OWNER_URL is required: run `bun run db:up` first " +
      `(generates ${LOCAL_ENV_PATH}) or export DATABASE_OWNER_URL`,
  );
  process.exit(1);
}

const sql = new SQL(url, { max: 1, connectionTimeout: 10 });
let exitCode = 0;
try {
  await sql.begin(async (tx) => {
    // Numbers are validated integers above; SET does not accept parameters.
    await tx.unsafe(`set local lock_timeout = ${lockTimeoutMs}`);
    await tx`select ensure_monitor_partitions(${monthsAhead})`;
    await tx`select ensure_audit_event_partitions(${monthsAhead})`;
  });
  console.log(`[partitions] ok: months ahead ${monthsAhead}`);
  try {
    const rows = await sql`
      select c.relname as name
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
      where p.relname in ('monitor_check_results', 'monitor_check_hourly', 'audit_events')
      order by c.relname`;
    console.log(
      `[partitions] ${rows.length} partitions: ` +
        rows.map((r) => r.name).join(", "),
    );
  } catch (error) {
    // Partitions are already committed; only the listing failed.
    console.warn(
      `[partitions] partitions committed; listing skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
} catch (error) {
  exitCode = 1;
  if (error?.errno === "55P03") {
    console.error(
      `[partitions] lock timeout after ${lockTimeoutMs} ms; transaction rolled back, nothing changed. ` +
        "Rerun at low traffic; keep the timeout short.",
    );
  } else {
    console.error(
      `[partitions] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
} finally {
  await sql.close();
}
process.exit(exitCode);
