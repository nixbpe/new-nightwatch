import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import {
  addMember,
  addProjectMember,
  cleanUp,
  createOrganization,
  createPerson,
  createProject,
  databaseOwnerUrl,
  shot,
  type Person,
} from "../support/monitor-fixtures";

const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

const HEADER = "System,Owner,Vendor,Product,Version,Layer,Environment,Exposure";
const row = (system: string, version: string, exposure = "Internal") =>
  `${system},ทีม ${system},Canonical,Ubuntu,${version},OS,Production,${exposure}`;
const CSV = [
  HEADER,
  row("Billing API", "22.04.4"),
  row("Billing API", "24.04.1"),
  row("HR Portal", "22.04.4"),
  row("HR Portal", "22.04"),
  row("HR Portal", "latest"),
  row("HR Portal", "22.04.5", "public"),
].join("\n");
// Merges into the file above: one update, a new version of a Product the System has (a warning),
// a repeated key, a failed row over a usable row, and a System the Project does not have yet.
const MERGE_CSV = [
  HEADER,
  `Billing API,ทีม Payments,Canonical,Ubuntu,22.04.4,OS,Production,Internal`,
  row("Billing API", "26.04.0"),
  row("Billing API", "26.04.0"),
  `HR Portal,ทีม HR Portal,Canonical,Ubuntu,22.04.4,Kernel,Production,Internal`,
  row("Batch Jobs", "22.04.4"),
].join("\n");

let org: string;
let projectId: string;
let owner: Person;
let member: Person;
const userIds: string[] = [];

const inventoryUrl = () =>
  `/organizations/${org}/projects/${projectId}/inventory`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

// A dialog fades in; a screenshot taken meanwhile shows it half transparent. A transition
// cancelled by a later style change rejects `finished`, and a cancelled animation is over too.
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.allSettled(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );

