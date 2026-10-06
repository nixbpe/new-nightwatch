import { monitorResponseTimesResponseSchema } from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getResponseTimes } from "./read-service";

import {
  ageSeries,
  seedEvent,
  seedHourly,
  seedMonitor,
  seedResults,
  seedResponseSamples,
} from "./read-test-support";
import {
  monitorsPath,
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
  type TestRole,
} from "./test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  await ctx.owner.sql.query("select ensure_monitor_partitions(3)");
  org = await ctx.createOrganization("times");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

async function series(id: string, range?: string, role: TestRole = "viewer") {
  const response = await ctx.call(
    org.users[role],
    "GET",
    monitorsPath(
      org.id,
      `/${id}/response-times${range ? `?range=${range}` : ""}`,
    ),
  );
  expect(response.status).toBe(200);
  return monitorResponseTimesResponseSchema.parse(response.json);
}

const seconds = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 1000;

/** The database hour, so expectations do not use the test clock. */
async function currentHour(): Promise<number> {
  const result = await ctx.owner.sql.query<{ hour: Date }>(
    "select date_trunc('hour', now()) as hour",
  );
  const row = result.rows[0];
  if (!row) throw new Error("no database time");
  return row.hour.getTime();
}

describe("24 h", () => {
  it("returns one point per check and one 600 s gap when the Worker was down for 10 minutes", async () => {
    const id = await seedMonitor(ctx, org.id, { intervalSeconds: 60 });
    // Ages 3,600 s down to 1,800 s, then 1,200 s down to 60 s, every minute.
    await seedResults(
      ctx,
      org.id,
      id,
      [...ageSeries(31, 60, 1800), ...ageSeries(20, 60, 60)],
      { intervalSeconds: 60 },
    );
    const body = await series(id, "24h");
    if (body.range !== "24h") throw new Error("expected the 24 h shape");
    expect(body.points).toHaveLength(51);
    expect(body.gaps).toHaveLength(1);
    const [gap] = body.gaps;
    expect(seconds(gap?.from ?? "", gap?.to ?? "")).toBeCloseTo(600, -1);
  });

  it("a check_error between two results does not fill a gap, but is a point", async () => {
    const id = await seedMonitor(ctx, org.id, { intervalSeconds: 60 });
    await seedResults(ctx, org.id, id, [3000, 1800], { intervalSeconds: 60 });
    await seedResults(ctx, org.id, id, [2400], {
      outcome: "check_error",
      intervalSeconds: 60,
      responseTimeMs: null,
    });
    const body = await series(id);
    if (body.range !== "24h") throw new Error("expected the 24 h shape");
    expect(body.points.map((point) => point.outcome)).toEqual([
      "pass",
      "check_error",
      "pass",
    ]);
    expect(body.points[1]?.responseTimeMs).toBeNull();
    expect(body.gaps).toHaveLength(1);
    expect(
      seconds(body.gaps[0]?.from ?? "", body.gaps[0]?.to ?? ""),
    ).toBeCloseTo(1200, -1);
  });

  it("a pause is reported and is not a gap", async () => {
    const id = await seedMonitor(ctx, org.id, { intervalSeconds: 60 });
    await seedEvent(ctx, org.id, id, "paused", 3000);
    await seedEvent(ctx, org.id, id, "resumed", 1200);
    // Last check before the pause 3,060 s ago, first at Resume 1,200 s ago.
    await seedResults(
      ctx,
      org.id,
      id,
      [...ageSeries(10, 60, 3060), ...ageSeries(20, 60, 60)],
      { intervalSeconds: 60 },
    );
    const body = await series(id);
    if (body.range !== "24h") throw new Error("expected the 24 h shape");
    expect(body.pauses).toHaveLength(1);
    const [pause] = body.pauses;
    expect(seconds(pause?.from ?? "", pause?.to ?? "")).toBeCloseTo(1800, -1);
    expect(body.gaps).toEqual([]);
  });

  it("a monitor paused for the whole window has a pause and no points", async () => {
    const id = await seedMonitor(ctx, org.id, { status: "paused" });
    await seedEvent(ctx, org.id, id, "paused", 40 * 86_400);
    const body = await series(id);
    if (body.range !== "24h") throw new Error("expected the 24 h shape");
    expect(body.points).toEqual([]);
    expect(body.gaps).toEqual([]);
    expect(body.pauses).toHaveLength(1);
    expect(
      seconds(body.pauses[0]?.from ?? "", body.pauses[0]?.to ?? ""),
    ).toBeCloseTo(86_400, -1);
  });

  it("caps the points at 1,440 and keeps the newest", async () => {
    const id = await seedMonitor(ctx, org.id, { intervalSeconds: 60 });
    // All 1,500 checks are inside 24 h; only the newest 1,440 survive.
    await seedResults(ctx, org.id, id, ageSeries(1500, 30, 30), {
      intervalSeconds: 60,
    });
    const body = await series(id);
    if (body.range !== "24h") throw new Error("expected the 24 h shape");
    expect(body.points).toHaveLength(1440);
    const oldest = body.points[0];
    const newest = body.points[body.points.length - 1];
    expect(seconds(oldest?.at ?? "", newest?.at ?? "")).toBeCloseTo(
      1439 * 30,
      -1,
    );
    expect(body.gaps).toEqual([]);
  });

  it("is the default range", async () => {
    const id = await seedMonitor(ctx, org.id);
    expect((await series(id)).range).toBe("24h");
  });
});

