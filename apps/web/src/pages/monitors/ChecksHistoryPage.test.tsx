import type {
  CheckResultView,
  MonitorChecksResponse,
} from "@nightwatch/api-contract";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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
  fetchMonitorResponseTimes,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  TENANT_QUERY_PREFIX,
  TenantProvider,
  useTenant,
} from "../../lib/tenant/TenantProvider";
import { ChecksHistoryPage } from "./ChecksHistoryPage";
import { DetailPage } from "./DetailPage";
import {
  A,
  B,
  baseResult,
  context,
  detail,
  MONITOR_ID,
  must,
  noIncidents,
  noResponseTimes,
  NOW,
} from "./detail-test-support";
import { formatDateTime } from "./format";
import { deferred } from "./form-test-support";

// The interval is read when a fetch starts or ends. It is long by default so that a refresh never takes a response a test queued for a load more; a test that exercises the interval shortens it just before the step it checks.
const refetch = vi.hoisted(() => ({ intervalMs: 60_000 }));
const REFRESH_FAST_MS = 60;

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
  get MONITOR_REFETCH_INTERVAL_MS() {
    return refetch.intervalMs;
  },
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorEvents: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchDetailMock = vi.mocked(fetchMonitorDetail);
const fetchChecksMock = vi.mocked(fetchMonitorChecks);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  refetch.intervalMs = 60_000;
  fetchMeContextMock.mockResolvedValue(context());
  fetchDetailMock.mockResolvedValue({ monitor: detail() });
  // What the real Detail page reads when a test navigates to it.
  vi.mocked(fetchMonitorEvents).mockResolvedValue({
    events: [],
    page: { limit: 20, offset: 0, total: 0 },
  });
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorLastResponse).mockResolvedValue({ response: null });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: true,
  });
});

afterEach(() => {
  // Unmount before the managers and the mocks change, or a late focus event refetches against a reset mock.
  cleanup();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.resetAllMocks();
});

const notFound = () => new ApiError("MONITOR_NOT_FOUND", "not found", 404);
const denied = () => new ApiError("MEMBERSHIP_DENIED", "denied", 403);
const network = () => new ApiError("NETWORK_ERROR", "down", 0);

const OLDEST_MS = Date.parse("2026-09-30T07:55:00.000Z");
// Result number `i` counts back from the newest at 5 minute steps; a smaller number is newer.
const scheduled = (i: number) =>
  new Date(OLDEST_MS - i * 300_000).toISOString();
function result(
  i: number,
  overrides: Partial<CheckResultView> = {},
): CheckResultView {
  return {
    ...baseResult,
    scheduledFor: scheduled(i),
    checkedAt: scheduled(i),
    ...overrides,
  };
}
const span = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => from + index);

/** One response of the checks API: the results numbered `numbers`, read at `offset` of `total`. */
function chunk(
  numbers: number[],
  offset: number,
  total: number,
  urlChanges: MonitorChecksResponse["urlChanges"] = [],
): MonitorChecksResponse {
  return {
    checks: numbers.map((i) => result(i)),
    page: { limit: 50, offset, total },
    urlChanges,
  };
}

function Harness() {
  const { switchOrg } = useTenant();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void switchOrg(B);
        }}
      >
        switch to B
      </button>
      <p data-testid="location">{useLocation().pathname}</p>
      <Routes>
        <Route
          path="/organizations/:organizationId/monitors/:monitorId/checks"
          element={<ChecksHistoryPage />}
        />
        <Route
          path="/organizations/:organizationId/monitors/:monitorId"
          element={<DetailPage />}
        />
        <Route
          path="/organizations/:organizationId/monitors"
          element={<p>Overview of another Organization</p>}
        />
      </Routes>
    </>
  );
}

function renderChecks(
  organizationId = A,
  monitorId = MONITOR_ID,
  client?: QueryClient,
) {
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter
            initialEntries={[
              `/organizations/${organizationId}/monitors/${monitorId}/checks`,
            ]}
          >
            <Harness />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    ),
  };
}

const loadMoreButton = () => screen.findByRole("button", { name: "โหลดเพิ่ม" });

