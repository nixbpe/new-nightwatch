import {
  monitorResponseTimesResponseSchema,
  monitorWriteResponseSchema,
} from "../../packages/api-contract/src/monitor.ts";
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Locator } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import { startMonitorTarget } from "../support/monitor-target.mjs";
import {
  addMember,
  addProjectMember,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  createProject,
  databaseOwnerUrl,
  monitorPath,
  monitorUrl,
  shot,
  signInApi,
  targetHostname,
  type ApiSession,
  type Person,
  type Role,
} from "../support/monitor-fixtures";

// UI side of AC-02, AC-03, AC-20 to AC-23 and AC-49: role x screen table,
// two sessions changing a role, keyboard flows in both themes, and reflow at a
// 640 px viewport (200% of a 1280 px layout, LAY-02).
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let target: Target;
let probe: Target;
let host: string;
let orgA: string;
let orgB: string;
let projA: string;
let monitorId: string;
let ownerSession: ApiSession;
const people = {} as Record<
  Role | "nonmember" | "demoted" | "removed" | "projectAdmin" | "outsider",
  Person
>;
const memberIds = {} as Record<string, string>;
const userIds: string[] = [];
const monitorName = `access-${run}`;
const orgNameA = `E2E Access A ${run}`;
const orgNameB = `E2E Access B ${run}`;

const urlOf = (server: Target, path: string) =>
  `http://${host}:${String(server.port)}${path}`;

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
  host = targetHostname();
  target = await startMonitorTarget();
  probe = await startMonitorTarget();
  orgA = await createOrganization(pool, orgNameA);
  orgB = await createOrganization(pool, orgNameB);
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    people[role] = await createPerson(pool, role, orgA);
    userIds.push(people[role].userId);
    memberIds[role] = await addMember(pool, orgA, people[role].userId, role);
  }
  for (const key of ["demoted", "removed"] as const) {
    people[key] = await createPerson(pool, key, orgA);
    userIds.push(people[key].userId);
    memberIds[key] = await addMember(pool, orgA, people[key].userId, "admin");
  }
  // A Project admin who is only an Organization viewer, and a viewer outside the Project.
  for (const key of ["projectAdmin", "outsider"] as const) {
    people[key] = await createPerson(pool, key, orgA);
    userIds.push(people[key].userId);
    memberIds[key] = await addMember(pool, orgA, people[key].userId, "viewer");
  }
  projA = await createProject(pool, orgA, `E2E Access ${run}`);
  for (const key of ["viewer", "auditor", "demoted", "removed"] as const) {
    await addProjectMember(pool, orgA, projA, people[key].userId, "member");
  }
  await addProjectMember(
    pool,
    orgA,
    projA,
    people.projectAdmin.userId,
    "admin",
  );
  people.nonmember = await createPerson(pool, "nonmember", orgB);
  userIds.push(people.nonmember.userId);
  await addMember(pool, orgB, people.nonmember.userId, "owner");
  await addMember(pool, orgB, people.owner.userId, "owner");

  ownerSession = await signInApi(people.owner);
  const created = await ownerSession.request("POST", monitorPath(orgA, projA), {
    ...basicConfig(monitorName, urlOf(target, "/health")),
    clientRequestId: randomUUID(),
  });
  expect(created.status).toBe(201);
  monitorId = monitorWriteResponseSchema.parse(created.body).monitor.id;
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [orgA, orgB]);
  } finally {
    await database.close();
    await target.close();
    await probe.close();
  }
});

const overview = () => monitorUrl(orgA, projA);
const detail = () => `${overview()}/${monitorId}`;

