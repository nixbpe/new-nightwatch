import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import {
  monitorWriteResponseSchema,
  notificationListResponseSchema,
  type NotificationItem,
} from "../../packages/api-contract/src/index.ts";

import { createDatabase } from "../../packages/db/src/index.ts";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  addProjectMember,
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

// One Organization per run with an owner and a viewer, plus a second
// Organization the owner also belongs to. Every name carries the run id.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let target: Target;
let flapTarget: Target;
let host: string;
let orgA: string;
let orgB: string;
let projA: string;
let projB: string;
let owner: Person;
let viewer: Person;
let flapId: string;
let otherId: string;
let crudId: string;
const userIds: string[] = [];
const orgNames = { a: `E2E Monitors A ${run}`, b: `E2E Monitors B ${run}` };
const flapName = `flap-${run}`;
const crudName = `crud-${run}`;
const otherOrgMonitor = `other-org-${run}`;

const urlOf = (server: Target, path: string) =>
  `http://${host}:${String(server.port)}${path}`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/workspace/);
}

async function monitorCount(organizationId: string) {
  const result = await pool.query<{ n: number }>(
    "select count(*)::int as n from monitors where tenant_id = $1",
    [organizationId],
  );
  return result.rows[0]!.n;
}

test.beforeAll(async () => {
  host = targetHostname();
  target = await startMonitorTarget();
  flapTarget = await startMonitorTarget();
  flapTarget.setMode("down");

  orgA = await createOrganization(pool, orgNames.a);
  orgB = await createOrganization(pool, orgNames.b);
  owner = await createPerson(pool, "owner", orgA);
  viewer = await createPerson(pool, "viewer", orgA);
  userIds.push(owner.userId, viewer.userId);
  await addMember(pool, orgA, owner.userId, "owner");
  await addMember(pool, orgB, owner.userId, "owner");
  await addMember(pool, orgA, viewer.userId, "viewer");
  // Monitors live in a Project; the viewer reads one as a Project member.
  projA = await createProject(pool, orgA, `E2E Monitors A ${run}`);
  projB = await createProject(pool, orgB, `E2E Monitors B ${run}`);
  await addProjectMember(pool, orgA, projA, viewer.userId, "member");

  const session = await signInApi(owner);
  // Started first so its two failures and the recovery fit the suite's runtime.
  const flap = await session.request("POST", monitorPath(orgA, projA), {
    ...basicConfig(flapName, urlOf(flapTarget, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(flap.status).toBe(201);
  flapId = monitorWriteResponseSchema.parse(flap.body).monitor.id;
  const other = await session.request("POST", monitorPath(orgB, projB), {
    ...basicConfig(otherOrgMonitor, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(other.status).toBe(201);
  otherId = monitorWriteResponseSchema.parse(other.body).monitor.id;
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [orgA, orgB]);
  } finally {
    await database.close();
    await target.close();
    await flapTarget.close();
  }
});

test.describe.configure({ mode: "serial" });

test("owner tests a config before saving, sees pass and a failing target, then saves", async ({
  page,
}) => {
  const before = await monitorCount(orgA);
  await signIn(page, owner);
  await page.goto(`/organizations/${orgA}/projects/${projA}/monitors/new`);
  await page.getByTestId("monitor-form-name").fill(crudName);
  await page
    .getByTestId("monitor-form-url")
    .fill(urlOf(target, "/health?probe=1"));

  // Scheduled checks of other monitors also hit /health, so only the probe query counts.
  const probeHits = () =>
    target.hits.filter((h) => h.search === "?probe=1").length;
  const hitsBefore = probeHits();
  await page.getByTestId("monitor-form-test").click();
  await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
    "data-outcome",
    "pass",
  );
  await expect(page.getByTestId("monitor-test-result")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-test-result-url")).toHaveText(
    urlOf(target, "/health?probe=•••"),
  );
  await expect(page.getByTestId("monitor-test-http-status")).toHaveAttribute(
    "data-http-status",
    "200",
  );
  await expect(page.getByTestId("monitor-test-http-status")).toContainText(
    /\b200\b/,
  );
  expect(probeHits()).toBe(hitsBefore + 1);

  target.setMode("down");
  await page.getByTestId("monitor-form-test").click();
  await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
    "data-outcome",
    "fail",
  );
  await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
    "data-failure-reason",
    "http_status",
  );
  await expect(page.getByTestId("monitor-test-result")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-test-http-status")).toHaveAttribute(
    "data-http-status",
    "503",
  );
  await expect(page.getByTestId("monitor-test-http-status")).toContainText(
    /\b503\b/,
  );
  // A Test never creates a monitor (AC-08) and does not block saving (AC-54).
  expect(await monitorCount(orgA)).toBe(before);

  target.setMode("up");
  // A slow first answer keeps the monitor waiting long enough to be seen (AC-54).
  target.setDelay(4000);
  const createdResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === monitorPath(orgA, projA) &&
      response.request().method() === "POST",
  );
  await page.getByTestId("monitor-form-save").click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const record = monitorWriteResponseSchema.parse(await created.json()).monitor;
  crudId = record.id;
  expect(record).toMatchObject({
    name: crudName,
    url: urlOf(target, "/health?probe=1"),
    method: "GET",
    headers: [],
    queryParams: [],
    body: null,
    expectedStatus: "200-299",
    assertions: [],
    auth: { type: "none" },
    secretSlots: [],
    status: "active",
    version: 1,
  });
  await expect(page).toHaveURL(
    `/organizations/${orgA}/projects/${projA}/monitors/${crudId}`,
  );
  await expect(page.getByTestId("monitor-detail-url")).toHaveText(
    urlOf(target, "/health?probe=1"),
  );
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(crudName);
  await expect
    .poll(() => page.evaluate(() => window.history.state?.usr))
    .toBeNull();
  await expect(page.getByTestId("monitor-detail-notice")).toBeVisible();
  await expect(page.getByTestId("monitor-detail-notice")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-detail-title")).toBeFocused();
  await expect(page.getByTestId("monitor-detail-first-check")).toBeVisible();
  await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
    "data-health",
    "unknown",
  );
  await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
    "data-last-check-at",
    "",
  );
  target.setDelay(0);
  expect(await monitorCount(orgA)).toBe(before + 1);
});

