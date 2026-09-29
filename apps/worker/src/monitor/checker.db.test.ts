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

type Step = "pass" | "fail" | "check_error";

type StepEvent = { type: string; endReason?: string; lockHeld: boolean };

/**
 * Runs one check per step, each with its own claim and scheduled_for, against
 * a target that answers 200 (pass) or 503 (fail); a check_error step makes the
 * resolver fail the way an unreachable resolver does.
 */
async function runSteps(
  monitor: SeededMonitor,
  target: Awaited<ReturnType<typeof startTarget>>,
  steps: Step[],
  startAt = Date.now() - 3_600_000,
): Promise<{
  events: StepEvent[];
  states: { failures: number; open: boolean; lastOutcome: string | null }[];
}> {
  const events: StepEvent[] = [];
  const states: {
    failures: number;
    open: boolean;
    lastOutcome: string | null;
  }[] = [];
  let status = 200;
  target.setHandler((_request, response) => {
    response.statusCode = status;
    response.end("body");
  });
  for (const [index, step] of steps.entries()) {
    const token = randomUUID();
    await updateMonitor(
      db,
      monitor,
      "update monitor_schedule set claim_token = $2 where monitor_id = $1",
      [monitor.monitorId, token],
    );
    status = step === "pass" ? 200 : 503;
    await processMonitorCheck(
      monitor.job({
        claimToken: token,
        scheduledFor: new Date(startAt + index * 60_000).toISOString(),
      }),
      dependencies({
        outbound:
          step === "check_error"
            ? {
                ...outboundDeps,
                resolver: () =>
                  Promise.reject(
                    Object.assign(new Error("resolver"), { code: "EAI_AGAIN" }),
                  ),
              }
            : outboundDeps,
        onEvent: async (tx, event) => {
          const locks = await tx.query<{ held: number }>(
            `select count(*)::int as held from pg_locks
             where locktype = 'advisory' and pid = pg_backend_pid()`,
          );
          events.push({
            type: event.type,
            ...(event.type === "incident_closed"
              ? { endReason: event.endReason }
              : {}),
            lockHeld: (locks.rows[0]?.held ?? 0) > 0,
          });
        },
      }),
    );
    const [state] = await rows<{
      failures: number;
      open: boolean;
      last_outcome: string | null;
    }>(
      db,
      monitor,
      `select consecutive_failures as failures, last_outcome,
              exists(select 1 from monitor_incidents
                     where monitor_id = $1 and ended_at is null) as open
       from monitors where id = $1`,
      [monitor.monitorId],
    );
    states.push({
      failures: state?.failures ?? -1,
      open: state?.open ?? false,
      lastOutcome: state?.last_outcome ?? null,
    });
  }
  return { events, states };
}