test.describe("monitor permissions by role and screen", () => {
  // Write access is the Project admin's and the Organization Owner's and Admin's (AC-03);
  // the viewer and the auditor read as Project members, the Project admin is only a viewer of the Organization.
  for (const role of [
    "owner",
    "admin",
    "projectAdmin",
    "viewer",
    "auditor",
  ] as const) {
    test(`${role}: Overview, Detail, new and edit screens`, async ({
      page,
    }) => {
      const writes =
        role === "owner" || role === "admin" || role === "projectAdmin";
      await signIn(page, people[role]);

      await page.goto(overview());
      await expect(
        page.getByTestId(`monitor-list-name-${monitorId}`),
      ).toHaveText(monitorName);
      await expect(page.getByTestId("monitor-overview-add")).toHaveCount(
        writes ? 1 : 0,
      );
      await expect(page.getByTestId("monitor-overview-readonly")).toHaveCount(
        writes ? 0 : 1,
      );

      await page.goto(detail());
      await expect(page.getByTestId("monitor-detail-title")).toHaveText(
        monitorName,
      );
      await expect(page.getByTestId("monitor-detail-url")).toHaveText(
        urlOf(target, "/health"),
      );
      await expect(page.getByTestId("monitor-detail-edit")).toHaveCount(
        writes ? 1 : 0,
      );
      await expect(page.getByTestId("monitor-detail-toggle")).toHaveCount(
        writes ? 1 : 0,
      );
      await expect(page.getByTestId("monitor-detail-delete")).toHaveCount(
        writes ? 1 : 0,
      );

      const hits = probe.hits.length;
      for (const path of ["/new", `/${monitorId}/edit`]) {
        await page.goto(`${overview()}${path}`);
        if (writes) {
          await expect(page.getByTestId("monitor-form-test")).toBeVisible();
        } else {
          await expect(page.getByTestId("monitor-form-denied")).toBeVisible();
          await expect(page.getByTestId("monitor-form-denied")).toHaveText(
            /\S/,
          );
          await expect(page.getByTestId("monitor-form-test")).toHaveCount(0);
        }
      }
      expect(probe.hits.length).toBe(hits);
    });
  }

  test("an Organization viewer outside the Project gets the not-found state and no monitor data", async ({
    page,
  }) => {
    await signIn(page, people.outsider);
    await page.goto(overview());
    await expect(
      page.getByTestId("monitor-overview-project-gone"),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
    await page.goto(detail());
    await expect(page.getByTestId("monitor-detail-not-found")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
    await page.goto(`${overview()}/new`);
    await expect(page.getByTestId("monitor-form-project-gone")).toBeVisible();
    await expect(page.getByTestId("monitor-form-test")).toHaveCount(0);
    const session = await signInApi(people.outsider);
    const read = await session.request("GET", monitorPath(orgA, projA));
    expect(read.status).toBe(404);
  });

  test("non-member sees a denied state and no monitor data", async ({
    page,
  }) => {
    await signIn(page, people.nonmember);
    await page.goto(overview());
    // The denied state must be on screen before the absence checks mean anything.
    await expect(page.getByTestId("monitor-overview-denied")).toBeVisible();
    await expect(page.getByTestId("monitor-overview-denied")).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(host);
    await page.goto(detail());
    await expect(page.getByTestId("monitor-detail-denied")).toBeVisible();
    await expect(page.getByTestId("monitor-detail-denied")).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(host);
    await page.goto(`${overview()}/new`);
    await expect(page.getByTestId("monitor-form-denied")).toBeVisible();
    await expect(page.getByTestId("monitor-form-denied")).toHaveText(/\S/);
    await expect(page.getByTestId("monitor-form-test")).toHaveCount(0);
  });
});

test.describe("monitor role changes across signed-in sessions", () => {
  test("form, Detail and dialog refuse after a demotion and keep typed values", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const saveForm = await context.newPage();
    const testForm = await context.newPage();
    const view = await context.newPage();
    const dialogPage = await context.newPage();
    await signIn(saveForm, people.demoted);

    for (const page of [saveForm, testForm]) {
      await page.goto(`${overview()}/new`);
      await page.getByTestId("monitor-form-name").fill("typed before demotion");
      await page.getByTestId("monitor-form-url").fill(urlOf(probe, "/typed"));
    }
    await view.goto(detail());
    await expect(view.getByTestId("monitor-detail-title")).toHaveText(
      monitorName,
    );
    await dialogPage.goto(detail());
    await dialogPage.getByTestId("monitor-detail-delete").click();
    const dialog = dialogPage.getByTestId("monitor-detail-delete-dialog");
    await expect(dialog).toBeVisible();

    // Second session: the owner demotes the first user to viewer.
    const demotion = await ownerSession.request(
      "PATCH",
      `/api/organizations/${orgA}/members/${memberIds.demoted}/role`,
      { role: "viewer" },
    );
    expect(demotion.status).toBe(200);

    const before = await pool.query(
      "select count(*)::int n, max(version)::int v from monitors where tenant_id = $1",
      [orgA],
    );
    const hits = probe.hits.length;

    await saveForm.getByTestId("monitor-form-save").click();
    await expect(
      saveForm.getByTestId("monitor-form-role-changed"),
    ).toBeVisible();
    await expect(saveForm.getByTestId("monitor-form-role-changed")).toHaveText(
      /\S/,
    );
    await expect(saveForm.getByTestId("monitor-form-name")).toHaveValue(
      "typed before demotion",
    );

    await testForm.getByTestId("monitor-form-test").click();
    await expect(
      testForm.getByTestId("monitor-form-role-changed"),
    ).toBeVisible();
    await expect(testForm.getByTestId("monitor-form-role-changed")).toHaveText(
      /\S/,
    );
    await expect(testForm.getByTestId("monitor-form-url")).toHaveValue(
      urlOf(probe, "/typed"),
    );

    await view.getByTestId("monitor-detail-toggle").click();
    await expect(view.getByTestId("monitor-detail-action-error")).toBeVisible();
    await expect(view.getByTestId("monitor-detail-action-error")).toHaveText(
      /\S/,
    );

    await dialog.getByTestId("monitor-detail-delete-confirm").click();
    await expect(
      dialogPage.getByTestId("monitor-detail-action-error"),
    ).toBeVisible();
    await expect(
      dialogPage.getByTestId("monitor-detail-action-error"),
    ).toHaveText(/\S/);

    const after = await pool.query(
      "select count(*)::int n, max(version)::int v, bool_or(status = 'paused') paused from monitors where tenant_id = $1",
      [orgA],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(after.rows[0].v).toBe(before.rows[0].v);
    expect(after.rows[0].paused).toBe(false);
    expect(probe.hits.length).toBe(hits);

    // The user is then removed: Detail shows a denied state with no cached data.
    const removal = await ownerSession.request(
      "DELETE",
      `/api/organizations/${orgA}/members/${memberIds.demoted}`,
    );
    expect(removal.status).toBeLessThan(300);
    await view.reload();
    await expect(view.getByTestId("monitor-detail-denied")).toBeVisible();
    await expect(view.getByTestId("monitor-detail-denied")).toHaveText(/\S/);
    await expect
      .poll(() => view.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
    await expect
      .poll(() => view.evaluate(() => document.body.textContent))
      .not.toContain(host);
    await context.close();
  });

  test("removal while Detail and the form are open leaves no data behind", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const view = await context.newPage();
    const form = await context.newPage();
    await signIn(view, people.removed);
    await view.goto(detail());
    await expect(view.getByTestId("monitor-detail-title")).toHaveText(
      monitorName,
    );
    await form.goto(`${overview()}/${monitorId}/edit`);
    await expect(form.getByTestId("monitor-form-name")).toHaveValue(
      monitorName,
    );
    await form.getByTestId("monitor-form-name").fill(`${monitorName}-removed`);
    const stored = () =>
      pool.query("select name, version from monitors where id = $1", [
        monitorId,
      ]);
    const before = (await stored()).rows[0];

    const removal = await ownerSession.request(
      "DELETE",
      `/api/organizations/${orgA}/members/${memberIds.removed}`,
    );
    expect(removal.status).toBeLessThan(300);

    // A background refresh may already have locked the form; either way it must refuse.
    const saveEdit = form.getByTestId("monitor-form-save");
    if (await saveEdit.isEnabled()) await saveEdit.click();
    await expect
      .poll(
        async () =>
          (await form.getByTestId("monitor-form-role-changed").isVisible()) ||
          (await form.getByTestId("monitor-form-denied").isVisible()),
      )
      .toBe(true);
    // The refused save changed nothing.
    expect((await stored()).rows[0]).toEqual(before);
    await view.reload();
    await expect(view.getByTestId("monitor-detail-denied")).toBeVisible();
    await expect(view.getByTestId("monitor-detail-denied")).toHaveText(/\S/);
    await expect
      .poll(() => view.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
    await expect
      .poll(() => view.evaluate(() => document.body.textContent))
      .not.toContain(host);
    await context.close();
  });

  test("Organization switch on the Edit page leaves it for the new Organization", async ({
    page,
  }) => {
    await signIn(page, people.owner);
    await page.goto(`${overview()}/${monitorId}/edit`);
    await expect(page.getByTestId("monitor-form-name")).toHaveValue(
      monitorName,
    );
    await page.getByTestId("shell-organization-switch").click();
    await page
      .getByTestId("shell-organization-menu")
      .getByTestId(`shell-organization-${orgB}`)
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/organizations/${orgB}/projects$`),
    );
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(monitorName);
  });
});

async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  await expect(target).toBeFocused();
}

async function addHeader(page: Page) {
  const rows = page.getByTestId(/^monitor-form-header-row-/);
  const before = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")),
  );
  await page.getByTestId("monitor-form-add-header").click();
  const after = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")),
  );
  const added = after.filter((id) => id !== null && !before.includes(id));
  expect(added).toHaveLength(1);
  const id = added.pop();
  if (id === null || id === undefined)
    throw new Error("Added header has no public editor key");
  return page.getByTestId(id);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`monitor keyboard navigation and screen structure in the ${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    test("Overview: Tab order, filter announcement, table name, status words", async ({
      page,
    }) => {
      await signIn(page, people.owner);
      await page.goto(overview());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByTestId(`monitor-list-name-${monitorId}`),
      ).toHaveText(monitorName);
      await shot(page, `overview-${theme}`);
      // The shared DataTable puts the label on the scroll region around the table.
      await expect(
        page
          .getByTestId("monitor-overview-table-region")
          .getByTestId("monitor-overview-table"),
      ).toBeVisible();

      await expect(
        page.getByTestId("monitor-overview-table-region"),
      ).toHaveAccessibleName(/\S/);
      await page.getByTestId("monitor-overview-heading").click();
      await tabTo(page, page.getByTestId("monitor-overview-add"));
      await tabTo(page, page.getByTestId("monitor-overview-refresh"));
      await tabTo(page, page.getByTestId("monitor-overview-search"));
      await tabTo(page, page.getByTestId("monitor-overview-health-all"));
      await tabTo(page, page.getByTestId(`monitor-list-name-${monitorId}`));
      await expect(
        page.getByTestId("monitor-overview-health-all"),
      ).toHaveAttribute("aria-pressed", "true");

      await page.getByTestId("monitor-overview-search").fill(monitorName);
      await expect(
        page.getByTestId("monitor-overview-announcement"),
      ).toHaveText(/\S/);
      await expect(
        page.getByTestId("monitor-overview-announcement"),
      ).toContainText(/1/);
      await expect(
        page
          .getByTestId(`monitor-list-row-${monitorId}`)
          .getByTestId("monitor-list-health"),
      ).toHaveText(/\S/);
    });

    test("Form: first invalid field takes focus, errors are described, Test keeps focus, radiogroup uses arrows, rows are named", async ({
      page,
    }) => {
      await signIn(page, people.owner);
      await page.goto(`${overview()}/new`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      await page.getByTestId("monitor-form-save").click();
      const name = page.getByTestId("monitor-form-name");
      await expect(name).toBeFocused();
      const describedBy = await name.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      await expect(
        page.locator(`#${describedBy!.split(" ")[0]!}`),
      ).not.toBeEmpty();

      await name.fill(`kbd-${run}`);
      await page.getByTestId("monitor-form-url").fill(urlOf(target, "/health"));
      const testButton = page.getByTestId("monitor-form-test");
      await testButton.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
      await expect(page.getByTestId("monitor-test-result")).toHaveText(/\S/);
      await expect(testButton).toBeFocused();
      await shot(page, `form-test-result-${theme}`);

      const interval = page.getByTestId("monitor-form-interval-300");
      await expect(interval).toHaveAttribute("aria-checked", "true");
      await interval.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByTestId("monitor-form-interval-900"),
      ).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("monitor-form-interval-900")).toBeFocused();
      await expect(interval).toHaveAttribute("aria-checked", "false");

      await page.getByTestId("monitor-form-mode-advanced").click();
      const first = await addHeader(page);
      await expect(first.getByTestId("monitor-form-header-name")).toBeFocused();
      await expect(
        first.getByTestId("monitor-form-header-name"),
      ).toHaveAccessibleName(/\S/);
      const second = await addHeader(page);
      await expect(
        second.getByTestId("monitor-form-header-name"),
      ).toBeFocused();
      await expect(
        second.getByTestId("monitor-form-header-name"),
      ).toHaveAccessibleName(/\S/);
      await expect(second.getByTestId("monitor-form-row-remove")).toBeVisible();
      await first.getByTestId("monitor-form-row-remove").click();
      await expect(first).toHaveCount(0);
      await expect(
        second.getByTestId("monitor-form-header-name"),
      ).toBeFocused();
    });

    test("Detail: headings in order, chart table, Delete dialog focus, Pause keeps focus", async ({
      page,
    }) => {
      await expect
        .poll(
          async () => {
            const reply = await ownerSession.request(
              "GET",
              monitorPath(
                orgA,
                projA,
                `/${monitorId}/response-times?range=24h`,
              ),
            );
            expect(reply.status).toBe(200);
            const series = monitorResponseTimesResponseSchema.parse(reply.body);
            return (
              series.range === "24h" &&
              series.points.some((point) => point.responseTimeMs !== null)
            );
          },
          { timeout: test.info().timeout },
        )
        .toBe(true);
      await signIn(page, people.owner);
      const seriesResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            monitorPath(orgA, projA, `/${monitorId}/response-times`) &&
          new URL(response.url()).searchParams.get("range") === "24h" &&
          response.status() === 200,
      );
      await page.goto(detail());
      const browserSeries = monitorResponseTimesResponseSchema.parse(
        await (await seriesResponse).json(),
      );
      expect(browserSeries).toMatchObject({
        range: "24h",
        points: expect.arrayContaining([
          expect.objectContaining({ responseTimeMs: expect.any(Number) }),
        ]),
      });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByTestId("monitor-detail-title")).toHaveText(
        monitorName,
      );
      const headings = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length,
        h2: document.querySelectorAll("h2").length,
      }));
      await shot(page, `detail-${theme}`);
      expect(headings.h2).toBeGreaterThanOrEqual(6);
      expect(headings.h1).toBe(1);
      // The chart's alternative is a real table opened from the keyboard.
      const toggle = page.getByTestId("monitor-response-toggle");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("monitor-response-table")).toBeVisible();

      const pause = page.getByTestId("monitor-detail-toggle");
      await pause.focus();
      await page.keyboard.press("Enter");
      const resume = page.getByTestId("monitor-detail-toggle");
      await expect(resume).toHaveAttribute("data-status", "paused");
      await expect(resume).toHaveAttribute("data-in-progress", "false");
      await expect(resume).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("monitor-detail-toggle")).toHaveAttribute(
        "data-status",
        "active",
      );
      await expect(page.getByTestId("monitor-detail-toggle")).toBeFocused();

      const opener = page.getByTestId("monitor-detail-delete");
      await opener.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByTestId("monitor-detail-delete-dialog");
      await expect(dialog.getByTestId("confirmation-cancel")).toBeFocused();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    test("Delete confirm returns focus to the Overview heading", async ({
      page,
    }) => {
      const created = await ownerSession.request(
        "POST",
        monitorPath(orgA, projA),
        {
          ...basicConfig(
            `disposable-${theme}-${run}`,
            urlOf(target, "/health"),
          ),
          clientRequestId: randomUUID(),
        },
      );
      const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
      await signIn(page, people.owner);
      await page.goto(`${overview()}/${id}`);
      await page.getByTestId("monitor-detail-delete").focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByTestId("monitor-detail-delete-dialog");
      await dialog.getByTestId("monitor-detail-delete-confirm").click();
      await expect(page).toHaveURL(new RegExp(`${overview()}$`));
      await expect
        .poll(() => page.evaluate(() => window.history.state?.usr))
        .toBeNull();
      await expect(page.getByTestId("monitor-overview-notice")).toBeVisible();
      await expect(page.getByTestId("monitor-overview-notice")).toHaveText(
        /\S/,
      );
      await expect(page.getByTestId("monitor-overview-heading")).toBeFocused();
    });
  });
}

