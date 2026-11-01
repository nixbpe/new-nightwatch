import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type { MonitorTestResult } from "@nightwatch/api-contract";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { fetchProjectDetail } from "../../lib/api/projects";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  createMonitor,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  testMonitorDraft,
  testMonitorEdit,
  updateMonitor,
} from "../../lib/api/monitors";
import {
  must,
  noChecks,
  noIncidents,
  noResponseTimes,
  projectDetail,
} from "./detail-test-support";
import {
  A,
  B,
  context,
  detail,
  editPath,
  MONITOR_ID,
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
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorLastResponse: vi.fn(() => Promise.resolve({ response: null })),
  fetchMonitorEvents: vi.fn(() =>
    Promise.resolve({ events: [], page: { limit: 20, offset: 0, total: 0 } }),
  ),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
  testMonitorDraft: vi.fn(),
  testMonitorEdit: vi.fn(),
}));

const createMock = vi.mocked(createMonitor);
const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);
const draftMock = vi.mocked(testMonitorDraft);
const editTestMock = vi.mocked(testMonitorEdit);

const HEADER_ID = "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Unique per run, so a hit in a scan can only be this run's value.
const SECRET = `s3cr3t-${crypto.randomUUID()}`;
const OTHER_SECRET = `n3w-${crypto.randomUUID()}`;

const testResult: { result: MonitorTestResult } = {
  result: {
    checkedAt: "2026-09-30T07:30:00.000Z",
    outcome: "pass",
    httpStatus: 200,
    responseTimeMs: 182,
    diagnostics: {
      redirects: 0,
      dnsMs: 2,
      connectMs: 3,
      tlsMs: 37,
      ttfbMs: 140,
      remoteAddress: "203.0.113.5",
      reasonPhrase: "OK",
    },
    failureReason: null,
    tlsReason: null,
    assertions: [],
    url: "https://api.acme.example/health",
    evaluatedFromPrefix: false,
    ssl: {
      level: "ok",
      daysRemaining: 128,
      host: "api.acme.example",
      issuer: "Example CA",
      notAfter: "2027-02-05T00:00:00.000Z",
    },
  },
};

beforeEach(() => {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  });
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  detailMock.mockResolvedValue({ monitor: detail() });
  createMock.mockResolvedValue({ monitor: record() });
  updateMock.mockResolvedValue({ monitor: record({ version: 4 }) });
  draftMock.mockResolvedValue(testResult);
  editTestMock.mockResolvedValue(testResult);
});

