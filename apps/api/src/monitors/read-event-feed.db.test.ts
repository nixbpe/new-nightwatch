import {
  monitorEventsResponseSchema,
  monitorLastResponseResponseSchema,
  monitorRecentEventsResponseSchema,
  type MonitorEvent,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedIncident, seedMonitor } from "./read-test-support";
import {
  monitorsPath,
  openMonitorTestContext,
  TEST_ROLES,
  type MonitorTestContext,
  type TestOrganization,
} from "./test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;
let other: TestOrganization;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  org = await ctx.createOrganization("feed");
  other = await ctx.createOrganization("feed-other");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

const ago = (seconds: number): string =>
  new Date(Date.now() - seconds * 1000).toISOString();

async function feed(
  userId: string | null,
  monitorId: string,
  query = "",
  organization: TestOrganization = org,
) {
  return ctx.call(
    userId,
    "GET",
    monitorsPath(organization.id, `/${monitorId}/events${query}`),
  );
}

async function events(userId: string, monitorId: string, query = "") {
  const response = await feed(userId, monitorId, query);
  expect(response.status).toBe(200);
  return monitorEventsResponseSchema.parse(response.json);
}

type EventSeed = {
  kind: "paused" | "resumed" | "config_changed" | "check_failed";
  at: string;
  actorKind?: "unrecorded" | "user";
  actorUserId?: string | null;
  changes?: unknown;
  failureReason?: string | null;
  tlsReason?: string | null;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
};

async function seedFeedEvent(monitorId: string, seed: EventSeed) {
  const result = await ctx.owner.sql.query<{ id: string }>(
    `insert into monitor_events
       (monitor_id, tenant_id, kind, occurred_at, actor_kind, actor_user_id,
        changes, failure_reason, tls_reason, http_status, response_time_ms)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
     returning id`,
    [
      monitorId,
      org.id,
      seed.kind,
      seed.at,
      seed.actorKind ?? "unrecorded",
      seed.actorUserId ?? null,
      seed.changes === undefined ? null : JSON.stringify(seed.changes),
      seed.failureReason ?? null,
      seed.tlsReason ?? null,
      seed.httpStatus ?? null,
      seed.responseTimeMs ?? null,
    ],
  );
  return result.rows[0]?.id ?? "";
}

async function closeIncident(
  incidentId: string,
  values: { endHttpStatus: number | null; endResponseTimeMs: number | null },
) {
  await ctx.owner.sql.query(
    `update monitor_incidents set end_http_status = $2, end_response_time_ms = $3
     where id = $1`,
    [incidentId, values.endHttpStatus, values.endResponseTimeMs],
  );
}

describe("GET /monitors/{monitorId}/events access", () => {
  it.each(TEST_ROLES)("%s reads the feed", async (role) => {
    const monitorId = await seedMonitor(ctx, org.id);
    const body = await events(org.users[role], monitorId);
    expect(body).toEqual({
      events: [],
      page: { limit: 20, offset: 0, total: 0 },
    });
  });

  it("answers a non-member 403 and a foreign or malformed id 404", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const outsider = await ctx.createUser("feed-outsider");
    const denied = await feed(outsider, monitorId);
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: { code: "MEMBERSHIP_DENIED" } });

    const foreign = await feed(other.users.owner, monitorId, "", other);
    expect(foreign.status).toBe(404);
    expect(foreign.json).toMatchObject({
      error: { code: "MONITOR_NOT_FOUND" },
    });
    const malformed = await feed(org.users.owner, "not-a-uuid");
    expect(malformed.status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    expect((await feed(null, monitorId)).status).toBe(401);
  });
});

