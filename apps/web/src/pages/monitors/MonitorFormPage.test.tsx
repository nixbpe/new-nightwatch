import { guardUnassignedNetwork } from "../../test/guard-network";
import type { MonitorRecord } from "@nightwatch/api-contract";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { fetchProjectDetail, projectQueryKeys } from "../../lib/api/projects";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  createMonitor,
  fetchMonitorEvents,
  fetchMonitorLastResponse,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  updateMonitor,
} from "../../lib/api/monitors";
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
  P,
  projectDetail,
} from "./form-test-support";
import { noChecks, noIncidents, noResponseTimes } from "./detail-test-support";

guardUnassignedNetwork();

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
  fetchMonitorEvents: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const createMock = vi.mocked(createMonitor);
const updateMock = vi.mocked(updateMonitor);
const fetchDetailMock = vi.mocked(fetchMonitorDetail);
const fetchListMock = vi.mocked(fetchMonitorList);

beforeEach(() => {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  });
  fetchMeContextMock.mockResolvedValue(context());
  vi.mocked(fetchMonitorEvents).mockResolvedValue({
    events: [],
    page: { limit: 20, offset: 0, total: 0 },
  });
  vi.mocked(fetchMonitorLastResponse).mockResolvedValue({ response: null });
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  fetchListMock.mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

const written = (overrides: Partial<MonitorRecord> = {}) => ({
  monitor: record(overrides),
});

async function fillBasic(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("monitor-form-name"), "Payments API");
  await user.type(
    screen.getByTestId("monitor-form-url"),
    "https://api.acme.example/health",
  );
}

async function openCreate() {
  const user = userEvent.setup();
  renderForm(newPath());
  await screen.findByTestId("monitor-form-title");
  await screen.findByTestId("monitor-form-name");
  return user;
}

describe("Create form defaults", () => {
  it("starts in basic mode with 5 minutes, 200-299 and a 10 second timeout", async () => {
    await openCreate();
    expect(screen.getByTestId("monitor-form-mode-basic")).toBeChecked();
    expect(screen.getByTestId("monitor-form-interval-300")).toBeChecked();
    expect(screen.getByTestId("monitor-form-status-summary")).toHaveAttribute(
      "data-expected-status",
      "200-299",
    );
    expect(screen.getByTestId("monitor-form-timeout-summary")).toHaveAttribute(
      "data-timeout-seconds",
      "10",
    );
    expect(screen.getByTestId("monitor-form-name")).toHaveValue("");
  });

  it("moves the interval with the arrow keys", async () => {
    const user = await openCreate();
    screen.getByTestId("monitor-form-interval-300").focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("monitor-form-interval-900")).toBeChecked();
    expect(screen.getByTestId("monitor-form-interval-900")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByTestId("monitor-form-interval-60")).toBeChecked();
  });
});