afterEach(() => {
  vi.resetAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

const saveCreate = () => screen.getByTestId("monitor-form-save");
const saveEdit = () => screen.getByTestId("monitor-form-save");
const testButton = () => screen.getByTestId("monitor-form-test");

let openedRouter: ReturnType<typeof renderForm>["router"];
async function openCreate(): Promise<User> {
  const user = userEvent.setup();
  openedRouter = renderForm(newPath()).router;
  await screen.findByTestId("monitor-form-name");
  await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
  await user.type(
    screen.getByTestId("monitor-form-url"),
    "https://api.acme.example/health",
  );
  await user.click(screen.getByTestId("monitor-form-mode-advanced"));
  return user;
}

async function chooseAuth(user: User, type: string) {
  await user.selectOptions(screen.getByTestId("monitor-form-auth-type"), type);
}

const storedBearer = () =>
  detail({
    auth: { type: "bearer" },
    secretSlots: [{ slot: "auth.token", configured: true }],
  });

async function openEdit(monitor = storedBearer()): Promise<User> {
  detailMock.mockResolvedValue({ monitor });
  const user = userEvent.setup();
  renderForm(editPath());
  await waitFor(() => {
    const field = screen.getByTestId("monitor-form-name");
    expect(field).toHaveValue("Payments API");
    return field;
  });
  return user;
}

function expectInvalid(field: HTMLElement) {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
  const described = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  const error = described.find((id) => id.endsWith("-error"));
  expect(error).toBeDefined();
  expect(document.getElementById(must(error))).not.toBeEmptyDOMElement();
}

function secretHeaderId() {
  const matching = screen
    .getAllByTestId(/^monitor-form-header-row-/)
    .filter(
      (row) =>
        within(row).getByTestId<HTMLInputElement>("monitor-form-header-secret")
          .checked,
    );
  expect(matching).toHaveLength(1);
  return must(must(matching.pop()).getAttribute("data-testid") ?? undefined);
}
function plainHeaderId() {
  const matching = screen
    .getAllByTestId(/^monitor-form-header-row-/)
    .filter(
      (row) =>
        !within(row).getByTestId<HTMLInputElement>("monitor-form-header-secret")
          .checked,
    );
  expect(matching).toHaveLength(1);
  return must(must(matching.pop()).getAttribute("data-testid") ?? undefined);
}

const passwordInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  );

describe("Create: auth section and secret entries", () => {
  it("offers the four auth types and sends none by default", async () => {
    const user = await openCreate();
    const select = screen.getByTestId("monitor-form-auth-type");
    expect(
      Array.from((select as HTMLSelectElement).options)
        .map((option) => option.value)
        .sort(),
    ).toEqual(["none", "bearer", "basic", "apiKey"].sort());
    expect(passwordInputs()).toHaveLength(0);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "none" },
      secrets: [],
    });
  });

  it("sends a Bearer token as one secret entry in a write-only password field", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    const token = screen.getByTestId("monitor-secret-auth.token-value");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByTestId("monitor-secret-auth.token-value")).toBeVisible();
    await user.type(token, SECRET);
    // Nothing of the value reaches an attribute or the markup.
    expect(token).toHaveValue(SECRET);
    expect(token).not.toHaveAttribute("value");
    expect(document.body.innerHTML).not.toContain(SECRET);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const body = createMock.mock.calls[0]?.[2];
    expect(body).toMatchObject({
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: SECRET }],
    });
    expect(body).not.toHaveProperty("headers.0.value");
  });

  it("sends Basic as a username and a password entry", async () => {
    const user = await openCreate();
    await chooseAuth(user, "basic");
    await user.type(
      screen.getByTestId("monitor-secret-auth.username-value"),
      "svc",
    );
    await user.type(
      screen.getByTestId("monitor-secret-auth.password-value"),
      SECRET,
    );
    expect(
      screen.getByTestId("monitor-secret-auth.username-value"),
    ).toHaveAttribute("type", "password");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "basic" },
      secrets: [
        { slot: "auth.username", value: "svc" },
        { slot: "auth.password", value: SECRET },
      ],
    });
  });

  it("sends an API key with its non-secret header name and warns about a header with the same name", async () => {
    const user = await openCreate();
    await chooseAuth(user, "apiKey");
    await user.type(
      screen.getByTestId("monitor-form-auth-header-name"),
      "X-Key",
    );
    await user.type(
      screen.getByTestId("monitor-secret-auth.apiKey-value"),
      SECRET,
    );
    await user.click(screen.getByTestId("monitor-form-add-header"));
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-name",
      ),
      "x-key",
    );
    expect(screen.getByTestId("monitor-form-auth")).toBeVisible();
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("monitor-form-auth")).toBeVisible();
    await user.clear(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-name",
      ),
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-name",
      ),
      "X-Team",
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
      "core",
    );
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "apiKey", headerName: "X-Key" },
      secrets: [{ slot: "auth.apiKey", value: SECRET }],
    });
  });

  it("validates the API key header name as an HTTP token", async () => {
    const user = await openCreate();
    await chooseAuth(user, "apiKey");
    await user.type(
      screen.getByTestId("monitor-form-auth-header-name"),
      "bad name",
    );
    await user.type(
      screen.getByTestId("monitor-secret-auth.apiKey-value"),
      SECRET,
    );
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("monitor-form-auth-header-name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("blocks Save with an empty required secret and keeps the request unsent", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    const token = screen.getByTestId("monitor-secret-auth.token-value");
    expect(token).toHaveAttribute("aria-invalid", "true");
    expectInvalid(token);
    expect(token).toHaveFocus();
    await user.type(token, SECRET);
    expect(token).not.toHaveAttribute("aria-invalid");
  });

  it("drops the typed value when the auth type changes", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await chooseAuth(user, "basic");
    await chooseAuth(user, "bearer");
    expect(screen.getByTestId("monitor-secret-auth.token-value")).toHaveValue(
      "",
    );
  });

  it("keeps the typed secret when the mode is switched to basic and back", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await user.click(screen.getByTestId("monitor-form-mode-basic"));
    expect(passwordInputs()).toHaveLength(0);
    await user.click(screen.getByTestId("monitor-form-mode-advanced"));
    expect(screen.getByTestId("monitor-secret-auth.token-value")).toHaveValue(
      SECRET,
    );
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[2]).toMatchObject({
      secrets: [{ slot: "auth.token", value: SECRET }],
    });
  });
});

