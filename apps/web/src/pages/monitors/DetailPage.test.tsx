import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type {
  Monitor,
  MonitorListResponse,
  MonitorResponseTimesResponse,
} from "@nightwatch/api-contract";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLeafActive } from "../../components/shell/nav-config";
import { ApiError } from "../../lib/api/client";
import { projectQueryKeys } from "../../lib/api/projects";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { fetchProjectDetail } from "../../lib/api/projects";
import {
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorEvents,
  fetchMonitorIncidents,
  fetchMonitorLastResponse,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  A,
  B,
  baseResult,
  context,
  DATA_AS_OF,
  detail,
  MONITOR_ID,
  must,
  noChecks,
  noIncidents,
  noResponseTimes,
  NOW,
  renderDetail,
  P,
  projectDetail,
} from "./detail-test-support";
import { ResponseTimeCard } from "./detail/ResponseTimeCard";
import { formatDateTime, formatTime, TIME_ZONE } from "./format";
import { deferred } from "./form-test-support";

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
  // Short enough to exercise the real refetch interval inside a test.
  MONITOR_REFETCH_INTERVAL_MS: 60,
  fetchMonitorDetail: vi.fn(),
  fetchMonitorEvents: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchDetailMock = vi.mocked(fetchMonitorDetail);
const fetchChecksMock = vi.mocked(fetchMonitorChecks);
const fetchIncidentsMock = vi.mocked(fetchMonitorIncidents);
const fetchListMock = vi.mocked(fetchMonitorList);
const fetchEventsMock = vi.mocked(fetchMonitorRecentEvents);
const fetchFeedMock = vi.mocked(fetchMonitorEvents);
const fetchLastResponseMock = vi.mocked(fetchMonitorLastResponse);
const fetchResponseTimesMock = vi.mocked(fetchMonitorResponseTimes);
const fetchOrgAlertsMock = vi.mocked(fetchOrganizationNotificationSettings);

beforeEach(() => {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMeContextMock.mockResolvedValue(context());
  fetchChecksMock.mockResolvedValue(noChecks);
  fetchIncidentsMock.mockResolvedValue(noIncidents);
  fetchEventsMock.mockResolvedValue({ events: [] });
  fetchFeedMock.mockResolvedValue({
    events: [],
    page: { limit: 20, offset: 0, total: 0 },
  });
  fetchLastResponseMock.mockResolvedValue({ response: null });
  fetchResponseTimesMock.mockResolvedValue(noResponseTimes);
  fetchOrgAlertsMock.mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: true,
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.resetAllMocks();
});

function showDetail(monitor: Monitor) {
  fetchDetailMock.mockResolvedValue({ monitor });
}

const notFound = () => new ApiError("MONITOR_NOT_FOUND", "not found", 404);

describe("Detail health and special states", () => {
  async function expectHealth(health: string, reason?: string) {
    await waitFor(() => {
      expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
        /^Payments API$/,
      );
      expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
        "data-health",
        health,
      );
      expect(screen.getByTestId("monitor-detail-health")).toHaveTextContent(
        /\S/,
      );
      if (reason !== undefined)
        expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
          "data-health-reason",
          reason,
        );
    });
  }
  it("shows a down monitor with its open incident and cause", async () => {
    showDetail(
      detail({
        health: "down",
        consecutiveFailures: 3,
        openIncident: {
          startedAt: "2026-09-30T07:20:00.000Z",
          reason: "http_status",
        },
      }),
    );
    fetchIncidentsMock.mockResolvedValue({
      incidents: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          startedAt: "2026-09-30T07:20:00.000Z",
          endedAt: null,
          durationSeconds: 720,
          startReason: "http_status",
          startHttpStatus: 503,
          endReason: null,
        },
      ],
      page: { limit: 20, offset: 0, total: 1 },
    });
    renderDetail();
    await expectHealth("down");
    const banner = screen.getByTestId("monitor-detail-down-banner");
    expect(banner).toHaveAttribute("data-reason", "http_status");
    expect(
      within(banner).getByTestId("monitor-detail-down-duration"),
    ).toHaveTextContent(/12 นาที/);
    expect(
      within(banner).getByTestId("monitor-detail-incident-start"),
    ).toHaveAttribute("dateTime", "2026-09-30T07:20:00.000Z");
    expect(
      within(banner).getByTestId("monitor-detail-down-cause"),
    ).toHaveTextContent(/\S/);
    expect(
      within(banner).getByTestId("monitor-detail-down-expected-status"),
    ).toHaveTextContent(/^200-299$/);
    expect(
      within(banner).getByTestId("monitor-detail-down-notifications"),
    ).toHaveAttribute("href", "/notifications");
    // The duration changes every poll, so no assertive live region may hold it.
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    const incident = await screen.findByTestId(
      "monitor-incident-00000000-0000-4000-8000-000000000001",
    );
    expect(
      within(screen.getByTestId("monitor-incidents-table")).getAllByTestId(
        "monitor-incident-00000000-0000-4000-8000-000000000001",
      ),
    ).toHaveLength(1);
    expect(
      within(incident).getByTestId("monitor-incident-open"),
    ).toHaveTextContent(/\S/);
    expect(
      within(incident).getByTestId("monitor-incident-start"),
    ).toHaveAttribute("dateTime", "2026-09-30T07:20:00.000Z");
    expect(
      within(incident).getByTestId("monitor-incident-cell-duration"),
    ).toHaveTextContent(/^12 นาที$/);
    expect(
      within(incident).getByTestId("monitor-incident-cell-reason"),
    ).toHaveTextContent(/HTTP 503/);
  });

  it("hides the notifications link when the route organization is not the server-active one", async () => {
    // /notifications shows the server-active (A) inbox; a bookmarked monitor of B must not link to it.
    showDetail(
      detail({
        health: "down",
        consecutiveFailures: 3,
        openIncident: {
          startedAt: "2026-09-30T07:20:00.000Z",
          reason: "http_status",
        },
      }),
    );
    renderDetail(B);
    await expectHealth("down");
    const banner = screen.getByTestId("monitor-detail-down-banner");
    expect(banner).toHaveAttribute("data-reason", "http_status");
    expect(
      within(banner).getByTestId("monitor-detail-down-cause"),
    ).toHaveTextContent(/\S/);
    expect(
      within(banner).queryByTestId("monitor-detail-down-notifications"),
    ).toBeNull();
  });

  it("shows one failure as a warning beside an unchanged health", async () => {
    showDetail(detail({ consecutiveFailures: 1 }));
    renderDetail();
    await expectHealth("up");
    expect(
      screen.getByTestId("monitor-status-failures").textContent.match(/\d+/g),
    ).toEqual(["1", "2"]);
    expect(
      screen
        .getByTestId("monitor-status-failure-threshold")
        .textContent.match(/\d+/g),
    ).toEqual(["2"]);
  });

  it("shows a never-checked monitor as unknown with empty sections", async () => {
    showDetail(
      detail({
        health: "unknown",
        healthReason: "never_checked",
        lastCheckAt: null,
        lastResult: null,
        ssl: {
          state: "no_data",
          host: null,
          issuer: null,
          notAfter: null,
          daysRemaining: null,
          reason: null,
        },
        uptime: {
          h24: { percent: null, checks: 0, coveragePercent: 0 },
          d7: { percent: null, checks: 0, coveragePercent: 0 },
          d30: { percent: null, checks: 0, coveragePercent: 0 },
        },
      }),
    );
    renderDetail();
    await expectHealth("unknown", "never_checked");
    expect(screen.getByTestId("monitor-detail-first-check")).toHaveTextContent(
      /\S/,
    );
    expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-last-check-at",
      "",
    );
    for (const key of ["h24", "d7", "d30"] as const) {
      const window = screen.getByTestId(`monitor-status-window-${key}`);
      expect(
        within(window).getByTestId("monitor-status-percent"),
      ).toHaveAttribute("data-has-percent", "false");
      expect(
        within(window).getByTestId("monitor-status-percent"),
      ).toHaveTextContent(/\S/);
      expect(
        within(window).getByTestId("monitor-status-percent").textContent,
      ).not.toMatch(/\d+([.,]\d+)?%/);
      expect(within(window).queryByTestId("monitor-status-checks")).toBeNull();
      expect(
        within(window).queryByTestId("monitor-status-coverage"),
      ).toBeNull();
    }
    const ssl = within(screen.getByTestId("monitor-detail-ssl"));
    expect(ssl.getByTestId("monitor-detail-ssl-state")).toHaveAttribute(
      "data-ssl-level",
      "no_data",
    );
    expect(ssl.getByTestId("monitor-detail-ssl-state")).toHaveTextContent(/\S/);
    expect(ssl.queryByTestId("monitor-detail-ssl-expiry")).toBeNull();
    expect(
      await screen.findByTestId("monitor-incidents-empty"),
    ).toHaveTextContent(/\S/);
    expect(screen.queryByTestId("monitor-incidents-table")).toBeNull();
  });

  it("explains a monitor waiting for the new config and keeps the last-known-down note", async () => {
    showDetail(
      detail({
        health: "unknown",
        healthReason: "awaiting_new_config",
        lastKnownDown: true,
        updatedAt: "2026-09-30T07:40:00.000Z",
        openIncident: {
          startedAt: "2026-09-30T07:00:00.000Z",
          reason: "timeout",
        },
      }),
    );
    renderDetail();
    await expectHealth("unknown", "awaiting_new_config");
    const alert = screen.getByTestId("monitor-detail-awaiting-config");
    expect(alert).toHaveAttribute("role", "status");
    expect(alert).toHaveTextContent(/\S/);
    expect(
      screen.getByTestId("monitor-status-last-known-down"),
    ).toHaveTextContent(/\S/);
    const updated = within(alert).getByTestId("monitor-detail-updated-time");
    expect(updated.tagName).toBe("TIME");
    expect(updated).toHaveAttribute("dateTime", "2026-09-30T07:40:00.000Z");
    expect(updated).toHaveTextContent(formatTime("2026-09-30T07:40:00.000Z"));
    expect(
      screen.getByTestId("monitor-detail-health-reason"),
    ).toHaveTextContent(/\S/);
  });

  it("shows a system-side failure as 'ตรวจไม่ได้', not as healthy or as the target failing", async () => {
    showDetail(
      detail({
        health: "unknown",
        healthReason: "check_error",
        lastResult: {
          ...baseResult,
          outcome: "check_error",
          httpStatus: null,
          responseTimeMs: null,
          failureReason: "internal_egress_failed",
        },
      }),
    );
    renderDetail();
    await expectHealth("unknown", "check_error");
    expect(
      screen.getByTestId("monitor-detail-health-reason"),
    ).toHaveTextContent(/\S/);
    expect(screen.queryByTestId("monitor-detail-down-banner")).toBeNull();
  });

  it("warns that a stale result may not match the current state", async () => {
    showDetail(
      detail({
        health: "unknown",
        healthReason: "stale",
        lastCheckAt: "2026-09-30T06:10:00.000Z",
      }),
    );
    renderDetail();
    await expectHealth("unknown", "stale");
    expect(screen.getByTestId("monitor-detail-stale-note")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("monitor-detail-stale-note")).toHaveTextContent(
      /\S/,
    );
    expect(
      screen.getByTestId("monitor-detail-health-reason"),
    ).toHaveTextContent(/\S/);
    expect(screen.getByTestId("monitor-detail-stale-time")).toHaveAttribute(
      "dateTime",
      "2026-09-30T06:10:00.000Z",
    );
  });

  it("shows a paused monitor with an info alert and no healthy tone", async () => {
    showDetail(detail({ status: "paused", health: "paused" }));
    renderDetail();
    await expectHealth("paused");
    expect(screen.getByTestId("monitor-detail-paused")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("monitor-detail-paused")).toHaveTextContent(/\S/);
    expect(screen.getByTestId("monitor-detail-toggle").tagName).toBe("BUTTON");
    expect(screen.getByTestId("monitor-detail-toggle")).toHaveAttribute(
      "data-status",
      "paused",
    );
    expect(screen.getByTestId("monitor-detail-toggle")).toBeEnabled();
  });

  it("keeps paused and healthy monitor states written and distinct", async () => {
    showDetail(detail({ status: "paused", health: "paused" }));
    const { unmount } = renderDetail();
    await expectHealth("paused");
    expect(screen.getByTestId("monitor-detail-paused")).toHaveAttribute(
      "role",
      "status",
    );
    const pausedState = screen.getByTestId("monitor-detail-health").textContent;
    unmount();

    showDetail(detail());
    renderDetail();
    await expectHealth("up");
    expect(screen.getByTestId("monitor-detail-health").textContent).not.toBe(
      pausedState,
    );
    expect(screen.queryByTestId("monitor-detail-paused")).toBeNull();
  });
});

async function readyDetail() {
  await waitFor(() =>
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      /^Payments API$/,
    ),
  );
}

