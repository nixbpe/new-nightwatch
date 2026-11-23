import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  shot,
  type Person,
} from "../support/monitor-fixtures";

const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

let org: string;
let projectId: string;
let systemId: string;
let owner: Person;
let member: Person;
const userIds: string[] = [];

const page_ = () =>
  `/organizations/${org}/projects/${projectId}/vulnerabilities`;

// The VEX control is one button that opens a menu; the menu is drawn in a portal.
async function chooseVex(
  page: Page,
  row: string,
  choice: "affected" | "not-affected",
) {
  await page.locator(`${row} [data-testid^="triage-menu-"]`).click();
  await page
    .locator(`[data-testid^="triage-${choice}-CVE-2024-0001-"]`)
    .click();
}

// The same screen in both themes: the choice is read from storage when the page loads.
async function shotThemes(page: Page, name: string, ready: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("nightwatch-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByTestId(ready)).toBeVisible();
    await shot(page, `${name}-${theme}`);
  }
}

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

// The feeds are not reachable from a test run, so a finished run is written directly and
// the page is checked against it: what it shows, what it will not claim, and who may review.
async function seed() {
  const system = await pool.query<{ id: string }>(
    `insert into inventory_systems
       (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
     values ($1, $2, 'billing api', 'Billing API', 'inventory.csv', 'seed', 3, 3) returning id`,
    [org, projectId],
  );
  systemId = system.rows[0]?.id ?? "";
  const products: [string, string, string, string | null][] = [
    ["Redis", "Redis", "7.2.4", "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*"],
    ["Quiet", "Thing", "1.0.0", "cpe:2.3:a:quiet:thing:*:*:*:*:*:*:*:*"],
    ["Internal", "agent", "1.2.3", null],
  ];
  const units: Record<string, string> = {};
  const runRow = await pool.query<{ id: string }>(
    `insert into vulnerability_runs
       (tenant_id, project_id, status, requested_by, total_units, done_units, finished_at, feeds)
     values ($1, $2, 'done', 'seed', 2, 2, now(), $3::jsonb) returning id`,
    [
      org,
      projectId,
      JSON.stringify({
        nvd: { ok: true, at: new Date().toISOString() },
        kev: { ok: true, at: new Date().toISOString() },
      }),
    ],
  );
  const runId = runRow.rows[0]?.id ?? "";
  let line = 2;
  for (const [vendor, product, version, cpe] of products) {
    await pool.query(
      `insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer, environment, exposure, usable, source_kind, source_file_name, changed_by)
       values ($1, $2, $3, $4, 'ทีม A', $5, $6, $7, 'Middleware', 'Production', 'Internal', true, 'import', 'seed.xlsx', 'seed-user')`,
      [org, projectId, systemId, line, vendor, product, version],
    );
    line += 1;
    const mapping = await pool.query<{ id: string }>(
      `insert into inventory_mappings
         (tenant_id, project_id, vendor_key, product_key, vendor, product, status, cpe, source, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8::text is null then null else 'manual' end,
               case when $7 = 'confirmed' then now() end)
       returning id`,
      [
        org,
        projectId,
        vendor.toLowerCase(),
        product.toLowerCase(),
        vendor,
        product,
        cpe === null ? "pending" : "confirmed",
        cpe,
      ],
    );
    if (cpe === null) continue;
    const unit = await pool.query<{ id: string }>(
      `insert into vulnerability_units
         (tenant_id, project_id, run_id, mapping_id, version, cpe, status, sources)
       values ($1, $2, $3, $4, $5, $6, 'done', '{"nvd":"ok","osv":"skipped"}'::jsonb) returning id`,
      [org, projectId, runId, mapping.rows[0]?.id, version, cpe],
    );
    units[product] = unit.rows[0]?.id ?? "";
  }
  await pool.query(
    `insert into vulnerability_matches
       (tenant_id, project_id, unit_id, cve_id, sources, cvss_score, cvss_severity, epss, kev)
     values ($1, $2, $3, 'CVE-2024-0001', '{nvd}', 9.8, 'critical', 0.42, true),
            ($1, $2, $3, 'CVE-2024-0002', '{nvd}', null, null, null, null)`,
    [org, projectId, units.Redis],
  );
  // A later scan found these for Redis; the baseline is what the first finished run found.
  await pool.query(
    `insert into vulnerability_seen (tenant_id, project_id, mapping_id, version, cve_id, baseline, cvss_severity, kev, first_seen_at)
     select $1, $2, m.id, '7.2.4', v.cve_id, false, v.severity, v.kev, now() - v.age::interval
     from inventory_mappings m,
          (values ('CVE-2024-0001', 'critical', true, '3 hours'),
                  ('CVE-2024-8888', 'low', false, '2 days')) as v(cve_id, severity, kev, age)
     where m.project_id = $2 and m.product_key = 'redis'`,
    [org, projectId],
  );
}

