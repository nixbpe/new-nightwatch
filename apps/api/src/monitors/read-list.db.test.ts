import {
  monitorDetailResponseSchema,
  monitorListResponseSchema,
  monitorRecentEventsResponseSchema,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ageSeries,
  rollupFromResults,
  seedHourly,
  seedIncident,
  seedMonitor,
  seedResults,
} from "./read-test-support";
import {
  monitorsPath,
  openMonitorTestContext,
  TEST_ROLES,
  type MonitorTestContext,
  type TestOrganization,
} from "./test-support";

let ctx: MonitorTestContext;
let order: TestOrganization;
let filters: TestOrganization;
let sslOrg: TestOrganization;
let events: TestOrganization;
let paging: TestOrganization;
let empty: TestOrganization;
let outsider: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  await ctx.owner.sql.query("select ensure_monitor_partitions(3)");
  order = await ctx.createOrganization("read-order");
  filters = await ctx.createOrganization("read-filters");
  sslOrg = await ctx.createOrganization("read-ssl");
  events = await ctx.createOrganization("read-events");
  paging = await ctx.createOrganization("read-paging");
  empty = await ctx.createOrganization("read-empty");
  outsider = await ctx.createUser("read-outsider");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

async function list(org: TestOrganization, query = "") {
  const response = await ctx.call(
    org.users.viewer,
    "GET",
    monitorsPath(org.id, query),
  );
  expect(response.status).toBe(200);
  return monitorListResponseSchema.parse(response.json);
}

const up = async (org: TestOrganization, name: string, url?: string) => {
  const id = await seedMonitor(ctx, org.id, { name, url });
  await seedResults(ctx, org.id, id, [10]);
  return id;
};
const down = async (org: TestOrganization, name: string) => {
  const id = await seedMonitor(ctx, org.id, {
    name,
    consecutiveFailures: 2,
  });
  await seedResults(ctx, org.id, id, [10, 310], { outcome: "fail" });
  await seedIncident(ctx, org.id, id, { startedAgoSeconds: 300 });
  return id;
};

describe("List: order and summary", () => {
  it("groups down, unknown, up, paused, then lower(name), then id", async () => {
    const expected: string[] = [];
    // Inserted in scrambled order on purpose.
    await up(order, "echo");
    await seedMonitor(ctx, order.id, { name: "Delta", status: "paused" });
    await up(order, "Bravo");
    await seedMonitor(ctx, order.id, { name: "charlie" });
    await down(order, "zulu");
    await down(order, "Alpha");
    await seedMonitor(ctx, order.id, { name: "bravo-2" });
    expected.push(
      "Alpha",
      "zulu",
      "bravo-2",
      "charlie",
      "Bravo",
      "echo",
      "Delta",
    );

    const body = await list(order);
    expect(body.monitors.map((item) => item.name)).toEqual(expected);
    expect(body.monitors.map((item) => item.health)).toEqual([
      "down",
      "down",
      "unknown",
      "unknown",
      "up",
      "up",
      "paused",
    ]);
    expect(body.summary).toEqual({
      up: 2,
      down: 2,
      unknown: 2,
      paused: 1,
      total: 7,
      limit: 50,
    });
    const { up: a, down: b, unknown: c, paused: d, total } = body.summary;
    expect(a + b + c + d).toBe(total);
    expect(body.page).toEqual({ limit: 25, offset: 0, total: 7 });
  });

  it("orders equal names by id", async () => {
    const twins = await ctx.createOrganization("read-twins");
    const first = await seedMonitor(ctx, twins.id, { name: "Same" });
    const second = await seedMonitor(ctx, twins.id, { name: "same" });
    const body = await list(twins);
    expect(body.monitors.map((item) => item.id)).toEqual(
      [first, second].sort(),
    );
  });

  it("pages with limit and offset and reports the filtered total", async () => {
    for (const name of ["p1", "p2", "p3", "p4", "p5"]) {
      await seedMonitor(ctx, paging.id, { name });
    }
    const second = await list(paging, "?limit=2&offset=2");
    expect(second.monitors.map((item) => item.name)).toEqual(["p3", "p4"]);
    expect(second.page).toEqual({ limit: 2, offset: 2, total: 5 });
    const past = await list(paging, "?limit=2&offset=10");
    expect(past.monitors).toEqual([]);
    expect(past.summary.total).toBe(5);
  });

  it("answers an Organization without monitors with zero counts", async () => {
    const body = await list(empty);
    expect(body.monitors).toEqual([]);
    expect(body.summary).toEqual({
      up: 0,
      down: 0,
      unknown: 0,
      paused: 0,
      total: 0,
      limit: 50,
    });
  });

  it("rejects out-of-range query values with INVALID_INPUT", async () => {
    for (const query of [
      "?limit=0",
      "?limit=51",
      "?offset=-1",
      "?sort=oldest",
      "?sort=",
      "?health=healthy",
      "?q=%00",
      `?q=${"x".repeat(201)}`,
    ]) {
      const response = await ctx.call(
        empty.users.owner,
        "GET",
        monitorsPath(empty.id, query),
      );
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({
        error: { code: "INVALID_INPUT" },
      });
    }
  });
});

