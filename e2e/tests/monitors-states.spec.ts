import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Locator } from "@playwright/test";

import {
  monitorResponseTimesResponseSchema,
  monitorWriteResponseSchema,
} from "../../packages/api-contract/src/monitor.ts";
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

// Browser evidence for the scope, state and concurrency rows that need no long
// schedule wait: AC-01, AC-04, AC-06, AC-07, AC-09, AC-10, AC-18, AC-40, AC-50.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startMonitorTarget>>;
let target: Target;
let host: string;
let orgA: string;
let orgEmpty: string;
let orgOther: string;
let projA: string;
let projEmpty: string;
let projOther: string;
let owner: Person;
let ownerSession: ApiSession;
let monitorId: string;
let otherMonitorId: string;
const people = {} as Record<Role, Person>;
const userIds: string[] = [];
// Organizations that single tests create; the afterAll removes them even when a test fails.
const extraOrgs: string[] = [];
const monitorName = `states-${run}`;

const urlOf = (path: string) => `http://${host}:${String(target.port)}${path}`;
const overview = () => monitorUrl(orgA, projA);

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
  orgA = await createOrganization(pool, `E2E States A ${run}`);
  orgEmpty = await createOrganization(pool, `E2E States Empty ${run}`);
  orgOther = await createOrganization(pool, `E2E States Other ${run}`);
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    people[role] = await createPerson(pool, role, orgA);
    userIds.push(people[role].userId);
    await addMember(pool, orgA, people[role].userId, role);
  }
  owner = people.owner;
  await addMember(pool, orgEmpty, owner.userId, "owner");
  await addMember(pool, orgOther, owner.userId, "owner");
  // Monitors live in a Project; the viewer and the auditor read it as Project members.
  projA = await createProject(pool, orgA, `E2E States A ${run}`);
  projEmpty = await createProject(pool, orgEmpty, `E2E States Empty ${run}`);
  projOther = await createProject(pool, orgOther, `E2E States Other ${run}`);
  for (const role of ["viewer", "auditor"] as const) {
    await addProjectMember(pool, orgA, projA, people[role].userId, "member");
  }
  ownerSession = await signInApi(owner);
  const created = await ownerSession.request("POST", monitorPath(orgA, projA), {
    ...basicConfig(monitorName, urlOf("/health")),
    clientRequestId: randomUUID(),
  });
  monitorId = monitorWriteResponseSchema.parse(created.body).monitor.id;
  const other = await ownerSession.request(
    "POST",
    monitorPath(orgOther, projOther),
    {
      ...basicConfig(`foreign-${run}`, urlOf("/health")),
      clientRequestId: randomUUID(),
    },
  );
  otherMonitorId = monitorWriteResponseSchema.parse(other.body).monitor.id;
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [orgA, orgEmpty, orgOther, ...extraOrgs]);
  } finally {
    await database.close();
    await target.close();
  }
});

async function expectKpis(
  card: Locator,
  p50: string | null,
  p95: string | null,
  checks: string,
  failed: string,
) {
  if (p50 === null) {
    await expect(card.getByTestId("monitor-response-p50")).toHaveAttribute(
      "data-value-code",
      "",
    );
    await expect(card.getByTestId("monitor-response-p50")).toHaveText(/\S/);
  } else await expect(card.getByTestId("monitor-response-p50")).toHaveText(p50);
  if (p95 === null) {
    await expect(card.getByTestId("monitor-response-p95")).toHaveAttribute(
      "data-value-code",
      "",
    );
    await expect(card.getByTestId("monitor-response-p95")).toHaveText(/\S/);
  } else await expect(card.getByTestId("monitor-response-p95")).toHaveText(p95);
  await expect(card.getByTestId("monitor-response-checks")).toHaveText(checks);
  await expect(card.getByTestId("monitor-response-failed")).toHaveText(failed);
}

test.describe("leaf in the sidebar and the command palette", () => {
  for (const role of ["owner", "admin", "viewer", "auditor"] as Role[]) {
    test(`${role}: leaf is present, active on every sub-route, found by the palette`, async ({
      page,
    }) => {
      await signIn(page, people[role]);
      const nav = page.getByTestId("shell-navigation");
      let searchTerm = "";
      for (const path of ["", "/new", `/${monitorId}`, `/${monitorId}/edit`]) {
        await page.goto(`${overview()}${path}`);
        const leaf = nav.getByTestId(
          "shell-nav-/organizations/:organizationId/projects/:projectId/monitors",
        );
        await expect(leaf).toBeVisible();
        await expect(leaf).toHaveAttribute("aria-current", "page");
        await expect(leaf).toHaveAttribute("href", overview());
        searchTerm = await leaf.evaluate((link) => {
          const label = link.cloneNode(true);
          if (label instanceof Element) {
            label
              .querySelectorAll('[aria-hidden="true"]')
              .forEach((hidden) => hidden.remove());
          }
          return label.textContent?.trim() ?? "";
        });
        expect(searchTerm).not.toBe("");
      }
      await page.goto("/workspace");
      await expect(nav).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.getByTestId("shell-command-dialog");
      await expect(palette).toBeVisible();
      await palette.getByTestId("shell-command-query").fill(searchTerm);
      await expect(
        palette.getByTestId(`shell-command-option-${overview()}`),
      ).toBeVisible();
    });
  }
});

