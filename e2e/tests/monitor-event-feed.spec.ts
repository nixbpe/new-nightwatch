import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { createDatabase } from "../../packages/db/src/index.ts";
import { startResponseTarget } from "../support/response-target.mjs";
import {
  addMember,
  basicConfig,
  cleanUp,
  createOrganization,
  createPerson,
  databaseOwnerUrl,
  monitorPath,
  shot,
  signInApi,
  targetHostname,
  type ApiSession,
  type Person,
} from "../support/monitor-fixtures";

// Integrated verification of issue #58 (NODE-58-06): event feed, recent events
// and last response through the real Worker, API and Web. Every monitor checks
// every 60 s, all are created up front so the schedule waits overlap.
const run = randomUUID().slice(0, 8);
const database = createDatabase(databaseOwnerUrl);
const pool = database.sql;

type Target = Awaited<ReturnType<typeof startResponseTarget>>;
const targets: Target[] = [];
let host: string;
let orgId: string;
let owner: Person;
let admin: Person;
let viewer: Person;
let ownerSession: ApiSession;
const userIds: string[] = [];

// Secret and request values the targets echo back. Names match the prefixes
// e2e/verification/scan-logs.ts looks for.
const bearerToken = `s-${randomUUID()}`;
// Latin-1 range, not ASCII: the target echoes it as latin1 header bytes.
const headerSecret = `sécrêt-${randomUUID()}`;
const queryValue = `qval-${run}`;
const bodyValue = `bodyval-${run}`;
const urlQueryValue = `qval-${randomUUID().slice(0, 8)}`;

const names = {
  feed: `feed-${run}`,
  panel: `panel-${run}`,
  query: `query-${run}`,
  long: `long-${run}`,
  echoHeader: `echo-header-${run}`,
  echoQuery: `echo-query-${run}`,
  echoBody: `echo-body-${run}`,
};
type Key = keyof typeof names;
const monitorIds = {} as Record<Key, string>;
const targetOf = {} as Record<Key, Target>;

const REQUEST_VALUES_TEXT =
  "ไม่เก็บ headers และเนื้อหา เพราะคำขอมี query หรือ body ซึ่งเป้าหมายอาจสะท้อนกลับ";
const BODY_LABEL = "เนื้อหาของการตอบกลับล่าสุด";
const ROUND_MS = 60_000;

const detailPath = (key: Key) =>
  `/organizations/${orgId}/monitors/${monitorIds[key]}`;
const urlOf = (key: Key, path: string) =>
  `http://${host}:${String(targetOf[key].port)}${path}`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(person.email);
  await page.locator("#login-password").fill(person.password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/workspace/);
}

async function startTarget(
  key: Key,
  options?: Parameters<typeof startResponseTarget>[0],
) {
  const target = await startResponseTarget(options);
  targets.push(target);
  targetOf[key] = target;
}

async function createMonitor(key: Key, config: Record<string, unknown>) {
  const created = await ownerSession.request("POST", monitorPath(orgId), {
    ...config,
    clientRequestId: randomUUID(),
  });
  expect(created.status).toBe(201);
  monitorIds[key] = (created.body as { monitor: { id: string } }).monitor.id;
}

