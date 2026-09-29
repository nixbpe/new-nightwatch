import { randomUUID } from "node:crypto";

import { createLogger, loadMonitorEnv } from "@nightwatch/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processMonitorCheck, type CheckerDependencies } from "./checker";
import {
  outboundDeps,
  rows,
  seedMonitor,
  startTarget,
  startTestDatabase,
  updateMonitor,
  type SeededMonitor,
  type TestDatabase,
} from "./test-harness";

let db!: TestDatabase;
const silent = createLogger({ level: "silent", name: "checker-test" });

function dependencies(
  overrides: Partial<CheckerDependencies> = {},
): CheckerDependencies {
  return {
    database: db.runtime,
    credentialEnv: loadMonitorEnv({ REDIS_URL: "redis://unused" }),
    logger: silent,
    outbound: outboundDeps,
    ...overrides,
  };
}

type ResultRow = {
  scheduled_for: Date;
  outcome: string;
  http_status: number | null;
  failure_reason: string | null;
  url_masked: string;
  check_config_version: number;
  interval_seconds: number;
};
const RESULT_COLUMNS = `scheduled_for, outcome, http_status, failure_reason,
  url_masked, check_config_version, interval_seconds`;

function results(monitor: SeededMonitor): Promise<ResultRow[]> {
  return rows<ResultRow>(
    db,
    monitor,
    `select ${RESULT_COLUMNS} from monitor_check_results
     where monitor_id = $1 order by scheduled_for`,
    [monitor.monitorId],
  );
}

async function countAll(monitor: SeededMonitor): Promise<{
  results: number;
  incidents: number;
  events: number;
}> {
  const [counts] = await rows<{
    results: number;
    incidents: number;
    events: number;
  }>(
    db,
    monitor,
    `select (select count(*)::int from monitor_check_results where monitor_id = $1) as results,
            (select count(*)::int from monitor_incidents where monitor_id = $1) as incidents,
            (select count(*)::int from monitor_events where monitor_id = $1) as events`,
    [monitor.monitorId],
  );
  return counts as { results: number; incidents: number; events: number };
}

async function claimToken(monitor: SeededMonitor): Promise<string | null> {
  const [row] = await rows<{ claim_token: string | null }>(
    db,
    monitor,
    "select claim_token from monitor_schedule where monitor_id = $1",
    [monitor.monitorId],
  );
  return row?.claim_token ?? null;
}

