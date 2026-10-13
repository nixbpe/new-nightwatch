import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { monitorListResponseSchema } from "../../packages/api-contract/src/index.ts";
import { createDatabase } from "../../packages/db/src/index.ts";
import {
  addMember,
  cleanUp,
  createOrganization,
  createPerson,
  createProject,
  databaseOwnerUrl,
  shot,
  signInApi,
  monitorPath,
  monitorUrl,
  type Person,
} from "../support/monitor-fixtures";

// Issue #59 browser evidence: server-side sort, method / interval columns, the
// Cards sparkline, the Workspace section 01 SSL issuer, and the layout at 640 px.
// Covers P59-02, P59-03, P59-04, P59-05, P59-06, P59-10 (NODE-59-03).
//
// Rows are written straight into the run's own organization. No monitor_schedule
// row exists, so the Worker never checks them and the seeded health stays put.
// Results are re-inserted before each test so none turns stale (2 x interval).
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
// No space or hyphen: only overflow-wrap can break it inside the 170 px column.
const LONG_ISSUER =
  "CNNightwatchExampleIntermediateCertificateAuthorityGlobalTrustServicesG32026";

type Seed = {
  key: "alpha" | "mike" | "zulu";
  method: string;
  intervalSeconds: number;
  down: boolean;
  responseMs: number;
};
// mike is the down monitor and sits second by name, so `problems` (mike first)
// and `name` (alpha first) differ.
const SEEDS: Seed[] = [
  {
    key: "alpha",
    method: "GET",
    intervalSeconds: 600,
    down: false,
    responseMs: 150,
  },
  {
    key: "mike",
    method: "POST",
    intervalSeconds: 900,
    down: true,
    responseMs: 480,
  },
  {
    key: "zulu",
    method: "PUT",
    intervalSeconds: 300,
    down: false,
    responseMs: 90,
  },
];
const names = Object.fromEntries(
  SEEDS.map((seed) => [seed.key, `${seed.key}-${run}`]),
) as Record<Seed["key"], string>;
const ids = {} as Record<Seed["key"], string>;
const PROBLEMS_ORDER = [names.mike, names.alpha, names.zulu];
const NAME_ORDER = [names.alpha, names.mike, names.zulu];

// Hourly averages for alpha: hours back from the current UTC hour -> [checks, ms sum].
const ALPHA_HOURS: [number, number, number][] = [
  [0, 2, 300],
  [2, 1, 90],
  [5, 1, 240],
];
const sslNotAfter = new Date(Date.now() + 12 * DAY_MS);

let orgId: string;
let projectId: string;
let owner: Person;
const projectName = `E2E List Sort ${run}`;

const overview = () => monitorUrl(orgId, projectId);

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
}

async function seedResults() {
  for (const seed of SEEDS) {
    await pool.query(
      `insert into monitor_check_results
         (monitor_id, tenant_id, scheduled_for, checked_at, outcome, http_status,
          response_time_ms, failure_reason, assertions, url_masked,
          check_config_version, interval_seconds)
       values ($1, $2, now(), now(), $3, $4, $5, $6, '[]'::jsonb, $7, 1, $8)`,
      [
        ids[seed.key],
        orgId,
        seed.down ? "fail" : "pass",
        seed.down ? 500 : 200,
        seed.responseMs,
        seed.down ? "http_status" : null,
        `https://${seed.key}-${run}.example.invalid/health`,
        seed.intervalSeconds,
      ],
    );
  }
}

/**
 * `db:partitions` prepares the previous month through three months ahead. Hours
 * before the current UTC month start are skipped so the seed never depends on
 * the previous-month partition; the expected text follows what was seeded.
 */
function alphaHours() {
  const now = new Date();
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return ALPHA_HOURS.map(([back, checks, sum]) => ({
    start: currentHour - back * HOUR_MS,
    checks,
    sum,
  })).filter((hour) => hour.start >= monthStart);
}

