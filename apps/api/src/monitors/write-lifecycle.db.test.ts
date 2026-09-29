import {
  monitorWriteResponseSchema,
  type MonitorConfigInput,
  type MonitorRecord,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  monitorsPath,
  openMonitorTestContext,
  STUB_HOSTS,
  validConfig,
  type MonitorTestContext,
  type TestOrganization,
} from "./test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  org = await ctx.createOrganization("lifecycle");
  // Results are partitioned by month; the delete test inserts one.
  await ctx.owner.sql.query("select ensure_monitor_partitions(3)");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

const owner = () => org.users.owner;

async function create(
  config: MonitorConfigInput = validConfig(),
  organization: TestOrganization = org,
  clientRequestId: string = crypto.randomUUID(),
) {
  const response = await ctx.call(
    organization.users.owner,
    "POST",
    monitorsPath(organization.id),
    { ...config, clientRequestId },
  );
  return { response, clientRequestId };
}

async function created(config: MonitorConfigInput = validConfig()) {
  const { response } = await create(config);
  expect(response.status).toBe(201);
  return monitorWriteResponseSchema.parse(response.json).monitor;
}

const edit = (
  monitor: MonitorRecord,
  config: MonitorConfigInput,
  expectedVersion: number = monitor.version,
) =>
  ctx.call(owner(), "PATCH", monitorsPath(org.id, `/${monitor.id}`), {
    ...config,
    expectedVersion,
  });

const action = (monitor: MonitorRecord, name: "pause" | "resume") =>
  ctx.call(owner(), "POST", monitorsPath(org.id, `/${monitor.id}/${name}`));

const configOf = (monitor: MonitorRecord): MonitorConfigInput => ({
  name: monitor.name,
  url: monitor.url,
  intervalSeconds: monitor.intervalSeconds,
  timeoutSeconds: monitor.timeoutSeconds,
  method: monitor.method,
  headers: monitor.headers,
  queryParams: monitor.queryParams,
  body: monitor.body,
  expectedStatus: monitor.expectedStatus,
  assertions: monitor.assertions,
  auth: monitor.auth,
});

type MonitorDbRow = {
  version: number;
  check_config_version: number;
  consecutive_failures: number;
  status: string;
  name: string;
  url: string;
  expected_status_text: string;
  expected_status_ranges: unknown;
  assertions: unknown;
  headers: unknown;
  last_check_at: Date | null;
};
type ScheduleDbRow = {
  next_check_at: Date | null;
  claim_token: string | null;
  claimed_until: Date | null;
  check_config_version: number;
  interval_seconds: number;
  timeout_seconds: number;
  // Seconds from now(); positive means in the future.
  next_in_seconds: number | null;
  due: boolean;
};

