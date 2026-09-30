/**
 * AC-37 and AC-60 on the running stack database: a Worker that is stopped with
 * SIGTERM or killed in the middle of a check leaves no half-written state, no
 * duplicate result and no incident, and two Workers never produce two results
 * for one round. The caller stops the stack's own Worker first so only the
 * Workers started here claim monitors; it restarts it afterwards.
 *
 *   WORKER_LOG_DIR=... EVIDENCE_OUT=... OUTBOUND_TEST_ALLOWED_HOSTS=<host> \
 *   bun e2e/verification/worker-restart.ts
 */
import { randomUUID } from "node:crypto";
import { openSync, writeFileSync } from "node:fs";

import { createDatabase } from "../../packages/db/src/index.ts";
import { resolveDevEnv } from "../../scripts/dev-env.mjs";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  monitorPath,
  signInApi,
  targetHostname,
} from "../support/monitor-fixtures";

const { env } = resolveDevEnv();
const logDir = process.env.WORKER_LOG_DIR!;
const host = targetHostname();
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const evidence: Record<string, unknown> = {};
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
  evidence.checks ??= [] as unknown[];
  (evidence.checks as unknown[]).push({ name, ok, detail });
  if (!ok) failures.push(name);
};

let counter = 0;
const logPaths = new Map<object, string>();
function startWorker(label: string) {
  const logPath = `${logDir}/worker-restart-${label}-${String(counter++)}.log`;
  const out = openSync(logPath, "a");
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: `${import.meta.dir}/../../apps/worker`,
    env: {
      ...process.env,
      ...env,
      WORKER_ROLES: "monitor-scheduler,monitor-checker",
      OUTBOUND_TEST_ALLOWED_HOSTS: host,
    },
    stdout: out,
    stderr: out,
    stdin: "ignore",
  });
  logPaths.set(proc, logPath);
  return proc;
}

async function results(monitorId: string) {
  return (
    await pool.query(
      "select scheduled_for, checked_at, outcome, failure_reason from monitor_check_results where monitor_id = $1 order by scheduled_for",
      [monitorId],
    )
  ).rows as {
    scheduled_for: Date;
    checked_at: Date;
    outcome: string;
    failure_reason: string | null;
  }[];
}

const org = await createOrganization(
  pool,
  `Verify restart ${randomUUID().slice(0, 6)}`,
);
const person = await createPerson(pool, "restart", org);
await addMember(pool, org, person.userId, "owner");
const target = await startMonitorTarget();
target.setDelay(8000);
const session = await signInApi(person);
const workers: ReturnType<typeof startWorker>[] = [];

async function inFlight(from: number, waitMs = 60_000) {
  const start = Date.now();
  while (target.hits.length <= from && Date.now() - start < waitMs)
    await sleep(300);
  return target.hits.length > from;
}

