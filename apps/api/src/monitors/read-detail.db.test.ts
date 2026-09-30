import {
  monitorChecksResponseSchema,
  monitorDetailResponseSchema,
  monitorIncidentsResponseSchema,
  monitorListResponseSchema,
  monitorWriteResponseSchema,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ageSeries,
  rollupFromResults,
  seedEvent,
  seedHourly,
  seedIncident,
  seedMonitor,
  seedResults,
  type SeedMonitor,
} from "./read-test-support";
import {
  monitorsPath,
  openMonitorTestContext,
  STUB_HOSTS,
  TEST_ROLES,
  validConfig,
  type MonitorTestContext,
  type TestOrganization,
  type TestRole,
} from "./test-support";

let ctx: MonitorTestContext;
let health: TestOrganization;
let detail: TestOrganization;
let history: TestOrganization;
let access: TestOrganization;
let other: TestOrganization;
let outsider: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  await ctx.owner.sql.query("select ensure_monitor_partitions(3)");
  health = await ctx.createOrganization("detail-health");
  detail = await ctx.createOrganization("detail-view");
  history = await ctx.createOrganization("detail-history");
  access = await ctx.createOrganization("detail-access");
  other = await ctx.createOrganization("detail-other");
  outsider = await ctx.createUser("detail-outsider");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

const read = (org: TestOrganization, path: string, role: TestRole = "viewer") =>
  ctx.call(org.users[role], "GET", monitorsPath(org.id, path));

async function detailOf(org: TestOrganization, id: string) {
  const response = await read(org, `/${id}`);
  expect(response.status).toBe(200);
  return monitorDetailResponseSchema.parse(response.json).monitor;
}

async function listItem(org: TestOrganization, id: string) {
  const response = await read(org, "?limit=50");
  expect(response.status).toBe(200);
  const item = monitorListResponseSchema
    .parse(response.json)
    .monitors.find((candidate) => candidate.id === id);
  if (!item) throw new Error("monitor missing from the List");
  return item;
}

const INTERVAL = 300;

