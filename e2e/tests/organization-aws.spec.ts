import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import {
  createAdmin,
  createRole,
  NIGHTWATCH_SOURCE,
} from "../support/fakecloud";
import {
  addMember,
  cleanUp,
  createOrganization,
  createPerson,
  createProject,
  databaseOwnerUrl,
  shot,
  signInApi,
  type Person,
} from "../support/monitor-fixtures";

// F-013 through the browser against fake STS (fakecloud); real AWS is never called.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;
const HUB_ACCOUNT = "222222222222";
const AWS_LEAF = "shell-nav-/organizations/:organizationId/aws";

let org: string;
let owner: Person;
let viewer: Person;
const userIds: string[] = [];

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

async function themedShots(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Rows animate their colours; let the theme switch settle before the shot.
    await page.waitForTimeout(300);
    await shot(page, `${name}-${colorScheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E AWS ${run}`);
  owner = await createPerson(pool, "awsowner", org);
  viewer = await createPerson(pool, "awsviewer", org);
  userIds.push(owner.userId, viewer.userId);
  await addMember(pool, org, owner.userId, "owner");
  await addMember(pool, org, viewer.userId, "viewer");
  // One assume-role Project with a result recorded before any Organization
  // connection, so the page must show it as history (AC-06, AC-07).
  const project = await createProject(pool, org, `Payments ${run}`);
  await pool.query(
    `insert into project_aws_connections
       (project_id, tenant_id, external_id, method, role_arn,
        last_test_result, last_tested_at, verified_account_id, verified_arn,
        org_connection_revision)
     values ($1, $2, $3, 'assume_role', 'arn:aws:iam::444455556666:role/NightWatchReadOnly',
        'passed', now(), '444455556666',
        'arn:aws:sts::444455556666:assumed-role/NightWatchReadOnly/NightWatchConnectionTest', 0)`,
    [project, org, `nw-project-e2e-${run}`],
  );
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [org]);
  } finally {
    await database.close();
  }
});

