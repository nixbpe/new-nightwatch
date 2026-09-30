import type { Database } from "@nightwatch/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getMonitor,
  getResponseTimes,
  listChecks,
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
      "Response times",
      (d: Database, i: Identity, id: string) =>
        getResponseTimes(d, i, id, "24h"),
    ],
  ] as const)("%s is denied and returns no data", async (_name, read) => {
    const org = await ctx.createOrganization("read-membership");
    const monitorId = await seedMonitor(ctx, org.id, { name: "Private" });
    const userId = org.users.viewer;
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
const query = { limit: 25, offset: 0 } as const;