describe("Create validation and save", () => {
  it("puts errors beside name and url, focuses the first and sends nothing", async () => {
    const user = await openCreate();
    await user.click(screen.getByTestId("monitor-form-save"));
    const name = screen.getByTestId("monitor-form-name");
    const url = screen.getByTestId("monitor-form-url");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("monitor-form-name-error"),
    );
    expect(
      document.getElementById("monitor-form-name-error"),
    ).not.toBeEmptyDOMElement();
    expect(url).toHaveAccessibleDescription();
    expect(name).toHaveFocus();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("saves with a client request id and opens Detail waiting for the first check", async () => {
    createMock.mockResolvedValue(written());
    fetchDetailMock.mockResolvedValue({
      monitor: detail({
        health: "unknown",
        healthReason: "never_checked",
        lastCheckAt: null,
        lastResult: null,
        version: 1,
      }),
    });
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByTestId("monitor-form-save"));
    const health = await screen.findByTestId("monitor-detail-health");
    expect(health).toHaveAttribute("data-health", "unknown");
    expect(health).toHaveAttribute("data-health-reason", "never_checked");
    expect(health).toHaveAttribute("data-last-check-at", "");
    expect(screen.getByTestId("monitor-detail-first-check")).toBeVisible();
    expect(
      screen.getByTestId("monitor-detail-first-check"),
    ).not.toBeEmptyDOMElement();
    expect(
      screen.getByTestId("monitor-detail-notice"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
    );
    const [organizationId, , body] = createMock.mock.calls[0] ?? [];
    expect(organizationId).toBe(A);
    expect(body).toMatchObject({
      name: "Payments API",
      url: "https://api.acme.example/health",
      intervalSeconds: 300,
      timeoutSeconds: 10,
      method: "GET",
      expectedStatus: "200-299",
      secrets: [],
    });
    expect(body?.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends one request when Save is pressed twice while pending", async () => {
    const pending = deferred<ReturnType<typeof written>>();
    createMock.mockReturnValue(pending.promise);
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = await openCreate();
    await fillBasic(user);
    const save = screen.getByTestId("monitor-form-save");
    await user.click(save);
    await user.click(screen.getByTestId("monitor-form-save"));
    await user.keyboard("{Enter}");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("monitor-form-save")).toHaveFocus();
    pending.resolve(written());
    await screen.findByTestId("location");
  });

  it("shows a blocked address beside the URL, without an address, and keeps the values", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_TARGET_BLOCKED", "10.0.0.5 is private", 422, {
        field: "url",
      }),
    );
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByTestId("monitor-form-save"));
    const url = await screen.findByTestId("monitor-form-url");
    await waitFor(() => {
      expect(url).toHaveAccessibleDescription();
      expect(url).toHaveAttribute("aria-invalid", "true");
      expect(url).toHaveAttribute(
        "aria-describedby",
        expect.stringContaining("monitor-form-url-error"),
      );
      expect(
        document.getElementById("monitor-form-url-error"),
      ).not.toBeEmptyDOMElement();
    });
    expect(url).toHaveFocus();
    expect(url).toHaveValue("https://api.acme.example/health");
    expect(document.body.textContent).not.toMatch(/10\.0\.0\.5/);
  });

  it("maps a server field and reason beside the field and clears it when edited", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "name", reason: "too_long" }],
      }),
    );
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByTestId("monitor-form-save"));
    const name = await screen.findByTestId("monitor-form-name");
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription();
    });
    expect(name).toHaveFocus();
    await user.type(name, "x");
    expect(name).not.toHaveAttribute("aria-invalid");
  });

  it("shows the limit message when the Organization is full", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_LIMIT_REACHED", "limit", 409),
    );
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(await screen.findByTestId("monitor-form-error")).toBeVisible();
    expect(screen.getByTestId("monitor-form-url")).toHaveValue(
      "https://api.acme.example/health",
    );
  });
});

describe("StrictMode", () => {
  it("still opens Detail after a save, as the dev build runs the effects twice", async () => {
    createMock.mockResolvedValue(written());
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = userEvent.setup();
    renderForm(newPath(), undefined, true);
    await screen.findByTestId("monitor-form-name");
    await fillBasic(user);
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
      );
    });
  });
});

describe("Access", () => {
  it.each(["viewer", "auditor"] as const)(
    "shows denied to a %s who opens the form directly",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      renderForm(newPath());
      expect(
        await screen.findByTestId("monitor-form-denied"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("monitor-form-name")).toBeNull();
    },
  );

  it("shows denied to a non-member without the Organization's name", async () => {
    renderForm(newPath("33333333-3333-4333-8333-333333333333"));
    expect(
      await screen.findByTestId("monitor-form-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  });
});

describe("Organization switch", () => {
  const projectsOfB = `/organizations/${B}/projects`;

  async function switchToB(user: ReturnType<typeof userEvent.setup>) {
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(screen.getByTestId(`shell-organization-${B}`));
  }

  it("sends /monitors/new to the new Organization's Projects without the typed values", async () => {
    const user = await openCreate();
    await fillBasic(user);
    await switchToB(user);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(projectsOfB);
    });
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  });

  it("sends an Edit page to the new Organization's Projects", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await switchToB(user);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(projectsOfB);
    });
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  });

  it("does not navigate back to the old Organization when a save lands after the switch", async () => {
    const pending = deferred<ReturnType<typeof written>>();
    createMock.mockReturnValue(pending.promise);
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByTestId("monitor-form-save"));
    await switchToB(user);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(projectsOfB);
    });
    pending.resolve(written());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("location")).toHaveTextContent(projectsOfB);
  });
});

