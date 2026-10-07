import { monitorResponseTimesResponseSchema } from "../../packages/api-contract/src/monitor.ts";
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
  shot,
  signInApi,
  targetHostname,
  type ApiSession,
  type Person,
  type Role,
} from "../support/monitor-fixtures";

// UI side of AC-02, AC-03, AC-20 to AC-23 and AC-49: role x screen table,
// two sessions changing a role, keyboard flows in both themes, and reflow at a
// 640 px viewport (200% of a 1280 px layout, LAY-02).
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let target: Target;
let probe: Target;
let host: string;
let orgA: string;
let orgB: string;
let monitorId: string;
let ownerSession: ApiSession;
const people = {} as Record<Role | "nonmember" | "demoted" | "removed", Person>;
const memberIds = {} as Record<string, string>;
const userIds: string[] = [];
const monitorName = `access-${run}`;
const orgNameA = `E2E Access A ${run}`;
const orgNameB = `E2E Access B ${run}`;

const urlOf = (server: Target, path: string) =>
  `http://${host}:${String(server.port)}${path}`;

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
  probe = await startMonitorTarget();
  orgA = await createOrganization(pool, orgNameA);
  orgB = await createOrganization(pool, orgNameB);
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    people[role] = await createPerson(pool, role, orgA);
    userIds.push(people[role].userId);
    memberIds[role] = await addMember(pool, orgA, people[role].userId, role);
  }
  for (const key of ["demoted", "removed"] as const) {
    people[key] = await createPerson(pool, key, orgA);
    userIds.push(people[key].userId);
    memberIds[key] = await addMember(pool, orgA, people[key].userId, "admin");
  }
  people.nonmember = await createPerson(pool, "nonmember", orgB);
  userIds.push(people.nonmember.userId);
  await addMember(pool, orgB, people.nonmember.userId, "owner");
  await addMember(pool, orgB, people.owner.userId, "owner");

  ownerSession = await signInApi(people.owner);
  const created = await ownerSession.request("POST", monitorPath(orgA), {
    ...basicConfig(monitorName, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(created.status).toBe(201);
  monitorId = (created.body as { monitor: { id: string } }).monitor.id;
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [orgA, orgB]);
  } finally {
    await database.close();
    await target.close();
    await probe.close();
  }
});

const overview = () => `/organizations/${orgA}/monitors`;
const detail = () => `${overview()}/${monitorId}`;

test.describe("monitor permissions by role and screen", () => {
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    test(`${role}: Overview, Detail, new and edit screens`, async ({
      page,
    }) => {
      const writes = role === "owner" || role === "admin";
      await signIn(page, people[role]);

      await page.goto(overview());
      await expect(page.getByRole("link", { name: monitorName })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "เพิ่มมอนิเตอร์" }),
      ).toHaveCount(writes ? 1 : 0);
      await expect(page.getByText("สิทธิ์ของคุณ: ดูอย่างเดียว")).toHaveCount(
        writes ? 0 : 1,
      );

      await page.goto(detail());
      await expect(
        page.getByRole("heading", { name: monitorName }),
      ).toBeVisible();
      await expect(
        page.getByText(urlOf(target, "/health")).first(),
      ).toBeVisible();
      for (const name of ["แก้ไข", "หยุดชั่วคราว", "ลบมอนิเตอร์"]) {
        const count =
          (await page.getByRole("button", { name }).count()) +
          (await page.getByRole("link", { name, exact: true }).count());
        expect(count, `${role} ${name}`).toBe(writes ? 1 : 0);
      }

      const hits = probe.hits.length;
      for (const path of ["/new", `/${monitorId}/edit`]) {
        await page.goto(`${overview()}${path}`);
        if (writes) {
          await expect(
            page.getByRole("button", { name: "ทดสอบการตั้งค่า" }),
          ).toBeVisible();
        } else {
          await expect(
            page.getByText("คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้"),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "ทดสอบการตั้งค่า" }),
          ).toHaveCount(0);
        }
      }
      expect(probe.hits.length).toBe(hits);
    });
  }

  test("non-member sees a denied state and no monitor data", async ({
    page,
  }) => {
    await signIn(page, people.nonmember);
    await page.goto(overview());
    // The denied state must be on screen before the absence checks mean anything.
    await expect(
      page.getByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้").first(),
    ).toBeVisible();
    await expect(page.getByText(monitorName)).toHaveCount(0);
    await expect(page.getByText(host)).toHaveCount(0);
    await page.goto(detail());
    await expect(
      page.getByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้").first(),
    ).toBeVisible();
    await expect(page.getByText(monitorName)).toHaveCount(0);
    await expect(page.getByText(host)).toHaveCount(0);
    await page.goto(`${overview()}/new`);
    await expect(
      page
        .getByText("คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้")
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ทดสอบการตั้งค่า" }),
    ).toHaveCount(0);
  });
});

