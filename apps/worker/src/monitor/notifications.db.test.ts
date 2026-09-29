import { randomUUID } from "node:crypto";
import net from "node:net";

import {
  claimNotificationDispatches,
  markNotificationDispatchEnqueued,
  withTenantContextRaw,
} from "@nightwatch/db";
import type { CheckResult } from "@nightwatch/shared";
import { Queue, Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  IN_APP_MATERIALIZE_QUEUE,
  NotificationDispatchScheduler,
  redisConnection,
  type DispatchQueue,
} from "../dispatch";
import {
  createMaterializationDependencies,
  processMaterialization,
  type MaterializeJobData,
} from "../materialize";
import { writeMonitorNotification } from "./notifications";
import { recordCheckResult } from "./record-result";
import {
  rows,
  seedMonitor,
  startTestDatabase,
  startTestRedis,
  updateMonitor,
  type SeededMonitor,
  type TestDatabase,
  type TestRedis,
} from "./test-harness";
import { createLogger } from "@nightwatch/shared";

const DAY = 86_400_000;
const SSL_HOST = "secure.nw-test.internal";
let db!: TestDatabase;
let step = 0;

beforeAll(async () => {
  db = await startTestDatabase("notifications");
}, 90_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

type Members = {
  owner: string;
  admin: string;
  viewer: string;
  auditor: string;
};

/** An organization's members: owner, admin (composite role), viewer, auditor. */
async function seedMembers(monitor: SeededMonitor): Promise<Members> {
  const members: Members = {
    owner: randomUUID(),
    admin: randomUUID(),
    viewer: randomUUID(),
    auditor: randomUUID(),
  };
  for (const [role, id] of Object.entries(members)) {
    await db.owner.sql.query(
      `insert into "user" (id, name, email, email_verified)
       values ($1, $2, $3, true)`,
      [id, role, `${role}-${id}@example.test`],
    );
    await db.owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [
        randomUUID(),
        monitor.tenantId,
        id,
        role === "admin" ? "viewer,admin" : role,
      ],
    );
  }
  return members;
}

function httpResult(
  outcome: "pass" | "fail",
  checkedAt = new Date(),
): CheckResult {
  return {
    outcome,
    checkedAt,
    httpStatus: outcome === "pass" ? 200 : 503,
    responseTimeMs: 12,
    failureReason: outcome === "pass" ? null : "http_status",
    tlsReason: null,
    assertions: [],
    url: "http://target.nw-test.internal/health",
    evaluatedFromPrefix: false,
    tls: null,
  };
}

function certResult(notAfter: Date, checkedAt: Date): CheckResult {
  return {
    ...httpResult("pass", checkedAt),
    url: `https://${SSL_HOST}/`,
    tls: { host: SSL_HOST, issuer: "NW Test CA", notAfter },
  };
}

function expiredResult(checkedAt: Date): CheckResult {
  return {
    ...httpResult("fail", checkedAt),
    httpStatus: null,
    failureReason: "tls_invalid",
    tlsReason: "expired",
    tls: { host: SSL_HOST, issuer: null, notAfter: null },
  };
}

function unreadableResult(checkedAt: Date): CheckResult {
  return { ...expiredResult(checkedAt), tlsReason: "handshake_failed" };
}

/** One check recorded with the real notification writer and a fresh claim. */
async function record(
  monitor: SeededMonitor,
  result: CheckResult,
): Promise<string> {
  const claimToken = randomUUID();
  await updateMonitor(
    db,
    monitor,
    "update monitor_schedule set claim_token = $2 where monitor_id = $1",
    [monitor.monitorId, claimToken],
  );
  step += 1;
  return recordCheckResult(db.runtime, {
    tenantId: monitor.tenantId,
    monitorId: monitor.monitorId,
    claimToken,
    checkConfigVersion: 1,
    scheduledFor: new Date(Date.now() - 3_000_000 + step * 1_000),
    intervalSeconds: 60,
    result,
  });
}

async function intentTypes(monitor: SeededMonitor): Promise<string[]> {
  const result = await db.owner.sql.query<{ event_type: string }>(
    `select event_type from notification_intents
     where tenant_id = $1 order by created_at, id`,
    [monitor.tenantId],
  );
  return result.rows.map((row) => row.event_type);
}

