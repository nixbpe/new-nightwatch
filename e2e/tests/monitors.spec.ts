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
let owner: Person;
let viewer: Person;
const userIds: string[] = [];
const orgNames = { a: `E2E Monitors A ${run}`, b: `E2E Monitors B ${run}` };
const flapName = `flap-${run}`;
const crudName = `crud-${run}`;
const otherOrgMonitor = `other-org-${run}`;

const urlOf = (server: Target, path: string) =>
  `http://${host}:${String(server.port)}${path}`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(person.email);
  await page.locator("#login-password").fill(person.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
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

  const session = await signInApi(owner);
  // Started first so its two failures and the recovery fit the suite's runtime.
  const flap = await session.request("POST", monitorPath(orgA), {
    ...basicConfig(flapName, urlOf(flapTarget, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(flap.status).toBe(201);
  const other = await session.request("POST", monitorPath(orgB), {
    ...basicConfig(otherOrgMonitor, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(other.status).toBe(201);
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
  await page.goto(`/organizations/${orgA}/monitors/new`);
  await page.getByLabel("ชื่อมอนิเตอร์").fill(crudName);
  await page.getByLabel("URL", { exact: true }).fill(urlOf(target, "/health"));

  const hitsBefore = target.hitsFor("/health").length;
  await page.getByRole("button", { name: "ทดสอบการตั้งค่า" }).click();
  await expect(page.getByText("การทดสอบผ่าน")).toBeVisible();
  await expect(page.getByText("รหัสสถานะ 200")).toBeVisible();
  expect(target.hitsFor("/health").length).toBe(hitsBefore + 1);

  target.setMode("down");
  await page.getByRole("button", { name: "ทดสอบการตั้งค่า" }).click();
  await expect(page.getByText(/^ไม่ผ่าน:/)).toBeVisible();
  await expect(page.getByText("รหัสสถานะ 503")).toBeVisible();
  // A Test never creates a monitor (AC-08) and does not block saving (AC-54).
  expect(await monitorCount(orgA)).toBe(before);

  target.setMode("up");
  await page.getByRole("button", { name: "บันทึกมอนิเตอร์" }).click();
  await expect(page.getByRole("heading", { name: crudName })).toBeVisible();
  await expect(page.getByText("สร้างมอนิเตอร์แล้ว")).toBeVisible();
  expect(await monitorCount(orgA)).toBe(before + 1);
});

test("owner sees the first result within a scheduler poll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, owner);
  await page.goto(`/organizations/${orgA}/monitors`);
  const row = page.getByRole("row", { name: new RegExp(crudName) });
  await expect(row).toBeVisible();
  // The scheduler polls every 10 s; the list refetches on its own.
  await expect(row.getByText("ปกติ")).toBeVisible({ timeout: 60_000 });
  await row.getByRole("link", { name: crudName }).click();
  await expect(page.getByRole("heading", { name: crudName })).toBeVisible();
  await expect(page.getByText("รอตรวจครั้งแรก")).toHaveCount(0);
});

test("owner pauses, resumes and deletes the monitor", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, owner);
  await page.goto(`/organizations/${orgA}/monitors`);
  await page
    .getByRole("row", { name: new RegExp(crudName) })
    .getByRole("link", { name: crudName })
    .click();
  await expect(page.getByRole("heading", { name: crudName })).toBeVisible();

  const hitsBefore = target.hitsFor("/health").length;
  await page.getByRole("button", { name: "หยุดชั่วคราว" }).click();
  await expect(page.getByText("หยุดการตรวจแล้ว")).toBeVisible();
  const resume = page.getByRole("button", { name: "เริ่มต่อ" });
  await expect(resume).toBeVisible();
  await expect(resume).toBeFocused();
  await expect(page.getByText("หยุดชั่วคราว").first()).toBeVisible();

  await resume.click();
  await expect(page.getByText("เริ่มการตรวจต่อแล้ว")).toBeVisible();
  await expect
    .poll(() => target.hitsFor("/health").length, { timeout: 45_000 })
    .toBeGreaterThan(hitsBefore);

  await page.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลบมอนิเตอร์" });
  await expect(dialog.getByRole("button", { name: "ยกเลิก" })).toBeFocused();
  await dialog.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgA}/monitors$`));
  await expect(page.getByText("ลบมอนิเตอร์แล้ว")).toBeVisible();
  await expect(page.getByRole("link", { name: crudName })).toHaveCount(0);
  expect(
    (await pool.query("select 1 from monitors where name = $1", [crudName]))
      .rowCount,
  ).toBe(0);
});

test("viewer reads Overview and Detail and sees no action", async ({
  page,
}) => {
  await signIn(page, viewer);
  await page.goto(`/organizations/${orgA}/monitors`);
  const link = page.getByRole("link", { name: flapName });
  await expect(link).toBeVisible();
  await expect(page.getByText("สิทธิ์ของคุณ: ดูอย่างเดียว")).toBeVisible();
  await expect(page.getByRole("link", { name: "เพิ่มมอนิเตอร์" })).toHaveCount(
    0,
  );
  await link.click();
  await expect(page.getByRole("heading", { name: flapName })).toBeVisible();
  for (const name of ["แก้ไข", "หยุดชั่วคราว", "ลบมอนิเตอร์"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }

  // Direct routes and requests are refused, and nothing reaches the target.
  const hits = flapTarget.hits.length;
  await page.goto(`/organizations/${orgA}/monitors/new`);
  await expect(
    page.getByRole("button", { name: "บันทึกมอนิเตอร์" }),
  ).toHaveCount(0);
  const session = await signInApi(viewer);
  const created = await session.request("POST", monitorPath(orgA), {
    ...basicConfig(`viewer-${run}`, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  const tested = await session.request(
    "POST",
    monitorPath(orgA, "/test"),
    basicConfig(`viewer-${run}`, urlOf(flapTarget, "/health")),
  );
  expect([created.status, tested.status]).toEqual([403, 403]);
  expect(flapTarget.hits.length).toBe(hits);
});

test("Organization switch leaves Overview, Detail and the form for the new Organization", async ({
  page,
}) => {
  await signIn(page, owner);
  const switchTo = async (name: string, current: string) => {
    await page
      .getByRole("button", { name: new RegExp(current) })
      .first()
      .click();
    await page.getByRole("menuitemradio", { name: new RegExp(name) }).click();
  };

  await page.goto(`/organizations/${orgA}/monitors`);
  await expect(page.getByRole("link", { name: flapName })).toBeVisible();
  await switchTo(orgNames.b, orgNames.a);
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgB}/monitors$`));
  await expect(page.getByRole("link", { name: otherOrgMonitor })).toBeVisible();
  await expect(page.getByRole("link", { name: flapName })).toHaveCount(0);

  await page.goto(`/organizations/${orgB}/monitors/new`);
  await page.getByLabel("ชื่อมอนิเตอร์").fill("typed in B");
  await switchTo(orgNames.a, orgNames.b);
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgA}/monitors$`));

  await page.getByRole("link", { name: flapName }).click();
  await expect(page.getByRole("heading", { name: flapName })).toBeVisible();
  await switchTo(orgNames.b, orgNames.a);
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgB}/monitors$`));
  await expect(page.getByText(flapName)).toHaveCount(0);
});

