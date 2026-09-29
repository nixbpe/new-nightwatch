import type {
  CheckResultView,
  Monitor,
  MonitorChecksResponse,
} from "@nightwatch/api-contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLeafActive } from "../../components/shell/nav-config";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import {
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
} from "../../lib/api/monitors";
import {
  A,
  B,
  baseResult,
  context,
  detail,
  MONITOR_ID,
  must,
  noChecks,
  noIncidents,
  NOW,
  renderDetail,
  sectionOf,
} from "./detail-test-support";
import { formatDateTime, formatTime } from "./format";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Short enough to exercise the real refetch interval inside a test.
  MONITOR_REFETCH_INTERVAL_MS: 60,
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchDetailMock = vi.mocked(fetchMonitorDetail);
const fetchChecksMock = vi.mocked(fetchMonitorChecks);
const fetchIncidentsMock = vi.mocked(fetchMonitorIncidents);
const fetchListMock = vi.mocked(fetchMonitorList);
const fetchEventsMock = vi.mocked(fetchMonitorRecentEvents);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMeContextMock.mockResolvedValue(context());
  fetchChecksMock.mockResolvedValue(noChecks);
  fetchIncidentsMock.mockResolvedValue(noIncidents);
  fetchEventsMock.mockResolvedValue({ events: [] });
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
    expect(screen.getByText(/สาเหตุ .*คาดหวัง 200-299/)).toBeInTheDocument();
    expect(await screen.findByText("กำลังเกิดอยู่")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่สิ้นสุด")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument();
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
    await userEvent
      .setup()
      .click(must(screen.getAllByRole("button", { name: "ลองอีกครั้ง" })[0]));
    expect(await screen.findByText("ยังไม่มีผลการตรวจ")).toBeInTheDocument();
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

  it("shows denied and refreshes the membership when the API refuses", async () => {
    fetchDetailMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "denied", 403),
    );
    renderDetail();
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

  it("shows the same text when a notification link opens a deleted monitor", async () => {
    // The inbox links to /organizations/<id>/monitors/<monitorId>; the monitor is gone.
    fetchDetailMock.mockRejectedValue(notFound());
    renderDetail(A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
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
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings.filter((text) => text !== "เวลาตอบสนอง")).toEqual([
      "สถานะปัจจุบัน",
      "ผลการตรวจล่าสุดและ Assertions",
      "SSL",
      "เหตุการณ์",
      "ประวัติการตรวจ",
      "การตั้งค่า",
    ]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows the auth type and secret header names as set, never a value", async () => {
    showDetail(
      detail({
        auth: { type: "bearer" },
        headers: [
          { id: "h1", name: "X-Api-Key", secret: true },
          { name: "Accept", value: "application/json", secret: false },
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
