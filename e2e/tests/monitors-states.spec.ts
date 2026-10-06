import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { monitorResponseTimesResponseSchema } from "../../packages/api-contract/src/monitor.ts";
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
  shot,
  signInApi,
  targetHostname,
  type ApiSession,
  type Person,
  type Role,
} from "../support/monitor-fixtures";

// Browser evidence for the scope, state and concurrency rows that need no long
// schedule wait: AC-01, AC-04, AC-06, AC-07, AC-09, AC-10, AC-18, AC-40, AC-50.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let target: Target;
let host: string;
let orgA: string;
let orgEmpty: string;
let orgOther: string;
let owner: Person;
let ownerSession: ApiSession;
let monitorId: string;
let otherMonitorId: string;
const people = {} as Record<Role, Person>;
const userIds: string[] = [];
// Organizations that single tests create; the afterAll removes them even when a test fails.
const extraOrgs: string[] = [];
const monitorName = `states-${run}`;

const urlOf = (path: string) => `http://${host}:${String(target.port)}${path}`;
const overview = () => `/organizations/${orgA}/monitors`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(person.email);
  await page.locator("#login-password").fill(person.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
}

test.beforeAll(async () => {
  host = targetHostname();
  target = await startMonitorTarget();
  orgA = await createOrganization(pool, `E2E States A ${run}`);
  orgEmpty = await createOrganization(pool, `E2E States Empty ${run}`);
  orgOther = await createOrganization(pool, `E2E States Other ${run}`);
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    people[role] = await createPerson(pool, role, orgA);
    userIds.push(people[role].userId);
    await addMember(pool, orgA, people[role].userId, role);
  }
  owner = people.owner;
  await addMember(pool, orgEmpty, owner.userId, "owner");
  await addMember(pool, orgOther, owner.userId, "owner");
  ownerSession = await signInApi(owner);
  const created = await ownerSession.request("POST", monitorPath(orgA), {
    ...basicConfig(monitorName, urlOf("/health")),
    clientRequestId: randomUUID(),
  });
  monitorId = (created.body as { monitor: { id: string } }).monitor.id;
  const other = await ownerSession.request("POST", monitorPath(orgOther), {
    ...basicConfig(`foreign-${run}`, urlOf("/health")),
    clientRequestId: randomUUID(),
  });
  otherMonitorId = (other.body as { monitor: { id: string } }).monitor.id;
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [orgA, orgEmpty, orgOther, ...extraOrgs]);
  } finally {
    await database.close();
    await target.close();
  }
});

test.describe("leaf in the sidebar and the command palette", () => {
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    test(`${role}: leaf is present, active on every sub-route, found by the palette`, async ({
      page,
    }) => {
      await signIn(page, people[role]);
      const nav = page.getByRole("navigation", { name: "เมนูหลัก" });
      for (const path of ["", "/new", `/${monitorId}`, `/${monitorId}/edit`]) {
        await page.goto(`${overview()}${path}`);
        const leaf = nav.getByRole("link", { name: "ตรวจสถานะบริการ" });
        await expect(leaf).toBeVisible();
        await expect(leaf).toHaveAttribute("aria-current", "page");
        await expect(leaf).toHaveAttribute("href", overview());
      }
      await page.goto("/workspace");
      await expect(nav).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.getByRole("dialog", { name: "ค้นหาทั้งหมด" });
      await expect(palette).toBeVisible();
      await palette
        .getByRole("combobox", { name: "ค้นหาทั้งหมด" })
        .fill("ตรวจสถานะ");
      await expect(
        palette.getByRole("option", { name: /ตรวจสถานะบริการ/ }),
      ).toBeVisible();
    });
  }
});