describe("event feed contents", () => {
  it("orders by time, then closed incident, event and opened incident, and keeps the order across pages", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    // One instant for the three sources: only rank and id decide.
    const tie = ago(3600);
    const incidentId = await seedIncident(ctx, org.id, monitorId, {
      startedAgoSeconds: 3600,
      endedAgoSeconds: 3600,
    });
    await ctx.owner.sql.query(
      "update monitor_incidents set started_at = $2, ended_at = $2 where id = $1",
      [incidentId, tie],
    );
    const eventId = await seedFeedEvent(monitorId, {
      kind: "paused",
      at: tie,
      actorKind: "user",
      actorUserId: org.users.owner,
    });
    const newest = await seedFeedEvent(monitorId, {
      kind: "check_failed",
      at: ago(60),
    });

    const all = (await events(org.users.owner, monitorId)).events;
    expect(all.map((event) => event.id)).toEqual([
      `event:${newest}`,
      `incident:${incidentId}:closed`,
      `event:${eventId}`,
      `incident:${incidentId}:opened`,
    ]);

    const paged: string[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const page = await events(
        org.users.owner,
        monitorId,
        `?limit=1&offset=${String(offset)}`,
      );
      expect(page.page).toEqual({ limit: 1, offset, total: 4 });
      paged.push(...page.events.map((event) => event.id));
    }
    expect(paged).toEqual(all.map((event) => event.id));
  });

  it("lists only the last 30 days and counts only those", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    await seedFeedEvent(monitorId, { kind: "resumed", at: ago(31 * 86400) });
    await seedIncident(ctx, org.id, monitorId, {
      startedAgoSeconds: 40 * 86400,
    });
    await seedFeedEvent(monitorId, { kind: "resumed", at: ago(29 * 86400) });
    const body = await events(org.users.viewer, monitorId);
    expect(body.events.map((event) => event.kind)).toEqual(["resumed"]);
    expect(body.page.total).toBe(1);
  });

  it("rejects a limit above 50", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    expect((await feed(org.users.owner, monitorId, "?limit=51")).status).toBe(
      400,
    );
  });

  it("maps an incident's values and leaves them null for a pause close", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const recovered = await seedIncident(ctx, org.id, monitorId, {
      startedAgoSeconds: 1000,
      endedAgoSeconds: 400,
      reason: "http_status",
      httpStatus: 503,
    });
    await closeIncident(recovered, {
      endHttpStatus: 200,
      endResponseTimeMs: 182,
    });
    const paused = await seedIncident(ctx, org.id, monitorId, {
      startedAgoSeconds: 300,
      endedAgoSeconds: 100,
      endReason: "paused_by_user",
      httpStatus: null,
    });

    const byId = new Map(
      (await events(org.users.owner, monitorId)).events.map((event) => [
        event.id,
        event,
      ]),
    );
    expect(byId.get(`incident:${recovered}:opened`)).toMatchObject({
      kind: "incident_opened",
      incidentId: recovered,
      reason: "http_status",
      httpStatus: 503,
    });
    expect(byId.get(`incident:${recovered}:closed`)).toMatchObject({
      kind: "incident_closed",
      endReason: "recovered",
      durationSeconds: 600,
      httpStatus: 200,
      responseTimeMs: 182,
    });
    expect(byId.get(`incident:${paused}:closed`)).toMatchObject({
      kind: "incident_closed",
      endReason: "paused_by_user",
      httpStatus: null,
      responseTimeMs: null,
    });
    expect(byId.get(`incident:${paused}:opened`)).toMatchObject({
      httpStatus: null,
    });
  });

  it("keeps an open incident out of the closed rows and clamps a reversed duration", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const open = await seedIncident(ctx, org.id, monitorId, {
      startedAgoSeconds: 500,
    });
    const reversed = await seedIncident(ctx, org.id, monitorId, {
      startedAgoSeconds: 200,
      endedAgoSeconds: 300,
    });
    const ids = (await events(org.users.owner, monitorId)).events.map(
      (event) => event.id,
    );
    expect(ids).toContain(`incident:${open}:opened`);
    expect(ids).not.toContain(`incident:${open}:closed`);
    const closed = (await events(org.users.owner, monitorId)).events.find(
      (event) => event.id === `incident:${reversed}:closed`,
    );
    expect(closed).toMatchObject({ durationSeconds: 0 });
  });

  it("maps check_failed with and without a reason", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const full = await seedFeedEvent(monitorId, {
      kind: "check_failed",
      at: ago(120),
      failureReason: "tls_invalid",
      tlsReason: "expired",
      httpStatus: null,
      responseTimeMs: 45,
    });
    const bare = await seedFeedEvent(monitorId, {
      kind: "check_failed",
      at: ago(60),
    });
    const unknown = await seedFeedEvent(monitorId, {
      kind: "check_failed",
      at: ago(30),
      failureReason: "not_a_reason",
      httpStatus: 500,
    });
    const byId = new Map(
      (await events(org.users.owner, monitorId)).events.map((event) => [
        event.id,
        event,
      ]),
    );
    expect(byId.get(`event:${full}`)).toMatchObject({
      failureReason: "tls_invalid",
      tlsReason: "expired",
      httpStatus: null,
      responseTimeMs: 45,
    });
    expect(byId.get(`event:${bare}`)).toMatchObject({
      failureReason: null,
      tlsReason: null,
    });
    expect(byId.get(`event:${unknown}`)).toMatchObject({
      failureReason: null,
      httpStatus: 500,
    });
  });
});

