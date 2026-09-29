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
import {
  deleteMonitor,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  pauseMonitor,
  resumeMonitor,
} from "../../lib/api/monitors";
import {
  A,
  context,
  detail,
  MONITOR_ID,
  noChecks,
  noIncidents,
  noResponseTimes,
  NOW,
  renderDetail,
} from "./detail-test-support";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorDetail: vi.fn(),
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

const emptyList: MonitorListResponse = {
  summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
  monitors: [],
  page: { limit: 25, offset: 0, total: 0 },
  dataAsOf: "2026-09-30T07:32:05.000Z",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMeContextMock.mockResolvedValue(context());
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  vi.mocked(fetchMonitorList).mockResolvedValue(emptyList);
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
    const button = await screen.findByRole("button", { name: "หยุดชั่วคราว" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(button);

    expect(await screen.findByText("หยุดการตรวจแล้ว")).toBeInTheDocument();
    expect(pauseMock).toHaveBeenCalledExactlyOnceWith(A, MONITOR_ID);
    // Same node, relabelled: it was never unmounted, so focus stayed on it.
    expect(screen.getByRole("button", { name: "เริ่มต่อ" })).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.getAllByText("หยุดชั่วคราว").length).toBeGreaterThan(0);
    expect(
      screen.getByText("มอนิเตอร์นี้หยุดตรวจอยู่ จะไม่มีการแจ้งเตือน"),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["tenant", "monitors", A] }),
    );
  });

  it("resumes into 'ไม่ทราบสถานะ', never 'ปกติ' from the old result", async () => {
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
    const button = await screen.findByRole("button", { name: "เริ่มต่อ" });
    await user.click(button);

    expect(await screen.findByText("เริ่มการตรวจต่อแล้ว")).toBeInTheDocument();
    expect(resumeMock).toHaveBeenCalledExactlyOnceWith(A, MONITOR_ID);
    expect(screen.getByRole("button", { name: "หยุดชั่วคราว" })).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.getAllByText("ไม่ทราบสถานะ").length).toBeGreaterThan(0);
    expect(screen.queryByText("ปกติ")).toBeNull();
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
    await user.click(
      await screen.findByRole("button", { name: "หยุดชั่วคราว" }),
    );
    const pending = await screen.findByRole("button", { name: "กำลังหยุด…" });
    expect(pending).toHaveAttribute("aria-disabled", "true");
    await user.click(pending);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    finish(record(detail({ status: "paused" })));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "กำลังหยุด…" })).toBeNull();
    });
  });

  it("keeps the state and says so when pausing fails", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    pauseMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    const user = userEvent.setup();
    renderDetail();
    const button = await screen.findByRole("button", { name: "หยุดชั่วคราว" });
    await user.click(button);
    expect(
      await screen.findByText("หยุดการตรวจไม่สำเร็จ ลองอีกครั้ง"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "หยุดชั่วคราว" })).toBe(button);
    expect(button).toHaveFocus();
  });

  it("says 'สิทธิ์ของคุณเปลี่ยนแล้ว' and drops the buttons once the role is read-only", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    pauseMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    fetchMeContextMock
      .mockResolvedValueOnce(context())
      .mockResolvedValue(context("viewer"));
    const user = userEvent.setup();
    renderDetail();
    await user.click(
      await screen.findByRole("button", { name: "หยุดชั่วคราว" }),
    );
    expect(
      await screen.findByText("สิทธิ์ของคุณเปลี่ยนแล้ว"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "หยุดชั่วคราว" })).toBeNull();
    });
    expect(screen.getByText("สิทธิ์ของคุณ: ดูอย่างเดียว")).toBeInTheDocument();
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
    await user.click(
      await screen.findByRole("button", { name: "หยุดชั่วคราว" }),
    );
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
  });
});

describe("Delete", () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    const opener = await screen.findByRole("button", { name: "ลบมอนิเตอร์" });
    await user.click(opener);
    return { opener, dialog: await screen.findByRole("dialog") };
  }

  it("asks for confirmation with the consequence and starts on Cancel", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    expect(dialog).toHaveAccessibleName("ยืนยันการลบมอนิเตอร์");
    expect(dialog).toHaveTextContent(
      "ลบ Payments API (https://api.acme.example/health) ออกจากองค์กร Acme",
    );
    expect(dialog).toHaveTextContent(
      "ประวัติการตรวจและเหตุการณ์จะหายและกู้คืนไม่ได้ ถ้าต้องการเก็บประวัติ ให้ใช้หยุดชั่วคราวแทน",
    );
    expect(
      within(dialog).getByRole("button", { name: "ยกเลิก" }),
    ).toHaveFocus();
  });

  it("sends no request on Cancel and returns focus to the opener", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = userEvent.setup();
    renderDetail();
    const { opener, dialog } = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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
      within(dialog).getByRole("button", { name: "ลบมอนิเตอร์" }),
    );
    expect(
      await within(dialog).findByRole("button", { name: "กำลังลบ…" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
      within(dialog).getByRole("button", { name: "ลบมอนิเตอร์" }),
    );

    expect(await screen.findByText("ลบมอนิเตอร์แล้ว")).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledExactlyOnceWith(A, MONITOR_ID);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors`,
    );
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "ตรวจสถานะบริการ",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["tenant", "monitors", A] }),
    );
    // The deleted monitor is not read again on the way out.
    expect(fetchDetailMock).toHaveBeenCalledTimes(1);
  });

  it("does not show the notice again after a reload of the Overview state", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail();
    const { dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "ลบมอนิเตอร์" }),
    );
    await screen.findByText("ลบมอนิเตอร์แล้ว");
    await user.click(screen.getByRole("button", { name: "open detail" }));
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    expect(screen.queryByText("ลบมอนิเตอร์แล้ว")).toBeNull();
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
      within(dialog).getByRole("button", { name: "ลบมอนิเตอร์" }),
    );
    expect(
      await screen.findByText("มอนิเตอร์นี้ถูกลบแล้ว"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors`,
    );
  });

  it("closes the dialog with an error and gives focus back to the opener when the delete fails", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    deleteMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    const user = userEvent.setup();
    renderDetail();
    const { opener, dialog } = await openDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "ลบมอนิเตอร์" }),
    );
    expect(
      await screen.findByText("ลบมอนิเตอร์ไม่สำเร็จ ลองอีกครั้ง"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors/${MONITOR_ID}`,
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
      within(dialog).getByRole("button", { name: "ลบมอนิเตอร์" }),
    );
    expect(
      await screen.findByText("สิทธิ์ของคุณเปลี่ยนแล้ว"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "ลบมอนิเตอร์" })).toBeNull();
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors/${MONITOR_ID}`,
    );
  });
});