describe("health: the seven steps, in List and Detail", () => {
  type Expected = {
    health: "up" | "down" | "unknown" | "paused";
    healthReason: string | null;
    lastKnownDown: boolean;
    consecutiveFailures: number;
    openIncident: boolean;
  };
  type Case = {
    name: string;
    monitor?: SeedMonitor;
    seed: (id: string) => Promise<void>;
    expected: Expected;
  };
  const org = () => health.id;
  const results = (
    id: string,
    ages: number[],
    outcome: "pass" | "fail" | "check_error",
    configVersion = 1,
  ) => seedResults(ctx, org(), id, ages, { outcome, configVersion });
  const incident = (id: string) =>
    seedIncident(ctx, org(), id, { startedAgoSeconds: 900 });

  const cases: Case[] = [
    {
      name: "2: never checked",
      seed: () => Promise.resolve(),
      expected: {
        health: "unknown",
        healthReason: "never_checked",
        lastKnownDown: false,
        consecutiveFailures: 0,
        openIncident: false,
      },
    },
    {
      name: "3: a pass 2 x interval - 1 s old is fresh",
      seed: (id) => results(id, [2 * INTERVAL - 1], "pass"),
      expected: {
        health: "up",
        healthReason: null,
        lastKnownDown: false,
        consecutiveFailures: 0,
        openIncident: false,
      },
    },
    {
      name: "3: a pass 2 x interval + 1 s old is stale",
      seed: (id) => results(id, [2 * INTERVAL + 1], "pass"),
      expected: {
        health: "unknown",
        healthReason: "stale",
        lastKnownDown: false,
        consecutiveFailures: 0,
        openIncident: false,
      },
    },
    {
      name: "3: stale with an open incident keeps lastKnownDown",
      monitor: { consecutiveFailures: 2 },
      seed: async (id) => {
        await results(id, [2 * INTERVAL + 1], "fail");
        await incident(id);
      },
      expected: {
        health: "unknown",
        healthReason: "stale",
        lastKnownDown: true,
        consecutiveFailures: 2,
        openIncident: true,
      },
    },
    {
      name: "5: fresh fail with an open incident is down",
      monitor: { consecutiveFailures: 2 },
      seed: async (id) => {
        await results(id, [2 * INTERVAL - 1], "fail");
        await incident(id);
      },
      expected: {
        health: "down",
        healthReason: null,
        lastKnownDown: false,
        consecutiveFailures: 2,
        openIncident: true,
      },
    },
    {
      name: "4: check_error latest, older pass",
      seed: async (id) => {
        await results(id, [10], "check_error");
        await results(id, [310], "pass");
      },
      expected: {
        health: "unknown",
        healthReason: "check_error",
        lastKnownDown: false,
        consecutiveFailures: 0,
        openIncident: false,
      },
    },
    {
      name: "4: check_error latest with an open incident",
      monitor: { consecutiveFailures: 2 },
      seed: async (id) => {
        await results(id, [10], "check_error");
        await results(id, [310, 610], "fail");
        await incident(id);
      },
      expected: {
        health: "unknown",
        healthReason: "check_error",
        lastKnownDown: true,
        consecutiveFailures: 2,
        openIncident: true,
      },
    },
    {
      name: "6: pass",
      seed: (id) => results(id, [10], "pass"),
      expected: {
        health: "up",
        healthReason: null,
        lastKnownDown: false,
        consecutiveFailures: 0,
        openIncident: false,
      },
    },
    {
      name: "6: pass then fail is up with one failure",
      monitor: { consecutiveFailures: 1 },
      seed: async (id) => {
        await results(id, [10], "fail");
        await results(id, [310], "pass");
      },
      expected: {
        health: "up",
        healthReason: null,
        lastKnownDown: false,
        consecutiveFailures: 1,
        openIncident: false,
      },
    },
    {
      name: "7: first failure of a new config is unknown with one failure",
      monitor: {
        checkConfigVersion: 2,
        consecutiveFailures: 1,
        lastPassedConfigVersion: 1,
      },
      seed: async (id) => {
        await results(id, [10], "fail", 2);
        await results(id, [310], "pass", 1);
      },
      expected: {
        health: "unknown",
        healthReason: null,
        lastKnownDown: false,
        consecutiveFailures: 1,
        openIncident: false,
      },
    },
    {
      name: "2: an edit with an open incident awaits a result of the new config",
      monitor: { checkConfigVersion: 2, consecutiveFailures: 0 },
      seed: async (id) => {
        await results(id, [10, 310], "fail", 1);
        await incident(id);
      },
      expected: {
        health: "unknown",
        healthReason: "awaiting_new_config",
        lastKnownDown: true,
        consecutiveFailures: 0,
        openIncident: true,
      },
    },
    {
      name: "1: paused, whatever the results say",
      monitor: { status: "paused" },
      seed: (id) => results(id, [10], "fail"),
      expected: {
        health: "paused",
        healthReason: null,
        lastKnownDown: false,
        consecutiveFailures: 0,
        openIncident: false,
      },
    },
  ];

  it.each(cases)("$name", async ({ name, monitor, seed, expected }) => {
    const id = await seedMonitor(ctx, org(), {
      ...monitor,
      name,
      intervalSeconds: INTERVAL,
    });
    await seed(id);
    const view = await detailOf(health, id);
    const item = await listItem(health, id);
    for (const source of [view, item]) {
      expect({
        health: source.health,
        healthReason: source.healthReason,
        lastKnownDown: source.lastKnownDown,
        consecutiveFailures: source.consecutiveFailures,
        openIncident: source.openIncident !== null,
      }).toEqual(expected);
    }
  });
});