describe("event actor", () => {
  async function actorFixtures() {
    const monitorId = await seedMonitor(ctx, org.id);
    const current = org.users.admin;
    const gone = await ctx.createUser("former");
    const deleted = await ctx.createUser("deleted");
    const ids = {
      unrecorded: await seedFeedEvent(monitorId, {
        kind: "paused",
        at: ago(500),
      }),
      member: await seedFeedEvent(monitorId, {
        kind: "resumed",
        at: ago(400),
        actorKind: "user",
        actorUserId: current,
      }),
      former: await seedFeedEvent(monitorId, {
        kind: "paused",
        at: ago(300),
        actorKind: "user",
        actorUserId: gone,
      }),
      deleted: await seedFeedEvent(monitorId, {
        kind: "config_changed",
        at: ago(200),
        actorKind: "user",
        actorUserId: deleted,
        changes: [],
      }),
    };
    await ctx.owner.sql.query('delete from "user" where id = $1', [deleted]);
    return { monitorId, ids, current };
  }

  function actors(
    list: MonitorEvent[],
    ids: Record<"unrecorded" | "member" | "former" | "deleted", string>,
  ) {
    const find = (key: keyof typeof ids) => {
      const event = list.find((entry) => entry.id === `event:${ids[key]}`);
      return event && "actor" in event ? event.actor : undefined;
    };
    return {
      unrecorded: find("unrecorded"),
      member: find("member"),
      former: find("former"),
      deleted: find("deleted"),
    };
  }

  it.each(["owner", "admin"] as const)(
    "%s sees the editor's name; former, deleted and unrecorded actors keep their kind",
    async (role) => {
      const { monitorId, ids, current } = await actorFixtures();
      const body = await events(org.users[role], monitorId);
      expect(actors(body.events, ids)).toEqual({
        unrecorded: { kind: "unrecorded" },
        member: {
          kind: "member",
          userId: current,
          displayName: "feed-admin",
        },
        former: { kind: "former_member" },
        deleted: { kind: "deleted" },
      });
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "%s gets member_hidden with no user id or name",
    async (role) => {
      const { monitorId, ids, current } = await actorFixtures();
      const response = await feed(org.users[role], monitorId);
      const body = monitorEventsResponseSchema.parse(response.json);
      expect(actors(body.events, ids)).toEqual({
        unrecorded: { kind: "unrecorded" },
        member: { kind: "member_hidden" },
        former: { kind: "former_member" },
        deleted: { kind: "deleted" },
      });
      const text = JSON.stringify(response.json);
      expect(text).not.toContain(current);
      expect(text).not.toContain("feed-admin");
    },
  );

  it("reads the user table for an owner but not for a viewer", async () => {
    const { monitorId } = await actorFixtures();
    const readsUsers = async (userId: string) => {
      ctx.statements.length = 0;
      await events(userId, monitorId);
      return ctx.statements.some((text) => text.includes('"user"'));
    };
    expect(await readsUsers(org.users.viewer)).toBe(false);
    expect(await readsUsers(org.users.auditor)).toBe(false);
    expect(await readsUsers(org.users.owner)).toBe(true);
  });

  it("does not read an account outside the Organization", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const stranger = await ctx.createUser("stranger-name");
    await seedFeedEvent(monitorId, {
      kind: "paused",
      at: ago(10),
      actorKind: "user",
      actorUserId: stranger,
    });
    const response = await feed(org.users.owner, monitorId);
    expect(JSON.stringify(response.json)).not.toContain("stranger-name");
    expect(JSON.stringify(response.json)).not.toContain(stranger);
  });
});

