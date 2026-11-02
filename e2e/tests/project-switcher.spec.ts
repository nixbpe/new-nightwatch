import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

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

const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

let org: string;
let ownerSession: ApiSession;
let alpha: string;
let bravo: string;
const people = {} as Record<Role, Person>;
const userIds: string[] = [];
const extraOrganizations: string[] = [];

const membersUrl = (projectId: string) =>
  `/organizations/${org}/projects/${projectId}/members`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
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
    await cleanUp(pool, userIds, [org, ...extraOrganizations]);
  } finally {
    await database.close();
  }
});

test.describe.configure({ mode: "serial" });

test("an owner switches Project with the keyboard and the server remembers it", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await expect(page).toHaveURL(
    `/organizations/${org}/projects/${alpha}/overview`,
  );
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

  await expect(page).toHaveURL(membersUrl(bravo));
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

test("workspace and root open the remembered Project and its sidebar pages", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await expect(page).toHaveURL(
    `/organizations/${org}/projects/${bravo}/overview`,
  );
  await page.goto("/");
  await expect(page).toHaveURL(
    `/organizations/${org}/projects/${bravo}/overview`,
  );
  await expect(page.getByTestId("shell-project-switch")).toContainText(
    `Bravo ${run}`,
  );
  await page
    .getByTestId(
      "shell-nav-/organizations/:organizationId/projects/:projectId/members",
    )
    .click();
  await expect(page).toHaveURL(membersUrl(bravo));
});

test("the create link opens the create dialog on the projects page", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await page.getByTestId("shell-project-switch").click();
  await page.getByTestId("shell-project-create").click();
  await expect(page.getByTestId("project-create-dialog")).toBeVisible();
  // The parameter is dropped once the dialog is open, so a reload does not reopen it.
  await expect(page).toHaveURL(`/organizations/${org}/projects`);
  await expect(page.getByTestId("project-create-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("project-create-dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("projects-create")).toBeVisible();
  await expect(page.getByTestId("project-create-dialog")).toHaveCount(0);
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

test("opening a Project page by its link saves it as the last Project", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await page.goto(membersUrl(alpha));
  await expect
    .poll(async () => {
      const resolved = await ownerSession.request(
        "GET",
        `/api/me/last-project?organizationId=${org}`,
      );
      return (resolved.body as { projectId: string }).projectId;
    })
    .toBe(alpha);
  await page.goto("/workspace");
  await expect(page.getByTestId("shell-project-switch")).toContainText(
    `Alpha ${run}`,
  );
});

test("a bookmarked Project of another Organization, with many Projects, keeps the menu inside the viewport", async ({
  page,
}) => {
  // A second Organization the owner belongs to but is not active in.
  const other = await createOrganization(pool, `E2E Switcher many ${run}`);
  extraOrganizations.push(other);
  await addMember(pool, other, people.owner.userId, "owner");
  const ids: string[] = [];
  for (let index = 1; index <= 30; index += 1) {
    const label = String(index).padStart(2, "0");
    const created = await ownerSession.request(
      "POST",
      `/api/organizations/${other}/projects`,
      { name: `Many ${label} ${run}`, slug: `many-${label}-${run}` },
    );
    expect(created.status).toBe(201);
    ids.push((created.body as { id: string }).id);
  }
  await page.setViewportSize({ width: 1280, height: 560 });
  await signIn(page, people.owner);
  await page.goto(`/organizations/${other}/projects/${ids[0]}/members`);

  // The Project in the URL is current, in its own Organization, and saved there.
  const button = page.getByTestId("shell-project-switch");
  await expect(button).toContainText(`Many 01 ${run}`);
  await expect(page.getByTestId("shell-breadcrumb")).toContainText(
    `E2E Switcher many ${run}`,
  );
  await expect
    .poll(async () => {
      const resolved = await ownerSession.request(
        "GET",
        `/api/me/last-project?organizationId=${other}`,
      );
      return (resolved.body as { projectId: string }).projectId;
    })
    .toBe(ids[0]);

  await button.click();
  const panel = page.getByTestId("shell-project-menu-panel");
  await expect(panel).toBeVisible();
  await page.waitForTimeout(500);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(560);
  const list = page.getByTestId("shell-project-list");
  expect(
    await list.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await expect(page.getByTestId("shell-project-search")).toBeInViewport();
  await expect(page.getByTestId("shell-project-create")).toBeInViewport();
  await expect(page.getByTestId("shell-project-all")).toBeInViewport();

  // From the search field, Up wraps through both links to the last Project, which scrolls into view.
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("shell-project-create")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("shell-project-all")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  const last = page.getByTestId(`shell-project-option-${ids[29]}`);
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await expect(page.getByTestId("shell-project-create")).toBeInViewport();
  await page.keyboard.press("Escape");

  // The rail (below 1024 px) and the drawer (below 640 px) bound the menu the same way.
  const assertBounded = async (scope: Locator, height: number) => {
    await scope.getByTestId("shell-project-switch").click();
    const bounded = scope.getByTestId("shell-project-menu-panel");
    await expect(bounded).toBeVisible();
    await page.waitForTimeout(500);
    const rect = await bounded.boundingBox();
    expect((rect?.y ?? 0) + (rect?.height ?? 0)).toBeLessThanOrEqual(height);
    await expect(scope.getByTestId("shell-project-create")).toBeInViewport();
    await expect(scope.getByTestId("shell-project-search")).toBeInViewport();
    await page.keyboard.press("Escape");
  };
  await page.setViewportSize({ width: 800, height: 560 });
  await assertBounded(page.getByTestId("shell-sidebar"), 560);
  await page.setViewportSize({ width: 500, height: 560 });
  await page.getByTestId("shell-mobile-open").click();
  await assertBounded(page.getByTestId("shell-mobile-menu"), 560);
});