describe("7 d and 30 d", () => {
  it("returns 168 and 720 hourly buckets with empty hours as null", async () => {
    const id = await seedMonitor(ctx, org.id, { intervalSeconds: 60 });
    const base = await currentHour();
    const samples = (hoursAgo: number, values: (number | null)[], failed = 0) =>
      seedResponseSamples(
        ctx,
        org.id,
        id,
        values.map((value, index) => ({
          scheduledFor: new Date(
            base - hoursAgo * 3_600_000 + index * 1000,
          ).toISOString(),
          outcome: index < failed ? "fail" : "pass",
          responseTimeMs: value,
        })),
      );
    await samples(1, [...Array<number>(59).fill(100), 300], 2);
    await samples(3, [200, 400, null, null]);
    await samples(5, [null, null, null], 3);
    const hour = await currentHour();

    const week = await series(id, "7d");
    if (week.range !== "7d") throw new Error("expected the 7 d shape");
    expect(week.buckets).toHaveLength(168);
    expect(week.buckets[0]?.hourStart).toBe(
      new Date(hour - 167 * 3_600_000).toISOString(),
    );
    expect(week.buckets[167]?.hourStart).toBe(new Date(hour).toISOString());
    const at = (hoursAgo: number) =>
      week.buckets.find(
        (bucket) =>
          bucket.hourStart ===
          new Date(hour - hoursAgo * 3_600_000).toISOString(),
      );
    expect(at(1)).toMatchObject({
      avgMs: 103.33,
      maxMs: 300,
      checks: 60,
      responseChecks: 60,
    });
    expect(at(3)).toMatchObject({
      avgMs: 300,
      maxMs: 400,
      checks: 4,
      responseChecks: 2,
    });
    expect(at(5)).toMatchObject({
      avgMs: null,
      maxMs: null,
      checks: 3,
      responseChecks: 0,
    });
    expect(at(2)).toMatchObject({
      avgMs: null,
      maxMs: null,
      checks: 0,
      responseChecks: 0,
    });
    expect(at(0)).toMatchObject({ avgMs: null, maxMs: null, checks: 0 });

    const month = await series(id, "30d");
    if (month.range !== "30d") throw new Error("expected the 30 d shape");
    expect(month.buckets).toHaveLength(720);
    expect(month.buckets[719]?.hourStart).toBe(new Date(hour).toISOString());
  });

  it("does not return the hour that starts before the rounded window", async () => {
    const id = await seedMonitor(ctx, org.id);
    const hour = await currentHour();
    await seedResponseSamples(
      ctx,
      org.id,
      id,
      [168, 167].map((hoursAgo) => ({
        scheduledFor: new Date(hour - hoursAgo * 3_600_000).toISOString(),
        outcome: "pass",
        responseTimeMs: 10,
      })),
    );
    const week = await series(id, "7d");
    if (week.range !== "7d") throw new Error("expected the 7 d shape");
    expect(week.buckets[0]).toMatchObject({
      hourStart: new Date(hour - 167 * 3_600_000).toISOString(),
      checks: 1,
    });
    expect(week.buckets.reduce((sum, bucket) => sum + bucket.checks, 0)).toBe(
      1,
    );
  });

  it("reports a pause inside the range; the paused hours stay null while measured hours keep their values", async () => {
    const id = await seedMonitor(ctx, org.id);
    await seedEvent(ctx, org.id, id, "paused", 5 * 3600);
    await seedEvent(ctx, org.id, id, "resumed", 3 * 3600);
    const base = await currentHour();
    await seedResponseSamples(
      ctx,
      org.id,
      id,
      Array.from({ length: 12 }, (_, index) => ({
        scheduledFor: new Date(
          base - 10 * 3_600_000 + index * 1000,
        ).toISOString(),
        outcome: "pass",
        responseTimeMs: index === 0 ? 150 : index === 1 ? 50 : 100,
      })),
    );
    const week = await series(id, "7d");
    expect(week.pauses).toHaveLength(1);
    expect(
      seconds(week.pauses[0]?.from ?? "", week.pauses[0]?.to ?? ""),
    ).toBeCloseTo(2 * 3600, -1);
    if (week.range !== "7d") throw new Error("expected the 7 d shape");
    const hour = await currentHour();
    const measured = week.buckets.filter((bucket) => bucket.avgMs !== null);
    expect(measured).toEqual([
      {
        hourStart: new Date(hour - 10 * 3_600_000).toISOString(),
        avgMs: 100,
        maxMs: 150,
        checks: 12,
        responseChecks: 12,
      },
    ]);
    for (const hoursAgo of [3, 4, 5]) {
      expect(
        week.buckets.find(
          (bucket) =>
            bucket.hourStart ===
            new Date(hour - hoursAgo * 3_600_000).toISOString(),
        ),
      ).toMatchObject({ avgMs: null, maxMs: null, checks: 0 });
    }
  });
});