describe("Edit", () => {
  it("opens with the saved values and saves against the version it loaded", async () => {
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ name: "Payments API", version: 3 }),
    });
    updateMock.mockResolvedValue(written({ version: 4 }));
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    expect(screen.getByTestId("monitor-form-url")).toHaveValue(
      "https://api.acme.example/health",
    );
    expect(screen.getByTestId("monitor-form-interval-300")).toBeChecked();
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ name: "Payments API 2", version: 4 }),
    });
    await user.type(name, " 2");
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(
      await screen.findByTestId("monitor-detail-notice"),
    ).not.toBeEmptyDOMElement();
    // Detail's first paint already holds the saved monitor, never the pre-edit one.
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      /^Payments API 2$/,
    );
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      name: "Payments API 2",
      expectedVersion: 3,
      secrets: [],
    });
  });

  it("shows the conflict message and keeps the typed values on a version conflict", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_VERSION_CONFLICT", "conflict", 409, {
        currentVersion: 5,
      }),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.type(name, " mine");
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(
      await screen.findByTestId("monitor-form-conflict"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-form-name")).toHaveValue(
      "Payments API mine",
    );
  });

  it("reloads the latest values on request after a conflict", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_VERSION_CONFLICT", "conflict", 409, {
        currentVersion: 5,
      }),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.type(name, " mine");
    await user.click(screen.getByTestId("monitor-form-save"));
    await screen.findByTestId("monitor-form-conflict");
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ name: "Theirs", version: 5 }),
    });
    await user.click(screen.getByTestId("monitor-form-reload"));
    expect(
      await waitFor(() => {
        const field = screen.getByTestId("monitor-form-name");
        expect(field).toHaveValue("Theirs");
        return field;
      }),
    ).toBeInTheDocument();
    updateMock.mockResolvedValue(written({ version: 6 }));
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(2);
    });
    expect(updateMock.mock.calls[1]?.[3].expectedVersion).toBe(5);
  });

  it("shows not-found when the monitor is deleted before the save", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    updateMock.mockRejectedValue(new ApiError("MONITOR_NOT_FOUND", "nf", 404));
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(
      await screen.findByTestId("monitor-form-not-found"),
    ).toBeInTheDocument();
  });
});

describe("A Project that is gone after the form opened", () => {
  const gone = () => new ApiError("PROJECT_NOT_FOUND", "not found", 404);

  it("leaves the form for the not-found state when the Project is re-read as gone", async () => {
    const { queryClient } = renderForm(newPath());
    await screen.findByTestId("monitor-form-name");
    await userEvent.type(screen.getByTestId("monitor-form-name"), "typed");
    vi.mocked(fetchProjectDetail).mockRejectedValue(gone());
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.detail(A, P),
      });
    });
    expect(
      await screen.findByTestId("monitor-form-project-gone"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
    expect(screen.queryByTestId("monitor-form-save")).toBeNull();
  });

  it("leads a PROJECT_NOT_FOUND from save to the not-found state", async () => {
    const user = await openCreate();
    await fillBasic(user);
    createMock.mockRejectedValue(gone());
    vi.mocked(fetchProjectDetail).mockRejectedValue(gone());
    await user.click(screen.getByTestId("monitor-form-save"));
    expect(
      await screen.findByTestId("monitor-form-project-gone"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  });
});
