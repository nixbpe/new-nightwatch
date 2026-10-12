import {
  must,
  noChecks,
  noIncidents,
  noResponseTimes,
  projectDetail,
} from "./detail-test-support";
import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMeContext } from "../../lib/api/me";
import { fetchProjectDetail } from "../../lib/api/projects";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  createMonitor,
  fetchMonitorDetail,
  fetchMonitorList,
} from "../../lib/api/monitors";
import {
  A,
  context,
  detail,
  newPath,
  record,
  renderForm,
} from "./form-test-support";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectDetail: vi.fn(),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(() => Promise.resolve(noChecks)),
  fetchMonitorIncidents: vi.fn(() => Promise.resolve(noIncidents)),
  fetchMonitorResponseTimes: vi.fn(() => Promise.resolve(noResponseTimes)),
  fetchMonitorEvents: vi.fn(() =>
    Promise.resolve({ events: [], page: { limit: 20, offset: 0, total: 0 } }),
  ),
  fetchMonitorLastResponse: vi.fn(() => Promise.resolve({ response: null })),
  fetchMonitorList: vi.fn(),
}));

const createMock = vi.mocked(createMonitor);

beforeEach(() => {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  });
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  createMock.mockResolvedValue({ monitor: record() });
});

afterEach(() => {
  vi.resetAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

async function openAdvanced() {
  const user = userEvent.setup();
  renderForm(newPath());
  await screen.findByTestId("monitor-form-name");
  await user.click(screen.getByTestId("monitor-form-mode-advanced"));
  return user;
}

async function fillBasic(user: User) {
  await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
  await user.type(
    screen.getByTestId("monitor-form-url"),
    "https://api.acme.example/health",
  );
}

async function addHeaderRow(user: User) {
  const before = new Set(
    screen
      .queryAllByTestId(/^monitor-form-header-row-/)
      .map((row) => row.getAttribute("data-testid")),
  );
  await user.click(screen.getByTestId("monitor-form-add-header"));
  const added = screen
    .getAllByTestId(/^monitor-form-header-row-/)
    .filter((row) => !before.has(row.getAttribute("data-testid")));
  expect(added).toHaveLength(1);
  return must(must(added.pop()).getAttribute("data-testid") ?? undefined);
}

async function addQueryRow(user: User) {
  const before = new Set(
    screen
      .queryAllByTestId(/^monitor-form-query-row-/)
      .map((row) => row.getAttribute("data-testid")),
  );
  await user.click(screen.getByTestId("monitor-form-add-query"));
  const added = screen
    .getAllByTestId(/^monitor-form-query-row-/)
    .filter((row) => !before.has(row.getAttribute("data-testid")));
  expect(added).toHaveLength(1);
  return must(must(added.pop()).getAttribute("data-testid") ?? undefined);
}

async function addAssertionRow(user: User) {
  const before = new Set(
    screen
      .queryAllByTestId(/^monitor-form-assertion-row-/)
      .map((row) => row.getAttribute("data-testid")),
  );
  await user.click(screen.getByTestId("monitor-form-add-assertion"));
  const added = screen
    .getAllByTestId(/^monitor-form-assertion-row-/)
    .filter((row) => !before.has(row.getAttribute("data-testid")));
  expect(added).toHaveLength(1);
  return must(must(added.pop()).getAttribute("data-testid") ?? undefined);
}

function expectInvalid(field: HTMLElement) {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
  const described = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  const error = described.find((id) => id.endsWith("-error"));
  expect(error).toBeDefined();
  expect(document.getElementById(must(error))).not.toBeEmptyDOMElement();
}

const save = () => screen.getByTestId("monitor-form-save");
const setValue = (element: HTMLElement, value: string) => {
  fireEvent.change(element, { target: { value } });
};

describe("Advanced mode defaults and mode switch", () => {
  it("offers method, timeout and expected status with the defaults", async () => {
    await openAdvanced();
    expect(screen.getByTestId("monitor-form-method")).toHaveValue("GET");
    expect(screen.getByTestId("monitor-form-timeout")).toHaveValue("10");
    expect(screen.getByTestId("monitor-form-expected-status")).toHaveValue(
      "200-299",
    );
  });

  it("keeps advanced values when switching to basic and counts what is still in use", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    await user.selectOptions(screen.getByTestId("monitor-form-method"), "POST");
    const header = await addHeaderRow(user);
    await user.type(
      within(screen.getByTestId(header)).getByTestId(
        "monitor-form-header-name",
      ),
      "X-Team",
    );
    await user.type(
      within(screen.getByTestId(header)).getByTestId(
        "monitor-form-header-value",
      ),
      "core",
    );
    const query = await addQueryRow(user);
    await user.click(screen.getByTestId("monitor-form-mode-basic"));
    expect(screen.getByTestId("monitor-form-advanced-summary")).toHaveAttribute(
      "data-advanced-count",
      "3",
    );
    expect(screen.queryByTestId("monitor-form-method")).toBeNull();
    await user.click(screen.getByTestId("monitor-form-show-advanced"));
    expect(screen.getByTestId("monitor-form-method")).toHaveValue("POST");
    expect(
      within(screen.getByTestId(header)).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveValue("X-Team");
    // The values still apply while the mode is basic.
    await user.click(screen.getByTestId("monitor-form-mode-basic"));
    await user.type(screen.getByTestId("monitor-form-name"), " 2");
    await user.click(screen.getByTestId("monitor-form-mode-advanced"));
    await user.click(
      within(screen.getByTestId(query)).getByTestId("monitor-form-row-remove"),
    );
    await user.click(save());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      name: "Payments API 2",
      method: "POST",
      headers: [{ name: "X-Team", value: "core", secret: false }],
      queryParams: [],
    });
  });

  it("sends each advanced field of the config", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByTestId("monitor-form-timeout"), "5");
    setValue(screen.getByTestId("monitor-form-expected-status"), "200-299,301");
    await user.selectOptions(screen.getByTestId("monitor-form-method"), "POST");
    const query = await addQueryRow(user);
    await user.type(
      within(screen.getByTestId(query)).getByTestId("monitor-form-query-name"),
      "page",
    );
    await user.type(
      within(screen.getByTestId(query)).getByTestId("monitor-form-query-value"),
      "2",
    );
    setValue(screen.getByTestId("monitor-form-body-content"), '{"a":1}');
    const jsonAssertion = await addAssertionRow(user);
    await user.type(
      within(screen.getByTestId(jsonAssertion)).getByTestId(
        "monitor-form-assertion-path",
      ),
      "$.status",
    );
    await user.type(
      within(screen.getByTestId(jsonAssertion)).getByTestId(
        "monitor-form-assertion-expected",
      ),
      '"ok"',
    );
    const bodyAssertion = await addAssertionRow(user);
    await user.selectOptions(
      within(screen.getByTestId(bodyAssertion)).getByTestId(
        "monitor-form-assertion-kind",
      ),
      "bodyContains",
    );
    await user.type(
      within(screen.getByTestId(bodyAssertion)).getByTestId(
        "monitor-form-assertion-text",
      ),
      "ready",
    );
    const timeAssertion = await addAssertionRow(user);
    await user.selectOptions(
      within(screen.getByTestId(timeAssertion)).getByTestId(
        "monitor-form-assertion-kind",
      ),
      "responseTimeBelow",
    );
    await user.type(
      within(screen.getByTestId(timeAssertion)).getByTestId(
        "monitor-form-assertion-ms",
      ),
      "800",
    );
    await user.click(save());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      timeoutSeconds: 5,
      method: "POST",
      expectedStatus: "200-299,301",
      queryParams: [{ name: "page", value: "2" }],
      body: { type: "json", content: '{"a":1}' },
      assertions: [
        { kind: "jsonPathEquals", path: "$.status", expected: '"ok"' },
        { kind: "bodyContains", text: "ready" },
        { kind: "responseTimeBelow", ms: 800 },
      ],
    });
  });
});