// The notification the scan raises, written as the worker leaves it once materialized.
async function seedNotification() {
  const intent = randomUUID();
  const origin = `vulnerability:${projectId}:${randomUUID()}`;
  await pool.query(
    `insert into notification_intents
       (id, scope_kind, tenant_id, origin, event_type, occurred_at, subject_project_id,
        subject_project_name, vulnerability_cve_count, vulnerability_component_count)
     values ($1, 'tenant', $2, $3, 'VULNERABILITY_NEW', now(), $4, 'Payments', 3, 2)`,
    [intent, org, origin, projectId],
  );
  await pool.query(
    `insert into notification_dispatch_ledger (id, intent_id, scope_kind, tenant_id, status)
     values ($1, $2, 'tenant', $3, 'completed')`,
    [randomUUID(), intent, org],
  );
  for (const user of [owner.userId, member.userId]) {
    await pool.query(
      `insert into notification_intent_recipients (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
       values ($1, $2, $3, 'tenant', $4)`,
      [intent, origin, user, org],
    );
    await pool.query(
      `insert into notification_inbox_items
         (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, event_type, occurred_at,
          subject_project_id, subject_project_name, vulnerability_cve_count, vulnerability_component_count)
       values ($1, $2, $3, $4, 'tenant', $5, 'VULNERABILITY_NEW', now(), $6, 'Payments', 3, 2)`,
      [randomUUID(), intent, origin, user, org, projectId],
    );
  }
}

test.beforeAll(async () => {
  org = await createOrganization(pool, `E2E Vulnerabilities ${run}`);
  owner = await createPerson(pool, "vuln-owner", org);
  member = await createPerson(pool, "vuln-member", org);
  userIds.push(owner.userId, member.userId);
  await addMember(pool, org, owner.userId, "owner");
  await addMember(pool, org, member.userId, "viewer");
  projectId = await createProject(pool, org, `Payments ${run}`);
  await addProjectMember(pool, org, projectId, member.userId, "member");
  await seed();
  await seedNotification();
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [org]);
  } finally {
    await database.close();
  }
});