describe("Create: secret headers", () => {
  async function addHeader(user: User, name: string) {
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
    const id = must(must(added.pop()).getAttribute("data-testid") ?? undefined);
    await user.type(
      within(screen.getByTestId(id)).getByTestId("monitor-form-header-name"),
      name,
    );
    return id;
  }

  it("turns the value into a password field when the row is marked secret", async () => {
    const user = await openCreate();
    await addHeader(user, "X-Api-Key");
    const value = within(
      screen.getByTestId(/^monitor-form-header-row-/),
    ).getByTestId("monitor-form-header-value");
    expect(value).not.toHaveAttribute("type", "password");
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    const secret = within(
      screen.getByTestId(/^monitor-form-header-row-/),
    ).getByTestId("monitor-form-header-value");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveAttribute("autocomplete", "new-password");
  });

  it("sends a client UUID id per secret row, the same across edits, and never the value in the header", async () => {
    const user = await openCreate();
    const firstHeader = await addHeader(user, "X-One");
    const secondHeader = await addHeader(user, "X-Two");
    await user.click(
      within(screen.getByTestId(firstHeader)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    await user.click(
      within(screen.getByTestId(secondHeader)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    await user.type(
      within(screen.getByTestId(firstHeader)).getByTestId(
        "monitor-form-header-value",
      ),
      SECRET,
    );
    await user.type(
      within(screen.getByTestId(secondHeader)).getByTestId(
        "monitor-form-header-value",
      ),
      OTHER_SECRET,
    );
    // Renaming a row must not change its id.
    await user.type(
      within(screen.getByTestId(firstHeader)).getByTestId(
        "monitor-form-header-name",
      ),
      "-Key",
    );
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const body = createMock.mock.calls[0]?.[2];
    const headers = body?.headers ?? [];
    expect(headers).toHaveLength(2);
    const [first, second] = headers;
    expect(first).toMatchObject({ name: "X-One-Key", secret: true });
    expect(first?.id).toMatch(UUID);
    expect(second?.id).toMatch(UUID);
    expect(first?.id).not.toBe(second?.id);
    expect(first).not.toHaveProperty("value");
    expect(body?.secrets).toEqual([
      { slot: `header.${first?.id ?? ""}`, value: SECRET },
      { slot: `header.${second?.id ?? ""}`, value: OTHER_SECRET },
    ]);
  });

  it("blocks Save with an empty secret header value beside that row", async () => {
    const user = await openCreate();
    await addHeader(user, "X-Api-Key");
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the typed value when a secret row is made plain again", async () => {
    const user = await openCreate();
    await addHeader(user, "X-Api-Key");
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
      SECRET,
    );
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    expect(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
    ).toHaveValue("");
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
      "plain",
    );
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const body = createMock.mock.calls[0]?.[2];
    expect(body?.secrets).toEqual([]);
    expect(body?.headers?.[0]).toMatchObject({ value: "plain", secret: false });
  });
});

describe("Edit: replace, keep and delete", () => {
  it("shows 'ตั้งค่าแล้ว' with a replace button and sends keep when it is not pressed", async () => {
    const user = await openEdit();
    expect(
      screen.getByTestId("monitor-secret-auth.token-stored"),
    ).toBeVisible();
    expect(passwordInputs()).toHaveLength(0);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", action: "keep" }],
    });
  });

  it("opens an empty password field on replace and sends the new value", async () => {
    const user = await openEdit();
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    const token = screen.getByTestId("monitor-secret-auth.token-value");
    expect(token).toHaveValue("");
    expect(token).toHaveFocus();
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "new-password");
    await user.type(token, SECRET);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      secrets: [{ slot: "auth.token", action: "replace", value: SECRET }],
    });
  });

  it("blocks an empty replacement with the message and cancelling it goes back to keep", async () => {
    const user = await openEdit();
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    await user.click(saveEdit());
    expect(updateMock).not.toHaveBeenCalled();
    expectInvalid(screen.getByTestId("monitor-secret-auth.token-value"));
    await user.click(screen.getByTestId("monitor-secret-auth.token-cancel"));
    expect(
      screen.getByTestId("monitor-secret-auth.token-stored"),
    ).toBeVisible();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      secrets: [{ slot: "auth.token", action: "keep" }],
    });
  });

  it("forgets a typed replacement that was cancelled", async () => {
    const user = await openEdit();
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await user.click(screen.getByTestId("monitor-secret-auth.token-cancel"));
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.stringify(updateMock.mock.calls[0]?.[3])).not.toContain(SECRET);
  });

  it("warns that the old secrets are deleted when the type changes and asks for the new type's fields", async () => {
    const user = await openEdit();
    expect(
      screen.getByTestId("monitor-auth-secret-dropped"),
    ).toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-auth-secret-dropped")).toHaveAttribute(
      "data-dropped",
      "false",
    );
    await chooseAuth(user, "basic");
    expect(screen.getByTestId("monitor-auth-secret-dropped")).toBeVisible();
    expect(
      screen.getByTestId("monitor-auth-secret-dropped"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-auth-secret-dropped")).toHaveAttribute(
      "data-dropped",
      "true",
    );
    await user.click(saveEdit());
    expect(updateMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("monitor-secret-auth.username-value"),
    ).toHaveAttribute("aria-invalid", "true");
    await user.type(
      screen.getByTestId("monitor-secret-auth.username-value"),
      "svc",
    );
    await user.type(
      screen.getByTestId("monitor-secret-auth.password-value"),
      SECRET,
    );
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      auth: { type: "basic" },
      secrets: [
        { slot: "auth.username", action: "replace", value: "svc" },
        { slot: "auth.password", action: "replace", value: SECRET },
        { slot: "auth.token", action: "delete" },
      ],
    });
  });

  it("removes the auth secrets with the delete button and sends a delete", async () => {
    const user = await openEdit();
    await user.click(screen.getByTestId("monitor-auth-secret-remove"));
    expect(screen.getByTestId("monitor-form-auth-type")).toHaveValue("none");
    expect(screen.getByTestId("monitor-auth-secret-dropped")).toBeVisible();
    expect(
      screen.getByTestId("monitor-auth-secret-dropped"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-auth-secret-dropped")).toHaveAttribute(
      "data-dropped",
      "true",
    );
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      auth: { type: "none" },
      secrets: [{ slot: "auth.token", action: "delete" }],
    });
  });

  describe("secret headers", () => {
    const withHeader = () =>
      detail({
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        secretSlots: [{ slot: `header.${HEADER_ID}`, configured: true }],
      });

    it("shows a stored secret header as set and replaces it with a new value", async () => {
      const user = await openEdit(withHeader());
      expect(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-secret",
        ),
      ).toBeChecked();
      await user.click(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-header-secret-replace",
        ),
      );
      await user.type(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-value",
        ),
        SECRET,
      );
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      const body = updateMock.mock.calls[0]?.[3];
      expect(body?.headers).toEqual([
        { id: HEADER_ID, name: "X-Api-Key", secret: true },
      ]);
      expect(body?.secrets).toEqual([
        { slot: `header.${HEADER_ID}`, action: "replace", value: SECRET },
      ]);
    });

    it("warns 'ค่าลับเดิมจะถูกลบ' when a stored secret header becomes plain, and deletes its slot", async () => {
      const user = await openEdit(withHeader());
      await user.click(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-secret",
        ),
      );
      expect(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-header-secret-dropped",
        ),
      ).toBeVisible();
      await user.type(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-value",
        ),
        "plain",
      );
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      const body = updateMock.mock.calls[0]?.[3];
      expect(body?.headers?.[0]).toMatchObject({
        value: "plain",
        secret: false,
      });
      expect(body?.secrets).toEqual([
        { slot: `header.${HEADER_ID}`, action: "delete" },
      ]);
    });

    it("deletes the slot of a removed secret header and keeps its id for a row that stays", async () => {
      const user = await openEdit(withHeader());
      await user.click(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-row-remove",
        ),
      );
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
        headers: [],
        secrets: [{ slot: `header.${HEADER_ID}`, action: "delete" }],
      });
    });

    it("gives a plain stored header that becomes secret a client id and needs its value", async () => {
      const user = await openEdit(
        detail({ headers: [{ name: "X-Team", value: "core", secret: false }] }),
      );
      await user.click(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-secret",
        ),
      );
      await user.click(saveEdit());
      expect(updateMock).not.toHaveBeenCalled();
      await user.type(
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-value",
        ),
        SECRET,
      );
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      const body = updateMock.mock.calls[0]?.[3];
      const id = body?.headers?.[0]?.id ?? "";
      expect(id).toMatch(UUID);
      expect(body?.secrets).toEqual([
        { slot: `header.${id}`, action: "replace", value: SECRET },
      ]);
    });
  });
});