/** Only the history rows: the assertion tables inside them have rows of their own. */
function historyRows(): HTMLElement[] {
  const region = screen.getByRole("region", { name: "ตารางประวัติการตรวจ" });
  return Array.from(
    region.querySelectorAll<HTMLElement>(":scope > table > tbody > tr"),
  );
}

// The count line of the page.
const COUNT_LINE = /^แสดง(ครบ \d+ รายการ| 1–\d+ จาก \d+)$/;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe("Checks history states", () => {
  it("shows a loading state under the monitor placeholder title, then the title and the checks", async () => {
    const pendingDetail = deferred<{ monitor: ReturnType<typeof detail> }>();
    fetchDetailMock.mockReturnValue(pendingDetail.promise);
    fetchChecksMock.mockReturnValue(new Promise(() => undefined));
    renderChecks();
    expect(await screen.findByText("กำลังโหลดประวัติการตรวจ")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "มอนิเตอร์",
    );
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();
    await act(async () => {
      pendingDetail.resolve({ monitor: detail() });
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
  });

  it("shows the empty state without a button or a count", async () => {
    fetchChecksMock.mockResolvedValue(chunk([], 0, 0));
    renderChecks();
    expect(await screen.findByText("ยังไม่มีผลการตรวจ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).toBeNull();
    expect(screen.queryByText(COUNT_LINE)).toBeNull();
  });

  it("keeps a failing history inside the page with a retry, never the empty state", async () => {
    fetchChecksMock.mockRejectedValue(network());
    renderChecks();
    expect(
      await screen.findByText("โหลดประวัติการตรวจไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีผลการตรวจ")).toBeNull();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
    fetchChecksMock.mockResolvedValue(chunk([], 0, 0));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("ยังไม่มีผลการตรวจ")).toBeInTheDocument();
  });

  it("shows the first 50 rows with a count and loads 50 more per press until the end", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(50, 100), 50, 120))
      .mockResolvedValueOnce(chunk(span(100, 120), 100, 120));
    const user = userEvent.setup();
    renderChecks();
    expect(
      await screen.findByRole("heading", { level: 2, name: "ประวัติการตรวจ" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("แสดง 1–50 จาก 120")).toBeInTheDocument();
    expect(historyRows()).toHaveLength(50);
    expect(fetchChecksMock).toHaveBeenLastCalledWith(A, MONITOR_ID, {
      limit: 50,
      offset: 0,
    });

    await user.click(await loadMoreButton());
    expect(await screen.findByText("แสดง 1–100 จาก 120")).toBeInTheDocument();
    expect(historyRows()).toHaveLength(100);
    expect(fetchChecksMock).toHaveBeenLastCalledWith(A, MONITOR_ID, {
      limit: 50,
      offset: 50,
    });

    await user.click(await loadMoreButton());
    expect(await screen.findByText("แสดงครบ 120 รายการ")).toBeInTheDocument();
    expect(historyRows()).toHaveLength(120);
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).toBeNull();
    expect(fetchChecksMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the button mounted and aria-disabled while loading, and ignores presses until it ends", async () => {
    const second = deferred<MonitorChecksResponse>();
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-disabled", "true");
    });
    expect(button).toBeEnabled();
    await user.click(button);
    await user.click(button);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(chunk(span(50, 100), 50, 120));
      await Promise.resolve();
    });
    expect(await screen.findByText("แสดง 1–100 จาก 120")).toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
  });

  it("shows the error above the button on a failed load more, keeps the rows and retries on the next press", async () => {
    const retry = deferred<MonitorChecksResponse>();
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockRejectedValueOnce(network())
      .mockReturnValueOnce(retry.promise);
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    refetch.intervalMs = REFRESH_FAST_MS;
    await user.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดประวัติการตรวจไม่สำเร็จ");
    expect(
      alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(historyRows()).toHaveLength(50);
    expect(screen.getByText("แสดง 1–50 จาก 120")).toBeInTheDocument();
    expect(button).toHaveTextContent("โหลดเพิ่ม");
    // The first chunk is not refreshed behind the Alert while it waits for the press.
    await sleep(250);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    await act(async () => {
      retry.resolve(chunk(span(50, 100), 50, 120));
      await Promise.resolve();
    });
    expect(await screen.findByText("แสดง 1–100 จาก 120")).toBeInTheDocument();
    expect(fetchChecksMock).toHaveBeenLastCalledWith(A, MONITOR_ID, {
      limit: 50,
      offset: 50,
    });
  });

  it("keeps the rows with a warning when the refresh of the first chunk fails", async () => {
    refetch.intervalMs = REFRESH_FAST_MS;
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 3), 0, 3))
      .mockRejectedValue(network());
    renderChecks();
    expect(
      await screen.findByText("อัปเดตประวัติการตรวจไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(historyRows()).toHaveLength(3);
    expect(screen.getByText("แสดงครบ 3 รายการ")).toBeInTheDocument();
  });
});