test.describe.configure({ mode: "serial" });

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    test("opens on what to fix, with the reason of each place and what it will not claim", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(page_());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      // The KEV CVE leads, with the facts that placed it; the CVE with no score is provisional.
      const first = page.getByTestId("vuln-item-1");
      await expect(first).toContainText("CVE-2024-0001");
      await expect(first).toContainText("Redis · Redis 7.2.4");
      await expect(first).toContainText("Billing API");
      await expect(first).toContainText("9.8");
      const reasons = page.getByTestId("vuln-reason-1");
      for (const badge of ["อยู่ใน KEV", "ภายใน", "EPSS 42%", "CVSS 9.8"]) {
        await expect(reasons).toContainText(badge);
      }
      await expect(page.getByTestId("vuln-item-2")).toContainText(
        "CVE-2024-0002",
      );
      await expect(page.getByTestId("vuln-item-2")).toContainText("ไม่ทราบ");
      await expect(page.getByTestId("vuln-provisional-2")).toContainText(
        "ชั่วคราว: ยังไม่ทราบ",
      );
      await expect(page.getByTestId("vuln-trust")).toContainText(
        "ไม่พบ CVE ไม่ได้แปลว่าปลอดภัย",
      );
      await expect(page.getByTestId("vuln-status")).toContainText("ตรวจล่าสุด");
      await expect(page.getByTestId("vuln-coverage")).toContainText(
        "ยังไม่ครอบคลุม 1 component",
      );
      await expect(page.getByTestId("vuln-tile-fix")).toContainText("2");
      await expect(page.getByTestId("vuln-tile-kev")).toContainText("1");
      await expect(page.getByTestId("vuln-tile-new")).toContainText("1");
      await expect(page.locator("body")).not.toContainText(
        /\b(?:Q-\d{2}|P[1-4]|F-\d{3})\b/,
      );
      await shot(page, `vulnerabilities-${theme}`);
      // 900 px wide: the page reflows and only the table scrolls inside its container.
      await page.setViewportSize({ width: 900, height: 900 });
      await shot(page, `vulnerabilities-narrow-${theme}`, true);

      // A long name with no spaces wraps inside its cell instead of running into the next one.
      const long = "Acme".repeat(30);
      const cell = page.locator('[data-testid="vuln-item-1"] td').nth(1);
      await cell.evaluate((node, text) => {
        const target = node.querySelectorAll("span")[1];
        if (target) target.textContent = text;
      }, long);
      expect(
        await cell.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await shot(page, `vulnerabilities-long-name-${theme}`, true);
    });

    test("shows each System with the state of its components, and exports it as Excel", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(page_());
      await page.getByTestId("vuln-tab-systems").click();
      await expect(page).toHaveURL(/\/vulnerabilities\?view=systems$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const redis = page.getByTestId(`vuln-component-${systemId}-Redis-7.2.4`);
      await expect(redis).toContainText("พบ 2 CVE");
      await redis.locator("summary").first().click();
      await expect(
        redis.getByTestId("vuln-finding-CVE-2024-0001"),
      ).toContainText("อยู่ใน KEV");
      await expect(
        redis.getByTestId("vuln-finding-CVE-2024-0002"),
      ).toContainText("ไม่ทราบ");
      await expect(
        page
          .getByTestId(`vuln-component-${systemId}-Thing-1.0.0`)
          .getByTestId("vuln-none-found"),
      ).toContainText("ไม่พบ CVE");
      await expect(
        page
          .getByTestId(`vuln-component-${systemId}-agent-1.2.3`)
          .getByTestId("vuln-not-covered"),
      ).toContainText("ยังไม่ครอบคลุม");
      // The chevron follows the details element once it has toggled.
      await expect(
        redis.locator('summary [aria-hidden="true"]').first(),
      ).toHaveClass(/rotate-90/);
      // The chevron turns over 150 ms; the picture is taken once it has.
      await page.waitForTimeout(400);
      await shot(page, `vulnerabilities-systems-${theme}`);

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId(`vuln-export-${systemId}`).click(),
      ]);
      expect(download.suggestedFilename()).toBe("vulnerabilities.xlsx");
      const path = await download.path();
      expect((await readFile(path)).byteLength).toBeGreaterThan(1000);
      await page.setViewportSize({ width: 900, height: 900 });
      await shot(page, `vulnerabilities-systems-narrow-${theme}`, true);
      const name = page
        .getByTestId(`vuln-component-${systemId}-Thing-1.0.0`)
        .locator("span.min-w-0")
        .first();
      await name.evaluate((node, text) => {
        node.textContent = text;
      }, "Quiet".repeat(40));
      expect(
        await name.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
    });

    test("keeps what the old new-CVE page showed under the filter, reached from the old URL", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(`${page_()}/new`);
      await expect(page).toHaveURL(/\/vulnerabilities\?new=1$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const found = page.getByTestId("vuln-item-1");
      await expect(found).toContainText("CVE-2024-0001");
      await expect(found).toContainText("พบครั้งแรก");
      await expect(page.getByTestId("vuln-item-2")).toHaveCount(0);
      await expect(page.getByTestId("vuln-new-total")).toContainText(
        "2 รายการ",
      );
      await expect(page.getByTestId("vuln-new-gone")).toContainText(
        "ใหม่แต่ไม่พบแล้ว 1 รายการ",
      );
      await page.getByTestId("vuln-new-gone").locator("summary").click();
      await expect(
        page.getByTestId("vuln-new-gone-CVE-2024-8888"),
      ).toBeVisible();
      await expect(page.getByTestId("vuln-new-none")).toHaveCount(0);
      await shot(page, `vulnerabilities-new-${theme}`);
      await page.getByTestId("vuln-filter-clear").click();
      await expect(page).toHaveURL(/\/vulnerabilities$/);
      await expect(page.getByTestId("vuln-item-2")).toBeVisible();
    });

    test("opens the VEX menu, asks for a reason, and moves the CVE to the folded group", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(page_());
      const row = '[data-testid="vuln-item-1"]';
      await page.locator(`${row} [data-testid^="triage-menu-"]`).click();
      await expect(page.getByRole("menu")).toBeVisible();
      // The overlay fades in; the picture is taken once it has settled.
      await page.waitForTimeout(400);
      await shot(page, `vulnerabilities-vex-menu-open-${theme}`, true);
      await page
        .locator('[data-testid^="triage-not-affected-CVE-2024-0001-"]')
        .click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      const reason = page.locator(
        `${row} [data-testid^="triage-reason-CVE-2024-0001-"]`,
      );
      await expect(reason).toBeVisible();
      await shot(page, `vulnerabilities-vex-reason-row-${theme}`, true);
      await reason.fill("ไม่ได้เปิดใช้ module ที่มีช่องโหว่");
      await page.locator(`${row} [data-testid^="triage-save-"]`).click();
      await page.getByTestId("vuln-not-affected").locator("summary").click();
      await expect(
        page.getByTestId("vuln-not-affected-CVE-2024-0001"),
      ).toContainText("เหตุผล: ไม่ได้เปิดใช้ module ที่มีช่องโหว่");
      await shot(page, `vulnerabilities-not-affected-${theme}`, true);
      // Put it back for the tests that follow.
      await chooseVex(
        page,
        '[data-testid="vuln-not-affected-CVE-2024-0001"]',
        "affected",
      );
      await expect(
        page
          .getByTestId("vuln-item-1")
          .locator('[data-testid^="triage-menu-"]'),
      ).toContainText("ได้รับผลกระทบ");
    });

    test("sends the old priority URL to the findings page", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(`${page_()}/priority`);
      await expect(page).toHaveURL(/\/vulnerabilities$/);
      await expect(page.getByTestId("vuln-item-1")).toBeVisible();
    });
  });
}

