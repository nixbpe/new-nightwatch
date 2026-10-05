import { randomUUID } from "node:crypto";
import { getEventListeners } from "node:events";

import {
  createLogger,
  encryptSecret,
  loadMonitorEnv,
} from "@nightwatch/shared";
import { purgeExpiredMonitorData, withTenantContextRaw } from "@nightwatch/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processMonitorCheck, type CheckerDependencies } from "./checker";
import { createEgressCanary } from "./egress-canary";
import {
  closedPort,
  outboundDeps,
  rows,
  seedMonitor,
  startTarget,
  startTestDatabase,
  updateMonitor,
  type SeededMonitor,
  type Target,
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
  lastResponses: number;
}> {
  const [counts] = await rows<{
    results: number;
    incidents: number;
    events: number;
    lastResponses: number;
  }>(
    db,
    monitor,
    `select (select count(*)::int from monitor_check_results where monitor_id = $1) as results,
            (select count(*)::int from monitor_incidents where monitor_id = $1) as incidents,
            (select count(*)::int from monitor_events where monitor_id = $1) as events,
            (select count(*)::int from monitor_last_responses where monitor_id = $1) as "lastResponses"`,
    [monitor.monitorId],
  );
  return counts as {
    results: number;
    incidents: number;
    events: number;
    lastResponses: number;
  };
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
      // One failure already recorded: a 500 that got recorded would open an incident.
      for (const monitor of [paused, deleted, edited, untouched]) {
        await updateMonitor(
          db,
          monitor,
          "update monitors set consecutive_failures = 1 where id = $1",
          [monitor.monitorId],
        );
      }

      const emitted: string[] = [];
      const running = [paused, deleted, edited, untouched].map((monitor) =>
        processMonitorCheck(
          monitor.job(),
          dependencies({
            onEvent: (_tx, event) => {
              emitted.push(`${event.monitorId}:${event.type}`);
              return Promise.resolve();
            },
          }),
        ),
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
      // Only the monitor nobody touched reaches the event hook and opens an incident.
      expect(emitted).toEqual([`${untouched.monitorId}:incident_opened`]);
      expect((await countAll(untouched)).incidents).toBe(1);
      for (const monitor of [paused, edited]) {
        expect(await countAll(monitor)).toEqual({
          results: 0,
          incidents: 0,
          events: 0,
          lastResponses: 0,
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
  target: Pick<Target, "setHandler">,
  steps: Step[],
  startAt = Date.now() - 3_600_000,
  canary?: CheckerDependencies["canary"],
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
        ...(canary ? { canary } : {}),
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

  it("threshold 1 opens on the first failure, writing check_failed and incident_opened from the same result", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 1 where id = $1",
        [monitor.monitorId],
      );
      const { events, states } = await runSteps(monitor, target, ["fail"]);
      expect(states).toEqual([
        { failures: 1, open: true, lastOutcome: "fail" },
      ]);
      expect(events.map((event) => event.type)).toEqual(["incident_opened"]);
      const feed = await rows<{ kind: string }>(
        db,
        monitor,
        "select kind from monitor_events where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(feed).toEqual([{ kind: "check_failed" }]);
      const [row] = await rows<{ started_at: Date; checked_at: Date }>(
        db,
        monitor,
        `select i.started_at, r.checked_at from monitor_incidents i
         join monitor_check_results r on r.monitor_id = i.monitor_id
         where i.monitor_id = $1`,
        [monitor.monitorId],
      );
      expect(row?.started_at.getTime()).toBe(row?.checked_at.getTime());
    } finally {
      await target.close();
    }
  });

  it("threshold 3 opens the incident only at the third consecutive failure", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 3 where id = $1",
        [monitor.monitorId],
      );
      const { events, states } = await runSteps(monitor, target, [
        "fail",
        "fail",
        "fail",
      ]);
      expect(states.map((state) => [state.failures, state.open])).toEqual([
        [1, false],
        [2, false],
        [3, true],
      ]);
      expect(events.map((event) => event.type)).toEqual(["incident_opened"]);
    } finally {
      await target.close();
    }
  });

  it("lowering the failure threshold from 3 to 2 after two failures opens an incident only on the next failure", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 3 where id = $1",
        [monitor.monitorId],
      );
      const first = await runSteps(monitor, target, ["fail", "fail"]);
      expect(first.states.map((state) => [state.failures, state.open])).toEqual(
        [
          [1, false],
          [2, false],
        ],
      );
      // The save itself (an Edit, simulated directly) does not open an incident.
      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 2 where id = $1",
        [monitor.monitorId],
      );
      expect((await countAll(monitor)).incidents).toBe(0);

      const second = await runSteps(
        monitor,
        target,
        ["fail"],
        Date.now() - 1_800_000,
      );
      expect(second.states).toEqual([
        { failures: 3, open: true, lastOutcome: "fail" },
      ]);
    } finally {
      await target.close();
    }
  });

  it("lowering the failure threshold from 3 to 2 after two failures lets the next pass reset the streak without an incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 3 where id = $1",
        [monitor.monitorId],
      );
      await runSteps(monitor, target, ["fail", "fail"]);
      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 2 where id = $1",
        [monitor.monitorId],
      );

      const { states, events } = await runSteps(
        monitor,
        target,
        ["pass"],
        Date.now() - 1_800_000,
      );
      expect(states).toEqual([
        { failures: 0, open: false, lastOutcome: "pass" },
      ]);
      expect(events).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it("increasing the failure threshold while an incident is open keeps it open until a pass", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await runSteps(monitor, target, ["fail", "fail"]);
      const [openedBefore] = await rows<{ open: boolean }>(
        db,
        monitor,
        `select exists(select 1 from monitor_incidents
                       where monitor_id = $1 and ended_at is null) as open`,
        [monitor.monitorId],
      );
      expect(openedBefore?.open).toBe(true);

      await updateMonitor(
        db,
        monitor,
        "update monitors set alert_failure_threshold = 3 where id = $1",
        [monitor.monitorId],
      );
      const { states, events } = await runSteps(
        monitor,
        target,
        ["fail", "pass"],
        Date.now() - 1_800_000,
      );
      expect(states.map((state) => [state.failures, state.open])).toEqual([
        [3, true],
        [0, false],
      ]);
      expect(events.map((event) => event.type)).toEqual(["incident_closed"]);
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

const credentialEnv = loadMonitorEnv({ REDIS_URL: "redis://unused" });

/** Stores an encrypted slot the way the API does. */
async function storeSecret(
  monitor: SeededMonitor,
  slot: string,
  value: string,
  bindTo: { monitorId: string } = monitor,
): Promise<void> {
  const sealed = encryptSecret(
    {
      tenantId: monitor.tenantId,
      monitorId: bindTo.monitorId,
      slot,
      value,
    },
    credentialEnv,
  );
  await withTenantContextRaw(db.runtime, monitor.tenantId, (client) =>
    client.query(
      `insert into monitor_secrets
         (monitor_id, tenant_id, slot, ciphertext, iv, auth_tag, key_version)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        monitor.monitorId,
        monitor.tenantId,
        slot,
        sealed.ciphertext,
        sealed.iv,
        sealed.authTag,
        sealed.keyVersion,
      ],
    ),
  );
}

describe("secrets in the checker (JOB-05)", () => {
  it("sends basic credentials, an API key and a secret header on scheduled checks", async () => {
    const target = await startTarget();
    try {
      const headerId = randomUUID();
      const values = {
        user: ["usr", randomUUID()].join("-"),
        password: ["pwd", randomUUID()].join("-"),
        key: ["key", randomUUID()].join("-"),
        header: ["hdr", randomUUID()].join("-"),
      };
      const basic = await seedMonitor(db, {
        url: `${target.url}/`,
        authType: "basic",
      });
      await storeSecret(basic, "auth.username", values.user);
      await storeSecret(basic, "auth.password", values.password);
      const apiKey = await seedMonitor(db, {
        url: `${target.url}/`,
        authType: "apiKey",
        apiKeyHeaderName: "X-Api-Key",
      });
      await storeSecret(apiKey, "auth.apiKey", values.key);
      const header = await seedMonitor(db, {
        url: `${target.url}/`,
        headers: [{ id: headerId, name: "X-Secret", secret: true }],
      });
      await storeSecret(header, `header.${headerId}`, values.header);

      for (const monitor of [basic, apiKey, header]) {
        expect(await processMonitorCheck(monitor.job(), dependencies())).toBe(
          "recorded",
        );
      }
      const [first, second, third] = target.requests;
      expect(first?.headers.authorization).toBe(
        `Basic ${Buffer.from(`${values.user}:${values.password}`).toString("base64")}`,
      );
      expect(second?.headers["x-api-key"]).toBe(values.key);
      expect(third?.headers["x-secret"]).toBe(values.header);
      for (const monitor of [basic, apiKey, header]) {
        const stored = await rows(
          db,
          monitor,
          "select * from monitor_check_results where monitor_id = $1",
          [monitor.monitorId],
        );
        expect(stored[0]?.outcome).toBe("pass");
        for (const value of Object.values(values)) {
          expect(JSON.stringify(stored)).not.toContain(value);
        }
      }
    } finally {
      await target.close();
    }
  });

  it("loads the monitor row and its secret slots in one statement", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        authType: "bearer",
      });
      await storeSecret(monitor, "auth.token", "tok");
      const statements: string[] = [];
      const sql = new Proxy(db.runtime.sql, {
        get(pool, property): unknown {
          if (property !== "connect") {
            const value: unknown = Reflect.get(pool, property);
            return typeof value === "function"
              ? (value as (...args: unknown[]) => unknown).bind(pool)
              : value;
          }
          return async (): Promise<unknown> => {
            const client = await pool.connect();
            return new Proxy(client, {
              get(inner, name): unknown {
                const value: unknown = Reflect.get(inner, name);
                if (name !== "query") {
                  return typeof value === "function"
                    ? (value as (...args: unknown[]) => unknown).bind(inner)
                    : value;
                }
                return (text: unknown, ...rest: unknown[]) => {
                  if (typeof text === "string") statements.push(text);
                  return (inner.query as (...args: unknown[]) => unknown)(
                    text,
                    ...rest,
                  );
                };
              },
            });
          };
        },
      });
      await processMonitorCheck(
        monitor.job(),
        dependencies({ database: { ...db.runtime, sql } }),
      );
      // Two statements are two READ COMMITTED snapshots: an Edit committing
      // between them could pair a new secret with the old URL.
      const reads = statements.filter((text) =>
        text.includes("monitor_secrets"),
      );
      expect(reads).toHaveLength(1);
      expect(reads[0]).toMatch(/from\s+monitors\s+as\s+m/);
      expect(target.requests[0]?.headers.authorization).toBe("Bearer tok");
    } finally {
      await target.close();
    }
  });

  it("an undecryptable secret is check_error with no request and no incident (AC-39)", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        authType: "bearer",
      });
      // Bound to another monitor: the AAD does not match this row.
      await storeSecret(monitor, "auth.token", "tok", {
        monitorId: randomUUID(),
      });
      const { states } = await runSteps(monitor, target, [
        "fail",
        "fail",
        "fail",
      ]);

      expect(target.requests).toHaveLength(0);
      expect(states.every((state) => !state.open && state.failures === 0)).toBe(
        true,
      );
      const stored = await results(monitor);
      expect(stored.map((row) => [row.outcome, row.failure_reason])).toEqual([
        ["check_error", "secret_decrypt_failed"],
        ["check_error", "secret_decrypt_failed"],
        ["check_error", "secret_decrypt_failed"],
      ]);
      expect((await countAll(monitor)).incidents).toBe(0);
    } finally {
      await target.close();
    }
  });

  it("a missing required secret slot is check_error", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        authType: "basic",
      });
      await storeSecret(monitor, "auth.username", "user");
      await processMonitorCheck(monitor.job(), dependencies());
      expect(target.requests).toHaveLength(0);
      expect((await results(monitor))[0]).toMatchObject({
        outcome: "check_error",
        failure_reason: "secret_decrypt_failed",
      });
    } finally {
      await target.close();
    }
  });
});

describe("a failing check that reflects its secret leaks it nowhere (AC-43)", () => {
  it("keeps every form of the value out of rows, intents and logs", async () => {
    // Characters that JSON and URL encoding change, so each form differs.
    const value = `sk"live&x=1+${randomUUID()}`;
    const forms = [
      value,
      Buffer.from(value).toString("base64"),
      JSON.stringify(value).slice(1, -1),
      encodeURIComponent(value),
    ];
    const lines: string[] = [];
    const logger = createLogger(
      { level: "debug", name: "checker-scan-test" },
      { write: (line: string) => void lines.push(line) },
    );
    const target = await startTarget((request, response) => {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ authorization: request.headers.authorization }),
      );
    });
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        authType: "bearer",
        assertions: [
          {
            kind: "jsonPathEquals",
            path: "$.authorization",
            expected: "never",
            pathSegments: ["authorization"],
            expectedValue: "never",
          },
        ],
      });
      await storeSecret(monitor, "auth.token", value);
      for (const index of [0, 1]) {
        const token = randomUUID();
        await updateMonitor(
          db,
          monitor,
          "update monitor_schedule set claim_token = $2 where monitor_id = $1",
          [monitor.monitorId, token],
        );
        await processMonitorCheck(
          monitor.job({
            claimToken: token,
            scheduledFor: new Date(
              Date.now() - 3_600_000 + index * 60_000,
            ).toISOString(),
          }),
          dependencies({ logger }),
        );
      }
      expect(target.requests[1]?.headers.authorization).toBe(`Bearer ${value}`);

      const counts = await countAll(monitor);
      expect(counts.results).toBe(2);
      expect(counts.incidents).toBe(1);
      const tables = [
        "monitor_check_results",
        "monitor_check_hourly",
        "monitor_incidents",
        "monitor_events",
        "monitor_last_responses",
        "monitor_schedule",
        "monitors",
      ];
      const stored: unknown[] = [];
      for (const table of tables) {
        const result = await withTenantContextRaw(
          db.runtime,
          monitor.tenantId,
          (client) =>
            client.query<{ text: string }>(
              `select t::text as text from ${table} t`,
            ),
        );
        stored.push(result.rows);
      }
      const intents = await db.owner.sql.query(
        `select t::text as text from notification_intents t where tenant_id = $1`,
        [monitor.tenantId],
      );
      // The incident wrote its intent, so the scan below covers a real row.
      expect(intents.rows).toHaveLength(1);
      const haystack = JSON.stringify([
        stored,
        intents.rows,
        (
          await db.owner.sql.query(
            "select t::text as text from notification_inbox_items t where tenant_id = $1",
            [monitor.tenantId],
          )
        ).rows,
      ]);
      expect(lines.length).toBeGreaterThan(0);
      // The reflected value did reach storage, as the mask.
      expect(haystack).toContain("Bearer •••");
      for (const form of forms) {
        expect(haystack).not.toContain(form);
        expect(lines.join("\n")).not.toContain(form);
      }
    } finally {
      await target.close();
    }
  });
});