test("F-013 AC-01..AC-07 AC-10 owner tests, saves and disconnects the Organization account", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(`/organizations/${org}/aws`);
  await expect(page.getByTestId(AWS_LEAF)).toBeVisible();
  await expect(page.getByTestId("aws-connection-status")).toHaveText(
    "ยังไม่เชื่อมต่อ",
  );

  // AC-01: generated on first open, in the agreed format.
  const externalId =
    (await page.getByTestId("aws-external-id").textContent()) ?? "";
  expect(externalId).toMatch(/^nw-org-[a-z0-9-]{0,40}-[a-z2-7]{26}$/);

  // AC-02: the policy names NightWatch's principal and this External ID; it is
  // pasted into fakecloud unchanged, as an admin would paste it into AWS.
  const policy =
    (await page.getByTestId("aws-trust-policy").textContent()) ?? "";
  expect(policy).toContain(NIGHTWATCH_SOURCE.arn);
  expect(policy).toContain(externalId);
  const hub = await createAdmin(HUB_ACCOUNT, `hub-${run}`);
  const roleArn = await createRole(hub, `Hub-${run}`, policy);
  const wrongExternalIdArn = await createRole(
    hub,
    `WrongExternalId-${run}`,
    policy.replace(externalId, `nw-org-other-${run}`),
  );

  const input = page.getByTestId("aws-role-arn");
  const testButton = page.getByTestId("aws-connection-test");
  const save = page.getByTestId("aws-connection-save");

  // AC-03: wrong ExternalId and wrong account fail with a Thai reason, no AWS text.
  for (const arn of [
    wrongExternalIdArn,
    `arn:aws:iam::333333333333:role/Hub-${run}`,
  ]) {
    await input.fill(arn);
    await testButton.click();
    await expect(page.getByTestId("aws-test-reason")).toHaveText(
      "AWS ปฏิเสธการ assume role ตรวจ Role ARN, trust policy และ External ID ในบัญชีกลาง",
    );
    await expect(save).toBeDisabled();
  }

  // AC-03, AC-10: a pass is shown as unsaved, in Caution, never as connected.
  await input.fill(roleArn);
  await testButton.click();
  const result = page.getByTestId("aws-connection-result");
  await expect(result).toContainText("ทดสอบผ่าน · ยังไม่บันทึก");
  await expect(result.getByTestId("aws-test-account")).toHaveText(HUB_ACCOUNT);
  await expect(page.getByTestId("aws-connection-status")).toHaveText(
    "ยังไม่เชื่อมต่อ",
  );
  await expect(save).toBeEnabled();
  await themedShots(page, "f013-test-passed-unsaved");

  // AC-04: editing the ARN voids the result; restoring it needs a new test.
  await input.fill(`${roleArn}x`);
  await expect(save).toBeDisabled();
  await input.fill(roleArn);
  await expect(save).toBeDisabled();
  await testButton.click();
  await expect(result).toContainText("ทดสอบผ่าน · ยังไม่บันทึก");

  // AC-04: the server re-tests and saves.
  await save.click();
  await expect(page.getByTestId("aws-connection-saved")).toBeVisible();
  await expect(page.getByTestId("aws-connection-status")).toHaveText(
    "เชื่อมต่อแล้ว",
  );
  await expect(page.getByTestId("aws-connection-role-arn")).toHaveText(roleArn);
  await expect(page.getByTestId("aws-connection-account")).toHaveText(
    HUB_ACCOUNT,
  );

  // AC-01: reopening keeps the External ID; AC-07: the Project row is history.
  await page.reload();
  await expect(page.getByTestId("aws-external-id")).toHaveText(externalId);
  const projectStatus = page.getByTestId("aws-project-status");
  await expect(projectStatus).toContainText("ผลเก่า");
  await expect(projectStatus).toContainText(
    "ต้องทดสอบใหม่กับบัญชีกลางปัจจุบัน",
  );
  await themedShots(page, "f013-connected");

  // AC-06: the dialog names the affected count; cancel changes nothing.
  const disconnect = page.getByTestId("aws-connection-disconnect");
  await disconnect.click();
  const dialog = page.getByTestId("aws-disconnect-dialog");
  await expect(dialog.getByTestId("aws-disconnect-impact")).toContainText(
    "โปรเจกต์ที่ใช้บัญชีกลาง 1 โปรเจกต์",
  );
  await expect(dialog.getByTestId("confirmation-cancel")).toBeFocused();
  await dialog.getByTestId("confirmation-cancel").click();
  await expect(dialog).toBeHidden();
  await expect(disconnect).toBeFocused();
  await page.reload();
  await expect(page.getByTestId("aws-connection-status")).toHaveText(
    "เชื่อมต่อแล้ว",
  );

  // AC-01, AC-06: confirming clears the connection and keeps the External ID.
  await page.getByTestId("aws-connection-disconnect").click();
  await page.getByTestId("aws-disconnect-confirm").click();
  await expect(page.getByTestId("aws-connection-disconnected")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "บัญชี AWS กลางขององค์กร" }),
  ).toBeFocused();
  await expect(page.getByTestId("aws-connection-status")).toHaveText(
    "ยังไม่เชื่อมต่อ",
  );
  await expect(page.getByTestId("aws-external-id")).toHaveText(externalId);
  await expect(page.getByTestId("aws-project-status")).toContainText(
    "ต้องตั้งค่าบัญชีกลางแล้วทดสอบใหม่",
  );
});

test("F-013 AC-08 a viewer has no menu entry, a denied page and a 403 without settings", async ({
  page,
}) => {
  await signIn(page, viewer);
  // Neither the route loader nor the page may ask for the settings (WEB-04).
  const settingsRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/organizations\/[^/]+\/aws-connection/.test(request.url()))
      settingsRequests.push(request.url());
  });
  await page.goto(`/organizations/${org}/aws`);
  await expect(page.getByTestId("aws-denied-message")).toHaveText(
    "เฉพาะเจ้าของและผู้ดูแลองค์กรจัดการการเชื่อมต่อ AWS ได้",
  );
  await expect(page.getByTestId(AWS_LEAF)).toHaveCount(0);
  await expect(page.getByTestId("aws-external-id")).toHaveCount(0);
  expect(settingsRequests).toEqual([]);

  const session = await signInApi(viewer);
  const read = await session.request(
    "GET",
    `/api/organizations/${org}/aws-connection`,
  );
  expect(read.status).toBe(403);
  expect(JSON.stringify(read.body)).not.toContain("nw-org-");
  const tested = await session.request(
    "POST",
    `/api/organizations/${org}/aws-connection/test`,
    { roleArn: `arn:aws:iam::${HUB_ACCOUNT}:role/Hub-${run}`, revision: 0 },
  );
  expect(tested.status).toBe(403);
});