const csvFile = (name: string, text: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E Inventory ${run}`);
  owner = await createPerson(pool, "inventory-owner", org);
  member = await createPerson(pool, "inventory-member", org);
  userIds.push(owner.userId, member.userId);
  await addMember(pool, org, owner.userId, "owner");
  await addMember(pool, org, member.userId, "viewer");
  projectId = await createProject(pool, org, `Payments ${run}`);
  await addProjectMember(pool, org, projectId, member.userId, "member");
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [org]);
  } finally {
    await database.close();
  }
});

test.describe.configure({ mode: "serial" });

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    test("owner imports a file through the preview, reads the quality and downloads the failed rows", async ({
      page,
    }) => {
      // The light run leaves its import behind, so each theme starts from an empty Project.
      await pool.query("delete from inventory_systems where project_id = $1", [
        projectId,
      ]);
      await pool.query("delete from inventory_imports where project_id = $1", [
        projectId,
      ]);
      await signIn(page, owner);
      await page.goto(inventoryUrl());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByText(/ยังไม่มี inventory/)).toBeVisible();
      await shot(page, `inventory-empty-${theme}`);

      await page.getByTestId("inventory-import-link").click();
      await expect(page).toHaveURL(/inventory\/import$/);
      await expect(page.getByTestId("page-title")).toHaveText(
        "Import inventory",
      );
      await expect(
        page.getByTestId("inventory-import-history-empty"),
      ).toHaveText("ยังไม่มีประวัติ import");
      await shot(page, `inventory-import-choose-${theme}`);
      await page
        .getByTestId("inventory-file-input")
        .setInputFiles(csvFile("inventory-q4.csv", CSV));
      await expect(
        page.getByTestId("inventory-import-previewed"),
      ).toContainText("เพิ่ม 3 · อัปเดต 0 · ไม่เปลี่ยน 0 · ข้าม 0 · ไม่ผ่าน 3");
      await expect(page.getByTestId("inventory-import-row-5")).toContainText(
        "ไม่ถึง patch level",
      );
      // Nothing is merged before the confirmation.
      expect(
        (
          await pool.query(
            "select 1 from inventory_systems where project_id = $1",
            [projectId],
          )
        ).rowCount,
      ).toBe(0);
      await page.getByTestId("inventory-import-confirm").click();
      await expect(page.getByTestId("inventory-import-success")).toContainText(
        "import ไฟล์ inventory-q4.csv แล้ว",
      );
      await expect(page.getByTestId("inventory-import-result")).toBeVisible();
      const history = page.getByTestId("inventory-import-history");
      await expect(history.getByRole("row")).toHaveCount(2);
      await expect(history).toContainText("inventory-q4.csv");
      await expect(history).toContainText("Monitor E2E inventory-owner");
      await shot(page, `inventory-import-result-${theme}`);
      await page.getByTestId("inventory-import-done").click();
      await expect(page).toHaveURL(/inventory$/);
      await expect(page.getByTestId("inventory-tile-upload")).toContainText(
        "inventory-q4.csv",
      );
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
      await expect(page.getByTestId("inventory-tile-usable")).toContainText(
        "ไม่ผ่าน 3 แถว",
      );
      const quality = page.getByTestId("inventory-quality-details");
      await expect(quality).not.toHaveAttribute("open");
      await quality.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(quality).toHaveAttribute("open", "");
      const systems = page.getByTestId(/^inventory-system-/);
      await expect(systems).toHaveCount(2);
      const hr = systems.filter({ hasText: "HR Portal" });
      await expect(hr).toContainText("1 · 25%");
      await expect(hr.locator('[data-low-quality="true"]')).toHaveCount(1);
      await expect(systems.filter({ hasText: "Billing API" })).toContainText(
        "ผ่าน",
      );
      await shot(page, `inventory-${theme}`);
      await expect(page.getByTestId("inventory-rows-table")).toBeVisible();
      await page.getByTestId("inventory-rows").scrollIntoViewIfNeeded();
      const edit = page.getByTestId(/^inventory-row-edit-/).first();
      const bounds = await edit.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
      await edit.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(edit).toBeFocused();
      const source = page
        .locator('[data-testid^="inventory-row-source-"]')
        .first();
      await source.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(source).toHaveAttribute("open", "");
      await expect(source).toContainText("inventory-q4.csv");
      await shot(page, `inventory-rows-${theme}`);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      const rejectedLink = hr.getByRole("link", { name: "ดูแถวที่ไม่ผ่าน" });
      await rejectedLink.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(rejectedLink).toBeFocused();
      await page.keyboard.press("Enter");
      // The link opens the table of rows already filtered by that System and the failed status.
      await expect(page).toHaveURL(
        /inventory\?system=[0-9a-f-]+&status=rejected$/,
      );
      await expect(page.getByTestId("inventory-rows-heading")).toBeFocused();
      const table = page.getByTestId("inventory-rows-table");
      await expect(table.locator("tbody tr")).toHaveCount(3);
      await expect(table).toContainText("ไม่ถึง patch level");
      await expect(table).toContainText("ต้องเป็นเลขเวอร์ชัน");
      await expect(table).toContainText("ค่าไม่อยู่ในรายการ");
      await expect(table).toContainText("import จาก inventory-q4.csv");
      await shot(page, `inventory-rows-filtered-${theme}`);

      // The System name opens the System page, where the Owner download stays.
      await table.getByRole("link", { name: "HR Portal" }).first().click();
      await expect(page.getByTestId("page-title")).toHaveText("HR Portal");
      await expect(page.getByTestId("inventory-system-owners")).toContainText(
        "ทีม HR Portal",
      );
      await expect(page.getByTestId("inventory-system-rows")).toContainText(
        "4",
      );
      await expect(page.getByTestId("inventory-system-usable")).toContainText(
        "1 · 25%",
      );
      await expect(page.getByTestId("inventory-system-quality")).toContainText(
        "คุณภาพต่ำ",
      );
      await expect(
        page.getByRole("button", { name: "Export Excel" }),
      ).toBeVisible();
      await shot(page, `inventory-system-${theme}`);

      const download = page.waitForEvent("download");
      const downloadButton = page.getByTestId("inventory-download-button");
      await downloadButton.focus();
      await expect(downloadButton).toBeFocused();
      await page.keyboard.press("Enter");
      expect((await download).suggestedFilename()).toBe("rejected-rows.xlsx");

      // The System's own export, rows that passed and rows that failed, imports back through
      // the Import page without a change.
      const systemUrl = page.url();
      const exportButton = page.getByRole("button", { name: "Export Excel" });
      const exportDownload = page.waitForEvent("download");
      await exportButton.focus();
      await expect(exportButton).toBeFocused();
      await page.keyboard.press("Enter");
      const exported = await exportDownload;
      expect(exported.suggestedFilename()).toMatch(
        /^inventory-.+-HR-Portal-\d{4}-\d{2}-\d{2}\.xlsx$/,
      );
      await page.goto(`${inventoryUrl()}/import`);
      // The browser keeps the download under a temporary name, so the file goes in under its own.
      await page.getByTestId("inventory-file-input").setInputFiles({
        name: exported.suggestedFilename(),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: await readFile(await exported.path()),
      });
      await expect(
        page.getByTestId("inventory-import-previewed"),
      ).toContainText("เพิ่ม 0 · อัปเดต 0 · ไม่เปลี่ยน 4 · ข้าม 0 · ไม่ผ่าน 0");
      await page.getByTestId("inventory-import-cancel").click();
      await page.goto(systemUrl);

      // The rows list with its reasons is the overview table filtered by this System.
      await page.getByTestId("inventory-system-rows-link").click();
      await expect(page).toHaveURL(/inventory\?system=[0-9a-f-]+$/);
      await expect(
        page.getByTestId("inventory-rows-table").locator("tbody tr"),
      ).toHaveCount(4);
    });

    test("owner adds, edits and deletes a row and a stale save is refused", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(inventoryUrl());
      const table = page.getByTestId("inventory-rows-table");
      await expect(table.locator("tbody tr")).toHaveCount(6);

      // A tooltip stays open while the pointer travels onto it (WCAG 1.4.13).
      const firstEdit = table.getByRole("button", { name: /^แก้แถว/ }).first();
      await firstEdit.hover();
      const bubble = page.getByTestId("tooltip");
      await expect(bubble).toBeVisible();
      const target = await bubble.boundingBox();
      if (!target) throw new Error("tooltip has no box");
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 12 },
      );
      await expect(bubble).toBeVisible();
      await page.mouse.move(5, 5);
      await expect(page.getByTestId("tooltip")).toHaveCount(0);

      // Add: a failing Version shows its reason under the field and keeps what was typed.
      await page.getByTestId("inventory-row-add").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("inventory-row-owner")).toBeFocused();
      await dialog
        .getByTestId("inventory-row-system")
        .selectOption({ label: "Billing API" });
      await dialog.getByTestId("inventory-row-owner").fill("ทีม E2E");
      await dialog.getByTestId("inventory-row-vendor").fill("Redis Ltd");
      await dialog.getByTestId("inventory-row-product").fill("Redis");
      await dialog.getByTestId("inventory-row-version").fill("7.2");
      await dialog
        .getByTestId("inventory-row-environment")
        .selectOption("Production");
      await dialog
        .getByTestId("inventory-row-exposure")
        .selectOption("Internal");
      await dialog.getByTestId("inventory-row-save").click();
      await expect(
        dialog.getByTestId("inventory-row-version-error"),
      ).toContainText("ไม่ถึง patch level");
      await expect(
        dialog.getByTestId("inventory-row-layer-error"),
      ).toContainText("ว่าง");
      await expect(dialog.getByTestId("inventory-row-owner")).toHaveValue(
        "ทีม E2E",
      );
      await settled(page);
      await shot(page, `inventory-row-dialog-${theme}`);
      await dialog.getByTestId("inventory-row-version").fill("7.2.4");
      await dialog
        .getByTestId("inventory-row-layer")
        .selectOption("Middleware");
      await dialog.getByTestId("inventory-row-save").click();
      await expect(page.getByTestId("inventory-rows-success")).toContainText(
        "เพิ่มรายการซอฟต์แวร์แล้ว",
      );
      await expect(table.locator("tbody tr")).toHaveCount(7);
      await expect(page.getByTestId("inventory-tile-total")).toContainText("7");
      const added = table.locator("tbody tr").filter({ hasText: "Redis Ltd" });
      await expect(added).toContainText("แก้ในระบบ");
      await expect(added.locator('[data-usable="true"]')).toHaveCount(1);

      // The same key again is refused and names the row it repeats.
      await page.getByTestId("inventory-row-add").click();
      await dialog
        .getByTestId("inventory-row-system")
        .selectOption({ label: "Billing API" });
      await dialog.getByTestId("inventory-row-owner").fill("ทีม อื่น");
      await dialog.getByTestId("inventory-row-vendor").fill(" REDIS LTD ");
      await dialog.getByTestId("inventory-row-product").fill("redis");
      await dialog.getByTestId("inventory-row-version").fill("7.2.4");
      await dialog
        .getByTestId("inventory-row-layer")
        .selectOption("Middleware");
      await dialog
        .getByTestId("inventory-row-environment")
        .selectOption("Production");
      await dialog
        .getByTestId("inventory-row-exposure")
        .selectOption("Internal");
      await dialog.getByTestId("inventory-row-save").click();
      await expect(
        dialog.getByTestId("inventory-row-version-error"),
      ).toContainText("Redis Ltd Redis 7.2.4");
      await dialog.getByTestId("inventory-row-cancel").click();
      await expect(dialog).toHaveCount(0);

      // Edit: the footer says where the row came from, and a change by someone else
      // while the dialog is open is never overwritten.
      const edit = page.getByRole("button", { name: "แก้แถว Redis 7.2.4" });
      await edit.focus();
      // Focus given by a script after mouse use is not a keyboard visit; Tab is.
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(edit).toBeFocused();
      await expect(page.getByTestId("tooltip")).toHaveText(
        "แก้แถว Redis 7.2.4",
      );
      await shot(page, `inventory-tooltip-${theme}`);
      await page.keyboard.press("Enter");
      await expect(dialog.getByTestId("inventory-row-source")).toContainText(
        "แก้ในระบบ",
      );
      await expect(dialog.getByTestId("inventory-row-source")).toContainText(
        "inventory-owner",
      );
      await settled(page);
      await shot(page, `inventory-row-edit-dialog-${theme}`);
      await pool.query(
        "update inventory_rows set owner = 'ทีมของคนอื่น', revision = revision + 1 where project_id = $1 and product = 'Redis'",
        [projectId],
      );
      await dialog.getByTestId("inventory-row-owner").fill("ทีมของฉัน");
      await dialog.getByTestId("inventory-row-save").click();
      await expect(dialog.getByTestId("inventory-row-error")).toContainText(
        "โหลดตารางใหม่",
      );
      await expect(dialog.getByTestId("inventory-row-owner")).toHaveValue(
        "ทีมของฉัน",
      );
      await expect(dialog.getByTestId("inventory-row-save")).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(added).toContainText("ทีมของคนอื่น");
      await expect(edit).toBeFocused();

      // Delete: the dialog names the Product and Version and the effect on CVE results.
      await page.getByRole("button", { name: "ลบแถว Redis 7.2.4" }).click();
      await expect(dialog).toContainText("Redis 7.2.4");
      await expect(dialog).toContainText(
        "ผล CVE ของ component นี้จะหายในรอบตรวจถัดไป",
      );
      await settled(page);
      await shot(page, `inventory-row-delete-dialog-${theme}`);
      await page.getByTestId("inventory-row-delete-confirm").click();
      await expect(page.getByTestId("inventory-rows-success")).toContainText(
        "ลบแถวแล้ว",
      );
      await expect(table.locator("tbody tr")).toHaveCount(6);
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
    });

    test("owner adds, renames and deletes a System", async ({ page }) => {
      await signIn(page, owner);
      await page.goto(inventoryUrl());
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");

      // Add: a name another System has is refused under the name field, typed values stay.
      await page.getByTestId("inventory-add-system").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("inventory-row-name")).toBeFocused();
      await dialog.getByTestId("inventory-row-name").fill(" billing API ");
      await dialog.getByTestId("inventory-row-owner").fill("ทีม Cache");
      await dialog.getByTestId("inventory-row-vendor").fill("Redis Ltd");
      await dialog.getByTestId("inventory-row-product").fill("Redis");
      await dialog.getByTestId("inventory-row-version").fill("7.2.4");
      await dialog
        .getByTestId("inventory-row-layer")
        .selectOption("Middleware");
      await dialog
        .getByTestId("inventory-row-environment")
        .selectOption("Production");
      await dialog
        .getByTestId("inventory-row-exposure")
        .selectOption("Internal");
      await dialog.getByTestId("inventory-row-save").click();
      await expect(
        dialog.getByTestId("inventory-row-name-error"),
      ).toContainText("มี System ชื่อ billing API");
      await expect(dialog.getByTestId("inventory-row-owner")).toHaveValue(
        "ทีม Cache",
      );
      await settled(page);
      await shot(page, `inventory-system-dialog-${theme}`);
      await dialog.getByTestId("inventory-row-name").fill("Cache");
      await dialog.getByTestId("inventory-row-save").click();
      await expect(page.getByTestId("inventory-success")).toContainText(
        "เพิ่มระบบใน Inventory แล้ว",
      );
      await expect(page.getByTestId("inventory-tile-total")).toContainText("7");
      const cache = page.getByTestId(/^inventory-open-system-/).filter({
        hasText: "Cache",
      });
      await expect(cache).toHaveCount(1);

      // Rename in the form of the page: the name another System has is refused.
      await page
        .getByTestId("inventory-quality-details")
        .locator("summary")
        .click();
      await cache.click();
      await expect(page.getByTestId("page-title")).toHaveText("Cache");
      const name = page.getByRole("textbox", { name: "ชื่อ System" });
      await name.fill(" hr portal ");
      await page.getByTestId("inventory-system-rename").click();
      await expect(
        page.getByTestId("inventory-system-name-error"),
      ).toContainText("มี System ชื่อ hr portal");
      await name.fill("Cache DB");
      await page.getByTestId("inventory-system-rename").click();
      await expect(page.getByTestId("inventory-system-success")).toContainText(
        "เปลี่ยนชื่อ System แล้ว",
      );
      await expect(page.getByTestId("page-title")).toHaveText("Cache DB");
      await expect(page.getByTestId("inventory-system-quality")).toContainText(
        "ผ่าน",
      );

      // Delete: the dialog names the System and its rows, and the overview confirms.
      const remove = page.getByTestId("inventory-system-delete");
      await remove.click();
      await expect(dialog).toContainText("Cache DB");
      await expect(
        dialog.getByTestId("inventory-system-delete-confirm"),
      ).toHaveText("ลบ System และ 1 แถว");
      await settled(page);
      await shot(page, `inventory-system-delete-dialog-${theme}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(remove).toBeFocused();
      await remove.click();
      await dialog.getByTestId("inventory-system-delete-confirm").click();
      await expect(page).toHaveURL(/inventory$/);
      await expect(page.getByTestId("inventory-success")).toContainText(
        "ลบ System Cache DB และ 1 แถวแล้ว",
      );
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
      await expect(page.getByTestId(/^inventory-open-system-/)).toHaveCount(2);
    });

    test("a preview that merges warns about a new version and lists skipped rows, and cancel changes nothing", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(`${inventoryUrl()}/import`);
      await page
        .getByTestId("inventory-file-input")
        .setInputFiles(csvFile("inventory-q1.csv", MERGE_CSV));
      await expect(
        page.getByTestId("inventory-import-previewed"),
      ).toContainText("เพิ่ม 2 · อัปเดต 1 · ไม่เปลี่ยน 0 · ข้าม 2 · ไม่ผ่าน 0");
      await expect(page.getByTestId("inventory-import-warning")).toContainText(
        "Billing API: Canonical Ubuntu เพิ่มเวอร์ชัน 26.04.0 เวอร์ชันเดิม 22.04.4, 24.04.1 ยังอยู่",
      );
      await expect(page.getByTestId("inventory-import-row-4")).toContainText(
        "ซ้ำกับแถวที่ 3 ในไฟล์",
      );
      await expect(page.getByTestId("inventory-import-row-5")).toContainText(
        "แถวเดิมที่ใช้งานได้ key เดียวกันยังอยู่",
      );
      await expect(
        page.getByTestId("inventory-import-system-batch jobs"),
      ).toContainText("ใหม่");
      await settled(page);
      await shot(page, `inventory-import-preview-${theme}`);
      // The preview survives a reload, and cancel deletes it at once.
      await page.reload();
      await expect(page.getByTestId("inventory-import-preview")).toBeVisible();
      await page.getByTestId("inventory-import-cancel").click();
      await expect(page.getByTestId("inventory-file-input")).toBeAttached();
      await expect(page.getByTestId("inventory-import-preview")).toHaveCount(0);
      expect(
        (
          await pool.query(
            "select 1 from inventory_previews where project_id = $1",
            [projectId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "select 1 from inventory_rows where project_id = $1",
            [projectId],
          )
        ).rowCount,
      ).toBe(6);
    });

    test("a file with the wrong columns is rejected, no preview is made and the earlier data stays", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(`${inventoryUrl()}/import`);
      await page
        .getByTestId("inventory-file-input")
        .setInputFiles(
          csvFile(
            "inventory-q4-draft.csv",
            "System,Owner,Vendor,Product,Version,Layer,Environment,Hostname\nA,B,C,D,1.2.3,OS,Production,h\n",
          ),
        );
      await expect(page.getByTestId("inventory-import-error")).toContainText(
        "ขาดคอลัมน์ Exposure และมีคอลัมน์ที่ไม่อยู่ใน template: Hostname",
      );
      await expect(page.getByTestId("inventory-import-preview")).toHaveCount(0);
      await shot(page, `inventory-rejected-file-${theme}`);
      await page.goto(inventoryUrl());
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
    });

    test("a Project member sees the Import page restricted, with no file chooser", async ({
      page,
    }) => {
      await signIn(page, member);
      await page.goto(`${inventoryUrl()}/import`);
      await expect(
        page.getByTestId("inventory-import-restricted"),
      ).toContainText("เฉพาะผู้ดูแล Project import ได้");
      await expect(page.getByTestId("inventory-file-input")).toHaveCount(0);
      await expect(page.getByTestId("inventory-choose-button")).toHaveCount(0);
      await expect(page.getByTestId("inventory-template-link")).toBeVisible();
      // A member reads the history, which the owner's import wrote, without the file chooser.
      await expect(page.getByTestId("inventory-import-history")).toContainText(
        "inventory-q4.csv",
      );
      await shot(page, `inventory-import-restricted-${theme}`);
    });
  });
}

