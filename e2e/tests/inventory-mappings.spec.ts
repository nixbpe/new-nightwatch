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
const row = (
  system: string,
  vendor: string,
  product: string,
  version: string,
) =>
  `${system},ทีม A,${vendor},${product},${version},Middleware,Production,Internal`;
const catalogVendor = `catalogco${run}`;
const CSV = [
  HEADER,
  row("Billing API", "F5", "BIG-IP LTM", "17.1.1.3"),
  row("HR Portal", "F5", "BIG-IP LTM", "17.1.1.4"),
  row("HR Portal", "Internal", "payroll-agent", "2.4.1"),
  row("HR Portal", catalogVendor, "Widget", "1.0.1"),
].join("\n");
const CPE = "cpe:2.3:a:f5:big-ip_local_traffic_manager:17.1.1.3:*:*:*:*:*:*:*";

let org: string;
let projectId: string;
let owner: Person;
let member: Person;
const userIds: string[] = [];

const base = () => `/organizations/${org}/projects/${projectId}/inventory`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E Mapping ${run}`);
  owner = await createPerson(pool, "mapping-owner", org);
  member = await createPerson(pool, "mapping-member", org);
  userIds.push(owner.userId, member.userId);
  await addMember(pool, org, owner.userId, "owner");
  await addMember(pool, org, member.userId, "viewer");
  projectId = await createProject(pool, org, `Payments ${run}`);
  await addProjectMember(pool, org, projectId, member.userId, "member");
  await pool.query(
    "insert into catalog_product_mappings (vendor_key, product_key, cpe) values ($1, 'widget', $2)",
    [catalogVendor, `cpe:2.3:a:catalogco:widget:*:*:*:*:*:*:*:*`],
  );
});

test.afterAll(async () => {
  try {
    await pool.query(
      "delete from catalog_product_mappings where vendor_key = $1",
      [catalogVendor],
    );
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

    test("owner reviews the queue: no CPE for one product, a typed CPE for another", async ({
      page,
    }) => {
      // The light run leaves decisions behind, so each theme starts from an empty Project.
      await pool.query("delete from inventory_systems where project_id = $1", [
        projectId,
      ]);
      await pool.query("delete from inventory_mappings where project_id = $1", [
        projectId,
      ]);
      await signIn(page, owner);
      await page.goto(base());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByTestId("inventory-file-input").setInputFiles({
        name: "inventory.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      });
      // The catalog pair is confirmed on upload; the other two wait for review.
      await expect(page.getByTestId("inventory-tile-mappings")).toContainText(
        "2",
      );

      await page.getByTestId("inventory-mappings-link").click();
      const pending = page.getByRole("region", {
        name: "รอยืนยัน CPE/purl",
        exact: true,
      });
      await expect(pending.getByTestId(/^mapping-row-/)).toHaveCount(2);
      const decidedRegion = page.getByRole("region", {
        name: "ตัดสินแล้ว",
        exact: true,
      });
      await expect(decidedRegion).toContainText(catalogVendor);
      await expect(decidedRegion).toContainText("จากตารางกลาง");
      await shot(page, `mapping-queue-${theme}`);

      await pending
        .getByTestId(/^mapping-row-/)
        .filter({ hasText: "payroll-agent" })
        .getByRole("button", { name: "ไม่มี CPE/purl" })
        .click();
      await expect(page.getByTestId("mapping-notice")).toContainText(
        "payroll-agent ไม่มี CPE/purl แล้ว",
      );
      await expect(pending.getByTestId(/^mapping-row-/)).toHaveCount(1);
      await expect(decidedRegion).toContainText("ยังไม่ครอบคลุม");

      await pending.getByRole("button", { name: "แก้ CPE/purl" }).click();
      const dialog = page.getByTestId("mapping-dialog");
      await expect(page.getByTestId("mapping-query")).toBeFocused();
      await page.getByTestId("mapping-cpe").fill("cpe:/a:f5:big-ip");
      await page.getByTestId("mapping-save").click();
      await expect(page.getByTestId("mapping-cpe-error")).toBeVisible();
      await shot(page, `mapping-dialog-${theme}`);
      await page.getByTestId("mapping-cpe").fill(CPE);
      await page.getByTestId("mapping-save").click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("mapping-notice")).toContainText(
        "BIG-IP LTM แล้ว",
      );
      await expect(pending.getByTestId(/^mapping-row-/)).toHaveCount(0);

      await page.goto(base());
      await expect(page.getByTestId("inventory-tile-mappings")).toContainText(
        "0",
      );
    });
  });
}

test("a Project member sees the queue but no way to decide", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto(`${base()}/mappings`);

  await expect(page.getByTestId(/^mapping-row-/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "แก้ CPE/purl" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "ไม่มี CPE/purl" }),
  ).toHaveCount(0);
});