describe("config changes", () => {
  it("marks URL changes with the masked URL and other changes without one, inside the range only", async () => {
    const id = await seedMonitor(ctx, org.id);
    const masked = "https://times.example/health?token=•••";
    await seedEvent(ctx, org.id, id, "config_changed", 2 * 86_400, masked);
    await seedEvent(ctx, org.id, id, "config_changed", 3600, masked);
    await seedEvent(ctx, org.id, id, "config_changed", 1800, null);
    const day = await series(id, "24h");
    expect(day.configChanges.map((change) => change.urlChanged)).toEqual([
      true,
      false,
    ]);
    expect(day.configChanges[0]).toMatchObject({ url: masked });
    expect(day.configChanges[1]).not.toHaveProperty("url");
    const week = await series(id, "7d");
    expect(week.configChanges).toHaveLength(3);
    const times = week.configChanges.map((change) => change.at);
    expect([...times].sort()).toEqual(times);
  });
});

describe("Response times: access", () => {
  let id: string;

  beforeAll(async () => {
    id = await seedMonitor(ctx, org.id, { name: "Secret Name" });
  });

  // Every role can read, a non-member is denied like a missing Organization,
  // and a missing/malformed/foreign id answers 404: read-detail.db.test.ts's
  // "Detail, Checks and Incidents: access" suffixes loop covers this route too.

  it("rejects an unknown range", async () => {
    const response = await ctx.call(
      org.users.viewer,
      "GET",
      monitorsPath(org.id, `/${id}/response-times?range=1y`),
    );
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({ error: { code: "INVALID_INPUT" } });
  });
});

function atClock(
  now: Date,
  before?: () => Promise<void>,
  after?: () => Promise<void>,
  timezone?: string,
) {
  const sql = new Proxy(ctx.runtime.sql, {
    get(target, property) {
      if (property === "connect")
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(connection, key) {
              if (key === "query")
                return async (text: string, values?: unknown[]) => {
                  if (text === "select now() as now") {
                    if (timezone)
                      await connection.query(
                        "select set_config('TimeZone', $1, true)",
                        [timezone],
                      );
                    const result = await connection.query(text, values);
                    return { ...result, rows: [{ now }] };
                  }
                  if (text.startsWith("with response_monitor")) {
                    await before?.();
                    const result = await connection.query(text, values);
                    await after?.();
                    return result;
                  }
                  return connection.query(text, values);
                };
              const value: unknown = Reflect.get(connection, key);
              return typeof value === "function"
                ? value.bind(connection)
                : value;
            },
          });
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...ctx.runtime, sql };
}