describe("Checks history offset drift", () => {
  // 5 results arrived after the first chunk, so the chunk at offset 50 starts at result 45 and repeats 45 to 49.
  const shifted = () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(45, 95), 50, 125));
  };

  it("shows no row twice and skips none when new results shifted the next chunk", async () => {
    shifted();
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    expect(await screen.findByText("แสดง 1–95 จาก 125")).toBeInTheDocument();
    const rows = historyRows();
    expect(rows).toHaveLength(95);
    // Newest first and contiguous: results 0 to 94, once each.
    const times = rows.map((row) => must(row.querySelector("time")).dateTime);
    expect(times).toEqual(span(0, 95).map(scheduled));
  });

  it("announces the added rows from the shown count, not from the chunk size", async () => {
    shifted();
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    await screen.findByText("แสดง 1–95 จาก 125");
    expect(screen.getByRole("status")).toHaveTextContent(
      "โหลดเพิ่ม 45 แถว (แถวที่ 51–95 จาก 125)",
    );
  });

  it("shows no result newer than the first chunk when more of them arrived than rows are loaded, and skips none of the older ones", async () => {
    // 100 results (numbers -100 to -1, newer than result 0) arrived after the first chunk. The chunk at offset 50 holds only newer rows, the one at offset 100 repeats rows 0 to 49, and the older rows follow at offset 150.
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(-50, 0), 50, 220))
      .mockResolvedValueOnce(chunk(span(0, 50), 100, 220))
      .mockResolvedValueOnce(chunk(span(50, 100), 150, 220));
    const user = userEvent.setup();
    renderChecks();
    const timesOf = () =>
      historyRows().map((row) => must(row.querySelector("time")).dateTime);

    await user.click(await loadMoreButton());
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("โหลดเพิ่ม 0 แถว");
    });
    // Newer rows are left out: the order stays newest first and the count stays honest.
    expect(timesOf()).toEqual(span(0, 50).map(scheduled));
    expect(screen.getByText("แสดง 1–50 จาก 220")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "โหลดเพิ่ม" }));
    await waitFor(() => {
      expect(fetchChecksMock).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("โหลดเพิ่ม 0 แถว");
    });
    expect(timesOf()).toEqual(span(0, 50).map(scheduled));
    expect(
      screen.getByRole("button", { name: "โหลดเพิ่ม" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "โหลดเพิ่ม" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "โหลดเพิ่ม 50 แถว (แถวที่ 51–100 จาก 220)",
      );
    });
    // Contiguous and newest first: results 0 to 99 once each, none skipped.
    expect(timesOf()).toEqual(span(0, 100).map(scheduled));
    expect(fetchChecksMock.mock.calls.map((call) => call[2])).toEqual([
      { limit: 50, offset: 0 },
      { limit: 50, offset: 50 },
      { limit: 50, offset: 100 },
      { limit: 50, offset: 150 },
    ]);
  });

  it("lists no URL change newer than the newest row loaded, even when a later chunk returns one", async () => {
    const at = (i: number) => new Date(Date.parse(scheduled(i)) - 60_000);
    const first = {
      at: at(49).toISOString(),
      url: "https://first.acme.example/health",
    };
    const deeper = {
      at: at(55).toISOString(),
      url: "https://deeper.acme.example/health",
    };
    // After result 0 was loaded: it is not part of the list this page opened with.
    const newer = {
      at: new Date(Date.parse(scheduled(-5)) + 60_000).toISOString(),
      url: "https://newer.acme.example/health",
    };
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 60, [first]))
      .mockResolvedValueOnce(
        chunk(span(50, 60), 50, 60, [first, deeper, newer]),
      );
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    await screen.findByText("แสดงครบ 60 รายการ");
    const listed = screen.getAllByText(/เปลี่ยน URL เมื่อ/, { selector: "li" });
    expect(listed).toHaveLength(2);
    expect(listed.map((item) => item.textContent).join(" ")).toContain(
      "https://deeper.acme.example/health",
    );
    expect(screen.queryByText("https://newer.acme.example/health")).toBeNull();
  });

  it("announces k = 0 without a row range when a chunk holds only rows already shown, and keeps the button", async () => {
    // 50 results arrived after the first chunk, so the chunk at offset 50 is the first chunk again.
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(0, 50), 50, 170));
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("โหลดเพิ่ม 0 แถว");
    });
    expect(historyRows()).toHaveLength(50);
    expect(screen.getByText("แสดง 1–50 จาก 170")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "โหลดเพิ่ม" }),
    ).toBeInTheDocument();
  });

  it("does not claim the list is complete when newer results are missing, and says so", async () => {
    // 10 results arrived after the first chunk: the last chunk repeats 10 rows and ends at offset 70 of 70.
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 60))
      .mockResolvedValueOnce(chunk(span(40, 60), 50, 70));
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    expect(await screen.findByText("แสดง 1–60 จาก 70")).toBeInTheDocument();
    expect(
      screen.getByText(
        "ผลตรวจที่ใหม่กว่าการโหลดครั้งแรกจะแสดงเมื่อเปิดหน้านี้ใหม่",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/แสดงครบ/)).toBeNull();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).toBeNull();
    expect(historyRows()).toHaveLength(60);
  });

  it("stops at an empty chunk even when the total says there is more", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk([], 50, 120));
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    refetch.intervalMs = REFRESH_FAST_MS;
    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).toBeNull();
    });
    expect(screen.getByText("แสดง 1–50 จาก 120")).toBeInTheDocument();
    await sleep(250);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
  });

  it("says it shows everything when retention shrank the total below the rows shown", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(50, 60), 50, 55));
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    expect(await screen.findByText("แสดงครบ 60 รายการ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).toBeNull();
  });
});

