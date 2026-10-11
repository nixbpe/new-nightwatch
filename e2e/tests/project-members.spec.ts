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

// Web side of F-002: an owner adds Organization members to a Project, changes
// roles, meets the last-admin rule and removes a member; a Project member sees
// no controls; an Organization member outside the Project is sent back to the Project list with a notice.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

let org: string;
let otherOrg: string;
let projectId: string;
let ownerSession: ApiSession;
const people = {} as Record<Role | "outsider" | "orgAdmin", Person>;
const userIds: string[] = [];

const membersUrl = () => `/organizations/${org}/projects/${projectId}/members`;
const membersApi = () =>
  `/api/organizations/${org}/projects/${projectId}/members`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/workspace/);
}

async function projectRoles() {
  const list = await ownerSession.request("GET", membersApi());
  expect(list.status).toBe(200);
  return Object.fromEntries(
    (
      list.body as { members: { userId: string; projectRole: string }[] }
    ).members.map((member) => [member.userId, member.projectRole]),
  );
}

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E Project members ${run}`);
  for (const role of ["owner", "viewer", "auditor"] as Role[]) {
    people[role] = await createPerson(pool, role, org);
    userIds.push(people[role].userId);
    await addMember(pool, org, people[role].userId, role);
  }
  // Same Organization, never added to the Project.
  people.outsider = await createPerson(pool, "outsider", org);
  userIds.push(people.outsider.userId);
  await addMember(pool, org, people.outsider.userId, "viewer");
  // A second Organization the owner can switch to from the shell.
  otherOrg = await createOrganization(pool, `E2E Project members other ${run}`);
  await addMember(pool, otherOrg, people.owner.userId, "owner");
  // An Organization admin who is not in the Project (AC-09).
  people.orgAdmin = await createPerson(pool, "orgadmin", org);
  userIds.push(people.orgAdmin.userId);
  await addMember(pool, org, people.orgAdmin.userId, "admin");
  ownerSession = await signInApi(people.owner);
  const created = await ownerSession.request(
    "POST",
    `/api/organizations/${org}/projects`,
    { name: `Payments ${run}`, slug: `pay-${run}` },
  );
  expect(created.status).toBe(201);
  projectId = (created.body as { id: string }).id;
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [org, otherOrg]);
  } finally {
    await database.close();
  }
});

test.describe.configure({ mode: "serial" });

test.describe("owner manages members", () => {
  test("adds an Organization viewer and auditor as members", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(membersUrl());
    await expect(page.getByTestId("project-member-count")).toHaveText("1");
    await expect(
      page.getByTestId(`project-member-row-${people.owner.userId}`),
    ).toContainText("(คุณ)");

    await page.getByTestId("project-members-add").click();
    const dialog = page.getByTestId("add-member-dialog");
    await expect(dialog.getByTestId("add-member-search")).toBeFocused();
    // The owner is already in the Project: listed, but not selectable.
    await expect(
      dialog
        .getByTestId(`add-member-row-${people.owner.userId}`)
        .getByTestId("add-member-checkbox"),
    ).toBeDisabled();
    for (const person of [people.viewer, people.auditor]) {
      await dialog.getByTestId("add-member-search").fill(person.email);
      const candidate = dialog.getByTestId(`add-member-row-${person.userId}`);
      await candidate.getByTestId("add-member-checkbox").check();
    }
    await expect(dialog.getByTestId("add-member-count")).toHaveText("2");
    await dialog.getByTestId("add-member-submit").click();

    await expect(dialog).toHaveCount(0);
    expect(await projectRoles()).toEqual({
      [people.owner.userId]: "admin",
      [people.viewer.userId]: "member",
      [people.auditor.userId]: "member",
    });
    await expect(page.getByTestId("project-member-count")).toHaveText("3");
    await expect(page.getByTestId("project-members-add")).toBeFocused();
  });

  test("explains an empty search and keeps the add button disabled", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(membersUrl());
    await page.getByTestId("project-members-add").click();
    const dialog = page.getByTestId("add-member-dialog");
    await dialog.getByTestId("add-member-search").fill(`nobody-${run}`);
    await expect(dialog.getByTestId("add-member-no-match")).toBeVisible();
    await expect(dialog.getByTestId("add-member-submit")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("changes a role through the select", async ({ page }) => {
    await signIn(page, people.owner);
    await page.goto(membersUrl());
    const select = page
      .getByTestId(`project-member-row-${people.viewer.userId}`)
      .getByTestId("project-member-role-select");
    await select.selectOption("admin");
    await expect(page.getByTestId("project-admin-count")).toHaveText("2");
    expect((await projectRoles())[people.viewer.userId]).toBe("admin");
    await select.selectOption("member");
    await expect(page.getByTestId("project-admin-count")).toHaveText("1");
    expect((await projectRoles())[people.viewer.userId]).toBe("member");
  });

  test("rejects demoting or removing the last admin and says why", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(membersUrl());
    const row = page.getByTestId(`project-member-row-${people.owner.userId}`);
    const select = row.getByTestId("project-member-role-select");
    await select.selectOption("member");
    const problem = page.getByTestId("project-members-problem");
    await expect(problem).toBeVisible();
    await expect(problem).toHaveAttribute("role", "alert");
    await expect(select).toHaveValue("admin");
    expect((await projectRoles())[people.owner.userId]).toBe("admin");

    await row.getByTestId("project-member-remove").click();
    const dialog = page.getByTestId("project-member-remove-dialog");
    await dialog.getByTestId("project-member-remove-confirm").click();
    await expect(
      dialog.getByTestId("project-member-remove-error"),
    ).toBeVisible();
    await dialog.getByTestId("confirmation-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect((await projectRoles())[people.owner.userId]).toBe("admin");
  });

  test("removes a member after confirmation", async ({ page }) => {
    await signIn(page, people.owner);
    await page.goto(membersUrl());
    await page
      .getByTestId(`project-member-row-${people.auditor.userId}`)
      .getByTestId("project-member-remove")
      .click();
    const dialog = page.getByTestId("project-member-remove-dialog");
    await expect(dialog.getByTestId("confirmation-cancel")).toBeFocused();
    await dialog.getByTestId("project-member-remove-confirm").click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByTestId(`project-member-row-${people.auditor.userId}`),
    ).toHaveCount(0);
    await expect(page.getByTestId("project-member-count")).toHaveText("2");
    expect(await projectRoles()).toEqual({
      [people.owner.userId]: "admin",
      [people.viewer.userId]: "member",
    });
  });
});

test.describe("other viewers", () => {
  test("a Project member sees roles as text and no controls", async ({
    page,
  }) => {
    await signIn(page, people.viewer);
    await page.goto(membersUrl());
    await expect(page.getByTestId("project-members-table")).toBeVisible();
    await expect(page.getByTestId("project-members-add")).toHaveCount(0);
    await expect(page.getByTestId("project-member-role-select")).toHaveCount(0);
    await expect(page.getByTestId("project-member-remove")).toHaveCount(0);
    await expect(
      page
        .getByTestId(`project-member-row-${people.owner.userId}`)
        .getByTestId("project-member-role"),
    ).toHaveAttribute("data-project-role", "admin");
  });

  test("an Organization admin outside the Project manages its members (AC-09)", async ({
    page,
  }) => {
    await signIn(page, people.orgAdmin);
    await page.goto(membersUrl());
    await expect(page.getByTestId("project-my-role")).toHaveAttribute(
      "data-project-role",
      "none",
    );
    await expect(page.getByTestId("project-members-add")).toBeVisible();
    const select = page
      .getByTestId(`project-member-row-${people.viewer.userId}`)
      .getByTestId("project-member-role-select");
    await select.selectOption("admin");
    await expect(page.getByTestId("project-admin-count")).toHaveText("2");
    expect((await projectRoles())[people.viewer.userId]).toBe("admin");
    await select.selectOption("member");
    await expect(page.getByTestId("project-admin-count")).toHaveText("1");
    expect((await projectRoles())[people.viewer.userId]).toBe("member");
  });

  test("an Organization member outside the Project is sent back to the list with a notice", async ({
    page,
  }) => {
    await signIn(page, people.outsider);
    await page.goto(membersUrl());
    await expect(page).toHaveURL(new RegExp(`/organizations/${org}/projects$`));
    await expect(
      page.getByTestId("projects-notice-role-changed"),
    ).toBeVisible();
    await expect(page.getByTestId("project-members-table")).toHaveCount(0);
    // The lost Project is neither in the list nor anywhere on the page.
    await expect(page.getByTestId(`project-row-${projectId}`)).toHaveCount(0);
    await expect(page.getByText(`Payments ${run}`)).toHaveCount(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    test("members page, add dialog and 320 px reflow", async ({ page }) => {
      await signIn(page, people.owner);
      await page.goto(membersUrl());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByTestId("project-members-table")).toBeVisible();
      await shot(page, `project-members-${theme}`);

      await page.getByTestId("project-members-add").click();
      await expect(page.getByTestId("add-member-dialog")).toBeVisible();
      // The shot waits for the overlay enter animation to finish.
      await page
        .getByTestId("add-member-dialog")
        .evaluate((element) =>
          Promise.all(element.getAnimations().map((a) => a.finished)),
        );
      await shot(page, `project-members-add-${theme}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("add-member-dialog")).toHaveCount(0);

      await page.setViewportSize({ width: 320, height: 700 });
      await shot(page, `project-members-320-${theme}`, true);
      // The table scrolls inside its own region; the page itself never does.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByTestId("project-members-add").click();
      const submit = page.getByTestId("add-member-submit");
      await expect(submit).toBeInViewport();
      await page.keyboard.press("Escape");
    });
  });
}

test("switching organization in the shell leaves the members page for the new project list", async ({
  page,
}) => {
  await signIn(page, people.owner);
  await page.goto(membersUrl());
  await expect(page.getByTestId("project-members-table")).toBeVisible();
  await page.getByTestId("shell-organization-switch").click();
  await page
    .getByTestId("shell-organization-menu")
    .getByTestId(`shell-organization-${otherOrg}`)
    .click();
  await page.waitForURL(`**/organizations/${otherOrg}/projects`);
  await expect(page.getByTestId("project-members-table")).toHaveCount(0);
});