describe("recent events httpStatus", () => {
  it("adds the status without changing the two rows per closed incident", async () => {
    const organization = await ctx.createOrganization("feed-recent");
    const monitorId = await seedMonitor(ctx, organization.id, {
      name: "Recent",
    });
    const withStatus = await seedIncident(ctx, organization.id, monitorId, {
      startedAgoSeconds: 900,
      endedAgoSeconds: 600,
      httpStatus: 502,
    });
    await closeIncident(withStatus, {
      endHttpStatus: 200,
      endResponseTimeMs: 90,
    });
    await seedIncident(ctx, organization.id, monitorId, {
      startedAgoSeconds: 300,
      endedAgoSeconds: 100,
      httpStatus: null,
      endReason: "paused_by_user",
    });

    const response = await ctx.call(
      organization.users.viewer,
      "GET",
      monitorsPath(organization.id, "/recent-events"),
    );
    const { events: list } = monitorRecentEventsResponseSchema.parse(
      response.json,
    );
    expect(list).toHaveLength(4);
    const status = (kind: string, withValue: boolean) =>
      list.find(
        (event) =>
          event.kind === kind && (event.httpStatus !== undefined) === withValue,
      );
    expect(status("incident_opened", true)?.httpStatus).toBe(502);
    expect(status("incident_closed", true)?.httpStatus).toBe(200);
    const bare = list.filter((event) => event.httpStatus === undefined);
    expect(bare.map((event) => event.kind).sort()).toEqual([
      "incident_closed",
      "incident_opened",
    ]);
    expect(bare.every((event) => !("httpStatus" in event))).toBe(true);
  });
});