test("owner sees the first result within a scheduler poll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, owner);
  await page.goto(`/organizations/${orgA}/projects/${projA}/monitors`);
  const row = page.getByTestId(`monitor-list-row-${crudId}`);
  await expect(row).toBeVisible();
  // The scheduler polls every 10 s; the list refetches on its own.
  await expect(row.getByTestId("monitor-list-health")).toHaveAttribute(
    "data-health",
    "up",
    { timeout: 60_000 },
  );
  await expect(row.getByTestId("monitor-list-health")).toHaveText(/\S/);
  await expect(row.getByTestId(`monitor-list-name-${crudId}`)).toHaveText(
    crudName,
  );
  await row.getByTestId(`monitor-list-name-${crudId}`).click();
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(crudName);
  await expect(page.getByTestId("monitor-detail-first-check")).toHaveCount(0);
});

test("owner pauses, resumes and deletes the monitor", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, owner);
  await page.goto(`/organizations/${orgA}/projects/${projA}/monitors`);
  await page
    .getByTestId(`monitor-list-row-${crudId}`)
    .getByTestId(`monitor-list-name-${crudId}`)
    .click();
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(crudName);

  const hitsBefore = target.hitsFor("/health").length;
  await page.getByTestId("monitor-detail-toggle").click();
  await expect(page.getByTestId("monitor-detail-notice")).toBeVisible();
  await expect(page.getByTestId("monitor-detail-notice")).toHaveText(/\S/);
  const resume = page.getByTestId("monitor-detail-toggle");
  await expect(resume).toBeVisible();
  await expect(resume).toBeFocused();
  await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
    "data-health",
    "paused",
  );
  await expect(page.getByTestId("monitor-detail-health")).toHaveText(/\S/);
  await expect(resume).toHaveAttribute("data-status", "paused");

  await resume.click();
  await expect(page.getByTestId("monitor-detail-notice")).toBeVisible();
  await expect(page.getByTestId("monitor-detail-notice")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-detail-toggle")).toHaveAttribute(
    "data-status",
    "active",
  );
  await expect
    .poll(() => target.hitsFor("/health").length, { timeout: 45_000 })
    .toBeGreaterThan(hitsBefore);

  await page.getByTestId("monitor-detail-delete").click();
  const dialog = page.getByTestId("monitor-detail-delete-dialog");
  await expect(dialog.getByTestId("confirmation-cancel")).toBeFocused();
  await dialog.getByTestId("monitor-detail-delete-confirm").click();
  await expect(page).toHaveURL(
    new RegExp(`/organizations/${orgA}/projects/${projA}/monitors$`),
  );
  await expect(page.getByTestId("monitor-overview-notice")).toBeVisible();
  await expect(page.getByTestId("monitor-overview-notice")).toHaveText(/\S/);
  await expect(page.getByTestId(`monitor-list-name-${crudId}`)).toHaveCount(0);
  expect(
    (await pool.query("select 1 from monitors where name = $1", [crudName]))
      .rowCount,
  ).toBe(0);
});

