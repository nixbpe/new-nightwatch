import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import {
  monitorDetailResponseSchema,
  monitorWriteResponseSchema,
} from "../../packages/api-contract/src/index.ts";
import { createDatabase } from "../../packages/db/src/index.ts";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  createProject,
  databaseOwnerUrl,
  monitorPath,
  monitorUrl,
  signInApi,
  targetHostname,
  type Person,
} from "../support/monitor-fixtures";

const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let host: string;
let org: string;
let project: string;
let owner: Person;
const userIds: string[] = [];
let targetThreshold: Target;
let targetToggle: Target;
const thresholdName = `alert-threshold-${run}`;
const toggleName = `alert-toggle-${run}`;

const urlOf = (server: Target, path: string) =>
  `http://${host}:${String(server.port)}${path}`;

type IncidentRow = { id: string; started_at: Date; down_notified: boolean };

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
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
  project = await createProject(pool, org, `E2E Alert Settings ${run}`);
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

test("a threshold of 3 opens the incident only at the third failure, and a monitor's own down toggle silences only that monitor", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  await signIn(page, owner);

  await page.goto(monitorUrl(org, project, "/new"));
  await page.getByTestId("monitor-form-name").fill(thresholdName);
  await page
    .getByTestId("monitor-form-url")
    .fill(urlOf(targetThreshold, "/health"));
  await page.getByTestId("monitor-form-interval-60").click();
  await page.getByTestId("monitor-form-alert-threshold").selectOption("3");
  const createdResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === monitorPath(org, project),
  );
  await page.getByTestId("monitor-form-save").click();
  const createdReply = await createdResponse;
  expect(createdReply.status()).toBe(201);
  const createdMonitor = monitorWriteResponseSchema.parse(
    await createdReply.json(),
  ).monitor;
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(
    thresholdName,
  );
  const m1 = createdMonitor.id;
  expect(createdMonitor.name).toBe(thresholdName);
  expect(createdMonitor.url).toBe(urlOf(targetThreshold, "/health"));
  expect(createdMonitor.intervalSeconds).toBe(60);
  expect(createdMonitor.version).toBe(1);

  const session = await signInApi(owner);
  const read1 = await session.request(
    "GET",
    monitorPath(org, project, `/${m1}`),
  );
  expect(read1.status).toBe(200);
  expect(monitorDetailResponseSchema.parse(read1.body).monitor.alerts).toEqual({
    failureThreshold: 3,
    downEnabled: true,
    sslEnabled: true,
    sslCautionDays: 30,
  });

  const create2 = await session.request("POST", monitorPath(org, project), {
    ...basicConfig(toggleName, urlOf(targetToggle, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(create2.status).toBe(201);
  const m2 = monitorWriteResponseSchema.parse(create2.body).monitor.id;

  await page.goto(monitorUrl(org, project, `/${m2}/edit`));
  await expect(page.getByTestId("monitor-form-name")).toHaveValue(toggleName);
  await page.getByTestId("monitor-form-alert-down").uncheck();
  await page.getByTestId("monitor-form-save").click();
  await expect(page.getByTestId("monitor-detail-notice")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(toggleName);
  const read2Before = await session.request(
    "GET",
    monitorPath(org, project, `/${m2}`),
  );
  const edited = monitorDetailResponseSchema.parse(read2Before.body).monitor;
  expect(edited.alerts).toEqual({
    failureThreshold: 2,
    downEnabled: false,
    sslEnabled: true,
    sslCautionDays: 30,
  });
  expect(edited.version).toBe(2);

  targetToggle.setMode("down");

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
  expect(incident1!.down_notified).toBe(true);

  await waitFor(
    async () => (await countInbox(m1, "MONITOR_DOWN")) === 1,
    60_000,
    "monitor 1 MONITOR_DOWN reaching the inbox",
  );

  await waitFor(
    async () => (await openIncident(m2)) !== null,
    180_000,
    "monitor 2 incident despite its down toggle being off",
  );
  const incident2 = await openIncident(m2);
  expect(incident2!.down_notified).toBe(false);
  expect(await countInbox(m2, "MONITOR_DOWN")).toBe(0);

  const read2After = await session.request(
    "GET",
    monitorPath(org, project, `/${m2}`),
  );
  expect(
    monitorDetailResponseSchema.parse(read2After.body).monitor.health,
  ).toBe("down");
});