describe("Resume (AC-19)", () => {
  it("is unknown until a result newer than the Resume exists, even after a fresh pass", async () => {
    const created = await ctx.call(
      detail.users.owner,
      "POST",
      monitorsPath(detail.id),
      {
        ...validConfig({ name: "Resumed" }),
        clientRequestId: crypto.randomUUID(),
      },
    );
    expect(created.status).toBe(201);
    const { id } = monitorWriteResponseSchema.parse(created.json).monitor;
    await seedResults(ctx, detail.id, id, [20]);
    expect((await detailOf(detail, id)).health).toBe("up");

    const action = (name: "pause" | "resume") =>
      ctx.call(
        detail.users.owner,
        "POST",
        monitorsPath(detail.id, `/${id}/${name}`),
      );
    expect((await action("pause")).status).toBe(200);
    expect((await detailOf(detail, id)).health).toBe("paused");
    expect((await action("resume")).status).toBe(200);

    // The pass is only seconds old, but it predates the Resume.
    for (const view of [
      await detailOf(detail, id),
      await listItem(detail, id),
    ]) {
      expect(view).toMatchObject({
        health: "unknown",
        healthReason: "stale",
        lastKnownDown: false,
      });
    }

    await seedResults(ctx, detail.id, id, [0]);
    expect(await detailOf(detail, id)).toMatchObject({
      health: "up",
      healthReason: null,
    });
  });
});

describe("SSL level in Detail", () => {
  const DAY = 86_400;
  it.each([
    ["30 d exactly", 30 * DAY, "caution", 30],
    ["30 d + 1 s", 30 * DAY + 1, "ok", 31],
    ["7 d exactly", 7 * DAY, "danger", 7],
    ["7 d + 1 s", 7 * DAY + 1, "caution", 8],
    ["expired 1 s ago", -1, "expired", 0],
  ] as const)("%s", async (name, secondsLeft, level, days) => {
    const id = await seedMonitor(ctx, detail.id, {
      name,
      sslHost: "ssl.example",
      sslNotAfterInSeconds: secondsLeft,
      sslState: "ok",
      sslReason: null,
    });
    const view = await detailOf(detail, id);
    expect(view.ssl).toMatchObject({
      state: level,
      daysRemaining: days,
      host: "ssl.example",
    });
    expect(view.ssl.notAfter).not.toBeNull();
  });
});

describe("SSL state recorded by the checker", () => {
  it("reports an unreadable certificate with its reason although an old expiry is kept", async () => {
    const id = await seedMonitor(ctx, detail.id, {
      name: "unreadable with kept expiry",
      sslHost: "ssl.example",
      sslNotAfterInSeconds: 60 * 86_400,
      sslState: "unreadable",
      sslReason: "handshake_failed",
    });
    const view = await detailOf(detail, id);
    expect(view.ssl).toMatchObject({
      state: "unreadable",
      reason: "handshake_failed",
      daysRemaining: null,
      host: "ssl.example",
    });
  });

  it("reports an expired handshake without a date as expired with no days", async () => {
    const id = await seedMonitor(ctx, detail.id, {
      name: "expired without date",
      sslHost: "ssl.example",
      sslState: "expired",
      sslReason: "expired",
    });
    const view = await detailOf(detail, id);
    expect(view.ssl).toMatchObject({
      state: "expired",
      reason: "expired",
      notAfter: null,
      daysRemaining: null,
    });
  });
});

