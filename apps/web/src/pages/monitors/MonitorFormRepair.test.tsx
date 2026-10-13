import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
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
  updateMonitor,
} from "../../lib/api/monitors";
import {
  noChecks,
  noIncidents,
  noResponseTimes,
  P,
  projectDetail,
} from "./detail-test-support";
import {
  A,
  B,
  context,
  deferred,
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
}));

const createMock = vi.mocked(createMonitor);
const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);
const meMock = vi.mocked(fetchMeContext);
const C = "33333333-3333-4333-8333-333333333333";
function threeOrgs(active: string) {
  return {
    ...context("owner", [
      { id: A, name: "Acme", slug: "acme", role: "owner" },
      { id: B, name: "Beta", slug: "beta", role: "owner" },
      { id: C, name: "Gamma", slug: "gamma", role: "owner" },
    ]),
    lastActiveTenantId: active,
  };
}
const SECRET_ID = "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  });
  meMock.mockResolvedValue(context());
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
});

afterEach(() => {
  vi.resetAllMocks();
});

function secretHeaderRow() {
  const rows = screen
    .getAllByTestId(/^monitor-form-header-row-/)
    .filter(
      (row) =>
        within(row).getByTestId<HTMLInputElement>("monitor-form-header-secret")
          .checked,
    );
  expect(rows).toHaveLength(1);
  return rows.pop() as HTMLElement;
}

type User = ReturnType<typeof userEvent.setup>;