describe("Focus stays in the form when a pressed button goes away", () => {
  const withHeaders = () =>
    detail({
      auth: { type: "bearer" },
      headers: [
        { id: HEADER_ID, name: "X-One", secret: true },
        { name: "X-Team", value: "core", secret: false },
      ],
      secretSlots: [
        { slot: "auth.token", configured: true },
        { slot: `header.${HEADER_ID}`, configured: true },
      ],
    });

  it("moves to the replace button of the same slot after cancelling a replacement", async () => {
    const user = await openEdit(withHeaders());
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    await user.click(screen.getByTestId("monitor-secret-auth.token-cancel"));
    expect(
      screen.getByTestId("monitor-secret-auth.token-replace"),
    ).toHaveFocus();
    await user.click(
      within(screen.getByTestId(secretHeaderId())).getByTestId(
        "monitor-header-secret-replace",
      ),
    );
    await user.click(
      within(screen.getByTestId(secretHeaderId())).getByTestId(
        "monitor-header-secret-cancel",
      ),
    );
    expect(
      within(screen.getByTestId(secretHeaderId())).getByTestId(
        "monitor-header-secret-replace",
      ),
    ).toHaveFocus();
  });

  it("moves to the replacement field after pressing replace", async () => {
    const user = await openEdit(withHeaders());
    await user.click(
      within(screen.getByTestId(secretHeaderId())).getByTestId(
        "monitor-header-secret-replace",
      ),
    );
    expect(
      within(screen.getByTestId(secretHeaderId())).getByTestId(
        "monitor-form-header-value",
      ),
    ).toHaveFocus();
  });

  it("moves to the auth type after removing the auth secrets", async () => {
    const user = await openEdit(withHeaders());
    await user.click(screen.getByTestId("monitor-auth-secret-remove"));
    expect(screen.getByTestId("monitor-form-auth-type")).toHaveFocus();
  });

  it("keeps the focus on the checkbox when a row is made secret or plain", async () => {
    const user = await openEdit(withHeaders());
    const box = within(screen.getByTestId(plainHeaderId())).getByTestId(
      "monitor-form-header-secret",
    );
    await user.click(box);
    expect(box).toHaveFocus();
    await user.click(box);
    expect(box).toHaveFocus();
  });

  it("moves to the name of the row that took its place after removing a secret row, else to the add button", async () => {
    const user = await openEdit(withHeaders());
    await user.click(
      within(screen.getByTestId(secretHeaderId())).getByTestId(
        "monitor-form-row-remove",
      ),
    );
    expect(
      within(screen.getByTestId(plainHeaderId())).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveFocus();
    expect(
      within(screen.getByTestId(plainHeaderId())).getByTestId(
        "monitor-form-header-name",
      ),
    ).toHaveValue("X-Team");
    await user.click(
      within(screen.getByTestId(plainHeaderId())).getByTestId(
        "monitor-form-row-remove",
      ),
    );
    expect(screen.getByTestId("monitor-form-add-header")).toHaveFocus();
  });
});

describe("Edit: origin change", () => {
  const changeUrl = (value: string) => {
    fireEvent.change(screen.getByTestId("monitor-form-url"), {
      target: { value },
    });
  };

  it("names the origin wording, turns Save and Test off, and lifts it by replacing the secret", async () => {
    const user = await openEdit();
    changeUrl("https://other.example/health");
    expectInvalid(screen.getByTestId("monitor-form-url"));
    expect(saveEdit()).toBeDisabled();
    expect(testButton()).toBeDisabled();
    expect(testButton()).toHaveAccessibleDescription();
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    // An open replacement is not a kept value: Save is on, and it asks for the new value.
    await user.click(saveEdit());
    expect(updateMock).not.toHaveBeenCalled();
    expectInvalid(screen.getByTestId("monitor-secret-auth.token-value"));
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    expect(saveEdit()).toBeEnabled();
    expect(testButton()).toBeEnabled();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      url: "https://other.example/health",
      secrets: [{ slot: "auth.token", action: "replace", value: SECRET }],
    });
  });

  it("lifts it by deleting every kept secret", async () => {
    const user = await openEdit(
      detail({
        auth: { type: "bearer" },
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        secretSlots: [
          { slot: "auth.token", configured: true },
          { slot: `header.${HEADER_ID}`, configured: true },
        ],
      }),
    );
    changeUrl("http://api.acme.example/health");
    expect(saveEdit()).toBeDisabled();
    await user.click(screen.getByTestId("monitor-auth-secret-remove"));
    // The secret header is still kept.
    expect(saveEdit()).toBeDisabled();
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-row-remove",
      ),
    );
    expect(saveEdit()).toBeEnabled();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      auth: { type: "none" },
      headers: [],
    });
  });

  // Path, query and default-port equivalence are unit-tested directly against
  // secretOriginChanged in form/secrets.test.tsx's "treats %s as %s" it.each;
  // this one case confirms that logic also drives the UI (Save/Test enabled,
  // no origin-changed description, a "keep" sent on save).
  it("keeps Save and Test on with a kept secret when only a path changes", async () => {
    const next = "https://api.acme.example/other";
    const user = await openEdit();
    changeUrl(next);
    expect(saveEdit()).toBeEnabled();
    expect(testButton()).toBeEnabled();
    expect(screen.getByTestId("monitor-form-url")).not.toHaveAttribute(
      "aria-invalid",
    );
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      url: next,
      secrets: [{ slot: "auth.token", action: "keep" }],
    });
  });

  it("does not block an origin change on a monitor without secrets", async () => {
    const user = await openEdit(detail());
    changeUrl("https://other.example/health");
    expect(saveEdit()).toBeEnabled();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Test panel with secrets", () => {
  it("tests a draft with the values typed so far and does not store them", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(draftMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: SECRET }],
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not send a test with an empty required secret", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.click(testButton());
    expect(draftMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("monitor-secret-auth.token-value"),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("tests in Edit with keep for an untouched slot and replace for a replaced one", async () => {
    const user = await openEdit(
      detail({
        auth: { type: "bearer" },
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        secretSlots: [
          { slot: "auth.token", configured: true },
          { slot: `header.${HEADER_ID}`, configured: true },
        ],
      }),
    );
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-header-secret-replace",
      ),
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
      SECRET,
    );
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    expect(draftMock).not.toHaveBeenCalled();
    const [, , monitorId, body] = editTestMock.mock.calls[0] ?? [];
    expect(monitorId).toBe(MONITOR_ID);
    expect(body).toMatchObject({
      name: "Payments API",
      url: "https://api.acme.example/health",
      auth: { type: "bearer" },
    });
    expect(body).not.toHaveProperty("expectedVersion");
    expect(body?.secrets).toEqual([
      { slot: "auth.token", action: "keep" },
      { slot: `header.${HEADER_ID}`, action: "replace", value: SECRET },
    ]);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not send a Test in Edit whose replacement is empty", async () => {
    const user = await openEdit();
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    await user.click(testButton());
    expect(editTestMock).not.toHaveBeenCalled();
    expectInvalid(screen.getByTestId("monitor-secret-auth.token-value"));
  });

  it("marks a result stale when a secret is changed after the test, without keeping the value", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    expect(screen.queryByTestId("monitor-test-stale")).toBeNull();
    await user.type(screen.getByTestId("monitor-secret-auth.token-value"), "x");
    expect(screen.getByTestId("monitor-test-stale")).toBeVisible();
  });

  it("marks a result stale when a secret is typed while the test is in flight", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    let release: (value: typeof testResult) => void = () => undefined;
    draftMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await user.click(testButton());
    await screen.findByTestId("monitor-form-test");
    await user.type(screen.getByTestId("monitor-secret-auth.token-value"), "x");
    release(testResult);
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    expect(screen.getByTestId("monitor-test-stale")).toBeVisible();
  });

  it("marks a result stale once a replacement is opened, and current again after cancelling it untouched", async () => {
    const user = await openEdit();
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    expect(screen.queryByTestId("monitor-test-stale")).toBeNull();
    // keep becomes replace: the shape changes, though nothing was typed.
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    expect(screen.getByTestId("monitor-test-stale")).toBeVisible();
    await user.click(screen.getByTestId("monitor-secret-auth.token-cancel"));
    expect(screen.queryByTestId("monitor-test-stale")).toBeNull();
  });

  it("keeps a result stale after a replacement was typed and then cancelled", async () => {
    const user = await openEdit();
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    await user.type(screen.getByTestId("monitor-secret-auth.token-value"), "x");
    await user.click(screen.getByTestId("monitor-secret-auth.token-cancel"));
    expect(screen.getByTestId("monitor-test-stale")).toBeVisible();
  });
});