describe("Detail SSL card", () => {
  function certificate(card: HTMLElement, ssl: Monitor["ssl"]) {
    const scope = within(card);
    for (const field of ["issuer", "host"] as const) {
      if (ssl[field] === null)
        expect(scope.queryByTestId(`monitor-detail-ssl-${field}`)).toBeNull();
      else
        expect(
          scope.getByTestId(`monitor-detail-ssl-${field}`).textContent,
        ).toBe(ssl[field]);
    }
    if (ssl.notAfter === null)
      expect(scope.queryByTestId("monitor-detail-ssl-expiry")).toBeNull();
    else {
      const expiry = scope.getByTestId("monitor-detail-ssl-expiry");
      expect(expiry.tagName).toBe("TIME");
      expect(expiry).toHaveAttribute("dateTime", ssl.notAfter);
      expect(expiry).toHaveTextContent(/\S/);
    }
    const state = scope.getByTestId("monitor-detail-ssl-state");
    expect(state).toHaveAttribute("data-ssl-level", ssl.state);
    expect(state).toHaveAttribute(
      "data-days-remaining",
      ssl.daysRemaining === null ? "" : String(ssl.daysRemaining),
    );
    expect(state).toHaveTextContent(/\S/);
    expect(state.textContent.match(/\d+/g) ?? []).toEqual(
      ssl.daysRemaining === null ? [] : [String(Math.abs(ssl.daysRemaining))],
    );
  }
  const cases: [string, Partial<Monitor["ssl"]>][] = [
    ["ok", { state: "ok", daysRemaining: 128 }],
    ["caution", { state: "caution", daysRemaining: 21 }],
    ["danger", { state: "danger", daysRemaining: 5 }],
    ["expired with a date", { state: "expired", daysRemaining: -2 }],
    [
      "expired without a date",
      {
        state: "expired",
        daysRemaining: null,
        notAfter: null,
        issuer: null,
        host: null,
      },
    ],
    [
      "unreadable with its reason",
      {
        state: "unreadable",
        daysRemaining: null,
        notAfter: null,
        issuer: null,
        reason: "hostname_mismatch",
      },
    ],
    [
      "not https",
      {
        state: "not_https",
        daysRemaining: null,
        notAfter: null,
        issuer: null,
        host: null,
      },
    ],
    [
      "no data",
      {
        state: "no_data",
        daysRemaining: null,
        notAfter: null,
        issuer: null,
        host: null,
      },
    ],
  ];
  it.each(cases)("shows %s", async (_name, ssl) => {
    const value = { ...detail().ssl, ...ssl };
    showDetail(detail({ ssl: value }));
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-detail-ssl");
    certificate(card, value);
    if (value.state === "unreadable") {
      expect(
        within(card).getByTestId("monitor-detail-ssl-unreadable"),
      ).toHaveAttribute("data-reason", "hostname_mismatch");
      expect(
        within(card).getByTestId("monitor-detail-ssl-unreadable"),
      ).toHaveTextContent(/\S/);
    }
    if (value.state === "not_https")
      expect(
        within(card).getByTestId("monitor-detail-ssl-http"),
      ).toHaveTextContent(/\S/);
    if (value.state === "no_data")
      expect(
        within(card).getByTestId("monitor-detail-ssl-empty"),
      ).toHaveTextContent(/\S/);
  });
  const reasonRecords = new Map<string, string>();
  it.each(["self_signed", "hostname_mismatch", "untrusted"] as const)(
    "says a readable but invalid certificate (%s) is invalid, in a warning tone",
    async (reason) => {
      const ssl = {
        ...detail().ssl,
        state: "ok" as const,
        daysRemaining: 128,
        reason,
      };
      showDetail(detail({ ssl }));
      renderDetail();
      await readyDetail();
      const card = screen.getByTestId("monitor-detail-ssl");
      const line = within(card).getByTestId("monitor-detail-ssl-invalid");
      expect(line).toHaveAttribute("data-reason", reason);
      expect(line).toHaveTextContent(/\S/);
      reasonRecords.set(reason, line.textContent);
      expect(new Set(reasonRecords.values()).size).toBe(reasonRecords.size);
      certificate(card, ssl);
    },
  );
  it("shows the host when it is known even without issuer or expiry", async () => {
    const ssl = {
      ...detail().ssl,
      state: "unreadable" as const,
      issuer: null,
      notAfter: null,
      daysRemaining: null,
      host: "api.acme.example",
    };
    showDetail(detail({ ssl }));
    renderDetail();
    await readyDetail();
    certificate(screen.getByTestId("monitor-detail-ssl"), ssl);
  });
  it("lists issuer, host and expiry date of a readable certificate", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    certificate(screen.getByTestId("monitor-detail-ssl"), detail().ssl);
  });
});

describe("Detail alerts card", () => {
  const alertsCard = async () => {
    await readyDetail();
    return screen.getByTestId("monitor-detail-alerts");
  };
  const orgRowValue = (card: HTMLElement) =>
    within(card).getByTestId("monitor-alerts-org-value");
  function enabled(value: HTMLElement, yes: boolean) {
    expect(value).toHaveAttribute("data-enabled", String(yes));
    expect(value.textContent.trim().split(/\s|\(/)[0]).toBe(
      yes ? "เปิด" : "ปิด",
    );
  }
  it("shows the stored failure threshold, down and SSL alert settings, and SSL caution days", async () => {
    showDetail(
      detail({
        alerts: {
          failureThreshold: 3,
          downEnabled: false,
          sslEnabled: true,
          sslCautionDays: 15,
        },
      }),
    );
    renderDetail();
    const card = await alertsCard();
    expect(
      within(card).getByTestId("monitor-alerts-threshold"),
    ).toHaveTextContent(/^3$/);
    const down = within(card).getByTestId("monitor-alerts-down"),
      ssl = within(card).getByTestId("monitor-alerts-ssl");
    enabled(down, false);
    enabled(ssl, true);
    expect(down.textContent).not.toBe(ssl.textContent);
    expect(
      within(ssl).getByTestId("monitor-alerts-ssl-days"),
    ).toHaveTextContent(/^15$/);
  });
  it("shows the HTTP certificate note without hiding the enabled SSL alert setting", async () => {
    showDetail(
      detail({
        alerts: {
          failureThreshold: 2,
          downEnabled: true,
          sslEnabled: true,
          sslCautionDays: 30,
        },
        ssl: { ...detail().ssl, state: "not_https" },
      }),
    );
    renderDetail();
    const card = await alertsCard();
    const ssl = within(card).getByTestId("monitor-alerts-ssl");
    enabled(ssl, true);
    expect(
      within(ssl).getByTestId("monitor-alerts-http-note"),
    ).toHaveTextContent(/\S/);
    expect(
      within(ssl).getByTestId("monitor-alerts-ssl-days"),
    ).toHaveTextContent(/^30$/);
  });
  it("hides the SSL advance-notice text when monitor SSL alerts are off", async () => {
    showDetail(
      detail({
        alerts: {
          failureThreshold: 2,
          downEnabled: true,
          sslEnabled: false,
          sslCautionDays: 30,
        },
      }),
    );
    renderDetail();
    const card = await alertsCard();
    const ssl = within(card).getByTestId("monitor-alerts-ssl");
    enabled(ssl, false);
    expect(within(ssl).queryByTestId("monitor-alerts-ssl-days")).toBeNull();
  });
  it.each(["owner", "admin"] as const)(
    "shows disabled organization monitor alerts and the suppression note to %s",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      fetchOrgAlertsMock.mockResolvedValue({
        organizationId: A,
        version: 1,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: false,
      });
      showDetail(detail());
      renderDetail();
      const card = await alertsCard();
      await waitFor(() => {
        enabled(orgRowValue(card), false);
      });
      expect(
        within(card).getByTestId("monitor-alerts-org-suppressed"),
      ).toHaveTextContent(/\S/);
      expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
        "data-health",
        "up",
      );
      expect(
        within(card).getByTestId("monitor-alerts-threshold"),
      ).toHaveTextContent(/^2$/);
    },
  );
  it.each(["viewer", "auditor"] as const)(
    "hides organization monitor alert settings from %s without requesting them",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      showDetail(detail());
      renderDetail();
      const card = await alertsCard();
      expect(
        within(card).getByTestId("monitor-alerts-threshold"),
      ).toHaveTextContent(/^2$/);
      expect(within(card).queryByTestId("monitor-alerts-org-value")).toBeNull();
      await waitFor(() =>
        expect(screen.getByTestId("monitor-incidents-empty")).toHaveTextContent(
          /\S/,
        ),
      );
      expect(fetchOrgAlertsMock).not.toHaveBeenCalled();
    },
  );
  it("shows a loading placeholder for organization monitor alerts, then เปิด when loading succeeds", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchOrgAlertsMock>>>();
    fetchOrgAlertsMock.mockReturnValue(pending.promise);
    showDetail(detail());
    renderDetail();
    const card = await alertsCard();
    const loading = within(orgRowValue(card)).getByTestId(
      "monitor-alerts-org-loading",
    );
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading.textContent).toMatch(/\S/);
    expect(orgRowValue(card)).not.toHaveAttribute("data-enabled");
    pending.resolve({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    await waitFor(() => {
      enabled(orgRowValue(card), true);
      expect(
        within(card).queryByTestId("monitor-alerts-org-loading"),
      ).toBeNull();
    });
  });
  it("shows a load error for organization monitor alerts without เปิด, then shows เปิด after a successful retry", async () => {
    fetchOrgAlertsMock.mockRejectedValueOnce(
      new ApiError("INTERNAL", "boom", 500),
    );
    showDetail(detail());
    renderDetail();
    const card = await alertsCard();
    await waitFor(() => {
      expect(
        within(orgRowValue(card)).getByTestId("monitor-alerts-org-error"),
      ).toHaveAttribute("role", "alert");
      expect(orgRowValue(card)).not.toHaveAttribute("data-enabled");
    });
    expect(orgRowValue(card)).not.toHaveTextContent("เปิด");
    fetchOrgAlertsMock.mockResolvedValue({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    expect(within(card).getByTestId("monitor-alerts-org-retry")).toHaveRole(
      "button",
    );
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(card).getByTestId("monitor-alerts-org-retry"));
    await waitFor(() => {
      enabled(orgRowValue(card), true);
      expect(within(card).queryByTestId("monitor-alerts-org-error")).toBeNull();
    });
  });
  it("replaces the organization monitor alert value with a permission-denied message and stops polling after PERMISSION_DENIED", async () => {
    fetchOrgAlertsMock.mockResolvedValue({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    showDetail(detail());
    const { queryClient } = renderDetail();
    const card = await alertsCard();
    await waitFor(() => {
      enabled(orgRowValue(card), true);
    });
    const previous = orgRowValue(card).textContent;
    fetchOrgAlertsMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    await queryClient.refetchQueries({
      queryKey: ["tenant", "notification-settings", A],
    });
    await waitFor(() => {
      expect(
        within(orgRowValue(card)).getByTestId("monitor-alerts-org-denied"),
      ).toHaveTextContent(/\S/);
      expect(orgRowValue(card)).not.toHaveAttribute("data-enabled");
      expect(orgRowValue(card).textContent).not.toBe(previous);
      expect(orgRowValue(card)).not.toHaveTextContent("เปิด");
    });
    const calls = fetchOrgAlertsMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchOrgAlertsMock.mock.calls.length).toBe(calls);
  });
});

describe("Detail last result (AC-84)", () => {
  it("has no last-result card, its table, its cause line or its prefix label", async () => {
    showDetail(
      detail({
        health: "down",
        assertions: [{ kind: "jsonPathEquals", path: "$.id", expected: "1" }],
        lastResult: {
          ...baseResult,
          outcome: "fail",
          httpStatus: 503,
          failureReason: "assertion_failed",
          evaluatedFromPrefix: true,
          configVersion: 1,
          assertions: [
            {
              kind: "jsonPathEquals",
              expected: "1",
              actual: '"1"',
              actualType: "string",
              actualTruncated: false,
              status: "fail",
              reason: "type_mismatch",
            },
          ],
        },
      }),
    );
    renderDetail();
    await readyDetail();
    await screen.findByTestId("monitor-incidents-empty");
    for (const heading of document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,[role="heading"]',
    ))
      expect(heading.textContent).not.toMatch(/ผลการตรวจล่าสุด/);
    for (const table of document.querySelectorAll('table,[role="table"]'))
      expect(table).not.toHaveAccessibleName("ผลการตรวจล่าสุดต่อเงื่อนไข");
    expect(document.body.textContent).not.toMatch(
      /ชนิดข้อมูลไม่ตรง|ประเมินจากส่วนต้นของ response|HTTP 503/,
    );
    expect(document.body.innerHTML).not.toMatch(
      /ชนิดข้อมูลไม่ตรง|ประเมินจากส่วนต้นของ response|HTTP 503/,
    );
    expect(document.body.textContent).not.toMatch(/สาเหตุ /);
    expect(screen.queryByTestId("monitor-detail-down-banner")).toBeNull();
  });
});

