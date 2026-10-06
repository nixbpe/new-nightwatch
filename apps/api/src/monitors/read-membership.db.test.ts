import type { Database } from "@nightwatch/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getLastResponse,
  getMonitor,
  getResponseTimes,
  listChecks,
  listEvents,
  listIncidents,
  listMonitors,
  listRecentEvents,
} from "./read-service";
import { seedMonitor } from "./read-test-support";
import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "./test-support";

let ctx: MonitorTestContext;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

// The role change commits right after the pre-transaction membership lookup.
function demotedAfterPreCheck(org: TestOrganization, userId: string): Database {
  const pool = ctx.runtime.sql;
  const sql = new Proxy(pool, {
    get(target, property) {
      if (property === "query") {
        return async (...args: Parameters<typeof target.query>) => {
          const result = await (
            target.query as (...a: unknown[]) => Promise<unknown>
          )(...args);
          if (typeof args[0] === "string" && args[0].includes("from member")) {
            await ctx.owner.sql.query(
              "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
              [org.id, userId],
            );
          }
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { ...ctx.runtime, sql };
}

// The removal commits right after the pre-transaction membership lookup and
// before the read transaction opens: the window the in-transaction check closes.
function removedAfterPreCheck(org: TestOrganization, userId: string): Database {
  const pool = ctx.runtime.sql;
  const sql = new Proxy(pool, {
    get(target, property) {
      if (property === "query") {
        return async (...args: Parameters<typeof target.query>) => {
          const result = await (
            target.query as (...a: unknown[]) => Promise<unknown>
          )(...args);
          if (typeof args[0] === "string" && args[0].includes("from member")) {
            await ctx.owner.sql.query(
              "delete from member where organization_id = $1 and user_id = $2",
              [org.id, userId],
            );
          }
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { ...ctx.runtime, sql };
}

describe("a member removed between the pre-check and the read transaction", () => {
  const denied = { statusCode: 403, code: "MEMBERSHIP_DENIED" };

  it.each([
    ["List", (d: Database, i: Identity) => listMonitors(d, i, query)],
    ["Recent events", (d: Database, i: Identity) => listRecentEvents(d, i, 10)],
    ["Detail", (d: Database, i: Identity, id: string) => getMonitor(d, i, id)],
    [
      "Checks",
      (d: Database, i: Identity, id: string) =>
        listChecks(d, i, id, { limit: 20, offset: 0 }),
    ],
    [
      "Incidents",
      (d: Database, i: Identity, id: string) =>
        listIncidents(d, i, id, { limit: 20, offset: 0 }),
    ],
    [
      "Events",
      (d: Database, i: Identity, id: string) =>
        listEvents(d, i, id, { limit: 20, offset: 0 }),
    ],
    [
      "Last response",
      (d: Database, i: Identity, id: string) => getLastResponse(d, i, id),
    ],
    [
      "Response times",
      (d: Database, i: Identity, id: string) =>
        getResponseTimes(d, i, id, "24h"),
    ],
  ] as const)("%s is denied and returns no data", async (_name, read) => {
    const org = await ctx.createOrganization("read-membership");
    const monitorId = await seedMonitor(ctx, org.id, { name: "Private" });
    // Owner: the last-response read needs a role that passes the pre-check.
    const userId = org.users.owner;
    await expect(
      read(
        removedAfterPreCheck(org, userId),
        { organizationId: org.id, actorUserId: userId },
        monitorId,
      ),
    ).rejects.toMatchObject(denied);
  });

  it("a member who stays still reads", async () => {
    const org = await ctx.createOrganization("read-membership-stays");
    await seedMonitor(ctx, org.id, { name: "Visible" });
    const body = await listMonitors(
      ctx.runtime,
      { organizationId: org.id, actorUserId: org.users.viewer },
      query,
    );
    expect(body.monitors.map((monitor) => monitor.name)).toEqual(["Visible"]);
  });
});

type Identity = { organizationId: string; actorUserId: string };
const query = { limit: 25, offset: 0, sort: "problems" } as const;

describe("an owner demoted between the pre-check and the read transaction", () => {
  it("is denied the last response", async () => {
    const org = await ctx.createOrganization("read-demoted-response");
    const monitorId = await seedMonitor(ctx, org.id);
    await expect(
      getLastResponse(
        demotedAfterPreCheck(org, org.users.owner),
        { organizationId: org.id, actorUserId: org.users.owner },
        monitorId,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
  });

  it("sees the event actor as member_hidden, not by name", async () => {
    const org = await ctx.createOrganization("read-demoted-feed");
    const monitorId = await seedMonitor(ctx, org.id);
    await ctx.owner.sql.query(
      `insert into monitor_events (monitor_id, tenant_id, kind, actor_kind, actor_user_id)
       values ($1, $2, 'paused', 'user', $3)`,
      [monitorId, org.id, org.users.admin],
    );
    const body = await listEvents(
      demotedAfterPreCheck(org, org.users.owner),
      { organizationId: org.id, actorUserId: org.users.owner },
      monitorId,
      { limit: 20, offset: 0 },
    );
    expect(body.events).toMatchObject([
      { kind: "paused", actor: { kind: "member_hidden" } },
    ]);
    expect(JSON.stringify(body)).not.toContain(org.users.admin);
  });
});

describe("response-times authorized before removal", () => {
  it("finishes under the organization lock, then denies the next long-range read", async () => {
    const org = await ctx.createOrganization("response-before-removal");
    const id = await seedMonitor(ctx, org.id);
    const writer = await ctx.owner.sql.connect();
    let removal: Promise<void> | undefined;
    try {
      await writer.query("begin");
      const pid = (
        await writer.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]?.pid;
      const sql = new Proxy(ctx.runtime.sql, {
        get(target, key) {
          if (key === "connect")
            return async () => {
              const client = await target.connect();
              return new Proxy(client, {
                get(connection, property) {
                  if (property === "query")
                    return async (text: string, values?: unknown[]) => {
                      const result = await connection.query(text, values);
                      if (text === "select now() as now") {
                        removal = (async () => {
                          await writer.query(
                            "select id from organization where id = $1 for update",
                            [org.id],
                          );
                          await writer.query(
                            "delete from member where organization_id = $1 and user_id = $2",
                            [org.id, org.users.viewer],
                          );
                          await writer.query("commit");
                        })();
                        let blocked = false;
                        for (let attempt = 0; attempt < 100; attempt++) {
                          const locks = await ctx.owner.sql.query<{
                            blocked: boolean;
                          }>(
                            "select exists (select 1 from pg_locks where pid = $1 and not granted) as blocked",
                            [pid],
                          );
                          if (locks.rows[0]?.blocked) {
                            blocked = true;
                            break;
                          }
                          await new Promise((resolve) =>
                            setTimeout(resolve, 5),
                          );
                        }
                        expect(blocked).toBe(true);
                      }
                      return result;
                    };
                  const value: unknown = Reflect.get(connection, property);
                  const boundValue: unknown =
                    typeof value === "function"
                      ? value.bind(connection)
                      : value;
                  return boundValue;
                },
              });
            };
          const value: unknown = Reflect.get(target, key);
          const boundValue: unknown =
            typeof value === "function" ? value.bind(target) : value;
          return boundValue;
        },
      });
      const identity = {
        organizationId: org.id,
        actorUserId: org.users.viewer,
      };
      const response = await getResponseTimes(
        { ...ctx.runtime, sql },
        identity,
        id,
        "30d",
      );
      if (response.range === "24h") throw new Error("long shape expected");
      expect(response.summary).toEqual({
        p50Ms: null,
        p95Ms: null,
        checks: 0,
        failed: 0,
      });
      await removal;
      await expect(
        getResponseTimes(ctx.runtime, identity, id, "30d"),
      ).rejects.toMatchObject({ statusCode: 403, code: "MEMBERSHIP_DENIED" });
    } finally {
      await writer.query("rollback");
      writer.release();
    }
  });
});
