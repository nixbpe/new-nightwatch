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
  signInApi,
  type Person,
} from "../support/monitor-fixtures";

const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

test.afterAll(async () => {
  await database.close();
});

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/organizations\/[^/]+\/projects(?:\/|$)/);
}

async function fixture() {
  const org = await createOrganization(
    pool,
    `E2E Organization removal ${randomUUID()}`,
  );
  const owner = await createPerson(pool, "removal-owner", org);
  const target = await createPerson(pool, "removal-target", org);
  await addMember(pool, org, owner.userId, "owner");
  const memberId = await addMember(pool, org, target.userId, "viewer");
  const first = await createProject(pool, org, "Removal One");
  const second = await createProject(pool, org, "Removal Two");
  await addProjectMember(pool, org, first, target.userId, "admin");
  await addProjectMember(pool, org, second, target.userId, "member");
  await addProjectMember(pool, org, second, owner.userId, "admin");
  return { org, owner, target, memberId, first, second };
}

for (const action of ["revoke", "leave"] as const) {
  test(`${action} refuses the last Project admin and preserves all memberships`, async ({
    page,
  }) => {
    const f = await fixture();
    try {
      await signIn(page, action === "revoke" ? f.owner : f.target);
      await page.goto(`/organizations/${f.org}/members`);
      const response = page.waitForResponse(
        (reply) =>
          reply.request().method() === "DELETE" &&
          new URL(reply.url()).pathname ===
            `/api/organizations/${f.org}/members/${action === "revoke" ? f.memberId : "me"}`,
      );
      if (action === "revoke") {
        await page.getByTestId(`member-revoke-${f.memberId}`).click();
        await page.getByTestId("member-revoke-confirm").click();
      } else {
        await page.getByTestId("self-leave-open").click();
        await page.getByTestId("self-leave-confirm").click();
      }
      const denied = await response;
      expect(denied.status()).toBe(409);
      expect(await denied.json()).toMatchObject({
        error: { code: "LAST_PROJECT_ADMIN" },
      });
      await expect(
        page.getByTestId(
          action === "revoke" ? "member-revoke-error" : "self-leave-error",
        ),
      ).toContainText("Removal One");
      const ownerSession = await signInApi(f.owner);
      const members = await ownerSession.request(
        "GET",
        `/api/organizations/${f.org}/members`,
      );
      expect(members.status).toBe(200);
      expect(members.body).toMatchObject({
        members: expect.arrayContaining([
          expect.objectContaining({ id: f.memberId, userId: f.target.userId }),
        ]),
      });
      for (const projectId of [f.first, f.second]) {
        const roster = await ownerSession.request(
          "GET",
          `/api/organizations/${f.org}/projects/${projectId}/members`,
        );
        expect(roster.status).toBe(200);
        expect(roster.body).toMatchObject({
          members: expect.arrayContaining([
            expect.objectContaining({
              userId: f.target.userId,
              projectRole: projectId === f.first ? "admin" : "member",
            }),
          ]),
        });
      }
      await page.goto(`/organizations/${f.org}/projects/${f.first}/members`);
      await expect(
        page.getByTestId(`project-member-row-${f.target.userId}`),
      ).toBeVisible();
    } finally {
      await cleanUp(pool, [f.owner.userId, f.target.userId], [f.org]);
    }
  });
}

test("organization removal cascades every Project membership and withdraws the visible roster and list", async ({
  page,
  browser,
}) => {
  const f = await fixture();
  const targetContext = await browser.newContext();
  try {
    await addProjectMember(pool, f.org, f.first, f.owner.userId, "admin");
    const targetPage = await targetContext.newPage();
    await signIn(targetPage, f.target);
    await targetPage.goto(`/organizations/${f.org}/projects`);
    for (const projectId of [f.first, f.second]) {
      await expect(
        targetPage.getByTestId(`project-row-${projectId}`),
      ).toBeVisible();
    }
    await signIn(page, f.owner);
    await page.goto(`/organizations/${f.org}/members`);
    await page.getByTestId(`member-revoke-${f.memberId}`).click();
    await page.getByTestId("member-revoke-confirm").click();
    await expect(page.getByTestId("member-revoke-success")).toBeVisible();
    await expect(page.getByTestId(`member-row-${f.memberId}`)).toHaveCount(0);
    const ownerSession = await signInApi(f.owner);
    const targetSession = await signInApi(f.target);
    for (const projectId of [f.first, f.second]) {
      const roster = await ownerSession.request(
        "GET",
        `/api/organizations/${f.org}/projects/${projectId}/members`,
      );
      expect(roster.status).toBe(200);
      expect(roster.body).toMatchObject({
        members: [{ userId: f.owner.userId, projectRole: "admin" }],
      });
      await page.goto(`/organizations/${f.org}/projects/${projectId}/members`);
      await expect(page.getByTestId("project-member-count")).toHaveText("1");
      await expect(
        page.getByTestId(`project-member-row-${f.target.userId}`),
      ).toHaveCount(0);
    }
    const rows = await pool.query(
      "select project_id from project_members where tenant_id = $1 and user_id = $2",
      [f.org, f.target.userId],
    );
    expect(rows.rows).toEqual([]);
    const denied = await targetSession.request(
      "GET",
      `/api/organizations/${f.org}/projects`,
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: { code: "MEMBERSHIP_DENIED" } });
    await targetPage.reload();
    await expect(targetPage.getByTestId("projects-denied")).toBeVisible();
    for (const projectId of [f.first, f.second]) {
      await expect(
        targetPage.getByTestId(`project-row-${projectId}`),
      ).toHaveCount(0);
    }
  } finally {
    await targetContext.close();
    await cleanUp(pool, [f.owner.userId, f.target.userId], [f.org]);
  }
});
