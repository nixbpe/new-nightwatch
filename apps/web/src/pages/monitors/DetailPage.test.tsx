import type {
  CheckResultView,
  Monitor,
  MonitorChecksResponse,
  MonitorResponseTimesResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLeafActive } from "../../components/shell/nav-config";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
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
  sectionOf,
} from "./detail-test-support";
import { ResponseTimeCard } from "./detail/ResponseTimeCard";
import { formatDateTime, formatTime } from "./format";
import { deferred } from "./form-test-support";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
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
  vi.useRealTimers();
  vi.resetAllMocks();
});

function showDetail(monitor: Monitor) {
  fetchDetailMock.mockResolvedValue({ monitor });
}

const notFound = () => new ApiError("MONITOR_NOT_FOUND", "not found", 404);

describe("Detail health and special states", () => {
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
    expect(
      await screen.findByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("ล่ม").length).toBeGreaterThan(0);
    expect(screen.getByText(/ตั้งแต่/)).toHaveTextContent("12 นาที");
    expect(screen.getByText(/^สาเหตุ /)).toHaveTextContent(/คาดหวัง 200-299/);
    expect(
      screen.getByRole("link", { name: "ดูการแจ้งเตือน" }),
    ).toHaveAttribute("href", "/notifications");
    // The duration changes every poll, so no assertive live region may hold it.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByText("กำลังเกิดอยู่")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่สิ้นสุด")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument();
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
    expect(
      await screen.findByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^สาเหตุ /)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ดูการแจ้งเตือน" })).toBeNull();
  });

  it("shows one failure as a warning beside an unchanged health", async () => {
    showDetail(detail({ consecutiveFailures: 1 }));
    renderDetail();
    expect(await screen.findByText(/ล้มเหลว 1 ครั้ง/)).toHaveTextContent(
      "จะเปลี่ยนเป็นล่มเมื่อล้มเหลวติดกันครบ 2 ครั้ง",
    );
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
    expect(await screen.findAllByText("รอตรวจครั้งแรก")).not.toHaveLength(0);
    expect(screen.getAllByText("ไม่ทราบสถานะ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ยังไม่มีข้อมูล")).toHaveLength(4);
    expect(screen.getByText("ยังไม่มีผลการตรวจ")).toBeInTheDocument();
    expect(
      await screen.findByText("ไม่มีเหตุการณ์ล่มในช่วงที่มีข้อมูล"),
    ).toBeInTheDocument();
    expect(screen.queryByText("ปกติ")).toBeNull();
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
    const alert = await screen.findByText(/^แก้ไขเมื่อ/);
    expect(alert).toHaveTextContent(formatTime("2026-09-30T07:40:00.000Z"));
    expect(alert).toHaveTextContent("รอผลตรวจตามค่าใหม่");
    expect(alert).toHaveTextContent("ล่าสุดทราบว่าล่ม");
    expect(screen.getAllByText("รอตรวจตามค่าใหม่").length).toBeGreaterThan(0);
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
    expect(
      (await screen.findAllByText("ตรวจไม่ได้ (ปัญหาฝั่งระบบ)")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("ตรวจไม่ได้")).toBeInTheDocument();
    expect(screen.queryByText("ปกติ")).toBeNull();
    expect(screen.queryByText("ล่ม")).toBeNull();
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
    expect(
      await screen.findByText(
        "ยังไม่มีผลตรวจใหม่ ข้อมูลอาจไม่ตรงกับสถานะปัจจุบัน",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/ไม่มีผลใหม่ตั้งแต่/)).toBeInTheDocument();
  });

  it("shows a paused monitor with an info alert and no healthy tone", async () => {
    showDetail(detail({ status: "paused", health: "paused" }));
    renderDetail();
    expect(
      await screen.findByText("มอนิเตอร์นี้หยุดตรวจอยู่ จะไม่มีการแจ้งเตือน"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("หยุดชั่วคราว").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "เริ่มต่อ" }),
    ).toBeInTheDocument();
  });

  it("gives only a healthy monitor the primary tone and check icon", async () => {
    showDetail(detail({ status: "paused", health: "paused" }));
    const { unmount } = renderDetail();
    const pill = must(
      must((await screen.findAllByText("หยุดชั่วคราว"))[0]).closest(
        "[data-slot=status-pill]",
      ),
    );
    expect(pill.querySelector("svg")).toBeNull();
    expect(pill.className).not.toContain("text-primary");
    unmount();

    showDetail(detail());
    renderDetail();
    const up = must(
      must((await screen.findAllByText("ปกติ"))[0]).closest(
        "[data-slot=status-pill]",
      ),
    );
    expect(up.querySelector("svg")).not.toBeNull();
  });
});

