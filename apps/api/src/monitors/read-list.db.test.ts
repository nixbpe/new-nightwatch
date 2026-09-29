import {
  monitorListResponseSchema,
  monitorRecentEventsResponseSchema,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ageSeries,
  rollupFromResults,
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
      "?health=healthy",
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
  it.each([
    ["30 d exactly", 30 * DAY, "caution", 30],
    ["30 d + 1 s", 30 * DAY + 1, "ok", 31],
    ["7 d exactly", 7 * DAY, "danger", 7],
    ["7 d + 1 s", 7 * DAY + 1, "caution", 8],
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
      expect(item?.ssl).toEqual({ level, daysRemaining: null, host: null });
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
      ["ssl_level", ssl],
      ["incident_opened", opened],
      ["incident_closed", closed],
      ["incident_opened", closed],
    ]);
    const [sslEvent, openedEvent, closedEvent] = body.events;
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