/** Lets every pending promise continuation and effect run inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openCreate(user: User) {
  renderForm(newPath());
  await screen.findByTestId("monitor-form-name");
  await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
  await user.type(
    screen.getByTestId("monitor-form-url"),
    "https://api.acme.example/health",
  );
}
const saveCreate = () => screen.getByTestId("monitor-form-save");

describe("a route Organization that is not the server-active one", () => {
  beforeEach(() => {
    meMock.mockResolvedValue({ ...context(), lastActiveTenantId: B });
  });

  it("navigates to Detail after a Create save", async () => {
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
      );
    });
  });

  it("navigates to Detail after an Edit save, with the first paint already the saved monitor", async () => {
    detailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    detailMock.mockResolvedValue({
      monitor: detail({ name: "Payments API 2", version: 4 }),
    });
    await user.type(name, " 2");
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(
      await screen.findByTestId("monitor-detail-notice"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      "Payments API 2",
    );
  });

  it("keeps an Edit form's values when the user picks the Organization the URL names", async () => {
    detailMock.mockResolvedValue({
      monitor: detail({
        auth: { type: "bearer" },
        headers: [{ id: SECRET_ID, name: "X-Key", secret: true }],
        secretSlots: [{ slot: "auth.token", configured: true }],
      }),
    });
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: A,
    });
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.type(name, " typed");
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${A}`));
    // The switcher shows Acme once the switch has settled.
    await screen.findByTestId("shell-organization-switch");
    await flush();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/edit`,
    );
    expect(screen.getByTestId("monitor-form-name")).toHaveValue(
      "Payments API typed",
    );
    // The stored secret is still shown as set.
    expect(
      screen.getByTestId("monitor-secret-auth.token-stored"),
    ).not.toBeEmptyDOMElement();
    expect(
      within(secretHeaderRow()).getByTestId("monitor-form-header-value"),
    ).toHaveValue("");
    expect(
      within(secretHeaderRow()).getByTestId("monitor-form-header-value"),
    ).toHaveAttribute("type", "password");
  });

  it("does not bounce a Detail page off its own Organization", async () => {
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: A,
    });
    const user = userEvent.setup();
    renderForm(`/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`);
    await screen.findByTestId("monitor-detail-title");
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${A}`));
    await screen.findByTestId("shell-organization-switch");
    await flush();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
    );
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      "Payments API",
    );
  });

  it("still leaves for another Organization than the one the URL names", async () => {
    meMock.mockResolvedValue(threeOrgs(B));
    vi.mocked(updateActiveOrganization).mockResolvedValue(threeOrgs(C));
    const user = userEvent.setup();
    renderForm(newPath());
    await user.type(await screen.findByTestId("monitor-form-name"), "typed");
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${C}`));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${C}/projects`,
      );
    });
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
    expect(
      Array.from(
        document.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >("input, textarea, select"),
      ).some((field) => field.value === "typed"),
    ).toBe(false);
  });

  it("leaves after the URL's Organization was picked and the first active one is picked again", async () => {
    vi.mocked(updateActiveOrganization)
      .mockResolvedValueOnce({ ...context(), lastActiveTenantId: A })
      .mockResolvedValueOnce({ ...context(), lastActiveTenantId: B });
    const user = userEvent.setup();
    renderForm(newPath());
    await user.type(await screen.findByTestId("monitor-form-name"), "typed");
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${A}`));
    await screen.findByTestId("shell-organization-switch");
    await flush();
    expect(screen.getByTestId("monitor-form-name")).toHaveValue("typed");
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${B}`));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/projects`,
      );
    });
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  });

  it("saves after the URL's Organization was picked", async () => {
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: A,
    });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${A}`));
    await screen.findByTestId("shell-organization-switch");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
      );
    });
  });

  it("does not read origin organization detail after switching away before save completes", async () => {
    meMock.mockResolvedValue(threeOrgs(B));
    vi.mocked(updateActiveOrganization).mockResolvedValue(threeOrgs(C));
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    updateMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(screen.getByTestId("monitor-form-save"));
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${C}`));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${C}/projects`,
      );
    });
    await flush();
    const readsBefore = detailMock.mock.calls.length;
    pending.resolve({ monitor: record({ version: 4 }) });
    await flush();
    expect(detailMock.mock.calls).toHaveLength(readsBefore);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${C}/projects`,
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent(MONITOR_ID);
  });
});

describe("refusals with no control of their own", () => {
  const secretDetail = () =>
    detail({
      auth: { type: "bearer" },
      headers: [
        { id: SECRET_ID, name: "X-Key", secret: true },
        { name: "X-Team", value: "core", secret: false },
      ],
      secretSlots: [
        { slot: "auth.token", configured: true },
        { slot: `header.${SECRET_ID}`, configured: true },
      ],
    });

  it("places refusals of the secret fields beside their inputs, by the slot each entry named", async () => {
    detailMock.mockResolvedValue({ monitor: secretDetail() });
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [
          { field: "headers.0.name", reason: "duplicate" },
          { field: "auth", reason: "required" },
          { field: "secrets.1.slot", reason: "invalid_format" },
        ],
      }),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(
        within(secretHeaderRow()).getByTestId("monitor-form-header-name"),
      ).toHaveAttribute("aria-invalid", "true");
    });
    expect(
      within(secretHeaderRow()).getByTestId("monitor-form-header-name"),
    ).toHaveAccessibleDescription();
    expect(
      within(secretHeaderRow()).getByTestId("monitor-form-header-name"),
    ).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByTestId("monitor-secret-auth.token-replace"),
    ).toBeVisible();
    expect(
      screen.getByTestId("monitor-secret-auth.token-replace"),
    ).toHaveAccessibleDescription();
    expect(
      screen.getByTestId("monitor-secret-auth.token-replace"),
    ).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById("monitor-form-auth-token-error"),
    ).not.toBeEmptyDOMElement();
    expect(
      within(secretHeaderRow()).getByTestId("monitor-header-secret-error"),
    ).toBeVisible();
  });
});

describe("inputs keep the focus while the form is busy or locked", () => {
  it("keeps the focus in the field on Enter, while pending and after a 403", async () => {
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    createMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    await openCreate(user);
    const url = screen.getByTestId("monitor-form-url");
    url.focus();
    await user.keyboard("{Enter}");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(url).toHaveFocus();
    expect(url).toHaveAttribute("readonly");
    expect(url).not.toBeDisabled();
    meMock.mockResolvedValue(context("viewer"));
    pending.reject(new ApiError("PERMISSION_DENIED", "d", 403));
    await waitFor(() => {
      expect(saveCreate()).toHaveAttribute("aria-disabled", "true");
    });
    expect(url.isConnected).toBe(false);
    expect(screen.getByTestId("monitor-form-url")).toHaveFocus();
    expect(screen.getByTestId("monitor-form-url")).toHaveValue(
      "https://api.acme.example/health",
    );
  });

  it("ignores the interval control while pending without moving the focus", async () => {
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    createMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    const five = screen.getByTestId("monitor-form-interval-300");
    five.focus();
    await user.keyboard("{ArrowRight}");
    expect(five).toHaveAttribute("aria-checked", "true");
    expect(five).toHaveFocus();
    pending.reject(new ApiError("INTERNAL_ERROR", "x", 500));
  });
});

describe("after MEMBERSHIP_DENIED", () => {
  it("keeps actions off while the refresh fails", async () => {
    createMock.mockRejectedValue(new ApiError("MEMBERSHIP_DENIED", "d", 403));
    const user = userEvent.setup();
    await openCreate(user);
    meMock.mockRejectedValue(new Error("offline"));
    await user.click(saveCreate());
    await screen.findByTestId("monitor-form-admission-error");
    expect(screen.queryByTestId("monitor-form-save")).toBeNull();
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(1);
    meMock.mockResolvedValue(context("viewer"));
    await user.click(screen.getByTestId("monitor-form-admission-retry"));
    await screen.findByTestId("monitor-form-name");
    expect(saveCreate()).toHaveAttribute("aria-disabled", "true");
    await user.click(saveCreate());
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("monitor-form-name")).toHaveValue("Payments API");
  });

  it("turns actions back on once the refresh shows the membership is intact", async () => {
    createMock
      .mockRejectedValueOnce(new ApiError("MEMBERSHIP_DENIED", "d", 403))
      .mockResolvedValueOnce({ monitor: record() });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(saveCreate()).toHaveAttribute("aria-disabled", "false");
    });
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("the client request id", () => {
  const ids = () =>
    createMock.mock.calls.map((call) => call[2].clientRequestId);

  it("stays the same when unchanged values are retried after a refusal", async () => {
    createMock
      .mockRejectedValueOnce(
        new ApiError("MONITOR_INVALID", "i", 400, {
          fields: [{ field: "name", reason: "too_long" }],
        }),
      )
      .mockResolvedValueOnce({ monitor: record() });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-form-name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
    expect(ids()[0]).toBe(ids()[1]);
  });

  it("is new once a value changes after a definitive refusal", async () => {
    createMock
      .mockRejectedValueOnce(new ApiError("MONITOR_LIMIT_REACHED", "l", 409))
      .mockResolvedValueOnce({ monitor: record() });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await screen.findByTestId("monitor-form-error");
    await user.type(screen.getByTestId("monitor-form-name"), " 2");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
    expect(ids()[0]).not.toBe(ids()[1]);
  });

  it.each([
    ["a network error", new ApiError("NETWORK_ERROR", "n", 0)],
    ["a 5xx", new ApiError("INTERNAL_ERROR", "s", 503)],
  ])(
    "stays the same after %s even when a value changes",
    async (_label, error) => {
      createMock
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ monitor: record() });
      const user = userEvent.setup();
      await openCreate(user);
      await user.click(saveCreate());
      await screen.findByTestId("monitor-form-error");
      await user.type(screen.getByTestId("monitor-form-name"), " 2");
      await user.click(saveCreate());
      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(2);
      });
      expect(ids()[0]).toBe(ids()[1]);
    },
  );
});

describe("a stale server error on a threshold", () => {
  it("clears when the timeout changes", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "i", 400, {
        fields: [{ field: "assertions.0.ms", reason: "out_of_range" }],
      }),
    );
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(screen.getByTestId("monitor-form-mode-advanced"));
    await user.click(screen.getByTestId("monitor-form-add-assertion"));
    await user.selectOptions(
      within(screen.getByTestId(/^monitor-form-assertion-row-/)).getByTestId(
        "monitor-form-assertion-kind",
      ),
      "responseTimeBelow",
    );
    await user.type(
      within(screen.getByTestId(/^monitor-form-assertion-row-/)).getByTestId(
        "monitor-form-assertion-ms",
      ),
      "500",
    );
    await user.click(saveCreate());
    const ms = within(
      screen.getByTestId(/^monitor-form-assertion-row-/),
    ).getByTestId("monitor-form-assertion-ms");
    await waitFor(() => {
      expect(ms).toHaveAttribute("aria-invalid", "true");
    });
    fireEvent.change(screen.getByTestId("monitor-form-timeout"), {
      target: { value: "20" },
    });
    expect(ms).not.toHaveAttribute("aria-invalid");
  });
});
