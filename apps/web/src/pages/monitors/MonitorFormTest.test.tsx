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

import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
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
} from "../../lib/api/monitors";
import { noChecks, noIncidents, noResponseTimes } from "./detail-test-support";
import {
  A,
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
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
  testMonitorDraft: vi.fn(),
  testMonitorEdit: vi.fn(),
}));

const draftMock = vi.mocked(testMonitorDraft);
const editTestMock = vi.mocked(testMonitorEdit);
const createMock = vi.mocked(createMonitor);

beforeEach(() => {
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  createMock.mockResolvedValue({ monitor: record() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function result(overrides: Partial<MonitorTestResult> = {}): {
  result: MonitorTestResult;
} {
  return {
    result: {
      checkedAt: "2026-09-30T07:30:00.000Z",
      outcome: "pass",
      httpStatus: 200,
      responseTimeMs: 182,
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
      ...overrides,
    },
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function openCreate(user: User = userEvent.setup()) {
  renderForm(newPath());
  await screen.findByLabelText("ชื่อมอนิเตอร์");
  await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
  await user.type(
    screen.getByLabelText("URL"),
    "https://api.acme.example/health",
  );
  return user;
}

const testButton = () =>
  screen.getByRole("button", { name: /^(ทดสอบการตั้งค่า|กำลังทดสอบ…)$/ });
const liveRegions = () =>
  screen.getAllByRole("status").filter((node) => node.tagName === "DIV");

describe("Test panel states", () => {
  it("starts idle with the region already in the DOM", async () => {
    await openCreate();
    expect(
      within(liveRegions()[0] as HTMLElement).getByText(
        "ยังไม่ได้ทดสอบ ผลการทดสอบไม่ถูกบันทึกและไม่ส่งผลต่อมอนิเตอร์",
      ),
    ).toBeInTheDocument();
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("sends one request for a repeated press and keeps the focus on the button", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    draftMock.mockReturnValue(pending.promise);
    const user = await openCreate();
    await user.click(testButton());
    expect(testButton()).toHaveAccessibleName("กำลังทดสอบ…");
    expect(testButton()).toHaveAttribute("aria-disabled", "true");
    expect(testButton()).toHaveFocus();
    expect(screen.getByText("กำลังส่งคำขอทดสอบ")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.click(testButton());
    await user.keyboard("{Enter}");
    expect(draftMock).toHaveBeenCalledTimes(1);
    pending.resolve(result());
    expect(await screen.findByText("การทดสอบผ่าน")).toBeInTheDocument();
    expect(testButton()).toHaveFocus();
  });

  it("announces a passing result in the status region with status, time and SSL", async () => {
    draftMock.mockResolvedValue(
      result({
        assertions: [
          {
            kind: "bodyContains",
            expected: "ready",
            actual: null,
            actualType: null,
            actualTruncated: false,
            status: "pass",
            reason: null,
          },
        ],
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    const headline = await screen.findByText("การทดสอบผ่าน");
    expect(liveRegions()[0]).toContainElement(headline);
    expect(screen.getByText("รหัสสถานะ 200")).toBeInTheDocument();
    expect(screen.getByText("เวลาตอบสนอง 182 ms")).toBeInTheDocument();
    expect(screen.getByText(/SSL:/)).toHaveTextContent(
      "เหลือ 128 วัน (ผู้ออก Example CA) โฮสต์ api.acme.example",
    );
    const table = screen.getByRole("table", { name: "ผลการทดสอบต่อเงื่อนไข" });
    expect(within(table).getAllByText("ผ่าน")).toHaveLength(2);
    expect(testButton()).toHaveFocus();
  });

  it("shows each failed assertion with the word and the truncation label", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "assertion_failed",
        assertions: [
          {
            kind: "jsonPathEquals",
            expected: '"ok"',
            actual: '"degraded"',
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
        ],
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(
      await screen.findByText("ไม่ผ่าน: 1 จาก 2 เงื่อนไข"),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "ผลการทดสอบต่อเงื่อนไข" });
    expect(within(table).getByText("ตัดแล้ว")).toBeInTheDocument();
    expect(within(table).getByText(/ไม่ผ่าน/)).toBeInTheDocument();
  });

  it.each([
    [
      "blocked_address",
      /ที่อยู่นี้ไม่อนุญาตให้ตรวจสอบ \(เช่น localhost หรือที่อยู่ภายในเครือข่าย\) ใช้ที่อยู่สาธารณะแทน/,
    ],
    [
      "redirect_blocked",
      "ไม่ผ่าน: ที่อยู่ปลายทางของ redirect ไม่อนุญาตให้ตรวจสอบ",
    ],
    ["redirect_limit", "ไม่ผ่าน: redirect เกินกำหนด"],
    ["dns_not_found", "ไม่ผ่าน: ไม่พบชื่อโดเมนนี้"],
    ["timeout", "ไม่ผ่าน: หมดเวลารอ 10 วินาที ไม่ได้รับการตอบกลับ"],
    ["connect_refused", "ไม่ผ่าน: ปลายทางปฏิเสธการเชื่อมต่อ"],
  ] as const)(
    "words %s as the target's result, with no address and every assertion not evaluated",
    async (failureReason, text) => {
      draftMock.mockResolvedValue(
        result({
          outcome: "fail",
          failureReason,
          httpStatus: null,
          responseTimeMs: null,
          assertions: [
            {
              kind: "bodyContains",
              expected: "ready",
              actual: null,
              actualType: null,
              actualTruncated: false,
              status: "not_evaluated",
              reason: "no_response",
            },
          ],
        }),
      );
      const user = await openCreate();
      await user.click(testButton());
      expect(await screen.findByText(text)).toBeInTheDocument();
      const table = screen.getByRole("table", {
        name: "ผลการทดสอบต่อเงื่อนไข",
      });
      expect(
        within(table).getAllByText(/ไม่ได้ประเมิน/).length,
      ).toBeGreaterThan(1);
      expect(document.body.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    },
  );

  it("uses the timeout of the tested configuration in the timeout wording", async () => {
    draftMock.mockResolvedValue(
      result({ outcome: "fail", failureReason: "timeout", httpStatus: null }),
    );
    const user = await openCreate();
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    fireEvent.change(screen.getByLabelText("หมดเวลารอ (วินาที)"), {
      target: { value: "5" },
    });
    await user.click(testButton());
    expect(
      await screen.findByText(
        "ไม่ผ่าน: หมดเวลารอ 5 วินาที ไม่ได้รับการตอบกลับ",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["hostname_mismatch", "ไม่ผ่าน: ใบรับรองไม่ถูกต้อง: ชื่อไม่ตรง"],
    ["expired", "ไม่ผ่าน: ใบรับรองไม่ถูกต้อง: หมดอายุ"],
    ["self_signed", "ไม่ผ่าน: ใบรับรองไม่ถูกต้อง: ใบรับรองลงนามเอง"],
    ["handshake_failed", "ไม่ผ่าน: เชื่อมต่อแบบปลอดภัยไม่สำเร็จ"],
    [null, "ไม่ผ่าน: ใบรับรองไม่ถูกต้อง"],
  ] as const)("words a TLS failure (%s)", async (tlsReason, text) => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "tls_invalid",
        tlsReason,
        httpStatus: null,
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("words a system-side check error apart from a target failure", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "check_error",
        failureReason: "executor_error",
        httpStatus: null,
        responseTimeMs: null,
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(
      await screen.findByText(
        /ตรวจไม่ได้ \(ปัญหาฝั่งระบบ\) ไม่ใช่ผลของเป้าหมาย/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^ไม่ผ่าน/)).toBeNull();
  });

  it("labels the result stale once the form changes", async () => {
    draftMock.mockResolvedValue(result());
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    expect(screen.queryByText("ผลนี้ไม่ตรงกับค่าปัจจุบัน")).toBeNull();
    await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), " 2");
    expect(screen.getByText("ผลนี้ไม่ตรงกับค่าปัจจุบัน")).toBeInTheDocument();
  });

  it("tests an invalid form by showing the errors beside the fields and sending nothing", async () => {
    const user = userEvent.setup();
    renderForm(newPath());
    await screen.findByLabelText("ชื่อมอนิเตอร์");
    await user.click(testButton());
    expect(draftMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveFocus();
    expect(screen.getByLabelText("URL")).toHaveAccessibleDescription(
      expect.stringContaining("กรอก URL"),
    );
  });
});

describe("Test panel SSL line", () => {
  it.each([
    [
      "ok",
      128,
      "SSL: เหลือ 128 วัน (ผู้ออก Example CA) โฮสต์ api.acme.example",
    ],
    [
      "caution",
      21,
      "SSL: ใกล้หมดอายุ เหลือ 21 วัน (ผู้ออก Example CA) โฮสต์ api.acme.example",
    ],
    [
      "danger",
      5,
      "SSL: หมดอายุใน 5 วัน (ผู้ออก Example CA) โฮสต์ api.acme.example",
    ],
    [
      "expired",
      -2,
      "SSL: หมดอายุแล้ว เมื่อ 2 วันก่อน (ผู้ออก Example CA) โฮสต์ api.acme.example",
    ],
    [
      "unreadable",
      null,
      "SSL: อ่านใบรับรองไม่ได้ (ผู้ออก Example CA) โฮสต์ api.acme.example",
    ],
    [
      "not_https",
      null,
      "SSL: ไม่ใช้ HTTPS (ผู้ออก Example CA) โฮสต์ api.acme.example",
    ],
  ] as const)("words level %s", async (level, daysRemaining, text) => {
    draftMock.mockResolvedValue(
      result({
        ssl: {
          level,
          daysRemaining,
          host: "api.acme.example",
          issuer: "Example CA",
          notAfter: "2027-02-05T00:00:00.000Z",
        },
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    expect(await screen.findByText(/^SSL:/)).toHaveTextContent(text);
  });

  it("renders no SSL line for no_data", async () => {
    draftMock.mockResolvedValue(
      result({
        ssl: {
          level: "no_data",
          daysRemaining: null,
          host: null,
          issuer: null,
          notAfter: null,
        },
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    expect(screen.queryByText(/SSL:/)).toBeNull();
  });
});

describe("Test service errors", () => {
  it.each([
    ["RATE_LIMIT_UNAVAILABLE", 503],
    ["INTERNAL_ERROR", 500],
    ["CREDENTIALS_UNAVAILABLE", 503],
  ] as const)(
    "shows %s as an alert apart from a target result",
    async (code, httpStatus) => {
      draftMock.mockRejectedValue(
        new ApiError(code, "internal detail 10.0.0.1", httpStatus),
      );
      const user = await openCreate();
      await user.click(testButton());
      expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent(
        "ทดสอบไม่สำเร็จ ลองอีกครั้ง",
      );
      expect(screen.queryByText(/^ไม่ผ่าน/)).toBeNull();
      expect(document.body.textContent).not.toMatch(/10\.0\.0\.1/);
      expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
        "Payments API",
      );
      expect(testButton()).toHaveFocus();
    },
  );

  it("disables the button for retryAfterSeconds without announcing a countdown", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    draftMock.mockRejectedValueOnce(
      new ApiError("MONITOR_TEST_RATE_LIMITED", "slow down", 429, {
        retryAfterSeconds: 3,
      }),
    );
    const user = userEvent.setup({ delay: null });
    await openCreate(user);
    await user.click(testButton());
    expect(await screen.findByText("ทดสอบบ่อยเกินไป")).toBeInTheDocument();
    expect(liveRegions()[0]).toHaveTextContent("ทดสอบบ่อยเกินไป");
    expect(liveRegions()[0]).not.toHaveTextContent(/วินาที/);
    expect(testButton()).toHaveAttribute("aria-disabled", "true");
    expect(testButton()).toHaveFocus();
    expect(screen.getByText("ลองอีกครั้งใน 3 วินาที")).toBeInTheDocument();
    await user.click(testButton());
    expect(draftMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("ลองอีกครั้งใน 2 วินาที")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/ลองอีกครั้งใน/)).toBeNull();
    expect(testButton()).toHaveAttribute("aria-disabled", "false");
    draftMock.mockResolvedValueOnce(result());
    await user.click(testButton());
    expect(await screen.findByText("การทดสอบผ่าน")).toBeInTheDocument();
    expect(draftMock).toHaveBeenCalledTimes(2);
  });

  it("maps a MONITOR_INVALID answer to the fields", async () => {
    draftMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "url", reason: "blocked_port" }],
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByLabelText("URL")).toHaveAccessibleDescription(
        /พอร์ต 80, 443/,
      );
    });
    expect(screen.getByLabelText("URL")).toHaveFocus();
  });

  it("keeps the values and shows the role change on PERMISSION_DENIED", async () => {
    draftMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "d", 403));
    const user = await openCreate();
    vi.mocked(fetchMeContext).mockResolvedValue(context("viewer"));
    await user.click(testButton());
    expect(
      (await screen.findAllByText("สิทธิ์ของคุณเปลี่ยนแล้ว")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue("Payments API");
    await waitFor(() => {
      expect(testButton()).toHaveAttribute("aria-disabled", "true");
    });
    expect(testButton()).toHaveFocus();
  });
});

describe("Saving and testing are independent", () => {
  it("saves without a test", async () => {
    const user = await openCreate();
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("saves after a failed test", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "http_status",
        httpStatus: 503,
      }),
    );
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByText(/ไม่ผ่าน: รหัสสถานะไม่อยู่ในที่คาดหวัง/);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });

  it("sends the draft test without a request id or version", async () => {
    draftMock.mockResolvedValue(result());
    const user = await openCreate();
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    const body = draftMock.mock.calls[0]?.[1];
    expect(body).toMatchObject({
      name: "Payments API",
      secrets: [],
    });
    expect(body).not.toHaveProperty("clientRequestId");
    expect(body).not.toHaveProperty("expectedVersion");
  });
});

describe("Edit test", () => {
  it("shows the origin wording beside the URL on a 422 from the server", async () => {
    vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
    editTestMock.mockRejectedValue(
      new ApiError("MONITOR_SECRET_ORIGIN_CHANGED", "x", 422),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(testButton());
    await waitFor(() => {
      expect(screen.getByLabelText("URL")).toHaveAccessibleDescription(
        expect.stringContaining(
          "เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม",
        ),
      );
    });
  });

  it("shows not-found when the monitor is gone at test time", async () => {
    vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
    editTestMock.mockRejectedValue(
      new ApiError("MONITOR_NOT_FOUND", "nf", 404),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(testButton());
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
  });
});

describe("Redesign mockups and notes", () => {
  const timing = () =>
    screen.getByRole("group", {
      name: "ตัวอย่าง: เวลาแยกตามขั้นตอนของการทดสอบ",
    });

  it("shows no sample status code in the timing example while idle or failed", async () => {
    draftMock.mockResolvedValue(
      result({
        outcome: "fail",
        failureReason: "http_status",
        httpStatus: 503,
      }),
    );
    const user = await openCreate();
    expect(within(timing()).queryByText("200 OK")).toBeNull();
    expect(within(timing()).getByText("เชื่อมต่อ")).toBeInTheDocument();
    await user.click(testButton());
    await screen.findByText(/^ไม่ผ่าน:/);
    expect(within(timing()).queryByText("200 OK")).toBeNull();
    expect(within(timing()).queryByText(/status/i)).toBeNull();
  });

  it("describes the URL input with the scheme and redirect note", async () => {
    await openCreate();
    expect(screen.getByLabelText("URL")).toHaveAccessibleDescription(
      /รองรับ http และ https · การเปลี่ยนเส้นทาง \(redirect\) สูงสุด 5 ครั้ง/,
    );
  });

  const ALERT_NOTE = /เจ้าของและผู้ดูแลจะได้รับการแจ้งเตือนเมื่อมอนิเตอร์ล่ม/;

  it.each([
    [true, true],
    [false, false],
  ])(
    "shows the alert note only while the org setting is on (%s)",
    async (enabled, shown) => {
      vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
        organizationId: A,
        version: 1,
        settingsChangedEnabled: true,
        monitorAlertsEnabled: enabled,
      });
      await openCreate();
      const region = screen.getByRole("region", { name: "การแจ้งเตือน" });
      await waitFor(() => {
        expect(fetchOrganizationNotificationSettings).toHaveBeenCalled();
      });
      if (shown) {
        expect(await within(region).findByText(ALERT_NOTE)).toBeInTheDocument();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(within(region).queryByText(ALERT_NOTE)).toBeNull();
      }
      for (const box of within(region).getAllByRole("checkbox")) {
        expect(box).toBeDisabled();
      }
    },
  );

  it("hides the alert note when the org setting cannot be read", async () => {
    vi.mocked(fetchOrganizationNotificationSettings).mockRejectedValue(
      new ApiError("FORBIDDEN", "no", 403),
    );
    await openCreate();
    const region = screen.getByRole("region", { name: "การแจ้งเตือน" });
    await waitFor(() => {
      expect(fetchOrganizationNotificationSettings).toHaveBeenCalled();
    });
    expect(within(region).queryByText(ALERT_NOTE)).toBeNull();
  });

  it("puts the test panel before the save button in DOM order", async () => {
    await openCreate();
    const test = screen.getByRole("button", { name: "ทดสอบการตั้งค่า" });
    const save = screen.getByRole("button", { name: "บันทึกมอนิเตอร์" });
    expect(
      test.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the calls per day for the chosen interval", async () => {
    const user = await openCreate();
    expect(screen.getByText(/ครั้งต่อวัน/)).toHaveTextContent(
      "ประมาณ 288 ครั้งต่อวัน",
    );
    await user.click(screen.getByRole("radio", { name: "1 นาที" }));
    expect(screen.getByText(/ครั้งต่อวัน/)).toHaveTextContent(
      "ประมาณ 1,440 ครั้งต่อวัน",
    );
  });
});