test.describe("monitor role changes across signed-in sessions", () => {
  test("form, Detail and dialog refuse after a demotion and keep typed values", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const saveForm = await context.newPage();
    const testForm = await context.newPage();
    const view = await context.newPage();
    const dialogPage = await context.newPage();
    await signIn(saveForm, people.demoted);

    for (const page of [saveForm, testForm]) {
      await page.goto(`${overview()}/new`);
      await page.getByLabel("ชื่อมอนิเตอร์").fill("typed before demotion");
      await page
        .getByLabel("URL", { exact: true })
        .fill(urlOf(probe, "/typed"));
    }
    await view.goto(detail());
    await expect(
      view.getByRole("heading", { name: monitorName }),
    ).toBeVisible();
    await dialogPage.goto(detail());
    await dialogPage.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
    const dialog = dialogPage.getByRole("dialog", {
      name: "ยืนยันการลบมอนิเตอร์",
    });
    await expect(dialog).toBeVisible();

    // Second session: the owner demotes the first user to viewer.
    const demotion = await ownerSession.request(
      "PATCH",
      `/api/organizations/${orgA}/members/${memberIds.demoted}/role`,
      { role: "viewer" },
    );
    expect(demotion.status).toBe(200);

    const before = await pool.query(
      "select count(*)::int n, max(version)::int v from monitors where tenant_id = $1",
      [orgA],
    );
    const hits = probe.hits.length;

    await saveForm.getByRole("button", { name: "บันทึกมอนิเตอร์" }).click();
    await expect(
      saveForm.getByText("สิทธิ์ของคุณเปลี่ยนแล้ว").first(),
    ).toBeVisible();
    await expect(saveForm.getByLabel("ชื่อมอนิเตอร์")).toHaveValue(
      "typed before demotion",
    );

    await testForm.getByRole("button", { name: "ทดสอบการตั้งค่า" }).click();
    await expect(
      testForm.getByText("สิทธิ์ของคุณเปลี่ยนแล้ว").first(),
    ).toBeVisible();
    await expect(testForm.getByLabel("URL", { exact: true })).toHaveValue(
      urlOf(probe, "/typed"),
    );

    await view.getByRole("button", { name: "หยุดชั่วคราว" }).click();
    await expect(view.getByText("สิทธิ์ของคุณเปลี่ยนแล้ว")).toBeVisible();

    await dialog.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
    await expect(dialogPage.getByText("สิทธิ์ของคุณเปลี่ยนแล้ว")).toBeVisible();

    const after = await pool.query(
      "select count(*)::int n, max(version)::int v, bool_or(status = 'paused') paused from monitors where tenant_id = $1",
      [orgA],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(after.rows[0].v).toBe(before.rows[0].v);
    expect(after.rows[0].paused).toBe(false);
    expect(probe.hits.length).toBe(hits);

    // The user is then removed: Detail shows a denied state with no cached data.
    const removal = await ownerSession.request(
      "DELETE",
      `/api/organizations/${orgA}/members/${memberIds.demoted}`,
    );
    expect(removal.status).toBeLessThan(300);
    await view.reload();
    await expect(
      view.getByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้").first(),
    ).toBeVisible();
    await expect(view.getByText(monitorName)).toHaveCount(0);
    await expect(view.getByText(host)).toHaveCount(0);
    await context.close();
  });

  test("removal while Detail and the form are open leaves no data behind", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const view = await context.newPage();
    const form = await context.newPage();
    await signIn(view, people.removed);
    await view.goto(detail());
    await expect(
      view.getByRole("heading", { name: monitorName }),
    ).toBeVisible();
    await form.goto(`${overview()}/${monitorId}/edit`);
    await expect(form.getByLabel("ชื่อมอนิเตอร์")).toHaveValue(monitorName);
    await form.getByLabel("ชื่อมอนิเตอร์").fill(`${monitorName}-removed`);
    const stored = () =>
      pool.query("select name, version from monitors where id = $1", [
        monitorId,
      ]);
    const before = (await stored()).rows[0];

    const removal = await ownerSession.request(
      "DELETE",
      `/api/organizations/${orgA}/members/${memberIds.removed}`,
    );
    expect(removal.status).toBeLessThan(300);

    // A background refresh may already have locked the form; either way it must refuse.
    const saveEdit = form.getByRole("button", { name: "บันทึกการแก้ไข" });
    if (await saveEdit.isEnabled()) await saveEdit.click();
    await expect(
      form
        .getByText(
          /สิทธิ์ของคุณเปลี่ยนแล้ว|คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้/,
        )
        .first(),
    ).toBeVisible();
    // The refused save changed nothing.
    expect((await stored()).rows[0]).toEqual(before);
    await view.reload();
    await expect(
      view.getByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้").first(),
    ).toBeVisible();
    await expect(view.getByText(monitorName)).toHaveCount(0);
    await expect(view.getByText(host)).toHaveCount(0);
    await context.close();
  });

  test("Organization switch on the Edit page leaves it for the new Organization", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(`${overview()}/${monitorId}/edit`);
    await expect(page.getByLabel("ชื่อมอนิเตอร์")).toHaveValue(monitorName);
    await page
      .getByRole("button", { name: new RegExp(orgNameA) })
      .first()
      .click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(orgNameB) })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/organizations/${orgB}/monitors$`),
    );
    await expect(page.getByText(monitorName)).toHaveCount(0);
  });
});

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null) return "";
    const labelled = el.getAttribute("aria-label");
    if (labelled) return labelled;
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0)
      return labels[0]!.innerText.trim().split("\n")[0]!;
    return (
      el.innerText ||
      el.getAttribute("placeholder") ||
      el.tagName
    ).trim();
  });
}

async function tabTo(page: Page, name: string | RegExp, max = 60) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const current = await focusedName(page);
    seen.push(current);
    if (
      typeof name === "string" ? current.includes(name) : name.test(current)
    ) {
      return seen;
    }
  }
  throw new Error(`Tab never reached ${String(name)}: ${seen.join(" > ")}`);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`monitor keyboard navigation and screen structure in the ${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    test("Overview: Tab order, filter announcement, table name, status words", async ({
      page,
    }) => {
      await signIn(page, people.owner);
      await page.goto(overview());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("link", { name: monitorName })).toBeVisible();
      await shot(page, `overview-${theme}`);
      // The shared DataTable puts the label on the scroll region around the table.
      await expect(
        page.getByRole("region", { name: "ตารางมอนิเตอร์" }).getByRole("table"),
      ).toBeVisible();

      await page.getByRole("heading", { level: 1 }).click();
      const order: string[] = [];
      for (const step of [
        "เพิ่มมอนิเตอร์",
        "รีเฟรช",
        "ค้นหาชื่อหรือ URL",
        "ทั้งหมด",
        monitorName,
      ]) {
        order.push(...(await tabTo(page, step)).slice(-1));
      }
      // The status filter is a group of toggle chips; its first chip ("ทั้งหมด")
      // carries an aria-hidden count after the label.
      await expect(
        page.getByRole("group", { name: "สถานะ" }).getByRole("button").first(),
      ).toHaveAttribute("aria-pressed", "true");
      expect(order.map((name) => name.split("\n")[0])).toEqual([
        "เพิ่มมอนิเตอร์",
        "รีเฟรช",
        "ค้นหาชื่อหรือ URL",
        "ทั้งหมด",
        monitorName,
      ]);

      await page.getByLabel("ค้นหาชื่อหรือ URL").fill(monitorName);
      await expect(page.getByRole("status", { name: "ผลการกรอง" })).toHaveText(
        /พบ \d+ จาก \d+/,
      );
      // Health is a word, never a colour alone.
      await expect(
        page
          .getByRole("row", { name: new RegExp(monitorName) })
          .getByText(/ปกติ|ไม่ทราบสถานะ|ล่ม|หยุดชั่วคราว/)
          .first(),
      ).toBeVisible();
    });

    test("Form: first invalid field takes focus, errors are described, Test keeps focus, radiogroup uses arrows, rows are named", async ({
      page,
    }) => {
      await signIn(page, people.owner);
      await page.goto(`${overview()}/new`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      await page.getByRole("button", { name: "บันทึกมอนิเตอร์" }).click();
      const name = page.getByLabel("ชื่อมอนิเตอร์");
      await expect(name).toBeFocused();
      const describedBy = await name.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      await expect(
        page.locator(`#${describedBy!.split(" ")[0]!}`),
      ).not.toBeEmpty();

      await name.fill(`kbd-${run}`);
      await page
        .getByLabel("URL", { exact: true })
        .fill(urlOf(target, "/health"));
      const testButton = page.getByRole("button", { name: "ทดสอบการตั้งค่า" });
      await testButton.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: "การทดสอบผ่าน" }),
      ).toBeVisible();
      await expect(testButton).toBeFocused();
      await shot(page, `form-test-result-${theme}`);

      const group = page.getByRole("radiogroup", { name: "ตรวจทุก" });
      await group.getByRole("radio", { checked: true }).focus();
      const start = await group
        .getByRole("radio", { checked: true })
        .innerText();
      await page.keyboard.press("ArrowRight");
      expect(
        await group.getByRole("radio", { checked: true }).innerText(),
      ).not.toBe(start);

      await page.getByRole("radio", { name: "ขั้นสูง" }).click();
      await page.getByRole("button", { name: "เพิ่ม header" }).click();
      await expect(
        page.getByRole("textbox", { name: "ชื่อ header แถวที่ 1" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "เพิ่ม header" }).click();
      await expect(
        page.getByRole("textbox", { name: "ชื่อ header แถวที่ 2" }),
      ).toBeFocused();
      await expect(
        page.getByRole("button", { name: "ลบ header แถวที่ 2" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "ลบ header แถวที่ 1" }).click();
      await expect(
        page.getByRole("button", { name: "ลบ header แถวที่ 2" }),
      ).toHaveCount(0);
      // After a removal focus lands on the row that took its place.
      await expect(
        page.getByRole("textbox", { name: "ชื่อ header แถวที่ 1" }),
      ).toBeFocused();
    });

    test("Detail: headings in order, chart table, Delete dialog focus, Pause keeps focus", async ({
      page,
    }) => {
      await expect
        .poll(
          async () => {
            const reply = await ownerSession.request(
              "GET",
              monitorPath(orgA, `/${monitorId}/response-times?range=24h`),
            );
            expect(reply.status).toBe(200);
            const series = monitorResponseTimesResponseSchema.parse(reply.body);
            return (
              series.range === "24h" &&
              series.points.some((point) => point.responseTimeMs !== null)
            );
          },
          { timeout: test.info().timeout },
        )
        .toBe(true);
      await signIn(page, people.owner);
      const seriesResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            monitorPath(orgA, `/${monitorId}/response-times`) &&
          new URL(response.url()).searchParams.get("range") === "24h" &&
          response.status() === 200,
      );
      await page.goto(detail());
      const browserSeries = monitorResponseTimesResponseSchema.parse(
        await (await seriesResponse).json(),
      );
      expect(browserSeries).toMatchObject({
        range: "24h",
        points: expect.arrayContaining([
          expect.objectContaining({ responseTimeMs: expect.any(Number) }),
        ]),
      });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", { level: 1, name: monitorName }),
      ).toBeVisible();
      const h2 = await page.getByRole("heading", { level: 2 }).allInnerTexts();
      await shot(page, `detail-${theme}`);
      expect(h2.length).toBeGreaterThanOrEqual(6);
      expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
      // The chart's alternative is a real table opened from the keyboard.
      const toggle = page.getByRole("button", {
        name: "ดูข้อมูลกราฟเป็นตาราง",
      });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("table").first()).toBeVisible();

      const pause = page.getByRole("button", { name: "หยุดชั่วคราว" });
      await pause.focus();
      await page.keyboard.press("Enter");
      const resume = page.getByRole("button", { name: "เริ่มต่อ" });
      await expect(resume).toBeVisible();
      await expect(resume).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "หยุดชั่วคราว" }),
      ).toBeFocused();

      const opener = page.getByRole("button", { name: "ลบมอนิเตอร์" });
      await opener.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "ยืนยันการลบมอนิเตอร์" });
      await expect(
        dialog.getByRole("button", { name: "ยกเลิก" }),
      ).toBeFocused();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    test("Delete confirm returns focus to the Overview heading", async ({
      page,
    }) => {
      const created = await ownerSession.request("POST", monitorPath(orgA), {
        ...basicConfig(`disposable-${theme}-${run}`, urlOf(target, "/health")),
        clientRequestId: randomUUID(),
      });
      const id = (created.body as { monitor: { id: string } }).monitor.id;
      await signIn(page, people.owner);
      await page.goto(`${overview()}/${id}`);
      await page.getByRole("button", { name: "ลบมอนิเตอร์" }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "ยืนยันการลบมอนิเตอร์" });
      await dialog.getByRole("button", { name: "ลบมอนิเตอร์" }).click();
      await expect(page).toHaveURL(new RegExp(`${overview()}$`));
      await expect
        .poll(() => page.evaluate(() => window.history.state?.usr))
        .toBeNull();
      await expect(page.getByText("ลบมอนิเตอร์แล้ว")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    });
  });
}