describe("Detail checks history link", () => {
  it("links to the checks history page and shows neither its table nor its pagination", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    const link = screen.getByTestId("monitor-detail-checks-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAccessibleName(/\S/);
    expect(
      within(link).getByTestId("monitor-detail-checks-arrow"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/checks`,
    );
    expect(screen.queryByTestId("monitor-checks-records")).toBeNull();
    expect(screen.queryByTestId("monitor-checks-summary")).toBeNull();
    expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
    for (const nav of document.querySelectorAll('nav,[role="navigation"]'))
      expect(nav).not.toHaveAccessibleName("หน้าประวัติการตรวจ");
    expect(screen.queryByTestId("monitor-checks-heading")).toBeNull();
    expect(fetchChecksMock).not.toHaveBeenCalled();
  });
});

describe("Detail access", () => {
  const refusalRecords = new Set<string>();
  it.each(["viewer", "auditor"] as const)(
    "shows %s the page without any edit, pause, resume or delete control",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      showDetail(detail());
      renderDetail();
      await readyDetail();
      expect(screen.getByTestId("monitor-detail-read-only")).toHaveAttribute(
        "data-role",
        "member",
      );
      expect(screen.getByTestId("monitor-detail-read-only")).toHaveTextContent(
        /\S/,
      );
      expect(screen.queryByTestId("monitor-detail-edit")).toBeNull();
      expect(screen.queryByTestId("monitor-detail-toggle")).toBeNull();
      expect(screen.queryByTestId("monitor-detail-delete")).toBeNull();
      // A Project member never asks for the last response (AC-03).
      expect(fetchLastResponseMock).not.toHaveBeenCalled();
    },
  );
  it("gives a Project admin who is only an Organization viewer the write controls and the last response", async () => {
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: "admin" }),
    );
    showDetail(detail());
    renderDetail();
    await readyDetail();
    expect(screen.getByTestId("monitor-detail-edit")).toHaveRole("link");
    expect(screen.getByTestId("monitor-detail-toggle")).toHaveRole("button");
    expect(screen.getByTestId("monitor-detail-delete")).toHaveRole("button");
    expect(screen.queryByTestId("monitor-detail-read-only")).toBeNull();
    await waitFor(() => {
      expect(fetchLastResponseMock).toHaveBeenCalledWith(A, P, MONITOR_ID);
    });
    // The Organization's own alert setting is for Owners and Admins, not for a Project admin.
    expect(fetchOrgAlertsMock).not.toHaveBeenCalled();
  });
  it("gives an Organization admin who is not in the Project the write controls", async () => {
    fetchMeContextMock.mockResolvedValue(context("admin"));
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: null }),
    );
    showDetail(detail());
    renderDetail();
    await readyDetail();
    expect(screen.getByTestId("monitor-detail-edit")).toHaveRole("link");
    expect(screen.queryByTestId("monitor-detail-read-only")).toBeNull();
  });
  it("gives owner and admin the edit link, pause and delete", async () => {
    fetchMeContextMock.mockResolvedValue(context("admin"));
    showDetail(detail());
    renderDetail();
    await readyDetail();
    expect(screen.getByTestId("monitor-detail-edit")).toHaveRole("link");
    expect(screen.getByTestId("monitor-detail-toggle")).toHaveRole("button");
    expect(screen.getByTestId("monitor-detail-delete")).toHaveRole("button");
    expect(screen.getByTestId("monitor-detail-edit")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/edit`,
    );
    expect(screen.getByTestId("monitor-detail-toggle")).toBeVisible();
    expect(screen.getByTestId("monitor-detail-toggle")).toHaveAttribute(
      "data-status",
      "active",
    );
    expect(screen.getByTestId("monitor-detail-delete")).toBeVisible();
    expect(screen.queryByTestId("monitor-detail-read-only")).toBeNull();
  });
  it("shows denied to a non-member without fetching or naming the monitor", async () => {
    renderDetail(B.replace("2222", "3333"));
    expect(
      await screen.findByTestId("monitor-detail-denied"),
    ).toHaveTextContent(/\S/);
    expect(fetchDetailMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
  });
  it("shows denied only after re-reading the membership when the API refuses", async () => {
    fetchDetailMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "denied", 403),
    );
    let finish: (value: ReturnType<typeof context>) => void = () => undefined;
    fetchMeContextMock.mockResolvedValueOnce(context()).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderDetail();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("monitor-detail-denied")).toBeNull();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
    finish(
      context("viewer", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    expect(
      await screen.findByTestId("monitor-detail-denied"),
    ).toHaveTextContent(/\S/);
    expect(document.body.innerHTML).not.toContain("Payments API");
  });
  it.each([
    ["a monitor that does not exist", MONITOR_ID],
    ["a malformed id", "not-a-uuid"],
    [
      "a monitor of another Organization",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ],
  ])("answers %s with the same text", async (_name, monitorId) => {
    fetchDetailMock.mockRejectedValue(notFound());
    renderDetail(A, monitorId);
    expect(
      await screen.findByTestId("monitor-detail-not-found"),
    ).toHaveTextContent(/\S/);
    refusalRecords.add(
      screen.getByTestId("monitor-detail-not-found").textContent,
    );
    expect(refusalRecords.size).toBe(1);
    expect(screen.getByTestId("monitor-detail-back")).toHaveRole("link");
    expect(screen.getByTestId("monitor-detail-not-found-back")).toHaveRole(
      "link",
    );
    expect(screen.getByTestId("monitor-detail-back")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors`,
    );
    expect(screen.getByTestId("monitor-detail-not-found-back")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors`,
    );
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
  });
});

describe("Detail loading, failure and refetch", () => {
  it("shows a loading state with no data while pending", async () => {
    fetchDetailMock.mockReturnValue(new Promise(() => undefined));
    renderDetail();
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-detail-loading-status"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("monitor-detail-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("monitor-detail-loading-status")).toHaveRole(
      "status",
    );
    expect(
      screen.getByTestId("monitor-detail-loading-status"),
    ).toHaveAccessibleName(/\S/);
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
  });

  it("shows a failure with a retry, never the empty state", async () => {
    fetchDetailMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "down", 0),
    );
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("monitor-detail-load-alert")).toHaveRole(
        "alert",
      );
    });
    expect(screen.getByTestId("monitor-detail-load-retry")).toHaveRole(
      "button",
    );
    showDetail(detail());
    await userEvent
      .setup()
      .click(screen.getByTestId("monitor-detail-load-retry"));
    await readyDetail();
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      /^Payments API$/,
    );
  });

  it("keeps the last data with a warning when a refetch fails", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    fetchDetailMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    expect(
      await screen.findByTestId("monitor-detail-refresh-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      "Payments API",
    );
  });

  it("shows the new state after another session pauses the monitor", async () => {
    showDetail(detail());
    renderDetail();
    await screen.findByTestId("monitor-detail-toggle");
    showDetail(detail({ status: "paused", health: "paused" }));
    expect(
      await screen.findByTestId("monitor-detail-paused"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-detail-toggle")).toHaveRole("button");
    expect(screen.getByTestId("monitor-detail-toggle")).toHaveAttribute(
      "data-status",
      "paused",
    );
    expect(screen.getByTestId("monitor-detail-health")).toHaveAttribute(
      "data-health",
      "paused",
    );
  });

  it("shows 'not found' after another session deletes the monitor", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    fetchDetailMock.mockRejectedValue(notFound());
    expect(
      await screen.findByTestId("monitor-detail-not-found"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
  });
});

describe("Detail data freshness (AC-81, AC-87)", () => {
  const downWithIncident = () =>
    detail({
      health: "down",
      consecutiveFailures: 3,
      openIncident: {
        startedAt: "2026-09-30T07:20:00.000Z",
        reason: "http_status",
      },
    });

  let freshClient: QueryClient;
  function renderFresh() {
    const result = renderDetail();
    freshClient = result.queryClient;
    return result;
  }
  function snapshot() {
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
      /^Payments API$/,
    );
    expect(screen.getByTestId("monitor-detail-url")).toHaveTextContent(
      /^https:\/\/api.acme.example\/health$/,
    );
    const time = screen.getByTestId("monitor-status-as-of-time");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", DATA_AS_OF);
    expect(time).toHaveTextContent(
      new Date(DATA_AS_OF).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    );
    expect(screen.getByTestId("monitor-status-as-of")).toHaveTextContent(
      TIME_ZONE,
    );
    expect(screen.getByTestId("monitor-detail-last-check")).toHaveAttribute(
      "dateTime",
      "2026-09-30T07:30:00.000Z",
    );
    for (const [key, percent, checks] of [
      ["h24", "100.00%", "288"],
      ["d7", "99.50%", "2,016"],
      ["d30", "99.20%", "8,640"],
    ] as const) {
      const window = within(screen.getByTestId(`monitor-status-window-${key}`));
      expect(window.getByTestId("monitor-status-percent")).toHaveTextContent(
        percent,
      );
      expect(window.getByTestId("monitor-status-checks")).toHaveTextContent(
        checks,
      );
      expect(window.getByTestId("monitor-status-coverage")).toHaveTextContent(
        "100.00%",
      );
    }
  }
  async function dataAsOfDot() {
    await readyDetail();
    snapshot();
    return screen.getByTestId("monitor-status-freshness-dot");
  }
  function headerBadge() {
    const health = screen.getByTestId("monitor-detail-health");
    expect(health).toHaveTextContent(/\S/);
    return { pill: health, wrapper: health };
  }
  it("pulses the data-as-of dot while fresh, goes neutral after a failed refresh and pulses again after recovery", async () => {
    showDetail(detail());
    renderFresh();
    const fresh = await dataAsOfDot();
    expect(fresh).toHaveAttribute("aria-hidden", "true");
    expect(fresh).toHaveAttribute("data-fresh", "true");
    expect(fresh).toHaveAttribute("data-fresh", "true");
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "true",
    );

    fetchDetailMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    expect(
      await screen.findByTestId("monitor-detail-refresh-error"),
    ).toBeInTheDocument();
    const stale = await dataAsOfDot();
    expect(stale).toHaveAttribute("data-fresh", "false");
    expect(stale).toHaveAttribute("data-fresh", "false");
    expect(stale).toHaveAttribute("data-fresh", "false");
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );

    showDetail(detail());
    await waitFor(() => {
      expect(screen.queryByTestId("monitor-detail-refresh-error")).toBeNull();
    });
    const recovered = await dataAsOfDot();
    expect(recovered).toHaveAttribute("data-fresh", "true");
    expect(recovered).toHaveAttribute("data-fresh", "true");
  });

  it("glows the badge while an incident is active, drops the glow on a failed refresh and brings it back on recovery", async () => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();
    const { pill, wrapper } = headerBadge();
    expect(pill).toHaveAttribute("data-health", "down");
    expect(wrapper).toHaveAttribute("data-fresh", "true");
    // Static glow: the dot is still the only live-pulse, and the badge keeps its neutral look (COL-01).
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "true",
    );

    fetchDetailMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    expect(
      await screen.findByTestId("monitor-detail-refresh-error"),
    ).toBeInTheDocument();
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "false");
    expect(headerBadge().pill).toHaveAttribute("data-health", "down");
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );

    showDetail(downWithIncident());
    await waitFor(() => {
      expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");
    });
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "true",
    );
  });

  // Offline, TanStack pauses the refetch (`fetchStatus: "paused"`) without an error: the data no longer refreshes, so it is not fresh (CMP-01).
  it("drops the pulse of the dot while the refresh is paused offline and brings it back when it resumes", async () => {
    showDetail(detail());
    renderFresh();
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "true");

    onlineManager.setOnline(false);
    await waitFor(() => {
      expect(
        freshClient.getQueryState(monitorQueryKeys.detail(A, P, MONITOR_ID))
          ?.fetchStatus,
      ).toBe("paused");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "false");
    });
    const paused = await dataAsOfDot();
    expect(paused).toHaveAttribute("data-fresh", "false");
    expect(paused).toHaveAttribute("data-fresh", "false");
    // No new copy: a pause is not a failed refresh.
    expect(screen.queryByTestId("monitor-detail-refresh-error")).toBeNull();

    // Time passes while it is paused, so the response that follows is stamped after the pause began.
    vi.setSystemTime(NOW.getTime() + 1_000);
    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "true");
    });
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "true");
  });

  it("drops the badge glow while the refresh is paused offline and brings it back when it resumes", async () => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");

    onlineManager.setOnline(false);
    await waitFor(() => {
      expect(
        freshClient.getQueryState(monitorQueryKeys.detail(A, P, MONITOR_ID))
          ?.fetchStatus,
      ).toBe("paused");
    });
    await waitFor(() => {
      expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "false");
    });
    expect(headerBadge().pill).toHaveAttribute("data-health", "down");
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );
    expect(screen.queryByTestId("monitor-detail-refresh-error")).toBeNull();

    vi.setSystemTime(NOW.getTime() + 1_000);
    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");
    });
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "true",
    );
  });

  // After a pause the query keeps the snapshot from before it, so a resumed fetch that has not succeeded yet must not make the cues fresh (Codex 4202249500). The clock moves on during the pause; the poll interval is mocked at 60 ms, so data counts as fresh for 120 ms.
  const PAUSE_MS = 10 * 60_000;

  it("keeps the dot and the glow off while the resumed fetch is pending, then restores both when it succeeds", async () => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");

    onlineManager.setOnline(false);
    await waitFor(() => {
      expect(
        freshClient.getQueryState(monitorQueryKeys.detail(A, P, MONITOR_ID))
          ?.fetchStatus,
      ).toBe("paused");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "false");
    });
    vi.setSystemTime(NOW.getTime() + PAUSE_MS);
    const resumed = deferred<{ monitor: Monitor }>();
    fetchDetailMock.mockReturnValue(resumed.promise);
    const calls = fetchDetailMock.mock.calls.length;
    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(fetchDetailMock.mock.calls.length).toBeGreaterThan(calls);
    });
    // The fetch is in flight and `data` is still the snapshot from before the pause.
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "false");
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "false");

    await act(async () => {
      resumed.resolve({ monitor: downWithIncident() });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "true");
    });
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");
  });

  it("stays not fresh when the resumed fetch fails", async () => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();

    onlineManager.setOnline(false);
    await waitFor(() => {
      expect(
        freshClient.getQueryState(monitorQueryKeys.detail(A, P, MONITOR_ID))
          ?.fetchStatus,
      ).toBe("paused");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "false");
    });
    vi.setSystemTime(NOW.getTime() + PAUSE_MS);
    fetchDetailMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    onlineManager.setOnline(true);
    expect(
      await screen.findByTestId("monitor-detail-refresh-error"),
    ).toBeInTheDocument();
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "false");
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "false");
  });

  it("keeps the dot and the glow off after a short pause while the resumed fetch is pending, however recent the snapshot is", async () => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();

    onlineManager.setOnline(false);
    await waitFor(() => {
      expect(
        freshClient.getQueryState(monitorQueryKeys.detail(A, P, MONITOR_ID))
          ?.fetchStatus,
      ).toBe("paused");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "false");
    });
    // No time passes: the snapshot is still within the age limit when the query resumes (Codex 4202350103).
    const resumed = deferred<{ monitor: Monitor }>();
    fetchDetailMock.mockReturnValue(resumed.promise);
    const calls = fetchDetailMock.mock.calls.length;
    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(fetchDetailMock.mock.calls.length).toBeGreaterThan(calls);
    });
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "false");
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "false");

    vi.setSystemTime(NOW.getTime() + 1_000);
    await act(async () => {
      resumed.resolve({ monitor: downWithIncident() });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "true");
    });
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");
  });

  it("keeps the dot and the glow on while a routine poll is in flight", async () => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");

    const poll = deferred<{ monitor: Monitor }>();
    fetchDetailMock.mockReturnValue(poll.promise);
    const calls = fetchDetailMock.mock.calls.length;
    await waitFor(() => {
      expect(fetchDetailMock.mock.calls.length).toBeGreaterThan(calls);
    });
    // Pending, no pause and no error: nothing flickers.
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "true");
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");

    await act(async () => {
      poll.resolve({ monitor: downWithIncident() });
      await Promise.resolve();
    });
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "true");
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");
  });

  it("opens from a cached snapshot older than the limit with the dot and the glow off until the refetch succeeds", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      monitorQueryKeys.detail(A, P, MONITOR_ID),
      { monitor: downWithIncident() },
      { updatedAt: NOW.getTime() - PAUSE_MS },
    );
    const refetch = deferred<{ monitor: Monitor }>();
    fetchDetailMock.mockReturnValue(refetch.promise);
    renderDetail(A, MONITOR_ID, queryClient);
    freshClient = queryClient;
    await readyDetail();
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "false");
    expect(screen.getByTestId("monitor-status-freshness-dot")).toHaveAttribute(
      "data-fresh",
      "false",
    );
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "false");
    expect(fetchDetailMock).toHaveBeenCalled();

    await act(async () => {
      refetch.resolve({ monitor: downWithIncident() });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("monitor-status-freshness-dot"),
      ).toHaveAttribute("data-fresh", "true");
    });
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");
  });

  it.each([
    ["the incident ends", () => detail({ health: "up", openIncident: null })],
    [
      "the monitor is paused",
      () => detail({ status: "paused", health: "paused" }),
    ],
  ])("drops the badge glow when %s", async (_name, next) => {
    showDetail(downWithIncident());
    renderFresh();
    await readyDetail();
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");

    showDetail(next());
    await waitFor(() => {
      expect(headerBadge().wrapper).toHaveAttribute(
        "data-incident-open",
        "false",
      );
      expect(screen.queryByTestId("monitor-detail-down-banner")).toBeNull();
    });
    // The data is fresh again, so the dot keeps pulsing: no glow is not a stale state.
    expect(await dataAsOfDot()).toHaveAttribute("data-fresh", "true");
  });

  it("does not glow a down monitor that has no open incident", async () => {
    showDetail(detail({ health: "down", openIncident: null }));
    renderFresh();
    await readyDetail();
    expect(headerBadge().pill).toHaveAttribute("data-health", "down");
    expect(headerBadge().wrapper).toHaveAttribute(
      "data-incident-open",
      "false",
    );
    expect(screen.queryByTestId("monitor-detail-down-banner")).toBeNull();
  });

  it("leaves the Overview pills of the same down monitor without a glow", async () => {
    const hour = Date.UTC(2026, 8, 30, 7);
    fetchListMock.mockResolvedValue({
      summary: { up: 0, down: 1, unknown: 0, paused: 0, total: 1, limit: 20 },
      monitors: [
        {
          id: MONITOR_ID,
          name: "Payments API",
          url: "https://api.acme.example/health",
          method: "GET",
          intervalSeconds: 300,
          status: "active",
          health: "down",
          healthReason: null,
          lastKnownDown: false,
          consecutiveFailures: 3,
          lastCheckAt: "2026-09-30T07:30:00.000Z",
          openIncident: {
            startedAt: "2026-09-30T07:20:00.000Z",
            reason: "http_status",
          },
          lastResponseTimeMs: 182,
          responseP95Ms24h: 182,
          responseSparkline: Array.from({ length: 24 }, (_, index) => ({
            hourStart: new Date(hour - (23 - index) * 3_600_000).toISOString(),
            avgMs: null,
          })),
          ssl: {
            level: "ok",
            daysRemaining: 128,
            host: "api.acme.example",
            issuer: null,
            notAfter: null,
          },
          uptime: {
            h24: { percent: 100, checks: 288, coveragePercent: 100 },
            d30: { percent: 99.9, checks: 8640, coveragePercent: 100 },
          },
        },
      ],
      page: { limit: 25, offset: 0, total: 1 },
      dataAsOf: DATA_AS_OF,
    } satisfies MonitorListResponse);
    showDetail(downWithIncident());
    const user = userEvent.setup();
    renderFresh();
    await readyDetail();
    expect(headerBadge().wrapper).toHaveAttribute("data-fresh", "true");

    await user.click(screen.getByTestId("monitor-detail-back"));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        new RegExp(`^/organizations/${A}/projects/${P}/monitors$`),
      );
    });
    const row = await screen.findByTestId(`monitor-list-row-${MONITOR_ID}`);
    expect(
      within(row).getByTestId(`monitor-list-name-${MONITOR_ID}`),
    ).toHaveTextContent(/^Payments API$/);
    expect(within(row).getByTestId("monitor-list-health")).toHaveAttribute(
      "data-health",
      "down",
    );
    expect(
      within(row).getByTestId("monitor-list-incident-time"),
    ).toHaveAttribute("dateTime", "2026-09-30T07:20:00.000Z");
  });
});