describe("Server refusals of secret entries", () => {
  it("shows the origin wording beside the URL on a 422 with a replaced secret", async () => {
    const { ApiError } = await import("../../lib/api/client");
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_SECRET_ORIGIN_CHANGED", "x", 422),
    );
    const user = await openEdit();
    await user.click(saveEdit());
    await waitFor(() => {
      expectInvalid(screen.getByTestId("monitor-form-url"));
    });
  });
});

describe("Server refusals of secret entries are placed beside the slot's field", () => {
  const reasons = ["required", "too_long", "invalid_format", "crlf"] as const;

  async function refuse(fields: { field: string; reason: string }[]) {
    const { ApiError } = await import("../../lib/api/client");
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, { fields }),
    );
  }

  async function openWithAuthAndHeader() {
    const user = await openCreate();
    await chooseAuth(user, "basic");
    await user.type(
      screen.getByTestId("monitor-secret-auth.username-value"),
      "svc",
    );
    await user.type(
      screen.getByTestId("monitor-secret-auth.password-value"),
      SECRET,
    );
    await user.click(screen.getByTestId("monitor-form-add-header"));
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-name",
      ),
      "X-Key",
    );
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
      OTHER_SECRET,
    );
    return user;
  }

  it.each(reasons)(
    "places secrets.N.value %s at the auth field and at the header row",
    async (reason) => {
      const user = await openWithAuthAndHeader();
      // Entries: 0 auth.username, 1 auth.password, 2 the header slot.
      await refuse([
        { field: "secrets.1.value", reason },
        { field: "secrets.2.value", reason },
      ]);
      await user.click(saveCreate());
      await waitFor(() => {
        expect(
          screen.getByTestId("monitor-secret-auth.password-value"),
        ).toHaveAttribute("aria-invalid", "true");
      });
      for (const field of [
        screen.getByTestId("monitor-secret-auth.password-value"),
        within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
          "monitor-form-header-value",
        ),
      ]) {
        expect(field).toHaveAttribute("aria-invalid", "true");
        expectInvalid(field);
      }
      expect(
        screen.getByTestId("monitor-secret-auth.username-value"),
      ).not.toHaveAttribute("aria-invalid");
      // Nothing falls back to the summary line.
      expect(screen.queryByTestId("monitor-form-unplaced-error")).toBeNull();
    },
  );

  it("places a keep with no stored value, and the section-level auth required, at the token field", async () => {
    const { ApiError } = await import("../../lib/api/client");
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [
          { field: "secrets.0", reason: "required" },
          { field: "auth", reason: "required" },
        ],
      }),
    );
    const user = await openEdit();
    await user.click(saveEdit());
    const replace = await screen.findByTestId(
      "monitor-secret-auth.token-replace",
    );
    expect(replace).toHaveAttribute("aria-invalid", "true");
    expectInvalid(replace);
    expect(screen.queryByTestId("monitor-form-unplaced-error")).toBeNull();
  });

  it.each(["invalid_format", "duplicate", "required"])(
    "places secrets.N.slot %s at the field of that slot",
    async (reason) => {
      const { ApiError } = await import("../../lib/api/client");
      updateMock.mockRejectedValue(
        new ApiError("MONITOR_INVALID", "invalid", 400, {
          fields: [{ field: "secrets.0.slot", reason }],
        }),
      );
      const user = await openEdit();
      await user.click(saveEdit());
      const replace = await screen.findByTestId(
        "monitor-secret-auth.token-replace",
      );
      await waitFor(() => {
        expect(replace).toHaveAttribute("aria-invalid", "true");
      });
      expectInvalid(replace);
      expect(screen.queryByTestId("monitor-form-unplaced-error")).toBeNull();
    },
  );

  it("lists an entry no field matches in the summary line", async () => {
    const user = await openWithAuthAndHeader();
    await refuse([{ field: "secrets.9.value", reason: "too_long" }]);
    await user.click(saveCreate());
    expect(
      await screen.findByTestId("monitor-form-unplaced-error"),
    ).toBeVisible();
  });
});