describe("state, streak and incidents (AC-13, AC-39, AC-40)", () => {
  it("pass, fail, fail, pass opens then closes one incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const { events, states } = await runSteps(monitor, target, [
        "pass",
        "fail",
        "fail",
        "pass",
      ]);
      expect(states.map((state) => [state.failures, state.open])).toEqual([
        [0, false],
        [1, false],
        [2, true],
        [0, false],
      ]);
      expect(events).toEqual([
        { type: "incident_opened", lockHeld: true },
        { type: "incident_closed", endReason: "recovered", lockHeld: true },
      ]);
      const incidents = await rows<{
        end_reason: string;
        start_reason: string;
        start_http_status: number;
      }>(
        db,
        monitor,
        "select end_reason, start_reason, start_http_status from monitor_incidents where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(incidents).toEqual([
        {
          end_reason: "recovered",
          start_reason: "http_status",
          start_http_status: 503,
        },
      ]);
    } finally {
      await target.close();
    }
  });

  it("pass, fail, pass opens no incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const { events } = await runSteps(monitor, target, [
        "pass",
        "fail",
        "pass",
      ]);
      expect(events).toEqual([]);
      expect((await countAll(monitor)).incidents).toBe(0);
    } finally {
      await target.close();
    }
  });

  it("fail, fail from the first check opens an incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const { states } = await runSteps(monitor, target, ["fail", "fail"]);
      expect(states.map((state) => state.open)).toEqual([false, true]);
    } finally {
      await target.close();
    }
  });

  it("a third failure keeps the one open incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const { events } = await runSteps(monitor, target, [
        "fail",
        "fail",
        "fail",
        "fail",
      ]);
      expect(events.map((event) => event.type)).toEqual(["incident_opened"]);
      expect((await countAll(monitor)).incidents).toBe(1);
    } finally {
      await target.close();
    }
  });

  it("pass, check_error, fail leaves a streak of 1 and no incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const { states, events } = await runSteps(monitor, target, [
        "pass",
        "check_error",
        "fail",
      ]);
      expect(
        states.map((state) => [state.failures, state.lastOutcome]),
      ).toEqual([
        [0, "pass"],
        [0, "check_error"],
        [1, "fail"],
      ]);
      expect(events).toEqual([]);
      const stored = await results(monitor);
      expect(stored.map((row) => row.failure_reason)).toEqual([
        null,
        "resolver_unavailable",
        "http_status",
      ]);
    } finally {
      await target.close();
    }
  });

  it("check_error neither counts nor resets the failure streak", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const { states } = await runSteps(monitor, target, [
        "fail",
        "check_error",
        "fail",
      ]);
      expect(states.map((state) => [state.failures, state.open])).toEqual([
        [1, false],
        [1, false],
        [2, true],
      ]);
    } finally {
      await target.close();
    }
  });

  it("a pass after an Edit closes an incident carried from the old config", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await runSteps(monitor, target, ["fail", "fail"]);
      // Edit: version 2, streak reset, incident stays open (AC-40).
      await updateMonitor(
        db,
        monitor,
        `update monitors set check_config_version = 2, consecutive_failures = 0
         where id = $1`,
        [monitor.monitorId],
      );
      await updateMonitor(
        db,
        monitor,
        `update monitor_schedule set check_config_version = 2, claim_token = $2
         where monitor_id = $1`,
        [monitor.monitorId, "edited-claim"],
      );
      const edited = {
        ...monitor,
        job: (overrides = {}) =>
          monitor.job({
            checkConfigVersion: 2,
            claimToken: "edited-claim",
            ...overrides,
          }),
      };
      const [failing] = await rows<{ open: boolean; failures: number }>(
        db,
        monitor,
        `select consecutive_failures as failures,
                exists(select 1 from monitor_incidents
                       where monitor_id = $1 and ended_at is null) as open
         from monitors where id = $1`,
        [monitor.monitorId],
      );
      expect(failing).toEqual({ failures: 0, open: true });

      target.setHandler((_request, response) => {
        response.statusCode = 200;
        response.end("ok");
      });
      await processMonitorCheck(edited.job(), dependencies());
      const [after] = await rows<{
        open: boolean;
        passed_version: number;
      }>(
        db,
        monitor,
        `select last_passed_config_version as passed_version,
                exists(select 1 from monitor_incidents
                       where monitor_id = $1 and ended_at is null) as open
         from monitors where id = $1`,
        [monitor.monitorId],
      );
      expect(after).toEqual({ open: false, passed_version: 2 });
    } finally {
      await target.close();
    }
  });
});

describe("hourly rollup (AC-14)", () => {
  it("adds pass and fail to one row per hour and skips check_error", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        intervalSeconds: 60,
      });
      const hour =
        Math.floor(Date.now() / 3_600_000) * 3_600_000 - 2 * 3_600_000;
      await runSteps(
        monitor,
        target,
        ["pass", "fail", "check_error", "pass"],
        hour + 60_000,
      );
      // Next hour: a single failure.
      await runSteps(monitor, target, ["fail"], hour + 3_600_000 + 60_000);

      const hourly = await rows<{
        hour_start: Date;
        checks: number;
        passed: number;
        covered_seconds: number;
        response_ms_max: number | null;
      }>(
        db,
        monitor,
        `select hour_start, checks, passed, covered_seconds, response_ms_max
         from monitor_check_hourly where monitor_id = $1 order by hour_start`,
        [monitor.monitorId],
      );
      expect(hourly.map((row) => row.hour_start.getTime())).toEqual([
        hour,
        hour + 3_600_000,
      ]);
      expect(hourly[0]).toMatchObject({
        checks: 3,
        passed: 2,
        covered_seconds: 180,
      });
      expect(hourly[0]?.response_ms_max).toBeGreaterThanOrEqual(0);
      expect(hourly[1]).toMatchObject({
        checks: 1,
        passed: 0,
        covered_seconds: 60,
      });
    } finally {
      await target.close();
    }
  });

  it("a duplicate slot does not add to the rollup", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const scheduledFor = new Date(Date.now() - 600_000).toISOString();
      await processMonitorCheck(monitor.job({ scheduledFor }), dependencies());
      const second = randomUUID();
      await updateMonitor(
        db,
        monitor,
        "update monitor_schedule set claim_token = $2 where monitor_id = $1",
        [monitor.monitorId, second],
      );
      await processMonitorCheck(
        monitor.job({ scheduledFor, claimToken: second }),
        dependencies(),
      );
      const [hourly] = await rows<{ checks: number; covered_seconds: number }>(
        db,
        monitor,
        "select sum(checks)::int as checks, sum(covered_seconds)::int as covered_seconds from monitor_check_hourly where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(hourly).toEqual({ checks: 1, covered_seconds: 60 });
    } finally {
      await target.close();
    }
  });
});
