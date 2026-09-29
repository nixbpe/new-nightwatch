import { monitorResponseTimesResponseSchema } from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ageSeries,
  seedEvent,
  seedHourly,
  seedMonitor,
  seedResults,
} from "./read-test-support";
import {
  monitorsPath,
  openMonitorTestContext,
  TEST_ROLES,
  type MonitorTestContext,
  type TestOrganization,
  type TestRole,
} from "./test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;
let other: TestOrganization;
let outsider: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  await ctx.owner.sql.query("select ensure_monitor_partitions(3)");
  org = await ctx.createOrganization("times");
  other = await ctx.createOrganization("times-other");
  outsider = await ctx.createUser("times-outsider");
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
    // 1,500 checks at 60 s: ages 30 s to 89,970 s. 1,440 are inside 24 h.
    await seedResults(ctx, org.id, id, ageSeries(1500, 60, 30), {
      intervalSeconds: 60,
    });
    const body = await series(id);
    if (body.range !== "24h") throw new Error("expected the 24 h shape");
    expect(body.points).toHaveLength(1440);
    const oldest = body.points[0];
    const newest = body.points[body.points.length - 1];
    expect(seconds(oldest?.at ?? "", newest?.at ?? "")).toBeCloseTo(
      1439 * 60,
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
    await seedHourly(ctx, org.id, id, [1], {
      checks: 60,
      passed: 58,
      coveredSeconds: 3600,
      responseMsSum: 6000,
      responseMsMax: 300,
    });
    await seedHourly(ctx, org.id, id, [3], {
      checks: 4,
      passed: 4,
      coveredSeconds: 240,
      responseMsSum: 1000,
      responseMsMax: 400,
    });
    // Every check of this hour timed out without a response.
    await seedHourly(ctx, org.id, id, [5], {
      checks: 3,
      passed: 0,
      coveredSeconds: 180,
      responseMsSum: 0,
      responseMsMax: null,
    });
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
    expect(at(1)).toMatchObject({ avgMs: 100, maxMs: 300, checks: 60 });
    expect(at(3)).toMatchObject({ avgMs: 250, maxMs: 400, checks: 4 });
    expect(at(5)).toMatchObject({ avgMs: null, maxMs: null, checks: 3 });
    expect(at(2)).toMatchObject({ avgMs: null, maxMs: null, checks: 0 });
    expect(at(0)).toMatchObject({ avgMs: null, maxMs: null, checks: 0 });

    const month = await series(id, "30d");
    if (month.range !== "30d") throw new Error("expected the 30 d shape");
    expect(month.buckets).toHaveLength(720);
    expect(month.buckets[719]?.hourStart).toBe(new Date(hour).toISOString());
  });

  it("does not return the hour that starts before the rounded window", async () => {
    const id = await seedMonitor(ctx, org.id);
    const hour = await currentHour();
    await seedHourly(ctx, org.id, id, [168, 167], {
      checks: 1,
      passed: 1,
      coveredSeconds: 300,
      responseMsSum: 10,
      responseMsMax: 10,
    });
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

  it("reports a pause inside the range; the paused hours stay null", async () => {
    const id = await seedMonitor(ctx, org.id);
    await seedEvent(ctx, org.id, id, "paused", 5 * 3600);
    await seedEvent(ctx, org.id, id, "resumed", 3 * 3600);
    const week = await series(id, "7d");
    expect(week.pauses).toHaveLength(1);
    expect(
      seconds(week.pauses[0]?.from ?? "", week.pauses[0]?.to ?? ""),
    ).toBeCloseTo(2 * 3600, -1);
    if (week.range !== "7d") throw new Error("expected the 7 d shape");
    expect(week.buckets.every((bucket) => bucket.avgMs === null)).toBe(true);
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
  let foreign: string;

  beforeAll(async () => {
    id = await seedMonitor(ctx, org.id, { name: "Secret Name" });
    foreign = await seedMonitor(ctx, other.id, { name: "Other org monitor" });
  });

  it("every role can read", async () => {
    for (const role of TEST_ROLES) {
      for (const range of ["24h", "7d", "30d"]) {
        expect((await series(id, range, role)).range).toBe(range);
      }
    }
  });

  it("answers a non-member like a missing Organization", async () => {
    const path = `/${id}/response-times`;
    const denied = await ctx.call(outsider, "GET", monitorsPath(org.id, path));
    const absent = await ctx.call(
      outsider,
      "GET",
      monitorsPath(crypto.randomUUID(), path),
    );
    expect(denied.status).toBe(403);
    expect(denied.json).toEqual(absent.json);
    expect(JSON.stringify(denied.json)).not.toMatch(/Secret Name|total/i);
  });

  it("answers a missing, a malformed and a foreign id with the same 404", async () => {
    const bodies = [];
    for (const target of [crypto.randomUUID(), "not-a-uuid", foreign]) {
      const response = await ctx.call(
        org.users.viewer,
        "GET",
        monitorsPath(org.id, `/${target}/response-times`),
      );
      expect(response.status).toBe(404);
      bodies.push(response.json);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

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