async function monitorRow(id: string): Promise<MonitorDbRow> {
  const result = await ctx.owner.sql.query<MonitorDbRow>(
    "select * from monitors where id = $1",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("monitor row missing");
  return row;
}

async function scheduleRow(id: string): Promise<ScheduleDbRow> {
  const result = await ctx.owner.sql.query<ScheduleDbRow>(
    `select *, extract(epoch from next_check_at - now())::float as next_in_seconds,
       -- the predicate claim_due_monitor_checks applies
       coalesce(next_check_at <= now() and (claim_token is null or claimed_until < now()), false) as due
     from monitor_schedule where monitor_id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("schedule row missing");
  return row;
}

async function events(id: string) {
  const result = await ctx.owner.sql.query<{
    kind: string;
    url_masked: string | null;
  }>(
    "select kind, url_masked from monitor_events where monitor_id = $1 order by occurred_at, id",
    [id],
  );
  return result.rows;
}

const mutationLines = (monitorId?: string) =>
  ctx
    .logRecords()
    .filter(
      (line) =>
        line.msg === "monitor mutation" &&
        (monitorId === undefined || line.monitorId === monitorId),
    );

describe("Create", () => {
  it("stores normalized forms, schedules the first check now and returns the record", async () => {
    const response = (
      await create(
        validConfig({
          name: "  Stored  ",
          expectedStatus: "200-299, 301",
          assertions: [
            { kind: "jsonPathEquals", path: "$.a['b'][0]", expected: '"1"' },
            { kind: "jsonPathEquals", path: "$.n", expected: "1" },
            { kind: "bodyContains", text: "ok" },
            { kind: "responseTimeBelow", ms: 500 },
          ],
        }),
      )
    ).response;
    expect(response.status).toBe(201);
    const { monitor } = monitorWriteResponseSchema.parse(response.json);
    expect(monitor).toMatchObject({
      name: "Stored",
      status: "active",
      version: 1,
      intervalSeconds: 300,
      timeoutSeconds: 10,
      expectedStatus: "200-299, 301",
      secretSlots: [],
    });
    // Edit display data comes back as typed.
    expect(monitor.assertions[0]).toEqual({
      kind: "jsonPathEquals",
      path: "$.a['b'][0]",
      expected: '"1"',
    });

    const row = await monitorRow(monitor.id);
    expect(row.expected_status_text).toBe("200-299, 301");
    expect(row.expected_status_ranges).toEqual([
      { from: 200, to: 299 },
      { from: 301, to: 301 },
    ]);
    expect(row.assertions).toEqual([
      {
        kind: "jsonPathEquals",
        path: "$.a['b'][0]",
        expected: '"1"',
        pathSegments: ["a", "b", 0],
        expectedValue: "1",
      },
      {
        kind: "jsonPathEquals",
        path: "$.n",
        expected: "1",
        pathSegments: ["n"],
        expectedValue: 1,
      },
      { kind: "bodyContains", text: "ok" },
      { kind: "responseTimeBelow", ms: 500 },
    ]);
    expect(row.check_config_version).toBe(1);

    const schedule = await scheduleRow(monitor.id);
    expect(schedule).toMatchObject({
      check_config_version: 1,
      interval_seconds: 300,
      timeout_seconds: 10,
      claim_token: null,
    });
    expect(schedule.due).toBe(true);
    expect(Math.abs(schedule.next_in_seconds ?? 99)).toBeLessThan(5);
  });

  it("never stores the value of a secret header", async () => {
    const marker = "value-that-must-not-be-stored";
    const monitor = await created(
      validConfig({
        headers: [{ name: "X-Secret", value: marker, secret: true }],
      }),
    );
    expect(JSON.stringify(monitor)).not.toContain(marker);
    const stored = JSON.stringify((await monitorRow(monitor.id)).headers);
    expect(stored).not.toContain(marker);
    const [header, ...rest] = JSON.parse(stored) as Record<string, unknown>[];
    expect(rest).toEqual([]);
    expect(Object.keys(header ?? {}).sort()).toEqual(["id", "name", "secret"]);
    expect(header).toMatchObject({ name: "X-Secret", secret: true });
  });

  it("saves POST, PUT, PATCH and DELETE monitors", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const { response } = await create(validConfig({ method }));
      expect(response.status, method).toBe(201);
    }
  });

  it("audits once, with identifiers only", async () => {
    const monitor = await created(
      validConfig({ url: `https://${STUB_HOSTS.public}/x?token=audit-marker` }),
    );
    const lines = mutationLines(monitor.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      actorUserId: owner(),
      action: "organization.monitor.create",
      organizationId: org.id,
      monitorId: monitor.id,
    });
    expect(JSON.stringify(lines[0])).not.toContain("audit-marker");
    expect(JSON.stringify(lines[0])).not.toContain(STUB_HOSTS.public);
  });

  async function seed(organization: TestOrganization, count: number) {
    await ctx.owner.sql.query(
      `insert into monitors (tenant_id, client_request_id, name, url)
       select $1, gen_random_uuid(), 'seed-' || n, 'https://seed.example/'
       from generate_series(1, $2) as n`,
      [organization.id, count],
    );
  }
  const count = async (organization: TestOrganization) =>
    Number(
      (
        await ctx.owner.sql.query<{ total: string }>(
          "select count(*) as total from monitors where tenant_id = $1",
          [organization.id],
        )
      ).rows[0]?.total,
    );

  it("accepts the 50th monitor, rejects the 51st and replays the 50th without an audit", async () => {
    const limited = await ctx.createOrganization("limit");
    await seed(limited, 49);
    const fiftieth = await create(validConfig(), limited);
    expect(fiftieth.response.status).toBe(201);
    const { monitor } = monitorWriteResponseSchema.parse(
      fiftieth.response.json,
    );

    const overflow = await create(validConfig(), limited);
    expect(overflow.response.status).toBe(409);
    expect(overflow.response.json).toMatchObject({
      error: { code: "MONITOR_LIMIT_REACHED" },
    });
    expect(await count(limited)).toBe(50);

    // The replay wins over the limit and writes nothing.
    const replay = await create(
      validConfig({ name: "different body" }),
      limited,
      fiftieth.clientRequestId,
    );
    expect(replay.response.status).toBe(201);
    expect(
      monitorWriteResponseSchema.parse(replay.response.json).monitor.id,
    ).toBe(monitor.id);
    expect(await count(limited)).toBe(50);
    expect(mutationLines(monitor.id)).toHaveLength(1);
  });

  it("lets exactly one of two concurrent creates take the 50th slot", async () => {
    const limited = await ctx.createOrganization("concurrent-limit");
    await seed(limited, 49);
    const results = await Promise.all([
      create(validConfig(), limited),
      create(validConfig(), limited),
    ]);
    expect(results.map((result) => result.response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await count(limited)).toBe(50);
  });

  it("returns the original monitor for concurrent requests with one clientRequestId", async () => {
    const clientRequestId = crypto.randomUUID();
    const results = await Promise.all([
      create(validConfig(), org, clientRequestId),
      create(validConfig(), org, clientRequestId),
    ]);
    const ids = results.map(
      (result) =>
        monitorWriteResponseSchema.parse(result.response.json).monitor.id,
    );
    expect(results.map((result) => result.response.status)).toEqual([201, 201]);
    expect(ids[0]).toBe(ids[1]);
    expect(mutationLines(ids[0])).toHaveLength(1);
  });
});

