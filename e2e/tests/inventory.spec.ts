import { randomUUID } from "node:crypto";
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
  row("HR Portal", "22.04.4", "public"),
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

    test("owner uploads a file, reads the quality and downloads the failed rows", async ({
      page,
    }) => {
      // The light run leaves its upload behind, so each theme starts from an empty Project.
      await pool.query("delete from inventory_systems where project_id = $1", [
        projectId,
      ]);
      await signIn(page, owner);
      await page.goto(inventoryUrl());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByText(/ยังไม่มี inventory/)).toBeVisible();

      await page
        .getByTestId("inventory-file-input")
        .setInputFiles(csvFile("inventory-q4.csv", CSV));
      await expect(page.getByTestId("inventory-upload-success")).toContainText(
        "6 แถว ใช้งานได้ 3 แถว",
      );
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
      await expect(page.getByTestId("inventory-tile-usable")).toContainText(
        "ไม่ผ่าน 3 แถว",
      );
      const systems = page.getByTestId(/^inventory-system-/);
      await expect(systems).toHaveCount(2);
      const hr = systems.filter({ hasText: "HR Portal" });
      await expect(hr).toContainText("1 · 25%");
      await expect(hr).toContainText("คุณภาพต่ำ");
      await expect(systems.filter({ hasText: "Billing API" })).toContainText(
        "ผ่าน",
      );
      await shot(page, `inventory-${theme}`);

      await hr.getByRole("link", { name: "ดูแถวที่ไม่ผ่าน" }).click();
      await expect(page.getByTestId("inventory-rejected-status")).toContainText(
        "ใช้งานได้ 1 จาก 4 แถว (25%, ต่ำกว่า 95%)",
      );
      await expect(page.getByTestId("inventory-issue-5-Version")).toContainText(
        "ไม่ถึง patch level",
      );
      await expect(page.getByTestId("inventory-issue-6-Version")).toContainText(
        "ต้องเป็นเลขเวอร์ชัน",
      );
      await expect(
        page.getByTestId("inventory-issue-7-Exposure"),
      ).toContainText("ค่าไม่อยู่ในรายการ");
      await shot(page, `inventory-rejected-rows-${theme}`);

      const download = page.waitForEvent("download");
      await page.getByTestId("inventory-download-button").click();
      expect((await download).suggestedFilename()).toBe("rejected-rows.xlsx");
    });

    test("a file with the wrong columns is rejected and the earlier data stays", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(inventoryUrl());
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");

      await page
        .getByTestId("inventory-file-input")
        .setInputFiles(
          csvFile(
            "inventory-q4-draft.csv",
            "System,Owner,Vendor,Product,Version,Layer,Environment,Hostname\nA,B,C,D,1.2.3,OS,Production,h\n",
          ),
        );
      await expect(page.getByTestId("inventory-upload-error")).toContainText(
        "ขาดคอลัมน์ Exposure และมีคอลัมน์ที่ไม่อยู่ใน template: Hostname",
      );
      await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
      await shot(page, `inventory-rejected-file-${theme}`);
    });
  });
}

test("a Project member reads the inventory but cannot upload", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto(inventoryUrl());

  await expect(page.getByTestId("inventory-tile-total")).toContainText("6");
  await expect(page.getByTestId("inventory-file-input")).toHaveCount(0);
  await expect(page.getByTestId("inventory-upload-button")).toHaveCount(0);
  await expect(page.getByTestId("inventory-template-link")).toBeVisible();
});