test.beforeAll(async () => {
  host = targetHostname();
  orgId = await createOrganization(pool, `E2E Feed ${run}`);
  owner = await createPerson(pool, "owner", orgId);
  admin = await createPerson(pool, "admin", orgId);
  viewer = await createPerson(pool, "viewer", orgId);
  userIds.push(owner.userId, admin.userId, viewer.userId);
  await addMember(pool, orgId, owner.userId, "owner");
  await addMember(pool, orgId, admin.userId, "admin");
  await addMember(pool, orgId, viewer.userId, "viewer");
  ownerSession = await signInApi(owner);

  // Pass, fail, fail, pass: the second failure opens the incident, the next pass closes it.
  await startTarget("feed", {
    probeScript: [
      { status: 200 },
      { status: 503 },
      { status: 503 },
      { status: 200 },
    ],
  });
  await createMonitor("feed", basicConfig(names.feed, urlOf("feed", "/probe")));

  await startTarget("panel");
  await createMonitor("panel", {
    ...basicConfig(names.panel, urlOf("panel", "/json")),
    timeoutSeconds: 1,
  });

  await startTarget("query");
  await createMonitor(
    "query",
    basicConfig(names.query, urlOf("query", `/json?probe=${urlQueryValue}`)),
  );

  await startTarget("long");
  await createMonitor("long", basicConfig(names.long, urlOf("long", "/long")));

  const headerId = randomUUID();
  await startTarget("echoHeader");
  await createMonitor("echoHeader", {
    ...basicConfig(names.echoHeader, urlOf("echoHeader", "/reflect")),
    auth: { type: "bearer" },
    headers: [{ id: headerId, name: "X-Secret-Thing", secret: true }],
    secrets: [
      { slot: "auth.token", value: bearerToken },
      { slot: `header.${headerId}`, value: headerSecret },
    ],
  });

  await startTarget("echoQuery");
  await createMonitor("echoQuery", {
    ...basicConfig(names.echoQuery, urlOf("echoQuery", "/reflect")),
    queryParams: [{ name: "token", value: queryValue }],
  });

  await startTarget("echoBody");
  await createMonitor("echoBody", {
    ...basicConfig(names.echoBody, urlOf("echoBody", "/reflect")),
    method: "POST",
    body: { type: "json", content: JSON.stringify({ note: bodyValue }) },
  });
});

test.afterAll(async () => {
  try {
    await cleanUp(pool, userIds, [orgId]);
  } finally {
    await database.close();
    for (const target of targets) await target.close();
  }
});

test.describe.configure({ mode: "serial" });

async function lastResponseApi(key: Key, session = ownerSession) {
  const reply = await session.request(
    "GET",
    monitorPath(orgId, `/${monitorIds[key]}/last-response`),
  );
  return reply;
}

type LastResponseBody = {
  response: null | {
    statusLine: null | {
      httpVersion: string;
      status: number;
      reasonPhrase: string | null;
    };
    failureReason: string | null;
    detailOmitted: string | null;
    url: string;
    headers: { name: string; value: string; redacted: boolean }[];
    body: null | { kind: string; text?: string; truncated?: boolean };
  };
};

test("every monitor has a first last response within a schedule round", async () => {
  test.setTimeout(3 * ROUND_MS);
  await expect
    .poll(
      async () =>
        (
          await pool.query<{ n: number }>(
            "select count(*)::int as n from monitor_last_responses where tenant_id = $1",
            [orgId],
          )
        ).rows[0]!.n,
      { timeout: 2 * ROUND_MS, intervals: [2_000] },
    )
    .toBe(Object.keys(names).length);
});

test("P58-04: GET without query shows status line, masked URL, headers and body, and a viewer sees only the role note", async ({
  page,
  browser,
}) => {
  await signIn(page, owner);
  await page.goto(detailPath("panel"));
  const panel = page.getByRole("region", { name: "การตอบกลับล่าสุด" });
  await expect(panel.getByText("HTTP/1.1 200 OK")).toBeVisible();
  await expect(panel.getByText(urlOf("panel", "/json"))).toBeVisible();
  await expect(
    panel.getByRole("row", { name: /x-feed-check\s+ok/ }),
  ).toBeVisible();
  await expect(
    panel.getByRole("row", { name: /content-type\s+application\/json/ }),
  ).toBeVisible();
  await expect(panel.getByLabel(BODY_LABEL)).toContainText('"count":3');
  await shot(page, "p58-04-panel-200");

  // Admin may read the response too.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, admin);
  await adminPage.goto(detailPath("panel"));
  await expect(
    adminPage
      .getByRole("region", { name: "การตอบกลับล่าสุด" })
      .getByText("HTTP/1.1 200 OK"),
  ).toBeVisible();
  await adminContext.close();

  // A viewer sees the role note and the browser never asks for the response.
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const asked: string[] = [];
  viewerPage.on("request", (request) => {
    if (request.url().includes("/last-response")) asked.push(request.url());
  });
  await signIn(viewerPage, viewer);
  await viewerPage.goto(detailPath("panel"));
  await expect(
    viewerPage.getByText("เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา"),
  ).toBeVisible();
  await expect(viewerPage.getByLabel(BODY_LABEL)).toHaveCount(0);
  await expect(viewerPage.getByText("HTTP/1.1 200 OK")).toHaveCount(0);
  expect(asked.length).toBe(0);
  const denied = await signInApi(viewer).then((session) =>
    lastResponseApi("panel", session),
  );
  expect(denied.status).toBe(403);
  await viewerContext.close();

  // From here the target stops answering so the next round times out.
  targetOf.panel.setHang(true);
});

