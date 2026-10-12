import {
  monitorListResponseSchema,
  monitorResponseTimesResponseSchema,
  monitorWriteResponseSchema,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  seedEvent,
  seedIncident,
  seedMonitor,
  seedResponseSamples,
  seedResults,
} from "./read-test-support";
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
/** Organization viewer, member of the default Project only. */
let member: string;
/** Organization viewer who administers `adminProject` and is in no other Project. */
let projectAdmin: string;
/** Organization member who is in no Project. */
let nobody: string;
let outsider: string;
/** Holds the monitor under test; `member` and `nobody` cannot see `hidden`. */
let hidden: string;
let adminProject: string;
let monitorInHidden: string;
let monitorInDefault: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext({ defaultProject: true });
  org = await ctx.createOrganization("project-scope");
  member = org.users.viewer;
  projectAdmin = await ctx.createUser("project-scope-admin");
  nobody = await ctx.createUser("project-scope-nobody");
  outsider = await ctx.createUser("project-scope-outsider");
  for (const userId of [projectAdmin, nobody]) {
    await ctx.owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'viewer', now(), now())`,
      [crypto.randomUUID(), org.id, userId],
    );
  }
  hidden = await ctx.createProject(org.id, "hidden");
  adminProject = await ctx.createProject(org.id, "admin-project", [
    { userId: projectAdmin, role: "admin" },
  ]);
  monitorInHidden = await seedMonitor(ctx, org.id, {
    projectId: hidden,
    name: "Hidden monitor",
  });
  monitorInDefault = await seedMonitor(ctx, org.id, {
    name: "Default monitor",
  });
  for (const id of [monitorInHidden, monitorInDefault]) {
    await seedResults(ctx, org.id, id, [60, 120]);
    await seedIncident(ctx, org.id, id, { startedAgoSeconds: 600 });
    await seedEvent(ctx, org.id, id, "paused", 300);
  }
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

type Route = {
  name: string;
  method: "DELETE" | "GET" | "PATCH" | "POST";
  suffix: string;
  /** Needs a monitor in the path. */
  monitor: boolean;
  body?: unknown;
};

const ROUTES: Route[] = [
  { name: "list", method: "GET", suffix: "", monitor: false },
  {
    name: "recent-events",
    method: "GET",
    suffix: "/recent-events",
    monitor: false,
  },
  {
    name: "create",
    method: "POST",
    suffix: "",
    monitor: false,
    body: {
      ...validConfig(),
      clientRequestId: "00000000-0000-4000-8000-000000000001",
    },
  },
  {
    name: "test (create form)",
    method: "POST",
    suffix: "/test",
    monitor: false,
    body: validConfig({ url: `https://${STUB_HOSTS.public}/health` }),
  },
  { name: "detail", method: "GET", suffix: "", monitor: true },
  { name: "checks", method: "GET", suffix: "/checks", monitor: true },
  {
    name: "response-times",
    method: "GET",
    suffix: "/response-times?range=24h",
    monitor: true,
  },
  { name: "incidents", method: "GET", suffix: "/incidents", monitor: true },
  { name: "events", method: "GET", suffix: "/events", monitor: true },
  {
    name: "last-response",
    method: "GET",
    suffix: "/last-response",
    monitor: true,
  },
  {
    name: "edit",
    method: "PATCH",
    suffix: "",
    monitor: true,
    body: { ...validConfig({ name: "Renamed" }), expectedVersion: 1 },
  },
  { name: "pause", method: "POST", suffix: "/pause", monitor: true },
  { name: "resume", method: "POST", suffix: "/resume", monitor: true },
  {
    name: "test (edit form)",
    method: "POST",
    suffix: "/test",
    monitor: true,
    body: validConfig({ url: `https://${STUB_HOSTS.public}/health` }),
  },
  { name: "delete", method: "DELETE", suffix: "", monitor: true },
];

function pathOf(route: Route, projectId: string, monitorId: string): string {
  return monitorsPath(
    org.id,
    route.monitor ? `/${monitorId}${route.suffix}` : route.suffix,
    projectId,
  );
}

async function send(
  userId: string | null,
  route: Route,
  projectId: string,
  monitorId: string,
) {
  return ctx.call(
    userId,
    route.method,
    pathOf(route, projectId, monitorId),
    route.body,
  );
}

const errorCode = (json: unknown) =>
  (json as { error?: { code?: string } } | null)?.error?.code;

async function monitorRow(id: string) {
  const result = await ctx.owner.sql.query<{ version: number; status: string }>(
    "select version, status from monitors where id = $1",
    [id],
  );
  return result.rows[0];
}

