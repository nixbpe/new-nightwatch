import { guardUnassignedNetwork } from "../../test/guard-network";
import {
  monitorRecordSchema,
  type Monitor,
  type MonitorListResponse,
} from "@nightwatch/api-contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import { fetchProjectDetail } from "../../lib/api/projects";
import {
  deleteMonitor,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorEvents,
  fetchMonitorIncidents,
  fetchMonitorLastResponse,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  monitorQueryKeys,
  pauseMonitor,
  resumeMonitor,
} from "../../lib/api/monitors";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  A,
  B,
  context,
  detail,
  MONITOR_ID,
  noChecks,
  noIncidents,
  noResponseTimes,
  NOW,
  renderDetail,
  P,
  PROJECT_NAME,
  projectDetail,
} from "./detail-test-support";

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
  fetchMonitorDetail: vi.fn(),
  fetchMonitorEvents: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  pauseMonitor: vi.fn(),
  resumeMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchDetailMock = vi.mocked(fetchMonitorDetail);
const pauseMock = vi.mocked(pauseMonitor);
const resumeMock = vi.mocked(resumeMonitor);
const deleteMock = vi.mocked(deleteMonitor);

const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const emptyList: MonitorListResponse = {
  summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
  monitors: [],
  page: { limit: 25, offset: 0, total: 0 },
  dataAsOf: "2026-09-30T07:32:05.000Z",
};

beforeEach(() => {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMeContextMock.mockResolvedValue(context());
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorEvents).mockResolvedValue({
    events: [],
    page: { limit: 20, offset: 0, total: 0 },
  });
  vi.mocked(fetchMonitorLastResponse).mockResolvedValue({ response: null });
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  vi.mocked(fetchMonitorList).mockResolvedValue(emptyList);
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

// The write routes answer with the record only: the computed state is stripped.
const record = (monitor: Monitor) => ({
  monitor: monitorRecordSchema.parse(monitor),
});

const down = () =>
  detail({
    health: "down",
    consecutiveFailures: 3,
    openIncident: {
      startedAt: "2026-09-30T07:20:00.000Z",
      reason: "http_status",
    },
  });

describe("Pause and Resume", () => {
  it("pauses a monitor that is down, keeps the same button focused and swaps its label", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: down() });
    pauseMock.mockImplementation(() => {
      // The Detail read after the write shows the paused state.
      fetchDetailMock.mockResolvedValue({
        monitor: detail({ status: "paused", health: "paused" }),
      });
      return Promise.resolve(record(detail({ status: "paused" })));
    });
    const user = userEvent.setup();
    const { queryClient } = renderDetail();
    const button = await screen.findByTestId("monitor-detail-toggle");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const previousLabel = button.textContent;
    await user.click(button);

    expect(
      await screen.findByTestId("monitor-detail-notice"),
    ).toHaveTextContent(/\S/);
    expect(pauseMock).toHaveBeenCalledExactlyOnceWith(A, P, MONITOR_ID);
    expect(button).toHaveAttribute("data-status", "paused");
    expect(button).toHaveAccessibleName(/\S/);
    expect(button.textContent).not.toBe(previousLabel);
    // Same node, relabelled: it was never unmounted, so focus stayed on it.
    expect(screen.getByTestId("monitor-detail-toggle")).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health",
      "paused",
    );
    expect(screen.getByTestId("monitor-detail-paused")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["tenant", "monitors", A, P] }),
    );
  });

  it("resumes into 'ไม่ทราบสถานะ', never 'ใช้งานได้' from the old result", async () => {
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ status: "paused", health: "paused" }),
    });
    resumeMock.mockImplementation(() => {
      fetchDetailMock.mockResolvedValue({
        monitor: detail({
          health: "unknown",
          healthReason: "awaiting_new_config",
        }),
      });
      return Promise.resolve(record(detail()));
    });
    const user = userEvent.setup();
    renderDetail();
    const button = await screen.findByTestId("monitor-detail-toggle");
    const previousLabel = button.textContent;
    await user.click(button);

    expect(
      await screen.findByTestId("monitor-detail-notice"),
    ).toHaveTextContent(/\S/);
    expect(resumeMock).toHaveBeenCalledExactlyOnceWith(A, P, MONITOR_ID);
    expect(button).toHaveAttribute("data-status", "active");
    expect(button).toHaveAccessibleName(/\S/);
    expect(button.textContent).not.toBe(previousLabel);
    expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health-reason",
      "awaiting_new_config",
    );
    expect(screen.getByTestId("monitor-detail-toggle")).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health",
      "unknown",
    );
    expect(screen.getByTestId("monitor-detail-health")).not.toHaveAttribute(
      "data-health",
      "up",
    );
  });

  it("sends one request when the button is pressed again while pending", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    let finish: (value: ReturnType<typeof record>) => void = () => undefined;
    pauseMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByTestId("monitor-detail-toggle"));
    const pending = await screen.findByTestId("monitor-detail-toggle");
    expect(pending).toHaveAttribute("aria-disabled", "true");
    await user.click(pending);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    finish(record(detail({ status: "paused" })));
    await waitFor(() => {
      expect(screen.getByTestId("monitor-detail-toggle")).toHaveAttribute(
        "data-in-progress",
        "false",
      );
    });
  });

  it("keeps the state and says so when pausing fails", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    pauseMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    const user = userEvent.setup();
    renderDetail();
    const button = await screen.findByTestId("monitor-detail-toggle");
    await user.click(button);
    expect(
      await screen.findByTestId("monitor-detail-action-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-detail-toggle")).toBe(button);
    expect(button).toHaveFocus();
  });

  it("says 'สิทธิ์ของคุณเปลี่ยนแล้ว' without a 'denied' flash and drops the buttons once the role is read-only", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    pauseMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    let finish: (value: ReturnType<typeof context>) => void = () => undefined;
    fetchMeContextMock.mockResolvedValueOnce(context()).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByTestId("monitor-detail-toggle"));
    expect(
      await screen.findByTestId("monitor-detail-action-error"),
    ).toBeInTheDocument();
    // The membership re-read is still open: the page must not claim access is denied.
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("monitor-detail-denied")).toBeNull();
    expect(document.body.textContent).not.toContain(
      "คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้",
    );
    finish(context("viewer"));
    expect(
      await screen.findByTestId("monitor-detail-read-only"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-detail-toggle")).toBeNull();
    expect(
      screen.getByTestId("monitor-detail-action-error"),
    ).toBeInTheDocument();
  });

  it("turns into 'not found' when another session deleted the monitor first", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    pauseMock.mockImplementation(() => {
      fetchDetailMock.mockRejectedValue(
        new ApiError("MONITOR_NOT_FOUND", "gone", 404),
      );
      return Promise.reject(new ApiError("MONITOR_NOT_FOUND", "gone", 404));
    });
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByTestId("monitor-detail-toggle"));
    expect(
      await screen.findByTestId("monitor-detail-not-found"),
    ).toBeInTheDocument();
  });
});