describe("Edit", () => {
  it("lets one of two sessions win with the same expectedVersion", async () => {
    const monitor = await created();
    const [first, second] = await Promise.all([
      edit(monitor, configOf({ ...monitor, name: "From A" })),
      edit(monitor, configOf({ ...monitor, name: "From B" })),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.json).toEqual({
      error: {
        code: "MONITOR_VERSION_CONFLICT",
        message: "มอนิเตอร์ถูกแก้ไขแล้ว",
        details: { currentVersion: 2 },
      },
    });
    expect((await monitorRow(monitor.id)).version).toBe(2);
    expect(
      mutationLines(monitor.id).filter(
        (l) => l.action === "organization.monitor.update",
      ),
    ).toHaveLength(1);
  });

  it("rejects a stale expectedVersion without writing", async () => {
    const monitor = await created();
    await edit(monitor, configOf({ ...monitor, name: "v2" }));
    const stale = await edit(monitor, configOf({ ...monitor, name: "stale" }));
    expect(stale.status).toBe(409);
    expect((await monitorRow(monitor.id)).name).toBe("v2");
  });

  it("does not bump check_config_version or touch the schedule for a name-only edit", async () => {
    const monitor = await created();
    await ctx.owner.sql.query(
      "update monitors set consecutive_failures = 3 where id = $1",
      [monitor.id],
    );
    const before = await scheduleRow(monitor.id);
    const response = await edit(
      monitor,
      configOf({ ...monitor, name: "Only name" }),
    );
    expect(response.status).toBe(200);
    const row = await monitorRow(monitor.id);
    expect(row).toMatchObject({
      version: 2,
      check_config_version: 1,
      consecutive_failures: 3,
      name: "Only name",
    });
    expect(await scheduleRow(monitor.id)).toMatchObject({
      check_config_version: 1,
      next_check_at: before.next_check_at,
    });
    expect(await events(monitor.id)).toEqual([
      { kind: "config_changed", url_masked: null },
    ]);
  });

  it("treats a JSONPath spelled differently but equal after parsing as not affecting checks", async () => {
    const monitor = await created(
      validConfig({
        assertions: [{ kind: "jsonPathEquals", path: "$.a", expected: "1" }],
      }),
    );
    const response = await edit(
      monitor,
      configOf({
        ...monitor,
        assertions: [{ kind: "jsonPathEquals", path: "$['a']", expected: "1" }],
      }),
    );
    expect(response.status).toBe(200);
    expect(await monitorRow(monitor.id)).toMatchObject({
      version: 2,
      check_config_version: 1,
    });
  });

  it("bumps check_config_version, resets the streak, clears the claim and records a masked URL when the URL changes", async () => {
    const monitor = await created();
    await ctx.owner.sql.query(
      "update monitors set consecutive_failures = 4 where id = $1",
      [monitor.id],
    );
    await ctx.owner.sql.query(
      `update monitor_schedule set claim_token = 'held', claimed_until = now() + interval '1 minute',
         next_check_at = now() + interval '1 hour' where monitor_id = $1`,
      [monitor.id],
    );
    const response = await edit(
      monitor,
      configOf({
        ...monitor,
        url: `https://${STUB_HOSTS.public}/changed?token=url-marker`,
      }),
    );
    expect(response.status).toBe(200);
    expect(await monitorRow(monitor.id)).toMatchObject({
      version: 2,
      check_config_version: 2,
      consecutive_failures: 0,
    });
    const schedule = await scheduleRow(monitor.id);
    expect(schedule).toMatchObject({
      check_config_version: 2,
      claim_token: null,
      claimed_until: null,
    });
    expect(schedule.due).toBe(true);
    const [event] = await events(monitor.id);
    expect(event).toEqual({
      kind: "config_changed",
      url_masked: `https://${STUB_HOSTS.public}/changed?token=•••`,
    });
    expect(JSON.stringify(event)).not.toContain("url-marker");
  });

  it("records no URL for a query-param-only change but still bumps check_config_version", async () => {
    const monitor = await created();
    await edit(
      monitor,
      configOf({ ...monitor, queryParams: [{ name: "q", value: "1" }] }),
    );
    expect(await monitorRow(monitor.id)).toMatchObject({
      check_config_version: 2,
    });
    expect(await events(monitor.id)).toEqual([
      { kind: "config_changed", url_masked: null },
    ]);
  });

  it("updates the schedule for a timeout edit and bumps check_config_version", async () => {
    const monitor = await created();
    const response = await edit(
      monitor,
      configOf({ ...monitor, timeoutSeconds: 20 }),
    );
    expect(response.status).toBe(200);
    expect(await monitorRow(monitor.id)).toMatchObject({
      check_config_version: 2,
    });
    expect(await scheduleRow(monitor.id)).toMatchObject({
      timeout_seconds: 20,
      check_config_version: 2,
    });
  });

  describe("interval-only edit", () => {
    async function intervalEdit(lastCheck: string) {
      const monitor = await created();
      await ctx.owner.sql.query(
        `update monitors set last_check_at = ${lastCheck} where id = $1`,
        [monitor.id],
      );
      await ctx.owner.sql.query(
        "update monitor_schedule set next_check_at = now() + interval '1 hour' where monitor_id = $1",
        [monitor.id],
      );
      const response = await edit(
        monitor,
        configOf({ ...monitor, intervalSeconds: 60 }),
      );
      expect(response.status).toBe(200);
      expect(await monitorRow(monitor.id)).toMatchObject({
        check_config_version: 1,
      });
      const schedule = await scheduleRow(monitor.id);
      expect(schedule.interval_seconds).toBe(60);
      return schedule;
    }

    it("schedules last_check_at + the new interval when that is in the future", async () => {
      const schedule = await intervalEdit("now() - interval '10 seconds'");
      expect(schedule.next_in_seconds).toBeGreaterThan(46);
      expect(schedule.next_in_seconds).toBeLessThan(51);
    });

    it("schedules now when the new interval already elapsed", async () => {
      const schedule = await intervalEdit("now() - interval '1 hour'");
      expect(Math.abs(schedule.next_in_seconds ?? 99)).toBeLessThan(5);
    });

    it("schedules now for a monitor that was never checked", async () => {
      const schedule = await intervalEdit("null");
      expect(Math.abs(schedule.next_in_seconds ?? 99)).toBeLessThan(5);
    });
  });

  it("returns the typed expected status and assertion text in the record", async () => {
    const monitor = await created();
    const response = await edit(
      monitor,
      configOf({
        ...monitor,
        expectedStatus: "204, 200-299",
        assertions: [
          { kind: "jsonPathEquals", path: " $.a ", expected: "true" },
        ],
      }),
    );
    const { monitor: saved } = monitorWriteResponseSchema.parse(response.json);
    expect(saved.expectedStatus).toBe("204, 200-299");
    expect(saved.assertions).toEqual([
      { kind: "jsonPathEquals", path: " $.a ", expected: "true" },
    ]);
    const row = await monitorRow(monitor.id);
    expect(row.expected_status_ranges).toEqual([
      { from: 204, to: 204 },
      { from: 200, to: 299 },
    ]);
    expect(row.assertions).toMatchObject([
      { pathSegments: ["a"], expectedValue: true },
    ]);
  });

  it("does nothing for an identical configuration", async () => {
    const monitor = await created();
    const before = mutationLines(monitor.id).length;
    const response = await edit(monitor, configOf(monitor));
    expect(response.status).toBe(200);
    expect(
      monitorWriteResponseSchema.parse(response.json).monitor.version,
    ).toBe(1);
    expect(await events(monitor.id)).toEqual([]);
    expect(mutationLines(monitor.id)).toHaveLength(before);
  });

  it("keeps a paused monitor unclaimable through edits", async () => {
    const monitor = await created();
    expect((await action(monitor, "pause")).status).toBe(200);
    let current = monitor;
    for (const change of [
      { url: `https://${STUB_HOSTS.public}/paused-edit` },
      { intervalSeconds: 900 },
      { timeoutSeconds: 3 },
    ]) {
      const response = await edit(
        current,
        { ...configOf(current), ...change },
        (await monitorRow(monitor.id)).version,
      );
      expect(response.status).toBe(200);
      current = monitorWriteResponseSchema.parse(response.json).monitor;
      expect(current.status).toBe("paused");
      const schedule = await scheduleRow(monitor.id);
      expect(schedule.next_check_at).toBeNull();
      expect(schedule.due).toBe(false);
    }
    expect(await scheduleRow(monitor.id)).toMatchObject({
      interval_seconds: 900,
      timeout_seconds: 3,
    });

    // Resume makes it due immediately.
    expect((await action(monitor, "resume")).status).toBe(200);
    const resumed = await scheduleRow(monitor.id);
    expect(resumed.due).toBe(true);
  });
});

describe("Pause and Resume", () => {
  it("pauses: clears the claim, makes the row unclaimable, closes the open incident and records the event", async () => {
    const monitor = await created();
    await ctx.owner.sql.query(
      `update monitor_schedule set claim_token = 'held', claimed_until = now() + interval '1 minute'
       where monitor_id = $1`,
      [monitor.id],
    );
    await ctx.owner.sql.query(
      `insert into monitor_incidents (monitor_id, tenant_id, started_at, start_reason)
       values ($1, $2, now() - interval '5 minutes', 'http_status')`,
      [monitor.id, org.id],
    );
    const response = await action(monitor, "pause");
    expect(response.status).toBe(200);
    expect(
      monitorWriteResponseSchema.parse(response.json).monitor,
    ).toMatchObject({
      status: "paused",
      version: 2,
    });
    expect(await scheduleRow(monitor.id)).toMatchObject({
      next_check_at: null,
      claim_token: null,
      claimed_until: null,
      due: false,
    });
    const incidents = await ctx.owner.sql.query<{
      ended_at: Date | null;
      end_reason: string | null;
    }>(
      "select ended_at, end_reason from monitor_incidents where monitor_id = $1",
      [monitor.id],
    );
    expect(incidents.rows).toHaveLength(1);
    expect(incidents.rows[0]?.end_reason).toBe("paused_by_user");
    expect(incidents.rows[0]?.ended_at).not.toBeNull();
    expect((await events(monitor.id)).map((event) => event.kind)).toEqual([
      "paused",
    ]);
  });

  it("answers a repeated pause with the current state and no second audit, event or version", async () => {
    const monitor = await created();
    await action(monitor, "pause");
    const again = await action(monitor, "pause");
    expect(again.status).toBe(200);
    expect(monitorWriteResponseSchema.parse(again.json).monitor).toMatchObject({
      status: "paused",
      version: 2,
    });
    expect((await events(monitor.id)).map((event) => event.kind)).toEqual([
      "paused",
    ]);
    expect(
      mutationLines(monitor.id).filter(
        (l) => l.action === "organization.monitor.pause",
      ),
    ).toHaveLength(1);
  });

  it("resumes: due now, streak reset, event recorded, repeat is a no-op", async () => {
    const monitor = await created();
    await ctx.owner.sql.query(
      "update monitors set consecutive_failures = 5 where id = $1",
      [monitor.id],
    );
    await action(monitor, "pause");
    const resumed = await action(monitor, "resume");
    expect(resumed.status).toBe(200);
    expect(
      monitorWriteResponseSchema.parse(resumed.json).monitor,
    ).toMatchObject({
      status: "active",
      version: 3,
    });
    expect(await monitorRow(monitor.id)).toMatchObject({
      status: "active",
      consecutive_failures: 0,
      check_config_version: 1,
    });
    const schedule = await scheduleRow(monitor.id);
    expect(schedule.due).toBe(true);
    expect(Math.abs(schedule.next_in_seconds ?? 99)).toBeLessThan(5);

    const again = await action(monitor, "resume");
    expect(monitorWriteResponseSchema.parse(again.json).monitor.version).toBe(
      3,
    );
    expect((await events(monitor.id)).map((event) => event.kind)).toEqual([
      "paused",
      "resumed",
    ]);
    expect(
      mutationLines(monitor.id).filter(
        (l) => l.action === "organization.monitor.resume",
      ),
    ).toHaveLength(1);
  });
});

describe("Delete", () => {
  it("removes the monitor and its history, then answers 404 for a repeat", async () => {
    const monitor = await created();
    await ctx.owner.sql.query(
      `insert into monitor_check_results
         (monitor_id, tenant_id, scheduled_for, checked_at, outcome, url_masked,
          check_config_version, interval_seconds)
       values ($1, $2, now(), now(), 'pass', 'https://x.example/', 1, 300)`,
      [monitor.id, org.id],
    );
    await ctx.owner.sql.query(
      `insert into monitor_check_hourly (monitor_id, tenant_id, hour_start, checks, passed)
       values ($1, $2, date_trunc('hour', now()), 1, 1)`,
      [monitor.id, org.id],
    );
    await edit(monitor, configOf({ ...monitor, name: "to delete" }));

    const response = await ctx.call(
      owner(),
      "DELETE",
      monitorsPath(org.id, `/${monitor.id}`),
    );
    expect(response.status).toBe(204);
    expect(response.json).toBeNull();

    const remaining = await ctx.owner.sql.query<{ total: string }>(
      `select (select count(*) from monitors where id = $1)
            + (select count(*) from monitor_schedule where monitor_id = $1)
            + (select count(*) from monitor_events where monitor_id = $1)
            + (select count(*) from monitor_check_results where monitor_id = $1)
            + (select count(*) from monitor_check_hourly where monitor_id = $1) as total`,
      [monitor.id],
    );
    expect(Number(remaining.rows[0]?.total)).toBe(0);

    const repeat = await ctx.call(
      owner(),
      "DELETE",
      monitorsPath(org.id, `/${monitor.id}`),
    );
    expect(repeat.status).toBe(404);
    expect(
      mutationLines(monitor.id).filter(
        (l) => l.action === "organization.monitor.delete",
      ),
    ).toHaveLength(1);
  });
});

describe("audit and logs", () => {
  it("writes one audit line per successful mutation and none for denials", async () => {
    const monitor = await created();
    await edit(monitor, configOf({ ...monitor, name: "audited" }));
    await action(monitor, "pause");
    await action(monitor, "resume");
    const viewerAttempt = await ctx.call(
      org.users.viewer,
      "POST",
      monitorsPath(org.id, `/${monitor.id}/pause`),
    );
    expect(viewerAttempt.status).toBe(403);
    await ctx.call(owner(), "DELETE", monitorsPath(org.id, `/${monitor.id}`));

    expect(mutationLines(monitor.id).map((line) => line.action)).toEqual([
      "organization.monitor.create",
      "organization.monitor.update",
      "organization.monitor.pause",
      "organization.monitor.resume",
      "organization.monitor.delete",
    ]);
    for (const line of mutationLines(monitor.id)) {
      expect(Object.keys(line).sort()).toEqual(
        [
          "action",
          "actorUserId",
          "hostname",
          "level",
          "monitorId",
          "msg",
          "name",
          "organizationId",
          "pid",
          "time",
        ].sort(),
      );
    }
    const denial = ctx
      .logRecords()
      .find(
        (line) =>
          line.msg === "organization access denied" &&
          line.actorUserId === org.users.viewer,
      );
    expect(denial).toMatchObject({
      action: "organization.monitor.pause",
      code: "PERMISSION_DENIED",
    });
    expect(JSON.stringify(denial)).not.toContain(monitor.id);
  });

  it("logs request paths as templates without organization or monitor ids", async () => {
    const monitor = await created();
    await action(monitor, "pause");
    const paths = ctx
      .logRecords()
      .filter((line) => line.msg === "request completed")
      .map((line) => String(line.path));
    expect(paths).toContain(
      "/api/organizations/:organizationId/monitors/:monitorId/pause",
    );
    expect(paths).toContain("/api/organizations/:organizationId/monitors");
    for (const path of paths) {
      expect(path).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
    }
  });
});

describe("audit failure", () => {
  it("does not fail a committed mutation when the audit logger throws", async () => {
    const failing = await openMonitorTestContext({ auditFailure: true });
    try {
      const failingOrg = await failing.createOrganization("audit-failure");
      const response = await failing.call(
        failingOrg.users.owner,
        "POST",
        monitorsPath(failingOrg.id),
        { ...validConfig(), clientRequestId: crypto.randomUUID() },
      );
      expect(response.status).toBe(201);
      const stored = await failing.owner.sql.query(
        "select 1 from monitors where tenant_id = $1",
        [failingOrg.id],
      );
      expect(stored.rows).toHaveLength(1);
      expect(
        failing.logRecords().some((line) => line.msg === "monitor mutation"),
      ).toBe(false);
    } finally {
      await failing.close();
    }
  });
});