try {
  const created = await session.request("POST", monitorPath(org), {
    ...basicConfig(
      `restart-${randomUUID().slice(0, 6)}`,
      `http://${host}:${String(target.port)}/health`,
    ),
    timeoutSeconds: 20,
    clientRequestId: randomUUID(),
  });
  const id = (created.body as { monitor: { id: string } }).monitor.id;

  // (a) SIGTERM while a short check runs: the 15 s drain lets it finish and record once.
  let seen = target.hits.length;
  let w = startWorker("term-short");
  workers.push(w);
  check("check started on the first Worker", await inFlight(seen));
  let termAt = Date.now();
  w.kill("SIGTERM");
  let exitCode = await Promise.race([
    w.exited,
    sleep(30_000).then(() => "timeout" as const),
  ]);
  let took = Date.now() - termAt;
  evidence.sigtermShort = { exitCode, tookMs: took };
  check(
    `AC-60 SIGTERM during an 8 s check: Worker exited cleanly in ${String(took)} ms (limit 25 000)`,
    exitCode === 0 && took <= 25_000,
    evidence.sigtermShort,
  );
  await sleep(2000);
  let rows = await results(id);
  let incidents = (
    await pool.query(
      "select count(*)::int n from monitor_incidents where monitor_id = $1",
      [id],
    )
  ).rows[0].n;
  check(
    "AC-60 the drained check was recorded exactly once, no incident",
    rows.length === 1 && rows[0]!.outcome === "pass" && incidents === 0,
    { rows: rows.length, incidents },
  );

  // (b) SIGTERM during a check longer than the drain window: the result is abandoned, a gap remains.
  target.setDelay(20_000);
  seen = target.hits.length;
  w = startWorker("term-long");
  workers.push(w);
  check(
    "a longer check started on a new Worker",
    await inFlight(seen, 150_000),
  );
  const before = rows.length;
  termAt = Date.now();
  w.kill("SIGTERM");
  exitCode = await Promise.race([
    w.exited,
    sleep(30_000).then(() => "timeout" as const),
  ]);
  took = Date.now() - termAt;
  evidence.sigtermLong = { exitCode, tookMs: took };
  check(
    `AC-60 SIGTERM during a 20 s check: Worker exited in ${String(took)} ms (limit 25 000)`,
    exitCode !== "timeout" && took <= 25_000,
    evidence.sigtermLong,
  );
  await sleep(3000);
  rows = await results(id);
  incidents = (
    await pool.query(
      "select count(*)::int n from monitor_incidents where monitor_id = $1",
      [id],
    )
  ).rows[0].n;
  const logText = await Bun.file(logPaths.get(w)!).text();
  check(
    "AC-60 the abandoned check left no row and no incident",
    rows.length === before && incidents === 0,
    { before, after: rows.length, incidents },
  );
  check(
    "AC-60 the Worker logged the abandonment",
    logText.includes("monitor check abandoned on shutdown"),
    null,
  );
  target.setDelay(8000);

  // A restarted Worker resumes without back-filling or duplicating.
  seen = target.hits.length;
  w = startWorker("resume");
  workers.push(w);
  check(
    "a new Worker picks the monitor up again after SIGTERM",
    await inFlight(seen, 150_000),
  );
  await sleep(11_000);
  rows = await results(id);
  check(
    "AC-37 exactly one new result for the resumed round, no back-filled rounds",
    rows.length === before + 1 && rows.every((r) => r.outcome === "pass"),
    { before, after: rows.length },
  );

  // kill -9 in the middle of the next check.
  seen = target.hits.length;
  check("next round started", await inFlight(seen, 150_000));
  w.kill("SIGKILL");
  await w.exited;
  await sleep(1000);
  const afterKill = await results(id);
  check(
    "AC-60 SIGKILL mid-check: no result was written for the killed round",
    afterKill.length === rows.length,
    { before: rows.length, after: afterKill.length },
  );
  seen = target.hits.length;
  w = startWorker("after-kill");
  workers.push(w);
  check(
    "after SIGKILL the claim expires and a new Worker re-checks",
    await inFlight(seen, 240_000),
  );
  await sleep(11_000);
  const all = await results(id);
  const distinct = new Set(all.map((r) => r.scheduled_for.toISOString())).size;
  check(
    "AC-60 no duplicate results and no wrong incident after SIGKILL",
    distinct === all.length && all.every((r) => r.outcome === "pass"),
    { rows: all.length, distinct },
  );
  const incidents2 = (
    await pool.query(
      "select count(*)::int n from monitor_incidents where monitor_id = $1",
      [id],
    )
  ).rows[0].n;
  check(
    "no incident was opened by the interruptions",
    incidents2 === 0,
    incidents2,
  );

  // Two Workers at once (AC-37): one result per round.
  const w2 = startWorker("replica");
  workers.push(w2);
  const from = Date.now();
  await sleep(200_000);
  const both = await results(id);
  const window = both.filter((r) => r.scheduled_for.getTime() >= from - 60_000);
  const perRound = new Map<number, number>();
  for (const r of window)
    perRound.set(
      Math.floor(r.scheduled_for.getTime() / 60_000),
      (perRound.get(Math.floor(r.scheduled_for.getTime() / 60_000)) ?? 0) + 1,
    );
  check(
    `AC-37 two Workers over ${String(Math.round((Date.now() - from) / 1000))} s: at most one result per 60 s round`,
    window.length >= 2 && [...perRound.values()].every((n) => n === 1),
    [...perRound.entries()],
  );
  evidence.replicaRows = window.length;
} finally {
  for (const proc of workers) {
    try {
      proc.kill("SIGTERM");
      await Promise.race([proc.exited, sleep(30_000)]);
    } catch {
      // Already gone.
    }
  }
  await cleanUp(pool, [person.userId], [org]);
  await target.close();
  await database.close();
  writeFileSync(process.env.EVIDENCE_OUT!, JSON.stringify(evidence, null, 2));
}
console.log(`failed: ${String(failures.length)}`);
process.exit(failures.length === 0 ? 0 : 1);