describe("Detail SSL card", () => {
  const cases: [string, Partial<Monitor["ssl"]>, string[]][] = [
    [
      "ok",
      { state: "ok", daysRemaining: 128 },
      ["เหลือ 128 วัน", "Example CA"],
    ],
    [
      "caution",
      { state: "caution", daysRemaining: 21 },
      ["ใกล้หมดอายุ เหลือ 21 วัน", "Example CA"],
    ],
    [
      "danger",
      { state: "danger", daysRemaining: 5 },
      ["หมดอายุใน 5 วัน", "Example CA"],
    ],
    [
      "expired with a date",
      { state: "expired", daysRemaining: -2 },
      ["หมดอายุแล้ว เมื่อ 2 วันก่อน", "Example CA"],
    ],
    [
      "expired without a date",
      {
        state: "expired",
        daysRemaining: null,
        notAfter: null,
        issuer: null,
        host: null,
      },
      ["หมดอายุแล้ว"],
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
      ["อ่านใบรับรองไม่ได้", "เหตุผล: ชื่อไม่ตรง"],
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
      ["ไม่ใช้ HTTPS", "มอนิเตอร์นี้ใช้ http ไม่มีข้อมูลใบรับรอง"],
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
      ["ยังไม่มีข้อมูล"],
    ],
  ];
  it.each(cases)("shows %s", async (_name, ssl, texts) => {
    showDetail(detail({ ssl: { ...detail().ssl, ...ssl } }));
    renderDetail();
    const card = sectionOf(await screen.findByRole("heading", { name: "SSL" }));
    for (const text of texts) {
      expect(
        within(card).getAllByText(new RegExp(text)).length,
      ).toBeGreaterThan(0);
    }
  });

  it.each([
    ["self_signed", "ใบรับรองลงนามเอง"],
    ["hostname_mismatch", "ชื่อไม่ตรง"],
    ["untrusted", "ไม่น่าเชื่อถือ"],
  ])(
    "says a readable but invalid certificate (%s) is invalid, in a warning tone",
    async (reason, wording) => {
      showDetail(
        detail({
          ssl: { ...detail().ssl, state: "ok", daysRemaining: 128, reason },
        }),
      );
      renderDetail();
      const card = sectionOf(
        await screen.findByRole("heading", { name: "SSL" }),
      );
      const line = within(card).getByText(/^ใบรับรองไม่ถูกต้อง/);
      expect(line).toHaveTextContent(`ใบรับรองไม่ถูกต้อง: ${wording}`);
      expect(line).toHaveClass("text-danger");
      // The days and dates of the certificate stay visible beside it.
      expect(within(card).getAllByText(/เหลือ 128 วัน/).length).toBeGreaterThan(
        0,
      );
    },
  );

  it("shows the host when it is known even without issuer or expiry", async () => {
    showDetail(
      detail({
        ssl: {
          ...detail().ssl,
          state: "unreadable",
          issuer: null,
          notAfter: null,
          daysRemaining: null,
          host: "api.acme.example",
        },
      }),
    );
    renderDetail();
    const card = sectionOf(await screen.findByRole("heading", { name: "SSL" }));
    expect(within(card).getByText("api.acme.example")).toBeInTheDocument();
  });

  it("lists issuer, host and expiry date of a readable certificate", async () => {
    showDetail(detail());
    renderDetail();
    const card = sectionOf(await screen.findByRole("heading", { name: "SSL" }));
    expect(within(card).getByText("Example CA")).toBeInTheDocument();
    expect(within(card).getByText("api.acme.example")).toBeInTheDocument();
    expect(card.querySelector("time")).toHaveAttribute(
      "datetime",
      "2027-02-05T00:00:00.000Z",
    );
  });
});

describe("Detail alerts card", () => {
  const alertsCard = async () =>
    sectionOf(await screen.findByRole("heading", { name: "การแจ้งเตือน" }));

  function orgRowValue(card: HTMLElement): HTMLElement {
    const dt = within(card).getByText("การแจ้งเตือนระดับองค์กร");
    return must(dt.nextElementSibling as HTMLElement | null);
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
    expect(within(card).getByText("3")).toBeInTheDocument();
    expect(within(card).getByText("ปิด")).toBeInTheDocument();
    expect(within(card).getByText(/เปิด \(ล่วงหน้า/)).toBeInTheDocument();
    expect(within(card).getByText("15")).toBeInTheDocument();
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
    expect(
      within(card).getByText("มอนิเตอร์นี้ใช้ http ไม่มีข้อมูลใบรับรอง"),
    ).toBeInTheDocument();
    expect(within(card).getByText(/เปิด \(ล่วงหน้า/)).toBeInTheDocument();
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
    expect(within(card).queryByText(/ล่วงหน้า/)).toBeNull();
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
        expect(orgRowValue(card)).toHaveTextContent("ปิด");
      });
      expect(
        await within(card).findByText(
          "ปิด การแจ้งเตือนของมอนิเตอร์นี้จะไม่ทำงานจนกว่าจะเปิด ส่วนสถานะล่มและการนับเกณฑ์ล้มเหลวยังทำงานตามปกติ",
        ),
      ).toBeInTheDocument();
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "hides organization monitor alert settings from %s without requesting them",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      showDetail(detail());
      renderDetail();
      const card = await alertsCard();
      expect(within(card).getByText("เกณฑ์ล้มเหลว")).toBeInTheDocument();
      expect(within(card).queryByText("การแจ้งเตือนระดับองค์กร")).toBeNull();
      await screen.findByText("ยังไม่มีเหตุการณ์ใน 30 วันล่าสุด");
      expect(fetchOrgAlertsMock).not.toHaveBeenCalled();
    },
  );

  it("shows a loading placeholder for organization monitor alerts, then เปิด when loading succeeds", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchOrgAlertsMock>>>();
    fetchOrgAlertsMock.mockReturnValue(pending.promise);
    showDetail(detail());
    renderDetail();
    const card = await alertsCard();
    expect(
      within(orgRowValue(card)).getByText("กำลังโหลดการตั้งค่าระดับองค์กร"),
    ).toBeInTheDocument();
    pending.resolve({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    await waitFor(() => {
      expect(orgRowValue(card)).toHaveTextContent("เปิด");
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
        within(orgRowValue(card)).getByText("โหลดไม่สำเร็จ"),
      ).toBeInTheDocument();
    });
    expect(orgRowValue(card)).not.toHaveTextContent("เปิด");
    fetchOrgAlertsMock.mockResolvedValue({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(card).getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => {
      expect(orgRowValue(card)).toHaveTextContent("เปิด");
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
      expect(orgRowValue(card)).toHaveTextContent("เปิด");
    });
    fetchOrgAlertsMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    await queryClient.refetchQueries({
      queryKey: ["tenant", "notification-settings", A],
    });
    await waitFor(() => {
      expect(orgRowValue(card)).toHaveTextContent("ไม่มีสิทธิ์ดูการตั้งค่านี้");
    });
    const calls = fetchOrgAlertsMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchOrgAlertsMock.mock.calls.length).toBe(calls);
  });
});