describe("Detail structure", () => {
  function headingOf(id: string) {
    const card = screen.getByTestId(id);
    const heading = must(
      document.getElementById(must(card.getAttribute("aria-labelledby"))),
    );
    expect(heading.tagName).toBe("H2");
    expect(heading).toHaveAccessibleName(/\S/);
  }
  function headerRecords(card: HTMLElement) {
    return within(card)
      .getAllByTestId("monitor-config-header")
      .map((row) => ({
        name: within(row).getByTestId("monitor-config-header-name").textContent,
        secret: row.getAttribute("data-secret"),
        value:
          within(row).queryByTestId("monitor-config-header-value")
            ?.textContent ?? null,
        state:
          within(row).queryByTestId("monitor-config-header-state")
            ?.textContent ?? null,
      }));
  }
  it("orders the section headings as h2 under one h1", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    await screen.findByTestId("monitor-incidents-empty");
    expect(screen.getByTestId("monitor-detail-title")).toHaveRole("heading");
    expect(screen.getByTestId("monitor-detail-title").tagName).toBe("H1");
    expect(
      document.querySelectorAll('h1,[role="heading"][aria-level="1"]'),
    ).toHaveLength(1);
    headingOf("monitor-response-times");
    headingOf("monitor-status");
    headingOf("monitor-event-feed");
    headingOf("monitor-incidents");
    headingOf("monitor-detail-config");
    headingOf("monitor-detail-alerts");
    headingOf("monitor-detail-ssl");
    headingOf("monitor-last-response");
    expect(screen.getByTestId("monitor-detail-config-region")).toHaveRole(
      "complementary",
    );
    expect(screen.getByTestId("monitor-config-method")).toHaveTextContent(
      /^GET$/,
    );
    expect(screen.getByTestId("monitor-detail-url")).toHaveTextContent(
      /^https:\/\/api.acme.example\/health$/,
    );
    expect(screen.getByTestId("response-range-announcement")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("response-range-announcement")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByTestId("monitor-detail-checks-link")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/checks`,
    );
  });

  const HEADER_ID = "5c2f0a86-7d0e-4c58-9f4e-1a2b3c4d5e6f";

  it("shows 'ตั้งค่าแล้ว' from the stored slots, never a value", async () => {
    showDetail(
      detail({
        auth: { type: "bearer" },
        headers: [
          { id: HEADER_ID, name: "X-Api-Key", secret: true },
          { name: "Accept", value: "application/json", secret: false },
        ],
        secretSlots: [
          { slot: "auth.token", configured: true },
          { slot: `header.${HEADER_ID}`, configured: true },
        ],
      }),
    );
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-detail-config");
    expect(within(card).getByTestId("monitor-config-auth")).toHaveAttribute(
      "data-auth-type",
      "bearer",
    );
    expect(within(card).getByTestId("monitor-config-auth")).toHaveAttribute(
      "data-configured",
      "true",
    );
    expect(within(card).getByTestId("monitor-config-auth")).toHaveTextContent(
      /Bearer token.*ตั้งค่าแล้ว/,
    );
    expect(headerRecords(card)).toEqual([
      {
        name: "X-Api-Key",
        secret: "true",
        value: null,
        state: "ตั้งค่าแล้ว (ค่าลับ)",
      },
      {
        name: "Accept",
        secret: "false",
        value: "application/json",
        state: null,
      },
    ]);
    expect(card.innerHTML).not.toContain(HEADER_ID);
  });

  it("does not claim a secret is set when its slot is not stored", async () => {
    showDetail(
      detail({
        auth: { type: "basic" },
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        // Only half of the Basic pair is stored, and the header has no slot.
        secretSlots: [{ slot: "auth.username", configured: true }],
      }),
    );
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-detail-config");
    expect(within(card).getByTestId("monitor-config-auth")).toHaveAttribute(
      "data-auth-type",
      "basic",
    );
    expect(within(card).getByTestId("monitor-config-auth")).toHaveAttribute(
      "data-configured",
      "false",
    );
    expect(within(card).getByTestId("monitor-config-auth")).toHaveTextContent(
      /Basic.*ยังไม่ได้ตั้งค่า/,
    );
    expect(headerRecords(card)).toEqual([
      {
        name: "X-Api-Key",
        secret: "true",
        value: null,
        state: "ยังไม่ได้ตั้งค่า (ค่าลับ)",
      },
    ]);
    expect(card.textContent).not.toMatch(/ตั้งค่าแล้ว/);
    expect(card.innerHTML).not.toContain(HEADER_ID);
  });

  it.each(["viewer", "auditor"] as const)(
    "shows %s the query parameters, body and assertions with the visibility warning",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      showDetail(
        detail({
          queryParams: [{ name: "region", value: "eu" }],
          body: { type: "json", content: '{"ping":true}' },
          assertions: [
            { kind: "jsonPathEquals", path: "$.status", expected: "ok" },
            { kind: "bodyContains", text: "ready" },
            { kind: "responseTimeBelow", ms: 800 },
          ],
        }),
      );
      renderDetail();
      await readyDetail();
      const card = screen.getByTestId("monitor-detail-config");
      expect(
        within(card)
          .getAllByTestId("monitor-config-query-param")
          .map((x) => x.textContent),
      ).toEqual(["region=eu"]);
      const body = within(card).getByTestId("monitor-config-body");
      expect(body).toHaveRole("group");
      expect(body).toHaveAccessibleName(/\S/);
      expect(body).toHaveAttribute("data-body-type", "json");
      expect(body.textContent).toBe('{"ping":true}');
      const pathValue: unknown = expect.stringMatching(/\$\.status = ok$/);
      const bodyValue: unknown = expect.stringMatching(/ready$/);
      const timingValue: unknown = expect.stringMatching(/800 ms$/);
      expect(
        within(card)
          .getAllByTestId("monitor-config-assertion")
          .map((row) => ({
            kind: row.getAttribute("data-kind"),
            text: row.textContent,
          })),
      ).toEqual([
        {
          kind: "jsonPathEquals",
          text: pathValue,
        },
        { kind: "bodyContains", text: bodyValue },
        { kind: "responseTimeBelow", text: timingValue },
      ]);
      expect(
        within(card).getByTestId("monitor-config-visibility-note"),
      ).toHaveTextContent(/\S/);
    },
  );

  it("shows no visibility warning when there are no query parameters or body", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-detail-config");
    expect(
      within(card).queryByTestId("monitor-config-visibility-note"),
    ).toBeNull();
  });

  it("keeps the monitor leaf active on the Detail path", () => {
    const leaf = {
      path: "/organizations/:organizationId/projects/:projectId/monitors",
    };
    expect(
      isLeafActive(
        leaf,
        `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
      ),
    ).toBe(true);
  });
});

