import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLeafActive } from "../../components/shell/nav-config";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import { fetchProjectDetail } from "../../lib/api/projects";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
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
  deferred,
  detail,
  editPath,
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
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorEvents: vi.fn(() =>
    Promise.resolve({ events: [], page: { limit: 20, offset: 0, total: 0 } }),
  ),
  fetchMonitorLastResponse: vi.fn(() => Promise.resolve({ response: null })),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
}));

const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);

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
  updateMock.mockResolvedValue({ monitor: record({ version: 4 }) });
});

afterEach(() => {
  vi.resetAllMocks();
});

const saveEdit = () => screen.getByTestId("monitor-form-save");

describe("Edit opens with the saved configuration", () => {
  it("opens in advanced mode when the monitor has advanced values", async () => {
    detailMock.mockResolvedValue({
      monitor: detail({
        method: "POST",
        timeoutSeconds: 5,
        expectedStatus: "200-299,301",
        queryParams: [{ name: "page", value: "2" }],
        body: { type: "text", content: "ping" },
        assertions: [
          { kind: "jsonPathEquals", path: "$.status", expected: '"ok"' },
          { kind: "responseTimeBelow", ms: 800 },
        ],
      }),
    });
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    expect(screen.getByTestId("monitor-form-mode-advanced")).toBeChecked();
    expect(screen.getByTestId("monitor-form-method")).toHaveValue("POST");
    expect(screen.getByTestId("monitor-form-timeout")).toHaveValue("5");
    expect(screen.getByTestId("monitor-form-expected-status")).toHaveValue(
      "200-299,301",
    );
    expect(
      within(screen.getByTestId(/^monitor-form-query-row-/)).getByTestId(
        "monitor-form-query-name",
      ),
    ).toHaveValue("page");
    expect(screen.getByTestId("monitor-form-body-content")).toHaveValue("ping");
    const [jsonRow] = screen
      .getAllByTestId(/^monitor-form-assertion-row-/)
      .filter(
        (row) =>
          within(row).getByTestId<HTMLSelectElement>(
            "monitor-form-assertion-kind",
          ).value === "jsonPathEquals",
      );
    const [responseRow] = screen
      .getAllByTestId(/^monitor-form-assertion-row-/)
      .filter(
        (row) =>
          within(row).getByTestId<HTMLSelectElement>(
            "monitor-form-assertion-kind",
          ).value === "responseTimeBelow",
      );
    expect(jsonRow).toBeInTheDocument();
    expect(responseRow).toBeInTheDocument();
    expect(
      within(must(jsonRow)).getByTestId("monitor-form-assertion-path"),
    ).toHaveValue("$.status");
    expect(
      within(must(responseRow)).getByTestId("monitor-form-assertion-ms"),
    ).toHaveValue("800");
  });

  it("opens in basic mode when nothing advanced is set", async () => {
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    expect(screen.getByTestId("monitor-form-mode-basic")).toBeChecked();
    expect(screen.queryByTestId("monitor-form-advanced-summary")).toBeNull();
  });

  it("shows a loading state, then an error with retry when the load fails", async () => {
    detailMock.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "x", 500));
    const user = userEvent.setup();
    renderForm(editPath());
    expect(
      await screen.findByTestId("monitor-form-load-error"),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("monitor-form-load-retry"));
    expect(
      await waitFor(() => {
        const field = screen.getByTestId("monitor-form-name");
        expect(field).toHaveValue("Payments API");
        return field;
      }),
    ).toBeInTheDocument();
  });

  it.each([
    ["a missing id", "99999999-9999-4999-8999-999999999999"],
    ["a malformed id", "not-a-uuid"],
    ["an id of another Organization", "22222222-aaaa-4aaa-8aaa-222222222222"],
  ])("shows the same not-found text for %s", async (_label, id) => {
    // The API answers the three the same way (AC-48), so the page cannot tell them apart.
    detailMock.mockRejectedValue(new ApiError("MONITOR_NOT_FOUND", "nf", 404));
    renderForm(editPath(A, id));
    expect(
      await screen.findByTestId("monitor-form-not-found"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  });

  it("keeps the nav leaf active on /new and /edit", () => {
    const leaf = {
      path: "/organizations/:organizationId/projects/:projectId/monitors",
    };
    expect(isLeafActive(leaf, newPath())).toBe(true);
    expect(isLeafActive(leaf, editPath())).toBe(true);
  });
});