test.describe("Overview states", () => {
  test("first-run empty, filtered empty, loading, error with retry, stale warning", async ({
    page,
  }) => {
    await signIn(page, owner);

    await page.goto(`/organizations/${orgEmpty}/monitors`);
    await expect(page.getByText("ยังไม่มีมอนิเตอร์")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "เพิ่มมอนิเตอร์" }).first(),
    ).toBeVisible();

    const listUrl = /\/api\/organizations\/[^/]+\/monitors(\?.*)?$/;
    let failList = true;
    let delayMs = 1500;
    await page.route(listUrl, async (route) => {
      if (failList) {
        await route.abort();
        return;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
    await page.goto(overview());
    // A failed load is an error with a retry, never an empty list.
    await expect(page.getByText("โหลดมอนิเตอร์ไม่สำเร็จ")).toBeVisible();
    await expect(page.getByText("ยังไม่มีมอนิเตอร์")).toHaveCount(0);
    failList = false;
    await page.getByRole("button", { name: /ลองใหม่|ลองอีกครั้ง/ }).click();
    await expect(page.getByRole("link", { name: monitorName })).toBeVisible();

    await page.getByLabel("ค้นหาชื่อหรือ URL").fill(`no-such-${run}`);
    await expect(
      page.getByText("ไม่พบมอนิเตอร์ที่ตรงกับตัวกรอง"),
    ).toBeVisible();
    await page.getByLabel("ค้นหาชื่อหรือ URL").fill("");
    await expect(page.getByRole("link", { name: monitorName })).toBeVisible();

    // Loading: a slow list shows the loading state first.
    delayMs = 6000;
    // "commit" returns before the dev server finishes loading modules, which can
    // outlast the delay and hide the loading state.
    await page.reload({ waitUntil: "commit" });
    // The route loader fetches the list first, so the shell shows its page-opening status.
    await expect(page.getByRole("status").first()).toContainText(
      /กำลัง(เปิดหน้า|โหลดมอนิเตอร์)/,
    );
    await expect(page.getByRole("link", { name: monitorName })).toBeVisible({
      timeout: 15_000,
    });

    // Stale: a refresh that fails keeps the data and warns.
    delayMs = 0;
    failList = true;
    await page.getByRole("button", { name: "รีเฟรช" }).click();
    await expect(
      page.getByText(/อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ/),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: monitorName })).toBeVisible();
  });
});