test("a Project member reads the inventory but has no Import or edit controls", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto(inventoryUrl());

  await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
  await expect(page.getByTestId("inventory-import-link")).toHaveCount(0);
  await expect(page.getByTestId("inventory-file-input")).toHaveCount(0);
  await expect(
    page.getByTestId("inventory-rows-table").locator("tbody tr"),
  ).toHaveCount(6);
  await expect(page.getByTestId("inventory-row-add")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(แก้|ลบ)แถว/ })).toHaveCount(
    0,
  );
});

test("a Project member reads a System page without the controls that change it", async ({
  page,
}) => {
  const hr = await pool.query<{ id: string }>(
    "select id from inventory_systems where project_id = $1 and name = 'HR Portal'",
    [projectId],
  );
  await signIn(page, member);
  await page.goto(`${inventoryUrl()}/systems/${hr.rows[0]?.id ?? ""}`);

  await expect(page.getByTestId("page-title")).toHaveText("HR Portal");
  await expect(page.getByTestId("inventory-system-restricted")).toBeVisible();
  await expect(page.getByTestId("inventory-system-delete")).toHaveCount(0);
  await expect(page.getByTestId("inventory-system-rename")).toHaveCount(0);
  await expect(page.getByTestId("inventory-download-button")).toBeVisible();
  // Reading is enough to export: a member downloads the System's file and the Project's.
  const systemExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel" }).click();
  expect((await systemExport).suggestedFilename()).toMatch(
    /^inventory-.+-HR-Portal-\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
  await page.goto(inventoryUrl());
  await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
  await expect(page.getByTestId("inventory-add-system")).toHaveCount(0);
  const projectExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel" }).click();
  expect((await projectExport).suggestedFilename()).toMatch(
    /^inventory-.+-\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
});