async function fixedSeries(
  id: string,
  range: "24h" | "7d" | "30d",
  now: Date,
  before?: () => Promise<void>,
  after?: () => Promise<void>,
) {
  return monitorResponseTimesResponseSchema.parse(
    await getResponseTimes(
      atClock(now, before, after),
      { organizationId: org.id, actorUserId: org.users.viewer },
      id,
      range,
    ),
  );
}

describe("exact raw populations", () => {
  it.each(["7d", "30d"] as const)(
    "%s uses nearest-rank over measured samples including measured errors",
    async (range) => {
      const id = await seedMonitor(ctx, org.id);
      const now = new Date(await currentHour());
      await seedResponseSamples(
        ctx,
        org.id,
        id,
        [10, 20, 30, 40, null].map((ms, index) => ({
          scheduledFor: new Date(
            now.getTime() - (index + 1) * 1000,
          ).toISOString(),
          outcome:
            index === 2
              ? "check_error"
              : index === 1 || index === 4
                ? "fail"
                : "pass",
          responseTimeMs: ms,
        })),
      );
      const body = await fixedSeries(id, range, now);
      if (body.range === "24h") throw new Error("long shape expected");
      expect(body.summary).toEqual({
        p50Ms: 20,
        p95Ms: 40,
        checks: 4,
        failed: 2,
      });
      expect(body.buckets.filter((bucket) => bucket.checks > 0)).toEqual([
        {
          hourStart: new Date(now.getTime() - 3_600_000).toISOString(),
          avgMs: 23.33,
          maxMs: 40,
          checks: 4,
          responseChecks: 3,
        },
      ]);
      expect(body.window.to).toBe(body.dataAsOf);
    },
  );

  it.each([
    {
      values: [],
      outcome: "pass",
      expected: { p50Ms: null, p95Ms: null, checks: 0, failed: 0 },
    },
    {
      values: [0],
      outcome: "pass",
      expected: { p50Ms: 0, p95Ms: 0, checks: 1, failed: 0 },
    },
    {
      values: [0, 0, 10],
      outcome: "fail",
      expected: { p50Ms: 0, p95Ms: 10, checks: 3, failed: 3 },
    },
    {
      values: [null, null],
      outcome: "fail",
      expected: { p50Ms: null, p95Ms: null, checks: 2, failed: 2 },
    },
    {
      values: [null],
      outcome: "check_error",
      expected: { p50Ms: null, p95Ms: null, checks: 0, failed: 0 },
    },
    {
      values: [25],
      outcome: "check_error",
      expected: { p50Ms: 25, p95Ms: 25, checks: 0, failed: 0 },
    },
  ] satisfies {
    values: (number | null)[];
    outcome: "pass" | "fail" | "check_error";
    expected: {
      p50Ms: number | null;
      p95Ms: number | null;
      checks: number;
      failed: number;
    };
  }[])(
    "preserves $outcome measurement semantics for $values",
    async ({ values, outcome, expected }) => {
      const id = await seedMonitor(ctx, org.id);
      const now = new Date(await currentHour());
      await seedResponseSamples(
        ctx,
        org.id,
        id,
        values.map((ms, index) => ({
          scheduledFor: new Date(
            now.getTime() - (index + 1) * 1000,
          ).toISOString(),
          outcome,
          responseTimeMs: ms,
        })),
      );
      const body = await fixedSeries(id, "7d", now);
      if (body.range === "24h") throw new Error("long shape expected");
      expect(body.summary).toEqual(expected);
      expect(body.buckets.reduce((sum, bucket) => sum + bucket.checks, 0)).toBe(
        expected.checks,
      );
      expect(body.summary.failed).toBeLessThanOrEqual(body.summary.checks);
    },
  );

  it("weights unequal hourly populations and ignores retained rollups with missing raw history", async () => {
    const id = await seedMonitor(ctx, org.id);
    const now = new Date(await currentHour());
    await seedResponseSamples(
      ctx,
      org.id,
      id,
      [10, 10, 10, 100].map((ms, index) => ({
        scheduledFor: new Date(
          now.getTime() - (index === 3 ? 7200 : 3600 + index) * 1000,
        ).toISOString(),
        outcome: "pass",
        responseTimeMs: ms,
      })),
    );
    await seedHourly(ctx, org.id, id, [3], {
      checks: 99,
      passed: 0,
      coveredSeconds: 3600,
      responseMsSum: 9999,
      responseMsMax: 9999,
    });
    const body = await fixedSeries(id, "30d", now);
    if (body.range === "24h") throw new Error("long shape expected");
    expect(body.summary).toEqual({
      p50Ms: 10,
      p95Ms: 100,
      checks: 4,
      failed: 0,
    });
    expect(body.buckets.reduce((sum, bucket) => sum + bucket.checks, 0)).toBe(
      4,
    );
  });

  it.each(["24h", "7d", "30d"] as const)(
    "%s includes scheduled boundaries despite checked timestamps crossing them",
    async (range) => {
      const id = await seedMonitor(ctx, org.id, { createdAgoSeconds: 60 });
      const now = new Date(await currentHour());
      const duration =
        range === "24h"
          ? 86400_000
          : range === "7d"
            ? 7 * 86400_000
            : 30 * 86400_000;
      const start = now.getTime() - duration;
      await seedResponseSamples(
        ctx,
        org.id,
        id,
        [
          start - 1,
          start,
          start + 1,
          now.getTime() - 1,
          now.getTime(),
          now.getTime() + 1,
        ].map((time, index) => ({
          scheduledFor: new Date(time).toISOString(),
          checkedAt: new Date(
            index < 3 ? start - 1000 : now.getTime() + 1000,
          ).toISOString(),
          outcome: "pass",
          responseTimeMs: (index + 1) * 10,
        })),
      );
      const body = await fixedSeries(id, range, now);
      expect(body.window).toEqual({
        from: new Date(start).toISOString(),
        to: now.toISOString(),
      });
      if (body.range === "24h") {
        expect(body.points.map((point) => point.responseTimeMs)).toEqual([
          20, 30, 40, 50,
        ]);
        expect(body.points.map((point) => point.at)).toEqual([
          new Date(start - 1000).toISOString(),
          new Date(start - 1000).toISOString(),
          new Date(now.getTime() + 1000).toISOString(),
          new Date(now.getTime() + 1000).toISOString(),
        ]);
      } else {
        expect(body.summary).toEqual({
          p50Ms: 30,
          p95Ms: 50,
          checks: 4,
          failed: 0,
        });
        expect(body.buckets).toHaveLength(range === "7d" ? 169 : 721);
        expect(body.buckets.at(-1)).toEqual({
          hourStart: now.toISOString(),
          avgMs: 50,
          maxMs: 50,
          checks: 1,
          responseChecks: 1,
        });
      }
    },
  );

  it("uses explicit UTC hours in a non-UTC database session and rounds a middle-hour start upwards", async () => {
    const id = await seedMonitor(ctx, org.id);
    const hour = await currentHour();
    const now = new Date(hour + 1234);
    await seedResponseSamples(ctx, org.id, id, [
      {
        scheduledFor: new Date(hour).toISOString(),
        outcome: "pass",
        responseTimeMs: 17,
      },
    ]);
    const body = await getResponseTimes(
      atClock(now, undefined, undefined, "Asia/Kathmandu"),
      { organizationId: org.id, actorUserId: org.users.viewer },
      id,
      "7d",
    );
    if (body.range === "24h") throw new Error("long shape expected");
    expect(body.window.from).toBe(
      new Date(hour - 167 * 3600_000).toISOString(),
    );
    expect(body.buckets.at(-1)).toEqual({
      hourStart: new Date(hour).toISOString(),
      avgMs: 17,
      maxMs: 17,
      checks: 1,
      responseChecks: 1,
    });
  });

  it("caps before outcome filtering and leaves long ranges uncapped", async () => {
    const id = await seedMonitor(ctx, org.id);
    const now = new Date(await currentHour());
    await seedResponseSamples(
      ctx,
      org.id,
      id,
      Array.from({ length: 1500 }, (_, index) => ({
        scheduledFor: new Date(now.getTime() - index * 1000).toISOString(),
        outcome: index < 10 ? "check_error" : "fail",
        responseTimeMs: index < 10 ? null : index,
      })),
    );
    const day = await fixedSeries(id, "24h", now);
    if (day.range !== "24h") throw new Error("point shape expected");
    expect(day.points).toHaveLength(1440);
    expect(day.points[0]?.responseTimeMs).toBe(1439);
    expect(day.points.filter((point) => point.outcome === "fail")).toHaveLength(
      1430,
    );
    const week = await fixedSeries(id, "7d", now);
    if (week.range === "24h") throw new Error("long shape expected");
    expect(week.summary).toEqual({
      p50Ms: 754,
      p95Ms: 1425,
      checks: 1490,
      failed: 1490,
    });
  });
});