describe("Detail assertions", () => {
  it("words every row as ผ่าน, ไม่ผ่าน or ไม่ได้ประเมิน and labels a cut value", async () => {
    showDetail(
      detail({
        health: "down",
        assertions: [
          { kind: "jsonPathEquals", path: "$.status", expected: "ok" },
          { kind: "bodyContains", text: "ready" },
          { kind: "responseTimeBelow", ms: 800 },
        ],
        lastResult: {
          ...baseResult,
          outcome: "fail",
          httpStatus: 503,
          responseTimeMs: 1204,
          failureReason: "http_status",
          assertions: [
            {
              kind: "jsonPathEquals",
              expected: '"ok"',
              actual: '"degraded and a very long value"',
              actualType: "string",
              actualTruncated: true,
              status: "fail",
              reason: "value_mismatch",
            },
            {
              kind: "bodyContains",
              expected: "ready",
              actual: null,
              actualType: null,
              actualTruncated: false,
              status: "pass",
              reason: null,
            },
            {
              kind: "responseTimeBelow",
              expected: "800",
              actual: null,
              actualType: null,
              actualTruncated: false,
              status: "not_evaluated",
              reason: "no_response",
            },
          ],
        },
      }),
    );
    renderDetail();
    const table = await screen.findByRole("table", {
      name: "ผลการตรวจล่าสุดต่อเงื่อนไข",
    });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("รหัสสถานะ");
    expect(rows[0]).toHaveTextContent("503");
    expect(rows[0]).toHaveTextContent("ไม่ผ่าน");
    expect(rows[1]).toHaveTextContent("JSONPath เท่ากับ $.status");
    expect(rows[1]).toHaveTextContent("ตัดแล้ว");
    expect(rows[1]).toHaveTextContent("ไม่ผ่าน");
    expect(rows[2]).toHaveTextContent("ผ่าน");
    expect(rows[2]).not.toHaveTextContent("ไม่ผ่าน");
    expect(rows[3]).toHaveTextContent("ไม่ได้ประเมิน");
    expect(rows[3]).toHaveTextContent("800 ms");
    expect(within(table).getAllByText("ตัดแล้ว")).toHaveLength(1);
  });

  it("shows the status row as not evaluated when there was no response", async () => {
    showDetail(
      detail({
        health: "down",
        lastResult: {
          ...baseResult,
          outcome: "fail",
          httpStatus: null,
          responseTimeMs: null,
          failureReason: "tls_invalid",
          tlsReason: "expired",
        },
      }),
    );
    renderDetail();
    const table = await screen.findByRole("table", {
      name: "ผลการตรวจล่าสุดต่อเงื่อนไข",
    });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
      "ไม่ได้ประเมิน",
    );
    expect(
      screen.getByText("สาเหตุ ใบรับรองไม่ถูกต้อง: หมดอายุ"),
    ).toBeInTheDocument();
  });

  it("words a TLS handshake failure as a failed secure connection, not an invalid certificate", async () => {
    showDetail(
      detail({
        health: "down",
        lastResult: {
          ...baseResult,
          outcome: "fail",
          httpStatus: null,
          responseTimeMs: null,
          failureReason: "tls_invalid",
          tlsReason: "handshake_failed",
        },
      }),
    );
    renderDetail();
    expect(
      await screen.findByText("สาเหตุ เชื่อมต่อแบบปลอดภัยไม่สำเร็จ"),
    ).toBeInTheDocument();
  });

  it("shows the actual type of a type mismatch and the prefix label", async () => {
    showDetail(
      detail({
        assertions: [{ kind: "jsonPathEquals", path: "$.id", expected: "1" }],
        lastResult: {
          ...baseResult,
          outcome: "fail",
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
    const table = await screen.findByRole("table", {
      name: "ผลการตรวจล่าสุดต่อเงื่อนไข",
    });
    expect(
      within(table).getByText(/ชนิดข้อมูลไม่ตรง \(ค่าจริงเป็น string\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ประเมินจากส่วนต้นของ response"),
    ).toBeInTheDocument();
  });
});

function check(overrides: Partial<CheckResultView> = {}): CheckResultView {
  return { ...baseResult, ...overrides };
}

describe("Detail check history", () => {
  it("shows each check with its assertions and marks a URL change", async () => {
    showDetail(detail());
    const checks: MonitorChecksResponse = {
      checks: [
        check({
          scheduledFor: "2026-09-30T07:30:00.000Z",
          checkedAt: "2026-09-30T07:30:00.000Z",
          url: "https://new.acme.example/health",
          outcome: "fail",
          failureReason: "assertion_failed",
          assertions: [
            {
              kind: "bodyContains",
              expected: "ok",
              actual: null,
              actualType: null,
              actualTruncated: false,
              status: "fail",
              reason: "text_not_found",
            },
          ],
        }),
        check({
          scheduledFor: "2026-09-30T07:25:00.000Z",
          checkedAt: "2026-09-30T07:25:00.000Z",
          url: "https://api.acme.example/health",
        }),
      ],
      page: { limit: 20, offset: 0, total: 2 },
      urlChanges: [
        {
          at: "2026-09-30T07:28:00.000Z",
          url: "https://new.acme.example/health",
        },
      ],
    };
    fetchChecksMock.mockResolvedValue(checks);
    const user = userEvent.setup();
    renderDetail();
    const region = await screen.findByRole("region", {
      name: "ตารางประวัติการตรวจ",
    });
    // Only the history rows: the assertion tables inside them have rows of their own.
    const rows = Array.from(
      region.querySelectorAll<HTMLElement>(":scope > table > tbody > tr"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("เปลี่ยน URL");
    expect(rows[0]).toHaveTextContent("https://new.acme.example/health");
    expect(rows[0]).toHaveTextContent("ล้มเหลว");
    expect(rows[0]).toHaveTextContent("ไม่ผ่าน 1/1");
    expect(rows[1]).not.toHaveTextContent("เปลี่ยน URL");
    expect(
      screen.getByText(/เปลี่ยน URL เมื่อ/, { selector: "li" }),
    ).toHaveTextContent(formatDateTime("2026-09-30T07:28:00.000Z"));

    await user.click(within(must(rows[0])).getByText("ไม่ผ่าน 1/1"));
    expect(within(must(rows[0])).getByText("เนื้อหามีข้อความ")).toBeVisible();
  });

  it("keeps a failing history inside its card", async () => {
    showDetail(detail());
    fetchChecksMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    renderDetail();
    expect(
      await screen.findByText("โหลดประวัติการตรวจไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Payments API",
    );
    fetchChecksMock.mockResolvedValue(noChecks);
    const card = sectionOf(
      screen.getByRole("heading", { name: "ประวัติการตรวจ" }),
    );
    await userEvent
      .setup()
      .click(within(card).getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await within(card).findByText("ยังไม่มีผลการตรวจ"),
    ).toBeInTheDocument();
  });
});

describe("Detail access", () => {
  it.each(["viewer", "auditor"] as const)(
    "shows %s the page without any edit, pause, resume or delete control",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      showDetail(detail());
      renderDetail();
      await screen.findByRole("heading", { level: 1, name: "Payments API" });
      expect(
        screen.getByText("สิทธิ์ของคุณ: ดูอย่างเดียว"),
      ).toBeInTheDocument();
      for (const name of ["แก้ไข", "หยุดชั่วคราว", "เริ่มต่อ", "ลบมอนิเตอร์"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
        expect(screen.queryByRole("link", { name })).toBeNull();
      }
    },
  );

  it("gives owner and admin the edit link, pause and delete", async () => {
    fetchMeContextMock.mockResolvedValue(context("admin"));
    showDetail(detail());
    renderDetail();
    expect(await screen.findByRole("link", { name: "แก้ไข" })).toHaveAttribute(
      "href",
      `/organizations/${A}/monitors/${MONITOR_ID}/edit`,
    );
    expect(screen.getByRole("button", { name: "หยุดชั่วคราว" })).toBeVisible();
    expect(screen.getByRole("button", { name: "ลบมอนิเตอร์" })).toBeVisible();
    expect(screen.queryByText("สิทธิ์ของคุณ: ดูอย่างเดียว")).toBeNull();
  });

  it("shows denied to a non-member without fetching or naming the monitor", async () => {
    renderDetail(B.replace("2222", "3333"));
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(fetchDetailMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Payments API")).toBeNull();
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
    // The re-read is still open: no "denied" and no monitor yet.
    expect(
      screen.queryByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeNull();
    finish(
      context("viewer", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
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
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "กลับไปรายการมอนิเตอร์" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Payments API")).toBeNull();
  });
});

describe("Detail loading, failure and refetch", () => {
  it("shows a loading state with no data while pending", async () => {
    fetchDetailMock.mockReturnValue(new Promise(() => undefined));
    renderDetail();
    expect(
      await screen.findByRole("status", { name: "กำลังโหลดมอนิเตอร์" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Payments API")).toBeNull();
  });

  it("shows a failure with a retry, never the empty state", async () => {
    fetchDetailMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "down", 0),
    );
    renderDetail();
    expect(
      await screen.findByText("โหลดมอนิเตอร์ไม่สำเร็จ"),
    ).toBeInTheDocument();
    showDetail(detail());
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
  });

  it("keeps the last data with a warning when a refetch fails", async () => {
    showDetail(detail());
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    fetchDetailMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    expect(
      await screen.findByText(/อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Payments API",
    );
  });

  it("shows the new state after another session pauses the monitor", async () => {
    showDetail(detail());
    renderDetail();
    await screen.findByRole("button", { name: "หยุดชั่วคราว" });
    showDetail(detail({ status: "paused", health: "paused" }));
    expect(
      await screen.findByText("มอนิเตอร์นี้หยุดตรวจอยู่ จะไม่มีการแจ้งเตือน"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "เริ่มต่อ" }),
    ).toBeInTheDocument();
  });

  it("shows 'not found' after another session deletes the monitor", async () => {
    showDetail(detail());
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    fetchDetailMock.mockRejectedValue(notFound());
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(screen.queryByText("Payments API")).toBeNull();
  });
});

describe("Detail structure", () => {
  it("orders the section headings as h2 under one h1", async () => {
    showDetail(detail());
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    await screen.findByText("ไม่มีเหตุการณ์ล่มในช่วงที่มีข้อมูล");
    const names = [
      "เวลาตอบสนอง",
      "สถานะปัจจุบัน",
      "ผลการตรวจล่าสุดและ Assertions",
      "ฟีดเหตุการณ์",
      "เหตุการณ์",
      "ประวัติการตรวจ",
      "การตั้งค่า",
      "การแจ้งเตือน",
      "SSL",
      "การตอบกลับล่าสุด",
    ];
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(names.length);
    // The section code (01, 02) is aria-hidden, so the accessible name excludes it.
    names.forEach((name, index) => {
      expect(headings[index]).toHaveAccessibleName(name);
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
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
    const card = sectionOf(
      await screen.findByRole("heading", { name: "การตั้งค่า" }),
    );
    expect(within(card).getByText(/Bearer token/)).toHaveTextContent(
      "ตั้งค่าแล้ว",
    );
    expect(within(card).getByText("X-Api-Key").parentElement).toHaveTextContent(
      "ตั้งค่าแล้ว (ค่าลับ)",
    );
    expect(within(card).getByText("application/json")).toBeInTheDocument();
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
    const card = sectionOf(
      await screen.findByRole("heading", { name: "การตั้งค่า" }),
    );
    expect(within(card).getByText(/^Basic/)).toHaveTextContent(
      "ยังไม่ได้ตั้งค่า",
    );
    expect(within(card).getByText("X-Api-Key").parentElement).toHaveTextContent(
      "ยังไม่ได้ตั้งค่า (ค่าลับ)",
    );
    expect(within(card).queryByText(/ตั้งค่าแล้ว/)).toBeNull();
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
      const card = sectionOf(
        await screen.findByRole("heading", { name: "การตั้งค่า" }),
      );
      expect(within(card).getByText("region=eu")).toBeInTheDocument();
      expect(within(card).getByText("Body (json)")).toBeInTheDocument();
      expect(
        within(card).getByRole("group", { name: "เนื้อหา body" }),
      ).toHaveTextContent('{"ping":true}');
      expect(
        within(card).getByText("JSONPath เท่ากับ $.status = ok"),
      ).toBeInTheDocument();
      expect(
        within(card).getByText("เนื้อหามีข้อความ ready"),
      ).toBeInTheDocument();
      expect(
        within(card).getByText("เวลาตอบสนองน้อยกว่า 800 ms"),
      ).toBeInTheDocument();
      expect(
        within(card).getByText(
          "ผู้ที่ดูมอนิเตอร์เห็นค่านี้ได้ ห้ามใส่ความลับ ใช้ header ลับแทน",
        ),
      ).toBeInTheDocument();
    },
  );

  it("shows no visibility warning when there are no query parameters or body", async () => {
    showDetail(detail());
    renderDetail();
    const card = sectionOf(
      await screen.findByRole("heading", { name: "การตั้งค่า" }),
    );
    expect(within(card).queryByText(/ห้ามใส่ความลับ/)).toBeNull();
  });

  it("keeps the monitor leaf active on the Detail path", () => {
    const leaf = { path: "/organizations/:organizationId/monitors" };
    expect(
      isLeafActive(leaf, `/organizations/${A}/monitors/${MONITOR_ID}`),
    ).toBe(true);
  });
});

describe("Detail Organization switch", () => {
  it("leaves the monitor for the new Organization's Overview without showing old data", async () => {
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    fetchListMock.mockResolvedValue({
      summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
      monitors: [],
      page: { limit: 25, offset: 0, total: 0 },
      dataAsOf: "2026-09-30T07:32:05.000Z",
    });
    showDetail(detail());
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    await user.click(screen.getByRole("button", { name: "switch to B" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/monitors`,
      );
    });
    expect(screen.queryByText("Payments API")).toBeNull();
  });
});

function chartTable() {
  return within(
    screen.getByRole("region", { name: "ข้อมูลกราฟเวลาตอบสนอง" }),
  ).getByRole("table");
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
  it("shows the empty state when there are no results", async () => {
    showDetail(detail({ lastCheckAt: null, lastResult: null }));
    renderDetail();
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    expect(
      await within(card).findByText("ยังไม่มีผลการตรวจ"),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("group")).toBeNull();
  });

  it("tells a monitor with no results in the window from one that was never checked", async () => {
    showDetail(detail({ lastCheckAt: "2026-09-28T07:30:00.000Z" }));
    renderDetail();
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    expect(
      await within(card).findByText(/^ไม่มีผลใน 24 ชม\. \(ผลล่าสุด/),
    ).toBeInTheDocument();
    expect(within(card).queryByText("ยังไม่มีผลการตรวจ")).toBeNull();
  });

  it("says so when the whole window is paused", async () => {
    showDetail(detail({ status: "paused", health: "paused" }));
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      pauses: [{ from: inWindow(-60), to: DATA_AS_OF }],
    });
    renderDetail();
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    expect(
      await within(card).findByText("หยุดชั่วคราวตลอดช่วง ไม่มีการตรวจ"),
    ).toBeInTheDocument();
    expect(
      await within(card).findByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ }),
    ).toBeInTheDocument();
  });

  it("says 'หยุดชั่วคราวตลอดช่วง' for a 7 d window paused from before its start until now", async () => {
    const asOf = Date.parse(DATA_AS_OF);
    const hour = 3_600_000;
    const start = Math.ceil((asOf - 7 * 24 * hour) / hour) * hour;
    showDetail(
      detail({ status: "paused", health: "paused", intervalSeconds: 900 }),
    );
    fetchResponseTimesMock.mockImplementation((_org, _id, range) =>
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
    await screen.findByRole("radio", { name: "7 วัน" });
    await user.click(screen.getByRole("radio", { name: "7 วัน" }));
    expect(
      await screen.findByText("หยุดชั่วคราวตลอดช่วง ไม่มีการตรวจ"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^ไม่มีผลใน 7 วัน/)).toBeNull();
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
    await user.click(
      await screen.findByRole("button", { name: "ดูข้อมูลกราฟเป็นตาราง" }),
    );
    const rows = within(chartTable()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(
      screen.getByText("ไม่มีช่วงไม่มีข้อมูล", { exact: false }),
    ).toBeInTheDocument();
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
    const button = await screen.findByRole("button", {
      name: "ดูข้อมูลกราฟเป็นตาราง",
    });
    await user.click(button);
    const rows = within(chartTable()).getAllByRole("row").slice(1);
    // Two results, then the gap from the last one to now (and one before the first).
    expect(rows.at(-1)).toHaveTextContent("ไม่มีข้อมูล");
    expect(rows[0]).toHaveTextContent("ไม่มีข้อมูล");
    expect(screen.getByText(/ไม่มีข้อมูล 2 ช่วง รวม/)).toBeInTheDocument();
  });

  it("loads the chart lazily with its unit, range, source and summary", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue(responseTimes24h);
    renderDetail();
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    expect(
      await within(card).findByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        /หน่วย: ms ช่วง: 24 ชม.ล่าสุด แหล่ง: ผลการตรวจของ NightWatch/,
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "เฉลี่ย 529 ms สูงสุด 1,204 ms ไม่มีข้อมูล 1 ช่วง รวม 15 นาที หยุดชั่วคราว 1 ช่วง",
      ),
    ).toBeInTheDocument();
    expect(fetchResponseTimesMock).toHaveBeenCalledWith(A, MONITOR_ID, "24h");
  });

  it("opens the same data as a real table with the keyboard", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue(responseTimes24h);
    const user = userEvent.setup();
    renderDetail();
    const button = await screen.findByRole("button", {
      name: "ดูข้อมูลกราฟเป็นตาราง",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    const table = chartTable();
    expect(table).toHaveAccessibleName(
      /เวลาตอบสนอง หน่วย ms ช่วง 24 ชม.ล่าสุด/,
    );
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers[1]).toBe("เวลาตอบสนอง (ms)");
    const body = within(table).getAllByRole("row").slice(1);
    // Three checks, one gap and one pause.
    expect(body).toHaveLength(5);
    expect(within(table).getByText("ไม่มีข้อมูล")).toBeInTheDocument();
    expect(within(table).getByText("หยุดชั่วคราว")).toBeInTheDocument();
    expect(within(table).getByText("เปลี่ยน URL")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(
      screen.queryByRole("table", { name: /เวลาตอบสนอง หน่วย/ }),
    ).toBeNull();
  });

  it.each([
    ["7 วัน", "7d", "7 วันล่าสุด"],
    ["30 วัน", "30d", "30 วันล่าสุด"],
  ] as const)(
    "refetches for %s and labels the table with the range",
    async (label, range, text) => {
      showDetail(detail());
      fetchResponseTimesMock.mockImplementation((_org, _id, requested) =>
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
      await screen.findByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ });
      await user.click(screen.getByRole("radio", { name: label }));
      await waitFor(() => {
        expect(fetchResponseTimesMock).toHaveBeenCalledWith(
          A,
          MONITOR_ID,
          range,
        );
      });
      expect(
        await screen.findByRole("group", { name: new RegExp(`ช่วง ${text}`) }),
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "ดูข้อมูลกราฟเป็นตาราง" }),
      );
      const table = chartTable();
      expect(table).toHaveAccessibleName(new RegExp(text));
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((header) => header.textContent),
      ).toEqual(
        expect.arrayContaining(["เฉลี่ย (ms)", "สูงสุด (ms)", "หมายเหตุ"]),
      );
    },
  );

  it("keeps a failing chart inside its card with a retry", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "x", 0),
    );
    const user = userEvent.setup();
    renderDetail();
    expect(
      await screen.findByText("โหลดกราฟเวลาตอบสนองไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Payments API",
    );
    fetchResponseTimesMock.mockResolvedValue(responseTimes24h);
    const card = sectionOf(
      screen.getByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    await user.click(within(card).getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await screen.findByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ }),
    ).toBeInTheDocument();
  });
});

describe("Detail redesign behaviours", () => {
  it("keeps the date in the header when the last check was on a previous day", async () => {
    showDetail(detail({ lastCheckAt: "2026-09-28T07:30:00.000Z" }));
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    const time = screen
      .getAllByText(/ตรวจล่าสุด/)
      .map((node) => node.querySelector("time"))
      .find((node) => node !== null);
    expect(must(time)).toHaveTextContent(
      formatDateTime("2026-09-28T07:30:00.000Z"),
    );
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
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    const kpi = (label: string) =>
      must(within(card).getByText(label).nextElementSibling);
    await waitFor(() => {
      expect(kpi("จำนวนการตรวจ")).toHaveTextContent("3");
    });
    expect(kpi("ล้มเหลว")).toHaveTextContent("1");
    expect(kpi("p50")).toHaveTextContent("100 ms");
    expect(kpi("p95")).toHaveTextContent("300 ms");
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
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    await waitFor(() => {
      expect(
        must(within(card).getByText("p50").nextElementSibling),
      ).toHaveTextContent("ไม่มีข้อมูล");
    });
    expect(
      must(within(card).getByText("p95").nextElementSibling),
    ).toHaveTextContent("ไม่มีข้อมูล");
  });

  it("shows live four KPIs instead of the #57 sample on 7 d", async () => {
    showDetail(detail());
    fetchResponseTimesMock.mockImplementation((_org, _id, range) =>
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
    await screen.findByRole("radio", { name: "7 วัน" });
    await user.click(screen.getByRole("radio", { name: "7 วัน" }));
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    await waitFor(() =>
      expect(
        must(within(card).getByText("p50").nextElementSibling),
      ).toHaveTextContent("100 ms"),
    );
    expect(
      must(within(card).getByText("p95").nextElementSibling),
    ).toHaveTextContent("150 ms");
    expect(
      must(within(card).getByText("จำนวนการตรวจ").nextElementSibling),
    ).toHaveTextContent("12");
    expect(
      must(within(card).getByText("ล้มเหลว").nextElementSibling),
    ).toHaveTextContent("0");
    expect(
      within(card).queryByRole("group", { name: /^ตัวอย่าง: p50 p95/ }),
    ).toBeNull();
  });

  it("frames every sample region with its issue link", async () => {
    showDetail(detail());
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    const frames = Array.from(
      document.querySelectorAll('[data-slot="mockup-frame"]'),
    );
    // The #56 sample remains; #57 and #58 are live.
    expect(
      frames.map(
        (frame) =>
          /(\d+)$/.exec(
            within(frame as HTMLElement)
              .getByRole("link")
              .getAttribute("href") ?? "",
          )?.[1],
      ),
    ).toEqual(["56"]);
    for (const frame of frames) {
      expect(frame.textContent).not.toMatch(/HTTP\/\d/);
      expect(frame).toHaveAccessibleName(/^ตัวอย่าง:/);
      expect(within(frame as HTMLElement).getByRole("link")).toHaveAttribute(
        "href",
        expect.stringContaining("/issues/"),
      );
    }
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
function renderResponseCard() {
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
        monitorId={MONITOR_ID}
        lastCheckAt={DATA_AS_OF}
        intervalSeconds={300}
        createdAt="2026-09-01T00:00:00.000Z"
      />
    </QueryClientProvider>
  );
  return { client, view, ...render(view()) };
}
function expectKpis(values: string[]) {
  expect(
    ["p50", "p95", "จำนวนการตรวจ", "ล้มเหลว"].map(
      (label) => must(screen.getByText(label).nextElementSibling).textContent,
    ),
  ).toEqual(values);
}

describe("#57 response-time state and selection", () => {
  it.each(["7 วัน", "30 วัน"])(
    "shows the same literal four KPI values for %s, full bounds and keyboard table",
    async (label) => {
      fetchResponseTimesMock.mockImplementation((_org, _id, range) =>
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
      await waitFor(() => expectKpis(["20 ms", "40 ms", "4", "1"]));
      const user = userEvent.setup();
      const option = screen.getByRole("radio", { name: label });
      option.focus();
      await user.keyboard(" ");
      await waitFor(() =>
        expect(
          screen.getByTestId("response-range-announcement"),
        ).toHaveTextContent(
          label === "7 วัน"
            ? "7 วันล่าสุด p50 20 ms p95 40 ms จำนวนการตรวจ 4 ล้มเหลว 1"
            : "30 วันล่าสุด p50 20 ms p95 40 ms จำนวนการตรวจ 4 ล้มเหลว 1",
        ),
      );
      expectKpis(["20 ms", "40 ms", "4", "1"]);
      expect(option).toHaveFocus();
      expect(
        screen.getByText(/ขอบเริ่มปัดขึ้นเป็นชั่วโมง UTC/),
      ).toBeInTheDocument();
      expect(
        document.querySelector(
          label === "7 วัน"
            ? 'time[datetime="2026-09-23T08:00:00.000Z"]'
            : 'time[datetime="2026-08-31T08:00:00.000Z"]',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /issue #57/ })).toBeNull();
      const table = screen.getByRole("button", {
        name: "ดูข้อมูลกราฟเป็นตาราง",
      });
      table.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("table")).toBeInTheDocument();
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
    await waitFor(() => expectKpis(["0 ms", "0 ms", "0", "0"]));
    expect(
      screen.getByText("คำนวณจากผลตรวจล่าสุดไม่เกิน 1,440 รายการ"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ตรวจไม่ได้ \(ปัญหาฝั่งระบบ\)/),
    ).toBeInTheDocument();
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
    await waitFor(() => expectKpis(["ไม่มีข้อมูล", "ไม่มีข้อมูล", "2", "2"]));
    expect(screen.getByText(/p50\/p95 ใช้ nearest-rank/)).toHaveTextContent(
      "ไม่มีค่าที่วัดได้แสดง “ไม่มีข้อมูล”",
    );
  });

  it("hides previous KPIs during rapid selections, ignores late completion, announces latest once and never auto-refetch", async () => {
    const seven = deferred<MonitorResponseTimesResponse>();
    const thirty = deferred<MonitorResponseTimesResponse>();
    fetchResponseTimesMock.mockImplementation((_org, _id, range) =>
      range === "24h"
        ? Promise.resolve(noResponseTimes)
        : range === "7d"
          ? seven.promise
          : thirty.promise,
    );
    renderResponseCard();
    await waitFor(() => expectKpis(["ไม่มีข้อมูล", "ไม่มีข้อมูล", "0", "0"]));
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "7 วัน" }));
    expect(
      screen.getByLabelText("กำลังโหลดสรุปเวลาตอบสนอง"),
    ).toBeInTheDocument();
    expect(screen.queryByText("p50")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "30 วัน" }));
    const announcement = screen.getByTestId("response-range-announcement");
    const changes: string[] = [];
    const observer = new MutationObserver(() => {
      changes.push(announcement.textContent ?? "");
    });
    observer.observe(announcement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await act(async () => {
      thirty.resolve(liveRange("30d"));
    });
    await waitFor(() => expectKpis(["20 ms", "40 ms", "4", "1"]));
    await act(async () => {
      seven.resolve(liveRange("7d", 700));
    });
    expectKpis(["20 ms", "40 ms", "4", "1"]);
    fetchResponseTimesMock.mockResolvedValue(liveRange("30d", 30));
    await waitFor(() => expectKpis(["30 ms", "40 ms", "4", "1"]));
    expect(changes).toEqual([
      "30 วันล่าสุด p50 20 ms p95 40 ms จำนวนการตรวจ 4 ล้มเหลว 1",
    ]);
    observer.disconnect();
    expect(screen.getByRole("radio", { name: "30 วัน" })).toHaveFocus();
  });

  it("keeps only same-key data on refetch error with its response timestamp and working retry", async () => {
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      dataAsOf: "2026-09-30T07:31:01.123Z",
      points: [{ at: DATA_AS_OF, responseTimeMs: 10, outcome: "pass" }],
    });
    const { client } = renderResponseCard();
    await waitFor(() => expectKpis(["10 ms", "10 ms", "1", "0"]));
    fetchResponseTimesMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await client.refetchQueries({
        queryKey: monitorQueryKeys.responseTimes(A, MONITOR_ID, "24h"),
      });
    });
    expectKpis(["10 ms", "10 ms", "1", "0"]);
    const warning = await screen.findByText(/อัปเดตกราฟไม่สำเร็จ/);
    expect(warning).toHaveTextContent("ข้อมูล ณ");
    expect(warning.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-09-30T07:31:01.123Z",
    );
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [{ at: DATA_AS_OF, responseTimeMs: 40, outcome: "pass" }],
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expectKpis(["40 ms", "40 ms", "1", "0"]));
    expect(screen.queryByText(/อัปเดตกราฟไม่สำเร็จ/)).toBeNull();
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
      await waitFor(() => expectKpis(["987 ms", "987 ms", "1", "0"]));
      fetchResponseTimesMock.mockRejectedValue(
        new ApiError(code, "denied", code === "MONITOR_NOT_FOUND" ? 404 : 403),
      );
      await act(async () => {
        await client.refetchQueries({
          queryKey: monitorQueryKeys.responseTimes(A, MONITOR_ID, "24h"),
        });
      });
      expect(
        await screen.findByText(
          code === "MONITOR_NOT_FOUND"
            ? "ไม่พบมอนิเตอร์นี้"
            : "คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("p50")).toBeNull();
      expect(screen.queryByText("987 ms")).toBeNull();
      expect(
        screen.queryByRole("group", { name: /กราฟเส้นเวลาตอบสนอง/ }),
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
    await waitFor(() => expectKpis(["22 ms", "22 ms", "1", "0"]));
    await act(async () => {
      pending.resolve({
        ...noResponseTimes,
        points: [{ at: DATA_AS_OF, responseTimeMs: 999, outcome: "pass" }],
      });
    });
    expectKpis(["22 ms", "22 ms", "1", "0"]);
    const oldIdentity = deferred<MonitorResponseTimesResponse>();
    fetchResponseTimesMock.mockReturnValue(oldIdentity.promise);
    const retiredRequest = client.refetchQueries({
      queryKey: monitorQueryKeys.responseTimes(B, MONITOR_ID, "24h"),
    });
    const newIdentity = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [{ at: DATA_AS_OF, responseTimeMs: 33, outcome: "pass" }],
    });
    rerender(view(B, newIdentity));
    await waitFor(() => expectKpis(["33 ms", "33 ms", "1", "0"]));
    await act(async () => {
      oldIdentity.resolve({
        ...noResponseTimes,
        points: [{ at: DATA_AS_OF, responseTimeMs: 888, outcome: "pass" }],
      });
      await retiredRequest;
    });
    expectKpis(["33 ms", "33 ms", "1", "0"]);
    expect(screen.queryByText("888 ms")).toBeNull();
    expect(screen.queryByText("999 ms")).toBeNull();
  });
});

it("announces an empty latest selection once after failed load and retry, without moving focus", async () => {
  fetchResponseTimesMock.mockImplementation((_org, _id, range) =>
    range === "24h"
      ? Promise.resolve(noResponseTimes)
      : Promise.reject(new Error("offline")),
  );
  renderResponseCard();
  await waitFor(() => expectKpis(["ไม่มีข้อมูล", "ไม่มีข้อมูล", "0", "0"]));
  const user = userEvent.setup();
  const radio = screen.getByRole("radio", { name: "7 วัน" });
  await user.click(radio);
  await screen.findByText("โหลดกราฟเวลาตอบสนองไม่สำเร็จ");
  expect(screen.queryByText("p50")).toBeNull();
  expect(
    screen.getByTestId("response-range-announcement"),
  ).toBeEmptyDOMElement();
  expect(radio).toHaveFocus();
  fetchResponseTimesMock.mockResolvedValue({
    ...liveRange("7d"),
    buckets: [],
    summary: { p50Ms: null, p95Ms: null, checks: 0, failed: 0 },
  });
  const retry = screen.getByRole("button", { name: "ลองอีกครั้ง" });
  retry.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expectKpis(["ไม่มีข้อมูล", "ไม่มีข้อมูล", "0", "0"]));
  expect(screen.getByText(/^ไม่มีผลใน/)).toHaveTextContent("ไม่มีผลใน 7 วัน");
  expect(screen.getByTestId("response-range-announcement")).toHaveTextContent(
    "7 วันล่าสุด p50 ไม่มีข้อมูล p95 ไม่มีข้อมูล จำนวนการตรวจ 0 ล้มเหลว 0",
  );
});

it.each(["owner", "admin", "viewer", "auditor"] as const)(
  "allows %s to read actual response KPIs without write controls",
  async (role) => {
    fetchMeContextMock.mockResolvedValue(context(role));
    showDetail(detail());
    fetchResponseTimesMock.mockResolvedValue({
      ...noResponseTimes,
      points: [{ at: DATA_AS_OF, responseTimeMs: 20, outcome: "fail" }],
    });
    renderDetail();
    const card = sectionOf(
      await screen.findByRole("heading", { name: "เวลาตอบสนอง" }),
    );
    await waitFor(() =>
      expect(
        must(within(card).getByText("p50").nextElementSibling),
      ).toHaveTextContent("20 ms"),
    );
    expect(
      must(within(card).getByText("ล้มเหลว").nextElementSibling),
    ).toHaveTextContent("1");
    if (role === "viewer" || role === "auditor")
      expect(screen.queryByRole("button", { name: "แก้ไข" })).toBeNull();
  },
);
