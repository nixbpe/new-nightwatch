import {
  monitorEventsResponseSchema,
  monitorWriteResponseSchema,
  type MonitorConfigInput,
  type MonitorRecord,
} from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  monitorsPath,
  openMonitorTestContext,
  validConfig,
  type MonitorTestContext,
  type TestOrganization,
} from "./test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  org = await ctx.createOrganization("write-feed");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

type WithSecrets = MonitorConfigInput & { secrets?: unknown[] };
const SECRET_ID = "5b0c1a3e-6f0a-4a57-9c4e-8d1b2a3c4d5e";

async function created(config: WithSecrets = validConfig()) {
  const response = await ctx.call(
    org.users.owner,
    "POST",
    monitorsPath(org.id),
    { ...config, clientRequestId: crypto.randomUUID() },
  );
  expect(response.status).toBe(201);
  return monitorWriteResponseSchema.parse(response.json).monitor;
}

const configOf = (monitor: MonitorRecord): WithSecrets => ({
  secrets: monitor.secretSlots.map(({ slot }) => ({ slot, action: "keep" })),
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

const edit = (
  userId: string,
  monitor: MonitorRecord,
  config: WithSecrets,
  expectedVersion: number = monitor.version,
) =>
  ctx.call(userId, "PATCH", monitorsPath(org.id, `/${monitor.id}`), {
    ...config,
    expectedVersion,
  });

const action = (
  userId: string,
  monitor: MonitorRecord,
  name: "pause" | "resume",
) => ctx.call(userId, "POST", monitorsPath(org.id, `/${monitor.id}/${name}`));

async function eventRows(monitorId: string) {
  const result = await ctx.owner.sql.query<{
    kind: string;
    actor_kind: string;
    actor_user_id: string | null;
    changes: unknown;
  }>(
    `select kind, actor_kind, actor_user_id, changes from monitor_events
     where monitor_id = $1 order by occurred_at, id`,
    [monitorId],
  );
  return result.rows;
}

describe("Edit writes the editor and the changed fields", () => {
  it("records actor_kind user, the session user and the diff of every field kind", async () => {
    const monitor = await created(
      validConfig({
        headers: [
          { name: "X-Plain", value: "before-value", secret: false },
          { name: "X-Becomes-Secret", value: "plain-before", secret: false },
        ],
        queryParams: [{ name: "token", value: "query-before" }],
      }),
    );
    const next: WithSecrets = {
      ...configOf(monitor),
      name: "Edited",
      intervalSeconds: 60,
      headers: [
        { name: "X-Plain", value: "after-value", secret: false },
        { id: SECRET_ID, name: "X-Becomes-Secret", secret: true },
      ],
      queryParams: [
        { name: "token", value: "query-after" },
        { name: "n", value: "1" },
      ],
      body: { type: "json", content: '{"password":"body-marker"}' },
      assertions: [{ kind: "bodyContains", text: "assertion-marker" }],
      secrets: [
        {
          slot: `header.${SECRET_ID}`,
          action: "replace",
          value: "secret-marker",
        },
      ],
    };
    const response = await edit(org.users.admin, monitor, next);
    expect(response.status).toBe(200);

    const rows = await eventRows(monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "config_changed",
      actor_kind: "user",
      actor_user_id: org.users.admin,
    });
    expect(rows[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: "name", kind: "value", before: "Monitor", after: "Edited" },
        { field: "intervalSeconds", kind: "value", before: 300, after: 60 },
        {
          field: "headers.X-Plain",
          kind: "value",
          before: "before-value",
          after: "after-value",
        },
        { field: "headers.X-Becomes-Secret", kind: "secret", action: "set" },
        {
          field: "queryParams.token",
          kind: "value",
          before: "•••",
          after: "•••",
        },
        { field: "queryParams.n", kind: "value", before: null, after: "•••" },
        { field: "body", kind: "changed" },
        { field: "assertions", kind: "changed" },
        { field: `header.${SECRET_ID}`, kind: "secret", action: "set" },
      ]),
    );

    // The feed API and the stored row carry no secret, query value or body.
    const feed = await ctx.call(
      org.users.owner,
      "GET",
      monitorsPath(org.id, `/${monitor.id}/events`),
    );
    const text = JSON.stringify(feed.json) + JSON.stringify(rows);
    for (const marker of [
      "plain-before",
      "secret-marker",
      "query-before",
      "query-after",
      "body-marker",
      "assertion-marker",
    ]) {
      expect(text, marker).not.toContain(marker);
    }
    const parsed = monitorEventsResponseSchema.parse(feed.json);
    expect(parsed.events[0]).toMatchObject({
      kind: "config_changed",
      actor: { kind: "member", userId: org.users.admin },
    });
  });

  it("keeps url_masked meaning: set only when the URL changed", async () => {
    const monitor = await created();
    await edit(org.users.owner, monitor, {
      ...configOf(monitor),
      name: "Name only",
    });
    const named = await ctx.owner.sql.query<{ url_masked: string | null }>(
      "select url_masked from monitor_events where monitor_id = $1",
      [monitor.id],
    );
    expect(named.rows).toEqual([{ url_masked: null }]);
  });

  it("writes no event for the Edit that loses with 409", async () => {
    const monitor = await created();
    const first = await edit(org.users.owner, monitor, {
      ...configOf(monitor),
      name: "First",
    });
    expect(first.status).toBe(200);
    const stale = await edit(
      org.users.admin,
      monitor,
      { ...configOf(monitor), name: "Second" },
      monitor.version,
    );
    expect(stale.status).toBe(409);
    const rows = await eventRows(monitor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_user_id).toBe(org.users.owner);
  });
});

describe("Two Edits racing on one version", () => {
  it("writes one config_changed row, by the Edit that won", async () => {
    for (let round = 0; round < 3; round += 1) {
      const monitor = await created();
      const callers = [
        { user: org.users.owner, name: "From owner" },
        { user: org.users.admin, name: "From admin" },
      ];
      const results = await Promise.all(
        callers.map(({ user, name }) =>
          edit(user, monitor, { ...configOf(monitor), name }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const winner = callers[results.findIndex((r) => r.status === 200)];
      const rows = await eventRows(monitor.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "config_changed",
        actor_user_id: winner?.user,
        changes: [
          {
            field: "name",
            kind: "value",
            before: "Monitor",
            after: winner?.name,
          },
        ],
      });
    }
  });
});

describe("Pause and Resume write the actor", () => {
  it("records the session user for both, and the feed shows who paused and resumed", async () => {
    const monitor = await created();
    expect((await action(org.users.admin, monitor, "pause")).status).toBe(200);
    expect((await action(org.users.owner, monitor, "resume")).status).toBe(200);
    expect(await eventRows(monitor.id)).toMatchObject([
      { kind: "paused", actor_kind: "user", actor_user_id: org.users.admin },
      { kind: "resumed", actor_kind: "user", actor_user_id: org.users.owner },
    ]);
    const feed = await ctx.call(
      org.users.owner,
      "GET",
      monitorsPath(org.id, `/${monitor.id}/events`),
    );
    const { events } = monitorEventsResponseSchema.parse(feed.json);
    expect(events.map((event) => event.kind).sort()).toEqual([
      "paused",
      "resumed",
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ actor: { kind: "member" } });
    }
  });
});
