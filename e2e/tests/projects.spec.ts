import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import {
  addMember,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  shot,
  signInApi,
  type ApiSession,
  type Person,
  type Role,
} from "../support/monitor-fixtures";

// Web side of F-001: owner create, duplicate slug, edit and delete through the
// dialogs, the viewer's empty state, the denied state, and both themes.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

let org: string;
let otherOrg: string;
let ownerSession: ApiSession;
const people = {} as Record<Role | "nonmember", Person>;
const userIds: string[] = [];

const projectsUrl = (organizationId: string) =>
  `/organizations/${organizationId}/projects`;
const projectsApi = (organizationId: string) =>
  `/api/organizations/${organizationId}/projects`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(person.email);
  await page.locator("#login-password").fill(person.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
}

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E Projects ${run}`);
  otherOrg = await createOrganization(pool, `E2E Projects other ${run}`);
  for (const role of ["owner", "viewer"] as Role[]) {
    people[role] = await createPerson(pool, role, org);
    userIds.push(people[role].userId);
    await addMember(pool, org, people[role].userId, role);
  }
  people.nonmember = await createPerson(pool, "nonmember", otherOrg);
  userIds.push(people.nonmember.userId);
  await addMember(pool, otherOrg, people.nonmember.userId, "owner");
  ownerSession = await signInApi(people.owner);
});

test.afterAll(async () => {
  try {
    // Projects go with their organization (ON DELETE CASCADE).
    await cleanUp(pool, userIds, [org, otherOrg]);
  } finally {
    await database.close();
  }
});

test.describe.configure({ mode: "serial" });

test.describe("owner manages projects", () => {
  const name = `Payments ${run}`;
  const slug = `pay-${run}`;
  const renamed = `Payments v2 ${run}`;

  test("creates a project and sees it with the role ผู้ดูแล", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await expect(page.getByText("ยังไม่มีโปรเจกต์")).toBeVisible();

    await page.getByRole("button", { name: "สร้างโปรเจกต์" }).click();
    const dialog = page.getByRole("dialog", { name: "สร้างโปรเจกต์" });
    await expect(dialog.getByLabel("ชื่อโปรเจกต์")).toBeFocused();
    await dialog.getByLabel("ชื่อโปรเจกต์").fill(name);
    await dialog.getByLabel("slug").fill(slug);
    await dialog.getByLabel("คำอธิบาย (ไม่บังคับ)").fill("Team A");
    await dialog.getByRole("button", { name: "สร้างโปรเจกต์" }).click();

    await expect(dialog).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByText(slug)).toBeVisible();
    await expect(row.getByText("ผู้ดูแล")).toBeVisible();
    await expect(
      row.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    ).toBeVisible();
  });

  test("shows a duplicate slug at the slug field and keeps the values", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await page.getByRole("button", { name: "สร้างโปรเจกต์" }).click();
    const dialog = page.getByRole("dialog", { name: "สร้างโปรเจกต์" });
    await dialog.getByLabel("ชื่อโปรเจกต์").fill("Duplicate");
    await dialog.getByLabel("slug").fill(slug);
    await dialog.getByRole("button", { name: "สร้างโปรเจกต์" }).click();

    await expect(dialog.getByText("slug นี้ถูกใช้แล้วในองค์กร")).toBeVisible();
    await expect(dialog.getByLabel("slug")).toBeFocused();
    await expect(dialog.getByLabel("ชื่อโปรเจกต์")).toHaveValue("Duplicate");
    await expect(dialog.getByLabel("slug")).toHaveValue(slug);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("edits the name and keeps the slug fixed", async ({ page }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await page.getByRole("button", { name: `แก้ไข ${name}` }).click();
    const dialog = page.getByRole("dialog", {
      name: `แก้ไขโปรเจกต์ ${name}`,
    });
    await expect(dialog.getByLabel("slug")).toHaveCount(0);
    await expect(dialog.getByText(slug)).toBeVisible();
    await dialog.getByLabel("ชื่อโปรเจกต์").fill(renamed);
    await dialog.getByRole("button", { name: "บันทึก" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: renamed }),
    ).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test("deletes through the ConfirmDialog", async ({ page }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await page.getByRole("button", { name: `ลบ ${renamed}` }).click();
    const dialog = page.getByRole("dialog", { name: `ลบโปรเจกต์ ${renamed}` });
    await expect(
      dialog.getByText(
        "มอนิเตอร์ สมาชิก และการเชื่อมต่อ AWS ของโปรเจกต์นี้จะถูกลบด้วย และกู้คืนไม่ได้",
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "ลบโปรเจกต์" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("ยังไม่มีโปรเจกต์")).toBeVisible();
    const list = await ownerSession.request("GET", projectsApi(org));
    expect(list.body).toEqual({ projects: [] });
  });
});

test.describe("other roles", () => {
  test("viewer outside every project sees the contact copy and no create button", async ({
    page,
  }) => {
    await signIn(page, people.viewer);
    await page.goto(projectsUrl(org));
    await expect(page.getByText("คุณยังไม่ได้อยู่ในโปรเจกต์ใด")).toBeVisible();
    await expect(
      page.getByText("ติดต่อเจ้าของหรือผู้ดูแลองค์กรเพื่อเข้าร่วมโปรเจกต์"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "สร้างโปรเจกต์" }),
    ).toHaveCount(0);
  });

  test("a non-member sees the denied state and no project data", async ({
    page,
  }) => {
    const seeded = await ownerSession.request("POST", projectsApi(org), {
      name: `Secret ${run}`,
      slug: `secret-${run}`,
    });
    expect(seeded.status).toBe(201);
    await signIn(page, people.nonmember);
    await page.goto(projectsUrl(org));
    await expect(
      page.getByText("คุณไม่มีสิทธิ์ดูโปรเจกต์ขององค์กรนี้"),
    ).toBeVisible();
    await expect(page.getByText(`Secret ${run}`)).toHaveCount(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    test("list, create dialog and 320 px reflow", async ({ page }) => {
      await signIn(page, people.owner);
      await page.goto(projectsUrl(org));
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByText(`Secret ${run}`)).toBeVisible();
      await shot(page, `projects-list-${theme}`);

      await page.getByRole("button", { name: "สร้างโปรเจกต์" }).click();
      await expect(
        page.getByRole("dialog", { name: "สร้างโปรเจกต์" }),
      ).toBeVisible();
      // Let the overlay enter animation finish so the shot is not mid-fade.
      await page.waitForTimeout(500);
      await shot(page, `projects-create-dialog-${theme}`);
      await page.keyboard.press("Escape");

      await page.setViewportSize({ width: 320, height: 700 });
      await shot(page, `projects-list-320-${theme}`, true);
      // Only the table's own scroll region may scroll sideways (LAY-02).
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