describe("Detail view", () => {
  it("returns the record of the write routes plus the computed state", async () => {
    const created = await ctx.call(
      detail.users.owner,
      "POST",
      monitorsPath(detail.id),
      {
        ...validConfig({
          name: "Full",
          url: `https://${STUB_HOSTS.public}/health`,
          headers: [{ name: "X-Env", value: "prod", secret: false }],
          queryParams: [{ name: "token", value: "SECRETVALUE" }],
          body: { type: "json", content: '{"a":1}' },
          method: "POST",
        }),
        clientRequestId: crypto.randomUUID(),
      },
    );
    expect(created.status).toBe(201);
    const record = monitorWriteResponseSchema.parse(created.json).monitor;
    await ctx.owner.sql.query(
      `insert into monitor_secrets
         (monitor_id, tenant_id, slot, ciphertext, iv, auth_tag, key_version)
       values ($1, $2, 'auth.token', '\\xdeadbeef', '\\x00', '\\x01', 'dev')`,
      [record.id, detail.id],
    );
    await seedResults(ctx, detail.id, record.id, [20], {
      assertions: [
        {
          kind: "bodyContains",
          expected: "ok",
          actual: null,
          actualType: null,
          actualTruncated: false,
          status: "pass",
          reason: null,
        },
      ],
      urlMasked: `https://${STUB_HOSTS.public}/health?token=•••`,
      responseTimeMs: 87,
    });

    const view = await detailOf(detail, record.id);
    expect(view).toMatchObject({
      ...record,
      secretSlots: [{ slot: "auth.token", configured: true }],
      health: "up",
      lastKnownDown: false,
      openIncident: null,
    });
    expect(view.lastResult).toMatchObject({
      outcome: "pass",
      httpStatus: 200,
      responseTimeMs: 87,
      configVersion: 1,
      url: `https://${STUB_HOSTS.public}/health?token=•••`,
      assertions: [{ kind: "bodyContains", status: "pass" }],
    });
    expect(view.lastCheckAt).toBe(view.lastResult?.checkedAt);
    expect(Date.parse(view.dataAsOf)).toBeGreaterThan(Date.now() - 60_000);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/deadbeef|ciphertext/i);
  });

  it("has no result yet for a monitor that was never checked", async () => {
    const id = await seedMonitor(ctx, detail.id, { name: "fresh" });
    const view = await detailOf(detail, id);
    expect(view.lastResult).toBeNull();
    expect(view.lastCheckAt).toBeNull();
    expect(view.ssl).toMatchObject({ state: "no_data", daysRemaining: null });
    expect(view.uptime.h24).toEqual({
      percent: null,
      checks: 0,
      coveragePercent: 0,
    });
  });
});