describe("statement state coherence", () => {
  it.each(["paused", "resumed"] as const)(
    "rewinds a %s transition after T and excludes future config events",
    async (kind) => {
      const id = await seedMonitor(ctx, org.id, {
        status: kind === "paused" ? "active" : "paused",
      });
      const now = new Date(await currentHour());
      const body = await fixedSeries(id, "7d", now, async () => {
        const client = await ctx.owner.sql.connect();
        try {
          await client.query("begin");
          await client.query("update monitors set status = $2 where id = $1", [
            id,
            kind === "paused" ? "paused" : "active",
          ]);
          await client.query(
            `insert into monitor_events (monitor_id, tenant_id, kind, occurred_at)
          values ($1,$2,$3,$4), ($1,$2,'config_changed',$4)`,
            [id, org.id, kind, new Date(now.getTime() + 1)],
          );
          await client.query("commit");
        } finally {
          client.release();
        }
      });
      expect(body.configChanges).toEqual([]);
      expect(body.pauses).toEqual(
        kind === "paused"
          ? []
          : [{ from: body.window.from, to: now.toISOString() }],
      );
    },
  );

  it("rewinds a post-T transition within the same serialized millisecond", async () => {
    const id = await seedMonitor(ctx, org.id, { status: "paused" });
    const now = new Date(await currentHour());
    await ctx.owner.sql.query(
      `insert into monitor_events (monitor_id, tenant_id, kind, occurred_at)
      values ($1, $2, 'paused', $3::timestamptz + interval '1 microsecond')`,
      [id, org.id, now],
    );
    const body = await fixedSeries(id, "7d", now);
    expect(body.pauses).toEqual([]);
    expect(body.window.to).toBe(now.toISOString());
  });

  it.each(["insert", "purge", "delete", "paused", "resumed"] as const)(
    "sees coherent before and after states around concurrent %s commit",
    async (mutation) => {
      const id = await seedMonitor(ctx, org.id, {
        status: mutation === "resumed" ? "paused" : "active",
      });
      const now = new Date(await currentHour());
      await seedResponseSamples(ctx, org.id, id, [
        {
          scheduledFor: new Date(now.getTime() - 1000).toISOString(),
          outcome: "pass",
          responseTimeMs: 10,
        },
      ]);
      const writer = await ctx.owner.sql.connect();
      try {
        const before = await fixedSeries(
          id,
          "7d",
          now,
          async () => {
            await writer.query("begin");
            if (mutation === "insert") {
              await writer.query(
                `insert into monitor_check_results
            (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms, failure_reason, assertions, url_masked, check_config_version, interval_seconds)
            values ($1,$2,$3,$3,'fail',30,'http_status','[]','https://fixture.example',1,60)`,
                [id, org.id, now],
              );
            } else if (mutation === "purge") {
              await writer.query(
                "delete from monitor_check_results where monitor_id = $1",
                [id],
              );
            } else if (mutation === "delete") {
              await writer.query("delete from monitors where id = $1", [id]);
            } else {
              await writer.query(
                "update monitors set status = $2 where id = $1",
                [id, mutation === "paused" ? "paused" : "active"],
              );
              await writer.query(
                "insert into monitor_events (monitor_id,tenant_id,kind,occurred_at) values ($1,$2,$3,$4)",
                [id, org.id, mutation, new Date(now.getTime() - 500)],
              );
            }
          },
          async () => {
            await writer.query("commit");
          },
        );
        if (before.range === "24h") throw new Error("long shape expected");
        expect(before.summary).toEqual({
          p50Ms: 10,
          p95Ms: 10,
          checks: 1,
          failed: 0,
        });
        expect(
          before.buckets.reduce((sum, bucket) => sum + bucket.checks, 0),
        ).toBe(1);
        expect(before.pauses).toEqual(
          mutation === "resumed"
            ? [{ from: before.window.from, to: now.toISOString() }]
            : [],
        );
        if (mutation === "delete") {
          await expect(fixedSeries(id, "7d", now)).rejects.toMatchObject({
            statusCode: 404,
            code: "MONITOR_NOT_FOUND",
          });
        } else {
          const after = await fixedSeries(id, "7d", now);
          if (after.range === "24h") throw new Error("long shape expected");
          expect(after.summary).toEqual(
            mutation === "insert"
              ? { p50Ms: 10, p95Ms: 30, checks: 2, failed: 1 }
              : mutation === "purge"
                ? { p50Ms: null, p95Ms: null, checks: 0, failed: 0 }
                : { p50Ms: 10, p95Ms: 10, checks: 1, failed: 0 },
          );
          expect(
            after.buckets.reduce((sum, bucket) => sum + bucket.checks, 0),
          ).toBe(after.summary.checks);
          expect(after.pauses).toEqual(
            mutation === "paused"
              ? [
                  {
                    from: new Date(now.getTime() - 500).toISOString(),
                    to: now.toISOString(),
                  },
                ]
              : mutation === "resumed"
                ? [
                    {
                      from: after.window.from,
                      to: new Date(now.getTime() - 500).toISOString(),
                    },
                  ]
                : [],
          );
        }
      } finally {
        await writer.query("rollback");
        writer.release();
      }
    },
  );
});