describe("Checks history URL changes", () => {
  it("marks the change that falls between two chunks once both are shown, and lists it once", async () => {
    // Between result 49 and result 50: result 49 is the first check after it.
    const between = {
      at: new Date(Date.parse(scheduled(49)) - 60_000).toISOString(),
      url: "https://new.acme.example/health",
    };
    const first = chunk(span(0, 50), 0, 60, [between]);
    must(first.checks[49]).url = between.url;
    fetchChecksMock
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(chunk(span(50, 60), 50, 60, [between]));
    const user = userEvent.setup();
    renderChecks();
    await loadMoreButton();
    // The oldest row of one chunk has no older neighbour to tell it apart from.
    expect(must(historyRows()[49])).not.toHaveTextContent("เปลี่ยน URL");
    expect(
      screen.getAllByText(/เปลี่ยน URL เมื่อ/, { selector: "li" }),
    ).toHaveLength(1);

    await user.click(await loadMoreButton());
    await screen.findByText("แสดงครบ 60 รายการ");
    const rows = historyRows();
    expect(must(rows[49])).toHaveTextContent("เปลี่ยน URL");
    expect(must(rows[49])).toHaveTextContent("https://new.acme.example/health");
    expect(
      rows.filter((row) => row.textContent.includes("เปลี่ยน URL")),
    ).toHaveLength(1);
    expect(
      screen.getAllByText(/เปลี่ยน URL เมื่อ/, { selector: "li" }),
    ).toHaveLength(1);
  });

  it("shows each check with its assertions and marks a URL change above the table", async () => {
    // Just before the newest result: the newest result is the first check after it.
    const changedAt = new Date(Date.parse(scheduled(0)) - 60_000).toISOString();
    fetchChecksMock.mockResolvedValue({
      checks: [
        result(0, {
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
        result(1),
      ],
      page: { limit: 50, offset: 0, total: 2 },
      urlChanges: [{ at: changedAt, url: "https://new.acme.example/health" }],
    });
    const user = userEvent.setup();
    renderChecks();
    await screen.findByRole("region", { name: "ตารางประวัติการตรวจ" });
    const rows = historyRows();
    expect(rows).toHaveLength(2);
    expect(must(rows[0])).toHaveTextContent("เปลี่ยน URL");
    expect(must(rows[0])).toHaveTextContent("ล้มเหลว");
    expect(must(rows[0])).toHaveTextContent("ไม่ผ่าน 1/1");
    expect(must(rows[1])).not.toHaveTextContent("เปลี่ยน URL");
    expect(
      screen.getByText(/เปลี่ยน URL เมื่อ/, { selector: "li" }),
    ).toHaveTextContent(formatDateTime(changedAt));
    await user.click(within(must(rows[0])).getByText("ไม่ผ่าน 1/1"));
    expect(within(must(rows[0])).getByText("เนื้อหามีข้อความ")).toBeVisible();
  });

  it("words a pass and a fail, and labels an actual value cut at 200 characters", async () => {
    const cut = "x".repeat(200);
    fetchChecksMock.mockResolvedValue({
      checks: [
        result(0, {
          outcome: "fail",
          failureReason: "assertion_failed",
          assertions: [
            {
              kind: "jsonPathEquals",
              expected: '"ok"',
              actual: cut,
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
      ],
      page: { limit: 50, offset: 0, total: 1 },
      urlChanges: [],
    });
    const user = userEvent.setup();
    renderChecks();
    await screen.findByRole("region", { name: "ตารางประวัติการตรวจ" });
    const row = must(historyRows()[0]);
    expect(row).toHaveTextContent("ไม่ผ่าน 1/2");
    await user.click(within(row).getByText("ไม่ผ่าน 1/2"));
    const table = within(row).getByRole("table", {
      name: /Assertions ของผลตรวจ/,
    });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(must(rows[0])).toHaveTextContent(cut);
    expect(must(rows[0])).toHaveTextContent("ตัดแล้ว");
    expect(must(rows[0])).toHaveTextContent("ไม่ผ่าน");
    expect(must(rows[1])).toHaveTextContent("ผ่าน");
    expect(must(rows[1])).not.toHaveTextContent("ตัดแล้ว");
    expect(within(table).getAllByText("ตัดแล้ว")).toHaveLength(1);
  });
});

// Wording of a saved result that the Detail last-result card used to show alone (AC-84).
describe("Checks history saved-result wording", () => {
  const reasonCell = (row: HTMLElement) =>
    must(within(row).getAllByRole("cell")[5]);

  it("words the cause of a TLS failure by its reason, and a handshake failure apart from an invalid certificate", async () => {
    fetchChecksMock.mockResolvedValue({
      checks: [
        result(0, {
          outcome: "fail",
          httpStatus: null,
          responseTimeMs: null,
          failureReason: "tls_invalid",
          tlsReason: "expired",
        }),
        result(1, {
          outcome: "fail",
          httpStatus: null,
          responseTimeMs: null,
          failureReason: "tls_invalid",
          tlsReason: "handshake_failed",
        }),
        result(2),
      ],
      page: { limit: 50, offset: 0, total: 3 },
      urlChanges: [],
    });
    renderChecks();
    await screen.findByRole("region", { name: "ตารางประวัติการตรวจ" });
    expect(
      screen.getByRole("columnheader", { name: "สาเหตุ" }),
    ).toBeInTheDocument();
    const rows = historyRows();
    expect(reasonCell(must(rows[0])).textContent).toBe(
      "ใบรับรองไม่ถูกต้อง: หมดอายุ",
    );
    expect(reasonCell(must(rows[1])).textContent).toBe(
      "เชื่อมต่อแบบปลอดภัยไม่สำเร็จ",
    );
    expect(reasonCell(must(rows[2])).textContent).toBe("–");
  });

  it("words a not-evaluated assertion, and a type mismatch with the type that came back", async () => {
    fetchChecksMock.mockResolvedValue({
      checks: [
        result(0, {
          outcome: "fail",
          httpStatus: null,
          responseTimeMs: null,
          failureReason: "tls_invalid",
          tlsReason: "expired",
          assertions: [
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
        }),
        result(1, {
          outcome: "fail",
          failureReason: "assertion_failed",
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
        }),
      ],
      page: { limit: 50, offset: 0, total: 2 },
      urlChanges: [],
    });
    const user = userEvent.setup();
    renderChecks();
    await screen.findByRole("region", { name: "ตารางประวัติการตรวจ" });
    const [skipped, mismatch] = historyRows().map(must);

    // Nothing was evaluated, so the row says so rather than "ผ่าน" or "ไม่ผ่าน".
    expect(skipped).toHaveTextContent("ไม่ได้ประเมิน 1/1");
    await user.click(within(must(skipped)).getByText("ไม่ได้ประเมิน 1/1"));
    const skippedRow = must(
      within(
        within(must(skipped)).getByRole("table", {
          name: /Assertions ของผลตรวจ/,
        }),
      ).getAllByRole("row")[1],
    );
    expect(skippedRow).toHaveTextContent("เวลาตอบสนองน้อยกว่า");
    expect(skippedRow).toHaveTextContent("800 ms");
    expect(skippedRow).toHaveTextContent("ไม่ได้ประเมิน");
    expect(skippedRow).toHaveTextContent("(ไม่มี response)");
    expect(skippedRow).not.toHaveTextContent("ไม่ผ่าน");

    await user.click(within(must(mismatch)).getByText("ไม่ผ่าน 1/1"));
    expect(
      within(must(mismatch)).getByText(
        /ชนิดข้อมูลไม่ตรง \(ค่าจริงเป็น string\)/,
      ),
    ).toBeInTheDocument();
  });
});

describe("Checks history focus and announcements", () => {
  it("keeps focus on the button and announces each load once in one live region that stays mounted", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 150))
      .mockResolvedValueOnce(chunk(span(50, 100), 50, 150));
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    const region = screen.getByRole("status");
    expect(region).toHaveClass("sr-only");
    expect(region).toBeEmptyDOMElement();
    act(() => {
      button.focus();
    });
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(region).toHaveTextContent(
        "โหลดเพิ่ม 50 แถว (แถวที่ 51–100 จาก 150)",
      );
    });
    expect(screen.getByRole("status")).toBe(region);
    expect(button).toHaveFocus();
    expect(screen.getByRole("button", { name: "โหลดเพิ่ม" })).toBe(button);
  });

  it("does not announce a background refresh of the first chunk", async () => {
    refetch.intervalMs = REFRESH_FAST_MS;
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 3), 0, 3))
      .mockResolvedValue(chunk(span(0, 4), 0, 4));
    renderChecks();
    expect(await screen.findByText("แสดงครบ 4 รายการ")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("moves focus to the summary on the final load when the button had it, and leaves the live region empty", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 60))
      .mockResolvedValueOnce(chunk(span(50, 60), 50, 60));
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    act(() => {
      button.focus();
    });
    await user.keyboard("{Enter}");
    const summary = must(
      (await screen.findByText("แสดงครบ 60 รายการ")).closest("p"),
    );
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    expect(summary).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).toBeNull();
  });

  it("leaves focus where the reader moved it during the final load, and announces the load", async () => {
    const last = deferred<MonitorChecksResponse>();
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 60))
      .mockReturnValueOnce(last.promise);
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    const back = screen.getByRole("link", { name: "กลับไปหน้ามอนิเตอร์" });
    act(() => {
      back.focus();
    });
    await act(async () => {
      last.resolve(chunk(span(50, 60), 50, 60));
      await Promise.resolve();
    });
    await screen.findByText("แสดงครบ 60 รายการ");
    expect(back).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "โหลดเพิ่ม 10 แถว (แถวที่ 51–60 จาก 60)",
    );
  });
});