describe("uptime and coverage", () => {
  it("a monitor aged 2 h in a 30-day window is fully covered", async () => {
    const id = await seedMonitor(ctx, detail.id, {
      name: "aged 2h",
      createdAgoSeconds: 7200,
    });
    // 24 passing 5-minute checks, ages 5 s to 6,905 s: 7,200 s covered of 7,200 s.
    await seedResults(ctx, detail.id, id, ageSeries(24, 300, 5));
    await rollupFromResults(ctx, id);
    const { uptime } = await detailOf(detail, id);
    for (const window of [uptime.h24, uptime.d7, uptime.d30]) {
      expect(window.percent).toBe(100);
      expect(window.checks).toBe(24);
      expect(window.coveragePercent).toBeCloseTo(100, 0);
    }
  });

  it("does not expect the time of a 1 h pause, and ignores check_error", async () => {
    const id = await seedMonitor(ctx, detail.id, {
      name: "paused 1h",
      createdAgoSeconds: 3 * 3600,
    });
    await seedEvent(ctx, detail.id, id, "paused", 2 * 3600);
    await seedEvent(ctx, detail.id, id, "resumed", 3600);
    // 12 checks in the last hour (ages 5 to 60 min) and 11 before the pause
    // (ages 125 to 175 min): 23 x 300 s = 6,900 s covered of 10,800 - 3,600 s.
    await seedResults(ctx, detail.id, id, [
      ...ageSeries(12, 300, 300),
      ...ageSeries(11, 300, 7500),
    ]);
    await seedResults(ctx, detail.id, id, [400, 4000, 9000], {
      outcome: "check_error",
    });
    await rollupFromResults(ctx, id);
    const { uptime } = await detailOf(detail, id);
    for (const window of [uptime.h24, uptime.d7, uptime.d30]) {
      expect(window.checks).toBe(23);
      expect(window.percent).toBe(100);
      expect(window.coveragePercent).toBeCloseTo(95.83, 1);
    }
  });

  it("counts failures: 2 fails in 8 checks is 75 %", async () => {
    const id = await seedMonitor(ctx, detail.id, {
      name: "flaky",
      createdAgoSeconds: 8 * 300 + 60,
    });
    await seedResults(ctx, detail.id, id, ageSeries(6, 300, 60));
    await seedResults(ctx, detail.id, id, [1860, 2160], { outcome: "fail" });
    await rollupFromResults(ctx, id);
    const { uptime } = await detailOf(detail, id);
    for (const window of [uptime.h24, uptime.d7, uptime.d30]) {
      expect(window.percent).toBe(75);
      expect(window.checks).toBe(8);
    }
  });

  describe("pause derived from the events that retention left", () => {
    const tenDays = ageSeries(240, 1, 1);
    const dayAgo = 86_400;

    async function monitorWithTenDaysOfChecks(
      name: string,
      options: SeedMonitor,
    ) {
      const id = await seedMonitor(ctx, detail.id, {
        ...options,
        name,
        createdAgoSeconds: 60 * dayAgo,
      });
      // One full hour of 12 passing checks for each of the last 10 days x 24 h.
      await seedHourly(ctx, detail.id, id, tenDays, {
        checks: 12,
        passed: 12,
        coveredSeconds: 3600,
      });
      return id;
    }

    it("paused 40 days ago and still paused: the whole window is paused", async () => {
      const id = await monitorWithTenDaysOfChecks("still paused", {
        status: "paused",
      });
      await seedEvent(ctx, detail.id, id, "paused", 40 * dayAgo);
      const { uptime } = await detailOf(detail, id);
      expect(uptime.d30.checks).toBe(2880);
      expect(uptime.d30.coveragePercent).toBe(0);
      expect(uptime.d7.coveragePercent).toBe(0);
    });

    it("paused 40 days ago, resumed 10 days ago: paused until the resume", async () => {
      const id = await monitorWithTenDaysOfChecks("resumed 10d", {});
      await seedEvent(ctx, detail.id, id, "paused", 40 * dayAgo);
      await seedEvent(ctx, detail.id, id, "resumed", 10 * dayAgo);
      const { uptime } = await detailOf(detail, id);
      // Expected 10 days = 864,000 s; covered 240 h x 3,600 s.
      expect(uptime.d30.coveragePercent).toBeCloseTo(100, 0);
      // The 7-day window also expects the current hour, which has no rollup
      // row yet, so it can read up to 1 h in 167 h (0.6 %) short.
      expect(uptime.d7.coveragePercent).toBeGreaterThan(99);
      expect(uptime.d7.coveragePercent).toBeLessThanOrEqual(100);
    });

    it("paused 40 days ago, resumed 35 days ago: not paused inside the window", async () => {
      const id = await monitorWithTenDaysOfChecks("resumed 35d", {});
      await seedEvent(ctx, detail.id, id, "paused", 40 * dayAgo);
      await seedEvent(ctx, detail.id, id, "resumed", 35 * dayAgo);
      const { uptime } = await detailOf(detail, id);
      // 864,000 s covered of about 30 days (2,592,000 s less up to 1 h of rounding).
      expect(uptime.d30.coveragePercent).toBeCloseTo(33.33, 0);
      expect(uptime.d30.coveragePercent).toBeLessThan(34);
    });
  });

  it("rounds the 7-day window start up to the next hour: an hour before it is not read", async () => {
    const id = await seedMonitor(ctx, detail.id, { name: "hour edge" });
    // date_trunc(now) - 168 h is the hour that contains now - 7 d, so it starts
    // before the window; 167 h ago starts at the first whole hour inside it.
    await seedHourly(ctx, detail.id, id, [168], {
      checks: 100,
      passed: 100,
      coveredSeconds: 30_000,
    });
    await seedHourly(ctx, detail.id, id, [167], {
      checks: 7,
      passed: 5,
      coveredSeconds: 2100,
    });
    const { uptime } = await detailOf(detail, id);
    expect(uptime.d7).toMatchObject({ checks: 7 });
    expect(uptime.d7.percent).toBeCloseTo(71.43, 2);
    expect(uptime.d30.checks).toBe(107);
  });
});