test.describe("reflow at 200% (640 px viewport, LAY-02)", () => {
  test.use({ viewport: { width: 640, height: 900 } });
  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: no sideways page scroll, actions and labels remain`, async ({
      page,
      context,
    }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
      await signIn(page, people.owner);
      const screens: [string, string[]][] = [
        [overview(), ["เพิ่มมอนิเตอร์", "รีเฟรช"]],
        [detail(), ["แก้ไข", "หยุดชั่วคราว", "ลบมอนิเตอร์"]],
        [`${overview()}/new`, ["ทดสอบการตั้งค่า", "บันทึกมอนิเตอร์"]],
        [
          `${overview()}/${monitorId}/edit`,
          ["ทดสอบการตั้งค่า", "บันทึกการแก้ไข"],
        ],
      ];
      for (const [path, names] of screens) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        // Polled so late layout (fonts, data) is measured, not a fixed wait.
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth -
                  document.documentElement.clientWidth,
              ),
            { message: `${path} sideways overflow`, timeout: 5000 },
          )
          .toBeLessThanOrEqual(0);
        await shot(
          page,
          `reflow-640-${theme}-${path.endsWith("/new") ? "new" : path.endsWith("/edit") ? "edit" : path.includes(monitorId) ? "detail" : "overview"}`,
          true,
        );
        for (const name of names) {
          const count =
            (await page.getByRole("button", { name }).count()) +
            (await page.getByRole("link", { name, exact: true }).count());
          expect(count, `${path} ${name}`).toBeGreaterThanOrEqual(1);
        }
      }
    });
  }
});