// The inbox has no live refresh, so the page is reloaded until the item shows.
async function waitForInboxItem(page: Page, text: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const seen: string[] = [];
  for (;;) {
    await page.goto("/notifications");
    try {
      await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });
      return;
    } catch {
      // Not delivered yet; the next loop reloads the page.
      const api = await page.evaluate(async () => {
        const reply = await fetch("/api/notifications");
        const body = (await reply.json()) as { items?: unknown[] };
        return `${String(reply.status)}:${String(body.items?.length)}`;
      });
      seen.push(api);
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
      const listed = await page.evaluate(async () =>
        (await fetch("/api/notifications")).json(),
      );
      throw new Error(
        `inbox never showed "${text}": ${JSON.stringify(state.rows)} listed=${JSON.stringify(listed)} history=${seen.join(",")}`,
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
  await waitForInboxItem(page, `มอนิเตอร์ ${flapName} ล่ม`, 5 * 60_000);

  flapTarget.setMode("up");
  await waitForInboxItem(
    page,
    `มอนิเตอร์ ${flapName} กลับมาทำงานแล้ว`,
    5 * 60_000,
  );
  await expect(page.getByText(`มอนิเตอร์ ${flapName} ล่ม`)).toHaveCount(1);

  const counts = await pool.query<{ event_type: string; n: number }>(
    `select event_type, count(*)::int as n from notification_inbox_items
      where tenant_id = $1 and event_type in ('MONITOR_DOWN', 'MONITOR_RECOVERED')
      group by event_type`,
    [orgA],
  );
  expect(
    Object.fromEntries(counts.rows.map((r) => [r.event_type, r.n])),
  ).toEqual({ MONITOR_DOWN: 1, MONITOR_RECOVERED: 1 });
});

test("a notification of a deleted monitor stays and its link reads as not found (AC-19, AC-52)", async ({
  page,
}) => {
  const flap = await pool.query<{ id: string }>(
    "select id from monitors where tenant_id = $1 and name = $2",
    [orgA, flapName],
  );
  const session = await signInApi(owner);
  const removed = await session.request(
    "DELETE",
    monitorPath(orgA, `/${flap.rows[0]!.id}`),
  );
  expect(removed.status).toBeLessThan(300);
  await pool.query(
    'update "user" set last_active_tenant_id = $2 where id = $1',
    [owner.userId, orgA],
  );
  await signIn(page, owner);
  await page.goto("/notifications");
  await expect(page.getByText(`มอนิเตอร์ ${flapName} ล่ม`)).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(`เปิดมอนิเตอร์.*${flapName}`) })
    .first()
    .click();
  await expect(page.getByText("ไม่พบมอนิเตอร์นี้")).toBeVisible();
});

test("Resume shows unknown until a new result arrives (AC-19)", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const session = await signInApi(owner);
  const created = await session.request("POST", monitorPath(orgA), {
    ...basicConfig(`resume-${run}`, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  const id = (created.body as { monitor: { id: string } }).monitor.id;
  const detail = `/organizations/${orgA}/monitors/${id}`;
  await signIn(page, owner);
  await page.goto(detail);
  await expect(page.getByText("ปกติ", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // A slow answer keeps the first check after Resume pending, so the page
  // cannot show a new result yet.
  target.setDelay(8000);
  await page.getByRole("button", { name: "หยุดชั่วคราว" }).click();
  await page.getByRole("button", { name: "เริ่มต่อ" }).click();
  await expect(page.getByText("เริ่มการตรวจต่อแล้ว")).toBeVisible();
  // The last result predates the pause, so it must not read as "ปกติ".
  await expect(page.getByText("ไม่ทราบสถานะ", { exact: true })).toBeVisible();
  await expect(page.getByText("ปกติ", { exact: true })).toHaveCount(0);
  target.setDelay(0);
});