describe("Check history", () => {
  const masked = "https://checks.example/health?token=•••";
  let id: string;

  beforeAll(async () => {
    const created = await ctx.call(
      history.users.owner,
      "POST",
      monitorsPath(history.id),
      {
        ...validConfig({
          name: "History",
          url: `https://${STUB_HOSTS.public}/health`,
          queryParams: [{ name: "token", value: "RAWSECRET" }],
        }),
        clientRequestId: crypto.randomUUID(),
      },
    );
    id = monitorWriteResponseSchema.parse(created.json).monitor.id;
    // 30 checks, 60 s apart, ages 60 s to 1,800 s; the newest carries a fail.
    await seedResults(ctx, history.id, id, ageSeries(30, 60, 60), {
      urlMasked: masked,
    });
    await seedResults(ctx, history.id, id, [30], {
      outcome: "fail",
      failureReason: "http_status",
      urlMasked: masked,
    });
    await seedEvent(ctx, history.id, id, "config_changed", 10, masked);
    await seedEvent(ctx, history.id, id, "config_changed", 1000, masked);
    await seedEvent(ctx, history.id, id, "config_changed", 5000, masked);
    // A change that did not touch the URL carries no marker.
    await seedEvent(ctx, history.id, id, "config_changed", 700, null);
  });

  const page = async (query: string) => {
    const response = await read(history, `/${id}/checks${query}`);
    expect(response.status).toBe(200);
    return monitorChecksResponseSchema.parse(response.json);
  };

  it("lists newest first with the masked URL only", async () => {
    const body = await page("");
    expect(body.checks).toHaveLength(20);
    expect(body.page).toEqual({ limit: 20, offset: 0, total: 31 });
    expect(body.checks[0]).toMatchObject({
      outcome: "fail",
      failureReason: "http_status",
      httpStatus: 500,
    });
    const times = body.checks.map((check) => check.scheduledFor);
    expect([...times].sort().reverse()).toEqual(times);
    expect(body.checks.every((check) => check.url === masked)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("RAWSECRET");
  });

  it("puts each URL change on the page that holds the first check after it", async () => {
    // 31 checks: ages 30 s, then 60 s to 1,800 s. Changes at 10 s (newer than
    // every check), 1,000 s (first check after it is at 960 s) and 5,000 s
    // (older than every check, so the oldest check is the first after it).
    const pages = [
      await page("?limit=10&offset=0"),
      await page("?limit=10&offset=10"),
      await page("?limit=10&offset=20"),
      await page("?limit=10&offset=30"),
    ];
    expect(pages.map((body) => body.urlChanges.length)).toEqual([1, 1, 0, 1]);
    expect(pages[0]?.urlChanges[0]?.url).toBe(masked);
    expect(pages.flatMap((body) => body.urlChanges).length).toBe(3);
  });

  it("returns every URL change once across pages, and no marker for a non-URL change", async () => {
    const all = await page("?limit=50");
    expect(all.urlChanges).toHaveLength(3);
    expect(all.checks).toHaveLength(31);
    const beyond = await page("?limit=10&offset=100");
    expect(beyond.checks).toEqual([]);
    expect(beyond.urlChanges).toEqual([]);
  });

  it("rejects out-of-range paging", async () => {
    for (const query of ["?limit=0", "?limit=51", "?offset=-1"]) {
      const response = await read(history, `/${id}/checks${query}`);
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({ error: { code: "INVALID_INPUT" } });
    }
  });
});

describe("Incidents", () => {
  it("lists newest first with duration, reasons and paging", async () => {
    const id = await seedMonitor(ctx, history.id, { name: "incidents" });
    await seedIncident(ctx, history.id, id, {
      startedAgoSeconds: 90_000,
      endedAgoSeconds: 86_400,
      reason: "timeout",
      httpStatus: null,
    });
    await seedIncident(ctx, history.id, id, {
      startedAgoSeconds: 50_000,
      endedAgoSeconds: 40_000,
      reason: "http_status",
      httpStatus: 503,
      endReason: "paused_by_user",
    });
    await seedIncident(ctx, history.id, id, {
      startedAgoSeconds: 600,
      reason: "dns_not_found",
      httpStatus: null,
    });
    const response = await read(history, `/${id}/incidents`);
    expect(response.status).toBe(200);
    const body = monitorIncidentsResponseSchema.parse(response.json);
    expect(body.page).toEqual({ limit: 20, offset: 0, total: 3 });
    expect(
      body.incidents.map((incident) => [
        incident.startReason,
        incident.startHttpStatus,
        incident.endReason,
        incident.endedAt === null,
      ]),
    ).toEqual([
      ["dns_not_found", null, null, true],
      ["http_status", 503, "paused_by_user", false],
      ["timeout", null, "recovered", false],
    ]);
    expect(body.incidents[1]?.durationSeconds).toBe(10_000);
    expect(body.incidents[2]?.durationSeconds).toBe(3600);
    // The open incident lasts until now.
    expect(body.incidents[0]?.durationSeconds).toBeGreaterThanOrEqual(600);
    expect(body.incidents[0]?.durationSeconds).toBeLessThan(700);

    const second = monitorIncidentsResponseSchema.parse(
      (await read(history, `/${id}/incidents?limit=1&offset=1`)).json,
    );
    expect(second.incidents.map((incident) => incident.startReason)).toEqual([
      "http_status",
    ]);
    expect(second.page).toEqual({ limit: 1, offset: 1, total: 3 });
  });
});

describe("Detail, Checks and Incidents: access", () => {
  let id: string;
  let foreign: string;
  const suffixes = ["", "/checks", "/incidents"];

  beforeAll(async () => {
    id = await seedMonitor(ctx, access.id, {
      name: "Secret Name",
      url: "https://private-host.example/private-path",
    });
    foreign = await seedMonitor(ctx, other.id, { name: "Other org monitor" });
  });

  it("every role can read every route", async () => {
    for (const role of TEST_ROLES) {
      for (const suffix of suffixes) {
        const response = await ctx.call(
          access.users[role],
          "GET",
          monitorsPath(access.id, `/${id}${suffix}`),
        );
        expect(response.status, `${role} ${suffix}`).toBe(200);
      }
    }
  });

  it("answers a non-member like a missing Organization, without names, URLs or counts", async () => {
    for (const suffix of suffixes) {
      const denied = await ctx.call(
        outsider,
        "GET",
        monitorsPath(access.id, `/${id}${suffix}`),
      );
      const absent = await ctx.call(
        outsider,
        "GET",
        monitorsPath(crypto.randomUUID(), `/${id}${suffix}`),
      );
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual(absent.json);
      expect(denied.json).toMatchObject({
        error: { code: "MEMBERSHIP_DENIED" },
      });
      expect(JSON.stringify(denied.json)).not.toMatch(
        /Secret Name|private-host|private-path|total/i,
      );
    }
    // Membership is checked before the id, so a malformed id does not leak either.
    const malformed = await ctx.call(
      outsider,
      "GET",
      monitorsPath(access.id, "/not-a-uuid"),
    );
    expect(malformed.status).toBe(403);
  });

  it("answers a missing, a malformed and a foreign id with the same 404", async () => {
    for (const suffix of suffixes) {
      const bodies = [];
      for (const target of [crypto.randomUUID(), "not-a-uuid", foreign]) {
        const response = await ctx.call(
          access.users.viewer,
          "GET",
          monitorsPath(access.id, `/${target}${suffix}`),
        );
        expect(response.status, `${target} ${suffix}`).toBe(404);
        bodies.push(response.json);
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(bodies[0]).toMatchObject({
        error: { code: "MONITOR_NOT_FOUND" },
      });
      expect(JSON.stringify(bodies[0])).not.toContain("Other org monitor");
    }
  });
});