test.describe("Overview states", () => {
  test("first-run empty, filtered empty, loading, error with retry, stale warning", async ({
    page,
  }) => {
    await signIn(page, owner);

    await page.goto(monitorUrl(orgEmpty, projEmpty));
    await expect(page.getByTestId("monitor-overview-empty")).toBeVisible();
    await expect(page.getByTestId("monitor-overview-empty")).toHaveText(/\S/);
    await expect(page.getByTestId("monitor-overview-empty-add")).toBeVisible();

    const listUrl =
      /\/api\/organizations\/[^/]+\/projects\/[^/]+\/monitors(\?.*)?$/;
    let failList = true;
    let delayMs = 1500;
    await page.route(listUrl, async (route) => {
      if (failList) {
        await route.abort();
        return;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
    await page.goto(overview());
    // A failed load is an error with a retry, never an empty list.
    await expect(page.getByTestId("monitor-overview-error")).toBeVisible();
    await expect(page.getByTestId("monitor-overview-error")).toHaveText(/\S/);
    await expect(page.getByTestId("monitor-overview-empty")).toHaveCount(0);
    failList = false;
    await page.getByTestId("monitor-overview-retry").click();
    await expect(
      page.getByTestId(`monitor-list-name-${monitorId}`),
    ).toBeVisible();

    await page.getByTestId("monitor-overview-search").fill(`no-such-${run}`);
    await expect(
      page.getByTestId("monitor-overview-filtered-empty"),
    ).toBeVisible();
    await expect(
      page.getByTestId("monitor-overview-filtered-empty"),
    ).toHaveText(/\S/);
    await page.getByTestId("monitor-overview-search").fill("");
    await expect(
      page.getByTestId(`monitor-list-name-${monitorId}`),
    ).toBeVisible();

    // Loading: a slow list shows the loading state first.
    delayMs = 6000;
    // "commit" returns before the dev server finishes loading modules, which can
    // outlast the delay and hide the loading state.
    await page.reload({ waitUntil: "commit" });
    // The route loader fetches the list first, so the shell shows its page-opening status.
    await expect(page.getByTestId("route-opening-status")).toBeVisible();
    await expect(page.getByTestId("route-opening-status")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(page.getByTestId("route-opening-status")).toHaveText(/\S/);
    await expect(
      page.getByTestId(`monitor-list-name-${monitorId}`),
    ).toBeVisible({
      timeout: 15_000,
    });

    // Stale: a refresh that fails keeps the data and warns.
    delayMs = 0;
    failList = true;
    await page.getByTestId("monitor-overview-refresh").click();
    await expect(
      page.getByTestId("monitor-overview-refetch-error"),
    ).toBeVisible();
    await expect(page.getByTestId("monitor-overview-refetch-error")).toHaveText(
      /\S/,
    );
    await expect(
      page.getByTestId(`monitor-list-name-${monitorId}`),
    ).toBeVisible();
  });
});

test.describe("create form", () => {
  test("defaults, mode switch keeps values, validation beside the field, one monitor on a double click", async ({
    page,
  }) => {
    await signIn(page, owner);
    await page.goto(`${overview()}/new`);
    await expect(page.getByTestId("monitor-form-interval-300")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId(/^monitor-form-interval-/)).toHaveCount(3);
    await expect(page.getByTestId("monitor-form-interval-60")).toContainText(
      /\b1\b/,
    );
    await expect(page.getByTestId("monitor-form-interval-300")).toContainText(
      /\b5\b/,
    );
    await expect(page.getByTestId("monitor-form-interval-900")).toContainText(
      /\b15\b/,
    );
    await expect(page.getByTestId("monitor-form-interval-60")).toHaveAttribute(
      "role",
      "radio",
    );
    await expect(page.getByTestId("monitor-form-interval-900")).toHaveAttribute(
      "role",
      "radio",
    );
    await expect(
      page.getByTestId("monitor-form-status-summary"),
    ).toHaveAttribute("data-expected-status", "200-299");
    await expect(page.getByTestId("monitor-form-status-summary")).toContainText(
      "200-299",
    );

    await page.getByTestId("monitor-form-save").click();
    await expect(page.getByTestId("monitor-form-name")).toBeFocused();
    await expect(
      page.getByTestId("monitor-form-url"),
    ).toHaveAccessibleDescription(/.+/);

    await page.getByTestId("monitor-form-name").fill(`double-${run}`);
    await page.getByTestId("monitor-form-url").fill(urlOf("/health"));
    await page.getByTestId("monitor-form-interval-900").click();
    await page.getByTestId("monitor-form-mode-advanced").click();
    await page.getByTestId("monitor-form-mode-basic").click();
    await expect(page.getByTestId("monitor-form-name")).toHaveValue(
      `double-${run}`,
    );
    await expect(page.getByTestId("monitor-form-url")).toHaveValue(
      urlOf("/health"),
    );
    await expect(page.getByTestId("monitor-form-interval-900")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const save = page.getByTestId("monitor-form-save");
    await save.dblclick();
    await expect(page.getByTestId("monitor-detail-title")).toHaveText(
      `double-${run}`,
    );
    const count = await pool.query(
      "select count(*)::int n from monitors where tenant_id = $1 and name = $2",
      [orgA, `double-${run}`],
    );
    expect(count.rows[0].n).toBe(1);
  });

  test("a forbidden address is refused beside the URL field without any connection", async ({
    page,
  }) => {
    const isolatedTarget = await startMonitorTarget();
    try {
      await signIn(page, owner);
      await page.goto(`${overview()}/new`);
      const before = isolatedTarget.hits.length;
      await page.getByTestId("monitor-form-name").fill(`forbidden-${run}`);
      await page
        .getByTestId("monitor-form-url")
        .fill(`http://localhost:${String(isolatedTarget.port)}/health`);
      await page.getByTestId("monitor-form-save").click();
      await expect(page.getByTestId("monitor-form-url")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(
        page.getByTestId("monitor-form-url"),
      ).toHaveAccessibleDescription(/\S/);
      await expect(page.getByTestId("monitor-form-url")).toHaveValue(
        `http://localhost:${String(isolatedTarget.port)}/health`,
      );
      const count = await pool.query(
        "select count(*)::int n from monitors where tenant_id = $1 and name = $2",
        [orgA, `forbidden-${run}`],
      );
      expect(count.rows[0].n).toBe(0);
      expect(isolatedTarget.hits.length).toBe(before);
    } finally {
      await isolatedTarget.close();
    }
  });

  test("timeout and unresolvable host show their own messages, apart from the target's result", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signIn(page, owner);
    await page.goto(`${overview()}/new`);
    await page.getByTestId("monitor-form-name").fill(`timeout-${run}`);
    await page.getByTestId("monitor-form-mode-advanced").click();
    await page.getByTestId("monitor-form-timeout").fill("1");
    await page.getByTestId("monitor-form-url").fill(urlOf("/slow?ms=4000"));
    await page.getByTestId("monitor-form-test").click();
    await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failure-reason",
      "timeout",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-timeout-seconds",
      "1",
    );
    await expect(page.getByTestId("monitor-test-result")).toHaveText(/\S/);

    await page
      .getByTestId("monitor-form-url")
      .fill(`http://no-such-host-${run}.invalid/`);
    await page.getByTestId("monitor-form-test").click();
    await expect(page.getByTestId("monitor-test-result")).toHaveAttribute(
      "data-failure-reason",
      "dns_not_found",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("monitor-test-result")).toHaveText(/\S/);
  });
});

test.describe("edit, change and races", () => {
  test("a concurrent edit shows the conflict and keeps typed values", async ({
    browser,
  }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const a = await first.newPage();
    const b = await second.newPage();
    await signIn(a, owner);
    await signIn(b, owner);
    for (const page of [a, b]) {
      await page.goto(`${overview()}/${monitorId}/edit`);
      await expect(page.getByTestId("monitor-form-name")).toHaveValue(
        monitorName,
      );
    }
    await a.getByTestId("monitor-form-name").fill(`${monitorName}-a`);
    await a.getByTestId("monitor-form-save").click();
    await expect(a.getByTestId("monitor-detail-title")).toHaveText(
      `${monitorName}-a`,
    );
    await b.getByTestId("monitor-form-name").fill(`${monitorName}-b`);
    await b.getByTestId("monitor-form-save").click();
    await expect(b.getByTestId("monitor-form-conflict")).toBeVisible();
    await expect(b.getByTestId("monitor-form-conflict")).toHaveText(/\S/);
    await expect(b.getByTestId("monitor-form-name")).toHaveValue(
      `${monitorName}-b`,
    );
    const stored = await pool.query("select name from monitors where id = $1", [
      monitorId,
    ]);
    expect(stored.rows[0].name).toBe(`${monitorName}-a`);
    await first.close();
    await second.close();
    await pool.query("update monitors set name = $2 where id = $1", [
      monitorId,
      monitorName,
    ]);
  });

  test("an id of another Organization reads as not found on Detail and Edit", async ({
    page,
  }) => {
    await signIn(page, owner);
    for (const path of [
      `/${otherMonitorId}`,
      `/${otherMonitorId}/edit`,
      "/not-a-uuid",
    ]) {
      await page.goto(`${overview()}${path}`);
      const notFound = page.getByTestId(
        path.endsWith("/edit")
          ? "monitor-form-not-found"
          : "monitor-detail-not-found",
      );
      await expect(notFound).toBeVisible();
      await expect(notFound).toHaveText(/\S/);
    }
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(`foreign-${run}`);
  });

  test("editing the URL shows unknown until the new configuration has a result", async ({
    page,
  }) => {
    test.setTimeout(3 * 60_000);
    const created = await ownerSession.request(
      "POST",
      monitorPath(orgA, projA),
      {
        ...basicConfig(`change-${run}`, urlOf("/health")),
        clientRequestId: randomUUID(),
      },
    );
    const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
    await signIn(page, owner);
    await page.goto(`${overview()}/${id}`);
    await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health",
      "up",
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("monitor-detail-health")).toHaveText(/\S/);
    const upText = await page.getByTestId("monitor-detail-health").innerText();

    target.setDelay(8000);
    await page.getByTestId("monitor-detail-edit").click();
    await page.getByTestId("monitor-form-url").fill(urlOf("/health?changed=1"));
    await page.getByTestId("monitor-form-save").click();
    await expect(page.getByTestId("monitor-detail-notice")).toBeVisible();
    await expect(page.getByTestId("monitor-detail-notice")).toHaveText(/\S/);
    await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health",
      "unknown",
    );
    await expect(page.getByTestId("monitor-detail-health")).toHaveText(/\S/);
    await expect(page.getByTestId("monitor-detail-health")).not.toHaveText(
      upText,
    );
    target.setDelay(0);
    await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health",
      "up",
      { timeout: 90_000 },
    );
    await expect(page.getByTestId("monitor-detail-health")).toHaveText(upText);
  });

  test("deleting a monitor that another session deleted goes to Overview with the notice", async ({
    page,
  }) => {
    const created = await ownerSession.request(
      "POST",
      monitorPath(orgA, projA),
      {
        ...basicConfig(`raced-${run}`, urlOf("/health")),
        clientRequestId: randomUUID(),
      },
    );
    const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
    await signIn(page, owner);
    await page.goto(`${overview()}/${id}`);
    await page.getByTestId("monitor-detail-delete").click();
    const dialog = page.getByTestId("monitor-detail-delete-dialog");
    await expect(dialog).toBeVisible();
    const other = await ownerSession.request(
      "DELETE",
      monitorPath(orgA, projA, `/${id}`),
    );
    expect(other.status).toBeLessThan(300);
    await dialog.getByTestId("monitor-detail-delete-confirm").click();
    await expect(page).toHaveURL(new RegExp(`${overview()}$`));
    await expect(page.getByTestId("monitor-overview-notice")).toBeVisible();
    await expect(page.getByTestId("monitor-overview-notice")).toHaveText(/\S/);
  });

  test("a Detail left open shows not found after the monitor is deleted elsewhere", async ({
    page,
  }) => {
    const created = await ownerSession.request(
      "POST",
      monitorPath(orgA, projA),
      {
        ...basicConfig(`vanish-${run}`, urlOf("/health")),
        clientRequestId: randomUUID(),
      },
    );
    const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
    await signIn(page, owner);
    await page.goto(`${overview()}/${id}`);
    await expect(page.getByTestId("monitor-detail-title")).toHaveText(
      `vanish-${run}`,
    );
    await ownerSession.request("DELETE", monitorPath(orgA, projA, `/${id}`));
    await page.getByTestId("monitor-detail-toggle").click();
    await expect(page.getByTestId("monitor-detail-not-found")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("monitor-detail-not-found")).toHaveText(/\S/);
  });
});

test("the Test limit shows the wait from the server and disables the button", async ({
  page,
}) => {
  const org = await createOrganization(pool, `E2E Rate ${run}`);
  extraOrgs.push(org);
  const person = await createPerson(pool, "rate", org);
  userIds.push(person.userId);
  await addMember(pool, org, person.userId, "owner");
  const project = await createProject(pool, org, `E2E Rate ${run}`);
  const session = await signInApi(person);
  const config = basicConfig("rate", urlOf("/status/200"));
  for (let i = 0; i < 10; i++) {
    const reply = await session.request(
      "POST",
      monitorPath(org, project, "/test"),
      config,
    );
    expect(reply.status).toBe(200);
  }
  await signIn(page, person);
  await page.goto(monitorUrl(org, project, "/new"));
  await page.getByTestId("monitor-form-name").fill("rate");
  await page.getByTestId("monitor-form-url").fill(urlOf("/status/200"));
  const before = target.hits.length;
  await page.getByTestId("monitor-form-test").click();
  await expect(page.getByTestId("monitor-test-rateLimited")).toBeVisible();
  await expect(page.getByTestId("monitor-test-rateLimited")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-test-wait")).toBeVisible();
  const remaining = Number(
    await page
      .getByTestId("monitor-test-wait")
      .getAttribute("data-remaining-seconds"),
  );
  expect(remaining).toBeGreaterThan(0);
  await expect(page.getByTestId("monitor-test-wait")).toContainText(
    String(remaining),
  );
  await expect(page.getByTestId("monitor-form-test")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(target.hits.length).toBe(before);
  await pool.query("delete from organization where id = $1", [org]);
});

test.describe("secrets in the browser", () => {
  test("Edit shows set slots, refuses an empty replace, warns on a type change and blocks a new origin", async ({
    page,
  }) => {
    const token = `ui-token-${randomUUID()}`;
    const created = await ownerSession.request(
      "POST",
      monitorPath(orgA, projA),
      {
        ...basicConfig(`secret-ui-${run}`, urlOf("/health")),
        auth: { type: "bearer" },
        secrets: [{ slot: "auth.token", value: token }],
        clientRequestId: randomUUID(),
      },
    );
    const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
    await signIn(page, owner);

    // Viewers and owners see the state, never the value.
    await page.goto(`${overview()}/${id}`);
    await expect(page.getByTestId("monitor-config-auth")).toHaveAttribute(
      "data-configured",
      "true",
    );
    await expect(page.getByTestId("monitor-config-auth")).toHaveAttribute(
      "data-auth-type",
      "bearer",
    );
    await expect(page.getByTestId("monitor-config-auth")).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(token);

    await page.goto(`${overview()}/${id}/edit`);
    await page.getByTestId("monitor-form-mode-advanced").click();
    await expect(
      page.getByTestId("monitor-secret-auth.token-stored"),
    ).toBeVisible();
    await expect(
      page.getByTestId("monitor-secret-auth.token-stored"),
    ).toHaveText(/\S/);
    await expect
      .poll(() => page.evaluate(() => document.body.textContent))
      .not.toContain(token);
    expect(await page.content()).not.toContain(token);

    await shot(page, "edit-secret-set");
    // Replace with nothing typed is refused beside the field (AC-26).
    await page.getByTestId("monitor-secret-auth.token-replace").click();
    await shot(page, "edit-secret-replace-open");
    await page.getByTestId("monitor-form-save").click();
    await expect(
      page.getByTestId("monitor-secret-auth.token-value"),
    ).toHaveValue("");
    await expect(
      page.getByTestId("monitor-secret-auth.token-value"),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByTestId("monitor-secret-auth.token-value"),
    ).toHaveAccessibleDescription(/\S/);
    await page.getByTestId("monitor-secret-auth.token-cancel").click();

    // Changing the type says the old value is dropped before saving (AC-26).
    await page.getByTestId("monitor-form-auth-type").selectOption("basic");
    await expect(
      page.getByTestId("monitor-auth-secret-dropped"),
    ).toHaveAttribute("data-dropped", "true");
    await expect(page.getByTestId("monitor-auth-secret-dropped")).toHaveText(
      /\S/,
    );
    await page.getByTestId("monitor-form-auth-type").selectOption("bearer");

    // A new origin with a kept secret cannot be saved or tested (AC-44).
    await page
      .getByTestId("monitor-form-url")
      .fill(`http://${host}:${String(target.port + 1)}/health`);
    await expect(page.getByTestId("monitor-form-url")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      page.getByTestId("monitor-form-url"),
    ).toHaveAccessibleDescription(/\S/);
    await expect(page.getByTestId("monitor-form-test")).toBeDisabled();
    await expect(page.getByTestId("monitor-form-save")).toBeDisabled();
  });

  test("query and body fields carry the permanent warning", async ({
    page,
  }) => {
    await signIn(page, owner);
    await page.goto(`${overview()}/new`);
    await page.getByTestId("monitor-form-mode-advanced").click();
    await expect(
      page.getByTestId("monitor-form-query-visible-warning"),
    ).toBeVisible();
    await expect(
      page.getByTestId("monitor-form-query-visible-warning"),
    ).toHaveText(/\S/);
    await expect(
      page.getByTestId("monitor-form-body-visible-warning"),
    ).toBeVisible();
    await expect(
      page.getByTestId("monitor-form-body-visible-warning"),
    ).toHaveText(/\S/);
  });
});

test("a first failing result reads as one failure, not as down", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const created = await ownerSession.request("POST", monitorPath(orgA, projA), {
    ...basicConfig(`first-fail-${run}`, urlOf("/status/503")),
    clientRequestId: randomUUID(),
  });
  const id = monitorWriteResponseSchema.parse(created.body).monitor.id;
  await signIn(page, owner);
  await page.goto(`${overview()}/${id}`);
  await expect(page.getByTestId("monitor-status-failures")).toContainText(/1/, {
    timeout: 60_000,
  });
  await expect(page.getByTestId("monitor-detail-health")).toHaveAttribute(
    "data-health",
    "unknown",
  );
  await expect(page.getByTestId("monitor-detail-health")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-detail-down-banner")).toHaveCount(0);
});

test("a Project at 20 monitors shows the reason and the API refuses a 21st", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const org = await createOrganization(pool, `E2E Limit ${run}`);
  extraOrgs.push(org);
  const person = await createPerson(pool, "limit", org);
  userIds.push(person.userId);
  await addMember(pool, org, person.userId, "owner");
  const project = await createProject(pool, org, `E2E Limit ${run}`);
  const otherProject = await createProject(pool, org, `E2E Limit other ${run}`);
  const session = await signInApi(person);
  // Same name and URL for all: duplicates are allowed inside a Project.
  for (let i = 0; i < 20; i++) {
    const reply = await session.request("POST", monitorPath(org, project), {
      ...basicConfig("same name", urlOf("/health")),
      clientRequestId: randomUUID(),
    });
    expect(reply.status).toBe(201);
  }
  const over = await session.request("POST", monitorPath(org, project), {
    ...basicConfig("same name", urlOf("/health")),
    clientRequestId: randomUUID(),
  });
  expect(over.status).toBe(409);
  expect((over.body as { error: { code: string } }).error.code).toBe(
    "MONITOR_LIMIT_REACHED",
  );
  await signIn(page, person);
  await page.goto(monitorUrl(org, project));
  await expect(page.getByTestId("monitor-overview-limit-reason")).toBeVisible();
  await expect(page.getByTestId("monitor-overview-limit-reason")).toHaveText(
    /\S/,
  );
  await expect(
    page.getByTestId("monitor-overview-add-disabled"),
  ).toBeDisabled();
  const kept = await pool.query(
    "select count(*)::int n, count(*) filter (where status = 'active')::int active from monitors where tenant_id = $1",
    [org],
  );
  expect(kept.rows[0]).toEqual({ n: 20, active: 20 });
  // The cap is per Project: another Project of the same Organization still accepts one.
  const elsewhere = await session.request(
    "POST",
    monitorPath(org, otherProject),
    {
      ...basicConfig("same name", urlOf("/health")),
      clientRequestId: randomUUID(),
    },
  );
  expect(elsewhere.status).toBe(201);
  await pool.query("delete from organization where id = $1", [org]);
});

test("known raw samples reach all ranges, keyboard table and both themes", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await testInfo.attach("57-owned-services", {
    body: JSON.stringify({
      database: new URL(databaseOwnerUrl).pathname.slice(1),
      redisPrefix: process.env.REDIS_KEY_PREFIX,
      cleanupOwner: "scripts/e2e.mjs finally, 57V",
    }),
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = randomUUID();
  await pool.query(
    `insert into monitors
      (id, tenant_id, project_id, name, url, client_request_id, interval_seconds, created_at)
     values ($1, $2, $4, 'issue57-known', 'https://fixture.example', $3, 60,
       now() - interval '31 days')`,
    [id, orgA, randomUUID(), projA],
  );
  const path = `${overview()}/${id}`;
  const card = page.getByTestId("monitor-response-times");
  const stateShots = async (name: string) => {
    for (const theme of ["light", "dark"]) {
      await page.getByTestId("shell-account-open").click();
      await page
        .getByTestId("shell-account-theme")
        .getByTestId(`shell-theme-${theme}`)
        .click();
      await page.keyboard.press("Escape");
      await card.scrollIntoViewIfNeeded();
      await shot(page, `57-${name}-${theme}`);
    }
  };
  await signIn(page, owner);
  await page.goto(path);
  await expectKpis(card, null, null, "0", "0");
  await stateShots("empty-before");
  await pool.query(
    `insert into monitor_check_results
      (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms,
       failure_reason, url_masked, check_config_version, interval_seconds)
     select $1, $2, now() - n * interval '1 minute', now() - n * interval '1 minute',
       case when n = 2 then 'fail' else 'pass' end, n * 10,
       case when n = 2 then 'http_status' end, 'https://fixture.example', 1, 60
     from generate_series(1, 4) n`,
    [id, orgA],
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      localStorage.setItem("nightwatch-theme", value);
    }, theme);
    await page.reload();
    for (const range of ["24h", "7d", "30d"]) {
      const radio = card.getByTestId(`monitor-response-range-${range}`);
      await radio.focus();
      await page.keyboard.press("Space");
      await expectKpis(card, "20 ms", "40 ms", "4", "1");
      await expect(radio).toBeFocused();
      if (range !== "24h") {
        await expect(
          card.getByTestId("response-range-announcement"),
        ).toContainText(/p50 20 ms p95 40 ms/);
        await expect(
          card.getByTestId("response-range-announcement"),
        ).toContainText(/4\D+1/);
        await expect(
          card.getByTestId("response-range-announcement"),
        ).toHaveAttribute("aria-live", "polite");
        const from = await card
          .getByTestId("monitor-response-window-from")
          .getAttribute("datetime");
        expect(from).toMatch(/T/);
        expect(new Date(from ?? "").getUTCMinutes()).toBe(0);
        expect(new Date(from ?? "").getUTCSeconds()).toBe(0);
      }
      await expect(card.getByTestId("monitor-response-chart")).toBeVisible();
      await shot(page, `57-kpi-${range}-${theme}`);
      // The one button changes its name with the view, so each name is queried again after a press.
      await card.getByTestId("monitor-response-toggle").focus();
      await page.keyboard.press("Enter");
      await expect(card.getByTestId("monitor-response-table")).toBeVisible();
      const backToChart = card.getByTestId("monitor-response-toggle");
      await expect(backToChart).toBeFocused();
      // The view does not change the range.
      await expect(radio).toBeChecked();
      await shot(page, `57-known-${range}-${theme}`);
      await page.keyboard.press("Enter");
      await expect(card.getByTestId("monitor-response-table")).toHaveCount(0);
      await expect(card.getByTestId("monitor-response-toggle")).toBeFocused();
    }
  }
  for (const role of ["owner", "admin", "viewer", "auditor"] as const) {
    const session = await signInApi(people[role]);
    for (const range of ["24h", "7d", "30d"]) {
      const reply = await session.request(
        "GET",
        monitorPath(orgA, projA, `/${id}/response-times?range=${range}`),
      );
      expect(reply.status).toBe(200);
      const response = monitorResponseTimesResponseSchema.parse(reply.body);
      expect(response.window.to).toBe(response.dataAsOf);
      if (response.range === "24h") {
        expect(response.points.map((point) => point.responseTimeMs)).toEqual([
          40, 30, 20, 10,
        ]);
      } else {
        expect(response.summary).toEqual({
          p50Ms: 20,
          p95Ms: 40,
          checks: 4,
          failed: 1,
        });
      }
      await testInfo.attach(`57-api-${role}-${range}`, {
        body: JSON.stringify(response),
        contentType: "application/json",
      });
    }
    await page.context().clearCookies();
    await signIn(page, people[role]);
    await page.goto(path);
    await expectKpis(card, "20 ms", "40 ms", "4", "1");
  }
  expect(
    await card.evaluate(
      (element) =>
        Array.from(element.querySelectorAll("a")).filter((link) =>
          /\/issues\/57(?:$|[?#])/.test(link.href),
        ).length,
    ),
  ).toBe(0);
  await pool.query(
    "update monitor_check_results set response_time_ms = null, outcome = 'fail', failure_reason = 'timeout' where monitor_id = $1",
    [id],
  );
  await page.reload();
  await expectKpis(card, null, null, "4", "4");
  await expect(card.getByTestId("monitor-response-chart")).toBeVisible();
  await stateShots("timeout");
  await pool.query(
    "update monitor_check_results set outcome = 'check_error', response_time_ms = 0, failure_reason = 'executor_error' where monitor_id = $1",
    [id],
  );
  await page.reload();
  await expectKpis(card, "0 ms", "0 ms", "0", "0");
  await stateShots("check-error");
  const responseUrl = new RegExp(
    `/api/organizations/${orgA}/projects/${projA}/monitors/${id}/response-times`,
  );
  await page.route(responseUrl, (route) => route.abort());
  await page.reload();
  await expect(card.getByTestId("monitor-response-error")).toBeVisible();
  await expect(card.getByTestId("monitor-response-error")).toHaveText(/\S/);
  await expect(card.getByTestId("monitor-response-kpis")).toHaveCount(0);
  await stateShots("error");
  await page.unroute(responseUrl);
  await card.getByTestId("monitor-response-retry").click();
  await expectKpis(card, "0 ms", "0 ms", "0", "0");
  await pool.query("delete from monitor_check_results where monitor_id = $1", [
    id,
  ]);
  await pool.query(
    `insert into monitor_check_results
      (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms,
       url_masked, check_config_version, interval_seconds)
     select $1, $2, now() - n * interval '1 second', now() - n * interval '1 second',
       'pass', 10, 'https://fixture.example', 1, 60
     from generate_series(1, 1441) n`,
    [id, orgA],
  );
  await page.reload();
  await expectKpis(card, "10 ms", "10 ms", "1,440", "0");
  await expect(card.getByTestId("monitor-response-cap-note")).toHaveAttribute(
    "data-count",
    "1440",
  );
  await expect(card.getByTestId("monitor-response-cap-note")).toContainText(
    "1,440",
  );
  await shot(page, "57-cap-dark");
  await card.getByTestId("monitor-response-range-7d").click();
  await expectKpis(card, "10 ms", "10 ms", "1,441", "0");
  await page.route(responseUrl, (route) => route.abort());
  await expect(
    card.getByTestId("monitor-response-retained-warning"),
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    card.getByTestId("monitor-response-retained-warning"),
  ).toHaveText(/\S/);
  await expectKpis(card, "10 ms", "10 ms", "1,441", "0");
  await expect(
    card.getByTestId("monitor-response-retained-time"),
  ).toHaveAttribute("datetime", /T/);
  await stateShots("stale");
  await page.unroute(responseUrl);
  await card.getByTestId("monitor-response-retained-retry").click();
  await expect(
    card.getByTestId("monitor-response-retained-warning"),
  ).toHaveCount(0);
  await pool.query(
    `insert into monitor_check_results (monitor_id, tenant_id, scheduled_for, checked_at,
      outcome, response_time_ms, url_masked, check_config_version, interval_seconds)
     values ($1, $2, now() - interval '8 days', now() - interval '8 days',
       'pass', 99, 'https://fixture.example', 1, 60)`,
    [id, orgA],
  );
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayedUrl = new RegExp(
    `/api/organizations/${orgA}/projects/${projA}/monitors/${id}/response-times.*range=30d`,
  );
  await page.route(delayedUrl, async (route) => {
    const actual = await route.fetch();
    await delayed;
    await route.fulfill({ response: actual });
  });
  await card.getByTestId("monitor-response-range-30d").click();
  await expect(card.getByTestId("monitor-response-kpis-loading")).toBeVisible();
  await card.getByTestId("monitor-response-range-7d").click();
  await expectKpis(card, "10 ms", "10 ms", "1,441", "0");
  const lateCompletion = page.waitForResponse((response) =>
    delayedUrl.test(response.url()),
  );
  release();
  await lateCompletion;
  await expect(card.getByTestId("monitor-response-range-7d")).toBeChecked();
  await expect(card.getByTestId("response-range-announcement")).toHaveText(
    /\S/,
  );
  await expect(card.getByTestId("monitor-response-caption")).toHaveAttribute(
    "data-range",
    "7d",
  );
  await page.unroute(delayedUrl);
  await pool.query(
    "delete from member where organization_id = $1 and user_id = $2",
    [orgA, people.auditor.userId],
  );
  const denial = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/organizations/${orgA}`) &&
      response.status() === 403,
    { timeout: 45_000 },
  );
  await card.getByTestId("monitor-response-range-24h").click();
  await denial;
  await expect
    .poll(
      async () =>
        (await page.getByTestId("monitor-detail-denied").isVisible()) ||
        (await card.getByTestId("monitor-response-denial").isVisible()),
    )
    .toBe(true);
  await expect(card.getByTestId("monitor-response-kpis")).toHaveCount(0);
  await shot(page, "57-denied-dark");
});

test("pending real tenant A response cannot enter tenant B after confirmed switch", async ({
  page,
}) => {
  const ids = [randomUUID(), randomUUID()];
  for (const [index, org] of [orgA, orgOther].entries()) {
    await pool.query(
      `insert into monitors (id, tenant_id, project_id, name, url, client_request_id, interval_seconds)
       values ($1, $2, $5, $3, 'https://fixture.example', $4, 60)`,
      [
        ids[index],
        org,
        `tenant-known-${index}`,
        randomUUID(),
        index === 0 ? projA : projOther,
      ],
    );
    await pool.query(
      `insert into monitor_check_results (monitor_id, tenant_id, scheduled_for, checked_at,
        outcome, response_time_ms, url_masked, check_config_version, interval_seconds)
       values ($1, $2, now() - interval '1 minute', now() - interval '1 minute',
         'pass', $3, 'https://fixture.example', 1, 60)`,
      [ids[index], org, index === 0 ? 10 : 999],
    );
  }
  await signIn(page, owner);
  await page.goto(`${overview()}/${ids[0]}`);
  const card = page.getByTestId("monitor-response-times");
  await expectKpis(card, "10 ms", "10 ms", "1", "0");
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => {};
  const fetched = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const responseUrl = new RegExp(
    `/api/organizations/${orgA}/projects/${projA}/monitors/${ids[0]}/response-times.*range=7d`,
  );
  await page.route(responseUrl, async (route) => {
    const actual = await route.fetch();
    observed();
    await pending;
    await route.fulfill({ response: actual });
  });
  await card.getByTestId("monitor-response-range-7d").click();
  await fetched;
  await page.getByTestId("shell-organization-switch").click();
  await page
    .getByTestId("shell-organization-menu")
    .getByTestId(`shell-organization-${orgOther}`)
    .click();
  // A Project belongs to one Organization: the detail page leaves for the new one's Projects.
  await expect(page).toHaveURL(
    new RegExp(`/organizations/${orgOther}/projects$`),
  );
  // Client navigation keeps the pending response of tenant A in flight: the sidebar's Project group opens the new Organization's Project.
  await page
    .getByTestId(
      "shell-nav-/organizations/:organizationId/projects/:projectId/monitors",
    )
    .click();
  await expect(page).toHaveURL(monitorUrl(orgOther, projOther));
  await page.getByTestId(`monitor-list-name-${ids[1]}`).click();
  await expectKpis(card, "999 ms", "999 ms", "1", "0");
  const completed = page.waitForResponse((response) =>
    responseUrl.test(response.url()),
  );
  release();
  await completed;
  await expectKpis(card, "999 ms", "999 ms", "1", "0");
  await expect(card.getByTestId("monitor-response-p50")).not.toHaveText(
    "10 ms",
  );
  await expect(card.getByTestId("monitor-response-p95")).not.toHaveText(
    "10 ms",
  );
  await shot(page, "57-tenant-switch");
});

test("Detail links to the checks history and back by client navigation (AC-79)", async ({
  page,
}) => {
  const id = randomUUID();
  await pool.query(
    `insert into monitors (id, tenant_id, project_id, name, url, client_request_id, interval_seconds)
     values ($1, $2, $4, 'issue85-history', 'https://fixture.example', $3, 60)`,
    [id, orgA, randomUUID(), projA],
  );
  await pool.query(
    `insert into monitor_check_results
      (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms,
       url_masked, check_config_version, interval_seconds)
     select $1, $2, now() - n * interval '1 minute', now() - n * interval '1 minute',
       'pass', n * 10, 'https://fixture.example', 1, 60
     from generate_series(1, 3) n`,
    [id, orgA],
  );
  // The previous test switched this owner to another Organization; the sidebar leaf points at the active one.
  await pool.query(
    'update "user" set last_active_tenant_id = $1 where id = $2',
    [orgA, owner.userId],
  );
  await signIn(page, owner);
  await page.goto(`${overview()}/${id}`);
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(
    "issue85-history",
  );
  // Detail holds no history table of its own.
  await expect(page.getByTestId("monitor-checks-table")).toHaveCount(0);
  // A document load after this point means a link reloaded the page instead of navigating on the client.
  let documentLoads = 0;
  page.on("load", () => {
    documentLoads += 1;
  });

  await page.getByTestId("monitor-detail-checks-link").click();
  await expect(page).toHaveURL(new RegExp(`${overview()}/${id}/checks$`));
  await expect(page.getByTestId("monitor-checks-table")).toBeVisible();
  await expect(
    page.getByTestId("monitor-checks-table").getByTestId("monitor-check-row"),
  ).toHaveCount(3);
  expect(
    await page
      .getByTestId("monitor-checks-records")
      .evaluate((table) => table.querySelectorAll("tr").length),
  ).toBe(4);
  await expect(page.getByTestId("monitor-checks-title")).toHaveText(
    "issue85-history",
  );
  await expect(
    page
      .getByTestId("shell-navigation")
      .getByTestId(
        "shell-nav-/organizations/:organizationId/projects/:projectId/monitors",
      ),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("shell-breadcrumb-current")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await shot(page, "85-checks-history");

  await page.getByTestId("monitor-checks-back").click();
  await expect(page).toHaveURL(new RegExp(`${overview()}/${id}$`));
  await expect(page.getByTestId("monitor-detail-title")).toHaveText(
    "issue85-history",
  );
  await expect(page.getByTestId("monitor-detail-checks-link")).toBeVisible();
  expect(documentLoads).toBe(0);
});