describe("egress canary classification (AC-55)", () => {
  async function refusedRun(
    canary: ReturnType<typeof createEgressCanary> | undefined,
  ) {
    const port = await closedPort();
    const monitor = await seedMonitor(db, {
      url: `http://target.nw-test.internal:${String(port)}/`,
    });
    const { states, events } = await runSteps(
      monitor,
      { setHandler: () => undefined },
      ["fail", "fail"],
      Date.now() - 600_000,
      canary,
    );
    return { monitor, states, events };
  }

  it("network failure with a failing canary is check_error internal_egress_failed, no incident", async () => {
    const canary = createEgressCanary({
      urls: ["https://canary.example.test"],
      probe: () => Promise.resolve(false),
    });
    const { monitor, states } = await refusedRun(canary);
    expect(states.map((state) => state.open)).toEqual([false, false]);
    expect(
      (await results(monitor)).map((row) => [row.outcome, row.failure_reason]),
    ).toEqual([
      ["check_error", "internal_egress_failed"],
      ["check_error", "internal_egress_failed"],
    ]);
  });

  it("network failure with a working canary stays a failure and opens an incident", async () => {
    const canary = createEgressCanary({
      urls: ["https://canary.example.test"],
      probe: () => Promise.resolve(true),
    });
    const { monitor, states } = await refusedRun(canary);
    expect(states.map((state) => state.open)).toEqual([false, true]);
    expect((await results(monitor)).map((row) => row.failure_reason)).toEqual([
      "connect_refused",
      "connect_refused",
    ]);
  });

  it("without a canary the error code alone decides", async () => {
    const { monitor, states } = await refusedRun(undefined);
    expect(states.map((state) => state.open)).toEqual([false, true]);
    expect((await results(monitor))[0]?.outcome).toBe("fail");
  });

  it("a failing canary does not turn a target-side failure into check_error", async () => {
    const target = await startTarget((_request, response) => {
      response.statusCode = 503;
      response.end("down");
    });
    try {
      const canary = createEgressCanary({
        urls: ["https://canary.example.test"],
        probe: () => Promise.resolve(false),
      });
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await processMonitorCheck(monitor.job(), dependencies({ canary }));
      expect((await results(monitor))[0]).toMatchObject({
        outcome: "fail",
        failure_reason: "http_status",
      });
    } finally {
      await target.close();
    }
  });
});

