import { randomUUID } from "node:crypto";
import net from "node:net";

import { createLogger, loadMonitorEnv } from "@nightwatch/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processMonitorCheck, type CheckerDependencies } from "./checker";
import type { MonitorEvent } from "./record-result";
import {
  closedPort,
  rows,
  seedMonitor,
  startTarget,
  startTestDatabase,
  TARGET_HOST,
  updateMonitor,
  type SeededMonitor,
  type TestDatabase,
} from "./test-harness";
import { createTestPki, startTlsTarget, type TestPki } from "./test-pki";

const OTHER_HOST = "other.nw-test.internal";
const DAY = 86_400_000;

let db!: TestDatabase;
let pki!: TestPki;
const silent = createLogger({ level: "silent", name: "checker-ssl-test" });

function deps(events: MonitorEvent[]): CheckerDependencies {
  return {
    database: db.runtime,
    credentialEnv: loadMonitorEnv({ REDIS_URL: "redis://unused" }),
    logger: silent,
    outbound: {
      resolver: () => Promise.resolve(["127.0.0.1"]),
      testAllowedHosts: [TARGET_HOST, OTHER_HOST],
      ca: pki.ca,
    },
    onEvent: (_tx, event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

/** One check with a fresh claim, as the scheduler would hand it out. */
async function check(
  monitor: SeededMonitor,
  events: MonitorEvent[],
  overrides: Partial<CheckerDependencies> = {},
): Promise<void> {
  const token = randomUUID();
  await updateMonitor(
    db,
    monitor,
    "update monitor_schedule set claim_token = $2 where monitor_id = $1",
    [monitor.monitorId, token],
  );
  await processMonitorCheck(
    monitor.job({
      claimToken: token,
      scheduledFor: new Date(
        Date.now() - Math.floor(Math.random() * 3_000_000),
      ).toISOString(),
    }),
    { ...deps(events), ...overrides },
  );
}

type SslRow = {
  ssl_host: string | null;
  ssl_issuer: string | null;
  ssl_not_after: Date | null;
  ssl_state: string | null;
  ssl_reason: string | null;
  ssl_notified_level: string | null;
};
function ssl(monitor: SeededMonitor): Promise<SslRow> {
  return rows<SslRow>(
    db,
    monitor,
    `select ssl_host, ssl_issuer, ssl_not_after, ssl_state, ssl_reason,
            ssl_notified_level from monitors where id = $1`,
    [monitor.monitorId],
  ).then((found) => found[0] as SslRow);
}

function sslEvents(events: MonitorEvent[]) {
  return events.flatMap((event) =>
    event.type === "ssl_level_entered"
      ? [{ level: event.level, host: event.host }]
      : [],
  );
}

beforeAll(async () => {
  pki = createTestPki();
  db = await startTestDatabase("checker-ssl");
}, 90_000);

afterAll(async () => {
  await db.stop();
  pki.dispose();
}, 60_000);

describe("SSL state of the last hop (AC-35)", () => {
  it("stores host, issuer and expiry of a valid certificate and enters caution once", async () => {
    const target = await startTlsTarget(pki.issue(TARGET_HOST, { days: 20 }));
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const events: MonitorEvent[] = [];
      await check(monitor, events);
      await check(monitor, events);

      const state = await ssl(monitor);
      expect(state).toMatchObject({
        ssl_host: TARGET_HOST,
        ssl_state: "caution",
        ssl_reason: null,
        ssl_notified_level: null,
      });
      expect(state.ssl_issuer).toContain("NW Worker Test CA");
      const remainingDays =
        ((state.ssl_not_after?.getTime() ?? 0) - Date.now()) / DAY;
      expect(remainingDays).toBeGreaterThan(19);
      expect(remainingDays).toBeLessThan(21);
      expect(sslEvents(events)).toEqual([
        { level: "caution", host: TARGET_HOST },
      ]);
    } finally {
      await target.close();
    }
  });

  it("a redirect to another host reports the certificate of that host", async () => {
    const final = await startTlsTarget(
      pki.issue(OTHER_HOST, { days: 5 }),
      undefined,
      OTHER_HOST,
    );
    const first = await startTlsTarget(
      pki.issue(TARGET_HOST, { days: 90 }),
      (_request, response) => {
        response.statusCode = 302;
        response.setHeader("location", `${final.origin}/landing`);
        response.end();
      },
    );
    try {
      const monitor = await seedMonitor(db, { url: `${first.url}/start` });
      const events: MonitorEvent[] = [];
      await check(monitor, events);

      const state = await ssl(monitor);
      expect(state.ssl_host).toBe(OTHER_HOST);
      expect(state.ssl_state).toBe("danger");
      expect(final.requests).toHaveLength(1);
      expect(sslEvents(events)).toEqual([
        { level: "danger", host: OTHER_HOST },
      ]);
    } finally {
      await first.close();
      await final.close();
    }
  });

  it("an expired certificate is tls_invalid with its reason and sends no request", async () => {
    const target = await startTlsTarget(pki.issue(TARGET_HOST, "expired"));
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const events: MonitorEvent[] = [];
      await check(monitor, events);

      const [result] = await rows<{
        outcome: string;
        failure_reason: string;
        tls_reason: string;
      }>(
        db,
        monitor,
        "select outcome, failure_reason, tls_reason from monitor_check_results where monitor_id = $1",
        [monitor.monitorId],
      );
      expect(result).toEqual({
        outcome: "fail",
        failure_reason: "tls_invalid",
        tls_reason: "expired",
      });
      expect(target.requests).toHaveLength(0);
      // Nothing was known before, so the level is stored without an expiry date.
      expect(await ssl(monitor)).toMatchObject({
        ssl_host: TARGET_HOST,
        ssl_state: "expired",
        ssl_reason: "expired",
        ssl_not_after: null,
      });
      expect(sslEvents(events)).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it("a certificate that ran out since the last check enters expired with the stored expiry", async () => {
    const target = await startTlsTarget(pki.issue(TARGET_HOST, "expired"));
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      const notAfter = new Date(Date.now() - 3_600_000);
      await updateMonitor(
        db,
        monitor,
        `update monitors set ssl_host = $2, ssl_issuer = 'Known CA',
           ssl_not_after = $3, ssl_state = 'danger',
           last_check_at = $3::timestamptz - interval '1 hour' where id = $1`,
        [monitor.monitorId, TARGET_HOST, notAfter],
      );
      const events: MonitorEvent[] = [];
      await check(monitor, events);
      await check(monitor, events);

      const state = await ssl(monitor);
      expect(state).toMatchObject({
        ssl_state: "expired",
        ssl_issuer: "Known CA",
        ssl_reason: "expired",
      });
      expect(state.ssl_not_after?.getTime()).toBe(notAfter.getTime());
      expect(sslEvents(events)).toEqual([
        { level: "expired", host: TARGET_HOST },
      ]);
    } finally {
      await target.close();
    }
  });

  it("a renewed certificate raises no event and a later short one enters its level again", async () => {
    const short = await startTlsTarget(pki.issue(TARGET_HOST, { days: 5 }));
    const monitor = await seedMonitor(db, { url: `${short.url}/` });
    const events: MonitorEvent[] = [];
    await check(monitor, events);
    await short.close();

    const renewed = await startTlsTarget(pki.issue(TARGET_HOST, { days: 90 }));
    await updateMonitor(
      db,
      monitor,
      "update monitors set url = $2 where id = $1",
      [monitor.monitorId, `${renewed.url}/`],
    );
    await check(monitor, events);
    expect((await ssl(monitor)).ssl_state).toBe("ok");
    await renewed.close();

    const again = await startTlsTarget(pki.issue(TARGET_HOST, { days: 6 }));
    try {
      await updateMonitor(
        db,
        monitor,
        "update monitors set url = $2 where id = $1",
        [monitor.monitorId, `${again.url}/`],
      );
      await check(monitor, events);
      expect(sslEvents(events)).toEqual([
        { level: "danger", host: TARGET_HOST },
        { level: "danger", host: TARGET_HOST },
      ]);
    } finally {
      await again.close();
    }
  });

  it("a plain http target is not_https and clears the certificate columns", async () => {
    const target = await startTarget();
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await updateMonitor(
        db,
        monitor,
        "update monitors set ssl_host = 'old.example', ssl_not_after = now(), ssl_state = 'danger' where id = $1",
        [monitor.monitorId],
      );
      await check(monitor, []);
      expect(await ssl(monitor)).toMatchObject({
        ssl_host: null,
        ssl_issuer: null,
        ssl_not_after: null,
        ssl_state: "not_https",
      });
    } finally {
      await target.close();
    }
  });

  it("a connection failure before any handshake keeps the last known SSL state", async () => {
    const target = await startTlsTarget(pki.issue(TARGET_HOST, { days: 20 }));
    const monitor = await seedMonitor(db, { url: `${target.url}/` });
    const events: MonitorEvent[] = [];
    await check(monitor, events);
    const before = await ssl(monitor);
    await target.close();
    await updateMonitor(
      db,
      monitor,
      "update monitors set url = $2 where id = $1",
      [
        monitor.monitorId,
        `https://${TARGET_HOST}:${String(await closedPort())}/`,
      ],
    );
    await check(monitor, events);
    expect(await ssl(monitor)).toEqual(before);
  });

  it("an unreadable handshake keeps the certificate identity, so the same certificate enters its level once", async () => {
    const good = await startTlsTarget(pki.issue(TARGET_HOST, { days: 5 }));
    const reset = net.createServer((socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve) => reset.listen(0, "127.0.0.1", resolve));
    const resetPort = (reset.address() as net.AddressInfo).port;
    try {
      const monitor = await seedMonitor(db, { url: `${good.url}/` });
      const events: MonitorEvent[] = [];
      await check(monitor, events);
      const before = await ssl(monitor);

      await updateMonitor(
        db,
        monitor,
        "update monitors set url = $2 where id = $1",
        [monitor.monitorId, `https://${TARGET_HOST}:${String(resetPort)}/`],
      );
      await check(monitor, events);
      const during = await ssl(monitor);
      expect(during.ssl_state).toBe("unreadable");
      expect(during.ssl_reason).toBe("handshake_failed");
      expect(during.ssl_host).toBe(before.ssl_host);
      expect(during.ssl_issuer).toBe(before.ssl_issuer);
      expect(during.ssl_not_after).toEqual(before.ssl_not_after);

      await updateMonitor(
        db,
        monitor,
        "update monitors set url = $2 where id = $1",
        [monitor.monitorId, `${good.url}/`],
      );
      await check(monitor, events);
      expect(await ssl(monitor)).toMatchObject({ ssl_state: "danger" });
      expect(sslEvents(events)).toEqual([
        { level: "danger", host: TARGET_HOST },
      ]);
    } finally {
      await good.close();
      await new Promise((resolve) => reset.close(resolve));
    }
  });

  it("a stored expiry that has not passed is not reused for an expired certificate", async () => {
    const target = await startTlsTarget(pki.issue(TARGET_HOST, "expired"));
    try {
      const monitor = await seedMonitor(db, { url: `${target.url}/` });
      await updateMonitor(
        db,
        monitor,
        `update monitors set ssl_host = $2, ssl_issuer = 'Other CA',
           ssl_not_after = now() + interval '30 days', ssl_state = 'ok' where id = $1`,
        [monitor.monitorId, TARGET_HOST],
      );
      const events: MonitorEvent[] = [];
      await check(monitor, events);
      expect(await ssl(monitor)).toMatchObject({
        ssl_state: "expired",
        ssl_reason: "expired",
        ssl_not_after: null,
        ssl_issuer: null,
      });
      expect(sslEvents(events)).toEqual([]);
    } finally {
      await target.close();
    }
  });
});
