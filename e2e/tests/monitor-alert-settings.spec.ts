import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  monitorPath,
  signInApi,
  targetHostname,
  type Person,
} from "../support/monitor-fixtures";

/**
 * Issue #60 (P60-01, P60-02): a per-monitor failure threshold decides "ล่ม"
 * independently of its own down/recovery toggle (OD-60-02 (a), OD-60-01 (a)).
 * One Organization, one owner, two monitors created against a fixed 1-minute
 * interval so three checks land inside the test's budget.
 */
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let host: string;
let org: string;
let owner: Person;
const userIds: string[] = [];
// Monitor 1: down from creation, failure threshold raised to 3 through the form.
let targetThreshold: Target;
// Monitor 2: up at first so its Edit (toggle off) lands before any failure.
let targetToggle: Target;
const thresholdName = `alert-threshold-${run}`;
const toggleName = `alert-toggle-${run}`;

const urlOf = (server: Target, path: string) =>
  `http://${host}:${String(server.port)}${path}`;

type MonitorBody = {
  monitor: {
    id: string;
    health: string;
    alerts: {
      failureThreshold: number;
      downEnabled: boolean;
      sslEnabled: boolean;
      sslCautionDays: number;
    };
  };
};

type IncidentRow = { id: string; started_at: Date; down_notified: boolean };

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(person.email);
  await page.locator("#login-password").fill(person.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
}

async function monitorIdByName(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "select id from monitors where tenant_id = $1 and name = $2",
    [org, name],
  );
  return result.rows[0]!.id;
}

async function openIncident(monitorId: string): Promise<IncidentRow | null> {
  const result = await pool.query<IncidentRow>(
    `select id, started_at, down_notified from monitor_incidents
      where monitor_id = $1 and ended_at is null`,
    [monitorId],
  );
  return result.rows[0] ?? null;
}

async function countInbox(monitorId: string, eventType: string) {
  const result = await pool.query<{ n: number }>(
    `select count(*)::int as n from notification_inbox_items
      where tenant_id = $1 and subject_monitor_id = $2 and event_type = $3`,
    [org, monitorId, eventType],
  );
  return result.rows[0]!.n;
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

test.beforeAll(async () => {
  host = targetHostname();
  targetThreshold = await startMonitorTarget();
  targetThreshold.setMode("down");
  targetToggle = await startMonitorTarget();

  org = await createOrganization(pool, `E2E Alert Settings ${run}`);
  owner = await createPerson(pool, "owner", org);
  userIds.push(owner.userId);
  await addMember(pool, org, owner.userId, "owner");
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [org]);
  } finally {
    await database.close();
    await targetThreshold.close();
    await targetToggle.close();
  }
});

test("a threshold of 3 opens the incident only at the third failure, and a monitor's own down toggle silences only that monitor (P60-01, P60-02)", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  await signIn(page, owner);

  // Monitor 1: created through the form with a 1-minute interval and "3 ครั้ง" selected.
  await page.goto(`/organizations/${org}/monitors/new`);
  await page.getByLabel("ชื่อมอนิเตอร์").fill(thresholdName);
  await page
    .getByLabel("URL", { exact: true })
    .fill(urlOf(targetThreshold, "/health"));
  await page.getByRole("radio", { name: "1 นาที" }).click();
  await page.getByLabel("แจ้งเมื่อล้มเหลวติดกัน").selectOption("3");
  await page.getByRole("button", { name: "บันทึกมอนิเตอร์" }).click();
  await expect(
    page.getByRole("heading", { name: thresholdName }),
  ).toBeVisible();
  const m1 = await monitorIdByName(thresholdName);

  const session = await signInApi(owner);
  const read1 = await session.request("GET", monitorPath(org, `/${m1}`));
  expect(read1.status).toBe(200);
  expect((read1.body as MonitorBody).monitor.alerts.failureThreshold).toBe(3);

  // Monitor 2: created through the API with default alerts, target still up.
  const create2 = await session.request("POST", monitorPath(org), {
    ...basicConfig(toggleName, urlOf(targetToggle, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(create2.status).toBe(201);
  const m2 = (create2.body as MonitorBody).monitor.id;

  // Turn its down/recovery toggle off through the Edit form before it ever fails.
  await page.goto(`/organizations/${org}/monitors/${m2}/edit`);
  await expect(
    page.getByRole("heading", { name: `แก้ไข ${toggleName}` }),
  ).toBeVisible();
  await page.getByLabel("แจ้งเมื่อล่มและกลับมาปกติ").uncheck();
  await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await expect(page.getByText("บันทึกการแก้ไขแล้ว")).toBeVisible();
  const read2Before = await session.request("GET", monitorPath(org, `/${m2}`));
  expect((read2Before.body as MonitorBody).monitor.alerts.downEnabled).toBe(
    false,
  );

  // Only now does monitor 2's target start failing, so the Edit cannot race the incident.
  targetToggle.setMode("down");

  // Monitor 1: the incident and MONITOR_DOWN must land at the third failure, not the second.
  await waitFor(
    async () => (await openIncident(m1)) !== null,
    240_000,
    "monitor 1 (threshold 3) incident",
  );
  const incident1 = await openIncident(m1);
  const incidentCount1 = await pool.query<{ n: number }>(
    "select count(*)::int as n from monitor_incidents where monitor_id = $1",
    [m1],
  );
  expect(incidentCount1.rows[0]!.n).toBe(1);
  const passCount1 = await pool.query<{ n: number }>(
    "select count(*)::int as n from monitor_check_results where monitor_id = $1 and outcome = 'pass'",
    [m1],
  );
  expect(passCount1.rows[0]!.n).toBe(0);
  const failUpToOpen1 = await pool.query<{ n: number }>(
    `select count(*)::int as n from monitor_check_results
      where monitor_id = $1 and outcome = 'fail' and checked_at <= $2`,
    [m1, incident1!.started_at],
  );
  expect(failUpToOpen1.rows[0]!.n).toBe(3);
  // `down_notified` is set in the same transaction as the incident row, so a
  // row that exists already carries the final value of this run.
  expect(incident1!.down_notified).toBe(true);

  // The pipeline is live: monitor 1's MONITOR_DOWN reaches the inbox.
  await waitFor(
    async () => (await countInbox(m1, "MONITOR_DOWN")) === 1,
    60_000,
    "monitor 1 MONITOR_DOWN reaching the inbox",
  );

  // Monitor 2: the incident still opens (threshold is independent of the toggle),
  // but its own toggle kept MONITOR_DOWN from ever being written.
  await waitFor(
    async () => (await openIncident(m2)) !== null,
    180_000,
    "monitor 2 incident despite its down toggle being off",
  );
  const incident2 = await openIncident(m2);
  expect(incident2!.down_notified).toBe(false);
  expect(await countInbox(m2, "MONITOR_DOWN")).toBe(0);

  const read2After = await session.request("GET", monitorPath(org, `/${m2}`));
  expect((read2After.body as MonitorBody).monitor.health).toBe("down");
});