describe("AC-62 and shutdown", () => {
  it("a host that resolves to 127.0.0.1 after save is blocked_address and never contacted", async () => {
    const listener = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `http://rebind.example.test:${String(listener.port)}/health`,
      });
      // Saved while public; by check time the name resolves to loopback.
      const deps = dependencies({
        outbound: { resolver: () => Promise.resolve(["127.0.0.1"]) },
      });
      for (const index of [0, 1]) {
        const token = randomUUID();
        await updateMonitor(
          db,
          monitor,
          "update monitor_schedule set claim_token = $2 where monitor_id = $1",
          [monitor.monitorId, token],
        );
        await processMonitorCheck(
          monitor.job({
            claimToken: token,
            scheduledFor: new Date(
              Date.now() - 60_000 * (index + 1),
            ).toISOString(),
          }),
          deps,
        );
      }

      expect(listener.requests).toHaveLength(0);
      expect(listener.connections()).toBe(0);
      const stored = await rows<{
        outcome: string;
        failure_reason: string;
        url_masked: string;
      }>(
        db,
        monitor,
        "select outcome, failure_reason, url_masked from monitor_check_results where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(stored.map((row) => [row.outcome, row.failure_reason])).toEqual([
        ["fail", "blocked_address"],
        ["fail", "blocked_address"],
      ]);
      expect(JSON.stringify(stored)).not.toContain("127.0.0.1");
      expect((await countAll(monitor)).incidents).toBe(1);
    } finally {
      await listener.close();
    }
  });

  it("an aborted check records nothing and keeps its claim (gap)", async () => {
    const target = await startTarget();
    target.setHandler(() => undefined);
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/hang` });
      const controller = new AbortController();
      const running = processMonitorCheck(
        monitor.job(),
        dependencies({ signal: controller.signal }),
      );
      while (target.requests.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      expect(await running).toBe("aborted");
      // The request itself is torn down, not just abandoned.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(target.closedConnections()).toBe(1);
      expect((await countAll(monitor)).results).toBe(0);
      expect(await claimToken(monitor)).toBe(monitor.claimToken);
    } finally {
      await target.close();
    }
  });
});

describe("retention of recorded data (AC-41)", () => {
  const DAY = 86_400_000;

  /** The fixed 30-day window can reach two months back; the owner adds a missing partition. */
  async function ensurePartition(at: Date): Promise<void> {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const end = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1),
    );
    const suffix = `${String(start.getUTCFullYear())}${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    for (const parent of ["monitor_check_results", "monitor_check_hourly"]) {
      const name = `${parent}_p${suffix}`;
      const exists = await db.owner.sql.query(
        "select to_regclass($1) as found",
        [`public.${name}`],
      );
      if ((exists.rows[0] as { found: string | null }).found === null) {
        await db.owner.sql.query(
          `create table ${name} partition of ${parent}
             for values from ('${start.toISOString()}') to ('${end.toISOString()}')`,
        );
        await db.owner.sql.query(
          `alter table ${name} enable row level security`,
        );
        await db.owner.sql.query(
          `alter table ${name} force row level security`,
        );
      }
    }
  }

  it("purge removes 31-day-old results and rollups, keeps 29-day-old ones and a 40-day-old open incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const old = new Date(Date.now() - 31 * DAY);
      const recent = new Date(Date.now() - 29 * DAY);
      await ensurePartition(old);
      await ensurePartition(recent);
      for (const scheduledFor of [old, recent]) {
        const token = randomUUID();
        await updateMonitor(
          db,
          monitor,
          "update monitor_schedule set claim_token = $2 where monitor_id = $1",
          [monitor.monitorId, token],
        );
        expect(
          await processMonitorCheck(
            monitor.job({
              claimToken: token,
              scheduledFor: scheduledFor.toISOString(),
            }),
            dependencies(),
          ),
        ).toBe("recorded");
      }
      await withTenantContextRaw(
        db.runtime,
        monitor.tenantId,
        async (client) => {
          const insert = `insert into monitor_incidents
           (monitor_id, tenant_id, started_at, ended_at, end_reason, start_reason)
           values ($1, $2, $3, $4, $5, 'http_status')`;
          const at = (days: number) => new Date(Date.now() - days * DAY);
          const args = [monitor.monitorId, monitor.tenantId];
          await client.query(insert, [...args, at(41), at(31), "recovered"]);
          await client.query(insert, [...args, at(35), at(29), "recovered"]);
          await client.query(insert, [...args, at(40), null, null]);
        },
      );

      for (let round = 0; round < 5; round += 1) {
        await purgeExpiredMonitorData(db.runtime, { limit: 100 });
      }

      const [kept] = await rows<{
        results: number;
        hourly: number;
        open: number;
        closed: number;
      }>(
        db,
        monitor,
        `select (select count(*)::int from monitor_check_results where monitor_id = $1) as results,
                (select count(*)::int from monitor_check_hourly where monitor_id = $1) as hourly,
                (select count(*)::int from monitor_incidents where monitor_id = $1 and ended_at is null) as open,
                (select count(*)::int from monitor_incidents where monitor_id = $1 and ended_at is not null) as closed`,
        [monitor.monitorId],
      );
      expect(kept).toEqual({ results: 1, hourly: 1, open: 1, closed: 1 });
      const [left] = await results(monitor);
      expect(left?.scheduled_for.toISOString()).toBe(recent.toISOString());
    } finally {
      await target.close();
    }
  });
});