describe("GET /monitors/{monitorId}/last-response", () => {
  const lastResponse = (
    userId: string | null,
    monitorId: string,
    organization: TestOrganization = org,
  ) =>
    ctx.call(
      userId,
      "GET",
      monitorsPath(organization.id, `/${monitorId}/last-response`),
    );

  async function seedLast(
    monitorId: string,
    row: Record<string, unknown> = {},
  ) {
    const values = {
      scheduled_for: ago(60),
      checked_at: ago(59),
      config_version: 2,
      outcome: "pass",
      failure_reason: null,
      url_masked: "https://fixture.example/health",
      detail_omitted: null,
      http_version: "HTTP/1.1",
      http_status: 200,
      reason_phrase: "OK",
      headers: JSON.stringify([
        { name: "content-type", value: "application/json", redacted: false },
        { name: "set-cookie", value: "•••", redacted: true },
      ]),
      headers_truncated: false,
      body_kind: "text",
      body_text: '{"ok":true}',
      body_truncated: false,
      body_bytes_read: 11,
      body_omitted_reason: null,
      ...row,
    };
    const columns = Object.keys(values);
    await ctx.owner.sql.query(
      `insert into monitor_last_responses (monitor_id, tenant_id, ${columns.join(", ")})
       values ($1, $2, ${columns.map((_, index) => `$${String(index + 3)}`).join(", ")})`,
      [monitorId, org.id, ...Object.values(values)],
    );
  }

  it.each(["owner", "admin"] as const)(
    "%s reads the stored response",
    async (role) => {
      const monitorId = await seedMonitor(ctx, org.id);
      await seedLast(monitorId);
      const response = await lastResponse(org.users[role], monitorId);
      expect(response.status).toBe(200);
      const { response: last } = monitorLastResponseResponseSchema.parse(
        response.json,
      );
      expect(last).toMatchObject({
        configVersion: 2,
        outcome: "pass",
        url: "https://fixture.example/health",
        detailOmitted: null,
        statusLine: {
          httpVersion: "HTTP/1.1",
          status: 200,
          reasonPhrase: "OK",
        },
        headers: [
          { name: "content-type", value: "application/json", redacted: false },
          { name: "set-cookie", value: "•••", redacted: true },
        ],
        headersTruncated: false,
        body: {
          kind: "text",
          text: '{"ok":true}',
          truncated: false,
          totalBytesRead: 11,
        },
      });
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "%s gets 403 PERMISSION_DENIED with no data, even before the monitor lookup",
    async (role) => {
      const monitorId = await seedMonitor(ctx, org.id);
      await seedLast(monitorId, { body_text: "viewer-must-not-see" });
      for (const id of [monitorId, crypto.randomUUID(), "not-a-uuid"]) {
        const response = await lastResponse(org.users[role], id);
        expect(response.status).toBe(403);
        expect(response.json).toEqual({
          error: {
            code: "PERMISSION_DENIED",
            message: "คุณไม่มีสิทธิ์ดูการตอบกลับของมอนิเตอร์นี้",
          },
        });
      }
    },
  );

  it("logs the denial with the read-response action and no organization or monitor id", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    await lastResponse(org.users.auditor, monitorId);
    const line = ctx
      .logRecords()
      .filter(
        (record) => record.action === "organization.monitor.read-response",
      )
      .at(-1);
    expect(line).toMatchObject({
      actorUserId: org.users.auditor,
      code: "PERMISSION_DENIED",
    });
    expect(JSON.stringify(line)).not.toContain(monitorId);
    expect(JSON.stringify(line)).not.toContain(org.id);
  });

  it("answers a non-member 403, a foreign or malformed id 404 and an unauthenticated call 401", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const outsider = await ctx.createUser("last-outsider");
    expect((await lastResponse(outsider, monitorId)).json).toMatchObject({
      error: { code: "MEMBERSHIP_DENIED" },
    });
    expect(
      (await lastResponse(other.users.owner, monitorId, other)).status,
    ).toBe(404);
    expect((await lastResponse(org.users.owner, "not-a-uuid")).status).toBe(
      404,
    );
    expect((await lastResponse(null, monitorId)).status).toBe(401);
  });

  it("returns null before the first recorded result", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    const response = await lastResponse(org.users.owner, monitorId);
    expect(response.json).toEqual({ response: null });
  });

  it("shows only version and status for request_values, whatever else the row holds", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    await seedLast(monitorId, {
      detail_omitted: "request_values",
      reason_phrase: null,
      headers: "[]",
      body_text: null,
      body_kind: "omitted",
      body_omitted_reason: "request_values",
      headers_truncated: true,
    });
    const { response: last } = monitorLastResponseResponseSchema.parse(
      (await lastResponse(org.users.owner, monitorId)).json,
    );
    expect(last).toMatchObject({
      detailOmitted: "request_values",
      statusLine: { httpVersion: "HTTP/1.1", status: 200, reasonPhrase: null },
      headers: [],
      headersTruncated: false,
      body: { kind: "omitted", reason: "request_values" },
    });
  });

  it("returns a null status line and body when no response was evaluated", async () => {
    const monitorId = await seedMonitor(ctx, org.id);
    await seedLast(monitorId, {
      outcome: "fail",
      failure_reason: "timeout",
      http_version: null,
      http_status: null,
      reason_phrase: null,
      headers: "[]",
      body_kind: null,
      body_text: null,
      body_truncated: null,
      body_bytes_read: null,
    });
    const { response: last } = monitorLastResponseResponseSchema.parse(
      (await lastResponse(org.users.owner, monitorId)).json,
    );
    expect(last).toMatchObject({
      outcome: "fail",
      failureReason: "timeout",
      statusLine: null,
      headers: [],
      body: null,
    });
  });

  it("maps omitted bodies and a text body with null counters defensively", async () => {
    const binary = await seedMonitor(ctx, org.id);
    await seedLast(binary, {
      body_kind: "omitted",
      body_text: null,
      body_omitted_reason: "not_text",
    });
    const sparse = await seedMonitor(ctx, org.id);
    await seedLast(sparse, { body_truncated: null, body_bytes_read: null });
    const readBody = async (id: string) =>
      monitorLastResponseResponseSchema.parse(
        (await lastResponse(org.users.owner, id)).json,
      ).response?.body;
    expect(await readBody(binary)).toEqual({
      kind: "omitted",
      reason: "not_text",
    });
    expect(await readBody(sparse)).toEqual({
      kind: "text",
      text: '{"ok":true}',
      truncated: false,
      totalBytesRead: 0,
    });
  });
});
