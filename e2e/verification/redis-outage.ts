/**
 * AC-53 across the stack and the Redis half of AC-57. Runs only against a
 * throwaway stack (its own PostgreSQL and Redis containers, API and Worker with
 * all roles): it stops, pauses and starts the Redis container named by
 * REDIS_CONTAINER, so it must never point at a shared Redis.
 *
 *   REDIS_CONTAINER=... API_PORT=... DATABASE_URL=... DATABASE_OWNER_URL=... \
 *   REDIS_URL=... EVIDENCE_OUT=... bun e2e/verification/redis-outage.ts
 *
 * Part A: Redis stops while the second failing check is running; the incident
 * must still open, and after Redis returns exactly one MONITOR_DOWN reaches the
 * inbox. Part B: Redis stops and returns while the incident stays open; still
 * one MONITOR_DOWN, and one MONITOR_RECOVERED after the target recovers.
 * Part C: Test and write requests while Redis is stopped or frozen.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { createDatabase } from "../../packages/db/src/index.ts";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  apiOrigin,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  monitorPath,
  signInApi,
  targetHostname,
} from "../support/monitor-fixtures";

const container = process.env.REDIS_CONTAINER!;
if (!container || !container.includes("-91-")) {
  throw new Error("REDIS_CONTAINER must name the throwaway Redis container");
}
const host = targetHostname();
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const evidence: Record<string, unknown> = { checks: [] as unknown[] };
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
  (evidence.checks as unknown[]).push({ name, ok, detail });
  if (!ok) failures.push(name);
};
const docker = (...args: string[]) => {
  const r = Bun.spawnSync(["docker", ...args]);
  if (r.exitCode !== 0) throw new Error(`docker ${args.join(" ")} failed`);
};
async function waitFor<T>(
  fn: () => Promise<T | null | false>,
  ms: number,
  every = 2000,
): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

const org = await createOrganization(
  pool,
  `Verify redis ${randomUUID().slice(0, 6)}`,
);
const owner = await createPerson(pool, "redis-owner", org);
await addMember(pool, org, owner.userId, "owner");
const viewer = await createPerson(pool, "redis-viewer", org);
await addMember(pool, org, viewer.userId, "viewer");
const session = await signInApi(owner);
const viewerSession = await signInApi(viewer);
const flap = await startMonitorTarget();
const probe = await startMonitorTarget();
flap.setMode("down");
const counts = async (monitorId: string) => {
  const q = async (sql: string) =>
    (await pool.query(sql, [org, monitorId])).rows[0];
  return {
    results: (
      await q(
        "select count(*)::int n from monitor_check_results where tenant_id=$1 and monitor_id=$2",
      )
    ).n as number,
    openIncidents: (
      await q(
        "select count(*)::int n from monitor_incidents where tenant_id=$1 and monitor_id=$2 and ended_at is null",
      )
    ).n as number,
    incidents: (
      await q(
        "select count(*)::int n from monitor_incidents where tenant_id=$1 and monitor_id=$2",
      )
    ).n as number,
    down: (
      await q(
        "select count(*)::int n from notification_inbox_items where tenant_id=$1 and subject_monitor_id=$2 and event_type='MONITOR_DOWN'",
      )
    ).n as number,
    recovered: (
      await q(
        "select count(*)::int n from notification_inbox_items where tenant_id=$1 and subject_monitor_id=$2 and event_type='MONITOR_RECOVERED'",
      )
    ).n as number,
    intents: (
      await q(
        "select count(*)::int n from notification_intents where tenant_id=$1 and subject_monitor_id=$2",
      )
    ).n as number,
  };
};

try {
  const ready0 = await fetch(`${apiOrigin}/ready`).then((r) => r.status);
  check("stack ready with Redis up", ready0 === 200, ready0);

  const created = await session.request("POST", monitorPath(org), {
    ...basicConfig(
      `redis-${randomUUID().slice(0, 6)}`,
      `http://${host}:${String(flap.port)}/health`,
    ),
    timeoutSeconds: 20,
    clientRequestId: randomUUID(),
  });
  const id = (created.body as { monitor: { id: string } }).monitor.id;
  check("monitor created", created.status === 201, created.body);

  // Part A: first failure recorded with Redis up, then Redis stops during the second check.
  const firstFail = await waitFor(
    async () => (await counts(id)).results >= 1,
    90_000,
  );
  check("first failing check recorded", firstFail !== null);
  flap.setDelay(9000);
  const seen = flap.hits.length;
  const started = await waitFor(
    async () => flap.hits.length > seen,
    120_000,
    300,
  );
  check("second check is in flight", started !== null);
  docker("stop", container);
  const stoppedAt = Date.now();
  evidence.redisStoppedAt = new Date(stoppedAt).toISOString();
  flap.setDelay(0);

  const opened = await waitFor(
    async () => (await counts(id)).openIncidents === 1,
    60_000,
  );
  const whileDown = await counts(id);
  evidence.whileDown = whileDown;
  check(
    "AC-53 the incident opened and the result is stored while Redis is down",
    opened !== null && whileDown.results >= 2,
    whileDown,
  );
  check(
    "AC-53 no notification was delivered while Redis is down",
    whileDown.down === 0,
    whileDown,
  );
  const ready1 = await fetch(`${apiOrigin}/ready`).then((r) => r.status);
  check(
    "readiness reports not ready while Redis is down",
    ready1 === 503,
    ready1,
  );

  // Part C, stopped Redis: Test and write requests.
  const probeHits = probe.hits.length;
  const t0 = Date.now();
  const testDown = await session.request(
    "POST",
    monitorPath(org, "/test"),
    basicConfig("probe", `http://${host}:${String(probe.port)}/status/200`),
  );
  evidence.testWhileStopped = {
    status: testDown.status,
    ms: Date.now() - t0,
    body: testDown.body,
  };
  check(
    "AC-57 Test with Redis stopped answers 503 within 2.5 s and sends nothing",
    testDown.status === 503 &&
      Date.now() - t0 < 2500 + 500 &&
      probe.hits.length === probeHits,
    evidence.testWhileStopped,
  );
  const denied = await viewerSession.request(
    "POST",
    monitorPath(org, "/test"),
    basicConfig("probe", `http://${host}:${String(probe.port)}/status/200`),
  );
  check(
    "AC-57 a viewer still gets 403 (permission before limiter) with Redis stopped",
    denied.status === 403,
    denied.status,
  );
  const write = await session.request("POST", monitorPath(org), {
    ...basicConfig(
      `w-${randomUUID().slice(0, 6)}`,
      `http://${host}:${String(probe.port)}/status/200`,
    ),
    clientRequestId: randomUUID(),
  });
  evidence.writeWhileStopped = { status: write.status };

  await sleep(15_000);
  docker("start", container);
  const restartedAt = Date.now();
  const delivered = await waitFor(
    async () => (await counts(id)).down >= 1,
    240_000,
  );
  const afterRestart = await counts(id);
  evidence.afterRestart = {
    ...afterRestart,
    secondsToDeliver: Math.round((Date.now() - restartedAt) / 1000),
  };
  check(
    `AC-53 after Redis returns the notification is delivered (${String(Math.round((Date.now() - restartedAt) / 1000))} s)`,
    delivered !== null,
    afterRestart,
  );
  await sleep(90_000);
  const settled = await counts(id);
  check(
    "AC-53 exactly one MONITOR_DOWN, one incident and no duplicate intent after 90 s more",
    settled.down === 1 && settled.incidents === 1 && settled.intents <= 1,
    settled,
  );

  // Part B: Redis stops and returns while the incident stays open.
  docker("stop", container);
  await sleep(45_000);
  const midOutage = await counts(id);
  docker("start", container);
  await sleep(120_000);
  const afterB = await counts(id);
  evidence.partB = { midOutage, afterB };
  check(
    "AC-53 Redis stop and start with an open incident: still one open incident and one MONITOR_DOWN",
    afterB.openIncidents === 1 && afterB.incidents === 1 && afterB.down === 1,
    evidence.partB,
  );
  flap.setMode("up");
  const recovered = await waitFor(
    async () => (await counts(id)).recovered >= 1,
    240_000,
  );
  await sleep(90_000);
  const final = await counts(id);
  evidence.final = final;
  check(
    "AC-53 recovery after the outage: exactly one MONITOR_RECOVERED and the incident closed",
    recovered !== null &&
      final.recovered === 1 &&
      final.down === 1 &&
      final.openIncidents === 0,
    final,
  );

  // Part C, frozen Redis: the limiter times out at 2 s.
  docker("pause", container);
  const hits2 = probe.hits.length;
  const t1 = Date.now();
  const testSlow = await session.request(
    "POST",
    monitorPath(org, "/test"),
    basicConfig("probe", `http://${host}:${String(probe.port)}/status/200`),
  );
  const took = Date.now() - t1;
  docker("unpause", container);
  evidence.testWhileFrozen = {
    status: testSlow.status,
    ms: took,
    body: testSlow.body,
  };
  check(
    `AC-57 Test with Redis frozen answers 503 after about 2 s (${String(took)} ms) and sends nothing`,
    testSlow.status === 503 &&
      took >= 1500 &&
      took < 5000 &&
      probe.hits.length === hits2,
    evidence.testWhileFrozen,
  );
  const okAgain = await waitFor(
    async () =>
      (
        await session.request(
          "POST",
          monitorPath(org, "/test"),
          basicConfig(
            "probe",
            `http://${host}:${String(probe.port)}/status/200`,
          ),
        )
      ).status === 200,
    30_000,
    3000,
  );
  check("Test works again once Redis is back", okAgain !== null);
} finally {
  try {
    docker("unpause", container);
  } catch {
    // Not paused.
  }
  try {
    docker("start", container);
  } catch {
    // Already running.
  }
  await cleanUp(pool, [owner.userId, viewer.userId], [org]);
  await flap.close();
  await probe.close();
  await database.close();
  writeFileSync(process.env.EVIDENCE_OUT!, JSON.stringify(evidence, null, 2));
}
console.log(`failed: ${String(failures.length)}`);
process.exit(failures.length === 0 ? 0 : 1);