test.describe("create form", () => {
  test("defaults, mode switch keeps values, validation beside the field, one monitor on a double click", async ({
    page,
  }) => {
    await signIn(page, owner);
    await page.goto(`${overview()}/new`);
    const group = page.getByRole("radiogroup", { name: "ตรวจทุก" });
    await expect(group.getByRole("radio", { checked: true })).toHaveText(
      "5 นาที",
    );
    await expect(group.getByRole("radio")).toHaveText([
      "1 นาที",
      "5 นาที",
      "15 นาที",
    ]);
    await expect(
      page.getByText("ถือว่าปกติเมื่อได้รหัส 200-299"),
    ).toBeVisible();

    await page.getByRole("button", { name: "บันทึกมอนิเตอร์" }).click();
    await expect(page.getByLabel("ชื่อมอนิเตอร์")).toBeFocused();
    await expect(
      page.getByLabel("URL", { exact: true }),
    ).toHaveAccessibleDescription(/.+/);

    await page.getByLabel("ชื่อมอนิเตอร์").fill(`double-${run}`);
    await page.getByLabel("URL", { exact: true }).fill(urlOf("/health"));
    await group.getByRole("radio", { name: "15 นาที" }).click();
    await page.getByRole("radio", { name: "ขั้นสูง" }).click();
    await page.getByRole("radio", { name: "พื้นฐาน" }).click();
    await expect(page.getByLabel("ชื่อมอนิเตอร์")).toHaveValue(`double-${run}`);
    await expect(page.getByLabel("URL", { exact: true })).toHaveValue(
      urlOf("/health"),
    );
    await expect(group.getByRole("radio", { checked: true })).toHaveText(
      "15 นาที",
    );

    const save = page.getByRole("button", { name: "บันทึกมอนิเตอร์" });
    await save.dblclick();
    await expect(
      page.getByRole("heading", { name: `double-${run}` }),
    ).toBeVisible();
    const count = await pool.query(
      "select count(*)::int n from monitors where tenant_id = $1 and name = $2",
      [orgA, `double-${run}`],
    );
    expect(count.rows[0].n).toBe(1);
  });

  test("a forbidden address is refused beside the URL field without any connection", async ({
    page,
  }) => {
    const isolatedTarget = await startMonitorTarget();
    try {
      await signIn(page, owner);
      await page.goto(`${overview()}/new`);
      const before = isolatedTarget.hits.length;
      await page.getByLabel("ชื่อมอนิเตอร์").fill(`forbidden-${run}`);
      await page
        .getByLabel("URL", { exact: true })
        .fill(`http://localhost:${String(isolatedTarget.port)}/health`);
      await page.getByRole("button", { name: "บันทึกมอนิเตอร์" }).click();
      await expect(
        page.getByText("ที่อยู่นี้ไม่อนุญาตให้ตรวจสอบ"),
      ).toBeVisible();
      await expect(page.getByLabel("URL", { exact: true })).toHaveValue(
        `http://localhost:${String(isolatedTarget.port)}/health`,
      );
      const count = await pool.query(
        "select count(*)::int n from monitors where tenant_id = $1 and name = $2",
        [orgA, `forbidden-${run}`],
      );
      expect(count.rows[0].n).toBe(0);
      expect(isolatedTarget.hits.length).toBe(before);
    } finally {
      await isolatedTarget.close();
    }
  });

  test("timeout and unresolvable host show their own messages, apart from the target's result", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signIn(page, owner);
    await page.goto(`${overview()}/new`);
    await page.getByLabel("ชื่อมอนิเตอร์").fill(`timeout-${run}`);
    await page.getByRole("radio", { name: "ขั้นสูง" }).click();
    await page.getByLabel("หมดเวลารอ (วินาที)").fill("1");
    await page.getByLabel("URL", { exact: true }).fill(urlOf("/slow?ms=4000"));
    await page.getByRole("button", { name: "ทดสอบการตั้งค่า" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "หมดเวลารอ 1 วินาที" }),
    ).toBeVisible({ timeout: 15_000 });

    await page
      .getByLabel("URL", { exact: true })
      .fill(`http://no-such-host-${run}.invalid/`);
    await page.getByRole("button", { name: "ทดสอบการตั้งค่า" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "ไม่พบชื่อโดเมนนี้" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("edit, change and races", () => {
  test("a concurrent edit shows the conflict and keeps typed values", async ({
    browser,
  }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const a = await first.newPage();
    const b = await second.newPage();
    await signIn(a, owner);
    await signIn(b, owner);
    for (const page of [a, b]) {
      await page.goto(`${overview()}/${monitorId}/edit`);
      await expect(page.getByLabel("ชื่อมอนิเตอร์")).toHaveValue(monitorName);
    }
    await a.getByLabel("ชื่อมอนิเตอร์").fill(`${monitorName}-a`);
    await a.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await expect(
      a.getByRole("heading", { name: `${monitorName}-a` }),
    ).toBeVisible();
    await b.getByLabel("ชื่อมอนิเตอร์").fill(`${monitorName}-b`);
    await b.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await expect(
      b.getByText("มอนิเตอร์นี้ถูกแก้โดยผู้อื่น โหลดใหม่เพื่อดูค่าล่าสุด"),
    ).toBeVisible();
    await expect(b.getByLabel("ชื่อมอนิเตอร์")).toHaveValue(`${monitorName}-b`);
    const stored = await pool.query("select name from monitors where id = $1", [
      monitorId,
    ]);
    expect(stored.rows[0].name).toBe(`${monitorName}-a`);
    await first.close();
    await second.close();
    await pool.query("update monitors set name = $2 where id = $1", [
      monitorId,
      monitorName,
    ]);
  });

  test("an id of another Organization reads as not found on Detail and Edit", async ({
    page,
  }) => {
    await signIn(page, owner);
    for (const path of [
      `/${otherMonitorId}`,
      `/${otherMonitorId}/edit`,
      "/not-a-uuid",
    ]) {
      await page.goto(`${overview()}${path}`);
      await expect(page.getByText("ไม่พบมอนิเตอร์นี้")).toBeVisible();
    }
    await expect(page.getByText(`foreign-${run}`)).toHaveCount(0);
  });

  test("editing the URL shows unknown until the new configuration has a result", async ({
    page,
  }) => {
    test.setTimeout(3 * 60_000);
    const created = await ownerSession.request("POST", monitorPath(orgA), {
      ...basicConfig(`change-${run}`, urlOf("/health")),
      clientRequestId: randomUUID(),
    });
    const id = (created.body as { monitor: { id: string } }).monitor.id;
    await signIn(page, owner);
    await page.goto(`${overview()}/${id}`);
    await expect(page.getByText("ปกติ", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    target.setDelay(8000);
    await page.getByRole("link", { name: "แก้ไข" }).click();
    await page
      .getByLabel("URL", { exact: true })
      .fill(urlOf("/health?changed=1"));
    await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await expect(page.getByText("บันทึกการแก้ไขแล้ว")).toBeVisible();
    await expect(page.getByText("ไม่ทราบสถานะ", { exact: true })).toBeVisible();
    await expect(page.getByText("ปกติ", { exact: true })).toHaveCount(0);
    target.setDelay(0);
    await expect(page.getByText("ปกติ", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
  });

  test("deleting a monitor that another session deleted goes to Overview with the notice", async ({
    page,
  }) => {
    const created = await ownerSession.request("POST", monitorPath(orgA), {
      ...basicConfig(`raced-${run}`, urlOf("/health")),
      clientRequestId: randomUUID(),
    });
    const id = (created.body as { monitor: { id: string } }).monitor.id;
    await signIn(page, owner);
    await page.goto(`${overview()}/${id}`);
    await page.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
    const dialog = page.getByRole("dialog", { name: "ยืนยันการลบมอนิเตอร์" });
    await expect(dialog).toBeVisible();
    const other = await ownerSession.request(
      "DELETE",
      monitorPath(orgA, `/${id}`),
    );
    expect(other.status).toBeLessThan(300);
    await dialog.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
    await expect(page).toHaveURL(new RegExp(`${overview()}$`));
    await expect(page.getByText("มอนิเตอร์นี้ถูกลบแล้ว")).toBeVisible();
  });

  test("a Detail left open shows not found after the monitor is deleted elsewhere", async ({
    page,
  }) => {
    const created = await ownerSession.request("POST", monitorPath(orgA), {
      ...basicConfig(`vanish-${run}`, urlOf("/health")),
      clientRequestId: randomUUID(),
    });
    const id = (created.body as { monitor: { id: string } }).monitor.id;
    await signIn(page, owner);
    await page.goto(`${overview()}/${id}`);
    await expect(
      page.getByRole("heading", { name: `vanish-${run}` }),
    ).toBeVisible();
    await ownerSession.request("DELETE", monitorPath(orgA, `/${id}`));
    await page.getByRole("button", { name: "หยุดชั่วคราว" }).click();
    await expect(page.getByText("ไม่พบมอนิเตอร์นี้")).toBeVisible({
      timeout: 15_000,
    });
  });
});

test("the Test limit shows the wait from the server and disables the button", async ({
  page,
}) => {
  const org = await createOrganization(pool, `E2E Rate ${run}`);
  extraOrgs.push(org);
  const person = await createPerson(pool, "rate", org);
  userIds.push(person.userId);
  await addMember(pool, org, person.userId, "owner");
  const session = await signInApi(person);
  const config = basicConfig("rate", urlOf("/status/200"));
  for (let i = 0; i < 10; i++) {
    const reply = await session.request(
      "POST",
      monitorPath(org, "/test"),
      config,
    );
    expect(reply.status).toBe(200);
  }
  await signIn(page, person);
  await page.goto(`/organizations/${org}/monitors/new`);
  await page.getByLabel("ชื่อมอนิเตอร์").fill("rate");
  await page.getByLabel("URL", { exact: true }).fill(urlOf("/status/200"));
  const before = target.hits.length;
  await page.getByRole("button", { name: "ทดสอบการตั้งค่า" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "ทดสอบบ่อยเกินไป" }),
  ).toBeVisible();
  await expect(page.getByText(/ลองอีกครั้งใน \d+ วินาที/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ทดสอบการตั้งค่า" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(target.hits.length).toBe(before);
  await pool.query("delete from organization where id = $1", [org]);
});

test.describe("secrets in the browser", () => {
  test("Edit shows set slots, refuses an empty replace, warns on a type change and blocks a new origin", async ({
    page,
  }) => {
    const token = `ui-token-${randomUUID()}`;
    const created = await ownerSession.request("POST", monitorPath(orgA), {
      ...basicConfig(`secret-ui-${run}`, urlOf("/health")),
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: token }],
      clientRequestId: randomUUID(),
    });
    const id = (created.body as { monitor: { id: string } }).monitor.id;
    await signIn(page, owner);

    // Viewers and owners see the state, never the value.
    await page.goto(`${overview()}/${id}`);
    await expect(page.getByText("ตั้งค่าแล้ว").first()).toBeVisible();
    await expect(page.getByText(token)).toHaveCount(0);

    await page.goto(`${overview()}/${id}/edit`);
    await page.getByRole("radio", { name: "ขั้นสูง" }).click();
    await expect(page.getByText("ตั้งค่าแล้ว").first()).toBeVisible();
    await expect(page.getByText(token)).toHaveCount(0);
    expect(await page.content()).not.toContain(token);

    await shot(page, "edit-secret-set");
    // Replace with nothing typed is refused beside the field (AC-26).
    await page.getByRole("button", { name: "แทนที่ Token" }).click();
    await shot(page, "edit-secret-replace-open");
    await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await expect(
      page.getByText("กรอกค่าใหม่ หรือกดยกเลิกการแทนที่"),
    ).toBeVisible();
    await page.getByRole("button", { name: "ยกเลิกการแทนที่ Token" }).click();

    // Changing the type says the old value is dropped before saving (AC-26).
    await page.locator("#monitor-form-auth-type").selectOption("basic");
    await expect(page.getByText("ค่าลับของชนิดเดิมจะถูกลบ")).toBeVisible();
    await page.locator("#monitor-form-auth-type").selectOption("bearer");

    // A new origin with a kept secret cannot be saved or tested (AC-44).
    await page
      .getByLabel("URL", { exact: true })
      .fill(`http://${host}:${String(target.port + 1)}/health`);
    await expect(
      page
        .getByText("เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม")
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "บันทึกการแก้ไข" }),
    ).toBeDisabled();
  });

  test("query and body fields carry the permanent warning", async ({
    page,
  }) => {
    await signIn(page, owner);
    await page.goto(`${overview()}/new`);
    await page.getByRole("radio", { name: "ขั้นสูง" }).click();
    await expect(
      page.getByText(
        "ผู้ที่ดูมอนิเตอร์เห็นค่านี้ได้ ห้ามใส่ความลับ ใช้ header ลับแทน",
      ),
    ).not.toHaveCount(0);
  });
});

test("a first failing result reads as one failure, not as down", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const created = await ownerSession.request("POST", monitorPath(orgA), {
    ...basicConfig(`first-fail-${run}`, urlOf("/status/503")),
    clientRequestId: randomUUID(),
  });
  const id = (created.body as { monitor: { id: string } }).monitor.id;
  await signIn(page, owner);
  await page.goto(`${overview()}/${id}`);
  await expect(page.getByText("ล้มเหลว 1 ครั้ง").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("ล่ม", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ไม่ทราบสถานะ", { exact: true })).toBeVisible();
});

test("an Organization at 50 monitors shows the reason and the API refuses a 51st", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const org = await createOrganization(pool, `E2E Limit ${run}`);
  extraOrgs.push(org);
  const person = await createPerson(pool, "limit", org);
  userIds.push(person.userId);
  await addMember(pool, org, person.userId, "owner");
  const session = await signInApi(person);
  // Same name and URL for all: duplicates are allowed inside an Organization.
  for (let i = 0; i < 50; i++) {
    const reply = await session.request("POST", monitorPath(org), {
      ...basicConfig("same name", urlOf("/health")),
      clientRequestId: randomUUID(),
    });
    expect(reply.status).toBe(201);
  }
  const over = await session.request("POST", monitorPath(org), {
    ...basicConfig("same name", urlOf("/health")),
    clientRequestId: randomUUID(),
  });
  expect(over.status).toBe(409);
  expect((over.body as { error: { code: string } }).error.code).toBe(
    "MONITOR_LIMIT_REACHED",
  );
  await signIn(page, person);
  await page.goto(`/organizations/${org}/monitors`);
  await expect(
    page.getByText(/องค์กรนี้มีมอนิเตอร์ครบ 50 ตัวแล้ว/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เพิ่มมอนิเตอร์" }),
  ).toBeDisabled();
  const kept = await pool.query(
    "select count(*)::int n, count(*) filter (where status = 'active')::int active from monitors where tenant_id = $1",
    [org],
  );
  expect(kept.rows[0]).toEqual({ n: 50, active: 50 });
  await pool.query("delete from organization where id = $1", [org]);
});

test("known raw samples reach all ranges, keyboard table and both themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await testInfo.attach("57-owned-services", {
    body: JSON.stringify({
      database: new URL(databaseOwnerUrl).pathname.slice(1),
      redisPrefix: process.env.REDIS_KEY_PREFIX,
      cleanupOwner: "scripts/e2e.mjs finally, 57V",
    }),
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = randomUUID();
  await pool.query(
    `insert into monitors
      (id, tenant_id, name, url, client_request_id, interval_seconds, created_at)
     values ($1, $2, 'issue57-known', 'https://fixture.example', $3, 60,
       now() - interval '31 days')`,
    [id, orgA, randomUUID()],
  );
  const path = `${overview()}/${id}`;
  const card = page.locator('section[aria-labelledby="detail-response-times"]');
  const stateShots = async (name: string) => {
    for (const theme of ["สว่าง", "มืด"]) {
      await page.getByRole("button", { name: "เมนูบัญชีผู้ใช้" }).click();
      await page
        .getByRole("group", { name: "ธีม", exact: true })
        .getByRole("button", { name: theme, exact: true })
        .click();
      await page.keyboard.press("Escape");
      await card
        .getByRole("heading", { name: "เวลาตอบสนอง", exact: true })
        .scrollIntoViewIfNeeded();
      await shot(page, `57-${name}-${theme === "สว่าง" ? "light" : "dark"}`);
    }
  };
  await signIn(page, owner);
  await page.goto(path);
  await expect(card.locator("dd")).toHaveText([
    "ไม่มีข้อมูล",
    "ไม่มีข้อมูล",
    "0",
    "0",
  ]);
  await stateShots("empty-before");
  await pool.query(
    `insert into monitor_check_results
      (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms,
       failure_reason, url_masked, check_config_version, interval_seconds)
     select $1, $2, now() - n * interval '1 minute', now() - n * interval '1 minute',
       case when n = 2 then 'fail' else 'pass' end, n * 10,
       case when n = 2 then 'http_status' end, 'https://fixture.example', 1, 60
     from generate_series(1, 4) n`,
    [id, orgA],
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      localStorage.setItem("nightwatch-theme", value);
    }, theme);
    await page.reload();
    for (const label of ["24 ชม.", "7 วัน", "30 วัน"]) {
      const radio = card.getByRole("radio", { name: label, exact: true });
      await radio.focus();
      await page.keyboard.press("Space");
      await expect(card.locator("dd")).toHaveText(["20 ms", "40 ms", "4", "1"]);
      await expect(radio).toBeFocused();
      if (label !== "24 ชม.") {
        await expect(card.getByRole("status")).toContainText(
          "p50 20 ms p95 40 ms จำนวนการตรวจ 4 ล้มเหลว 1",
        );
        await expect(card.getByRole("status")).toHaveAttribute(
          "aria-live",
          "polite",
        );
        await expect(
          card.getByText(/ขอบเริ่มปัดขึ้นเป็นชั่วโมง UTC/),
        ).toBeVisible();
      }
      await expect(
        card.getByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ }),
      ).toBeVisible();
      await shot(
        page,
        `57-kpi-${label === "24 ชม." ? "24h" : label === "7 วัน" ? "7d" : "30d"}-${theme}`,
      );
      const table = card.getByRole("button", { name: "ดูข้อมูลกราฟเป็นตาราง" });
      await table.focus();
      await page.keyboard.press("Enter");
      await expect(card.getByRole("table")).toBeVisible();
      await expect(table).toBeFocused();
      await shot(
        page,
        `57-known-${label === "24 ชม." ? "24h" : label === "7 วัน" ? "7d" : "30d"}-${theme}`,
      );
      await page.keyboard.press("Enter");
      await expect(card.getByRole("table")).toHaveCount(0);
    }
  }
  for (const role of ["owner", "admin", "viewer", "auditor"] as const) {
    const session = await signInApi(people[role]);
    for (const range of ["24h", "7d", "30d"]) {
      const reply = await session.request(
        "GET",
        monitorPath(orgA, `/${id}/response-times?range=${range}`),
      );
      expect(reply.status).toBe(200);
      const response = monitorResponseTimesResponseSchema.parse(reply.body);
      expect(response.window.to).toBe(response.dataAsOf);
      if (response.range === "24h") {
        expect(response.points.map((point) => point.responseTimeMs)).toEqual([
          40, 30, 20, 10,
        ]);
      } else {
        expect(response.summary).toEqual({
          p50Ms: 20,
          p95Ms: 40,
          checks: 4,
          failed: 1,
        });
      }
      await testInfo.attach(`57-api-${role}-${range}`, {
        body: JSON.stringify(response),
        contentType: "application/json",
      });
    }
    await page.context().clearCookies();
    await signIn(page, people[role]);
    await page.goto(path);
    await expect(card.locator("dd")).toHaveText(["20 ms", "40 ms", "4", "1"]);
  }
  await expect(card.getByRole("link", { name: /issue #57/ })).toHaveCount(0);
  await pool.query(
    "update monitor_check_results set response_time_ms = null, outcome = 'fail', failure_reason = 'timeout' where monitor_id = $1",
    [id],
  );
  await page.reload();
  await expect(card.locator("dd")).toHaveText([
    "ไม่มีข้อมูล",
    "ไม่มีข้อมูล",
    "4",
    "4",
  ]);
  await expect(
    card.getByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ }),
  ).toBeVisible();
  await stateShots("timeout");
  await pool.query(
    "update monitor_check_results set outcome = 'check_error', response_time_ms = 0, failure_reason = 'executor_error' where monitor_id = $1",
    [id],
  );
  await page.reload();
  await expect(card.locator("dd")).toHaveText(["0 ms", "0 ms", "0", "0"]);
  await stateShots("check-error");
  const responseUrl = new RegExp(
    `/api/organizations/${orgA}/monitors/${id}/response-times`,
  );
  await page.route(responseUrl, (route) => route.abort());
  await page.reload();
  await expect(card.getByText("โหลดกราฟเวลาตอบสนองไม่สำเร็จ")).toBeVisible();
  await expect(card.locator("dd")).toHaveCount(0);
  await stateShots("error");
  await page.unroute(responseUrl);
  await card.getByRole("button", { name: "ลองอีกครั้ง" }).click();
  await expect(card.locator("dd")).toHaveText(["0 ms", "0 ms", "0", "0"]);
  await pool.query("delete from monitor_check_results where monitor_id = $1", [
    id,
  ]);
  await pool.query(
    `insert into monitor_check_results
      (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms,
       url_masked, check_config_version, interval_seconds)
     select $1, $2, now() - n * interval '1 second', now() - n * interval '1 second',
       'pass', 10, 'https://fixture.example', 1, 60
     from generate_series(1, 1441) n`,
    [id, orgA],
  );
  await page.reload();
  await expect(card.locator("dd")).toHaveText(["10 ms", "10 ms", "1,440", "0"]);
  await expect(
    card.getByText("คำนวณจากผลตรวจล่าสุดไม่เกิน 1,440 รายการ"),
  ).toBeVisible();
  await shot(page, "57-cap-dark");
  await card.getByRole("radio", { name: "7 วัน", exact: true }).click();
  await expect(card.locator("dd")).toHaveText(["10 ms", "10 ms", "1,441", "0"]);
  await page.route(responseUrl, (route) => route.abort());
  await expect(card.getByText(/อัปเดตกราฟไม่สำเร็จ/)).toBeVisible({
    timeout: 45_000,
  });
  await expect(card.locator("dd")).toHaveText(["10 ms", "10 ms", "1,441", "0"]);
  await expect(
    card.getByText(/อัปเดตกราฟไม่สำเร็จ/).locator("time"),
  ).toHaveAttribute("datetime", /T/);
  await stateShots("stale");
  await page.unroute(responseUrl);
  await card.getByRole("button", { name: "ลองอีกครั้ง" }).click();
  await expect(card.getByText(/อัปเดตกราฟไม่สำเร็จ/)).toHaveCount(0);
  await pool.query(
    `insert into monitor_check_results (monitor_id, tenant_id, scheduled_for, checked_at,
      outcome, response_time_ms, url_masked, check_config_version, interval_seconds)
     values ($1, $2, now() - interval '8 days', now() - interval '8 days',
       'pass', 99, 'https://fixture.example', 1, 60)`,
    [id, orgA],
  );
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayedUrl = new RegExp(
    `/api/organizations/${orgA}/monitors/${id}/response-times.*range=30d`,
  );
  await page.route(delayedUrl, async (route) => {
    const actual = await route.fetch();
    await delayed;
    await route.fulfill({ response: actual });
  });
  await card.getByRole("radio", { name: "30 วัน", exact: true }).click();
  await expect(card.getByLabel("กำลังโหลดสรุปเวลาตอบสนอง")).toBeVisible();
  await card.getByRole("radio", { name: "7 วัน", exact: true }).click();
  await expect(card.locator("dd")).toHaveText(["10 ms", "10 ms", "1,441", "0"]);
  const lateCompletion = page.waitForResponse((response) =>
    delayedUrl.test(response.url()),
  );
  release();
  await lateCompletion;
  await expect(
    card.getByRole("radio", { name: "7 วัน", exact: true }),
  ).toBeChecked();
  await expect(card.getByRole("status")).toContainText("7 วันล่าสุด");
  await page.unroute(delayedUrl);
  await pool.query(
    "delete from member where organization_id = $1 and user_id = $2",
    [orgA, people.auditor.userId],
  );
  const denial = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/organizations/${orgA}`) &&
      response.status() === 403,
    { timeout: 45_000 },
  );
  await card.getByRole("radio", { name: "30 วัน", exact: true }).click();
  await denial;
  await expect(
    page
      .getByText(
        /คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้|คุณไม่มีสิทธิ์เข้าถึงองค์กรนี้/,
      )
      .first(),
  ).toBeVisible();
  await expect(card.locator("dd")).toHaveCount(0);
  await shot(page, "57-denied-dark");
});

test("pending real tenant A response cannot enter tenant B after confirmed switch", async ({
  page,
}) => {
  const ids = [randomUUID(), randomUUID()];
  for (const [index, org] of [orgA, orgOther].entries()) {
    await pool.query(
      `insert into monitors (id, tenant_id, name, url, client_request_id, interval_seconds)
       values ($1, $2, $3, 'https://fixture.example', $4, 60)`,
      [ids[index], org, `tenant-known-${index}`, randomUUID()],
    );
    await pool.query(
      `insert into monitor_check_results (monitor_id, tenant_id, scheduled_for, checked_at,
        outcome, response_time_ms, url_masked, check_config_version, interval_seconds)
       values ($1, $2, now() - interval '1 minute', now() - interval '1 minute',
         'pass', $3, 'https://fixture.example', 1, 60)`,
      [ids[index], org, index === 0 ? 10 : 999],
    );
  }
  await signIn(page, owner);
  await page.goto(`${overview()}/${ids[0]}`);
  const card = page.locator('section[aria-labelledby="detail-response-times"]');
  await expect(card.locator("dd")).toHaveText(["10 ms", "10 ms", "1", "0"]);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => {};
  const fetched = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const responseUrl = new RegExp(
    `/api/organizations/${orgA}/monitors/${ids[0]}/response-times.*range=7d`,
  );
  await page.route(responseUrl, async (route) => {
    const actual = await route.fetch();
    observed();
    await pending;
    await route.fulfill({ response: actual });
  });
  await card.getByRole("radio", { name: "7 วัน", exact: true }).click();
  await fetched;
  await page.getByRole("button", { name: /E2E States A/ }).click();
  await page.getByRole("menuitemradio", { name: /E2E States Other/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/organizations/${orgOther}/monitors$`),
  );
  await page.getByRole("link", { name: "tenant-known-1" }).click();
  await expect(card.locator("dd")).toHaveText(["999 ms", "999 ms", "1", "0"]);
  const completed = page.waitForResponse((response) =>
    responseUrl.test(response.url()),
  );
  release();
  await completed;
  await expect(card.locator("dd")).toHaveText(["999 ms", "999 ms", "1", "0"]);
  await expect(card.getByText("10 ms", { exact: true })).toHaveCount(0);
  await shot(page, "57-tenant-switch");
});