describe("a user without access to the Project (AC-02)", () => {
  it.each(ROUTES)(
    "$name answers 404 PROJECT_NOT_FOUND, the same body as a Project that does not exist",
    async (route) => {
      const missing = crypto.randomUUID();
      const denied = await send(member, route, hidden, monitorInHidden);
      const absent = await send(member, route, missing, monitorInHidden);
      expect(denied.status).toBe(404);
      expect(errorCode(denied.json)).toBe("PROJECT_NOT_FOUND");
      expect(absent.status).toBe(404);
      expect(denied.json).toEqual(absent.json);
    },
  );

  it.each(ROUTES)(
    "$name answers 404 to an Organization member who is in no Project at all",
    async (route) => {
      const response = await send(nobody, route, hidden, monitorInHidden);
      expect(response.status).toBe(404);
      expect(errorCode(response.json)).toBe("PROJECT_NOT_FOUND");
    },
  );

  it("changed nothing in the hidden Project", async () => {
    expect(await monitorRow(monitorInHidden)).toEqual({
      version: 1,
      status: "active",
    });
  });

  it("an Organization nonmember is denied like the Project routes: 403 MEMBERSHIP_DENIED", async () => {
    for (const route of ROUTES) {
      const response = await send(outsider, route, hidden, monitorInHidden);
      expect(response.status, route.name).toBe(403);
      expect(errorCode(response.json), route.name).toBe("MEMBERSHIP_DENIED");
    }
  });

  it("the Test routes do no DNS lookup and send nothing for a hidden Project (no SSRF or timing oracle)", async () => {
    const before = ctx.resolverCalls.length;
    for (const route of ROUTES.filter((r) => r.name.startsWith("test"))) {
      const response = await send(member, route, hidden, monitorInHidden);
      expect(response.status).toBe(404);
    }
    expect(ctx.resolverCalls.length).toBe(before);
  });
});

describe("a monitor of another Project (cross-Project IDOR)", () => {
  // Project admin of `adminProject` can use it freely; the monitor lives in the
  // default Project, which they cannot see, and in `hidden`, which they cannot either.
  it.each(ROUTES.filter((route) => route.monitor))(
    "$name through another Project's URL answers 404 MONITOR_NOT_FOUND",
    async (route) => {
      const response = await send(
        projectAdmin,
        route,
        adminProject,
        monitorInDefault,
      );
      expect(response.status).toBe(404);
      expect(errorCode(response.json)).toBe("MONITOR_NOT_FOUND");
    },
  );

  it("an Organization admin who can use both Projects still gets 404 through the wrong one", async () => {
    for (const route of ROUTES.filter((r) => r.monitor)) {
      const response = await send(
        org.users.owner,
        route,
        adminProject,
        monitorInDefault,
      );
      expect(response.status, route.name).toBe(404);
      expect(errorCode(response.json), route.name).toBe("MONITOR_NOT_FOUND");
    }
    expect(await monitorRow(monitorInDefault)).toEqual({
      version: 1,
      status: "active",
    });
    const stillThere = await ctx.owner.sql.query(
      "select 1 from monitors where id = $1",
      [monitorInDefault],
    );
    expect(stillThere.rowCount).toBe(1);
  });

  it("a list shows only the monitors of the Project in the URL", async () => {
    const list = monitorListResponseSchema.parse(
      (await ctx.call(org.users.owner, "GET", monitorsPath(org.id, "", hidden)))
        .json,
    );
    expect(list.monitors.map((monitor) => monitor.id)).toEqual([
      monitorInHidden,
    ]);
    expect(list.summary.total).toBe(1);
    expect(list.summary.limit).toBe(20);
  });

  it("recent events of one Project name no monitor of another", async () => {
    const response = await ctx.call(
      org.users.owner,
      "GET",
      monitorsPath(org.id, "/recent-events", hidden),
    );
    const ids = (
      response.json as { events: { monitorId: string }[] }
    ).events.map((event) => event.monitorId);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set([monitorInHidden]));
  });
});

describe("the Organization-level monitor routes are gone (AC-01)", () => {
  it.each([
    ["GET", ""],
    ["POST", ""],
    ["GET", "/recent-events"],
    ["POST", "/test"],
    ["GET", `/${crypto.randomUUID()}`],
    ["PATCH", `/${crypto.randomUUID()}`],
    ["DELETE", `/${crypto.randomUUID()}`],
    ["POST", `/${crypto.randomUUID()}/pause`],
  ] as const)(
    "%s /api/organizations/:id/monitors%s answers 404",
    async (method, suffix) => {
      const response = await ctx.call(
        org.users.owner,
        method,
        `/api/organizations/${org.id}/monitors${suffix}`,
        method === "GET" || method === "DELETE" ? undefined : {},
      );
      expect(response.status).toBe(404);
    },
  );
});