describe("raw read runtime isolation", () => {
  it("uses a non-owner NOBYPASSRLS role with FORCE RLS and denies B or missing context", async () => {
    const foreign = await ctx.createOrganization("raw-foreign");
    const ownId = await seedMonitor(ctx, org.id);
    const foreignId = await seedMonitor(ctx, foreign.id);
    await seedResults(ctx, org.id, ownId, [60], { responseTimeMs: 17 });
    await seedResults(ctx, foreign.id, foreignId, [60], {
      responseTimeMs: 999,
    });
    const client = await ctx.runtime.sql.connect();
    try {
      const role = await client.query(
        "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
      );
      expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
      const tables =
        await client.query(`select relrowsecurity, relforcerowsecurity,
        pg_get_userbyid(relowner) <> current_user as nonowner,
        has_table_privilege(current_user, oid, 'SELECT') as readable
        from pg_class where oid in ('monitors'::regclass, 'monitor_events'::regclass, 'monitor_check_results'::regclass)`);
      expect(tables.rows).toEqual(
        Array(3).fill({
          relrowsecurity: true,
          relforcerowsecurity: true,
          nonowner: true,
          readable: true,
        }),
      );
      await client.query("begin");
      const missing = await client.query(
        "select response_time_ms from monitor_check_results where monitor_id = any($1::uuid[])",
        [[ownId, foreignId]],
      );
      expect(missing.rows).toEqual([]);
      await client.query("select set_config('app.tenant_id', $1, true)", [
        org.id,
      ]);
      const scoped = await client.query(
        "select monitor_id, response_time_ms from monitor_check_results where monitor_id = any($1::uuid[])",
        [[ownId, foreignId]],
      );
      expect(scoped.rows).toEqual([
        { monitor_id: ownId, response_time_ms: 17 },
      ]);
      await client.query("select set_config('app.tenant_id', $1, true)", [
        foreign.id,
      ]);
      const other = await client.query(
        "select monitor_id, response_time_ms from monitor_check_results where monitor_id = any($1::uuid[])",
        [[ownId, foreignId]],
      );
      expect(other.rows).toEqual([
        { monitor_id: foreignId, response_time_ms: 999 },
      ]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
