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
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer, environment, exposure, usable)
       values ($1, $2, $3, $4, 'ทีม A', $5, $6, $7, 'Middleware', 'Production', 'Internal', true)`,
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

    test("shows the findings, what is unknown, and what it will not claim", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(page_());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const redis = page.getByTestId(`vuln-component-${systemId}-Redis-7.2.4`);
      await expect(
        redis.getByTestId("vuln-finding-CVE-2024-0001"),
      ).toContainText("9.8");
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
      ).toContainText("ไม่ได้หมายความว่าปลอดภัย");
      await expect(
        page
          .getByTestId(`vuln-component-${systemId}-agent-1.2.3`)
          .getByTestId("vuln-not-covered"),
      ).toContainText("ยังไม่ครอบคลุม");
      await expect(page.getByTestId("vuln-tile-cves")).toContainText("2");
      await expect(page.getByTestId("vuln-tile-kev")).toContainText("1");
      await shot(page, `vulnerabilities-${theme}`);
    });

    test("lists what the scans saw first, reached from the findings page", async ({
      page,
    }) => {
      await signIn(page, owner);
      await page.goto(page_());
      await page.getByTestId("vuln-new-link").click();
      await expect(page).toHaveURL(/\/vulnerabilities\/new$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const found = page.getByTestId("new-cve-CVE-2024-0001");
      await expect(found).toContainText("Redis · Redis");
      await expect(found).toContainText("อยู่ใน KEV");
      await expect(found).toContainText("ยังพบในการตรวจล่าสุด");
      await expect(page.getByTestId("new-cve-CVE-2024-8888")).toContainText(
        "ไม่พบแล้วในการตรวจล่าสุด",
      );
      await expect(page.getByTestId("new-cve-checked")).toContainText(
        "ตรวจล่าสุดเสร็จเมื่อ",
      );
      await expect(page.getByTestId("new-cve-none")).toHaveCount(0);
      await shot(page, `vulnerabilities-new-${theme}`);
      await page.getByTestId("new-cve-back").click();
      await expect(page).toHaveURL(/\/vulnerabilities$/);
    });
  });
}

test("an admin draws a sample, marks results and sees the false-positive rate", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(page_());

  await page.getByTestId("vuln-sample-draw").click();
  await expect(page.getByTestId("vuln-sample-item-1")).toBeVisible();
  await expect(page.getByTestId("vuln-sample-item-2")).toBeVisible();
  await expect(page.getByTestId("vuln-sample-rate")).toContainText("ไม่ทราบ");
  await page.getByTestId("vuln-sample-true_positive-1").click();
  await page.getByTestId("vuln-sample-false_positive-2").click();
  await expect(page.getByTestId("vuln-sample-rate")).toContainText("1 (50%)");
  await shot(page, "vulnerabilities-sample");
});

test("a Project member reads findings and the sample but cannot start or review", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto(page_());

  await expect(page.getByTestId("vuln-tile-cves")).toContainText("2");
  await expect(page.getByTestId("vuln-run")).toHaveCount(0);
  await expect(page.getByTestId("vuln-sample-draw")).toHaveCount(0);
  await expect(page.getByTestId("vuln-sample-rate")).toContainText("1 (50%)");
  await expect(page.getByTestId("vuln-sample-true_positive-1")).toHaveCount(0);
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

  await expect(page.getByTestId("new-cve-warning-no_scan")).toBeVisible();
  await expect(page.getByTestId("new-cve-none")).toHaveCount(0);
});

test("a new-CVE notification reaches the inbox and opens the Project's new-CVE page", async ({
  page,
}) => {
  await signIn(page, member);
  await page.goto("/notifications");

  const row = page.locator('[data-event-type="VULNERABILITY_NEW"]').first();
  await expect(row).toContainText("Payments");
  await expect(row).toContainText("3 รายการ (2 component)");
  await page.getByTestId("notification-vulnerability-link").first().click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/vulnerabilities/new$`),
  );
  await expect(page.getByTestId("new-cve-checked")).toBeVisible();
});
