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
let secretId: string;
const people = {} as Record<Role | "nonmember", Person>;
const userIds: string[] = [];

const projectsUrl = (organizationId: string) =>
  `/organizations/${organizationId}/projects`;
const projectsApi = (organizationId: string) =>
  `/api/organizations/${organizationId}/projects`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

async function listProjects() {
  const list = await ownerSession.request("GET", projectsApi(org));
  expect(list.status).toBe(200);
  return (
    list.body as {
      projects: { id: string; name: string; slug: string; myRole: string }[];
    }
  ).projects;
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
  let projectId: string;

  test("creates a project and sees it with the admin role", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await expect(page.getByTestId("projects-empty-first-run")).toBeVisible();

    await page.getByTestId("projects-create").click();
    const dialog = page.getByTestId("project-create-dialog");
    await expect(dialog.getByTestId("project-form-name")).toBeFocused();
    await dialog.getByTestId("project-form-name").fill(name);
    await dialog.getByTestId("project-form-slug").fill(slug);
    await dialog.getByTestId("project-form-description").fill("Team A");
    await dialog.getByTestId("project-form-submit").click();

    await expect(dialog).toHaveCount(0);
    const persisted = (await listProjects()).find(
      (project) => project.slug === slug,
    );
    expect(persisted).toMatchObject({
      name,
      slug,
      description: "Team A",
      myRole: "admin",
    });
    projectId = persisted?.id ?? "";
    const row = page.getByTestId(`project-row-${projectId}`);
    await expect(row.getByTestId("project-name")).toHaveText(name);
    await expect(row.getByTestId("project-slug")).toHaveText(slug);
    await expect(row.getByTestId("project-role")).toHaveAttribute(
      "data-project-role",
      "admin",
    );
    await expect(row.getByTestId("project-updated-at")).toHaveText(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });

  test("shows a duplicate slug at the slug field and keeps the values", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await page.getByTestId("projects-create").click();
    const dialog = page.getByTestId("project-create-dialog");
    await dialog.getByTestId("project-form-name").fill("Duplicate");
    await dialog.getByTestId("project-form-slug").fill(slug);
    await dialog.getByTestId("project-form-submit").click();

    const error = dialog.getByTestId("project-form-slug-error");
    await expect(error).toBeVisible();
    const slugField = dialog.getByTestId("project-form-slug");
    await expect(slugField).toHaveAttribute(
      "aria-describedby",
      (await error.getAttribute("id")) ?? "missing",
    );
    await expect(slugField).toHaveAttribute("aria-invalid", "true");
    await expect(slugField).toBeFocused();
    await expect(dialog.getByTestId("project-form-name")).toHaveValue(
      "Duplicate",
    );
    await expect(slugField).toHaveValue(slug);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await listProjects()).toHaveLength(1);
  });

  test("edits the name and keeps the slug fixed", async ({ page }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    const row = page.getByTestId(`project-row-${projectId}`);
    await row.getByTestId("project-edit").click();
    const dialog = page.getByTestId("project-edit-dialog");
    await expect(dialog.getByTestId("project-form-slug")).toHaveCount(0);
    await expect(dialog.getByTestId("project-form-slug-fixed")).toHaveText(
      slug,
    );
    await dialog.getByTestId("project-form-name").fill(renamed);
    await dialog.getByTestId("project-form-submit").click();

    await expect(dialog).toHaveCount(0);
    await expect(row.getByTestId("project-name")).toHaveText(renamed);
    await expect(row.getByTestId("project-slug")).toHaveText(slug);
    expect(await listProjects()).toMatchObject([
      { id: projectId, name: renamed, slug },
    ]);
  });

  test("deletes through the ConfirmDialog", async ({ page }) => {
    await signIn(page, people.owner);
    await page.goto(projectsUrl(org));
    await page
      .getByTestId(`project-row-${projectId}`)
      .getByTestId("project-delete")
      .click();
    const dialog = page.getByTestId("project-delete-dialog");
    await expect(dialog.getByTestId("confirmation-cancel")).toBeFocused();
    await dialog.getByTestId("project-delete-confirm").click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("projects-empty-first-run")).toBeVisible();
    expect(await listProjects()).toEqual([]);
  });
});

test.describe("other roles", () => {
  test("viewer outside every project sees the not-joined state and no create button", async ({
    page,
  }) => {
    await signIn(page, people.viewer);
    await page.goto(projectsUrl(org));
    await expect(page.getByTestId("projects-empty-not-joined")).toBeVisible();
    await expect(page.getByTestId("projects-create")).toHaveCount(0);
  });

  test("a non-member sees the denied state and no project data", async ({
    page,
  }) => {
    const seeded = await ownerSession.request("POST", projectsApi(org), {
      name: `Secret ${run}`,
      slug: `secret-${run}`,
    });
    expect(seeded.status).toBe(201);
    secretId = (seeded.body as { id: string }).id;
    await signIn(page, people.nonmember);
    await page.goto(projectsUrl(org));
    await expect(page.getByTestId("projects-denied-alert")).toBeVisible();
    await expect(page.getByTestId(`project-row-${secretId}`)).toHaveCount(0);
    // Fixture name: no trace of the project may reach a non-member.
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

    test("list, create dialog and 320 px edit action", async ({ page }) => {
      await signIn(page, people.owner);
      await page.goto(projectsUrl(org));
      // Document preference: the stored theme reaches the root element.
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const row = page.getByTestId(`project-row-${secretId}`);
      await expect(row.getByTestId("project-name")).toHaveText(`Secret ${run}`);
      await shot(page, `projects-list-${theme}`);

      await page.getByTestId("projects-create").click();
      await expect(page.getByTestId("project-create-dialog")).toBeVisible();
      // Let the overlay enter animation finish so the shot is not mid-fade.
      await page.waitForTimeout(500);
      await shot(page, `projects-create-dialog-${theme}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("project-create-dialog")).toHaveCount(0);

      await page.setViewportSize({ width: 320, height: 700 });
      await shot(page, `projects-list-320-${theme}`, true);
      // Row actions sit past the table's right edge; they stay reachable by
      // scrolling the table region.
      await row.getByTestId("project-edit").click();
      await expect(page.getByTestId("project-edit-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("project-edit-dialog")).toHaveCount(0);
    });
  });
}