describe("List: filters", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ids.percent = await up(filters, "50% off");
    ids.plain = await up(filters, "50x off");
    ids.underscore = await seedMonitor(ctx, filters.id, { name: "a_b" });
    ids.wildcard = await seedMonitor(ctx, filters.id, { name: "aXb" });
    ids.slash = await seedMonitor(ctx, filters.id, {
      name: String.raw`back\slash`,
    });
    ids.host = await up(filters, "zzz", "https://searchme.example/somewhere");
    ids.path = await up(filters, "yyy", "https://other.example/secretpath");
    ids.down = await down(filters, "broken thing");
    ids.paused = await seedMonitor(ctx, filters.id, {
      name: "sleeping thing",
      status: "paused",
    });
  });

  const names = (body: Awaited<ReturnType<typeof list>>) =>
    body.monitors.map((item) => item.name).sort();

  it("filters by health and keeps the summary unchanged", async () => {
    const everything = await list(filters);
    const onlyDown = await list(filters, "?health=down");
    expect(names(onlyDown)).toEqual(["broken thing"]);
    expect(onlyDown.page.total).toBe(1);
    expect(onlyDown.summary).toEqual(everything.summary);
    const paused = await list(filters, "?health=paused");
    expect(names(paused)).toEqual(["sleeping thing"]);
    expect(paused.summary).toEqual(everything.summary);
  });

  it("matches % and _ literally", async () => {
    expect(
      names(await list(filters, `?q=${encodeURIComponent("50%")}`)),
    ).toEqual(["50% off"]);
    expect(names(await list(filters, "?q=a_b"))).toEqual(["a_b"]);
    expect(names(await list(filters, `?q=${encodeURIComponent("%")}`))).toEqual(
      ["50% off"],
    );
    expect(names(await list(filters, "?q=_"))).toEqual(["a_b"]);
    expect(
      names(await list(filters, `?q=${encodeURIComponent("\\")}`)),
    ).toEqual([String.raw`back\slash`]);
  });

  it("matches name and host case-insensitively but not the path", async () => {
    expect(names(await list(filters, "?q=BROKEN"))).toEqual(["broken thing"]);
    expect(names(await list(filters, "?q=SearchMe"))).toEqual(["zzz"]);
    expect(names(await list(filters, "?q=secretpath"))).toEqual([]);
    expect(names(await list(filters, "?q=other.example"))).toEqual(["yyy"]);
  });

  it("trims q, and a blank q filters nothing", async () => {
    expect(names(await list(filters, "?q=%20a_b%20"))).toEqual(["a_b"]);
    const all = await list(filters, "?q=%20%20");
    expect(all.page.total).toBe(all.summary.total);
  });

  it("combines q and health; the summary still counts everything", async () => {
    const both = await list(filters, "?health=up&q=off");
    expect(names(both)).toEqual(["50% off", "50x off"]);
    expect(both.summary.total).toBe(9);
    expect(both.page.total).toBe(2);
    expect(names(await list(filters, "?health=down&q=off"))).toEqual([]);
  });

  it("treats a q that looks like SQL as text", async () => {
    const response = await list(
      filters,
      `?q=${encodeURIComponent("'; drop table monitors; --")}`,
    );
    expect(response.monitors).toEqual([]);
    expect((await list(filters)).summary.total).toBe(9);
  });
});