describe("Secret hygiene", () => {
  type Rendered = ReturnType<typeof renderForm>;

  // Saves and tests call the API functions directly, never useMutation, so the
  // MutationCache (which would keep request bodies) must stay empty. Scanning it
  // for a value would prove nothing while it is empty; assert that instead.
  const expectNoRetainedRequests = (rendered: Rendered) => {
    expect(rendered.queryClient.getMutationCache().getAll()).toHaveLength(0);
  };

  /** Every place a value could linger: markup, query cache, storage and the console. */
  function findSecrets(rendered: Rendered, values: string[]): string[] {
    const consoleCalls = [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.debug).mock.calls,
    ];
    const places: Record<string, string> = {
      markup: document.documentElement.outerHTML,
      queryCache: JSON.stringify(
        rendered.queryClient
          .getQueryCache()
          .getAll()
          .map((query) => [query.queryKey, query.state.data]),
      ),
      localStorage: JSON.stringify(Object.entries(localStorage)),
      sessionStorage: JSON.stringify(Object.entries(sessionStorage)),
      console: JSON.stringify(consoleCalls),
    };
    return values.flatMap((value) =>
      Object.entries(places)
        .filter(([, text]) => text.includes(value))
        .map(([place]) => `${value} in ${place}`),
    );
  }

  beforeEach(() => {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("leaves no secret in the page, the caches, storage or the console after a Create", async () => {
    const user = userEvent.setup();
    const rendered = renderForm(newPath());
    await screen.findByTestId("monitor-form-name");
    await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
    await user.type(
      screen.getByTestId("monitor-form-url"),
      "https://api.acme.example/health",
    );
    await user.click(screen.getByTestId("monitor-form-mode-advanced"));
    await chooseAuth(user, "basic");
    await user.type(
      screen.getByTestId("monitor-secret-auth.username-value"),
      "svc-user-1",
    );
    await user.type(
      screen.getByTestId("monitor-secret-auth.password-value"),
      SECRET,
    );
    await user.click(screen.getByTestId("monitor-form-add-header"));
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-name",
      ),
      "X-Key",
    );
    await user.click(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-secret",
      ),
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-header-row-/)).getByTestId(
        "monitor-form-header-value",
      ),
      OTHER_SECRET,
    );
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    const values = [SECRET, OTHER_SECRET, "svc-user-1"];
    expect(findSecrets(rendered, values)).toEqual([]);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(MONITOR_ID);
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(findSecrets(rendered, values)).toEqual([]);
    expect(passwordInputs()).toHaveLength(0);
    expectNoRetainedRequests(rendered);
  });

  it("leaves no secret behind after an Edit that replaced one", async () => {
    detailMock.mockResolvedValue({ monitor: storedBearer() });
    const user = userEvent.setup();
    const rendered = renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(screen.getByTestId("monitor-secret-auth.token-replace"));
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-test-result")).toHaveAttribute(
        "data-outcome",
        "pass",
      );
    });
    expect(findSecrets(rendered, [SECRET])).toEqual([]);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(MONITOR_ID);
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(findSecrets(rendered, [SECRET])).toEqual([]);
    expectNoRetainedRequests(rendered);
  });

  it("keeps the typed value out of the markup after a refused save, so a retry needs no retyping", async () => {
    const { ApiError } = await import("../../lib/api/client");
    createMock.mockRejectedValue(new ApiError("INTERNAL_ERROR", "x", 500));
    const user = userEvent.setup();
    const rendered = renderForm(newPath());
    await screen.findByTestId("monitor-form-name");
    await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
    await user.type(
      screen.getByTestId("monitor-form-url"),
      "https://api.acme.example/health",
    );
    await user.click(screen.getByTestId("monitor-form-mode-advanced"));
    await chooseAuth(user, "bearer");
    await user.type(
      screen.getByTestId("monitor-secret-auth.token-value"),
      SECRET,
    );
    await user.click(saveCreate());
    await screen.findByTestId("monitor-form-error");
    expect(screen.getByTestId("monitor-secret-auth.token-value")).toHaveValue(
      SECRET,
    );
    expect(findSecrets(rendered, [SECRET])).toEqual([]);
    // Positive control: the scan does see a controlled field's value attribute.
    expect(findSecrets(rendered, ["Payments API"])).toContain(
      "Payments API in markup",
    );
  });

  it("finds a value seeded in each scanned place, so an empty result means something", async () => {
    const seeded = `seed-${crypto.randomUUID()}`;
    const rendered = renderForm(newPath());
    await screen.findByTestId("monitor-form-name");
    rendered.queryClient.setQueryData(["control"], { value: seeded });
    localStorage.setItem("control", seeded);
    sessionStorage.setItem("control", seeded);
    console.log(seeded);
    const el = document.createElement("i");
    el.setAttribute("data-control", seeded);
    document.body.append(el);
    expect(findSecrets(rendered, [seeded]).sort()).toEqual(
      [
        `${seeded} in console`,
        `${seeded} in localStorage`,
        `${seeded} in markup`,
        `${seeded} in queryCache`,
        `${seeded} in sessionStorage`,
      ].sort(),
    );
    el.remove();
  });

  describe("nothing typed survives leaving the form", () => {
    async function typeToken(user: User) {
      await chooseAuth(user, "bearer");
      await user.type(
        screen.getByTestId("monitor-secret-auth.token-value"),
        SECRET,
      );
    }
    async function reopenCreateFromOverview(user: User) {
      await user.click(await screen.findByTestId("monitor-overview-empty-add"));
      await screen.findByTestId("monitor-form-name");
      await user.click(screen.getByTestId("monitor-form-mode-advanced"));
      await chooseAuth(user, "bearer");
    }

    it("on a route change: the form opened again has an empty field", async () => {
      const user = await openCreate();
      await typeToken(user);
      await user.click(screen.getByTestId("monitor-form-cancel"));
      expect(passwordInputs()).toHaveLength(0);
      await reopenCreateFromOverview(user);
      expect(screen.getByTestId("monitor-secret-auth.token-value")).toHaveValue(
        "",
      );
    });

    it("on an Organization switch: the form of the other Organization has an empty field", async () => {
      vi.mocked(updateActiveOrganization).mockResolvedValue({
        ...context(),
        lastActiveTenantId: B,
      });
      const user = await openCreate();
      await typeToken(user);
      await user.click(screen.getByTestId("shell-organization-switch"));
      await user.click(screen.getByTestId(`shell-organization-${B}`));
      await waitFor(() => {
        expect(screen.getByTestId("location")).toHaveTextContent(
          `/organizations/${B}/projects`,
        );
      });
      expect(passwordInputs()).toHaveLength(0);
      expect(document.documentElement.outerHTML).not.toContain(SECRET);
      // The switch leaves for the Projects of B; the form is then opened again in one of them.
      await act(async () => {
        await openedRouter.navigate(newPath(B));
      });
      await screen.findByTestId("monitor-form-name");
      await user.click(screen.getByTestId("monitor-form-mode-advanced"));
      await chooseAuth(user, "bearer");
      expect(screen.getByTestId("monitor-secret-auth.token-value")).toHaveValue(
        "",
      );
    });

    it("on unmount: the store forgets the value", async () => {
      const { renderHook } = await import("@testing-library/react");
      const { useSecretStore, useClearSecretsOnUnmount } =
        await import("./form/secrets");
      const hook = renderHook(() => {
        const store = useSecretStore();
        useClearSecretsOnUnmount(store);
        return store;
      });
      act(() => {
        hook.result.current.set("auth.token", SECRET);
      });
      const read = hook.result.current.get;
      expect(read("auth.token")).toBe(SECRET);
      hook.unmount();
      expect(read("auth.token")).toBe("");
    });
  });
});
