/**
 * AC-41 and AC-60 retention, on a throwaway database with API access: expired
 * rows are removed in batches of the requested size, rows younger than 30 days
 * stay, a closed incident goes 30 days after `ended_at`, and an open incident
 * older than 30 days stays. Also lists the partitions the runner created on that
 * fresh database.
 *
 *   (throwaway env) EVIDENCE_OUT=... bun e2e/verification/purge-check.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { SQL } from "bun";

import { resolveDevEnv } from "../../scripts/dev-env.mjs";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  basicConfig,
  createOrganization,
  createPerson,
  monitorPath,
  signInApi,
  targetHostname,
} from "../support/monitor-fixtures";
import { createDatabase } from "../../packages/db/src/index.ts";

const { env } = resolveDevEnv();
if (!env.DATABASE_URL?.includes(":5491/")) {
  throw new Error(
    "purge-check runs only against the throwaway database on port 5491",
  );
}
const owner = createDatabase(env.DATABASE_OWNER_URL!);
const pool = owner.sql;
const runtime = new SQL(env.DATABASE_URL);
const failures: string[] = [];
const evidence: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failures.push(name);
};

const host = targetHostname();
const target = await startMonitorTarget();
const org = await createOrganization(
  pool,
  `Verify purge ${randomUUID().slice(0, 6)}`,
);
const person = await createPerson(pool, "purge", org);
await addMember(pool, org, person.userId, "owner");
try {
  const session = await signInApi(person);
  const created = await session.request("POST", monitorPath(org), {
    ...basicConfig("purge", `http://${host}:${String(target.port)}/health`),
    intervalSeconds: 900,
    clientRequestId: randomUUID(),
  });
  const id = (created.body as { monitor: { id: string } }).monitor.id;
  // Keep the live Worker from adding rows while the counts are taken.
  await pool.query(
    "update monitor_schedule set next_check_at = null where monitor_id = $1",
    [id],
  );

  const insertResult = (daysAgo: number) =>
    pool.query(
      `insert into monitor_check_results
         (monitor_id, tenant_id, scheduled_for, checked_at, outcome, http_status,
          response_time_ms, url_masked, check_config_version, interval_seconds)
       values ($1, $2, now() - ($3 || ' days')::interval, now() - ($3 || ' days')::interval,
               'pass', 200, 10, 'http://example/', 1, 900)`,
      [id, org, String(daysAgo)],
    );
  for (const d of [40, 41, 42, 43, 44])
    await insertResult(d + Math.random() * 0.01);
  for (const d of [1, 10, 20, 29]) await insertResult(d);
  const incident = (startedDays: number, endedDays: number | null) =>
    pool.query(
      `insert into monitor_incidents (monitor_id, tenant_id, started_at, ended_at, start_reason, end_reason)
       values ($1, $2, now() - ($3 || ' days')::interval,
               case when $4::text is null then null else now() - ($4 || ' days')::interval end,
               'http_status', case when $4::text is null then null else 'recovered' end)`,
      [
        id,
        org,
        String(startedDays),
        endedDays === null ? null : String(endedDays),
      ],
    );
  await incident(45, 44); // closed 44 days ago: goes
  await incident(35, 5); // closed 5 days ago although it started 35 days ago: stays
  await incident(50, null); // open, older than 30 days: stays

  const counts = async () => ({
    results: (
      await pool.query(
        "select count(*)::int n from monitor_check_results where monitor_id = $1",
        [id],
      )
    ).rows[0].n as number,
    incidents: (
      await pool.query(
        "select count(*)::int n from monitor_incidents where monitor_id = $1",
        [id],
      )
    ).rows[0].n as number,
    openIncidents: (
      await pool.query(
        "select count(*)::int n from monitor_incidents where monitor_id = $1 and ended_at is null",
        [id],
      )
    ).rows[0].n as number,
  });
  const before = await counts();
  const first = await runtime.unsafe(
    "select purge_expired_monitor_data(2) as n",
  );
  const afterOne = await counts();
  check(
    "AC-60 one purge call with limit 2 removes at most 2 rows",
    first[0].n === 2 && afterOne.results === before.results - 2,
    { first: first[0].n, before, afterOne },
  );
  let guard = 0;
  while (guard++ < 10) {
    const r = await runtime.unsafe("select purge_expired_monitor_data(2) as n");
    if (r[0].n === 0) break;
  }
  const after = await counts();
  evidence.counts = { before, afterOne, after };
  check(
    "AC-41 results older than 30 days are gone, the 4 younger remain",
    after.results === 4,
    after,
  );
  check(
    "AC-41 the incident closed 44 days ago is gone",
    after.incidents === 2,
    after,
  );
  check(
    "AC-41 the open incident older than 30 days and the recently closed one remain",
    after.openIncidents === 1 && after.incidents === 2,
    after,
  );
  const partitions = await pool.query(
    "select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent where p.relname = 'monitor_check_results' order by 1",
  );
  evidence.partitions = partitions.rows.map(
    (r: { relname: string }) => r.relname,
  );
  const months = (evidence.partitions as string[]).map((n) => n.slice(-6));
  check(
    "AC-60 the runner on a fresh database created previous, current and 3 later months",
    months.includes("202608") &&
      months.includes("202609") &&
      months.includes("202612") &&
      months.length >= 5,
    months,
  );
} finally {
  await pool.query('delete from "user" where id = $1', [person.userId]);
  await pool.query("delete from organization where id = $1", [org]);
  await owner.close();
  await runtime.close();
  await target.close();
  writeFileSync(process.env.EVIDENCE_OUT!, JSON.stringify(evidence, null, 2));
}
console.log(`failed: ${String(failures.length)}`);
process.exit(failures.length === 0 ? 0 : 1);