describe("List: SSL level", () => {
  const DAY = 86_400;
  // The full boundary matrix is the unit source of truth (health.test.ts,
  // computeSsl); these two rows only prove the route wires it through.
  it.each([
    ["30 d exactly", 30 * DAY, "caution", 30],
    ["expired 1 s ago", -1, "expired", 0],
  ] as const)("%s", async (label, secondsLeft, level, days) => {
    // The fixture expiry is fixed before the request, so the request sees a
    // few milliseconds less; ceil() keeps each of these values stable.
    const id = await seedMonitor(ctx, sslOrg.id, {
      name: label,
      sslHost: "ssl.example",
      sslNotAfterInSeconds: secondsLeft,
      sslState: "ok",
    });
    const body = await list(sslOrg);
    const item = body.monitors.find((candidate) => candidate.id === id);
    expect(item?.ssl).toEqual({
      level,
      daysRemaining: days,
      host: "ssl.example",
      issuer: null,
      notAfter: item?.ssl.notAfter,
    });
    expect(item?.ssl.notAfter).not.toBeNull();
  });

  it("reports an unreadable certificate as recorded although an old expiry is kept", async () => {
    const id = await seedMonitor(ctx, sslOrg.id, {
      name: "unreadable with kept expiry",
      sslHost: "ssl.example",
      sslNotAfterInSeconds: 60 * DAY,
      sslState: "unreadable",
      sslReason: "handshake_failed",
    });
    const item = (await list(sslOrg)).monitors.find((m) => m.id === id);
    expect(item?.ssl).toEqual({
      level: "unreadable",
      daysRemaining: null,
      host: "ssl.example",
      issuer: null,
      notAfter: item?.ssl.notAfter,
    });
    expect(item?.ssl.notAfter).not.toBeNull();
  });

  it("reports an expired handshake without a date as expired with no days", async () => {
    const id = await seedMonitor(ctx, sslOrg.id, {
      name: "expired without date",
      sslHost: "ssl.example",
      sslState: "expired",
      sslReason: "expired",
    });
    const item = (await list(sslOrg)).monitors.find((m) => m.id === id);
    expect(item?.ssl).toEqual({
      level: "expired",
      daysRemaining: null,
      host: "ssl.example",
      issuer: null,
      notAfter: null,
    });
  });

  it("reports the recorded state without an expiry date", async () => {
    const cases = [
      ["no data", null, "no_data"],
      ["plain http", "not_https", "not_https"],
      ["unreadable", "unreadable", "unreadable"],
    ] as const;
    for (const [name, state, level] of cases) {
      const id = await seedMonitor(ctx, sslOrg.id, { name, sslState: state });
      const item = (await list(sslOrg)).monitors.find((m) => m.id === id);
      expect(item?.ssl).toEqual({
        level,
        daysRemaining: null,
        host: null,
        issuer: null,
        notAfter: null,
      });
    }
  });
});

describe("List: uptime", () => {
  it("returns 24 h and 30 d windows with coverage from hand-computed rollups", async () => {
    const org = await ctx.createOrganization("read-uptime");
    // Created 2 h ago; 24 passing 5-minute checks (ages 0 to 115 min) cover 7,200 s.
    const id = await seedMonitor(ctx, org.id, {
      name: "young",
      createdAgoSeconds: 7200,
    });
    await seedResults(ctx, org.id, id, ageSeries(24, 300, 5), {});
    await rollupFromResults(ctx, id);
    const item = (await list(org)).monitors[0];
    expect(item?.uptime.h24.percent).toBe(100);
    expect(item?.uptime.h24.checks).toBe(24);
    expect(item?.uptime.h24.coveragePercent).toBeCloseTo(100, 0);
    expect(item?.uptime.d30.checks).toBe(24);
    expect(item?.uptime.d30.coveragePercent).toBeCloseTo(100, 0);

    const idle = await seedMonitor(ctx, org.id, { name: "no results" });
    const idleItem = (await list(org)).monitors.find((m) => m.id === idle);
    expect(idleItem?.uptime.h24).toEqual({
      percent: null,
      checks: 0,
      coveragePercent: 0,
    });
  });
});

// ---- sort (#59) -------------------------------------------------------------

/**
 * Six monitors with distinct values per sort key, a null on both the uptime and
 * response keys, and a tie on each key. Names are read back in the expected
 * orders below.
 *
 *   name      created  uptime h24  last response
 *   Alpha     50 d     100         100
 *   bravo     40 d      50         900
 *   Charlie   10 d     null        null
 *   delta      1 d     100         500
 *   echo      30 d     null        null
 *   foxtrot   30 d     100         500   (created_at equal to echo)
 */