describe("Delete", () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    const opener = await screen.findByTestId("monitor-detail-delete");
    await user.click(opener);
    return {
      opener,
      dialog: await screen.findByTestId("monitor-detail-delete-dialog"),
    };
  }

  it("asks for confirmation with the consequence and starts on Cancel", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    expect(dialog).toHaveAccessibleName(/\S/);
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Payments API");
    expect(dialog).toHaveTextContent("https://api.acme.example/health");
    expect(dialog).toHaveTextContent(PROJECT_NAME);
    expect(dialog).toHaveTextContent(
      "ประวัติการตรวจและเหตุการณ์จะหายและกู้คืนไม่ได้ ถ้าต้องการเก็บประวัติ ให้ใช้หยุดชั่วคราวแทน",
    );
    expect(within(dialog).getByTestId("confirmation-cancel")).toHaveFocus();
  });

  it("sends no request on Cancel and returns focus to the opener", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = userEvent.setup();
    renderDetail();
    const { opener, dialog } = await openDialog(user);
    await user.click(within(dialog).getByTestId("confirmation-cancel"));
    expect(screen.queryByTestId("monitor-detail-delete-dialog")).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("keeps the dialog open on Escape while the delete is pending", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );
    expect(
      await within(dialog).findByTestId("monitor-detail-delete-confirm"),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(
      screen.getByTestId("monitor-detail-delete-dialog"),
    ).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("goes to the Overview with a notice and focus on the heading after a confirmed delete", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { queryClient } = renderDetail();
    const { dialog } = await openDialog(user);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );

    expect(
      await screen.findByTestId("monitor-overview-notice"),
    ).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledExactlyOnceWith(A, P, MONITOR_ID);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors`,
    );
    const heading = screen.getByTestId("monitor-overview-heading");
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["tenant", "monitors", A, P] }),
    );
    // The deleted monitor is not read again on the way out.
    expect(fetchDetailMock).toHaveBeenCalledTimes(1);
  });

  it("sends one request when Confirm is pressed twice", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    const confirm = within(dialog).getByTestId("monitor-detail-delete-confirm");
    await user.dblClick(confirm);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("removes the deleted monitor from a cached list before the Overview shows it", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockResolvedValue(undefined);
    // The Overview refetch never lands, so only the cached list is on screen.
    vi.mocked(fetchMonitorList).mockReturnValue(new Promise(() => undefined));
    const item = (id: string, name: string) => ({
      id,
      name,
      url: "https://example.test/",
      method: "GET" as const,
      intervalSeconds: 300,
      status: "active" as const,
      health: "up" as const,
      healthReason: null,
      lastKnownDown: false,
      consecutiveFailures: 0,
      lastCheckAt: "2026-09-30T07:30:00.000Z",
      openIncident: null,
      lastResponseTimeMs: 100,
      responseP95Ms24h: 100,
      ssl: {
        level: "ok" as const,
        daysRemaining: 100,
        host: null,
        issuer: null,
        notAfter: null,
      },
      responseSparkline: Array.from({ length: 24 }, (_, hour) => ({
        hourStart: new Date(Date.UTC(2026, 8, 29, 8 + hour)).toISOString(),
        avgMs: null,
      })),
      uptime: {
        h24: { percent: 100, checks: 1, coveragePercent: 100 },
        d30: { percent: 100, checks: 1, coveragePercent: 100 },
      },
    });
    const cached: MonitorListResponse = {
      summary: { up: 2, down: 0, unknown: 0, paused: 0, total: 2, limit: 20 },
      monitors: [item(MONITOR_ID, "Payments API"), item(OTHER_ID, "Docs")],
      page: { limit: 25, offset: 0, total: 2 },
      dataAsOf: "2026-09-30T07:32:05.000Z",
    };
    const user = userEvent.setup();
    const { queryClient } = renderDetail();
    queryClient.setQueryData(
      monitorQueryKeys.list(A, P, { limit: 25, offset: 0 }),
      cached,
    );
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );

    expect(
      await screen.findByTestId("monitor-overview-notice"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("monitor-list-name-" + OTHER_ID),
    ).toHaveTextContent(/^Docs$/);
    expect(screen.getByTestId("monitor-list-name-" + OTHER_ID)).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${OTHER_ID}`,
    );
    expect(screen.queryByTestId("monitor-list-name-" + MONITOR_ID)).toBeNull();
    expect(
      queryClient.getQueryData<MonitorListResponse>(
        monitorQueryKeys.list(A, P, { limit: 25, offset: 0 }),
      )?.summary,
    ).toMatchObject({ up: 1, total: 1 });
  });

  it("prunes the deleted monitor's recent events and leaves another Organization's cache alone", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockResolvedValue(undefined);
    vi.mocked(fetchMonitorList).mockReturnValue(new Promise(() => undefined));
    vi.mocked(fetchMonitorRecentEvents).mockReturnValue(
      new Promise(() => undefined),
    );
    const event = (monitorId: string, monitorName: string) => ({
      kind: "incident_opened" as const,
      monitorId,
      monitorName,
      at: "2026-09-30T07:00:00.000Z",
      reason: "timeout",
    });
    const mine = {
      events: [event(MONITOR_ID, "Payments API"), event(OTHER_ID, "Docs")],
    };
    const theirs = {
      events: [event(MONITOR_ID, "Same id in another Organization")],
    };
    const user = userEvent.setup();
    const { queryClient } = renderDetail();
    queryClient.setQueryData(monitorQueryKeys.recentEvents(A, P), mine);
    queryClient.setQueryData(monitorQueryKeys.recentEvents(B, P), theirs);
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );
    await screen.findByTestId("monitor-overview-notice");

    expect(
      queryClient
        .getQueryData<typeof mine>(monitorQueryKeys.recentEvents(A, P))
        ?.events.map((item) => item.monitorName),
    ).toEqual(["Docs"]);
    expect(queryClient.getQueryData(monitorQueryKeys.recentEvents(B, P))).toBe(
      theirs,
    );
  });

  it("does not show the notice again after a reload of the Overview state", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );
    await screen.findByTestId("monitor-overview-notice");
    await user.click(screen.getByTestId("detail-harness-open"));
    await screen.findByTestId("monitor-detail-title");
    expect(screen.queryByTestId("monitor-overview-notice")).toBeNull();
  });

  it("goes to the Overview with 'มอนิเตอร์นี้ถูกลบแล้ว' when another session deleted it first", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockRejectedValue(
      new ApiError("MONITOR_NOT_FOUND", "gone", 404),
    );
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );
    expect(
      await screen.findByTestId("monitor-overview-notice"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors`,
    );
  });

  it("closes the dialog with an error and gives focus back to the opener when the delete fails", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    const user = userEvent.setup();
    renderDetail();
    const { opener, dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );
    expect(
      await screen.findByTestId("monitor-detail-action-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-detail-delete-dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
    );
  });

  it("says 'สิทธิ์ของคุณเปลี่ยนแล้ว' when the role dropped while the dialog was open", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    fetchMeContextMock
      .mockResolvedValueOnce(context())
      .mockResolvedValue(context("auditor"));
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByTestId("monitor-detail-delete-confirm"),
    );
    expect(
      await screen.findByTestId("monitor-detail-action-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-detail-delete-dialog")).toBeNull();
    await waitFor(() => {
      expect(screen.queryByTestId("monitor-detail-delete")).toBeNull();
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
    );
  });
});