describe("recorded rows carry no request data (AC-42)", () => {
  it("keeps no query value, request body, header or response body anywhere", async () => {
    const target = await startTarget((_request, response) => {
      response.statusCode = 200;
      response.setHeader("x-response-header", "resp-header-marker");
      response.end('{"secretField":"response-body-marker"}');
    });
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/p?url-query=url-query-marker`,
        method: "POST",
        queryParams: [{ name: "q", value: "param-query-marker" }],
        headers: [
          { name: "X-Custom", value: "request-header-marker", secret: false },
        ],
        assertions: [{ kind: "bodyContains", text: "response-body-marker" }],
      });
      await withTenantContextRaw(db.runtime, monitor.tenantId, (client) =>
        client.query(
          "update monitors set body_type = 'text', body_content = 'request-body-marker' where id = $1",
          [monitor.monitorId],
        ),
      );
      await processMonitorCheck(monitor.job(), dependencies());

      const everything = JSON.stringify([
        await rows(
          db,
          monitor,
          "select * from monitor_check_results where monitor_id = $1",
          [monitor.monitorId],
        ),
        await rows(
          db,
          monitor,
          "select * from monitor_check_hourly where monitor_id = $1",
          [monitor.monitorId],
        ),
        await rows(
          db,
          monitor,
          "select * from monitor_incidents where monitor_id = $1",
          [monitor.monitorId],
        ),
        await rows(
          db,
          monitor,
          "select * from monitor_events where monitor_id = $1",
          [monitor.monitorId],
        ),
      ]);
      for (const marker of [
        "url-query-marker",
        "param-query-marker",
        "request-header-marker",
        "request-body-marker",
        "resp-header-marker",
        "secretField",
      ]) {
        expect(everything).not.toContain(marker);
      }
      expect(target.requests[0]?.headers["x-custom"]).toBe(
        "request-header-marker",
      );
      // The assertion result holds the matched text only where the executor put it.
      const [row] = await results(monitor);
      expect(row?.outcome).toBe("pass");
    } finally {
      await target.close();
    }
  });
});

describe("assertion values and redirects on scheduled checks", () => {
  it("stores an assertion value cut at 200 characters and flags it (AC-17)", async () => {
    const target = await startTarget((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: "y".repeat(300) }));
    });
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        assertions: [
          {
            kind: "jsonPathEquals",
            path: "$.name",
            expected: "x",
            pathSegments: ["name"],
            expectedValue: "x",
          },
        ],
      });
      await processMonitorCheck(monitor.job(), dependencies());
      const [row] = await rows<{
        outcome: string;
        failure_reason: string;
        assertions: {
          actual: string;
          actualTruncated: boolean;
          status: string;
        }[];
      }>(
        db,
        monitor,
        "select outcome, failure_reason, assertions from monitor_check_results where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(row?.failure_reason).toBe("assertion_failed");
      expect(row?.assertions[0]?.actualTruncated).toBe(true);
      expect(row?.assertions[0]?.actual.length).toBeLessThanOrEqual(200);
      expect(row?.assertions[0]?.actual).toContain("yyyy");
    } finally {
      await target.close();
    }
  });

  it("a redirect to a forbidden address is redirect_blocked, counted as fail and never followed (AC-34)", async () => {
    const forbidden = await startTarget();
    const target = await startTarget((_request, response) => {
      response.statusCode = 302;
      // Not on the test allow-list, so it resolves to loopback and is refused.
      response.setHeader(
        "location",
        `http://internal.example.test:${String(forbidden.port)}/`,
      );
      response.end();
    });
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await processMonitorCheck(monitor.job(), dependencies());
      expect((await results(monitor))[0]).toMatchObject({
        outcome: "fail",
        failure_reason: "redirect_blocked",
      });
      expect(forbidden.connections()).toBe(0);
    } finally {
      await target.close();
      await forbidden.close();
    }
  });
});