test("P58-04: a query in the URL keeps only version and status, with the reason label", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.goto(detailPath("query"));
  const panel = page.getByRole("region", { name: "การตอบกลับล่าสุด" });
  await expect(panel.getByText(/^HTTP\/1\.1 200$/)).toBeVisible();
  await expect(panel.getByText(REQUEST_VALUES_TEXT)).toBeVisible();
  await expect(
    panel.getByText(urlOf("query", "/json?probe=•••")),
  ).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Headers" })).toHaveCount(0);
  await expect(panel.getByLabel(BODY_LABEL)).toHaveCount(0);
  await shot(page, "p58-04-panel-request-values");
});

test("P58-10: a 16 KiB body on one unbroken line does not scroll the page at 375 px, and the body takes keyboard focus", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(detailPath("long"));
  const panel = page.getByRole("region", { name: "การตอบกลับล่าสุด" });
  const body = panel.getByLabel(BODY_LABEL);
  await expect(body).toBeVisible();
  await expect(panel.getByText("ตัดแล้ว")).toBeVisible();

  const overflow = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
  const normal = await overflow();
  expect(normal.scrollWidth).toBeLessThanOrEqual(normal.clientWidth);

  // 200% text size (WCAG 1.4.4): scale the root font size, rem units follow.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const zoomed = await overflow();
  expect(zoomed.scrollWidth).toBeLessThanOrEqual(zoomed.clientWidth);
  await shot(page, "p58-10-long-body-375-200pct", true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });

  // Tab order reaches the body without a pointer.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  let focused = false;
  for (let press = 0; press < 120 && !focused; press++) {
    await page.keyboard.press("Tab");
    focused = await body.evaluate((el) => el === document.activeElement);
  }
  expect(focused).toBe(true);
});