describe("Detail Organization switch", () => {
  it("leaves the monitor for the new Organization's Projects without showing old data", async () => {
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    fetchListMock.mockResolvedValue({
      summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
      monitors: [],
      page: { limit: 25, offset: 0, total: 0 },
      dataAsOf: "2026-09-30T07:32:05.000Z",
    });
    showDetail(detail());
    const user = userEvent.setup();
    renderDetail();
    await readyDetail();
    await user.click(screen.getByTestId("detail-harness-switch"));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/projects`,
      );
    });
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
  });
});

function responseScope() {
  return within(screen.getByTestId("monitor-response-times"));
}
function responseElement(id: string) {
  return responseScope().getByTestId("monitor-response-" + id);
}
function chartTable() {
  const region = responseElement("table-region");
  expect(region).toHaveRole("region");
  return within(region).getByTestId("monitor-response-table");
}
function chartLiveRegion() {
  return responseElement("live");
}
function expectNoTableInDom() {
  expect(
    responseScope().queryByTestId("monitor-response-table-region"),
  ).toBeNull();
  expect(document.body.innerHTML).not.toMatch(/<table\b|role="table"/);
}
function expectNoChartInDom() {
  expect(responseScope().queryByTestId("monitor-response-chart")).toBeNull();
  expect(document.body.innerHTML).not.toContain("data-chart-part=");
}

function expectNoStateAttributes(toggle: HTMLElement) {
  for (const attribute of ["aria-expanded", "aria-controls", "aria-pressed"]) {
    expect(toggle).not.toHaveAttribute(attribute);
  }
}

const T = (time: string) => `2026-09-30T${time}:00.000Z`;
/** A time `minutes` after the start of the 24 h window that ends at the page's dataAsOf. */
const inWindow = (minutes: number) =>
  new Date(
    Date.parse(DATA_AS_OF) - 24 * 3_600_000 + minutes * 60_000,
  ).toISOString();

const responseTimes24h: MonitorResponseTimesResponse = {
  range: "24h",
  dataAsOf: DATA_AS_OF,
  window: { from: inWindow(0), to: DATA_AS_OF },
  unit: "ms",
  points: [
    { at: inWindow(3), responseTimeMs: 182, outcome: "pass" },
    { at: inWindow(8), responseTimeMs: 1204, outcome: "fail" },
    { at: inWindow(1437), responseTimeMs: 200, outcome: "pass" },
  ],
  gaps: [{ from: inWindow(10), to: inWindow(25) }],
  pauses: [{ from: inWindow(25), to: inWindow(40) }],
  configChanges: [
    { at: inWindow(5), urlChanged: true, url: "https://new.example" },
  ],
};

describe("Detail response-time chart", () => {
  const responseCard = () => screen.getByTestId("monitor-response-times");
  const rootChart = () =>
    within(responseCard()).getByTestId("monitor-response-chart");
  function responseTable() {
    const region = within(responseCard()).getByTestId(
      "monitor-response-table-region",
    );
    expect(region).toHaveRole("region");
    expect(region).toHaveAccessibleName(/\S/);
    expect(region).toHaveAttribute("tabindex", "0");
    const table = within(region).getByTestId("monitor-response-table");
    expect(table).toHaveRole("table");
    expect(table).toHaveAccessibleName(/ms/);
    return table;
  }
  function records() {
    const labels = new Map<string, string>();
    const rows = within(responseTable())
      .getAllByTestId("monitor-response-record")
      .map((row) => {
        const scope = within(row),
          time = scope.getByTestId("monitor-response-cell-time");
        expect(time).toHaveRole("rowheader");
        const kind = row.getAttribute("data-kind"),
          changeCount = Number(row.getAttribute("data-change-count")),
          noteCell = scope.getByTestId("monitor-response-cell-note"),
          label = noteCell.textContent.trim();
        expect(noteCell).toHaveRole("cell");
        const notePresent = kind !== "value" || changeCount > 0;
        if (notePresent) {
          expect(noteCell).toHaveTextContent(/\S/);
          const key = changeCount > 0 ? "url-change" : must(kind);
          labels.set(key, label);
        } else expect(noteCell).toBeEmptyDOMElement();
        return {
          changeCount,
          kind,
          at: Number(row.getAttribute("data-at")),
          end: Number(row.getAttribute("data-end")),
          checks: Number(row.getAttribute("data-checks")),
          time: time.textContent,
          average: scope.getByTestId("monitor-response-cell-average")
            .textContent,
          max:
            scope.queryByTestId("monitor-response-cell-max")?.textContent ??
            null,
          note: notePresent,
        };
      });
    expect(new Set(labels.values()).size).toBe(labels.size);
    return rows;
  }
  function record(
    kind: string,
    at: string,
    end: string,
    checks: number,
    average: string,
    max: string | null = null,
    note = false,
  ) {
    return {
      kind,
      changeCount: kind === "value" && note ? 1 : 0,
      at: Date.parse(at),
      end: Date.parse(end),
      checks,
      time: formatTime(at) + (end === at ? "" : "–" + formatTime(end)),
      average,
      max,
      note,
    };
  }
  const standardRecords = () => [
    record("value", inWindow(3), inWindow(3), 1, "182", null, true),
    record("value", inWindow(8), inWindow(8), 1, "1,204"),
    record("gap", inWindow(10), inWindow(25), 0, "–", null, true),
    record("pause", inWindow(25), inWindow(40), 0, "–", null, true),
    record("value", inWindow(1437), inWindow(1437), 1, "200"),
  ];
  function summaryNumbers() {
    const node = within(responseCard()).getByTestId("monitor-response-summary");
    expect(node).toHaveTextContent(/\S/);
    return (
      node.textContent
        .match(/\d[\d,]*(?:\.\d+)?/g)
        ?.map((x) => Number(x.replaceAll(",", ""))) ?? []
    );
  }
  function noTable() {
    expect(
      within(responseCard()).queryByTestId("monitor-response-table-region"),
    ).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/<table\b|role="table"/);
  }
  function noChart() {
    expect(
      within(responseCard()).queryByTestId("monitor-response-chart"),
    ).toBeNull();
    expect(
      within(responseCard()).queryByTestId("monitor-response-readout"),
    ).toBeNull();
    expect(document.body.innerHTML).not.toContain("data-chart-part=");
  }

  it("shows the empty state when there are no results", async () => {
    showDetail(detail({ lastCheckAt: null, lastResult: null }));
    renderDetail();
    await readyDetail();
    const card = responseCard();
    expect(
      await within(card).findByTestId("monitor-response-empty"),
    ).toBeInTheDocument();
    expect(within(card).queryByTestId("monitor-response-chart")).toBeNull();
    expect(card.innerHTML).not.toContain('role="group"');
    expect(within(card).getByTestId("monitor-response-empty")).toHaveAttribute(
      "data-last-check-at",
      "",
    );
    expect(
      within(card).queryByTestId("monitor-response-empty-time"),
    ).toBeNull();
    expect(within(card).queryByTestId("monitor-response-toggle")).toBeNull();
  });

  it("tells a monitor with no results in the window from one that was never checked", async () => {
    showDetail(detail({ lastCheckAt: "2026-09-28T07:30:00.000Z" }));
    renderDetail();
    await readyDetail();
    const card = responseCard();
    expect(
      await within(card).findByTestId("monitor-response-empty"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("monitor-response-empty-time"),
    ).toHaveAttribute("dateTime", "2026-09-28T07:30:00.000Z");
    expect(
      within(card).getByTestId("monitor-response-empty-time"),
    ).toHaveTextContent(formatDateTime("2026-09-28T07:30:00.000Z"));
  });

  it("says so when the whole window is paused", async () => {
    showDetail(detail({ status: "paused", health: "paused" }));
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      pauses: [{ from: inWindow(-60), to: DATA_AS_OF }],
    });
    const user = userEvent.setup();
    renderDetail();
    await readyDetail();
    const card = responseCard();
    expect(
      await within(card).findByTestId("monitor-response-summary"),
    ).toBeInTheDocument();
    expect(
      await within(card).findByTestId("monitor-response-chart"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("monitor-response-toggle"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("monitor-response-summary"),
    ).toHaveAttribute("data-paused", "true");
    await user.click(within(card).getByTestId("monitor-response-toggle"));
    expect(records()).toEqual([
      record("pause", inWindow(-60), DATA_AS_OF, 0, "–", null, true),
    ]);
  });

  it("says 'หยุดชั่วคราวตลอดช่วง' for a 7 d window paused from before its start until now", async () => {
    const asOf = Date.parse(DATA_AS_OF);
    const hour = 3_600_000;
    const start = Math.ceil((asOf - 7 * 24 * hour) / hour) * hour;
    showDetail(
      detail({ status: "paused", health: "paused", intervalSeconds: 900 }),
    );
    fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
      Promise.resolve(
        range === "24h"
          ? noResponseTimes
          : {
              range,
              dataAsOf: DATA_AS_OF,
              window: { from: new Date(start).toISOString(), to: DATA_AS_OF },
              summary: { p50Ms: null, p95Ms: null, checks: 0, failed: 0 },
              unit: "ms",
              buckets: Array.from(
                { length: Math.ceil((asOf - start) / hour) },
                (_, index) => ({
                  hourStart: new Date(start + index * hour).toISOString(),
                  avgMs: null,
                  maxMs: null,
                  checks: 0,
                  responseChecks: 0,
                }),
              ),
              pauses: [
                {
                  from: new Date(start - 2 * hour).toISOString(),
                  to: new Date(asOf + 2000).toISOString(),
                },
              ],
              configChanges: [],
            },
      ),
    );
    const user = userEvent.setup();
    renderDetail();
    await screen.findByTestId("monitor-response-range-7d");
    await user.click(screen.getByTestId("monitor-response-range-7d"));
    expect(
      await screen.findByTestId("monitor-response-summary"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(rootChart()).toHaveAttribute("data-range", "7d"),
    );
    expect(screen.getByTestId("monitor-response-summary")).toHaveAttribute(
      "data-paused",
      "true",
    );
    expect(
      within(responseCard()).queryByTestId("monitor-response-empty"),
    ).toBeNull();
    expect(screen.getByTestId("monitor-response-checks")).toHaveTextContent(
      /^0$/,
    );
    await user.click(
      within(responseCard()).getByTestId("monitor-response-toggle"),
    );
    expect(records()).toEqual([
      {
        changeCount: 0,
        kind: "pause",
        at: start,
        end: asOf,
        checks: 0,
        time:
          formatDateTime(new Date(start).toISOString()) +
          "–" +
          formatDateTime(DATA_AS_OF),
        average: "–",
        max: "–",
        note: true,
      },
    ]);
  });

  it("shows a monitor created 2 h ago without a gap before its creation", async () => {
    showDetail(detail({ createdAt: inWindow(24 * 60 - 120) }));
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [
        { at: inWindow(24 * 60 - 110), responseTimeMs: 100, outcome: "pass" },
        { at: inWindow(24 * 60 - 5), responseTimeMs: 110, outcome: "pass" },
      ],
    });
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByTestId("monitor-response-toggle"));
    const rows = records();
    expect(rows).toEqual([
      record("value", inWindow(1330), inWindow(1330), 1, "100"),
      record("value", inWindow(1435), inWindow(1435), 1, "110"),
    ]);
    expect(summaryNumbers()).toEqual([105, 110]);
  });

  it("draws the stretch from the last result up to now as no data for a stale monitor", async () => {
    showDetail(
      detail({
        health: "unknown",
        healthReason: "stale",
        lastCheckAt: inWindow(600),
      }),
    );
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [
        { at: inWindow(60), responseTimeMs: 150, outcome: "pass" },
        { at: inWindow(600), responseTimeMs: 160, outcome: "pass" },
      ],
    });
    const user = userEvent.setup();
    renderDetail();
    const button = await screen.findByTestId("monitor-response-toggle");
    await user.click(button);
    const rows = records();
    // Two results, then the gap from the last one to now (and one before the first).
    expect(rows).toEqual([
      record("gap", inWindow(0), inWindow(60), 0, "–", null, true),
      record("value", inWindow(60), inWindow(60), 1, "150"),
      record("value", inWindow(600), inWindow(600), 1, "160"),
      record("gap", inWindow(600), DATA_AS_OF, 0, "–", null, true),
    ]);
    expect(summaryNumbers()).toEqual([155, 160, 2, 900]);
  });

  it("loads the chart lazily with its unit, range, source and summary", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue(responseTimes24h);
    renderDetail();
    await readyDetail();
    const card = responseCard();
    expect(
      await within(card).findByTestId("monitor-response-chart"),
    ).toBeInTheDocument();
    expect(within(card).getByTestId("monitor-response-chart")).toHaveRole(
      "group",
    );
    expect(rootChart()).toHaveAccessibleName(/ms/);
    expect(rootChart()).toHaveAttribute("data-range", "24h");
    expect(summaryNumbers()).toEqual([529, 1204, 1, 15, 1]);
    expect(
      within(rootChart()).getByTestId("monitor-response-config-change"),
    ).toHaveAttribute("data-url-changed", "true");
    const bands = within(rootChart()).getAllByTestId("monitor-response-gap");
    expect(
      bands.map((band) => {
        expect(band).toBeVisible();
        expect(band.tagName).toBe("rect");
        return [
          Number(band.getAttribute("data-at")),
          Number(band.getAttribute("data-end")),
        ];
      }),
    ).toEqual([[Date.parse(inWindow(10)), Date.parse(inWindow(25))]]);
    expect(fetchResponseTimesMock).toHaveBeenCalledWith(
      A,
      P,
      MONITOR_ID,
      "24h",
    );
  });

  it("swaps the chart for the same data as a real table with one toggle that keeps focus", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue(responseTimes24h);
    const user = userEvent.setup();
    renderDetail();
    const toggle = await screen.findByTestId("monitor-response-toggle");
    const group = await screen.findByTestId("monitor-response-chart");
    expectNoStateAttributes(toggle);
    noTable();
    // AC-76: the keyboard hint stays off the accessibility tree and the polite region stays.
    expect(screen.getByTestId("monitor-response-readout")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("monitor-response-live")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(group).toHaveRole("group");
    expect(toggle).toHaveRole("button");
    const chartAction = toggle.textContent;
    group.focus();
    await user.keyboard("{Home}");
    expect(screen.getByTestId("monitor-response-readout")).toHaveTextContent(
      /182 ms/,
    );
    expect(screen.getByTestId("monitor-response-live")).toHaveTextContent(
      formatTime(inWindow(3)),
    );
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByTestId("monitor-response-readout")).toHaveAttribute(
      "data-selected-kind",
      "gap",
    );
    expect(
      screen.getByTestId("monitor-response-readout"),
    ).not.toHaveTextContent(/0 ms/);
    expect(screen.getByTestId("monitor-response-live")).toHaveTextContent(
      formatTime(inWindow(10)),
    );

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("data-view", "table");
    expect(toggle.textContent).not.toBe(chartAction);
    expect(toggle).toHaveFocus();
    expectNoStateAttributes(toggle);
    // The inactive view is unmounted, not hidden.
    noChart();
    expect(screen.queryByTestId("monitor-response-readout")).toBeNull();
    expect(document.body.innerHTML).not.toContain("data-chart-part=");
    const table = responseTable();
    expect(
      within(table).getByTestId("monitor-response-heading-average"),
    ).toHaveRole("columnheader");
    expect(
      within(table).getByTestId("monitor-response-heading-average"),
    ).toHaveTextContent(/ms/);
    expect(
      within(table).queryByTestId("monitor-response-heading-max"),
    ).toBeNull();
    expect(records()).toEqual(standardRecords());

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("data-view", "chart");
    expect(toggle.textContent).toBe(chartAction);
    expect(toggle).toHaveFocus();
    noTable();
    expect(rootChart()).toHaveRole("group");
    expect(screen.getByTestId("monitor-response-readout")).toBeInTheDocument();
  });

  it.each([
    ["7 วัน", "7d"],
    ["30 วัน", "30d"],
  ] as const)(
    "refetches for %s and labels the table with the range",
    async (_label, range) => {
      showDetail(detail());
      fetchResponseTimesMock.mockImplementation(
        (_org, _project, _id, requested) =>
          Promise.resolve(
            requested === "24h"
              ? responseTimes24h
              : {
                  range: requested,
                  dataAsOf: DATA_AS_OF,
                  window: { from: T("05:00"), to: DATA_AS_OF },
                  summary: { p50Ms: 100, p95Ms: 500, checks: 24, failed: 0 },
                  unit: "ms",
                  buckets: [
                    {
                      hourStart: T("05:00"),
                      avgMs: 100,
                      maxMs: 150,
                      checks: 12,
                      responseChecks: 12,
                    },
                    {
                      hourStart: T("06:00"),
                      avgMs: null,
                      maxMs: null,
                      checks: 0,
                      responseChecks: 0,
                    },
                    {
                      hourStart: T("07:00"),
                      avgMs: 300,
                      maxMs: 500,
                      checks: 12,
                      responseChecks: 12,
                    },
                  ],
                  pauses: [],
                  configChanges: [],
                },
          ),
      );
      const user = userEvent.setup();
      renderDetail();
      await screen.findByTestId("monitor-response-chart");
      await user.click(screen.getByTestId(`monitor-response-range-${range}`));
      await waitFor(() => {
        expect(fetchResponseTimesMock).toHaveBeenCalledWith(
          A,
          P,
          MONITOR_ID,
          range,
        );
      });
      await waitFor(() =>
        expect(rootChart()).toHaveAttribute("data-range", range),
      );
      expect(
        screen.getByTestId(`monitor-response-range-${range}`),
      ).toHaveAttribute("aria-checked", "true");
      await user.click(screen.getByTestId("monitor-response-toggle"));
      const table = responseTable();
      expect(summaryNumbers()).toEqual([200, 500, 1, 60]);
      expect(
        within(responseCard()).getByTestId("monitor-response-p50"),
      ).toHaveTextContent(/^100 ms$/);
      expect(
        within(responseCard()).getByTestId("monitor-response-p95"),
      ).toHaveTextContent(/^500 ms$/);
      expect(
        within(responseCard()).getByTestId("monitor-response-checks"),
      ).toHaveTextContent(/^24$/);
      expect(
        within(responseCard()).getByTestId("monitor-response-failed"),
      ).toHaveTextContent(/^0$/);
      expect(
        within(table).getByTestId("monitor-response-heading-average"),
      ).toHaveTextContent(/ms/);
      expect(
        within(table).getByTestId("monitor-response-heading-max"),
      ).toHaveTextContent(/ms/);
      const list = records();
      expect(
        list.map(({ kind, at, end, checks, average, max, note }) => ({
          kind,
          at,
          end,
          checks,
          average,
          max,
          note,
        })),
      ).toEqual([
        {
          kind: "value",
          at: Date.parse(T("05:00")),
          end: Date.parse(T("06:00")),
          checks: 12,
          average: "100",
          max: "150",
          note: false,
        },
        {
          kind: "gap",
          at: Date.parse(T("06:00")),
          end: Date.parse(T("07:00")),
          checks: 0,
          average: "–",
          max: "–",
          note: true,
        },
        {
          kind: "value",
          at: Date.parse(T("07:00")),
          end: Date.parse(DATA_AS_OF),
          checks: 12,
          average: "300",
          max: "500",
          note: false,
        },
      ]);
      expect(list.map((x) => x.time)).toEqual([
        formatDateTime(T("05:00")) + "–" + formatTime(T("06:00")),
        formatDateTime(T("06:00")) + "–" + formatTime(T("07:00")),
        formatDateTime(T("07:00")) + "–" + formatTime(DATA_AS_OF),
      ]);
    },
  );

  it("keeps a failing chart inside its card with a retry", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "x", 0),
    );
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => {
      const error = within(
        screen.getByTestId("monitor-response-times"),
      ).getByTestId("monitor-response-error");
      expect(error).toBeInTheDocument();
      expect(error).toHaveAttribute("role", "alert");
      expect(error).toHaveTextContent(/\S/);
      expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
        /^Payments API$/,
      );
    });
    fetchResponseTimesMock.mockResolvedValue(responseTimes24h);
    await user.click(
      within(screen.getByTestId("monitor-response-times")).getByTestId(
        "monitor-response-retry",
      ),
    );
    const chart = await within(
      screen.getByTestId("monitor-response-times"),
    ).findByTestId("monitor-response-chart");
    expect(chart).toHaveRole("group");
    expect(chart).toHaveAccessibleName(/ms/);
    expect(chart).toHaveAttribute("data-range", "24h");
    expect(chart).toHaveAttribute("tabindex", "0");
  });
});

describe("Detail redesign behaviours", () => {
  it("keeps the date in the header when the last check was on a previous day", async () => {
    showDetail(detail({ lastCheckAt: "2026-09-28T07:30:00.000Z" }));
    renderDetail();
    await readyDetail();
    const time = screen.getByTestId("monitor-detail-last-check");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2026-09-28T07:30:00.000Z");
    expect(time).toHaveTextContent(formatDateTime("2026-09-28T07:30:00.000Z"));
  });

  it("shows p50, p95, check count and failures for 24 h", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [
        {
          at: "2026-09-30T07:00:00.000Z",
          responseTimeMs: 100,
          outcome: "pass",
        },
        {
          at: "2026-09-30T07:05:00.000Z",
          responseTimeMs: 300,
          outcome: "pass",
        },
        {
          at: "2026-09-30T07:10:00.000Z",
          responseTimeMs: null,
          outcome: "fail",
        },
      ],
    });
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-response-times");
    const kpi = (key: string) =>
      within(card).getByTestId(`monitor-response-${key}`);
    await waitFor(() => {
      expect(kpi("checks")).toHaveTextContent(/^3$/);
    });
    expect(kpi("failed")).toHaveTextContent(/^1$/);
    expect(kpi("p50")).toHaveTextContent(/^100 ms$/);
    expect(kpi("p95")).toHaveTextContent(/^300 ms$/);
  });

  it("reads ไม่มีข้อมูล for p50 and p95 when no point has a response time", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [
        {
          at: "2026-09-30T07:00:00.000Z",
          responseTimeMs: null,
          outcome: "fail",
        },
      ],
    });
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-response-times");
    await waitFor(() => {
      expect(
        within(card).getByTestId("monitor-response-p50"),
      ).not.toHaveTextContent(/\d/);
    });
    expect(
      within(card).getByTestId("monitor-response-p95"),
    ).not.toHaveTextContent(/\d/);
    expect(within(card).getByTestId("monitor-response-p50")).toHaveTextContent(
      /\S/,
    );
    expect(within(card).getByTestId("monitor-response-p95")).toHaveTextContent(
      /\S/,
    );
    expect(
      within(card).getByTestId("monitor-response-checks"),
    ).toHaveTextContent(/^1$/);
    expect(
      within(card).getByTestId("monitor-response-failed"),
    ).toHaveTextContent(/^1$/);
  });

  it("shows four live KPIs without a percentile sample on 7 d", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
      Promise.resolve(
        range === "24h"
          ? noResponseTimes
          : {
              range,
              dataAsOf: DATA_AS_OF,
              window: { from: "2026-09-30T06:00:00.000Z", to: DATA_AS_OF },
              summary: { p50Ms: 100, p95Ms: 150, checks: 12, failed: 0 },
              unit: "ms",
              buckets: [
                {
                  hourStart: "2026-09-30T06:00:00.000Z",
                  avgMs: 100,
                  maxMs: 150,
                  checks: 12,
                  responseChecks: 12,
                },
              ],
              pauses: [],
              configChanges: [],
            },
      ),
    );
    const user = userEvent.setup();
    renderDetail();
    const range = await screen.findByTestId("monitor-response-range-7d");
    expect(range).toHaveRole("radio");
    await user.click(range);
    await readyDetail();
    const card = screen.getByTestId("monitor-response-times");
    await waitFor(() =>
      expect(
        within(card).getByTestId("monitor-response-p50"),
      ).toHaveTextContent(/^100 ms$/),
    );
    expect(within(card).getByTestId("monitor-response-p95")).toHaveTextContent(
      "150 ms",
    );
    expect(
      within(card).getByTestId("monitor-response-checks"),
    ).toHaveTextContent(/^12$/);
    expect(
      within(card).getByTestId("monitor-response-failed"),
    ).toHaveTextContent(/^0$/);
    expect(range).toHaveAttribute("aria-checked", "true");
    expect(fetchResponseTimesMock).toHaveBeenCalledWith(A, P, MONITOR_ID, "7d");
    for (const group of card.querySelectorAll('[role="group"]'))
      expect(group).not.toHaveAccessibleName(/^ตัวอย่าง: p50 p95/);
  });

  it("frames every sample region with its issue link", async () => {
    showDetail(detail());
    renderDetail();
    await readyDetail();
    const frame = within(screen.getByTestId("monitor-status")).getByTestId(
      "monitor-uptime-sample",
    );
    expect(frame).toHaveRole("group");
    expect(frame).toHaveAccessibleName(/^ตัวอย่าง:/);
    expect(frame.textContent).not.toMatch(/HTTP\/\d/);
    expect(frame.innerHTML).not.toMatch(/HTTP\/\d/);
    expect(within(frame).getByTestId("mockup-notice")).toHaveTextContent(/\S/);
    const issue = within(frame).getByTestId("mockup-issue");
    expect(issue).toHaveRole("link");
    expect(issue).toHaveAttribute(
      "href",
      "https://github.com/nixbpe/new-nightwatch/issues/56",
    );
    expect(issue).toHaveAttribute("target", "_blank");
    expect(issue).toHaveAttribute("rel", "noreferrer");
  });
});

function liveRange(
  range: "7d" | "30d",
  p50Ms = 20,
): Extract<MonitorResponseTimesResponse, { range: "7d" | "30d" }> {
  return {
    unit: "ms",
    dataAsOf: DATA_AS_OF,
    pauses: [],
    configChanges: [],
    range,
    window: {
      from:
        range === "7d"
          ? "2026-09-23T08:00:00.000Z"
          : "2026-08-31T08:00:00.000Z",
      to: DATA_AS_OF,
    },
    summary: { p50Ms, p95Ms: 40, checks: 4, failed: 1 },
    buckets: [
      {
        hourStart: "2026-09-30T07:00:00.000Z",
        avgMs: 25,
        maxMs: 40,
        checks: 4,
        responseChecks: 4,
      },
    ],
  };
}
function renderResponseCard(createdAt = "2026-09-01T00:00:00.000Z") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (organizationId = A, queryClient = client) => (
    <QueryClientProvider
      client={queryClient}
      key={queryClient === client ? "original" : "new-identity"}
    >
      <ResponseTimeCard
        organizationId={organizationId}
        projectId={P}
        monitorId={MONITOR_ID}
        lastCheckAt={DATA_AS_OF}
        intervalSeconds={300}
        createdAt={createdAt}
      />
    </QueryClientProvider>
  );
  return { client, view, ...render(view()) };
}
function expectKpis(
  values: [string | null, string | null, string | null, string | null],
) {
  function scalar(field: string, value: string | null) {
    const node = responseElement(field);
    if (value === null) {
      expect(node).toHaveAttribute("data-value-code", "");
      expect(node).toHaveTextContent(/\S/);
      expect(node).not.toHaveTextContent(/\d/);
    } else expect(node).toHaveTextContent(new RegExp("^" + value + "$"));
  }
  scalar("p50", values[0]);
  scalar("p95", values[1]);
  scalar("checks", values[2]);
  scalar("failed", values[3]);
}
function announcementNumbers(text: string) {
  return (
    text
      .replace(/p50|p95/g, "")
      .match(/\d[\d,]*(?:\.\d+)?/g)
      ?.map((x) => Number(x.replaceAll(",", ""))) ?? []
  );
}
function expectAnnouncement(range: "7d" | "30d", missing = false) {
  const node = screen.getByTestId("response-range-announcement");
  expect(node).toHaveAttribute("role", "status");
  expect(node).toHaveAttribute("aria-live", "polite");
  expect(announcementNumbers(node.textContent)).toEqual(
    missing
      ? [range === "7d" ? 7 : 30, 0, 0]
      : [range === "7d" ? 7 : 30, 20, 40, 4, 1],
  );
  if (missing)
    expect(node).toHaveTextContent(responseElement("p50").textContent);
}

describe("response-time state and selection", () => {
  it.each(["7d", "30d"] as const)(
    "shows the same literal four KPI values for %s, full bounds and keyboard table",
    async (range) => {
      fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
        Promise.resolve(
          range === "24h"
            ? {
                ...noResponseTimes,
                points: [10, 20, 30, 40].map((responseTimeMs, i) => ({
                  at: DATA_AS_OF,
                  responseTimeMs,
                  outcome: i === 1 ? "fail" : "pass",
                })),
              }
            : liveRange(range),
        ),
      );
      renderResponseCard();
      await waitFor(() => {
        expectKpis(["20 ms", "40 ms", "4", "1"]);
      });
      const user = userEvent.setup();
      const option = responseElement(`range-${range}`);
      option.focus();
      await user.keyboard(" ");
      await waitFor(() => {
        expectAnnouncement(range);
      });
      expectKpis(["20 ms", "40 ms", "4", "1"]);
      expect(option).toHaveFocus();
      expectCaption(range, { window: liveRange(range).window });
      expect(
        screen.getByTestId("monitor-response-times").innerHTML,
      ).not.toMatch(/<a\b/);
      const table = responseElement("toggle");
      table.focus();
      await user.keyboard("{Enter}");
      expect(chartTable()).toBeInTheDocument();
      expect(table).toHaveFocus();
    },
  );

  it("shows cap from points, not checks, and keeps measured system-error percentile", async () => {
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: Array.from({ length: 1440 }, () => ({
        at: DATA_AS_OF,
        outcome: "check_error",
        responseTimeMs: 0,
      })),
    });
    renderResponseCard();
    await waitFor(() => {
      expectKpis(["0 ms", "0 ms", "0", "0"]);
    });
    expect(responseElement("cap-note")).toBeInTheDocument();
    expect(responseElement("summary")).toBeInTheDocument();
    const user = userEvent.setup();
    (await responseScope().findByTestId("monitor-response-chart")).focus();
    await user.keyboard("{End}");
    expect(responseElement("readout")).toHaveAttribute(
      "data-selected-kind",
      "check-error",
    );
    expect(responseElement("live")).toHaveTextContent(formatTime(DATA_AS_OF));
    expect(responseElement("live")).not.toHaveTextContent(/\d+ ms/);
  });

  it("keeps timeout counts real while empty percentiles remain explicit", async () => {
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [
        { at: DATA_AS_OF, responseTimeMs: null, outcome: "fail" },
        { at: DATA_AS_OF, responseTimeMs: null, outcome: "fail" },
      ],
    });
    renderResponseCard();
    await waitFor(() => {
      expectKpis([null, null, "2", "2"]);
    });
    expect(responseElement("caption-population")).toHaveTextContent(/\S/);
    const user = userEvent.setup();
    (await responseScope().findByTestId("monitor-response-chart")).focus();
    await user.keyboard("{End}");
    expect(responseElement("readout")).toHaveAttribute(
      "data-selected-kind",
      "no-response",
    );
    expect(responseElement("live")).toHaveTextContent(formatTime(DATA_AS_OF));
    expect(responseElement("live")).not.toHaveTextContent(/\d+ ms/);
    await user.click(responseElement("toggle"));
    const expected = {
      kind: "no-response",
      at: Date.parse(DATA_AS_OF),
      end: Date.parse(DATA_AS_OF),
      checks: 1,
      time: formatTime(DATA_AS_OF),
      average: "–",
      max: null,
    };
    const rows = tableSteps();
    expect(
      rows.map(({ kind, at, end, checks, time, average, max }) => ({
        kind,
        at,
        end,
        checks,
        time,
        average,
        max,
      })),
    ).toEqual([
      {
        kind: "gap",
        at: Date.parse(noResponseTimes.window.from),
        end: Date.parse(DATA_AS_OF),
        checks: 0,
        time:
          formatTime(noResponseTimes.window.from) +
          "–" +
          formatTime(DATA_AS_OF),
        average: "–",
        max: null,
      },
      expected,
      expected,
    ]);
    for (const row of rows) expect(row.note).toMatch(/\S/);
  });

  it("hides previous KPIs during rapid selections, ignores late completion, announces latest once and never auto-refetch", async () => {
    const seven = deferred<MonitorResponseTimesResponse>();
    const thirty = deferred<MonitorResponseTimesResponse>();
    fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
      range === "24h"
        ? Promise.resolve(noResponseTimes)
        : range === "7d"
          ? seven.promise
          : thirty.promise,
    );
    renderResponseCard();
    await waitFor(() => {
      expectKpis([null, null, "0", "0"]);
    });
    const user = userEvent.setup();
    await user.click(responseElement("range-7d"));
    expect(responseElement("kpis-loading")).toBeInTheDocument();
    expect(responseScope().queryByTestId("monitor-response-p50")).toBeNull();
    await user.click(responseElement("range-30d"));
    const announcement = screen.getByTestId("response-range-announcement");
    const changes: string[] = [];
    const observer = new MutationObserver(() => {
      changes.push(announcement.textContent);
    });
    observer.observe(announcement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await act(() => {
      thirty.resolve(liveRange("30d"));
      return Promise.resolve();
    });
    await waitFor(() => {
      expectKpis(["20 ms", "40 ms", "4", "1"]);
    });
    await act(() => {
      seven.resolve(liveRange("7d", 700));
      return Promise.resolve();
    });
    expectKpis(["20 ms", "40 ms", "4", "1"]);
    fetchResponseTimesMock.mockResolvedValue(liveRange("30d", 30));
    await waitFor(() => {
      expectKpis(["30 ms", "40 ms", "4", "1"]);
    });
    expect(changes.map(announcementNumbers)).toEqual([[30, 20, 40, 4, 1]]);
    observer.disconnect();
    expect(responseElement("range-30d")).toHaveFocus();
  });

  it("keeps only same-key data on refetch error with its response timestamp and working retry", async () => {
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      dataAsOf: "2026-09-30T07:31:01.123Z",
      points: [{ at: DATA_AS_OF, responseTimeMs: 10, outcome: "pass" }],
    });
    const { client } = renderResponseCard();
    await waitFor(() => {
      expectKpis(["10 ms", "10 ms", "1", "0"]);
    });
    fetchResponseTimesMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await client.refetchQueries({
        queryKey: monitorQueryKeys.responseTimes(A, P, MONITOR_ID, "24h"),
      });
    });
    expectKpis(["10 ms", "10 ms", "1", "0"]);
    const warning = await responseScope().findByTestId(
      "monitor-response-retained-warning",
    );
    expect(warning).toHaveRole("alert");
    expect(
      within(warning).getByTestId("monitor-response-retained-time"),
    ).toHaveAttribute("datetime", "2026-09-30T07:31:01.123Z");
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [{ at: DATA_AS_OF, responseTimeMs: 40, outcome: "pass" }],
    });
    await userEvent.setup().click(responseElement("retained-retry"));
    await waitFor(() => {
      expectKpis(["40 ms", "40 ms", "1", "0"]);
    });
    expect(
      responseScope().queryByTestId("monitor-response-retained-warning"),
    ).toBeNull();
    expect(
      screen.getByTestId("response-range-announcement"),
    ).toBeEmptyDOMElement();
  });

  it.each(["MEMBERSHIP_DENIED", "PERMISSION_DENIED", "MONITOR_NOT_FOUND"])(
    "prioritizes %s over stale success",
    async (code) => {
      fetchResponseTimesMock.mockResolvedValue({
        ...noResponseTimes,
        points: [{ at: DATA_AS_OF, responseTimeMs: 987, outcome: "pass" }],
      });
      const { client } = renderResponseCard();
      await waitFor(() => {
        expectKpis(["987 ms", "987 ms", "1", "0"]);
      });
      fetchResponseTimesMock.mockRejectedValue(
        new ApiError(code, "denied", code === "MONITOR_NOT_FOUND" ? 404 : 403),
      );
      await act(async () => {
        await client.refetchQueries({
          queryKey: monitorQueryKeys.responseTimes(A, P, MONITOR_ID, "24h"),
        });
      });
      const denial = await responseScope().findByTestId(
        "monitor-response-denial",
      );
      expect(denial).toHaveRole("alert");
      expect(denial).toHaveTextContent(/\S/);
      expect(screen.getByTestId("monitor-response-times")).toHaveAttribute(
        code === "MONITOR_NOT_FOUND" ? "data-not-found" : "data-denied",
        "true",
      );
      expect(responseScope().queryByTestId("monitor-response-p50")).toBeNull();
      expect(document.body.textContent).not.toContain("987 ms");
      expect(document.body.innerHTML).not.toContain("987 ms");
      expect(
        responseScope().queryByTestId("monitor-response-chart"),
      ).toBeNull();
    },
  );

  it("does not expose old pending results after organization or identity-cache changes", async () => {
    const pending = deferred<MonitorResponseTimesResponse>();
    fetchResponseTimesMock.mockImplementation((org) =>
      org === A
        ? pending.promise
        : Promise.resolve({
            ...noResponseTimes,
            points: [{ at: DATA_AS_OF, responseTimeMs: 22, outcome: "pass" }],
          }),
    );
    const { client, rerender, view } = renderResponseCard();
    rerender(view(B));
    await waitFor(() => {
      expectKpis(["22 ms", "22 ms", "1", "0"]);
    });
    await act(() => {
      pending.resolve({
        ...noResponseTimes,
        points: [{ at: DATA_AS_OF, responseTimeMs: 999, outcome: "pass" }],
      });
      return Promise.resolve();
    });
    expectKpis(["22 ms", "22 ms", "1", "0"]);
    const oldIdentity = deferred<MonitorResponseTimesResponse>();
    fetchResponseTimesMock.mockReturnValue(oldIdentity.promise);
    const retiredRequest = client.refetchQueries({
      queryKey: monitorQueryKeys.responseTimes(B, P, MONITOR_ID, "24h"),
    });
    const newIdentity = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [{ at: DATA_AS_OF, responseTimeMs: 33, outcome: "pass" }],
    });
    rerender(view(B, newIdentity));
    await waitFor(() => {
      expectKpis(["33 ms", "33 ms", "1", "0"]);
    });
    await act(async () => {
      oldIdentity.resolve({
        ...noResponseTimes,
        points: [{ at: DATA_AS_OF, responseTimeMs: 888, outcome: "pass" }],
      });
      await retiredRequest;
    });
    expectKpis(["33 ms", "33 ms", "1", "0"]);
    expect(document.body.textContent).not.toContain("888 ms");
    expect(document.body.innerHTML).not.toContain("888 ms");
    expect(document.body.textContent).not.toContain("999 ms");
    expect(document.body.innerHTML).not.toContain("999 ms");
  });
});

function captionElement() {
  return responseElement("caption");
}
function expectCaption(
  range: "24h" | "7d" | "30d",
  options: { window?: { from: string; to: string }; capped?: boolean } = {},
) {
  const caption = captionElement();
  expect(caption).toHaveAttribute("data-range", range);
  const c = within(caption);
  expect(c.getByTestId("monitor-response-caption-unit")).toHaveTextContent(
    /ms/,
  );
  expect(c.getByTestId("monitor-response-caption-range")).toHaveTextContent(
    /\S/,
  );
  expect(c.getByTestId("monitor-response-caption-source")).toHaveTextContent(
    /\S/,
  );
  expect(
    c.getByTestId("monitor-response-caption-population"),
  ).toHaveTextContent(/\S/);
  if (options.window) {
    const bounds = c.getByTestId("monitor-response-caption-window");
    expect(bounds).toHaveAttribute("data-time-zone", TIME_ZONE);
    expect(bounds).toHaveTextContent(TIME_ZONE);
    const format = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const from = c.getByTestId("monitor-response-window-from"),
      to = c.getByTestId("monitor-response-window-to");
    expect(from).toHaveAttribute("datetime", options.window.from);
    expect(to).toHaveAttribute("datetime", options.window.to);
    expect(from).toHaveTextContent(
      format.format(new Date(options.window.from)),
    );
    expect(to).toHaveTextContent(format.format(new Date(options.window.to)));
  } else expect(c.queryByTestId("monitor-response-caption-window")).toBeNull();
  const cap = c.queryByTestId("monitor-response-cap-note");
  if (options.capped) {
    expect(cap).toHaveTextContent(/1,440/);
    expect(cap).toHaveAttribute("data-count", "1440");
  } else expect(cap).toBeNull();
  expect(
    caption.contains(screen.getByTestId("response-range-announcement")),
  ).toBe(false);
}

const points = (count: number) =>
  Array.from({ length: count }, () => ({
    at: DATA_AS_OF,
    responseTimeMs: 20,
    outcome: "pass" as const,
  }));

describe("response-time caption (AC-75)", () => {
  it("shows unit, range, source, time zone and the population before any data arrives", () => {
    fetchResponseTimesMock.mockReturnValue(
      deferred<MonitorResponseTimesResponse>().promise,
    );
    renderResponseCard();
    expectCaption("24h");
  });

  it.each([
    ["3 results", 3, false],
    ["1,439 results, one below the cap", 1439, false],
    ["1,440 results, at the cap", 1440, true],
  ])(
    "adds the window bounds for 24 h with %s, and the cap only at 1,440",
    async (_name, count, capped) => {
      fetchResponseTimesMock.mockResolvedValue({
        ...noResponseTimes,
        points: points(count),
      });
      renderResponseCard();
      await waitFor(() => {
        expectKpis([
          "20 ms",
          "20 ms",
          String(count).replace(/(\d)(?=(\d{3})$)/, "$1,"),
          "0",
        ]);
      });
      expectCaption("24h", { window: noResponseTimes.window, capped });
    },
  );

  it.each(["7d", "30d"] as const)(
    "adds the window bounds and the UTC-hour note for %s but never the cap",
    async (range) => {
      fetchResponseTimesMock.mockImplementation(
        (_org, _project, _id, requested) =>
          Promise.resolve(
            requested === "24h" ? noResponseTimes : liveRange(requested),
          ),
      );
      renderResponseCard();
      await waitFor(() => {
        expectKpis([null, null, "0", "0"]);
      });
      const user = userEvent.setup();
      await user.click(responseElement(`range-${range}`));
      await waitFor(() => {
        expectKpis(["20 ms", "40 ms", "4", "1"]);
      });
      expectCaption(range, { window: liveRange(range).window });
    },
  );

  it.each([
    ["a failed load", new Error("offline")],
    ["a denied read", new ApiError("MEMBERSHIP_DENIED", "denied", 403)],
    ["a missing monitor", new ApiError("MONITOR_NOT_FOUND", "not found", 404)],
  ])(
    "keeps unit, range, source, time zone and population after %s",
    async (_name, error) => {
      fetchResponseTimesMock.mockRejectedValue(error);
      renderResponseCard();
      await waitFor(() => {
        expect(
          responseScope().queryByTestId("monitor-response-kpis-loading"),
        ).toBeNull();
      });
      expectCaption("24h");
    },
  );

  it("keeps the bounds and the cap of the last good response while a refetch fails", async () => {
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: points(1440),
    });
    const { client } = renderResponseCard();
    await waitFor(() => {
      expectKpis(["20 ms", "20 ms", "1,440", "0"]);
    });
    fetchResponseTimesMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await client.refetchQueries({
        queryKey: monitorQueryKeys.responseTimes(A, P, MONITOR_ID, "24h"),
      });
    });
    await responseScope().findByTestId("monitor-response-retained-warning");
    expectCaption("24h", { window: noResponseTimes.window, capped: true });
  });
});

const hourlyRange = (
  range: "7d" | "30d",
): Extract<MonitorResponseTimesResponse, { range: "7d" | "30d" }> => ({
  ...liveRange(range),
  window: { from: T("05:00"), to: DATA_AS_OF },
  buckets: [
    {
      hourStart: T("05:00"),
      avgMs: 100,
      maxMs: 150,
      checks: 12,
      responseChecks: 12,
    },
    {
      hourStart: T("06:00"),
      avgMs: null,
      maxMs: null,
      checks: 0,
      responseChecks: 0,
    },
    {
      hourStart: T("07:00"),
      avgMs: 300,
      maxMs: 500,
      checks: 12,
      responseChecks: 12,
    },
  ],
});

async function chartSteps(
  user: ReturnType<typeof userEvent.setup>,
  count: number,
) {
  responseElement("chart").focus();
  const live = chartLiveRegion(),
    steps = [];
  for (let step = 0; step < count; step++) {
    await user.keyboard(step === 0 ? "{Home}" : "{ArrowRight}");
    const readout = responseElement("readout");
    steps.push({
      kind: readout.getAttribute("data-selected-kind"),
      at: Number(readout.getAttribute("data-selected-at")),
      text: live.textContent,
    });
  }
  return steps;
}
function tableSteps() {
  return within(chartTable())
    .getAllByTestId("monitor-response-record")
    .map((row) => {
      const scope = within(row);
      return {
        kind: row.getAttribute("data-kind"),
        at: Number(row.getAttribute("data-at")),
        end: Number(row.getAttribute("data-end")),
        checks: Number(row.getAttribute("data-checks")),
        time: scope.getByTestId("monitor-response-cell-time").textContent,
        average: scope.getByTestId("monitor-response-cell-average").textContent,
        max:
          scope.queryByTestId("monitor-response-cell-max")?.textContent ?? null,
        note: scope.getByTestId("monitor-response-cell-note").textContent,
      };
    });
}
function expectSameSteps(
  steps: Awaited<ReturnType<typeof chartSteps>>,
  rows: ReturnType<typeof tableSteps>,
  hourly: boolean,
) {
  expect(rows).toHaveLength(steps.length);
  const notes = new Map<string, string>();
  rows.forEach((row, index) => {
    const step = must(steps[index]);
    expect(step.kind).toBe(row.kind);
    expect(step.at).toBe(row.at);
    expect(step.text.startsWith(row.time)).toBe(true);
    if (row.average === "–") {
      expect(step.text).not.toMatch(/\d+ ms/);
      expect(step.text.length).toBeGreaterThan(row.time.length);
      expect(row.note).toMatch(/\S/);
      notes.set(must(row.kind), row.note);
    } else {
      expect(step.text).toContain(row.average + " ms");
      if (hourly) expect(step.text).toContain(must(row.max) + " ms");
    }
  });
  expect(new Set(notes.values()).size).toBe(notes.size);
}

describe("response-time view toggle (AC-76, AC-77)", () => {
  function mockRanges() {
    fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
      Promise.resolve(range === "24h" ? responseTimes24h : hourlyRange(range)),
    );
  }

  it("keeps the chosen view across 24 h, 7 d and 30 d and lists the same steps in both views", async () => {
    mockRanges();
    const user = userEvent.setup();
    renderResponseCard();
    const toggle = await responseScope().findByTestId(
      "monitor-response-toggle",
    );

    // 24 h: chart first, then the table.
    const steps24 = await chartSteps(user, 5);
    await user.click(toggle);
    expectSameSteps(steps24, tableSteps(), false);

    // The view does not follow the range: 7 d opens in the table the user chose.
    await user.click(responseElement("range-7d"));
    expect(
      await responseScope().findByTestId("monitor-response-toggle"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(responseElement("table-region")).toHaveAttribute(
        "data-range",
        "7d",
      ),
    );
    expect(responseScope().queryByTestId("monitor-response-chart")).toBeNull();
    const rows7 = tableSteps();
    await user.click(responseElement("toggle"));
    expectSameSteps(await chartSteps(user, 3), rows7, true);

    // The range does not follow the view: 30 d opens in the chart.
    await user.click(responseElement("range-30d"));
    expect(
      await responseScope().findByTestId("monitor-response-chart"),
    ).toBeInTheDocument();
    expectNoTableInDom();
    const steps30 = await chartSteps(user, 3);
    await user.click(responseElement("toggle"));
    expect(responseElement("table-region")).toHaveAttribute(
      "data-range",
      "30d",
    );
    expectSameSteps(steps30, tableSteps(), true);
    expect(responseElement("range-30d")).toBeChecked();

    // Back to 24 h from the table: the range changes, the view stays.
    await user.click(responseElement("range-24h"));
    expect(
      await responseScope().findByTestId("monitor-response-toggle"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(responseElement("table-region")).toHaveAttribute(
        "data-range",
        "24h",
      ),
    );
  });

  it("keeps the toggle and the range control in place and leaves KPIs, summary, caption and announcement mounted", async () => {
    mockRanges();
    const user = userEvent.setup();
    const { client } = renderResponseCard();
    const toggle = await responseScope().findByTestId(
      "monitor-response-toggle",
    );
    const range = responseElement("range-controls");
    const kpis = responseElement("kpis");
    const summary = responseElement("summary");
    const caption = captionElement();
    const announcement = screen.getByTestId("response-range-announcement");
    fetchResponseTimesMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await client.refetchQueries({
        queryKey: monitorQueryKeys.responseTimes(A, P, MONITOR_ID, "24h"),
      });
    });
    const warning = await responseScope().findByTestId(
      "monitor-response-retained-warning",
    );

    for (const view of ["table", "chart"] as const) {
      await user.click(responseElement("toggle"));
      expect(responseElement("toggle")).toBe(toggle);
      expect(toggle).toHaveAttribute("data-view", view);
      expect(responseElement("range-controls")).toBe(range);
      expect(responseElement("kpis")).toBe(kpis);
      expect(responseElement("summary")).toBe(summary);
      expect(captionElement()).toBe(caption);
      expect(screen.getByTestId("response-range-announcement")).toBe(
        announcement,
      );
      expect(responseElement("retained-warning")).toBe(warning);
    }
  });

  it("announces the range from its own element in the chart view and in the table view", async () => {
    fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
      Promise.resolve(range === "24h" ? noResponseTimes : liveRange(range)),
    );
    const user = userEvent.setup();
    renderResponseCard();
    const announcement = screen.getByTestId("response-range-announcement");
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(captionElement().contains(announcement)).toBe(false);

    await user.click(
      await responseScope().findByTestId("monitor-response-range-7d"),
    );
    await user.click(
      await responseScope().findByTestId("monitor-response-toggle"),
    );
    await waitFor(() => {
      expectAnnouncement("7d");
    });
    expect(chartTable()).toBeInTheDocument();

    await user.click(responseElement("range-30d"));
    await waitFor(() => {
      expectAnnouncement("30d");
    });
    expect(screen.getByTestId("response-range-announcement")).toBe(
      announcement,
    );
    expect(chartTable()).toBeInTheDocument();

    await user.click(responseElement("toggle"));
    await user.click(responseElement("range-7d"));
    await waitFor(() => {
      expectAnnouncement("7d");
    });
    expect(responseElement("chart")).toBeInTheDocument();
  });
});

describe("response-time data notes in both views", () => {
  const OLD = "2026-09-01T00:00:00.000Z";
  const young24h: MonitorResponseTimesResponse = {
    ...noResponseTimes,
    points: [
      { at: inWindow(1330), responseTimeMs: 100, outcome: "pass" },
      { at: inWindow(1435), responseTimeMs: 120, outcome: "pass" },
    ],
  };

  it.each([
    ["24h", "an old monitor", OLD, false, false],
    ["24h", "a monitor created 2 h ago", inWindow(1320), true, false],
    ["7d", "an old monitor", OLD, false, true],
    ["30d", "an old monitor", OLD, false, true],
    ["7d", "a monitor created inside the window", T("06:00"), true, true],
  ] as const)(
    "shows each note once, with the same copy, in the chart and the table for %s of %s",
    async (range, _monitor, createdAt, clamped, hourly) => {
      fetchResponseTimesMock.mockImplementation(
        (_org, _project, _id, requested) =>
          Promise.resolve(
            requested === "24h" ? young24h : hourlyRange(requested),
          ),
      );
      const user = userEvent.setup();
      renderResponseCard(createdAt);
      if (range !== "24h") {
        await user.click(
          await responseScope().findByTestId(`monitor-response-range-${range}`),
        );
      }
      const toggle = await responseScope().findByTestId(
        "monitor-response-toggle",
      );
      const chartRoot = responseElement("chart");
      expect(chartRoot).toHaveAttribute("data-range", range);
      function expected(
        kind: string,
        from: string,
        to: string,
        checks: number,
        average: string,
        max: string | null,
      ) {
        return {
          kind,
          at: Date.parse(from),
          end: Date.parse(to),
          checks,
          time:
            (hourly ? formatDateTime(from) : formatTime(from)) +
            (from === to ? "" : "–" + formatTime(to)),
          average,
          max,
        };
      }
      const expectedRows = hourly
        ? [
            ...(clamped
              ? []
              : [expected("value", T("05:00"), T("06:00"), 12, "100", "150")]),
            expected("gap", T("06:00"), T("07:00"), 0, "–", "–"),
            expected("value", T("07:00"), DATA_AS_OF, 12, "300", "500"),
          ]
        : [
            ...(clamped
              ? []
              : [expected("gap", inWindow(0), inWindow(1330), 0, "–", null)]),
            expected("value", inWindow(1330), inWindow(1330), 1, "100", null),
            expected("value", inWindow(1435), inWindow(1435), 1, "120", null),
          ];
      const selectedSteps = await chartSteps(user, expectedRows.length);
      const clampNotes = responseScope().queryAllByTestId(
        "monitor-response-clamp-note",
      );
      const hourlyNotes = responseScope().queryAllByTestId(
        "monitor-response-hourly-note",
      );
      expect(clampNotes).toHaveLength(clamped ? 1 : 0);
      expect(hourlyNotes).toHaveLength(hourly ? 1 : 0);
      // The chart component no longer owns them, so the swap cannot take them away.
      for (const note of [...clampNotes, ...hourlyNotes]) {
        expect(note).toHaveTextContent(/\S/);
        expect(chartRoot.contains(note)).toBe(false);
      }

      await user.click(toggle);
      expectNoChartInDom();
      expect(chartTable()).toBeInTheDocument();
      const renderedRows = tableSteps();
      expect(
        renderedRows.map(({ kind, at, end, checks, time, average, max }) => ({
          kind,
          at,
          end,
          checks,
          time,
          average,
          max,
        })),
      ).toEqual(expectedRows);
      expectSameSteps(selectedSteps, renderedRows, hourly);
      expect(
        responseScope().queryAllByTestId("monitor-response-clamp-note"),
      ).toEqual(clampNotes);
      expect(
        responseScope().queryAllByTestId("monitor-response-hourly-note"),
      ).toEqual(hourlyNotes);
    },
  );
});

it("announces an empty latest selection once after failed load and retry, without moving focus", async () => {
  fetchResponseTimesMock.mockImplementation((_org, _project, _id, range) =>
    range === "24h"
      ? Promise.resolve(noResponseTimes)
      : Promise.reject(new Error("offline")),
  );
  renderResponseCard();
  await waitFor(() => {
    expectKpis([null, null, "0", "0"]);
  });
  const user = userEvent.setup();
  const radio = responseElement("range-7d");
  await user.click(radio);
  await responseScope().findByTestId("monitor-response-error");
  expect(responseScope().queryByTestId("monitor-response-p50")).toBeNull();
  expect(
    screen.getByTestId("response-range-announcement"),
  ).toBeEmptyDOMElement();
  expect(radio).toHaveFocus();
  fetchResponseTimesMock.mockResolvedValue({
    ...liveRange("7d"),
    buckets: [],
    summary: { p50Ms: null, p95Ms: null, checks: 0, failed: 0 },
  });
  const retry = responseElement("retry");
  retry.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => {
    expectKpis([null, null, "0", "0"]);
  });
  expect(responseElement("empty")).toHaveTextContent(/\S/);
  expect(responseElement("empty-time")).toHaveAttribute("datetime", DATA_AS_OF);
  expectAnnouncement("7d", true);
});

it.each(["owner", "admin", "viewer", "auditor"] as const)(
  "allows %s to read actual response KPIs",
  async (role) => {
    fetchMeContextMock.mockResolvedValue(context(role));
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [{ at: DATA_AS_OF, responseTimeMs: 20, outcome: "fail" }],
    });
    renderDetail();
    await readyDetail();
    const card = screen.getByTestId("monitor-response-times");
    await waitFor(() =>
      expect(
        within(card).getByTestId("monitor-response-p50"),
      ).toHaveTextContent("20 ms"),
    );
    expect(
      within(card).getByTestId("monitor-response-failed"),
    ).toHaveTextContent("1");
    if (role === "viewer" || role === "auditor")
      expect(screen.queryByTestId("monitor-detail-edit")).toBeNull();
  },
);

describe("A Project that is gone after Detail loaded", () => {
  it("replaces the monitor and its actions with the not-found state", async () => {
    showDetail(detail());
    const { queryClient } = renderDetail();
    await readyDetail();
    vi.mocked(fetchProjectDetail).mockRejectedValue(
      new ApiError("PROJECT_NOT_FOUND", "not found", 404),
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.detail(A, P),
      });
    });
    expect(
      await screen.findByTestId("monitor-detail-not-found"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-detail-toggle")).toBeNull();
    expect(document.body.textContent).not.toContain("Payments API");
  });
});
