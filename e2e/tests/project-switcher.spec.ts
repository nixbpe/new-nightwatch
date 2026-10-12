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

// Web side of F-010: the sidebar's Project switcher. An owner switches Project
// with the keyboard from a Project page and from the workspace, the server
// remembers the choice, and a viewer sees only the Projects they joined.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

let org: string;
let ownerSession: ApiSession;
let alpha: string;
let bravo: string;
const people = {} as Record<Role, Person>;
const userIds: string[] = [];

const membersUrl = (projectId: string) =>
  `/organizations/${org}/projects/${projectId}/members`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/workspace/);
}

async function createProject(name: string, slug: string): Promise<string> {
  const created = await ownerSession.request(
    "POST",
    `/api/organizations/${org}/projects`,
    { name, slug },
  );
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
}

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E Switcher ${run}`);
  for (const role of ["owner", "viewer"] as Role[]) {
    people[role] = await createPerson(pool, role, org);
    userIds.push(people[role].userId);
    await addMember(pool, org, people[role].userId, role);
  }
  ownerSession = await signInApi(people.owner);
  alpha = await createProject(`Alpha ${run}`, `alpha-${run}`);
  bravo = await createProject(`Bravo ${run}`, `bravo-${run}`);
  const hidden = await createProject(`Hidden ${run}`, `hidden-${run}`);
  // The owner reaches every Project, but is a member of only the first two.
  await pool.query(
    "delete from project_members where project_id = $1 and user_id = $2",
    [hidden, people.owner.userId],
  );
  await pool.query(
    "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'member')",
    [alpha, org, people.viewer.userId],
  );
});

test.afterAll(async () => {
  try {
    // Projects and remembered Projects go with their organization (ON DELETE CASCADE).
    await cleanUp(pool, userIds, [org]);
  } finally {
    await database.close();
  }
});

test.describe.configure({ mode: "serial" });

test("an owner switches Project with the keyboard and the server remembers it", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await page.goto(membersUrl(alpha));
  const button = page.getByTestId("shell-project-switch");
  await expect(button).toContainText(`Alpha ${run}`);
  await expect(button).toHaveAttribute("aria-haspopup", "menu");

  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("shell-project-search")).toBeFocused();
  const current = page.getByTestId(`shell-project-option-${alpha}`);
  await expect(current).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("group", { name: "ไม่ได้เข้าร่วม" }),
  ).toContainText(`Hidden ${run}`);

  await shot(page, "project-switcher-open");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shell-project-menu")).toHaveCount(0);
  await expect(button).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId(`shell-project-option-${bravo}`)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`${membersUrl(bravo)}$`));
  await expect(button).toContainText(`Bravo ${run}`);
  await expect(button).toBeFocused();
  await shot(page, "project-switcher-closed");
  await expect(page.getByTestId("shell-breadcrumb")).toContainText(
    `Bravo ${run}`,
  );
  await expect
    .poll(async () => {
      const resolved = await ownerSession.request(
        "GET",
        `/api/me/last-project?organizationId=${org}`,
      );
      return (resolved.body as { projectId: string }).projectId;
    })
    .toBe(bravo);
});

test("outside a Project the sidebar opens the remembered Project and its pages", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await expect(page.getByTestId("shell-project-switch")).toContainText(
    `Bravo ${run}`,
  );
  await page
    .getByTestId(
      "shell-nav-/organizations/:organizationId/projects/:projectId/members",
    )
    .click();
  await expect(page).toHaveURL(new RegExp(`${membersUrl(bravo)}$`));
});

test("the create link opens the create dialog on the projects page", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await page.getByTestId("shell-project-switch").click();
  await page.getByTestId("shell-project-create").click();
  await expect(page.getByTestId("project-create-dialog")).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/organizations/${org}/projects\\?create=1$`),
  );
});

test("a viewer sees only the joined Projects and no create link", async ({
  page,
}) => {
  await signIn(page, people.viewer);
  await expect(page.getByTestId("shell-project-switch")).toContainText(
    `Alpha ${run}`,
  );
  await page.getByTestId("shell-project-switch").click();
  await expect(page.getByTestId("shell-project-menu")).toContainText(
    `Alpha ${run}`,
  );
  await expect(page.getByTestId("shell-project-menu")).not.toContainText(
    `Bravo ${run}`,
  );
  await expect(page.getByRole("group", { name: "ไม่ได้เข้าร่วม" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("shell-project-create")).toHaveCount(0);
});