test("P58-05: nothing secret reaches the stored response, API replies, tables or captured logs", async ({
  page,
}) => {
  test.setTimeout(3 * ROUND_MS);
  for (const key of ["echoHeader", "echoQuery", "echoBody"] as const) {
    await expect
      .poll(() => targetOf[key].hitsFor("/reflect").length, {
        timeout: 2 * ROUND_MS,
      })
      .toBeGreaterThan(0);
  }

  // Positive controls: the targets received the values, so a clean scan means redaction worked.
  const headerHit = targetOf.echoHeader.hitsFor("/reflect")[0]!;
  const received = headerHit.headers["x-secret-thing"];
  test.info().annotations.push({
    type: "x-secret-thing as received",
    description: `length ${String(received?.length)} of ${String(headerSecret.length)}, raw form ${String(received === headerSecret)}, utf8-as-latin1 form ${String(received === Buffer.from(headerSecret, "utf8").toString("latin1"))}`,
  });
  expect(
    received === headerSecret ||
      received === Buffer.from(headerSecret, "utf8").toString("latin1"),
  ).toBe(true);
  expect(headerHit.headers.authorization === `Bearer ${bearerToken}`).toBe(
    true,
  );
  expect(targetOf.echoQuery.hitsFor("/reflect")[0]!.search).toContain(
    queryValue,
  );
  expect(targetOf.echoBody.hitsFor("/reflect")[0]!.body).toContain(bodyValue);

  await expect
    .poll(
      async () =>
        (
          await pool.query<{ n: number }>(
            `select count(*)::int as n from monitor_last_responses
              where monitor_id = any($1::uuid[]) and checked_at > now() - interval '5 minutes'`,
            [
              [
                monitorIds.echoHeader,
                monitorIds.echoQuery,
                monitorIds.echoBody,
              ],
            ],
          )
        ).rows[0]!.n,
      { timeout: 2 * ROUND_MS, intervals: [2_000] },
    )
    .toBe(3);

  // Header secrets on a GET without query: stored, masked.
  const header = (await lastResponseApi("echoHeader")).body as LastResponseBody;
  expect(header.response?.detailOmitted).toBeNull();
  expect(header.response?.statusLine?.status).toBe(200);
  expect(header.response?.headers.some((h) => h.redacted)).toBe(true);
  expect(header.response?.body?.text).toContain("•••");

  // Request values echoed back: nothing but version and status stored.
  for (const key of ["echoQuery", "echoBody"] as const) {
    const reply = (await lastResponseApi(key)).body as LastResponseBody;
    expect(reply.response?.detailOmitted).toBe("request_values");
    expect(reply.response?.statusLine?.status).toBe(200);
    expect(reply.response?.headers.length).toBe(0);
    expect(reply.response?.body).toEqual({
      kind: "omitted",
      reason: "request_values",
    });
  }

  await signIn(page, owner);
  await page.goto(detailPath("echoHeader"));
  const panel = page.getByRole("region", { name: "การตอบกลับล่าสุด" });
  await expect(panel.getByText("ค่าถูกซ่อน").first()).toBeVisible();
  await shot(page, "p58-05-panel-redacted");

  // Scan every API reply and table row for every form a secret can take.
  // Query and body values are plain configuration (OD-58-11): the monitor's own
  // config surfaces return them, so only secrets are scanned there.
  const secretNeedles = needleForms([bearerToken, headerSecret]);
  const needles = [
    ...secretNeedles,
    ...needleForms([queryValue, bodyValue, urlQueryValue]),
  ];
  const configSurface = /(detail|list)$|^table monitors$/;
  if (process.env.SCAN_NEEDLES_OUT) {
    writeFileSync(
      process.env.SCAN_NEEDLES_OUT,
      JSON.stringify({ secrets: needles, hidden: [] }),
    );
  }
  const haystacks = new Map<string, string>();
  const get = async (label: string, path: string) => {
    const reply = await ownerSession.request("GET", path);
    haystacks.set(label, JSON.stringify(reply.body));
  };
  await get("monitor list", monitorPath(orgId));
  await get("recent events", monitorPath(orgId, "/recent-events"));
  for (const key of Object.keys(names) as Key[]) {
    const base = monitorPath(orgId, `/${monitorIds[key]}`);
    await get(`${key} detail`, base);
    await get(`${key} events`, `${base}/events`);
    await get(`${key} last-response`, `${base}/last-response`);
  }
  for (const table of [
    "monitors",
    "monitor_last_responses",
    "monitor_events",
    "monitor_check_results",
    "monitor_incidents",
  ]) {
    const rows = await pool.query<{ row: string }>(
      `select row_to_json(t)::text as row from ${table} t where tenant_id = $1`,
      [orgId],
    );
    haystacks.set(`table ${table}`, rows.rows.map((r) => r.row).join("\n"));
  }
  const leaking = [...haystacks]
    .filter(([label, text]) =>
      (configSurface.test(label) ? secretNeedles : needles).some((needle) =>
        text.includes(needle),
      ),
    )
    .map(([label]) => label);
  expect(haystacks.size).toBeGreaterThan(20);
  expect(leaking).toEqual([]);
});