describe("Edit save", () => {
  it("sends one update for a repeated press", async () => {
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    updateMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(saveEdit());
    await user.click(saveEdit());
    await user.keyboard("{Enter}");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveEdit()).toHaveFocus();
    pending.resolve({ monitor: record({ version: 4 }) });
    await screen.findByTestId("location");
  });

  it("loads stored alert settings and submits the complete alerts object unchanged when only the monitor name changes", async () => {
    detailMock.mockResolvedValue({
      monitor: detail({
        alerts: {
          failureThreshold: 3,
          downEnabled: false,
          sslEnabled: false,
          sslCautionDays: 12,
        },
      }),
    });
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    expect(screen.getByTestId("monitor-form-alert-threshold")).toHaveValue("3");
    expect(screen.getByTestId("monitor-form-alert-down")).not.toBeChecked();
    expect(screen.getByTestId("monitor-form-alert-ssl")).not.toBeChecked();
    expect(screen.getByTestId("monitor-form-alert-days")).toHaveValue("12");
    await user.type(name, " v2");
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[3]).toMatchObject({
      alerts: {
        failureThreshold: 3,
        downEnabled: false,
        sslEnabled: false,
        sslCautionDays: 12,
      },
    });
  });

  it("places a server refusal beside its field on Edit", async () => {
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "queryParams.0.value", reason: "too_long" }],
      }),
    );
    detailMock.mockResolvedValue({
      monitor: detail({ queryParams: [{ name: "q", value: "x" }] }),
    });
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.click(saveEdit());
    await waitFor(() => {
      expect(
        within(screen.getByTestId(/^monitor-form-query-row-/)).getByTestId(
          "monitor-form-query-value",
        ),
      ).toHaveAccessibleDescription();
      expect(
        within(screen.getByTestId(/^monitor-form-query-row-/)).getByTestId(
          "monitor-form-query-value",
        ),
      ).toHaveAttribute("aria-invalid", "true");
    });
    expect(
      within(screen.getByTestId(/^monitor-form-query-row-/)).getByTestId(
        "monitor-form-query-value",
      ),
    ).toHaveFocus();
  });

  it("keeps the edited values and blocks actions when the role drops", async () => {
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "d", 403));
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    await user.type(name, " mine");
    vi.mocked(fetchMeContext).mockResolvedValue(context("auditor"));
    await user.click(saveEdit());
    expect(await screen.findByTestId("monitor-form-role-changed")).toHaveRole(
      "alert",
    );
    expect(screen.getByTestId("monitor-form-name")).toHaveValue(
      "Payments API mine",
    );
    await waitFor(() => {
      expect(saveEdit()).toHaveAttribute("aria-disabled", "true");
    });
    expect(saveEdit()).toHaveFocus();
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("shows denied with no data when the user was removed from the Organization", async () => {
    updateMock.mockRejectedValue(new ApiError("MEMBERSHIP_DENIED", "d", 403));
    const user = userEvent.setup();
    renderForm(editPath());
    await waitFor(() => {
      const field = screen.getByTestId("monitor-form-name");
      expect(field).toHaveValue("Payments API");
      return field;
    });
    vi.mocked(fetchMeContext).mockResolvedValue(
      context("owner", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    await user.click(saveEdit());
    expect(
      await screen.findByTestId("monitor-form-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-form-name")).toBeNull();
    expect(screen.queryByTestId("monitor-form-scope")).toBeNull();
  });

  it.each(["viewer", "auditor"] as const)(
    "shows denied to a %s who opens /edit directly, without loading the monitor",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      renderForm(editPath());
      expect(
        await screen.findByTestId("monitor-form-denied"),
      ).toBeInTheDocument();
      expect(detailMock).not.toHaveBeenCalled();
    },
  );
});
