import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import { monitorWriteResponseSchema } from "../../packages/api-contract/src/index.ts";
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
  shot,
  signInApi,
  targetHostname,
  type Person,
} from "../support/monitor-fixtures";

const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;
const run = randomUUID().slice(0, 8);
let organizationId: string;
let projectId: string;
let emptyProjectId: string;
let person: Person;
let target: Awaited<ReturnType<typeof startMonitorTarget>>;
let monitorId: string;
const path = (project = projectId) =>
  `/organizations/${organizationId}/projects/${project}/overview`;
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/organizations\/[^/]+\/projects(?:\/|$)/);
}
async function captureThemes(page: Page, state: string) {
  const links = await page.locator("main a").all();
  for (const link of links) {
    await link.focus();
    await expect(link).toBeFocused();
  }
  for (const theme of ["light", "dark"]) {
    await page.getByTestId("shell-account-open").click();
    await page.getByTestId(`shell-theme-${theme}`).click();
    await expect(page.getByTestId(`shell-theme-${theme}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shell-account-menu")).toBeHidden();
    // Document preference proof: the app applies the user's explicit theme.
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await shot(page, `project-overview-${state}-${theme}`);
  }
}

test.beforeAll(async () => {
  target = await startMonitorTarget();
  organizationId = await createOrganization(pool, `E2E Overview ${run}`);
  person = await createPerson(pool, "owner", organizationId);
  await addMember(pool, organizationId, person.userId, "owner");
  projectId = await createProject(pool, organizationId, `Overview ${run}`);
  emptyProjectId = await createProject(pool, organizationId, `Empty ${run}`);
  const session = await signInApi(person);
  const response = await session.request(
    "POST",
    monitorPath(organizationId, projectId),
    {
      ...basicConfig(
        `overview-${run}`,
        `http://${targetHostname()}:${String(target.port)}/health`,
      ),
      clientRequestId: randomUUID(),
    },
  );
  expect(response.status).toBe(201);
  monitorId = monitorWriteResponseSchema.parse(response.body).monitor.id;
});
test.afterAll(async () => {
  try {
    await cleanUp(pool, [person.userId], [organizationId]);
  } finally {
    await database.close();
    await target.close();
  }
});
test.describe.configure({ mode: "serial" });

test("overview shows current summary, member counts and honest empty state in both themes", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(path());
  await expect(page.getByTestId("project-overview-total")).toHaveText("1");
  await expect(page.getByTestId("project-overview-member-count")).toHaveText(
    "0",
  );
  await expect(page.getByTestId("project-overview-admin-count")).toHaveText(
    "0",
  );
  await captureThemes(page, "normal");
  await page.getByTestId("project-overview-members-link").focus();
  await expect(page.getByTestId("project-overview-members-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `/organizations/${organizationId}/projects/${projectId}/members`,
  );
  await page.goto(path(emptyProjectId));
  await expect(page.getByTestId("project-overview-empty")).toBeVisible();
  await expect(page.getByTestId("project-overview-add")).toHaveAttribute(
    "href",
    `/organizations/${organizationId}/projects/${emptyProjectId}/monitors/new`,
  );
  await captureThemes(page, "empty");
});

test("a target that goes down shows in the banner", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  target.setMode("down");
  await signIn(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path());
  const banner = page.getByTestId("project-overview-down-banner");
  await expect(banner).toBeVisible({ timeout: 4 * 60_000 });
  const row = banner.getByTestId("project-overview-down-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link")).toHaveAttribute(
    "href",
    `/organizations/${organizationId}/projects/${projectId}/monitors/${monitorId}`,
  );
  await expect(row.locator("time")).toHaveAttribute("datetime", /.+/);
  // Document preference and browser-native motion proof, independent of CSS values.
  expect(
    await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  expect(
    await banner.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  await captureThemes(page, "down");
  await row.getByRole("link").focus();
  await expect(row.getByRole("link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `/organizations/${organizationId}/projects/${projectId}/monitors/${monitorId}`,
  );
});