test.beforeAll(async () => {
  orgId = await createOrganization(pool, `E2E List Sort ${run}`);
  owner = await createPerson(pool, "list-sort", orgId);
  await addMember(pool, orgId, owner.userId, "owner");
  projectId = await createProject(pool, orgId, projectName);
  for (const seed of SEEDS) {
    const ssl = seed.key === "zulu";
    const inserted = await pool.query<{ id: string }>(
      `insert into monitors
         (tenant_id, project_id, name, url, method, interval_seconds, timeout_seconds,
          consecutive_failures, last_passed_config_version,
          ssl_host, ssl_issuer, ssl_not_after, ssl_state, client_request_id)
       values ($1, $13, $2, $3, $4, $5, 10, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        orgId,
        names[seed.key],
        `https://${seed.key}-${run}.example.invalid/health`,
        seed.method,
        seed.intervalSeconds,
        seed.down ? 3 : 0,
        seed.down ? null : 1,
        ssl ? `${seed.key}-${run}.example.invalid` : null,
        ssl ? LONG_ISSUER : null,
        ssl ? sslNotAfter : null,
        ssl ? "caution" : null,
        randomUUID(),
        projectId,
      ],
    );
    ids[seed.key] = inserted.rows[0]!.id;
  }
  await pool.query(
    `insert into monitor_incidents
       (monitor_id, tenant_id, started_at, start_reason, start_http_status)
     values ($1, $2, now() - interval '20 minutes', 'http_status', 500)`,
    [ids.mike, orgId],
  );
  for (const hour of alphaHours()) {
    await pool.query(
      `insert into monitor_check_hourly
         (monitor_id, tenant_id, hour_start, checks, passed, covered_seconds,
          response_checks, response_ms_sum, response_ms_max)
       values ($1, $2, $3, $4::int, $4::int, $5::int, $4::int, $6::bigint, $6::int)`,
      [
        ids.alpha,
        orgId,
        new Date(hour.start),
        hour.checks,
        hour.checks * 600,
        hour.sum,
      ],
    );
  }
});

test.beforeEach(async () => {
  await seedResults();
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, [owner.userId], [orgId]);
  } finally {
    await database.close();
  }
});

/** Monitor names in the order their rows (or cards) appear. */
async function orderOf(rows: Locator): Promise<string[]> {
  const texts = await rows.allInnerTexts();
  return texts.map((text) => {
    const hit = NAME_ORDER.find((name) => text.includes(name));
    if (hit === undefined) throw new Error(`no seeded name in "${text}"`);
    return hit;
  });
}

const tableRows = (page: Page) =>
  page.getByTestId("monitor-overview-table").getByTestId(/^monitor-list-row-/);
const cardItems = (page: Page) =>
  page.getByTestId("monitor-overview-cards").getByTestId(/^monitor-list-row-/);

async function scrollListIntoView(page: Page, view: "table" | "cards") {
  await page
    .getByTestId(
      view === "table"
        ? "monitor-overview-table-region"
        : "monitor-overview-cards",
    )
    .scrollIntoViewIfNeeded();
}