async function seedSortOrganization(label: string) {
  const org = await ctx.createOrganization(label);
  const DAY = 86_400;
  const make = (name: string, createdDays: number, urlHost = name) =>
    seedMonitor(ctx, org.id, {
      name,
      url: `https://${urlHost.toLowerCase()}.sort.test/x`,
      createdAgoSeconds: createdDays * DAY,
    });
  const ids = {
    Alpha: await make("Alpha", 50),
    bravo: await make("bravo", 40),
    Charlie: await make("Charlie", 10),
    delta: await make("delta", 1),
    echo: await make("echo", 30),
    foxtrot: await make("foxtrot", 30),
  };
  await ctx.owner.sql.query(
    "update monitors set created_at = (select created_at from monitors where id = $1) where id = $2",
    [ids.echo, ids.foxtrot],
  );
  await seedResults(ctx, org.id, ids.Alpha, [10, 310], { responseTimeMs: 100 });
  await seedResults(ctx, org.id, ids.bravo, [310], { responseTimeMs: 50 });
  await seedResults(ctx, org.id, ids.bravo, [10], {
    outcome: "fail",
    responseTimeMs: 900,
  });
  await seedResults(ctx, org.id, ids.delta, [10, 310], { responseTimeMs: 500 });
  await seedResults(ctx, org.id, ids.foxtrot, [10, 310], {
    responseTimeMs: 500,
  });
  return { org, ids };
}

const SORT_ORDERS = {
  name: ["Alpha", "bravo", "Charlie", "delta", "echo", "foxtrot"],
  uptime: ["bravo", "Alpha", "delta", "foxtrot", "Charlie", "echo"],
  response_time: ["bravo", "delta", "foxtrot", "Alpha", "Charlie", "echo"],
  newest: ["delta", "Charlie", "echo", "foxtrot", "bravo", "Alpha"],
} as const;