beforeAll(async () => {
  db = await startTestDatabase("checker");
}, 90_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

describe("checker records a result (transaction A then B)", () => {
  it("stores one masked, body-free row and releases the claim (AC-42)", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/health?token=abc`,
        queryParams: [{ name: "key", value: "s3cret-query" }],
      });
      const scheduledFor = new Date(Date.now() - 2_000);
      const outcome = await processMonitorCheck(
        monitor.job({ scheduledFor: scheduledFor.toISOString() }),
        dependencies(),
      );

      expect(outcome).toBe("recorded");
      const stored = await results(monitor);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        outcome: "pass",
        http_status: 200,
        failure_reason: null,
        check_config_version: 1,
        interval_seconds: 60,
      });
      expect(stored[0]?.scheduled_for.toISOString()).toBe(
        scheduledFor.toISOString(),
      );
      const serialized = JSON.stringify(stored);
      expect(serialized).not.toContain("abc");
      expect(serialized).not.toContain("s3cret-query");
      expect(stored[0]?.url_masked).toContain("•••");
      expect(await claimToken(monitor)).toBeNull();
    } finally {
      await target.close();
    }
  });

  it("finishes without recording or sending when the claim is stale", async () => {
    const target = await startTarget();
    try {
      const url = `${target.url}/`;
      const monitor = await seedMonitor(db, { url });
      const paused = await seedMonitor(db, { url, status: "paused" });
      const other = await seedMonitor(db, { url });

      const wrongToken = await processMonitorCheck(
        monitor.job({ claimToken: randomUUID() }),
        dependencies(),
      );
      const wrongVersion = await processMonitorCheck(
        monitor.job({ checkConfigVersion: 2 }),
        dependencies(),
      );
      const pausedRun = await processMonitorCheck(paused.job(), dependencies());
      const unknown = await processMonitorCheck(
        { ...other.job(), monitorId: randomUUID() },
        dependencies(),
      );
      // A job that names another Organization sees none of its rows.
      const crossTenant = await processMonitorCheck(
        { ...monitor.job(), tenantId: other.tenantId },
        dependencies(),
      );

      expect([
        wrongToken,
        wrongVersion,
        pausedRun,
        unknown,
        crossTenant,
      ]).toEqual(["skipped", "skipped", "skipped", "skipped", "skipped"]);
      expect(target.requests).toHaveLength(0);
      expect((await countAll(monitor)).results).toBe(0);
      expect(await claimToken(monitor)).toBe(monitor.claimToken);
    } finally {
      await target.close();
    }
  });

  it("two checkers racing for one claim leave one row (AC-37)", async () => {
    // The target answers only once both checkers are in flight, so both have
    // passed transaction A before either reaches transaction B.
    const arrived = Promise.withResolvers<undefined>();
    let pending = 0;
    const target = await startTarget((_request, response) => {
      pending += 1;
      if (pending === 2) arrived.resolve(undefined);
      void arrived.promise.then(() => {
        response.statusCode = 200;
        response.end("ok");
      });
    });
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const job = monitor.job();
      const outcomes = await Promise.all([
        processMonitorCheck(job, dependencies()),
        processMonitorCheck(job, dependencies()),
      ]);

      expect([...outcomes].sort()).toEqual(["discarded", "recorded"]);
      expect((await countAll(monitor)).results).toBe(1);
    } finally {
      await target.close();
    }
  });

  it("a replayed job records nothing more (duplicate job id, AC-37)", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const job = monitor.job();
      expect(await processMonitorCheck(job, dependencies())).toBe("recorded");
      expect(await processMonitorCheck(job, dependencies())).toBe("skipped");
      expect((await countAll(monitor)).results).toBe(1);
    } finally {
      await target.close();
    }
  });

  it("two claims for one scheduled_for keep the first result only", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const scheduledFor = new Date(Date.now() - 5_000).toISOString();
      const first = monitor.job({ scheduledFor });
      expect(await processMonitorCheck(first, dependencies())).toBe("recorded");
      // A lease that expired and was claimed again names the same slot.
      const secondToken = randomUUID();
      await updateMonitor(
        db,
        monitor,
        "update monitor_schedule set claim_token = $2 where monitor_id = $1",
        [monitor.monitorId, secondToken],
      );
      const second = monitor.job({ scheduledFor, claimToken: secondToken });
      expect(await processMonitorCheck(second, dependencies())).toBe(
        "duplicate",
      );
      expect(await results(monitor)).toHaveLength(1);
    } finally {
      await target.close();
    }
  });

  it("drops the result of a check that a Pause, Delete or Edit overtook (AC-38, AC-59)", async () => {
    const target = await startTarget(
      (_request, response) =>
        void setTimeout(() => {
          response.statusCode = 500;
          response.end("late");
        }, 5_000),
    );
    try {
      const url = `${target.url}/slow`;
      const paused = await seedMonitor(db, { url, timeoutSeconds: 10 });
      const deleted = await seedMonitor(db, { url, timeoutSeconds: 10 });
      const edited = await seedMonitor(db, { url, timeoutSeconds: 10 });
      const untouched = await seedMonitor(db, { url, timeoutSeconds: 10 });

      const running = [paused, deleted, edited, untouched].map((monitor) =>
        processMonitorCheck(monitor.job(), dependencies()),
      );
      // All four requests are in flight before the change lands.
      const started = Date.now();
      while (target.requests.length < 4 && Date.now() - started < 4_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(target.requests).toHaveLength(4);

      await updateMonitor(
        db,
        paused,
        `update monitor_schedule set claim_token = null, next_check_at = null
         where monitor_id = $1`,
        [paused.monitorId],
      );
      await updateMonitor(
        db,
        paused,
        "update monitors set status = 'paused' where id = $1",
        [paused.monitorId],
      );
      await updateMonitor(db, deleted, "delete from monitors where id = $1", [
        deleted.monitorId,
      ]);
      await updateMonitor(
        db,
        edited,
        "update monitors set check_config_version = 2 where id = $1",
        [edited.monitorId],
      );
      await updateMonitor(
        db,
        edited,
        `update monitor_schedule set check_config_version = 2, claim_token = null
         where monitor_id = $1`,
        [edited.monitorId],
      );

      const [pausedOutcome, deletedOutcome, editedOutcome, untouchedOutcome] =
        await Promise.all(running);
      expect([pausedOutcome, deletedOutcome, editedOutcome]).toEqual([
        "discarded",
        "discarded",
        "discarded",
      ]);
      expect(untouchedOutcome).toBe("recorded");
      for (const monitor of [paused, edited]) {
        expect(await countAll(monitor)).toEqual({
          results: 0,
          incidents: 0,
          events: 0,
        });
      }
      expect((await countAll(untouched)).results).toBe(1);
      const [remaining] = await rows<{ count: number }>(
        db,
        deleted,
        "select count(*)::int as count from monitor_check_results where monitor_id = $1",
        [deleted.monitorId],
      );
      expect(remaining?.count).toBe(0);
    } finally {
      await target.close();
    }
  }, 30_000);
});