function needleForms(values: string[]): string[] {
  const forms = new Set<string>();
  for (const value of values) {
    forms.add(value);
    forms.add(JSON.stringify(value).slice(1, -1));
    forms.add(encodeURIComponent(value));
    // UTF-8 bytes read as latin1, and the reverse: a mis-decoded echo.
    forms.add(Buffer.from(value, "utf8").toString("latin1"));
    forms.add(Buffer.from(value, "latin1").toString("utf8"));
  }
  return [...forms].filter((form) => form.length >= 6);
}

test("P58-04: a target that stops answering shows no response and the cause", async ({
  page,
}) => {
  test.setTimeout(3 * ROUND_MS);
  await signIn(page, owner);
  await expect
    .poll(
      async () =>
        ((await lastResponseApi("panel")).body as LastResponseBody).response
          ?.failureReason ?? null,
      { timeout: 2 * ROUND_MS, intervals: [3_000] },
    )
    .toBe("timeout");
  await page.goto(detailPath("panel"));
  const panel = page.getByRole("region", { name: "การตอบกลับล่าสุด" });
  await expect(panel.getByText("ไม่มี response")).toBeVisible();
  await expect(panel.getByText("สาเหตุ หมดเวลารอ")).toBeVisible();
  await expect(panel.getByText("HTTP/1.1 200 OK")).toHaveCount(0);
  await shot(page, "p58-04-panel-no-response");
});

test("P58-01, P58-03: pass, fail, fail, pass gives three feed rows and recent events with the HTTP status", async ({
  page,
}) => {
  test.setTimeout(8 * ROUND_MS);
  type FeedEvent = {
    kind: string;
    httpStatus: number | null;
    responseTimeMs?: number | null;
    endReason?: string;
  };
  await expect
    .poll(
      async () => {
        const reply = await ownerSession.request(
          "GET",
          monitorPath(orgId, `/${monitorIds.feed}/events`),
        );
        return (reply.body as { events: FeedEvent[] }).events.map(
          (event) => event.kind,
        );
      },
      { timeout: 6 * ROUND_MS, intervals: [5_000] },
    )
    .toEqual(["incident_closed", "incident_opened", "check_failed"]);

  const events = (
    (
      await ownerSession.request(
        "GET",
        monitorPath(orgId, `/${monitorIds.feed}/events`),
      )
    ).body as { events: FeedEvent[] }
  ).events;
  expect(events.map((event) => event.httpStatus)).toEqual([200, 503, 503]);
  expect(events[0]!.endReason).toBe("recovered");

  await signIn(page, owner);
  await page.goto(detailPath("feed"));
  const rows = page
    .getByRole("list", { name: "ฟีดเหตุการณ์ของมอนิเตอร์" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("กลับมาปกติ");
  await expect(rows.nth(0)).toContainText("HTTP 200");
  await expect(rows.nth(0)).toContainText(/\d+ ms/);
  await expect(rows.nth(1)).toContainText("เริ่มล่ม");
  await expect(rows.nth(1)).toContainText("HTTP 503");
  await expect(rows.nth(2)).toContainText("ตรวจล้มเหลว");
  await expect(rows.nth(2)).toContainText("HTTP 503");
  await expect(rows.nth(2)).toContainText(/\d+ ms/);
  await shot(page, "p58-01-feed");

  await page.goto(`/organizations/${orgId}/monitors`);
  const opened = page
    .getByRole("listitem")
    .filter({ hasText: names.feed })
    .filter({ hasText: "เริ่มล่ม" });
  const closed = page
    .getByRole("listitem")
    .filter({ hasText: names.feed })
    .filter({ hasText: "สิ้นสุด" });
  await expect(opened).toContainText("HTTP 503");
  await expect(closed).toContainText("HTTP 200");
  await shot(page, "p58-03-recent-events");
});