/** What the dispatch scheduler and the materialize job do, without a queue. */
async function materializeAll(): Promise<void> {
  const claimToken = randomUUID();
  const dependencies = createMaterializationDependencies(db.runtime);
  const claims = await claimNotificationDispatches(db.runtime, {
    claimToken,
    limit: 100,
  });
  for (const claim of claims) {
    await markNotificationDispatchEnqueued(db.runtime, {
      id: claim.id,
      claimToken,
    });
    await processMaterialization(
      {
        dispatchId: claim.id,
        claimToken,
        scope: { kind: "tenant", tenantId: claim.tenantId as string },
      },
      dependencies,
    );
  }
}

async function inboxByUser(
  monitor: SeededMonitor,
): Promise<Record<string, string[]>> {
  const result = await db.owner.sql.query<{
    recipient_user_id: string;
    event_type: string;
  }>(
    `select recipient_user_id, event_type from notification_inbox_items
     where tenant_id = $1 order by occurred_at, id`,
    [monitor.tenantId],
  );
  const byUser: Record<string, string[]> = {};
  for (const row of result.rows) {
    (byUser[row.recipient_user_id] ??= []).push(row.event_type);
  }
  return byUser;
}

describe("incident notifications (AC-24, AC-51, AC-52)", () => {
  it("fail, fail, pass, fail, fail gives down, recovered, down to owner and admin only", async () => {
    const monitor = await seedMonitor(db);
    const members = await seedMembers(monitor);
    for (const outcome of ["fail", "fail", "pass", "fail", "fail"] as const) {
      await record(monitor, httpResult(outcome));
    }
    expect(await intentTypes(monitor)).toEqual([
      "MONITOR_DOWN",
      "MONITOR_RECOVERED",
      "MONITOR_DOWN",
    ]);

    await materializeAll();
    const three = ["MONITOR_DOWN", "MONITOR_RECOVERED", "MONITOR_DOWN"];
    expect(await inboxByUser(monitor)).toEqual({
      [members.owner]: three,
      [members.admin]: three,
    });

    const [item] = await rows<{
      subject_monitor_id: string;
      subject_monitor_name: string;
      monitor_reason: string | null;
    }>(
      db,
      monitor,
      `select subject_monitor_id, subject_monitor_name, monitor_reason
       from notification_inbox_items
       where recipient_user_id = $1 and event_type = 'MONITOR_DOWN' limit 1`,
      [members.owner],
    );
    expect(item).toEqual({
      subject_monitor_id: monitor.monitorId,
      subject_monitor_name: "Checked monitor",
      monitor_reason: "http_status",
    });
  });

  it("an admin demoted before materialize gets nothing", async () => {
    const monitor = await seedMonitor(db);
    const members = await seedMembers(monitor);
    await record(monitor, httpResult("fail"));
    await record(monitor, httpResult("fail"));
    await db.owner.sql.query(
      "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
      [monitor.tenantId, members.admin],
    );
    await materializeAll();
    expect(await inboxByUser(monitor)).toEqual({
      [members.owner]: ["MONITOR_DOWN"],
    });
  });

  it("a pause that ended the incident sends no recovered", async () => {
    const monitor = await seedMonitor(db);
    await seedMembers(monitor);
    await record(monitor, httpResult("fail"));
    await record(monitor, httpResult("fail"));
    await updateMonitor(
      db,
      monitor,
      `update monitor_incidents set ended_at = now(), end_reason = 'paused_by_user'
       where monitor_id = $1 and ended_at is null`,
      [monitor.monitorId],
    );
    await record(monitor, httpResult("pass"));
    expect(await intentTypes(monitor)).toEqual(["MONITOR_DOWN"]);
    await withTenantContextRaw(db.runtime, monitor.tenantId, (tx) =>
      writeMonitorNotification(tx, {
        type: "incident_closed",
        tenantId: monitor.tenantId,
        monitorId: monitor.monitorId,
        monitorName: "Checked monitor",
        occurredAt: new Date(),
        incidentId: randomUUID(),
        endReason: "paused_by_user",
        downNotified: true,
      }),
    );
    expect(await intentTypes(monitor)).toEqual(["MONITOR_DOWN"]);
  });

  it("deleting the monitor during an outage keeps the down notification and sends no recovered (AC-19)", async () => {
    const monitor = await seedMonitor(db);
    const members = await seedMembers(monitor);
    await record(monitor, httpResult("fail"));
    await record(monitor, httpResult("fail"));
    await updateMonitor(db, monitor, "delete from monitors where id = $1", [
      monitor.monitorId,
    ]);
    expect(await record(monitor, httpResult("pass"))).toBe("discarded");
    await materializeAll();
    expect(await intentTypes(monitor)).toEqual(["MONITOR_DOWN"]);
    expect(await inboxByUser(monitor)).toEqual({
      [members.owner]: ["MONITOR_DOWN"],
      [members.admin]: ["MONITOR_DOWN"],
    });
  });

  it("alerts off at open and on at close sends neither down nor recovered", async () => {
    const monitor = await seedMonitor(db);
    await seedMembers(monitor);
    await db.owner.sql.query(
      `insert into notification_org_settings (tenant_id, monitor_alerts_enabled)
       values ($1, false)`,
      [monitor.tenantId],
    );
    await record(monitor, httpResult("fail"));
    await record(monitor, httpResult("fail"));
    await db.owner.sql.query(
      "update notification_org_settings set monitor_alerts_enabled = true where tenant_id = $1",
      [monitor.tenantId],
    );
    await record(monitor, httpResult("pass"));
    expect(await intentTypes(monitor)).toEqual([]);
    const [incident] = await rows<{ down_notified: boolean }>(
      db,
      monitor,
      "select down_notified from monitor_incidents where monitor_id = $1",
      [monitor.monitorId],
    );
    expect(incident?.down_notified).toBe(false);
  });

  it("alerts on with an explicit settings row sends down and marks the incident", async () => {
    const monitor = await seedMonitor(db);
    await seedMembers(monitor);
    await db.owner.sql.query(
      `insert into notification_org_settings (tenant_id, monitor_alerts_enabled)
       values ($1, true)`,
      [monitor.tenantId],
    );
    await record(monitor, httpResult("fail"));
    await record(monitor, httpResult("fail"));
    expect(await intentTypes(monitor)).toEqual(["MONITOR_DOWN"]);
    const [incident] = await rows<{ down_notified: boolean }>(
      db,
      monitor,
      "select down_notified from monitor_incidents where monitor_id = $1",
      [monitor.monitorId],
    );
    expect(incident?.down_notified).toBe(true);
  });
});