describe("hourly rollup response times", () => {
  it("a timeout counts as a check but adds no response time", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        timeoutSeconds: 1,
        intervalSeconds: 60,
      });
      const hour =
        Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3 * 3_600_000;
      await runSteps(monitor, target, ["pass"], hour + 60_000);
      target.setHandler(() => undefined);
      const token = randomUUID();
      await updateMonitor(
        db,
        monitor,
        "update monitor_schedule set claim_token = $2 where monitor_id = $1",
        [monitor.monitorId, token],
      );
      await processMonitorCheck(
        monitor.job({
          claimToken: token,
          scheduledFor: new Date(hour + 120_000).toISOString(),
        }),
        dependencies(),
      );
      const [row] = await rows<{
        checks: number;
        covered_seconds: number;
        response_checks: number;
        response_ms_sum: string;
      }>(
        db,
        monitor,
        "select checks, covered_seconds, response_checks, response_ms_sum from monitor_check_hourly where monitor_id = $1",
        [monitor.monitorId],
      );
      const [timeout] = await results(monitor).then((all) => all.slice(-1));
      expect(timeout?.failure_reason).toBe("timeout");
      expect(row?.checks).toBe(2);
      expect(row?.covered_seconds).toBe(120);
      expect(row?.response_checks).toBe(1);
      const [pass] = await rows<{ ms: number }>(
        db,
        monitor,
        "select response_time_ms as ms from monitor_check_results where monitor_id = $1 and outcome = 'pass'",
        [monitor.monitorId],
      );
      expect(Number(row?.response_ms_sum)).toBe(pass?.ms);
    } finally {
      await target.close();
    }
  });
});