describe("permissions follow the Project role (AC-03)", () => {
  const write = (userId: string, projectId: string) =>
    ctx.call(userId, "POST", monitorsPath(org.id, "", projectId), {
      ...validConfig(),
      clientRequestId: crypto.randomUUID(),
    });

  it("Project members read but cannot create, change or read the last response", async () => {
    for (const userId of [org.users.viewer, org.users.auditor]) {
      const list = await ctx.call(userId, "GET", monitorsPath(org.id));
      expect(list.status).toBe(200);
      const detail = await ctx.call(
        userId,
        "GET",
        monitorsPath(org.id, `/${monitorInDefault}`),
      );
      expect(detail.status).toBe(200);
      const denied = [
        await write(userId, org.projectId),
        await ctx.call(
          userId,
          "POST",
          monitorsPath(org.id, `/${monitorInDefault}/pause`),
        ),
        await ctx.call(
          userId,
          "GET",
          monitorsPath(org.id, `/${monitorInDefault}/last-response`),
        ),
        await ctx.call(
          userId,
          "POST",
          monitorsPath(org.id, "/test"),
          validConfig({ url: `https://${STUB_HOSTS.public}/health` }),
        ),
      ];
      for (const response of denied) {
        expect(response.status).toBe(403);
        expect(errorCode(response.json)).toBe("PERMISSION_DENIED");
      }
    }
    expect((await monitorRow(monitorInDefault))?.status).toBe("active");
  });

  it("a Project admin with an Organization viewer role creates, pauses, resumes, deletes and reads the last response", async () => {
    const created = await write(projectAdmin, adminProject);
    expect(created.status).toBe(201);
    const { monitor } = monitorWriteResponseSchema.parse(created.json);
    const at = (suffix: string) =>
      monitorsPath(org.id, `/${monitor.id}${suffix}`, adminProject);
    expect((await ctx.call(projectAdmin, "POST", at("/pause"))).status).toBe(
      200,
    );
    expect((await ctx.call(projectAdmin, "POST", at("/resume"))).status).toBe(
      200,
    );
    expect(
      (await ctx.call(projectAdmin, "GET", at("/last-response"))).status,
    ).toBe(200);
    expect((await ctx.call(projectAdmin, "DELETE", at(""))).status).toBe(204);
  });

  it("Organization Owner and Admin write and read the last response in a Project they are not in", async () => {
    for (const userId of [org.users.owner, org.users.admin]) {
      const created = await write(userId, hidden);
      expect(created.status).toBe(201);
      const { monitor } = monitorWriteResponseSchema.parse(created.json);
      expect(
        (
          await ctx.call(
            userId,
            "GET",
            monitorsPath(org.id, `/${monitor.id}/last-response`, hidden),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await ctx.call(
            userId,
            "DELETE",
            monitorsPath(org.id, `/${monitor.id}`, hidden),
          )
        ).status,
      ).toBe(204);
    }
  });
});

describe("audit events record the Project (AC-09)", () => {
  it("create, update, pause, resume and delete carry target.attributes.projectId", async () => {
    const project = await ctx.createProject(org.id, "audited");
    const created = await ctx.call(
      org.users.owner,
      "POST",
      monitorsPath(org.id, "", project),
      { ...validConfig(), clientRequestId: crypto.randomUUID() },
    );
    expect(created.status).toBe(201);
    const { monitor } = monitorWriteResponseSchema.parse(created.json);
    const at = (suffix = "") =>
      monitorsPath(org.id, `/${monitor.id}${suffix}`, project);
    expect(
      (
        await ctx.call(org.users.owner, "PATCH", at(), {
          ...validConfig({ name: "Audited rename" }),
          expectedVersion: monitor.version,
        })
      ).status,
    ).toBe(200);
    expect((await ctx.call(org.users.owner, "POST", at("/pause"))).status).toBe(
      200,
    );
    expect(
      (await ctx.call(org.users.owner, "POST", at("/resume"))).status,
    ).toBe(200);
    expect((await ctx.call(org.users.owner, "DELETE", at())).status).toBe(204);

    const events = await ctx.owner.sql.query<{
      action: string;
      projectId: string | null;
    }>(
      `select action, target_attributes->>'projectId' as "projectId"
       from audit_events where tenant_id = $1 and target_id = $2
       order by occurred_at, id`,
      [org.id, monitor.id],
    );
    expect(events.rows).toEqual([
      { action: "organization.monitor.create", projectId: project },
      { action: "organization.monitor.update", projectId: project },
      { action: "organization.monitor.pause", projectId: project },
      { action: "organization.monitor.resume", projectId: project },
      { action: "organization.monitor.delete", projectId: project },
    ]);
  });
});

describe("deleting a Project removes its monitors and their data (AC-07)", () => {
  it("removes monitors, results, events, incidents and schedule rows, and leaves other Projects alone", async () => {
    const doomed = await ctx.createProject(org.id, "doomed");
    const survivor = await ctx.createProject(org.id, "survivor");
    const seeded: string[] = [];
    for (const projectId of [doomed, survivor]) {
      const id = await seedMonitor(ctx, org.id, { projectId });
      await seedResults(ctx, org.id, id, [30, 90]);
      await seedIncident(ctx, org.id, id, { startedAgoSeconds: 400 });
      await seedEvent(ctx, org.id, id, "paused", 200);
      await ctx.owner.sql.query(
        `insert into monitor_schedule
           (monitor_id, tenant_id, next_check_at, check_config_version,
            interval_seconds, timeout_seconds)
         values ($1, $2, now(), 1, 300, 10)`,
        [id, org.id],
      );
      seeded.push(id);
    }
    const [doomedId, survivorId] = seeded;

    const response = await ctx.call(
      org.users.owner,
      "DELETE",
      `/api/organizations/${org.id}/projects/${doomed}`,
    );
    expect(response.status).toBe(204);

    const counts = async (id: string | undefined) => {
      const result = await ctx.owner.sql.query<{ table: string; n: number }>(
        `select 'monitors' as "table", count(*)::int as n from monitors where id = $1
         union all select 'results', count(*)::int from monitor_check_results where monitor_id = $1
         union all select 'events', count(*)::int from monitor_events where monitor_id = $1
         union all select 'incidents', count(*)::int from monitor_incidents where monitor_id = $1
         union all select 'schedule', count(*)::int from monitor_schedule where monitor_id = $1`,
        [id],
      );
      return Object.fromEntries(result.rows.map((row) => [row.table, row.n]));
    };
    expect(await counts(doomedId)).toEqual({
      monitors: 0,
      results: 0,
      events: 0,
      incidents: 0,
      schedule: 0,
    });
    expect(await counts(survivorId)).toEqual({
      monitors: 1,
      results: 2,
      events: 1,
      incidents: 1,
      schedule: 1,
    });
  });
});

describe("list p95 over 24 h (AC-04)", () => {
  it("is the nearest-rank p95 of the 24h response-times points of the same monitor", async () => {
    const project = await ctx.createProject(org.id, "p95");
    const id = await seedMonitor(ctx, org.id, { projectId: project });
    const now = Date.now();
    await seedResponseSamples(
      ctx,
      org.id,
      id,
      Array.from({ length: 40 }, (_, index) => ({
        scheduledFor: new Date(now - (index + 1) * 60_000).toISOString(),
        outcome: "pass" as const,
        responseTimeMs: 100 + index * 10,
      })),
    );
    // A check without a response time and one older than 24 h change nothing.
    await seedResponseSamples(ctx, org.id, id, [
      {
        scheduledFor: new Date(now - 90_000).toISOString(),
        outcome: "check_error",
        responseTimeMs: null,
      },
      {
        scheduledFor: new Date(now - 25 * 3_600_000).toISOString(),
        outcome: "pass",
        responseTimeMs: 99_999,
      },
    ]);

    const list = monitorListResponseSchema.parse(
      (
        await ctx.call(
          org.users.owner,
          "GET",
          monitorsPath(org.id, "", project),
        )
      ).json,
    );
    const times = monitorResponseTimesResponseSchema.parse(
      (
        await ctx.call(
          org.users.owner,
          "GET",
          monitorsPath(org.id, `/${id}/response-times?range=24h`, project),
        )
      ).json,
    );
    if (times.range !== "24h") throw new Error("24h shape expected");
    // The 24h route lists the points of the window; nearest-rank p95 over them
    // is the value the list carries.
    const measured = times.points
      .flatMap((point) =>
        point.responseTimeMs === null ? [] : [point.responseTimeMs],
      )
      .sort((left, right) => left - right);
    const expected = measured[Math.ceil(0.95 * measured.length) - 1];
    expect(measured).toHaveLength(40);
    expect(expected).toBe(470);
    expect(list.monitors[0]?.responseP95Ms24h).toBe(expected);
  });

  it("is null for a monitor without response times", async () => {
    const project = await ctx.createProject(org.id, "p95-empty");
    await seedMonitor(ctx, org.id, { projectId: project });
    const list = monitorListResponseSchema.parse(
      (
        await ctx.call(
          org.users.owner,
          "GET",
          monitorsPath(org.id, "", project),
        )
      ).json,
    );
    expect(list.monitors[0]?.responseP95Ms24h).toBeNull();
  });
});