describe("SSL notifications (AC-36)", () => {
  const notAfter = new Date(Date.UTC(2027, 0, 1));
  const daysBefore = (days: number, extraMs = 0) =>
    new Date(notAfter.getTime() - days * DAY + extraMs);

  it("a first observation at 5 days sends only danger", async () => {
    const monitor = await seedMonitor(db);
    await seedMembers(monitor);
    await record(monitor, certResult(notAfter, daysBefore(5)));
    await record(monitor, certResult(notAfter, daysBefore(4)));
    expect(await intentTypes(monitor)).toEqual(["MONITOR_SSL_DANGER"]);
    const [intent] = await db.owner.sql
      .query<{ ssl_not_after: Date; monitor_reason: string | null }>(
        `select ssl_not_after, monitor_reason from notification_intents
         where tenant_id = $1`,
        [monitor.tenantId],
      )
      .then((result) => result.rows);
    expect(intent?.ssl_not_after.getTime()).toBe(notAfter.getTime());
  });

  it("31, 30, 8, 7, 0 days send caution, danger and expired once each", async () => {
    const monitor = await seedMonitor(db);
    await seedMembers(monitor);
    await record(monitor, certResult(notAfter, daysBefore(31)));
    expect(await intentTypes(monitor)).toEqual([]);
    await record(monitor, certResult(notAfter, daysBefore(30)));
    await record(monitor, certResult(notAfter, daysBefore(8)));
    await record(monitor, certResult(notAfter, daysBefore(7)));
    // Same level again, also after an unreadable handshake in between.
    await record(monitor, certResult(notAfter, daysBefore(6)));
    await record(monitor, unreadableResult(daysBefore(5)));
    await record(monitor, certResult(notAfter, daysBefore(4)));
    await record(monitor, expiredResult(daysBefore(0, 1_000)));
    await record(monitor, expiredResult(daysBefore(0, 61_000)));
    // The repeated expired check also opens a down incident; only SSL counts here.
    const types = (await intentTypes(monitor)).filter((type) =>
      type.startsWith("MONITOR_SSL"),
    );
    expect(types).toEqual([
      "MONITOR_SSL_CAUTION",
      "MONITOR_SSL_DANGER",
      "MONITOR_SSL_EXPIRED",
    ]);
  });

  it("a renewal sends nothing and a later threshold crossing of the new certificate sends again", async () => {
    const monitor = await seedMonitor(db);
    await seedMembers(monitor);
    await record(monitor, certResult(notAfter, daysBefore(30)));
    expect(await intentTypes(monitor)).toEqual(["MONITOR_SSL_CAUTION"]);

    const renewed = new Date(notAfter.getTime() + 90 * DAY);
    await record(monitor, certResult(renewed, daysBefore(29)));
    expect(await intentTypes(monitor)).toEqual(["MONITOR_SSL_CAUTION"]);

    await record(
      monitor,
      certResult(renewed, new Date(renewed.getTime() - 30 * DAY)),
    );
    expect(await intentTypes(monitor)).toEqual([
      "MONITOR_SSL_CAUTION",
      "MONITOR_SSL_CAUTION",
    ]);
  });
});