test("Overview: default order, table columns, name sort, cards, reload keeps the view", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(overview());

  // Default view is the table, default sort is "ปัญหาก่อน" (down first, then by name).
  await expect(page.getByTestId("monitor-overview-view-table")).toBeChecked();
  const sort = page.getByTestId("monitor-overview-sort");
  await expect(sort).toHaveValue("problems");
  await expect(tableRows(page)).toHaveCount(3);
  expect(await orderOf(tableRows(page))).toEqual(PROBLEMS_ORDER);

  const table = page.getByTestId("monitor-overview-table");
  await expect(
    page.getByTestId("monitor-overview-table-region"),
  ).toHaveAccessibleName(/\S/);
  // AC-04: name with URL, status, p95 and availability over 24 h, last check.
  for (const key of ["name", "health", "p95", "h24", "lastCheck"]) {
    await expect(
      table.getByTestId(`monitor-list-heading-${key}`),
    ).toHaveAttribute("scope", "col");
    await expect(table.getByTestId(`monitor-list-heading-${key}`)).toHaveText(
      /\S/,
    );
  }
  for (const key of ["method", "interval", "ssl", "responseTime"]) {
    await expect(table.getByTestId(`monitor-list-heading-${key}`)).toHaveCount(
      0,
    );
  }
  const firstPage = monitorListResponseSchema.parse(
    (
      await (
        await signInApi(owner)
      ).request("GET", monitorPath(orgId, projectId))
    ).body,
  );
  for (const seed of SEEDS) {
    const row = table.getByTestId(`monitor-list-row-${ids[seed.key]}`);
    await expect(row).toHaveRole("row");
    await expect(row.getByTestId("monitor-list-url")).toHaveText(
      `https://${seed.key}-${run}.example.invalid/health`,
    );
    const p95 = firstPage.monitors.find(
      (monitor) => monitor.id === ids[seed.key],
    )?.responseP95Ms24h;
    await expect(row.getByTestId("monitor-list-cell-p95")).toContainText(
      p95 === null || p95 === undefined ? "ไม่มีข้อมูล" : `${String(p95)} ms`,
    );
    await expect(row.getByTestId("monitor-list-cell-h24")).toHaveText(/\S/);
    await expect(row.getByTestId("monitor-list-cell-lastCheck")).toHaveText(
      /\S/,
    );
  }
  // "ชื่อ A-Z" reorders by name and announces the sort with the result count.
  const sortedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === monitorPath(orgId, projectId) &&
      new URL(response.url()).searchParams.get("sort") === "name",
  );
  await sort.selectOption("name");
  const sorted = monitorListResponseSchema.parse(
    await (await sortedResponse).json(),
  );
  expect(sorted.monitors.map((monitor) => monitor.id)).toEqual([
    ids.alpha,
    ids.mike,
    ids.zulu,
  ]);
  expect(sorted.page.total).toBe(3);
  expect(sorted.summary.total).toBe(3);
  await expect(sort).toHaveValue("name");
  await expect(page.getByTestId("monitor-overview-announcement")).toHaveText(
    /\S/,
  );
  await expect(page.getByTestId("monitor-overview-announcement")).toContainText(
    /3\D+3/,
  );
  await expect(
    page.getByTestId("monitor-overview-announcement"),
  ).toHaveAttribute("role", "status");
  await expect.poll(async () => orderOf(tableRows(page))).toEqual(NAME_ORDER);

  // Cards carry method, interval and the sparkline text alternative.
  await page.getByTestId("monitor-overview-view-cards").click();
  await expect(cardItems(page)).toHaveCount(3);
  for (const seed of SEEDS) {
    const card = page
      .getByTestId("monitor-overview-cards")
      .getByTestId(`monitor-list-row-${ids[seed.key]}`);
    await expect(card).toHaveRole("listitem");
    await expect(card.getByTestId("monitor-list-cell-method")).toHaveText(
      seed.method,
    );
    await expect(card.getByTestId("monitor-list-cell-interval")).toContainText(
      new RegExp(`\\b${String(seed.intervalSeconds / 60)}\\b`),
    );
  }
  const hours = alphaHours();
  const perHourMs = hours.map((hour) => hour.sum / hour.checks);
  const alphaCard = page
    .getByTestId("monitor-overview-cards")
    .getByTestId(`monitor-list-row-${ids.alpha}`);
  const description = alphaCard.getByTestId("monitor-list-spark-description");
  await expect(description).toContainText(
    new RegExp(`\\b${String(Math.max(...perHourMs))} ms\\b`),
  );
  await expect(description).toContainText(
    new RegExp(`\\b${String(24 - hours.length)}\\b`),
  );
  const session = await signInApi(owner);
  const list = monitorListResponseSchema.parse(
    (await session.request("GET", monitorPath(orgId, projectId))).body,
  );
  expect(list.monitors.map((monitor) => monitor.id)).toEqual([
    ids.mike,
    ids.alpha,
    ids.zulu,
  ]);
  const alpha = list.monitors.find((monitor) => monitor.id === ids.alpha);
  expect(
    alpha?.responseSparkline
      .filter((point) => point.avgMs !== null)
      .map((point) => point.avgMs),
  ).toEqual([...perHourMs].reverse());
  const slots = alphaCard.getByTestId("monitor-list-spark-slot");
  await expect(slots).toHaveCount(24);
  expect(
    await slots.evaluateAll((elements) =>
      elements.map((element) => ({
        hourStart: element.getAttribute("data-hour-start"),
        avgMs:
          element.getAttribute("data-avg-ms") === ""
            ? null
            : Number(element.getAttribute("data-avg-ms")),
      })),
    ),
  ).toEqual(alpha?.responseSparkline);
  await expect(alphaCard.getByTestId("monitor-list-sparkline")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  const mikeCard = page
    .getByTestId("monitor-overview-cards")
    .getByTestId(`monitor-list-row-${ids.mike}`);
  await expect(mikeCard.getByTestId("monitor-list-spark-empty")).toHaveText(
    /\S/,
  );
  await expect(mikeCard.getByTestId("monitor-list-spark-slot")).toHaveCount(0);
  await expect(
    mikeCard.getByTestId("monitor-list-spark-description"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("nightwatch:monitors-view")),
  ).toBe("cards");

  // Reload: the view is remembered, the sort is not.
  await page.reload();
  await expect(page.getByTestId("monitor-overview-view-cards")).toBeChecked();
  await expect(page.getByTestId("monitor-overview-sort")).toHaveValue(
    "problems",
  );
  await expect(cardItems(page)).toHaveCount(3);
  expect(await orderOf(cardItems(page))).toEqual(PROBLEMS_ORDER);
});