test("an admin marks a CVE not affected with a reason; it leaves the ordering, stays open to view and a member only reads it", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(page_());
  // Rank 1 is CVE-2024-0001. Mark it not affected: a reason is required first.
  const key = `CVE-2024-0001-`;
  await chooseVex(page, '[data-testid="vuln-item-1"]', "not-affected");
  const save = page.locator(`[data-testid^="triage-save-${key}"]`).first();
  await expect(save).toBeDisabled();
  await page
    .locator(`[data-testid^="triage-reason-${key}"]`)
    .first()
    .fill("ไม่ได้เปิดใช้ module ที่มีช่องโหว่");
  await save.click();

  // It left the ordering and is listed apart with its reason, who and when.
  const apart = page.getByTestId("vuln-not-affected");
  await expect(apart).toContainText("1 รายการ");
  await apart.locator("summary").click();
  await expect(
    page.getByTestId("vuln-not-affected-CVE-2024-0001"),
  ).toContainText("ไม่ได้เปิดใช้ module ที่มีช่องโหว่");
  await expect(
    page
      .getByTestId("vuln-not-affected-CVE-2024-0001")
      .locator('[data-testid^="triage-menu-"]'),
  ).toContainText("ไม่ได้รับผลกระทบ");
  await expect(page.getByTestId("vuln-item-1")).not.toContainText(
    "CVE-2024-0001",
  );

  // A member reads the same and has no control.
  await page.context().clearCookies();
  await signIn(page, member);
  await page.goto(page_());
  await expect(page.getByTestId("vuln-not-affected")).toContainText("1 รายการ");
  await expect(page.locator('[data-testid^="triage-menu-"]')).toHaveCount(0);
  await page.goto(`${page_()}?view=systems`);
  await page
    .getByTestId(`vuln-component-${systemId}-Redis-7.2.4`)
    .locator("summary")
    .first()
    .click();
  await expect(page.getByTestId("vuln-finding-CVE-2024-0001")).toContainText(
    "ไม่ได้รับผลกระทบ",
  );

  // Put it back for the tests that follow.
  await page.context().clearCookies();
  await signIn(page, owner);
  await page.goto(page_());
  await page.getByTestId("vuln-not-affected").locator("summary").click();
  await chooseVex(
    page,
    '[data-testid="vuln-not-affected-CVE-2024-0001"]',
    "affected",
  );
  await expect(page.getByTestId("vuln-item-1")).toContainText("CVE-2024-0001");
  await expect(
    page.getByTestId("vuln-item-1").locator('[data-testid^="triage-menu-"]'),
  ).toContainText("ได้รับผลกระทบ");
});