describe("notification queue outage (AC-53)", () => {
  /** Relay in front of Redis that can be taken down and brought back on one port. */
  async function startRelay(target: URL) {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((client) => {
      const upstream = net.connect(Number(target.port), target.hostname);
      sockets.add(client);
      sockets.add(upstream);
      client.pipe(upstream);
      upstream.pipe(client);
      const drop = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", drop);
      upstream.on("error", drop);
      client.on("close", drop);
    });
    const listen = (port: number) =>
      new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    await listen(0);
    const port = (server.address() as net.AddressInfo).port;
    return {
      port,
      async down() {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
      },
      up: () => listen(port),
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }

  it("Redis stopped during an open incident then restored gives one notification per recipient", async () => {
    const redis: TestRedis = await startTestRedis("notifications");
    const relay = await startRelay(new URL(redis.url));
    const connection = redisConnection(
      `redis://127.0.0.1:${String(relay.port)}`,
    );
    const queue = new Queue<MaterializeJobData>(IN_APP_MATERIALIZE_QUEUE, {
      connection,
    });
    const dependencies = createMaterializationDependencies(db.runtime);
    const worker = new Worker<MaterializeJobData>(
      IN_APP_MATERIALIZE_QUEUE,
      (job) => processMaterialization(job.data, dependencies),
      { connection },
    );
    // A real add() waits for the connection; the dispatcher's caller gives up.
    const boundedQueue: DispatchQueue = {
      add: (...args) =>
        Promise.race([
          queue.add(...args),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error("queue unavailable"));
            }, 1_500);
          }),
        ]),
      waitUntilReady: () => queue.waitUntilReady(),
      close: () => queue.close(),
    };
    const scheduler = new NotificationDispatchScheduler(
      db.runtime,
      boundedQueue,
      createLogger({ level: "silent", name: "notifications-test" }),
    );
    try {
      const monitor = await seedMonitor(db);
      const members = await seedMembers(monitor);
      await relay.down();
      await record(monitor, httpResult("fail"));
      await record(monitor, httpResult("fail"));
      expect(await intentTypes(monitor)).toEqual(["MONITOR_DOWN"]);

      await scheduler.dispatch();
      const failed = await db.owner.sql.query<{ status: string }>(
        `select ledger.status from notification_dispatch_ledger ledger
         where ledger.tenant_id = $1`,
        [monitor.tenantId],
      );
      expect(failed.rows).toEqual([{ status: "failed" }]);
      expect(await inboxByUser(monitor)).toEqual({});

      await relay.up();
      await scheduler.dispatch();
      const deadline = Date.now() + 20_000;
      while (
        Date.now() < deadline &&
        Object.keys(await inboxByUser(monitor)).length < 2
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(await inboxByUser(monitor)).toEqual({
        [members.owner]: ["MONITOR_DOWN"],
        [members.admin]: ["MONITOR_DOWN"],
      });
      const intents = await db.owner.sql.query(
        "select 1 from notification_intents where tenant_id = $1",
        [monitor.tenantId],
      );
      expect(intents.rowCount).toBe(1);
    } finally {
      await worker.close(true);
      await queue.close();
      await relay.close().catch(() => undefined);
      await redis.stop();
    }
  }, 90_000);
});