describe("shutdown signal listeners", () => {
  it("finished checks leave no abort listener on the shared signal", async () => {
    const target = await startTarget();
    try {
      const controller = new AbortController();
      const monitors = await Promise.all(
        Array.from({ length: 5 }, () =>
          seedMonitor(db, { url: `${target.url}/` }),
        ),
      );
      await Promise.all(
        monitors.map((monitor) =>
          processMonitorCheck(
            monitor.job(),
            dependencies({ signal: controller.signal }),
          ),
        ),
      );
      expect(target.requests).toHaveLength(5);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

      // Not vacuous: a check in flight does hold listeners on the signal.
      const held = Promise.withResolvers<undefined>();
      target.setHandler((_request, response) => {
        void held.promise.then(() => {
          response.end("ok");
        });
      });
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const running = processMonitorCheck(
        monitor.job(),
        dependencies({ signal: controller.signal }),
      );
      while (target.requests.length < 6) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        getEventListeners(controller.signal, "abort").length,
      ).toBeGreaterThan(0);
      held.resolve(undefined);
      await running;
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      await target.close();
    }
  });
});

describe("event feed rows (P58-01, P58-03, P58-04, P58-08)", () => {
  type FeedEvent = {
    kind: string;
    occurred_at: Date;
    failure_reason: string | null;
    tls_reason: string | null;
    http_status: number | null;
    response_time_ms: number | null;
  };
  const feedEvents = (monitor: SeededMonitor) =>
    rows<FeedEvent>(
      db,
      monitor,
      `select kind, occurred_at, failure_reason, tls_reason, http_status,
              response_time_ms
       from monitor_events where monitor_id = $1 order by occurred_at, kind`,
      [monitor.monitorId],
    );

  /** One check at `startAt + index` minutes; the clock of the check is `checkedAt`. */
  async function check(
    monitor: SeededMonitor,
    index: number,
    checkedAt?: Date,
  ): Promise<string> {
    const token = randomUUID();
    await updateMonitor(
      db,
      monitor,
      "update monitor_schedule set claim_token = $2 where monitor_id = $1",
      [monitor.monitorId, token],
    );
    return processMonitorCheck(
      monitor.job({
        claimToken: token,
        scheduledFor: new Date(
          Date.now() - 3_600_000 + index * 60_000,
        ).toISOString(),
      }),
      dependencies(checkedAt ? { clock: () => checkedAt } : {}),
    );
  }

  it("pass, fail, pass writes one check_failed at checkedAt and no incident", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      let status = 200;
      target.setHandler((_request, response) => {
        response.statusCode = status;
        response.end("body");
      });
      await check(monitor, 0);
      status = 503;
      const checkedAt = new Date(Date.now() - 1_234_000);
      await check(monitor, 1, checkedAt);
      status = 200;
      await check(monitor, 2);
      const events = await feedEvents(monitor);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "check_failed",
        failure_reason: "http_status",
        tls_reason: null,
        http_status: 503,
      });
      expect(events[0]?.response_time_ms).not.toBeNull();
      expect(events[0]?.occurred_at.getTime()).toBe(checkedAt.getTime());
      expect((await countAll(monitor)).incidents).toBe(0);
    } finally {
      await target.close();
    }
  });

  it("pass, fail, fail, pass writes check_failed once and closes with the passing status and time", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      let status = 200;
      target.setHandler((_request, response) => {
        response.statusCode = status;
        response.end("body");
      });
      await check(monitor, 0);
      status = 503;
      await check(monitor, 1);
      await check(monitor, 2);
      await check(monitor, 3);
      status = 200;
      await check(monitor, 4);
      expect((await feedEvents(monitor)).map((event) => event.kind)).toEqual([
        "check_failed",
      ]);
      const [incident] = await rows<{
        end_reason: string;
        end_http_status: number | null;
        end_response_time_ms: number | null;
      }>(
        db,
        monitor,
        `select end_reason, end_http_status, end_response_time_ms
         from monitor_incidents where monitor_id = $1`,
        [monitor.monitorId],
      );
      expect(incident).toMatchObject({
        end_reason: "recovered",
        end_http_status: 200,
      });
      const [passing] = await rows<{ response_time_ms: number }>(
        db,
        monitor,
        `select response_time_ms from monitor_check_results
         where monitor_id = $1 order by scheduled_for desc limit 1`,
        [monitor.monitorId],
      );
      expect(incident?.end_response_time_ms).toBe(passing?.response_time_ms);
    } finally {
      await target.close();
    }
  });

  it("a fail after a check_error still starts the streak with check_failed, a check_error writes none", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      target.setHandler((_request, response) => {
        response.statusCode = 503;
        response.end("body");
      });
      const token = randomUUID();
      await updateMonitor(
        db,
        monitor,
        "update monitor_schedule set claim_token = $2 where monitor_id = $1",
        [monitor.monitorId, token],
      );
      await processMonitorCheck(
        monitor.job({ claimToken: token }),
        dependencies({
          outbound: {
            ...outboundDeps,
            resolver: () =>
              Promise.reject(
                Object.assign(new Error("resolver"), { code: "EAI_AGAIN" }),
              ),
          },
        }),
      );
      expect(await feedEvents(monitor)).toEqual([]);
      const [last] = await rows<{
        outcome: string;
        http_status: number | null;
        body_kind: string | null;
      }>(
        db,
        monitor,
        "select outcome, http_status, body_kind from monitor_last_responses where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(last).toEqual({
        outcome: "check_error",
        http_status: null,
        body_kind: null,
      });
      await check(monitor, 5);
      expect((await feedEvents(monitor)).map((event) => event.kind)).toEqual([
        "check_failed",
      ]);
    } finally {
      await target.close();
    }
  });

  it("an edit that resets the streak during an open incident adds no check_failed", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      target.setHandler((_request, response) => {
        response.statusCode = 503;
        response.end("body");
      });
      await check(monitor, 0);
      await check(monitor, 1);
      await updateMonitor(
        db,
        monitor,
        "update monitors set consecutive_failures = 0 where id = $1",
        [monitor.monitorId],
      );
      await check(monitor, 2);
      expect((await feedEvents(monitor)).map((event) => event.kind)).toEqual([
        "check_failed",
      ]);
    } finally {
      await target.close();
    }
  });

  it("stores the snapshot of the latest check in one row per monitor", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      target.setHandler((_request, response) => {
        response.statusCode = 200;
        response.setHeader("content-type", "text/plain");
        response.setHeader("x-trace", "abc");
        response.end("hello");
      });
      await check(monitor, 0);
      await check(monitor, 1);
      const stored = await rows<{
        http_version: string;
        http_status: number;
        reason_phrase: string | null;
        headers: { name: string; value: string }[];
        body_kind: string;
        body_text: string;
        body_truncated: boolean;
        body_bytes_read: number;
        body_omitted_reason: string | null;
        detail_omitted: string | null;
        config_version: number;
        outcome: string;
        scheduled_for: Date;
        failure_reason: string | null;
        headers_truncated: boolean;
        url_masked: string;
        checked_at: Date;
      }>(
        db,
        monitor,
        "select * from monitor_last_responses where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        http_version: "HTTP/1.1",
        http_status: 200,
        body_kind: "text",
        body_text: "hello",
        body_truncated: false,
        body_bytes_read: 5,
        body_omitted_reason: null,
        detail_omitted: null,
        config_version: 1,
        outcome: "pass",
        reason_phrase: "OK",
        headers_truncated: false,
        failure_reason: null,
      });
      expect(stored[0]?.url_masked).toBe(
        (await results(monitor))[1]?.url_masked,
      );
      expect(stored[0]?.checked_at.getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
      expect(stored[0]?.headers).toContainEqual(
        expect.objectContaining({ name: "x-trace", value: "abc" }),
      );
      expect(stored[0]?.scheduled_for.getTime()).toBe(
        (await results(monitor))[1]?.scheduled_for.getTime(),
      );
    } finally {
      await target.close();
    }
  });

  it("a monitor with a query keeps only version and status (request_values)", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, {
        url: `${target.url}/`,
        queryParams: [{ name: "key", value: "s3cret-query" }],
      });
      target.setHandler((request, response) => {
        response.statusCode = 200;
        response.setHeader("x-echo", request.url ?? "");
        response.end(request.url ?? "");
      });
      await check(monitor, 0);
      const [stored] = await rows<{
        detail_omitted: string;
        http_status: number;
        reason_phrase: string | null;
        headers: unknown[];
        headers_truncated: boolean;
        body_kind: string;
        body_omitted_reason: string;
        body_text: string | null;
      }>(
        db,
        monitor,
        "select * from monitor_last_responses where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(stored).toMatchObject({
        detail_omitted: "request_values",
        http_status: 200,
        reason_phrase: null,
        headers: [],
        headers_truncated: false,
        body_kind: "omitted",
        body_omitted_reason: "request_values",
        body_text: null,
      });
      expect(JSON.stringify(stored)).not.toContain("s3cret-query");
    } finally {
      await target.close();
    }
  });

  it("a late result does not replace a newer last response", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      let status = 200;
      target.setHandler((_request, response) => {
        response.statusCode = status;
        response.end("body");
      });
      await check(monitor, 5);
      status = 503;
      await check(monitor, 3);
      const [stored] = await rows<{ http_status: number; outcome: string }>(
        db,
        monitor,
        "select http_status, outcome from monitor_last_responses where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(stored).toEqual({ http_status: 200, outcome: "pass" });
      expect((await countAll(monitor)).results).toBe(2);
    } finally {
      await target.close();
    }
  });

  it("a discarded fail leaves the last response and the feed unchanged", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      target.setHandler((_request, response) => {
        response.statusCode = 200;
        response.end("body");
      });
      await check(monitor, 5);
      const before = await rows<Record<string, unknown>>(
        db,
        monitor,
        "select * from monitor_last_responses where monitor_id = $1",
        [monitor.monitorId],
      );
      // A fail is in flight when an Edit supersedes the claim.
      const release = Promise.withResolvers<undefined>();
      target.setHandler((_request, response) => {
        void release.promise.then(() => {
          response.statusCode = 503;
          response.end("body");
        });
      });
      const token = randomUUID();
      await updateMonitor(
        db,
        monitor,
        "update monitor_schedule set claim_token = $2 where monitor_id = $1",
        [monitor.monitorId, token],
      );
      const running = processMonitorCheck(
        monitor.job({
          claimToken: token,
          scheduledFor: new Date(Date.now()).toISOString(),
        }),
        dependencies(),
      );
      const started = Date.now();
      while (target.requests.length < 2 && Date.now() - started < 4_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await updateMonitor(
        db,
        monitor,
        `update monitor_schedule set claim_token = null where monitor_id = $1`,
        [monitor.monitorId],
      );
      release.resolve(undefined);
      const outcome = await running;
      expect(outcome).toBe("discarded");
      expect(await feedEvents(monitor)).toEqual([]);
      expect(
        await rows<Record<string, unknown>>(
          db,
          monitor,
          "select * from monitor_last_responses where monitor_id = $1",
          [monitor.monitorId],
        ),
      ).toEqual(before);
    } finally {
      await target.close();
    }
  });

  it("a runCheck that rejects still overwrites the last response with a body-free check_error", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      target.setHandler((_request, response) => {
        response.statusCode = 200;
        response.end("from-the-target");
      });
      await check(monitor, 0);
      const token = randomUUID();
      await updateMonitor(
        db,
        monitor,
        "update monitor_schedule set claim_token = $2 where monitor_id = $1",
        [monitor.monitorId, token],
      );
      // The first clock read is inside runCheck and rejects it; the fallback reads again.
      let reads = 0;
      const outcome = await processMonitorCheck(
        monitor.job({
          claimToken: token,
          scheduledFor: new Date(Date.now() - 60_000).toISOString(),
        }),
        dependencies({
          clock: () => {
            if (reads++ === 0) throw new Error("clock failed");
            return new Date();
          },
        }),
      );
      expect(outcome).toBe("recorded");
      expect(reads).toBeGreaterThan(1);
      const [stored] = await rows<Record<string, unknown>>(
        db,
        monitor,
        "select * from monitor_last_responses where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(stored).toMatchObject({
        outcome: "check_error",
        failure_reason: "executor_error",
        detail_omitted: null,
        http_version: null,
        http_status: null,
        reason_phrase: null,
        headers: [],
        headers_truncated: false,
        body_kind: null,
        body_text: null,
      });
      expect(JSON.stringify(stored)).not.toContain("from-the-target");
    } finally {
      await target.close();
    }
  });
});