describe("Checks history refresh", () => {
  it("refreshes the first chunk on the interval and shows a newer result", async () => {
    refetch.intervalMs = REFRESH_FAST_MS;
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(1, 4), 0, 3))
      .mockResolvedValue(chunk(span(0, 4), 0, 4));
    renderChecks();
    expect(await screen.findByText("แสดงครบ 3 รายการ")).toBeInTheDocument();
    expect(await screen.findByText("แสดงครบ 4 รายการ")).toBeInTheDocument();
    expect(historyRows()).toHaveLength(4);
  });

  it("refreshes the first chunk on window focus and on reconnect", async () => {
    fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
    renderChecks();
    await screen.findByText("แสดงครบ 3 รายการ");
    expect(fetchChecksMock).toHaveBeenCalledTimes(1);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(fetchChecksMock).toHaveBeenCalledTimes(2);
    });
    act(() => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(fetchChecksMock).toHaveBeenCalledTimes(3);
    });
  });

  it("does not refetch chunks on interval, focus or reconnect once a second chunk is loaded", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(50, 100), 50, 120));
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    refetch.intervalMs = REFRESH_FAST_MS;
    await user.click(button);
    await screen.findByText("แสดง 1–100 จาก 120");
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    // Several intervals long.
    await sleep(300);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
    expect(historyRows()).toHaveLength(100);
  });

  it("reopens on the first chunk alone, without refetching the chunks it had loaded", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(50, 100), 50, 120))
      .mockResolvedValue(chunk(span(0, 50), 0, 120));
    const user = userEvent.setup();
    const first = renderChecks();
    await user.click(await loadMoreButton());
    await screen.findByText("แสดง 1–100 จาก 120");
    first.unmount();
    await sleep(20);
    expect(
      first.queryClient
        .getQueryCache()
        .find({ queryKey: monitorQueryKeys.checksHistory(A, MONITOR_ID) }),
    ).toBeUndefined();

    fetchChecksMock.mockClear();
    renderChecks(A, MONITOR_ID, first.queryClient);
    expect(await screen.findByText("แสดง 1–50 จาก 120")).toBeInTheDocument();
    expect(historyRows()).toHaveLength(50);
    expect(fetchChecksMock).toHaveBeenCalledTimes(1);
    expect(fetchChecksMock).toHaveBeenCalledWith(A, MONITOR_ID, {
      limit: 50,
      offset: 0,
    });
  });
});

