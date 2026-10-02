import type {
  AuditLogActorsResponse,
  AuditLogEventResponse,
  AuditLogListResponse,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";
import { AUDIT_ACTION_CATEGORIES, type AuditAction } from "./record";

let ctx: MonitorTestContext;
let orgA: TestOrganization;
let orgB: TestOrganization;
const OLD_START = "now() - interval '400 days'";

const base = (organizationId: string) =>
  `/api/organizations/${organizationId}/audit-log`;
const list = (userId: string | null, organizationId: string, query = "") =>
  ctx.call(userId, "GET", `${base(organizationId)}/events${query}`);
const detail = (userId: string | null, organizationId: string, id: string) =>
  ctx.call(userId, "GET", `${base(organizationId)}/events/${id}`);
const actors = (userId: string | null, organizationId: string) =>
  ctx.call(userId, "GET", `${base(organizationId)}/actors`);

type Seed = {
  actorUserId: string;
  actorRole?: "owner" | "admin" | "viewer" | "auditor";
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  attributes?: Record<string, unknown>;
  changes?: unknown[];
  /** SQL expression for occurred_at, default now(). */
  at?: string;
};

async function seed(organizationId: string, event: Seed): Promise<string> {
  const result = await ctx.owner.sql.query<{ id: string }>(
    `insert into audit_events
       (tenant_id, occurred_at, actor_user_id, actor_role, category, action,
        target_type, target_id, target_attributes, changes)
     values ($1, ${event.at ?? "clock_timestamp()"}, $2, $3, $4, $5, $6, $7,
             $8::jsonb, $9::jsonb)
     returning id`,
    [
      organizationId,
      event.actorUserId,
      event.actorRole ?? "owner",
      AUDIT_ACTION_CATEGORIES[event.action],
      event.action,
      event.targetType,
      event.targetId ?? null,
      JSON.stringify(event.attributes ?? {}),
      JSON.stringify(event.changes ?? []),
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("seed returned no id");
  return id;
}

async function organization(label: string): Promise<TestOrganization> {
  const created = await ctx.createOrganization(label);
  await ctx.owner.sql.query(
    `update organization set audit_recording_started_at = ${OLD_START} where id = $1`,
    [created.id],
  );
  return created;
}

const asList = (response: { json: unknown }) =>
  response.json as AuditLogListResponse;
const asEvent = (response: { json: unknown }) =>
  response.json as AuditLogEventResponse;
const asActors = (response: { json: unknown }) =>
  response.json as AuditLogActorsResponse;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  orgA = await organization("auditread-a");
  orgB = await organization("auditread-b");
  await seed(orgA.id, {
    actorUserId: orgA.users.owner,
    action: "organization.notification-settings.update",
    targetType: "notification_settings",
  });
  await seed(orgB.id, {
    actorUserId: orgB.users.owner,
    action: "organization.notification-settings.update",
    targetType: "notification_settings",
  });
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

describe("authorization (AC-04, AC-05)", () => {
  it("answers every role the same on list, detail and actors, and non-members and absent organizations identically", async () => {
    const eventId = await seed(orgA.id, {
      actorUserId: orgA.users.owner,
      action: "organization.member.revoke",
      targetType: "member",
      targetId: orgA.users.viewer,
    });
    const stranger = await ctx.createUser("auditread-stranger");
    const absent = crypto.randomUUID();
    const calls = {
      list: (user: string, org: string) => list(user, org),
      detail: (user: string, org: string) => detail(user, org, eventId),
      actors: (user: string, org: string) => actors(user, org),
    };
    for (const [name, call] of Object.entries(calls)) {
      for (const role of ["owner", "admin", "auditor"] as const) {
        expect(
          (await call(orgA.users[role], orgA.id)).status,
          `${name} ${role}`,
        ).toBe(200);
      }
      const viewer = await call(orgA.users.viewer, orgA.id);
      expect(viewer.status, name).toBe(403);
      expect(viewer.json).toEqual({
        error: {
          code: "PERMISSION_DENIED",
          message: "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม",
        },
      });
      const nonMember = await call(stranger, orgA.id);
      const absentOrg = await call(stranger, absent);
      const ownerOfOther = await call(orgB.users.owner, orgA.id);
      expect(nonMember.status).toBe(403);
      expect(nonMember.json).toEqual({
        error: {
          code: "MEMBERSHIP_DENIED",
          message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
        },
      });
      expect(absentOrg.json).toEqual(nonMember.json);
      expect(ownerOfOther.json).toEqual(nonMember.json);
    }
    expect((await list(null, orgA.id)).status).toBe(401);
  });

  it("shows A-only, B-only and A+B events to a user that owns A and only views B", async () => {
    const both = await ctx.createUser("auditread-both");
    await ctx.owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now()), ($4, $5, $3, 'viewer', now(), now())`,
      [crypto.randomUUID(), orgA.id, both, crypto.randomUUID(), orgB.id],
    );
    const a = asList(await list(both, orgA.id));
    expect(a.events.length).toBeGreaterThan(0);
    expect((await list(both, orgB.id)).status).toBe(403);
    const asB = asList(await list(orgB.users.owner, orgB.id));
    const ids = (page: AuditLogListResponse) => page.events.map((e) => e.id);
    expect(ids(a).filter((id) => ids(asB).includes(id))).toEqual([]);
    expect(a.organizationId).toBe(orgA.id);
    expect(asB.organizationId).toBe(orgB.id);
  });

  it("treats a stored composite role by its normalized value, not by any token", async () => {
    const mixed = await ctx.createUser("auditread-mixed");
    for (const [role, expected] of [
      ["viewer,auditor", 403],
      ["auditor, viewer", 403],
      ["auditor,owner", 200],
      ["auditor,admin", 200],
    ] as const) {
      await ctx.owner.sql.query(
        "delete from member where organization_id = $1 and user_id = $2",
        [orgA.id, mixed],
      );
      await ctx.owner.sql.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [crypto.randomUUID(), orgA.id, mixed, role],
      );
      const any = await seed(orgA.id, {
        actorUserId: orgA.users.owner,
        action: "organization.member.leave",
        targetType: "member",
        targetId: orgA.users.owner,
      });
      expect((await list(mixed, orgA.id)).status, `list ${role}`).toBe(
        expected,
      );
      expect((await detail(mixed, orgA.id, any)).status, `detail ${role}`).toBe(
        expected,
      );
      expect((await actors(mixed, orgA.id)).status, `actors ${role}`).toBe(
        expected,
      );
    }
  });
});

describe("list (AC-02)", () => {
  let paged: TestOrganization;
  beforeAll(async () => {
    paged = await organization("auditread-page");
    for (let i = 0; i < 51; i += 1) {
      await seed(paged.id, {
        actorUserId: paged.users.owner,
        action: "organization.member.leave",
        targetType: "member",
        targetId: paged.users.viewer,
        at: `now() - interval '${String(i + 1)} seconds'`,
      });
    }
  });

  it("orders newest first, counts all rows and gives the second page one row", async () => {
    const first = asList(await list(paged.users.owner, paged.id));
    expect(first.page).toEqual({ limit: 50, offset: 0, total: 51 });
    expect(first.events).toHaveLength(50);
    const times = first.events.map((e) => Date.parse(e.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const second = asList(
      await list(paged.users.owner, paged.id, "?offset=50"),
    );
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.id).not.toBe(first.events[0]?.id);
    expect(second.page.total).toBe(51);
    const past = asList(await list(paged.users.owner, paged.id, "?offset=51"));
    expect(past.events).toEqual([]);
    expect(past.page.total).toBe(51);
    expect(first.events[0]).not.toHaveProperty("changes");
  });

  it("keeps rows from moving when asOf is passed, and shows new rows without it", async () => {
    const first = asList(await list(paged.users.owner, paged.id, "?limit=1"));
    await seed(paged.id, {
      actorUserId: paged.users.owner,
      action: "organization.member.leave",
      targetType: "member",
      targetId: paged.users.viewer,
    });
    const pinned = asList(
      await list(
        paged.users.owner,
        paged.id,
        `?limit=1&asOf=${encodeURIComponent(first.asOf)}`,
      ),
    );
    expect(pinned.page.total).toBe(first.page.total);
    expect(pinned.events[0]?.id).toBe(first.events[0]?.id);
    expect(pinned.asOf).toBe(first.asOf);
    const fresh = asList(await list(paged.users.owner, paged.id, "?limit=1"));
    expect(fresh.page.total).toBe(first.page.total + 1);
    const future = asList(
      await list(
        paged.users.owner,
        paged.id,
        `?asOf=${encodeURIComponent("2999-01-01T00:00:00Z")}`,
      ),
    );
    expect(Date.parse(future.asOf)).toBeLessThan(Date.now() + 60_000);
  });

  it("rejects malformed queries with 400 VALIDATION_ERROR", async () => {
    for (const query of [
      "?from=2026-10-03T10:00:00Z&to=2026-10-03T09:00:00Z",
      "?from=yesterday",
      "?categories=monitor,monitor",
      "?categories=unknown",
      "?q=%20",
      `?q=${"x".repeat(101)}`,
      "?q=a%00b",
      "?limit=51",
      "?limit=0",
      "?offset=-1",
    ]) {
      const response = await list(orgA.users.owner, orgA.id, query);
      expect(response.status, query).toBe(400);
      expect(response.json).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });
});

describe("filters and search (AC-10)", () => {
  let org: TestOrganization;
  let monitorId: string;
  const monitorName = "Checkout-API-Primary";
  const events = { monitor: "", member: "", invitation: "" };

  beforeAll(async () => {
    org = await organization("auditread-search");
    monitorId = crypto.randomUUID();
    await ctx.owner.sql.query(
      `insert into monitors (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
       values ($1, $2, $3, 'https://x.example.test/', 60, 10, $4)`,
      [monitorId, org.id, monitorName, crypto.randomUUID()],
    );
    events.monitor = await seed(org.id, {
      actorUserId: org.users.admin,
      actorRole: "admin",
      action: "organization.monitor.pause",
      targetType: "monitor",
      targetId: monitorId,
      at: "now() - interval '2 hours'",
    });
    events.member = await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.member.role.update",
      targetType: "member",
      targetId: org.users.viewer,
      at: "now() - interval '1 hour'",
    });
    events.invitation = await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.invitation.create",
      targetType: "invitation",
      targetId: "0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a11",
      attributes: { role: "viewer" },
      at: "now() - interval '30 minutes'",
    });
  });

  const ids = async (query: string) =>
    asList(await list(org.users.owner, org.id, query))
      .events.map((e) => e.id)
      .sort();

  it("ANDs time range, category and actor", async () => {
    const all = [events.monitor, events.member, events.invitation].sort();
    expect(await ids("")).toEqual(all);
    expect(await ids("?categories=member,invitation")).toEqual(
      [events.member, events.invitation].sort(),
    );
    expect(await ids(`?actorUserId=${org.users.admin}`)).toEqual([
      events.monitor,
    ]);
    const from = encodeURIComponent(
      new Date(Date.now() - 90 * 60_000).toISOString(),
    );
    expect(await ids(`?from=${from}`)).toEqual(
      [events.member, events.invitation].sort(),
    );
    expect(
      await ids(
        `?from=${from}&categories=member&actorUserId=${org.users.owner}`,
      ),
    ).toEqual([events.member]);
    expect(await ids(`?from=${from}&actorUserId=${org.users.admin}`)).toEqual(
      [],
    );
    const to = encodeURIComponent(
      new Date(Date.now() - 45 * 60_000).toISOString(),
    );
    expect(await ids(`?to=${to}`)).toEqual(
      [events.monitor, events.member].sort(),
    );
  });

  it("searches label, action code, actor name, monitor name, member name and ids; not email", async () => {
    expect(await ids("?q=หยุดมอนิเตอร์")).toEqual([events.monitor]);
    expect(await ids("?q=MEMBER.ROLE.UPDATE")).toEqual([events.member]);
    expect(await ids("?q=auditread-search-admin")).toEqual([events.monitor]);
    expect(await ids("?q=checkout-api")).toEqual([events.monitor]);
    expect(await ids(`?q=auditread-search-viewer`)).toEqual([events.member]);
    expect(await ids(`?q=${events.invitation}`)).toEqual([events.invitation]);
    expect(await ids(`?q=${events.member}`)).toEqual([events.member]);
    expect(await ids("?q=0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a11")).toEqual([
      events.invitation,
    ]);
    // Email is not searchable, even for a full address or a fragment.
    const email = (
      await ctx.owner.sql.query<{ email: string }>(
        'select email from "user" where id = $1',
        [org.users.admin],
      )
    ).rows[0]?.email;
    expect(email).toBeTruthy();
    expect(await ids(`?q=${encodeURIComponent(email ?? "")}`)).toEqual([]);
    expect(await ids("?q=%40example.test")).toEqual([]);
  });

  it("treats % and _ in q as literal characters", async () => {
    expect(await ids("?q=%25")).toEqual([]);
    expect(await ids("?q=_")).toEqual([]);
    expect(await ids("?q=auditread_search")).toEqual([]);
    await ctx.owner.sql.query(
      "update monitors set name = 'cpu_100%_ok' where id = $1",
      [monitorId],
    );
    expect(await ids("?q=100%25_ok")).toEqual([events.monitor]);
    expect(await ids("?q=100_%25ok")).toEqual([]);
    await ctx.owner.sql.query("update monitors set name = $2 where id = $1", [
      monitorId,
      monitorName,
    ]);
  });

  it("does not search the changes of an event", async () => {
    await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.monitor.update",
      targetType: "monitor",
      targetId: monitorId,
      changes: [
        {
          field: "name",
          before: { kind: "value", value: "needle-in-changes" },
          after: null,
        },
      ],
    });
    expect(await ids("?q=needle-in-changes")).toEqual([]);
  });
});

describe("detail (AC-12, AC-13)", () => {
  it("returns every category with display names, deleted targets, former members and export scope", async () => {
    const org = await organization("auditread-detail");
    const monitorId = crypto.randomUUID();
    await ctx.owner.sql.query(
      `insert into monitors (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
       values ($1, $2, 'Live monitor', 'https://x.example.test/', 60, 10, $3)`,
      [monitorId, org.id, crypto.randomUUID()],
    );
    const former = await ctx.createUser("auditread-former");
    const changes = [
      {
        field: "role",
        before: { kind: "value", value: "viewer" },
        after: { kind: "value", value: "admin" },
      },
    ];
    const live = await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.monitor.update",
      targetType: "monitor",
      targetId: monitorId,
      changes,
    });
    const removed = await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.monitor.delete",
      targetType: "monitor",
      targetId: crypto.randomUUID(),
    });
    const byFormer = await seed(org.id, {
      actorUserId: former,
      actorRole: "admin",
      action: "organization.member.revoke",
      targetType: "member",
      targetId: former,
      changes,
    });
    const settings = await seed(org.id, {
      actorUserId: org.users.admin,
      actorRole: "admin",
      action: "organization.notification-settings.update",
      targetType: "notification_settings",
    });
    const invite = await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.invitation.cancel",
      targetType: "invitation",
      targetId: "0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a22",
      attributes: { role: "auditor" },
    });
    const exportId = crypto.randomUUID();
    const exported = await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.audit-log.export",
      targetType: "audit_export",
      targetId: exportId,
      attributes: {
        format: "json",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-02T00:00:00.000Z",
        categories: ["member"],
        actorUserId: org.users.owner,
        searchApplied: true,
      },
    });
    const get = async (id: string) =>
      asEvent(await detail(org.users.auditor, org.id, id)).event;

    expect(await get(live)).toMatchObject({
      id: live,
      category: "monitor",
      action: "organization.monitor.update",
      actor: {
        userId: org.users.owner,
        displayName: "auditread-detail-owner",
        roleAtTime: "owner",
        membership: "current",
      },
      target: {
        type: "monitor",
        monitorId,
        displayName: "Live monitor",
        deleted: false,
      },
      changes,
    });
    expect((await get(removed)).target).toEqual({
      type: "monitor",
      monitorId: expect.any(String) as unknown,
      displayName: null,
      deleted: true,
    });
    const formerEvent = await get(byFormer);
    expect(formerEvent.actor).toEqual({
      userId: former,
      displayName: null,
      roleAtTime: "admin",
      membership: "former",
    });
    expect(formerEvent.target).toEqual({
      type: "member",
      userId: former,
      displayName: null,
      membership: "former",
    });
    expect((await get(settings)).target).toEqual({
      type: "notification_settings",
    });
    expect((await get(invite)).target).toEqual({
      type: "invitation",
      publicId: "0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a22",
      role: "auditor",
    });
    const exportEvent = await get(exported);
    expect(exportEvent.target).toEqual({
      type: "audit_export",
      exportId,
      format: "json",
    });
    expect(exportEvent.exportScope).toEqual({
      format: "json",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      categories: ["member"],
      actorUserId: org.users.owner,
      searchApplied: true,
    });
    expect((await get(live)).exportScope).toBeUndefined();

    // The list carries the same target shape for the export event.
    const page = asList(await list(org.users.owner, org.id));
    expect(page.events.find((e) => e.id === exported)?.target).toEqual(
      exportEvent.target,
    );

    // No response carries an email address.
    const responses = JSON.stringify([
      page,
      exportEvent,
      formerEvent,
      await actors(org.users.owner, org.id).then((r) => r.json),
    ]);
    expect(responses).not.toContain("@example.test");
  });

  it("answers the same 404 for a missing id, a malformed id and another Organization's event", async () => {
    const other = await seed(orgB.id, {
      actorUserId: orgB.users.owner,
      action: "organization.member.leave",
      targetType: "member",
      targetId: orgB.users.owner,
    });
    const responses = await Promise.all(
      [crypto.randomUUID(), "not-a-uuid", "1".repeat(200), other].map((id) =>
        detail(orgA.users.owner, orgA.id, id),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.json).toEqual(responses[0]?.json);
    }
    expect(responses[0]?.json).toMatchObject({
      error: { code: "AUDIT_EVENT_NOT_FOUND" },
    });
    // A viewer gets the role error before any lookup.
    expect(
      (await detail(orgA.users.viewer, orgA.id, "not-a-uuid")).status,
    ).toBe(403);
  });
});

describe("actors (AC-26)", () => {
  it("lists only users with events, by name then id, with no email", async () => {
    const org = await organization("auditread-actors");
    const former = await ctx.createUser("auditread-actors-former");
    await seed(org.id, {
      actorUserId: org.users.owner,
      action: "organization.member.leave",
      targetType: "member",
      targetId: org.users.owner,
    });
    await seed(org.id, {
      actorUserId: org.users.admin,
      actorRole: "admin",
      action: "organization.member.leave",
      targetType: "member",
      targetId: org.users.admin,
    });
    await seed(org.id, {
      actorUserId: org.users.admin,
      actorRole: "admin",
      action: "organization.member.leave",
      targetType: "member",
      targetId: org.users.admin,
    });
    await seed(org.id, {
      actorUserId: former,
      action: "organization.member.leave",
      targetType: "member",
      targetId: former,
    });
    const body = asActors(await actors(org.users.auditor, org.id));
    expect(body.actors).toEqual([
      {
        userId: org.users.admin,
        displayName: "auditread-actors-admin",
        membership: "current",
      },
      {
        userId: org.users.owner,
        displayName: "auditread-actors-owner",
        membership: "current",
      },
      { userId: former, displayName: null, membership: "former" },
    ]);
    // viewer and auditor members that never acted are not offered.
    expect(JSON.stringify(body)).not.toContain(org.users.viewer);
    expect(JSON.stringify(body)).not.toContain("@");
  });
});

describe("logs and writes (AC-26)", () => {
  it("logs route templates without the search text and writes no event", async () => {
    const count = async () =>
      (
        await ctx.owner.sql.query<{ n: number }>(
          "select count(*)::int as n from audit_events where tenant_id = $1",
          [orgA.id],
        )
      ).rows[0]?.n;
    const before = await count();
    const marker = `needle-${crypto.randomUUID()}`;
    const eventId = asList(await list(orgA.users.owner, orgA.id)).events[0]?.id;
    await list(orgA.users.owner, orgA.id, `?q=${marker}`);
    await detail(orgA.users.owner, orgA.id, eventId ?? "");
    await actors(orgA.users.owner, orgA.id);
    await list(orgA.users.viewer, orgA.id, `?q=${marker}`);
    expect(await count()).toBe(before);
    const lines = ctx.lines.join("\n");
    expect(lines).not.toContain(marker);
    const paths = ctx
      .logRecords()
      .filter((line) => line.msg === "request completed")
      .map((line) => String(line.path));
    expect(paths).toContain(
      "/api/organizations/:organizationId/audit-log/events",
    );
    expect(paths).toContain(
      "/api/organizations/:organizationId/audit-log/events/:eventId",
    );
    expect(paths).toContain(
      "/api/organizations/:organizationId/audit-log/actors",
    );
    expect(lines).not.toContain(orgA.id);
    const denial = ctx
      .logRecords()
      .find(
        (line) =>
          line.msg === "organization access denied" &&
          line.action === "organization.audit-log.list",
      );
    expect(denial).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(JSON.stringify(denial)).not.toContain(orgA.id);
  });
});
