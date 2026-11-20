import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import { fixtureKeysSchema } from "../../packages/shared/tests/fakecloud-sts.ts";
import {
  addMember,
  cleanUp,
  createOrganization,
  createPerson,
  createProject,
  databaseOwnerUrl,
  shot,
  signInApi,
} from "../support/monitor-fixtures";

const hubRole = "arn:aws:iam::222222222222:role/Hub";
const projectRole = "arn:aws:iam::333333333333:role/Project";

async function testAndSave(page: Page) {
  await expect(page.getByTestId("aws-save")).toBeDisabled();
  await page.getByTestId("aws-test").click();
  await expect(page.getByTestId("aws-test-passed")).toBeVisible();
  await page.getByTestId("aws-save").click();
  await expect(page.getByTestId("aws-saved")).toBeVisible();
}

async function captureThemes(page: Page, name: string) {
  for (const theme of ["light", "dark"]) {
    await page.getByTestId("shell-account-open").click();
    await page.getByTestId(`shell-theme-${theme}`).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await shot(page, `aws-${name}-${theme}`);
  }
}

test("owner connects a hub and a Project with both STS methods; Project member cannot change it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const db = createDatabase(databaseOwnerUrl);
  const run = randomUUID().slice(0, 8);
  const people: string[] = [];
  let organizationId: string | undefined;
  try {
    organizationId = await createOrganization(db.sql, `AWS E2E ${run}`);
    const owner = await createPerson(db.sql, "owner", organizationId);
    people.push(owner.userId);
    await addMember(db.sql, organizationId, owner.userId, "owner");
    const member = await createPerson(db.sql, "viewer", organizationId);
    people.push(member.userId);
    await addMember(db.sql, organizationId, member.userId, "viewer");
    const projectId = await createProject(db.sql, organizationId, `AWS ${run}`);
    await db.sql.query(
      "insert into project_members (tenant_id, project_id, user_id, role) values ($1, $2, $3, 'member')",
      [organizationId, projectId, member.userId],
    );
    await db.sql.query(
      "insert into org_aws_connections (tenant_id, external_id) values ($1, 'nw-org-fixture')",
      [organizationId],
    );
    await db.sql.query(
      "insert into project_aws_connections (tenant_id, project_id, external_id) values ($1, $2, 'nw-project-fixture')",
      [organizationId, projectId],
    );
    const org = `/organizations/${organizationId}`;
    const project = `${org}/projects/${projectId}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByTestId("login-email").fill(owner.email);
    await page.getByTestId("login-password").fill(owner.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/organizations\/[^/]+\/projects(?:\/|$)/);
    await page.goto(`${org}/aws`);
    await expect(page.getByTestId("aws-role-arn")).toBeEnabled();
    await page.getByTestId("aws-role-arn").fill(hubRole);
    await testAndSave(page);
    await captureThemes(page, "organization");
    await page.goto(`${project}/aws`);
    await page.getByTestId("aws-method-role").click();
    await page.getByTestId("aws-role-arn").fill(projectRole);
    await testAndSave(page);
    await expect(page.getByTestId("aws-connection-status")).toContainText(
      "333333333333",
    );
    await captureThemes(page, "project-role");
    await page.goto(`${project}/overview`);
    await expect(page.getByTestId("project-aws-card")).toContainText(
      "333333333333",
    );

    const fixtureFile = process.env.NIGHTWATCH_E2E_STS_FIXTURE;
    if (!fixtureFile) throw new Error("Missing fakecloud fixture");
    const credentials = fixtureKeysSchema.parse(
      JSON.parse(await readFile(fixtureFile, "utf8")),
    );
    await page.goto(`${project}/aws`);
    await page.getByTestId("aws-method-key").click();
    await page.getByTestId("aws-accessKeyId").fill(credentials.accessKeyId);
    await page
      .getByTestId("aws-secretAccessKey")
      .fill(credentials.secretAccessKey);
    await testAndSave(page);
    await expect(page.getByTestId("aws-key-set")).toBeVisible();
    await expect(page.getByTestId("aws-accessKeyId")).toHaveValue("");
    await expect(page.getByTestId("aws-secretAccessKey")).toHaveValue("");
    await captureThemes(page, "project-key");

    const session = await signInApi(member);
    const path = `/api${project}/aws-connection`;
    const read = await session.request("GET", path);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      state: "connected",
      method: "access_key",
      accountId: "444444444444",
    });
    expect(read.body).not.toHaveProperty("settings");
    expect(JSON.stringify(read.body)).not.toContain(credentials.accessKeyId);
    expect(JSON.stringify(read.body)).not.toContain(
      credentials.secretAccessKey,
    );
    expect(
      (
        await session.request("PUT", path, {
          method: "assume_role",
          roleArn: projectRole,
        })
      ).status,
    ).toBe(403);
  } finally {
    try {
      await cleanUp(db.sql, people, organizationId ? [organizationId] : []);
    } finally {
      await db.close();
    }
  }
});
