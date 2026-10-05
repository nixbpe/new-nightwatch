import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLeafActive } from "../../components/shell/nav-config";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
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
import { noChecks, noIncidents, noResponseTimes } from "./detail-test-support";
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
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
}));

const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);

beforeEach(() => {
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
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
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

const saveEdit = () =>
  screen.getByRole("button", { name: /^(บันทึกการแก้ไข|กำลังบันทึก…)$/ });

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
    await screen.findByDisplayValue("Payments API");
    expect(screen.getByRole("radio", { name: "ขั้นสูง" })).toBeChecked();
    expect(screen.getByLabelText("เมธอด")).toHaveValue("POST");
    expect(screen.getByLabelText("หมดเวลารอ (วินาที)")).toHaveValue("5");
    expect(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ")).toHaveValue(
      "200-299,301",
    );
    expect(screen.getByLabelText("ชื่อ query param แถวที่ 1")).toHaveValue(
      "page",
    );
    expect(screen.getByLabelText("เนื้อหา")).toHaveValue("ping");
    expect(screen.getByLabelText("JSONPath แถวที่ 1")).toHaveValue("$.status");
    expect(
      screen.getByLabelText("เวลาตอบสนองน้อยกว่าแถวที่ 2 (มิลลิวินาที)"),
    ).toHaveValue("800");
  });

  it("opens in basic mode when nothing advanced is set", async () => {
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    expect(screen.getByRole("radio", { name: "พื้นฐาน" })).toBeChecked();
    expect(screen.queryByText(/มีการตั้งค่าขั้นสูง/)).toBeNull();
  });

  it("shows a loading state, then an error with retry when the load fails", async () => {
    detailMock.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "x", 500));
    const user = userEvent.setup();
    renderForm(editPath());
    expect(
      await screen.findByText("โหลดการตั้งค่าไม่สำเร็จ"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByDisplayValue("Payments API")).toBeInTheDocument();
  });

  it.each([
    ["a missing id", "99999999-9999-4999-8999-999999999999"],
    ["a malformed id", "not-a-uuid"],
    ["an id of another Organization", "22222222-aaaa-4aaa-8aaa-222222222222"],
  ])("shows the same not-found text for %s", async (_label, id) => {
    // The API answers the three the same way (AC-48), so the page cannot tell them apart.
    detailMock.mockRejectedValue(new ApiError("MONITOR_NOT_FOUND", "nf", 404));
    renderForm(editPath(A, id));
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อมอนิเตอร์")).toBeNull();
  });

  it("keeps the nav leaf active on /new and /edit", () => {
    const leaf = { path: "/organizations/:organizationId/monitors" };
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
    await screen.findByDisplayValue("Payments API");
    await user.click(saveEdit());
    await user.click(saveEdit());
    await user.keyboard("{Enter}");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveEdit()).toHaveFocus();
    pending.resolve({ monitor: record({ version: 4 }) });
    await screen.findByTestId("location");
  });

  it("shows the stored alerts and sends them unchanged, as one complete object, when only another field changes", async () => {
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
    const name = await screen.findByDisplayValue("Payments API");
    expect(screen.getByLabelText("แจ้งเมื่อล้มเหลวติดกัน")).toHaveValue("3");
    expect(
      screen.getByRole("checkbox", { name: "แจ้งเมื่อล่มและกลับมาปกติ" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "แจ้งเมื่อ SSL ใกล้หมดอายุ" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("แจ้งล่วงหน้าก่อนหมดอายุ (วัน)")).toHaveValue(
      "12",
    );
    await user.type(name, " v2");
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
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
    await screen.findByDisplayValue("Payments API");
    await user.click(saveEdit());
    await waitFor(() => {
      expect(
        screen.getByLabelText("ค่า query param แถวที่ 1"),
      ).toHaveAccessibleDescription("ค่ายาวได้ไม่เกิน 4 KiB");
    });
    expect(screen.getByLabelText("ค่า query param แถวที่ 1")).toHaveFocus();
  });

  it("keeps the edited values and blocks actions when the role drops", async () => {
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "d", 403));
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    await user.type(name, " mine");
    vi.mocked(fetchMeContext).mockResolvedValue(context("auditor"));
    await user.click(saveEdit());
    expect(
      (await screen.findAllByText("สิทธิ์ของคุณเปลี่ยนแล้ว")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
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
    await screen.findByDisplayValue("Payments API");
    vi.mocked(fetchMeContext).mockResolvedValue(
      context("owner", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    await user.click(saveEdit());
    expect(
      await screen.findByText(
        "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Payments API")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it.each(["viewer", "auditor"] as const)(
    "shows denied to a %s who opens /edit directly, without loading the monitor",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      renderForm(editPath());
      expect(
        await screen.findByText(
          "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้",
        ),
      ).toBeInTheDocument();
      expect(detailMock).not.toHaveBeenCalled();
    },
  );
});