test("viewer reads Overview and Detail and sees no action", async ({
  page,
}) => {
  await signIn(page, viewer);
  await page.goto(`/organizations/${orgA}/projects/${projA}/monitors`);
  const link = page.getByTestId(`monitor-list-name-${flapId}`);
  await expect(link).toBeVisible();
  await expect(page.getByTestId("monitor-overview-readonly")).toBeVisible();
  await expect(link).toHaveText(flapName);
  await expect(page.getByTestId("monitor-overview-add")).toHaveCount(0);
  await link.click();
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(flapName);
  for (const action of [
    "monitor-detail-edit",
    "monitor-detail-toggle",
    "monitor-detail-delete",
  ]) {
    await expect(page.getByTestId(action)).toHaveCount(0);
  }
  await expect(page.getByTestId("monitor-detail-read-only")).toHaveAttribute(
    "data-role",
    "member",
  );

  // Direct routes and requests are refused, and nothing reaches the target.
  const hits = flapTarget.hits.length;
  await page.goto(`/organizations/${orgA}/projects/${projA}/monitors/new`);
  await expect(page.getByTestId("monitor-form-save")).toHaveCount(0);
  const session = await signInApi(viewer);
  const created = await session.request("POST", monitorPath(orgA, projA), {
    ...basicConfig(`viewer-${run}`, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  const tested = await session.request(
    "POST",
    monitorPath(orgA, projA, "/test"),
    basicConfig(`viewer-${run}`, urlOf(flapTarget, "/health")),
  );
  expect([created.status, tested.status]).toEqual([403, 403]);
  expect(flapTarget.hits.length).toBe(hits);
});

test("Organization switch leaves Overview, Detail and the form for the new Organization's Projects", async ({
  page,
}) => {
  await signIn(page, owner);
  const switchTo = async (organizationId: string) => {
    await page.getByTestId("shell-organization-switch").click();
    await page
      .getByTestId("shell-organization-menu")
      .getByTestId(`shell-organization-${organizationId}`)
      .click();
  };

  await page.goto(monitorUrl(orgA, projA));
  await expect(page.getByTestId(`monitor-list-name-${flapId}`)).toBeVisible();
  await switchTo(orgB);
  // A Project belongs to one Organization, so the page leaves for the new one's Projects.
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgB}/projects$`));
  await expect(page.getByTestId("shell-main")).not.toContainText(flapName);

  await page.goto(monitorUrl(orgB, projB));
  await expect(page.getByTestId(`monitor-list-name-${otherId}`)).toBeVisible();
  await expect(page.getByTestId(`monitor-list-name-${flapId}`)).toHaveCount(0);

  await page.goto(monitorUrl(orgB, projB, "/new"));
  await page.getByTestId("monitor-form-name").fill("typed in B");
  await switchTo(orgA);
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgA}/projects$`));
  await expect(page.getByTestId("monitor-form-name")).toHaveCount(0);

  await page.goto(monitorUrl(orgA, projA));
  await page.getByTestId(`monitor-list-name-${flapId}`).click();
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(flapName);
  await switchTo(orgB);
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgB}/projects$`));
  await expect(page.getByTestId("shell-main")).not.toContainText(flapName);
});

// The inbox has no live refresh, so the page is reloaded until the item shows.
async function waitForInboxItem(
  page: Page,
  eventType: "MONITOR_DOWN" | "MONITOR_RECOVERED",
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  const seen: string[] = [];
  for (;;) {
    await page.goto("/notifications");
    try {
      let notification: NotificationItem | undefined;
      await expect
        .poll(
          async () => {
            const response = await page.request.get("/api/notifications");
            expect(response.status()).toBe(200);
            const body = notificationListResponseSchema.parse(
              await response.json(),
            );
            expect(body.organizationId).toBe(orgA);
            const matches = body.items.filter(
              (item) =>
                item.scope === "organization" &&
                item.category === "monitor" &&
                item.subject.monitorId === flapId &&
                item.eventType === eventType,
            );
            expect(matches.length).toBeLessThanOrEqual(1);
            notification = matches.pop();
            return notification?.id ?? null;
          },
          { timeout: 10_000 },
        )
        .not.toBeNull();
      if (notification === undefined)
        throw new Error("Notification not published");
      const row = page.getByTestId(`notification-row-${notification.id}`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toHaveAttribute("data-event-type", eventType);
      await expect(row.getByTestId("notification-title")).toContainText(
        flapName,
      );
      await expect(
        row.getByTestId("notification-monitor-link"),
      ).toHaveAttribute(
        "href",
        `/organizations/${orgA}/projects/${projA}/monitors/${flapId}`,
      );
      return notification.id;
    } catch {
      const response = await page.request.get("/api/notifications");
      const body = notificationListResponseSchema.parse(await response.json());
      seen.push(`${String(response.status())}:${String(body.items.length)}`);
    }
    if (Date.now() > deadline) {
      const state = await pool.query(
        `select inbox.recipient_user_id = $2 as owner_is_recipient,
                inbox.event_type, ledger.status as dispatch_status,
                inbox.expires_at > now() as unexpired
           from notification_inbox_items as inbox
           left join notification_dispatch_ledger as ledger
             on ledger.intent_id = inbox.intent_id
          where inbox.tenant_id = $1`,
        [orgA, owner.userId],
      );
      throw new Error(
        `inbox never showed ${eventType}: ${JSON.stringify(state.rows)} history=${seen.join(",")}`,
      );
    }
  }
}

test("a target that goes down and comes back reaches the inbox once each", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  // The Organization switch test leaves the owner active in B; the inbox shows
  // the active Organization only.
  await pool.query(
    'update "user" set last_active_tenant_id = $2 where id = $1',
    [owner.userId, orgA],
  );
  await signIn(page, owner);
  const downId = await waitForInboxItem(page, "MONITOR_DOWN", 5 * 60_000);
  const downTitle = await page
    .getByTestId(`notification-row-${downId}`)
    .getByTestId("notification-title")
    .innerText();

  flapTarget.setMode("up");
  const recoveredId = await waitForInboxItem(
    page,
    "MONITOR_RECOVERED",
    5 * 60_000,
  );
  await expect(page.getByTestId(`notification-row-${downId}`)).toHaveCount(1);
  await expect(
    page
      .getByTestId(`notification-row-${recoveredId}`)
      .getByTestId("notification-title"),
  ).not.toHaveText(downTitle);

  // AC-05: the Organization's Owner and the Project's member each get one item per event, never two.
  const counts = await pool.query<{
    recipient_user_id: string;
    event_type: string;
    n: number;
  }>(
    `select recipient_user_id, event_type, count(*)::int as n from notification_inbox_items
      where tenant_id = $1 and event_type in ('MONITOR_DOWN', 'MONITOR_RECOVERED')
      group by recipient_user_id, event_type`,
    [orgA],
  );
  const perPerson = (userId: string) =>
    Object.fromEntries(
      counts.rows
        .filter((r) => r.recipient_user_id === userId)
        .map((r) => [r.event_type, r.n]),
    );
  expect(perPerson(owner.userId)).toEqual({
    MONITOR_DOWN: 1,
    MONITOR_RECOVERED: 1,
  });
  expect(perPerson(viewer.userId)).toEqual({
    MONITOR_DOWN: 1,
    MONITOR_RECOVERED: 1,
  });
});

test("a notification of a deleted monitor stays and its link reads as not found", async ({
  page,
}) => {
  const flap = await pool.query<{ id: string }>(
    "select id from monitors where tenant_id = $1 and name = $2",
    [orgA, flapName],
  );
  const session = await signInApi(owner);
  const removed = await session.request(
    "DELETE",
    monitorPath(orgA, projA, `/${flap.rows[0]!.id}`),
  );
  expect(removed.status).toBeLessThan(300);
  await pool.query(
    'update "user" set last_active_tenant_id = $2 where id = $1',
    [owner.userId, orgA],
  );
  await signIn(page, owner);
  await page.goto("/notifications");
  const downId = await waitForInboxItem(page, "MONITOR_DOWN", 10_000);
  await page
    .getByTestId(`notification-row-${downId}`)
    .getByTestId("notification-monitor-link")
    .click();
  await expect(page).toHaveURL(
    `/organizations/${orgA}/projects/${projA}/monitors/${flapId}`,
  );
  await expect(page.getByTestId("monitor-detail-not-found")).toBeVisible();
  await expect(page.getByTestId("monitor-detail-not-found")).toHaveText(/\S/);
});

test("Resume shows unknown until a new result arrives", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const session = await signInApi(owner);
  const created = await session.request("POST", monitorPath(orgA, projA), {
    ...basicConfig(`resume-${run}`, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(created.status).toBe(201);
  const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
  const detail = `/organizations/${orgA}/projects/${projA}/monitors/${id}`;
  await signIn(page, owner);
  await page.goto(detail);
  await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
    "data-health",
    "up",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("monitor-detail-health")).toHaveText(/\S/);
  const upText = await page.getByTestId("monitor-detail-health").innerText();

  // A slow answer keeps the first check after Resume pending, so the page
  // cannot show a new result yet.
  target.setDelay(8000);
  await page.getByTestId("monitor-detail-toggle").click();
  await expect(page.getByTestId("monitor-detail-toggle")).toHaveAttribute(
    "data-status",
    "paused",
  );
  await expect(page.getByTestId("monitor-detail-toggle")).toHaveAttribute(
    "data-in-progress",
    "false",
  );
  await page.getByTestId("monitor-detail-toggle").click();
  await expect(page.getByTestId("monitor-detail-notice")).toBeVisible();
  await expect(page.getByTestId("monitor-detail-notice")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-detail-toggle")).toHaveAttribute(
    "data-status",
    "active",
  );
  // The last result predates the pause, so it must not read as "ปกติ".
  await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
    "data-health",
    "unknown",
  );
  await expect(page.getByTestId("monitor-detail-health")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-detail-health")).not.toHaveText(
    upText,
  );
  target.setDelay(0);
});