describe("List: sort", () => {
  let sorted: Awaited<ReturnType<typeof seedSortOrganization>>;
  const namesOf = (body: Awaited<ReturnType<typeof list>>) =>
    body.monitors.map((item) => item.name);

  beforeAll(async () => {
    sorted = await seedSortOrganization("read-sort");
  });

  it.each(Object.entries(SORT_ORDERS))(
    "sort=%s orders by the key, nulls last, ties by name then id",
    async (sort, expected) => {
      const body = await list(sorted.org, `?sort=${sort}`);
      expect(namesOf(body)).toEqual(expected);
    },
  );

  it("sorts by the 24 h uptime percent the item reports", async () => {
    const body = await list(sorted.org, "?sort=uptime");
    expect(body.monitors.map((item) => item.uptime.h24.percent)).toEqual([
      50,
      100,
      100,
      100,
      null,
      null,
    ]);
  });

  it("sorts by the last response time the item reports", async () => {
    const body = await list(sorted.org, "?sort=response_time");
    expect(body.monitors.map((item) => item.lastResponseTimeMs)).toEqual([
      900,
      500,
      500,
      100,
      null,
      null,
    ]);
  });

  it("answers problems for no sort and for sort=problems, health groups first", async () => {
    const none = await list(sorted.org);
    const problems = await list(sorted.org, "?sort=problems");
    expect(problems.monitors).toEqual(none.monitors);
    const rank = { down: 0, unknown: 1, up: 2, paused: 3 } as const;
    const ranks = none.monitors.map((item) => rank[item.health]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("leaves the summary unchanged by sort", async () => {
    const base = await list(sorted.org);
    for (const sort of Object.keys(SORT_ORDERS)) {
      expect((await list(sorted.org, `?sort=${sort}`)).summary).toEqual(
        base.summary,
      );
    }
  });

  it.each(["problems", ...Object.keys(SORT_ORDERS)])(
    "sort=%s pages without a repeated or missing row",
    async (sort) => {
      const whole = namesOf(await list(sorted.org, `?sort=${sort}`));
      const pages = [
        ...namesOf(await list(sorted.org, `?sort=${sort}&limit=2&offset=0`)),
        ...namesOf(await list(sorted.org, `?sort=${sort}&limit=2&offset=2`)),
        ...namesOf(await list(sorted.org, `?sort=${sort}&limit=2&offset=4`)),
      ];
      expect(pages).toEqual(whole);
      expect(new Set(pages).size).toBe(6);
    },
  );

  it("combines sort with q and health", async () => {
    // "l" matches Alpha, Charlie and delta by name; no host contains it.
    expect(namesOf(await list(sorted.org, "?sort=response_time&q=l"))).toEqual([
      "delta",
      "Alpha",
      "Charlie",
    ]);
    const all = await list(sorted.org, "?sort=newest");
    for (const health of new Set(all.monitors.map((item) => item.health))) {
      const only = await list(sorted.org, `?sort=newest&health=${health}`);
      expect(namesOf(only)).toEqual(
        all.monitors
          .filter((item) => item.health === health)
          .map((i) => i.name),
      );
      expect(only.page.total).toBe(only.monitors.length);
    }
  });

  it("does not mix another Organization's monitors into the order", async () => {
    const other = await seedSortOrganization("read-sort-other");
    const body = await list(other.org, "?sort=uptime");
    expect(body.monitors.map((item) => item.id)).not.toContain(
      sorted.ids.Alpha,
    );
    expect(namesOf(body)).toEqual(SORT_ORDERS.uptime);
  });

  it("moves page 2 to the new order when a key changes between the two requests", async () => {
    const race = await seedSortOrganization("read-sort-race");
    const first = await list(race.org, "?sort=response_time&limit=2&offset=0");
    expect(namesOf(first)).toEqual(["bravo", "delta"]);
    // A newer slow result for Alpha lands between the two requests.
    await seedResults(ctx, race.org.id, race.ids.Alpha, [1], {
      responseTimeMs: 2000,
    });
    const second = await list(race.org, "?sort=response_time&limit=2&offset=2");
    expect(namesOf(second)).toEqual(["delta", "foxtrot"]);
    expect(namesOf(await list(race.org, "?sort=response_time"))).toEqual([
      "Alpha",
      "bravo",
      "delta",
      "foxtrot",
      "Charlie",
      "echo",
    ]);
  });
});

describe("List: configuration and certificate fields", () => {
  it("matches Detail for a non-default method, interval and issuer", async () => {
    const org = await ctx.createOrganization("read-fields");
    const id = await seedMonitor(ctx, org.id, {
      name: "configured",
      method: "POST",
      intervalSeconds: 900,
      sslHost: "ssl.example",
      sslIssuer: "Example Issuing CA",
      sslNotAfterInSeconds: 10 * 86_400,
      sslState: "ok",
    });
    const plain = await seedMonitor(ctx, org.id, { name: "plain" });
    const body = await list(org);
    const item = body.monitors.find((candidate) => candidate.id === id);
    expect(item).toMatchObject({
      method: "POST",
      intervalSeconds: 900,
      ssl: { issuer: "Example Issuing CA" },
    });
    const detailResponse = await ctx.call(
      org.users.viewer,
      "GET",
      monitorsPath(org.id, `/${id}`),
    );
    expect(detailResponse.status).toBe(200);
    const detail = monitorDetailResponseSchema.parse(
      detailResponse.json,
    ).monitor;
    expect(item?.method).toBe(detail.method);
    expect(item?.intervalSeconds).toBe(detail.intervalSeconds);
    expect(item?.ssl.issuer).toBe(detail.ssl.issuer);
    expect(item?.ssl.notAfter).toBe(detail.ssl.notAfter);
    expect(item?.ssl.notAfter).not.toBeNull();
    const plainItem = body.monitors.find((candidate) => candidate.id === plain);
    expect(plainItem).toMatchObject({
      method: "GET",
      intervalSeconds: 300,
      ssl: { issuer: null, notAfter: null },
    });
  });
});

describe("List: response sparkline", () => {
  const HOUR = 3_600_000;
  let org: TestOrganization;
  let other: TestOrganization;
  let id: string;
  let fresh: string;
  let otherId: string;
  // `seedHourly` truncates the database's now(); the request reads its own now()
  // later, so the two can sit on different hours. Points are found by hourStart.
  let seededHour: number;
  let otherSeededHour: number;
  const hourOf = async (monitorId: string) => {
    const result = await ctx.owner.sql.query<{ hour: Date }>(
      "select max(hour_start) as hour from monitor_check_hourly where monitor_id = $1",
      [monitorId],
    );
    return result.rows[0]!.hour.getTime();
  };
  const avgAt = (
    points: { hourStart: string; avgMs: number | null }[],
    hour: number,
  ) => points.find((point) => Date.parse(point.hourStart) === hour)?.avgMs;

  beforeAll(async () => {
    org = await ctx.createOrganization("read-spark");
    other = await ctx.createOrganization("read-spark-other");
    id = await seedMonitor(ctx, org.id, { name: "spark" });
    fresh = await seedMonitor(ctx, org.id, { name: "brand new" });
    const hour = (hoursAgo: number[], responseChecks: number, sum: number) =>
      seedHourly(ctx, org.id, id, hoursAgo, {
        checks: responseChecks,
        passed: responseChecks,
        coveredSeconds: 300,
        responseChecks,
        responseMsSum: sum,
        responseMsMax: responseChecks === 0 ? null : sum,
      });
    await hour([0], 2, 301); // the current hour: 150.5
    await hour([7], 3, 100); // 33.33
    await hour([23], 1, 40); // the oldest point
    await hour([24], 1, 999); // outside the window
    await hour([3], 0, 0); // an hour without a measured response
    otherId = await seedMonitor(ctx, other.id, { name: "elsewhere" });
    await seedHourly(ctx, other.id, otherId, [0], {
      checks: 1,
      passed: 1,
      coveredSeconds: 300,
      responseChecks: 1,
      responseMsSum: 77,
      responseMsMax: 77,
    });
    seededHour = await hourOf(id);
    otherSeededHour = await hourOf(otherId);
  });

  it("has 24 consecutive UTC hours ending at the hour of now, empty hours null", async () => {
    const body = await list(org);
    const item = body.monitors.find((candidate) => candidate.id === id);
    const points = item?.responseSparkline ?? [];
    expect(points).toHaveLength(24);
    const last = Math.floor(Date.parse(body.dataAsOf) / HOUR) * HOUR;
    expect(points.map((point) => Date.parse(point.hourStart))).toEqual(
      Array.from({ length: 24 }, (_, index) => last - (23 - index) * HOUR),
    );
    // The request may have crossed into the next hour since the seed: the
    // current-hour point then sits one slot earlier and the oldest one drops out.
    const shift = (last - seededHour) / HOUR;
    expect([0, 1]).toContain(shift);
    expect(avgAt(points, seededHour)).toBe(150.5);
    expect(avgAt(points, seededHour - 7 * HOUR)).toBe(33.33);
    expect(avgAt(points, seededHour - 3 * HOUR)).toBeNull();
    expect(avgAt(points, seededHour - 23 * HOUR)).toBe(
      shift === 0 ? 40 : undefined,
    );
    // The row 24 hours back never enters the window.
    expect(points.map((point) => point.avgMs)).not.toContain(999);
    expect(points.filter((point) => point.avgMs !== null)).toHaveLength(
      3 - shift,
    );
  });

  it("is all null for a monitor without rollups", async () => {
    const item = (await list(org)).monitors.find((m) => m.id === fresh);
    expect(item?.responseSparkline).toHaveLength(24);
    expect(item?.responseSparkline.every((p) => p.avgMs === null)).toBe(true);
  });

  it("shows each Organization only its own rollups", async () => {
    const mine = await list(org);
    const theirs = await list(other);
    expect(mine.monitors.map((item) => item.id)).not.toContain(otherId);
    expect(theirs.monitors.map((item) => item.id)).toEqual([otherId]);
    expect(
      avgAt(theirs.monitors[0]?.responseSparkline ?? [], otherSeededHour),
    ).toBe(77);
    expect(
      theirs.monitors[0]?.responseSparkline.filter((p) => p.avgMs !== null),
    ).toHaveLength(1);
    const values = mine.monitors.flatMap((item) =>
      item.responseSparkline.map((p) => p.avgMs),
    );
    expect(values).not.toContain(77);
  });

  it("answers every role the same new fields", async () => {
    const reference = (await list(org)).monitors;
    for (const role of TEST_ROLES) {
      const response = await ctx.call(
        org.users[role],
        "GET",
        monitorsPath(org.id, "?sort=name"),
      );
      expect(response.status, role).toBe(200);
      const items = monitorListResponseSchema.parse(response.json).monitors;
      expect(
        items.map((item) => [item.id, item.method, item.responseSparkline]),
      ).toEqual(
        [...reference]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => [item.id, item.method, item.responseSparkline]),
      );
    }
  });
});

describe("Recent events", () => {
  it("lists opened and closed incidents and non-ok SSL levels, newest first", async () => {
    const opened = await seedMonitor(ctx, events.id, { name: "opened" });
    await seedIncident(ctx, events.id, opened, {
      startedAgoSeconds: 600,
      reason: "http_status",
    });
    const closed = await seedMonitor(ctx, events.id, { name: "closed" });
    await seedIncident(ctx, events.id, closed, {
      startedAgoSeconds: 4000,
      endedAgoSeconds: 1000,
      reason: "timeout",
    });
    const ssl = await seedMonitor(ctx, events.id, {
      name: "expiring",
      sslHost: "ssl.example",
      sslNotAfterInSeconds: 5 * 86_400,
      sslState: "ok",
      lastCheckAgoSeconds: 30,
    });
    await seedMonitor(ctx, events.id, {
      name: "healthy cert",
      sslNotAfterInSeconds: 90 * 86_400,
      sslState: "ok",
      lastCheckAgoSeconds: 20,
    });
    // Older than 30 days: outside the window.
    const old = await seedMonitor(ctx, events.id, { name: "old" });
    await seedIncident(ctx, events.id, old, {
      startedAgoSeconds: 40 * 86_400,
      endedAgoSeconds: 35 * 86_400,
    });

    const response = await ctx.call(
      events.users.auditor,
      "GET",
      monitorsPath(events.id, "/recent-events"),
    );
    expect(response.status).toBe(200);
    const body = monitorRecentEventsResponseSchema.parse(response.json);
    expect(body.events.map((event) => [event.kind, event.monitorId])).toEqual([
      ["incident_opened", opened],
      ["incident_closed", closed],
      ["incident_opened", closed],
      ["ssl_level", ssl],
    ]);
    const [openedEvent, closedEvent, , sslEvent] = body.events;
    expect(sslEvent).toMatchObject({
      sslLevel: "danger",
      daysRemaining: 5,
      monitorName: "expiring",
    });
    expect(closedEvent).toMatchObject({
      reason: "recovered",
      durationSeconds: 3000,
    });
    expect(openedEvent).toMatchObject({ reason: "http_status" });
  });

  it("is not captured by GET /monitors/{monitorId}", async () => {
    const response = await ctx.call(
      events.users.viewer,
      "GET",
      monitorsPath(events.id, "/recent-events"),
    );
    expect(response.status).toBe(200);
    expect(response.json).toHaveProperty("events");
  });

  it("limits to 1..20 with a default of 10, newest first", async () => {
    const org = await ctx.createOrganization("read-events-limit");
    const id = await seedMonitor(ctx, org.id, { name: "flapper" });
    for (let index = 0; index < 12; index += 1) {
      await seedIncident(ctx, org.id, id, {
        startedAgoSeconds: 10_000 - index * 700 + 1000,
        endedAgoSeconds: 10_000 - index * 700,
      });
    }
    const get = async (query: string) => {
      const response = await ctx.call(
        org.users.owner,
        "GET",
        monitorsPath(org.id, `/recent-events${query}`),
      );
      return { status: response.status, json: response.json };
    };
    const byDefault = await get("");
    expect(
      monitorRecentEventsResponseSchema.parse(byDefault.json).events,
    ).toHaveLength(10);
    const two = monitorRecentEventsResponseSchema.parse(
      (await get("?limit=2")).json,
    ).events;
    expect(two).toHaveLength(2);
    const atTimes = two.map((event) => event.at);
    expect([...atTimes].sort().reverse()).toEqual(atTimes);
    for (const query of ["?limit=0", "?limit=21"]) {
      expect((await get(query)).status).toBe(400);
    }
    expect(
      monitorRecentEventsResponseSchema.parse((await get("?limit=20")).json)
        .events,
    ).toHaveLength(20);
  });
});

describe("Recent events: SSL levels", () => {
  const DAY = 86_400;
  const get = async (org: TestOrganization) => {
    const response = await ctx.call(
      org.users.owner,
      "GET",
      monitorsPath(org.id, "/recent-events"),
    );
    expect(response.status).toBe(200);
    return monitorRecentEventsResponseSchema.parse(response.json).events;
  };

  it("does not emit an SSL level for an unreadable certificate", async () => {
    const org = await ctx.createOrganization("read-events-unreadable");
    await seedMonitor(ctx, org.id, {
      name: "unreadable",
      sslHost: "ssl.example",
      sslNotAfterInSeconds: 5 * DAY,
      sslState: "unreadable",
      sslReason: "handshake_failed",
    });
    expect(await get(org)).toEqual([]);
  });

  it("lists an expired certificate without a date, with no daysRemaining", async () => {
    const org = await ctx.createOrganization("read-events-expired");
    const id = await seedMonitor(ctx, org.id, {
      name: "expired no date",
      sslState: "expired",
      sslReason: "expired",
      lastCheckAgoSeconds: 90,
    });
    const [event, ...rest] = await get(org);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      kind: "ssl_level",
      monitorId: id,
      sslLevel: "expired",
    });
    expect(event).not.toHaveProperty("daysRemaining");
  });

  it("stamps a level with the time it was entered, so ten cautions do not crowd out a fresh incident", async () => {
    const org = await ctx.createOrganization("read-events-crowd");
    for (let index = 0; index < 10; index += 1) {
      await seedMonitor(ctx, org.id, {
        name: `caution ${String(index)}`,
        sslNotAfterInSeconds: 10 * DAY,
        sslState: "caution",
        lastCheckAgoSeconds: 5,
      });
    }
    const flapping = await seedMonitor(ctx, org.id, { name: "flapping" });
    await seedIncident(ctx, org.id, flapping, { startedAgoSeconds: 600 });
    const body = await get(org);
    expect(body).toHaveLength(10);
    expect(body[0]).toMatchObject({
      kind: "incident_opened",
      monitorId: flapping,
    });
    // Caution starts 30 d before expiry: 20 d ago here.
    const caution = body[1];
    expect(caution?.kind).toBe("ssl_level");
    const enteredAgo = (Date.now() - Date.parse(caution?.at ?? "")) / 1000;
    expect(enteredAgo).toBeGreaterThan(19.9 * DAY);
    expect(enteredAgo).toBeLessThan(20.1 * DAY);
  });

  it("clamps an undated expired certificate last checked 40 days ago to the window start", async () => {
    const org = await ctx.createOrganization("read-events-undated-old");
    await seedMonitor(ctx, org.id, {
      name: "paused, undated expired",
      status: "paused",
      createdAgoSeconds: 60 * DAY,
      lastCheckAgoSeconds: 40 * DAY,
      sslState: "expired",
      sslReason: "expired",
    });
    const [event] = await get(org);
    expect(event?.kind).toBe("ssl_level");
    const age = (Date.now() - Date.parse(event?.at ?? "")) / 1000;
    expect(age).toBeLessThan(30 * DAY + 60);
  });

  it("does not stamp an event older than the 30-day window", async () => {
    const org = await ctx.createOrganization("read-events-old");
    await seedMonitor(ctx, org.id, {
      name: "paused, expired 35 d ago",
      status: "paused",
      createdAgoSeconds: 60 * DAY,
      sslNotAfterInSeconds: -35 * DAY,
      sslState: "expired",
    });
    const [event] = await get(org);
    expect(event?.kind).toBe("ssl_level");
    const age = (Date.now() - Date.parse(event?.at ?? "")) / 1000;
    expect(age).toBeLessThan(30 * DAY + 60);
  });
});

describe("List and Recent events: access", () => {
  const routes = ["", "/recent-events"];

  it("every role can read", async () => {
    for (const role of TEST_ROLES) {
      for (const route of routes) {
        const response = await ctx.call(
          order.users[role],
          "GET",
          monitorsPath(order.id, route),
        );
        expect(response.status, `${role} ${route}`).toBe(200);
      }
    }
  });

  it("answers a non-member like a missing Organization, without names, URLs or counts", async () => {
    const missing = crypto.randomUUID();
    for (const route of routes) {
      const denied = await ctx.call(
        outsider,
        "GET",
        monitorsPath(order.id, route),
      );
      const absent = await ctx.call(
        outsider,
        "GET",
        monitorsPath(missing, route),
      );
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual(absent.json);
      expect(denied.json).toMatchObject({
        error: { code: "MEMBERSHIP_DENIED" },
      });
      const text = JSON.stringify(denied.json);
      expect(text).not.toMatch(/Alpha|zulu|fixture\.example|total/i);
    }
  });

  it("rejects a request without a session", async () => {
    const response = await ctx.call(null, "GET", monitorsPath(order.id));
    expect(response.status).toBe(401);
  });
});