test("Overview: summary line, status filter counts and the Project footer", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(overview());
  await expect(page.getByTestId("monitor-overview-scope")).toHaveText(
    projectName,
  );
  await expect(page.getByTestId("page-scope-tag")).toHaveText(/\S/);
  await expect(page.getByTestId("monitor-overview-total")).toContainText("3");
  await expect(page.getByTestId("monitor-overview-down")).toContainText("1");
  await expect(page.getByTestId("monitor-overview-interval")).toContainText(
    /ตรวจ/,
  );
  const filter = page.getByTestId("monitor-overview-health-filter");
  await expect(filter).toHaveAccessibleName(/\S/);
  await expect(filter.getByTestId("monitor-overview-health-all")).toContainText(
    "3",
  );
  await expect(
    filter.getByTestId("monitor-overview-health-down"),
  ).toContainText("1");
  await expect(
    filter.getByTestId("monitor-overview-health-all"),
  ).toHaveAttribute("aria-pressed", "true");
  await filter.getByTestId("monitor-overview-health-down").click();
  await expect(
    filter.getByTestId("monitor-overview-health-down"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(tableRows(page)).toHaveCount(1);
  await expect(page.getByTestId("monitor-overview-pagination")).toContainText(
    `เฉพาะมอนิเตอร์ของ ${projectName}`,
  );
});

test("Workspace section 01: SSL warning row shows issuer and expiry, down row does not", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto("/workspace");
  const section = page.getByTestId("workspace-issues");
  const zulu = section.getByTestId(`monitor-list-row-${ids.zulu}`);
  await expect(zulu).toBeVisible();
  await expect(zulu.getByTestId("workspace-ssl-issuer")).toContainText(
    LONG_ISSUER,
  );
  const expiry = zulu.getByTestId("workspace-ssl-expiry");
  await expect(expiry).toHaveAttribute("dateTime", sslNotAfter.toISOString());
  const dateText = (await expiry.textContent()) ?? "";
  expect(dateText).not.toBe("");
  await expect(expiry).toHaveText(dateText);
  await expect(zulu).toHaveAttribute("href", `${overview()}/${ids.zulu}`);

  const mike = section.getByTestId(`monitor-list-row-${ids.mike}`);
  await expect(mike).toBeVisible();
  await expect(mike.getByTestId("workspace-ssl-issuer")).toHaveCount(0);
  await expect(mike.getByTestId("workspace-ssl-expiry")).toHaveCount(0);

  // The Detail certificate card words the same expiry date.
  await page.goto(`${overview()}/${ids.zulu}`);
  await expect(page.getByTestId("monitor-detail-ssl-expiry")).toHaveText(
    dateText,
  );
  await expect(page.getByTestId("monitor-detail-ssl-expiry")).toHaveAttribute(
    "datetime",
    sslNotAfter.toISOString(),
  );
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`screenshots and layout, ${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    async function openOverview(page: Page, view: "table" | "cards") {
      await signIn(page, owner);
      await page.goto(overview());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByTestId(`monitor-overview-view-${view}`).click();
      await expect(
        view === "table" ? tableRows(page) : cardItems(page),
      ).toHaveCount(3);
    }

    async function expectIssuer(page: Page) {
      const row = page
        .getByTestId("workspace-issues")
        .getByTestId(`monitor-list-row-${ids.zulu}`);
      await expect(row.getByTestId("workspace-ssl-issuer")).toContainText(
        LONG_ISSUER,
      );
      await expect(row.getByTestId("workspace-ssl-expiry")).toHaveAttribute(
        "datetime",
        sslNotAfter.toISOString(),
      );
      await expect(row).toHaveAttribute("href", `${overview()}/${ids.zulu}`);
      await row.scrollIntoViewIfNeeded();
    }

    test("section 01 at desktop width", async ({ page }) => {
      await signIn(page, owner);
      await page.goto("/workspace");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectIssuer(page);

      await shot(page, `workspace-section01-${theme}`);
    });

    test.describe("640 px viewport (LAY-02)", () => {
      test.use({ viewport: { width: 640, height: 900 } });

      test("Table: page does not scroll sideways", async ({ page }) => {
        await openOverview(page, "table");

        await scrollListIntoView(page, "table");
        await shot(page, `table-640-${theme}`, true);
      });

      test("section 01: long issuer wraps in the 170 px column, no sideways scroll", async ({
        page,
      }) => {
        await signIn(page, owner);
        await page.goto("/workspace");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectIssuer(page);

        await shot(page, `workspace-section01-640-${theme}`, true);
      });
    });
  });
}
