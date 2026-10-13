import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import {
  monitorWriteResponseSchema,
  monitorLastResponseResponseSchema,
  monitorEventsResponseSchema,
  monitorRecentEventsResponseSchema,
} from "../../packages/api-contract/src/index.ts";
import { createDatabase } from "../../packages/db/src/index.ts";
import { startResponseTarget } from "../support/response-target.mjs";
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
let projectId: string;
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

const ROUND_MS = 60_000;

const detailPath = (key: Key) =>
  `/organizations/${orgId}/projects/${projectId}/monitors/${monitorIds[key]}`;
const urlOf = (key: Key, path: string) =>
  `http://${host}:${String(targetOf[key].port)}${path}`;

async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(person.email);
  await page.getByTestId("login-password").fill(person.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(
    /\/(?:workspace$|organizations\/[^/]+\/projects(?:\/|$))/,
  );
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
  const created = await ownerSession.request(
    "POST",
    monitorPath(orgId, projectId),
    {
      ...config,
      clientRequestId: randomUUID(),
    },
  );
  expect(created.status).toBe(201);
  monitorIds[key] = monitorWriteResponseSchema.parse(created.body).monitor.id;
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
  // Monitors live in a Project; the viewer reads them as a Project member.
  projectId = await createProject(pool, orgId, `E2E Feed ${run}`);
  await addProjectMember(pool, orgId, projectId, viewer.userId, "member");
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
    monitorPath(orgId, projectId, `/${monitorIds[key]}/last-response`),
  );
  return reply;
}

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
  const panel = page.getByTestId("monitor-last-response");
  await expect(panel.getByTestId("monitor-response-status")).toHaveText(
    "HTTP/1.1 200 OK",
  );
  await expect(panel.getByTestId("monitor-response-url")).toHaveText(
    urlOf("panel", "/json"),
  );
  const response = monitorLastResponseResponseSchema.parse(
    (await lastResponseApi("panel")).body,
  ).response;
  expect(response?.headers).toEqual(
    expect.arrayContaining([
      { name: "x-feed-check", value: "ok", redacted: false },
      { name: "content-type", value: "application/json", redacted: false },
    ]),
  );
  const writtenHeaders = [];
  for (const row of await panel.getByTestId("monitor-response-header").all()) {
    await expect(row).toHaveRole("row");
    await expect(
      row.getByTestId("monitor-response-header-name"),
    ).toHaveAttribute("scope", "row");
    writtenHeaders.push({
      name: await row.getByTestId("monitor-response-header-name").innerText(),
      value: await row.getByTestId("monitor-response-header-value").innerText(),
      redacted: (await row.getAttribute("data-redacted")) === "true",
    });
  }
  expect(writtenHeaders).toEqual(response?.headers);
  await expect(panel.getByTestId("monitor-response-body")).toContainText(
    '"count":3',
  );
  await shot(page, "p58-04-panel-200");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, admin);
  await adminPage.goto(detailPath("panel"));
  await expect(
    adminPage
      .getByTestId("monitor-last-response")
      .getByTestId("monitor-response-status"),
  ).toHaveText("HTTP/1.1 200 OK");
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
  await expect(viewerPage.getByTestId("monitor-response-read-role")).toHaveText(
    /\S/,
  );
  await expect(viewerPage.getByTestId("monitor-response-body")).toHaveCount(0);
  await expect(viewerPage.getByTestId("monitor-response-status")).toHaveCount(
    0,
  );
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
  const panel = page.getByTestId("monitor-last-response");
  await expect(panel.getByTestId("monitor-response-status")).toHaveText(
    "HTTP/1.1 200",
  );
  await expect(panel.getByTestId("monitor-response-request-values")).toHaveText(
    /\S/,
  );
  await expect(panel.getByTestId("monitor-response-url")).toHaveText(
    urlOf("query", "/json?probe=•••"),
  );
  await expect(
    panel.getByTestId("monitor-response-header-section"),
  ).toHaveCount(0);
  await expect(panel.getByTestId("monitor-response-body")).toHaveCount(0);
  await shot(page, "p58-04-panel-request-values");
});