describe("Checks history access", () => {
  it.each(["owner", "admin", "viewer", "auditor"] as const)(
    "shows %s the history of a monitor in the Organization",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
      renderChecks();
      expect(
        await screen.findByRole("heading", { level: 1, name: "Payments API" }),
      ).toBeInTheDocument();
      expect(await screen.findByText("แสดงครบ 3 รายการ")).toBeInTheDocument();
      expect(historyRows()).toHaveLength(3);
      expect(fetchChecksMock).toHaveBeenCalledWith(A, MONITOR_ID, {
        limit: 50,
        offset: 0,
      });
    },
  );

  it("shows denied to a non-member without fetching, naming the Organization or the monitor", async () => {
    renderChecks(B.replace("2222", "3333"));
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(fetchDetailMock).not.toHaveBeenCalled();
    expect(fetchChecksMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Payments API")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();
  });

  it("shows denied, with no rows or names, only after re-reading the membership when the API refuses", async () => {
    fetchDetailMock.mockRejectedValue(denied());
    fetchChecksMock.mockRejectedValue(denied());
    const reread = deferred<ReturnType<typeof context>>();
    fetchMeContextMock
      .mockResolvedValueOnce(context())
      .mockReturnValueOnce(reread.promise);
    renderChecks();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.queryByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeNull();
    await act(async () => {
      reread.resolve(
        context("viewer", [
          { id: B, name: "Beta", slug: "beta", role: "owner" },
        ]),
      );
      await Promise.resolve();
    });
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Payments API")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it.each([
    ["a monitor that does not exist", MONITOR_ID],
    ["a malformed id", "not-a-uuid"],
    [
      "a monitor of another Organization",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ],
  ])(
    "answers %s with the same not-found text and a link back to the list",
    async (_name, monitorId) => {
      fetchDetailMock.mockRejectedValue(notFound());
      fetchChecksMock.mockRejectedValue(notFound());
      renderChecks(A, monitorId);
      expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
      expect(
        screen.getAllByRole("link", { name: "กลับไปรายการมอนิเตอร์" })[0],
      ).toHaveAttribute("href", `/organizations/${A}/monitors`);
      expect(screen.queryByText("Payments API")).toBeNull();
      expect(
        screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
      ).toBeNull();
    },
  );

  it("shows not-found when only the checks answer 404, without the monitor name from the detail", async () => {
    fetchChecksMock.mockRejectedValue(notFound());
    renderChecks();
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(screen.queryByText("Payments API")).toBeNull();
  });

  it("shows not-found when only the detail answers 404, without the rows", async () => {
    fetchDetailMock.mockRejectedValue(notFound());
    fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
    renderChecks();
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();
    expect(screen.queryByText(COUNT_LINE)).toBeNull();
  });

  it("drops the loaded rows and stops refreshing when a load more is answered 404", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockRejectedValueOnce(notFound());
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    refetch.intervalMs = REFRESH_FAST_MS;
    await user.click(button);
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();
    expect(screen.queryByText("Payments API")).toBeNull();
    expect(screen.queryByText(COUNT_LINE)).toBeNull();
    await sleep(250);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
  });

  it("drops the loaded rows and the names when a load more is answered 403 and the membership is gone", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockRejectedValueOnce(denied());
    fetchMeContextMock
      .mockResolvedValueOnce(context())
      .mockResolvedValue(
        context("viewer", [
          { id: B, name: "Beta", slug: "beta", role: "owner" },
        ]),
      );
    const user = userEvent.setup();
    renderChecks();
    const button = await loadMoreButton();
    refetch.intervalMs = REFRESH_FAST_MS;
    await user.click(button);
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();
    expect(screen.queryByText("Payments API")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(screen.queryByText(COUNT_LINE)).toBeNull();
    await sleep(250);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
  });

  it("leaves for the new Organization's Overview with no rows from the old one, even when a load more lands late", async () => {
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    const late = deferred<MonitorChecksResponse>();
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockReturnValueOnce(late.promise);
    const user = userEvent.setup();
    const { queryClient } = renderChecks();
    expect(monitorQueryKeys.checksHistory(A, MONITOR_ID).slice(0, 1)).toEqual(
      TENANT_QUERY_PREFIX,
    );
    await user.click(await loadMoreButton());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "โหลดเพิ่ม" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
    await user.click(screen.getByRole("button", { name: "switch to B" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/monitors`,
      );
    });
    await act(async () => {
      late.resolve(chunk(span(50, 100), 50, 120));
      await Promise.resolve();
    });
    expect(
      screen.getByText("Overview of another Organization"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Payments API")).toBeNull();
    expect(screen.queryByText(COUNT_LINE)).toBeNull();
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();
    // The unobserved entry leaves the cache on a zero-delay gc timer (gcTime 0), which is a macrotask: under load it can run after the last microtask above.
    await waitFor(() => {
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: monitorQueryKeys.checksHistory(A, MONITOR_ID) }),
      ).toBeUndefined();
    });
  });
});

describe("Checks history links", () => {
  it("opens the checks history from the Detail page and returns to it, both as client navigation", async () => {
    fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
    const user = userEvent.setup();
    renderChecks();
    await screen.findByText("แสดงครบ 3 รายการ");

    const back = screen.getByRole("link", { name: "กลับไปหน้ามอนิเตอร์" });
    expect(back).toHaveAttribute(
      "href",
      `/organizations/${A}/monitors/${MONITOR_ID}`,
    );
    // The router takes the click over: no document load.
    expect(fireEvent.click(back)).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/monitors/${MONITOR_ID}`,
      );
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ตารางประวัติการตรวจ" }),
    ).toBeNull();

    const open = screen.getByRole("link", { name: "ดูประวัติการตรวจ" });
    expect(open).toHaveAttribute(
      "href",
      `/organizations/${A}/monitors/${MONITOR_ID}/checks`,
    );
    await user.click(open);
    expect(await screen.findByText("แสดงครบ 3 รายการ")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors/${MONITOR_ID}/checks`,
    );
  });

  it("keeps the monitor leaf active on the checks history path", () => {
    const leaf = { path: "/organizations/:organizationId/monitors" };
    expect(
      isLeafActive(leaf, `/organizations/${A}/monitors/${MONITOR_ID}/checks`),
    ).toBe(true);
  });
});