test("an admin opens the sample page from the findings page, draws, marks results and sees the false-positive rate", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(page_());
  await page.getByTestId("vuln-sample-link").click();
  await expect(page).toHaveURL(/\/vulnerabilities\/sample$/);
  await expect(page.getByTestId("vuln-sample-empty")).toContainText(
    "ยังไม่มีผลสุ่มตรวจ",
  );

  await page.getByTestId("vuln-sample-draw").click();
  await expect(page.getByTestId("vuln-sample-item-1")).toBeVisible();
  await expect(page.getByTestId("vuln-sample-item-2")).toBeVisible();
  await expect(page.getByTestId("vuln-sample-stat-rate")).toContainText(
    "ไม่ทราบ",
  );
  await page.getByTestId("vuln-sample-true_positive-1").click();
  await page.getByTestId("vuln-sample-false_positive-2").click();
  await expect(page.getByTestId("vuln-sample-stat-rate")).toContainText("50%");
  await expect(page.getByTestId("vuln-sample-stat-fp")).toContainText("1");
  await expect(page.locator("body")).not.toContainText(
    /\b(?:Q-\d{2}|P[1-4]|F-\d{3})\b/,
  );
  await shotThemes(page, "vulnerabilities-sample", "vuln-sample-stats");
});

test("a Project member reads findings but sees no run, no sample link, and a restricted sample page", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto(page_());

  await expect(page.getByTestId("vuln-tile-fix")).toContainText("2");
  await expect(page.getByTestId("vuln-run")).toHaveCount(0);
  await expect(page.getByTestId("vuln-sample-link")).toHaveCount(0);

  await page.goto(`${page_()}/sample`);
  await expect(page.getByTestId("vuln-sample-restricted")).toBeVisible();
  await expect(page.getByTestId("vuln-sample-item-1")).toHaveCount(0);
  await expect(page.getByTestId("vuln-sample-draw")).toHaveCount(0);
  await shotThemes(
    page,
    "vulnerabilities-sample-restricted",
    "vuln-sample-restricted",
  );

  // The API says the same: the sampled results are the Project admin's.
  const sample = await page.request.get(
    `/api/organizations/${org}/projects/${projectId}/vulnerabilities/sample`,
  );
  expect(sample.status()).toBe(403);
  const findings = await page.request.get(
    `/api/organizations/${org}/projects/${projectId}/vulnerabilities`,
  );
  expect(findings.status()).toBe(200);
  expect(await findings.json()).toHaveProperty("falsePositive");
});

test("a check with no confirmed product finishes at once and says there is nothing yet", async ({
  page,
}) => {
  const empty = await createProject(pool, org, `Empty ${run}`);
  await signIn(page, owner);
  await page.goto(`/organizations/${org}/projects/${empty}/vulnerabilities`);

  await expect(page.getByTestId("vuln-no-results")).toBeVisible();
  await page.getByTestId("vuln-run").click();
  await expect(page.getByTestId("vuln-feeds")).toBeVisible();
  await expect(page.getByTestId("vuln-progress")).toHaveCount(0);
});

test("a Project with no finished scan warns instead of saying there is no new CVE", async ({
  page,
}) => {
  const fresh = await createProject(pool, org, `Fresh ${run}`);
  await signIn(page, owner);
  await page.goto(
    `/organizations/${org}/projects/${fresh}/vulnerabilities/new`,
  );

  await expect(page).toHaveURL(/\/vulnerabilities\?new=1$/);
  await expect(page.getByTestId("vuln-new-warning-no_scan")).toBeVisible();
  await expect(page.getByTestId("vuln-new-none")).toHaveCount(0);
});

test("a new-CVE notification reaches the inbox and opens the Project's new-in-30-days filter", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto("/notifications");

  const row = page.locator('[data-event-type="VULNERABILITY_NEW"]').first();
  await expect(row).toContainText("Payments");
  await expect(row).toContainText("3 รายการ (2 component)");
  await page.getByTestId("notification-vulnerability-link").first().click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/vulnerabilities\\?new=1$`),
  );
  await expect(page.getByTestId("vuln-new-total")).toBeVisible();
});