describe("Advanced validation beside the field", () => {
  async function submitInvalid(user: User) {
    await user.click(save());
    expect(createMock).not.toHaveBeenCalled();
  }

  it.each([
    "ftp://example.com",
    "https://user:pw@example.com",
    "https://example.com:22",
    "not a url",
    `https://example.com/${"a".repeat(2100)}`,
  ])("explains URL %#", async (url) => {
    const user = await openAdvanced();
    await user.type(screen.getByTestId("monitor-form-name"), "x");
    setValue(screen.getByTestId("monitor-form-url"), url);
    await submitInvalid(user);
    const field = screen.getByTestId("monitor-form-url");
    expectInvalid(field);
    expect(field).toHaveFocus();
  });

  it("rejects a forbidden header name, a duplicate and a bad name beside their rows", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    const forbiddenHeader = await addHeaderRow(user);
    const duplicateSourceHeader = await addHeaderRow(user);
    const duplicateHeader = await addHeaderRow(user);
    setValue(
      within(screen.getByTestId(forbiddenHeader)).getByTestId(
        "monitor-form-header-name",
      ),
      "Host",
    );
    setValue(
      within(screen.getByTestId(forbiddenHeader)).getByTestId(
        "monitor-form-header-value",
      ),
      "x",
    );
    setValue(
      within(screen.getByTestId(duplicateSourceHeader)).getByTestId(
        "monitor-form-header-name",
      ),
      "X-A",
    );
    setValue(
      within(screen.getByTestId(duplicateSourceHeader)).getByTestId(
        "monitor-form-header-value",
      ),
      "x",
    );
    setValue(
      within(screen.getByTestId(duplicateHeader)).getByTestId(
        "monitor-form-header-name",
      ),
      "x-a",
    );
    setValue(
      within(screen.getByTestId(duplicateHeader)).getByTestId(
        "monitor-form-header-value",
      ),
      "x",
    );
    await submitInvalid(user);
    expectInvalid(
      within(screen.getByTestId(forbiddenHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    );
    expectInvalid(
      within(screen.getByTestId(duplicateHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    );
    expect(
      within(screen.getByTestId(forbiddenHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveFocus();
    setValue(
      within(screen.getByTestId(duplicateSourceHeader)).getByTestId(
        "monitor-form-header-name",
      ),
      "bad name",
    );
    await user.click(save());
    expectInvalid(
      within(screen.getByTestId(duplicateSourceHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    );
  });

  it("rejects invalid JSON, an oversized body and a body assertion with HEAD", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByTestId("monitor-form-body-content"), "{not json");
    await submitInvalid(user);
    expectInvalid(screen.getByTestId("monitor-form-body-content"));
    setValue(
      screen.getByTestId("monitor-form-body-content"),
      "a".repeat(64 * 1024 + 1),
    );
    await user.selectOptions(
      screen.getByTestId("monitor-form-body-type"),
      "text",
    );
    await user.click(save());
    expectInvalid(screen.getByTestId("monitor-form-body-content"));
    setValue(screen.getByTestId("monitor-form-body-content"), "");
    await user.selectOptions(screen.getByTestId("monitor-form-method"), "HEAD");
    const assertion = await addAssertionRow(user);
    await user.selectOptions(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-kind",
      ),
      "bodyContains",
    );
    await user.type(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-text",
      ),
      "ok",
    );
    await user.click(save());
    expectInvalid(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-kind",
      ),
    );
  });

  it("rejects a JSONPath with a filter, wildcard or recursive descent", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    const assertion = await addAssertionRow(user);
    await user.type(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-expected",
      ),
      "1",
    );
    for (const path of [
      "$.items[?(@.id==1)]",
      "$.items[*]",
      "$..id",
      "status",
    ]) {
      setValue(
        within(screen.getByTestId(assertion)).getByTestId(
          "monitor-form-assertion-path",
        ),
        path,
      );
      await user.click(save());
      expectInvalid(
        within(screen.getByTestId(assertion)).getByTestId(
          "monitor-form-assertion-path",
        ),
      );
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an expected status, timeout and threshold outside their limits", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByTestId("monitor-form-expected-status"), "700");
    setValue(screen.getByTestId("monitor-form-timeout"), "31");
    const assertion = await addAssertionRow(user);
    await user.selectOptions(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-kind",
      ),
      "responseTimeBelow",
    );
    setValue(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-ms",
      ),
      "40000",
    );
    await submitInvalid(user);
    expectInvalid(screen.getByTestId("monitor-form-expected-status"));
    expectInvalid(screen.getByTestId("monitor-form-timeout"));
    expectInvalid(
      within(screen.getByTestId(assertion)).getByTestId(
        "monitor-form-assertion-ms",
      ),
    );
    // The first invalid field in page order takes focus (the timeout sits above the status).
    expect(screen.getByTestId("monitor-form-timeout")).toHaveFocus();
  });

  it("opens advanced mode to focus an invalid advanced field while the form is in basic mode", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByTestId("monitor-form-expected-status"), "9");
    await user.click(screen.getByTestId("monitor-form-mode-basic"));
    await user.click(save());
    expect(screen.getByTestId("monitor-form-mode-advanced")).toBeChecked();
    expect(screen.getByTestId("monitor-form-expected-status")).toHaveFocus();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("Rows", () => {
  it("names each row, focuses the new row and moves focus after a removal", async () => {
    const user = await openAdvanced();
    const add = screen.getByTestId("monitor-form-add-header");
    const firstHeader = await addHeaderRow(user);
    expect(
      within(screen.getByTestId(firstHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveFocus();
    const secondHeader = await addHeaderRow(user);
    const thirdHeader = await addHeaderRow(user);
    expect(
      within(screen.getByTestId(thirdHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveFocus();
    await user.type(
      within(screen.getByTestId(thirdHeader)).getByTestId(
        "monitor-form-header-name",
      ),
      "X-Third",
    );
    await user.click(
      within(screen.getByTestId(secondHeader)).getByTestId(
        "monitor-form-row-remove",
      ),
    );
    // The former row 3 is now row 2 and takes the focus.
    expect(
      within(screen.getByTestId(thirdHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveValue("X-Third");
    expect(
      within(screen.getByTestId(thirdHeader)).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveFocus();
    await user.click(
      within(screen.getByTestId(thirdHeader)).getByTestId(
        "monitor-form-row-remove",
      ),
    );
    expect(add).toHaveFocus();
  });

  it("limits headers to 20, query params to 20 and assertions to 10 with a message beside the button", async () => {
    const user = await openAdvanced();
    const addHeader = screen.getByTestId("monitor-form-add-header");
    for (let i = 0; i < 21; i += 1) await user.click(addHeader);
    expect(screen.getAllByTestId(/^monitor-form-header-row-/)).toHaveLength(20);
    expect(addHeader).toHaveAccessibleDescription();
    const addParam = screen.getByTestId("monitor-form-add-query");
    for (let i = 0; i < 21; i += 1) await user.click(addParam);
    expect(screen.getAllByTestId(/^monitor-form-query-row-/)).toHaveLength(20);
    expect(addParam).toHaveAccessibleDescription();
    const addAssertion = screen.getByTestId("monitor-form-add-assertion");
    for (let i = 0; i < 11; i += 1) await user.click(addAssertion);
    expect(screen.getAllByTestId(/^monitor-form-assertion-row-/)).toHaveLength(
      10,
    );
    expect(addAssertion).toHaveAccessibleDescription();
  });
});

describe("Permanent warnings and notes", () => {
  it("keeps the visibility warning under query params and body", async () => {
    await openAdvanced();
    expect(
      screen.getByTestId("monitor-form-query-visible-warning"),
    ).toBeVisible();
    expect(
      screen.getByTestId("monitor-form-query-visible-warning"),
    ).not.toBeEmptyDOMElement();
    expect(
      screen.getByTestId("monitor-form-body-visible-warning"),
    ).toBeVisible();
    expect(
      screen.getByTestId("monitor-form-body-visible-warning"),
    ).not.toBeEmptyDOMElement();
  });

  it("notes that GET and HEAD send no body", async () => {
    const user = await openAdvanced();
    expect(screen.getByTestId("monitor-form-body-not-sent")).toHaveAttribute(
      "data-method",
      "GET",
    );
    await user.selectOptions(screen.getByTestId("monitor-form-method"), "POST");
    expect(screen.queryByTestId("monitor-form-body-not-sent")).toBeNull();
    await user.selectOptions(screen.getByTestId("monitor-form-method"), "HEAD");
    expect(screen.getByTestId("monitor-form-body-not-sent")).toHaveAttribute(
      "data-method",
      "HEAD",
    );
    await fillBasic(user);
    setValue(
      screen.getByTestId("monitor-form-body-content"),
      '{"public":true}',
    );
    await user.click(save());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      method: "HEAD",
      body: { type: "json", content: '{"public":true}' },
    });
  });
});