test.describe("reflow at 200% (640 px viewport, LAY-02)", () => {
  test.use({ viewport: { width: 640, height: 900 } });
  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: no sideways page scroll, actions and labels remain`, async ({
      page,
      context,
    }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
      await signIn(page, people.owner);
      for (const path of [
        overview(),
        detail(),
        `${overview()}/new`,
        `${overview()}/${monitorId}/edit`,
      ]) {
        await page.goto(path);
        if (path === overview()) {
          await expect(page.getByTestId("monitor-overview-add")).toBeVisible();
          await expect(
            page.getByTestId("monitor-overview-refresh"),
          ).toBeVisible();
        } else if (path === detail()) {
          await expect(page.getByTestId("monitor-detail-edit")).toBeVisible();
          await expect(page.getByTestId("monitor-detail-toggle")).toBeVisible();
          await expect(page.getByTestId("monitor-detail-delete")).toBeVisible();
        } else {
          await expect(page.getByTestId("monitor-form-test")).toBeVisible();
          await expect(page.getByTestId("monitor-form-save")).toBeVisible();
          await expect(
            page.getByTestId("monitor-form-name"),
          ).toHaveAccessibleName(/\S/);
          await expect(
            page.getByTestId("monitor-form-url"),
          ).toHaveAccessibleName(/\S/);
        }
        await shot(
          page,
          `reflow-640-${theme}-${path.endsWith("/new") ? "new" : path.endsWith("/edit") ? "edit" : path.includes(monitorId) ? "detail" : "overview"}`,
          true,
        );
      }
    });
  }
});
