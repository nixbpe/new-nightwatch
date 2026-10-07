import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import {
  addMember,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  shot,
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
let owner: Person;

const overview = () => `/organizations/${orgId}/monitors`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(person.email);
  await page.locator("#login-password").fill(person.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
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
  for (const seed of SEEDS) {
    const ssl = seed.key === "zulu";
    const inserted = await pool.query<{ id: string }>(
      `insert into monitors
         (tenant_id, name, url, method, interval_seconds, timeout_seconds,
          consecutive_failures, last_passed_config_version,
          ssl_host, ssl_issuer, ssl_not_after, ssl_state, client_request_id)
       values ($1, $2, $3, $4, $5, 10, $6, $7, $8, $9, $10, $11, $12)
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
  page
    .getByRole("region", { name: "ตารางมอนิเตอร์" })
    .getByRole("row")
    .filter({ hasText: `-${run}` });
// Cards are the direct children of the hairline grid; the recent-events card on
// the same page also lists these monitors by name.
const cardItems = (page: Page) =>
  page
    .locator("ul[data-slot='hairline-grid'] > li")
    .filter({ hasText: `-${run}` });

async function scrollListIntoView(page: Page, view: "ตาราง" | "การ์ด") {
  const target =
    view === "ตาราง"
      ? page.getByRole("region", { name: "ตารางมอนิเตอร์" })
      : page.locator("ul[data-slot='hairline-grid']");
  await target.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      { message: `${label} sideways overflow`, timeout: 5000 },
    )
    .toBeLessThanOrEqual(0);
}

test("Overview: default order, table columns, name sort, cards, reload keeps the view", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(overview());

  // Default view is the table, default sort is "ปัญหาก่อน" (down first, then by name).
  await expect(page.getByRole("radio", { name: "ตาราง" })).toBeChecked();
  const sort = page.getByLabel("เรียงตาม");
  await expect(sort).toHaveValue("problems");
  await expect(tableRows(page)).toHaveCount(3);
  expect(await orderOf(tableRows(page))).toEqual(PROBLEMS_ORDER);

  await expect(page.getByRole("columnheader", { name: "เมธอด" })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "รอบตรวจ" }),
  ).toBeVisible();
  for (const seed of SEEDS) {
    const row = tableRows(page).filter({ hasText: names[seed.key] });
    await expect(row).toContainText(seed.method);
    await expect(row).toContainText(
      `ทุก ${String(seed.intervalSeconds / 60)} นาที`,
    );
  }
  // Existing columns stay.
  for (const header of ["ชื่อ", "URL", "SSL", "ตอบสนอง"]) {
    await expect(
      page.getByRole("columnheader", { name: header, exact: true }),
    ).toBeVisible();
  }

  // "ชื่อ A-Z" reorders by name and announces the sort with the result count.
  await sort.selectOption({ label: "ชื่อ A-Z" });
  await expect(page.getByRole("status", { name: "ผลการกรอง" })).toHaveText(
    "เรียงตาม ชื่อ A-Z · พบ 3 จาก 3",
  );
  await expect.poll(async () => orderOf(tableRows(page))).toEqual(NAME_ORDER);

  // Cards carry method, interval and the sparkline text alternative.
  await page.getByRole("radio", { name: "การ์ด" }).click();
  await expect(cardItems(page)).toHaveCount(3);
  for (const seed of SEEDS) {
    const card = cardItems(page).filter({ hasText: names[seed.key] });
    await expect(card).toContainText(seed.method);
    await expect(card).toContainText(
      `ทุก ${String(seed.intervalSeconds / 60)} นาที`,
    );
  }
  const hours = alphaHours();
  const perHourMs = hours.map((hour) => hour.sum / hour.checks);
  const alphaCard = cardItems(page).filter({ hasText: names.alpha });
  await expect(
    alphaCard.locator(".sr-only", { hasText: "เวลาตอบสนองเฉลี่ย" }),
  ).toHaveText(
    `เวลาตอบสนองเฉลี่ยรายชั่วโมงจากผลตรวจของมอนิเตอร์นี้ 24 ชม. ล่าสุด สูงสุด ${String(Math.max(...perHourMs))} ms ไม่มีข้อมูล ${String(24 - hours.length)} ชั่วโมง`,
  );
  // 24 slots: bars for hours with data, empty slots for the rest.
  await expect(alphaCard.locator("i[data-empty='true']")).toHaveCount(
    24 - hours.length,
  );
  await expect(alphaCard.locator("span[aria-hidden='true'] > i")).toHaveCount(
    24,
  );
  // A monitor without any hourly point shows the words in the sparkline slot
  // (a direct child of the content column), no bars and no chart description.
  const mikeCard = cardItems(page).filter({ hasText: names.mike });
  await expect(
    mikeCard.locator("div.flex-1 > span", { hasText: /^ไม่มีข้อมูล$/ }),
  ).toHaveCount(1);
  await expect(mikeCard.locator("span[aria-hidden='true'] > i")).toHaveCount(0);
  await expect(
    mikeCard.locator(".sr-only", { hasText: "เวลาตอบสนองเฉลี่ย" }),
  ).toHaveCount(0);

  // Reload: the view is remembered, the sort is not.
  await page.reload();
  await expect(page.getByRole("radio", { name: "การ์ด" })).toBeChecked();
  await expect(page.getByLabel("เรียงตาม")).toHaveValue("problems");
  await expect(cardItems(page)).toHaveCount(3);
  expect(await orderOf(cardItems(page))).toEqual(PROBLEMS_ORDER);
});

test("Workspace section 01: SSL warning row shows issuer and expiry, down row does not", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto("/workspace");
  const section = page.locator("section[aria-labelledby='overview-issues']");
  const zulu = section.getByRole("link").filter({ hasText: names.zulu });
  await expect(zulu).toBeVisible();
  await expect(zulu).toContainText(`ผู้ออก ${LONG_ISSUER}`);
  const expiry = zulu.locator("time");
  await expect(expiry).toHaveAttribute("dateTime", sslNotAfter.toISOString());
  const dateText = (await expiry.textContent()) ?? "";
  expect(dateText).not.toBe("");
  await expect(zulu).toContainText(`หมดอายุ ${dateText}`);

  const mike = section.getByRole("link").filter({ hasText: names.mike });
  await expect(mike).toBeVisible();
  await expect(mike).not.toContainText("ผู้ออก");
  await expect(mike).not.toContainText("หมดอายุ");

  // The Detail certificate card words the same expiry date.
  await page.goto(`${overview()}/${ids.zulu}`);
  await expect(page.getByText(dateText).first()).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`screenshots and layout, ${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem("nightwatch-theme", value);
      }, theme);
    });

    async function openOverview(page: Page, view: "ตาราง" | "การ์ด") {
      await signIn(page, owner);
      await page.goto(overview());
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("radio", { name: view }).click();
      await expect(
        view === "ตาราง" ? tableRows(page) : cardItems(page),
      ).toHaveCount(3);
    }

    async function expectIssuerWrapped(page: Page) {
      const issuer = page
        .locator("section[aria-labelledby='overview-issues']")
        .getByText(`ผู้ออก ${LONG_ISSUER}`);
      await expect(issuer).toBeVisible();
      // Bring the row into the viewport so the screenshot shows the wrapped issuer.
      await issuer.evaluate((element) => {
        element.scrollIntoView({ block: "center" });
      });
      const geometry = await issuer.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const column = element.parentElement!.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          columnWidth: column.width,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
          overflow: element.scrollWidth - element.clientWidth,
        };
      });
      expect(geometry.columnWidth).toBeLessThanOrEqual(170.5);
      expect(geometry.width).toBeLessThanOrEqual(170.5);
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      // More than one line: the issuer name, which has no break point, wrapped inside the column.
      expect(geometry.height).toBeGreaterThan(geometry.lineHeight * 1.5);
    }

    test("section 01 at desktop width", async ({ page }) => {
      await signIn(page, owner);
      await page.goto("/workspace");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectIssuerWrapped(page);
      await expectNoSidewaysScroll(page, `workspace ${theme}`);
      await shot(page, `workspace-section01-${theme}`);
    });

    test.describe("640 px viewport (LAY-02)", () => {
      test.use({ viewport: { width: 640, height: 900 } });

      test("Table: page does not scroll sideways", async ({ page }) => {
        await openOverview(page, "ตาราง");
        await expectNoSidewaysScroll(page, `table ${theme}`);
        await scrollListIntoView(page, "ตาราง");
        await shot(page, `table-640-${theme}`, true);
      });

      test("section 01: long issuer wraps in the 170 px column, no sideways scroll", async ({
        page,
      }) => {
        await signIn(page, owner);
        await page.goto("/workspace");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectIssuerWrapped(page);
        await expectNoSidewaysScroll(page, `workspace ${theme}`);
        await shot(page, `workspace-section01-640-${theme}`, true);
      });
    });
  });
}