test("P58-10: a 16 KiB body on one unbroken line does not scroll the page at 375 px, and the body takes keyboard focus", async ({
  page,
}) => {
  await signIn(page, owner);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(detailPath("long"));
  const panel = page.getByTestId("monitor-last-response");
  const body = panel.getByTestId("monitor-response-body");
  await expect(body).toHaveText("x".repeat(16384));
  await expect(body).toHaveAttribute("role", "region");
  await expect(body).toHaveAttribute("tabindex", "0");
  await expect(panel.getByTestId("monitor-response-truncated")).toHaveText(
    /\S/,
  );

  // 200% text size (WCAG 1.4.4): scale the root font size, rem units follow.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(body).toHaveText("x".repeat(16384));
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

test("P58-05: nothing secret reaches the stored response, API replies and tables (logs are scanned by scan-logs.ts after the run)", async ({
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
  const header = monitorLastResponseResponseSchema.parse(
    (await lastResponseApi("echoHeader")).body,
  );
  expect(header.response?.detailOmitted).toBeNull();
  expect(header.response?.statusLine?.status).toBe(200);
  expect(header.response?.headers.some((h) => h.redacted)).toBe(true);
  expect(header.response?.body?.kind).toBe("text");
  if (header.response?.body?.kind === "text")
    expect(header.response.body.text).toContain("•••");

  // Request values echoed back: nothing but version and status stored.
  for (const key of ["echoQuery", "echoBody"] as const) {
    const reply = monitorLastResponseResponseSchema.parse(
      (await lastResponseApi(key)).body,
    );
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
  const panel = page.getByTestId("monitor-last-response");
  await expect(panel.getByTestId("monitor-response-headers")).toBeVisible();
  const redactionStates = [];
  for (const row of await panel.getByTestId("monitor-response-header").all()) {
    const value = await row
      .getByTestId("monitor-response-header-value")
      .innerText();
    const redacted = await row.getAttribute("data-redacted");
    if (redacted === "true") expect(value.trim()).not.toBe("");
    redactionStates.push(redacted);
  }
  expect(redactionStates).toContain("true");
  expect(await page.content()).not.toContain(bearerToken);
  expect(await page.content()).not.toContain(headerSecret);
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
  await get("monitor list", monitorPath(orgId, projectId));
  await get("recent events", monitorPath(orgId, projectId, "/recent-events"));
  for (const key of Object.keys(names) as Key[]) {
    const base = monitorPath(orgId, projectId, `/${monitorIds[key]}`);
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
        monitorLastResponseResponseSchema.parse(
          (await lastResponseApi("panel")).body,
        ).response?.failureReason ?? null,
      { timeout: 2 * ROUND_MS, intervals: [3_000] },
    )
    .toBe("timeout");
  await page.goto(detailPath("panel"));
  const panel = page.getByTestId("monitor-last-response");
  await expect(panel.getByTestId("monitor-response-missing")).toHaveText(/\S/);
  await expect(panel.getByTestId("monitor-response-cause")).toHaveAttribute(
    "data-failure-reason",
    "timeout",
  );
  await expect(panel.getByTestId("monitor-response-cause")).toHaveText(/\S/);
  await expect(panel.getByTestId("monitor-response-status")).toHaveCount(0);
  await shot(page, "p58-04-panel-no-response");
});

test("P58-01, P58-03: pass, fail, fail, pass gives three feed rows and recent events with the HTTP status", async ({
  page,
}) => {
  test.setTimeout(8 * ROUND_MS);
  await expect
    .poll(
      async () => {
        const reply = await ownerSession.request(
          "GET",
          monitorPath(orgId, projectId, `/${monitorIds.feed}/events`),
        );
        return monitorEventsResponseSchema
          .parse(reply.body)
          .events.map((event) => event.kind);
      },
      { timeout: 6 * ROUND_MS, intervals: [5_000] },
    )
    .toEqual(["incident_closed", "incident_opened", "check_failed"]);

  const events = monitorEventsResponseSchema.parse(
    (
      await ownerSession.request(
        "GET",
        monitorPath(orgId, projectId, `/${monitorIds.feed}/events`),
      )
    ).body,
  ).events;
  expect(
    events.map((event) => ("httpStatus" in event ? event.httpStatus : null)),
  ).toEqual([200, 503, 503]);
  expect(
    events.find((event) => event.kind === "incident_closed")?.endReason,
  ).toBe("recovered");

  await signIn(page, owner);
  await page.goto(detailPath("feed"));
  const feed = page.getByTestId("monitor-event-feed-list");
  const rows = feed.getByTestId(/^monitor-event-record-/);
  await expect(rows).toHaveCount(3);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    ),
  ).toEqual(events.map((event) => `monitor-event-record-${event.id}`));
  const titles = [];
  for (const event of events) {
    const row = feed.getByTestId(`monitor-event-record-${event.id}`);
    await expect(row).toHaveRole("listitem");
    await expect(row).toHaveAttribute("data-event-kind", event.kind);
    await expect(row.getByTestId("monitor-event-time")).toHaveAttribute(
      "datetime",
      event.at,
    );
    const title = await row.getByTestId("monitor-event-title").innerText();
    expect(title.trim()).not.toBe("");
    titles.push(title);
    if ("httpStatus" in event)
      await expect(row).toContainText(`HTTP ${String(event.httpStatus)}`);
    if ("responseTimeMs" in event) await expect(row).toContainText(/\d+ ms/);
  }
  expect(new Set(titles).size).toBe(3);
  await shot(page, "p58-01-feed");

  await page.goto(`/organizations/${orgId}/projects/${projectId}/monitors`);
  const recent = monitorRecentEventsResponseSchema.parse(
    (
      await ownerSession.request(
        "GET",
        monitorPath(orgId, projectId, "/recent-events"),
      )
    ).body,
  ).events;
  const written = [];
  const recentRows = page
    .getByTestId("monitor-overview-events")
    .getByTestId("monitor-overview-event");
  await expect(recentRows).toHaveCount(recent.length);
  for (const row of await recentRows.all()) {
    await expect(row).toHaveRole("listitem");
    const link = row.getByTestId("monitor-overview-event-monitor");
    const kind = await row.getAttribute("data-event-kind");
    const href = await link.getAttribute("href");
    const at = await row
      .getByTestId("monitor-overview-event-time")
      .getAttribute("datetime");
    const name = await link.innerText();
    const matching = recent.find(
      (event) =>
        event.kind === kind &&
        href ===
          `/organizations/${orgId}/projects/${projectId}/monitors/${event.monitorId}` &&
        event.at === at,
    );
    expect(matching).toBeDefined();
    expect(name).toBe(matching?.monitorName);
    if (href === detailPath("feed"))
      await expect(row).toContainText(
        kind === "incident_opened" ? "HTTP 503" : "HTTP 200",
      );
    written.push({ kind, href, at, name });
  }
  expect(written).toEqual(
    recent.map((event) => ({
      kind: event.kind,
      href: `/organizations/${orgId}/projects/${projectId}/monitors/${event.monitorId}`,
      at: event.at,
      name: event.monitorName,
    })),
  );
  expect(
    recent
      .filter((event) => event.monitorId === monitorIds.feed)
      .map((event) => event.kind)
      .sort(),
  ).toEqual(["incident_closed", "incident_opened"]);
  await shot(page, "p58-03-recent-events");
});
