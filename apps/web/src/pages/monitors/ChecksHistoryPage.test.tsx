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
import { bindQueryClientIdentity } from "../../lib/queryClient";
import { fetchProjectDetail } from "../../lib/api/projects";
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
  P,
  projectDetail,
} from "./detail-test-support";
import { TIME_ZONE } from "./format";
import { deferred } from "./form-test-support";

// The interval is read when a fetch starts or ends. It is long by default so that a refresh never takes a response a test queued for a load more; a test that exercises the interval shortens it just before the step it checks.
const refetch = vi.hoisted(() => ({ intervalMs: 60_000 }));
const REFRESH_FAST_MS = 60;

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
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
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
        data-testid="checks-harness-switch"
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
          path="/organizations/:organizationId/projects/:projectId/monitors/:monitorId/checks"
          element={<ChecksHistoryPage />}
        />
        <Route
          path="/organizations/:organizationId/projects/:projectId/monitors/:monitorId"
          element={<DetailPage />}
        />
        <Route
          path="/organizations/:organizationId/projects"
          element={
            <p data-testid="checks-harness-overview">
              Projects of another Organization
            </p>
          }
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
  bindQueryClientIdentity(queryClient, "user-1");
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter
            initialEntries={[
              `/organizations/${organizationId}/projects/${P}/monitors/${monitorId}/checks`,
            ]}
          >
            <Harness />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    ),
  };
}

const loadMoreButton = () => screen.findByTestId("monitor-checks-load-more");

/** Only the history rows: the assertion tables inside them have rows of their own. */
function historyRows(): HTMLElement[] {
  return within(screen.getByTestId("monitor-checks-records")).queryAllByTestId(
    "monitor-check-row",
  );
}

// The count line of the page.

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitCount(values: number[]) {
  await waitFor(() => {
    expect(
      screen
        .getByTestId("monitor-checks-count")
        .textContent.match(/\d+/g)
        ?.map(Number),
    ).toEqual(values);
  });
  return screen.getByTestId("monitor-checks-summary");
}
function announcementNumbers() {
  return screen
    .getByTestId("monitor-checks-announcement")
    .textContent.match(/\d+/g)
    ?.map(Number);
}
function checkTimes() {
  return historyRows().map((row) => {
    const time = within(row).getByTestId("monitor-check-time");
    const iso = must(time.getAttribute("dateTime"));
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveTextContent(
      new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
    return iso;
  });
}
function assertionRecords(row: HTMLElement) {
  const table = within(row).getByTestId("monitor-check-assertion-table");
  expect(table.tagName).toBe("TABLE");
  expect(table).toHaveAccessibleName(/\S/);
  return within(table)
    .getAllByTestId("monitor-check-assertion-table-row")
    .map((record) => {
      const actual = within(record)
        .getByTestId("monitor-check-assertion-table-actual")
        .cloneNode(true) as HTMLElement;
      within(actual)
        .queryByTestId("monitor-check-assertion-table-truncated")
        ?.remove();
      return {
        expected: within(record)
          .getByTestId("monitor-check-assertion-table-expected")
          .textContent.trim(),
        actual:
          record.getAttribute("data-has-actual") === "true"
            ? actual.textContent.trim()
            : null,
        status: record.getAttribute("data-status"),
        truncated: record.getAttribute("data-truncated"),
        label: within(record)
          .getByTestId("monitor-check-assertion-table-label")
          .textContent.trim(),
        description: within(record)
          .getByTestId("monitor-check-assertion-table-status")
          .textContent.trim(),
      };
    });
}

describe("Checks history states", () => {
  it("shows a loading state under the monitor placeholder title, then the title and the checks", async () => {
    const pendingDetail = deferred<{ monitor: ReturnType<typeof detail> }>();
    fetchDetailMock.mockReturnValue(pendingDetail.promise);
    fetchChecksMock.mockReturnValue(new Promise(() => undefined));
    renderChecks();
    expect(await screen.findByTestId("monitor-checks-loading")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("monitor-checks-title")).toHaveTextContent(/\S/);
    expect(screen.getByTestId("monitor-checks-title").tagName).toBe("H1");
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
    await act(async () => {
      pendingDetail.resolve({ monitor: detail() });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("monitor-checks-title")).toHaveTextContent(
        /^Payments API$/,
      );
    });
  });

  it("shows the empty state without a button or a count", async () => {
    fetchChecksMock.mockResolvedValue(chunk([], 0, 0));
    renderChecks();
    expect(
      await screen.findByTestId("monitor-checks-empty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
    expect(screen.queryByTestId("monitor-checks-count")).toBeNull();
  });

  it("keeps a failing history inside the page with a retry, never the empty state", async () => {
    fetchChecksMock.mockRejectedValue(network());
    renderChecks();
    expect(
      await screen.findByTestId("monitor-checks-load-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-checks-empty")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("monitor-checks-title")).toHaveTextContent(
        /^Payments API$/,
      );
    });
    fetchChecksMock.mockResolvedValue(chunk([], 0, 0));
    await userEvent.setup().click(screen.getByTestId("monitor-checks-retry"));
    expect(
      await screen.findByTestId("monitor-checks-empty"),
    ).toBeInTheDocument();
  });

  it("shows the first 50 rows with a count and loads 50 more per press until the end", async () => {
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 120))
      .mockResolvedValueOnce(chunk(span(50, 100), 50, 120))
      .mockResolvedValueOnce(chunk(span(100, 120), 100, 120));
    const user = userEvent.setup();
    renderChecks();
    expect(
      await screen.findByTestId("monitor-checks-heading"),
    ).toBeInTheDocument();
    expect(await waitCount([1, 50, 120])).toBeInTheDocument();
    expect(historyRows()).toHaveLength(50);
    expect(fetchChecksMock).toHaveBeenLastCalledWith(A, P, MONITOR_ID, {
      limit: 50,
      offset: 0,
    });

    await user.click(await loadMoreButton());
    expect(await waitCount([1, 100, 120])).toBeInTheDocument();
    expect(historyRows()).toHaveLength(100);
    expect(fetchChecksMock).toHaveBeenLastCalledWith(A, P, MONITOR_ID, {
      limit: 50,
      offset: 50,
    });

    await user.click(await loadMoreButton());
    expect(await waitCount([120])).toBeInTheDocument();
    expect(historyRows()).toHaveLength(120);
    expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
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
    expect(await waitCount([1, 100, 120])).toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
  });

  it("shows the error on a failed load more, keeps the rows and retries on the next press", async () => {
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
    const alert = await screen.findByTestId("monitor-checks-load-error");
    expect(alert).toHaveTextContent(/\S/);
    expect(alert).toHaveAttribute("role", "alert");
    expect(historyRows()).toHaveLength(50);
    expect(await waitCount([1, 50, 120])).toBeInTheDocument();
    expect(button).toHaveAccessibleName(/\S/);
    // The first chunk is not refreshed behind the Alert while it waits for the press.
    await sleep(250);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("monitor-checks-load-error")).toBeInTheDocument();

    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByTestId("monitor-checks-load-error")).toBeNull();
    });
    await act(async () => {
      retry.resolve(chunk(span(50, 100), 50, 120));
      await Promise.resolve();
    });
    expect(await waitCount([1, 100, 120])).toBeInTheDocument();
    expect(fetchChecksMock).toHaveBeenLastCalledWith(A, P, MONITOR_ID, {
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
      await screen.findByTestId("monitor-checks-refresh-error"),
    ).toBeInTheDocument();
    expect(historyRows()).toHaveLength(3);
    expect(await waitCount([3])).toBeInTheDocument();
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
    expect(await waitCount([1, 95, 125])).toBeInTheDocument();
    const rows = historyRows();
    expect(rows).toHaveLength(95);
    // Newest first and contiguous: results 0 to 94, once each.
    const times = rows.map((row) =>
      within(row).getByTestId("monitor-check-time").getAttribute("dateTime"),
    );
    expect(times).toEqual(span(0, 95).map(scheduled));
  });

  it("announces the added rows from the shown count, not from the chunk size", async () => {
    shifted();
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    await waitCount([1, 95, 125]);
    expect(announcementNumbers()).toEqual([45, 51, 95, 125]);
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
    const timesOf = () => checkTimes();

    await user.click(await loadMoreButton());
    await waitFor(() => {
      expect(announcementNumbers()).toEqual([0]);
    });
    // Newer rows are left out: the order stays newest first and the count stays honest.
    expect(timesOf()).toEqual(span(0, 50).map(scheduled));
    expect(await waitCount([1, 50, 220])).toBeInTheDocument();

    await user.click(screen.getByTestId("monitor-checks-load-more"));
    await waitFor(() => {
      expect(fetchChecksMock).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(announcementNumbers()).toEqual([0]);
    });
    expect(timesOf()).toEqual(span(0, 50).map(scheduled));
    expect(screen.getByTestId("monitor-checks-load-more")).toBeInTheDocument();

    await user.click(screen.getByTestId("monitor-checks-load-more"));
    await waitFor(() => {
      expect(announcementNumbers()).toEqual([50, 51, 100, 220]);
    });
    // Contiguous and newest first: results 0 to 99 once each, none skipped.
    expect(timesOf()).toEqual(span(0, 100).map(scheduled));
    expect(fetchChecksMock.mock.calls.map((call) => call[3])).toEqual([
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
    await waitCount([60]);
    const listed = screen.getAllByTestId("monitor-check-url-change");
    expect(listed).toHaveLength(2);
    expect(listed.map((item) => item.textContent).join(" ")).toContain(
      "https://deeper.acme.example/health",
    );
    expect(document.body.textContent).not.toContain(
      "https://newer.acme.example/health",
    );
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
      expect(announcementNumbers()).toEqual([0]);
    });
    expect(historyRows()).toHaveLength(50);
    expect(await waitCount([1, 50, 170])).toBeInTheDocument();
    expect(screen.getByTestId("monitor-checks-load-more")).toBeInTheDocument();
  });

  it("does not claim the list is complete when newer results are missing, and says so", async () => {
    // 10 results arrived after the first chunk: the last chunk repeats 10 rows and ends at offset 70 of 70.
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 60))
      .mockResolvedValueOnce(chunk(span(40, 60), 50, 70));
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    expect(await waitCount([1, 60, 70])).toBeInTheDocument();
    expect(screen.getByTestId("monitor-checks-count")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-checks-count")).not.toHaveAttribute(
      "data-complete",
      "true",
    );
    expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
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
      expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
    });
    expect(await waitCount([1, 50, 120])).toBeInTheDocument();
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
    expect(await waitCount([60])).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
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
    expect(historyRows()).toHaveLength(50);
    expect(
      within(screen.getByTestId("monitor-checks-records")).queryAllByTestId(
        "monitor-check-url-changed",
      ),
    ).toHaveLength(0);
    expect(screen.getAllByTestId("monitor-check-url-change")).toHaveLength(1);
    await user.click(await loadMoreButton());
    await waitCount([60]);
    expect(historyRows()).toHaveLength(60);
    const markers = within(
      screen.getByTestId("monitor-checks-records"),
    ).getAllByTestId("monitor-check-url-changed");
    expect(markers).toHaveLength(1);
    expect(
      within(must(markers[0])).getByTestId("monitor-check-changed-url"),
    ).toHaveTextContent(/^https:\/\/new\.acme\.example\/health$/);
    const marked = historyRows().filter(
      (row) => within(row).queryByTestId("monitor-check-url-changed") !== null,
    );
    expect(marked).toHaveLength(1);
    expect(
      within(must(marked[0])).getByTestId("monitor-check-time"),
    ).toHaveAttribute("dateTime", scheduled(49));
    expect(screen.getAllByTestId("monitor-check-url-change")).toHaveLength(1);
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
    await screen.findByTestId("monitor-checks-table");
    const rows = historyRows();
    expect(rows).toHaveLength(2);
    expect(checkTimes()).toEqual([scheduled(0), scheduled(1)]);
    const failed = rows.filter(
      (row) =>
        within(row)
          .getByTestId("monitor-check-time-cell")
          .getAttribute("data-outcome") === "fail",
    );
    expect(failed).toHaveLength(1);
    const row = must(failed[0]);
    expect(within(row).getByTestId("monitor-check-time-cell")).toHaveAttribute(
      "data-failure-reason",
      "assertion_failed",
    );
    expect(
      within(row).getByTestId("monitor-check-cell-outcome"),
    ).toHaveTextContent(/\S/);
    expect(
      within(row).getByTestId("monitor-check-cell-http"),
    ).toHaveTextContent(/^200$/);
    expect(
      within(row).getByTestId("monitor-check-cell-response"),
    ).toHaveTextContent(/^182 ms$/);
    expect(
      within(row).getByTestId("monitor-check-changed-url"),
    ).toHaveTextContent("https://new.acme.example/health");
    const summary = within(row).getByTestId("monitor-check-assertions-summary");
    expect(summary.textContent.match(/\d+/g)).toEqual(["1", "1"]);
    expect(
      within(screen.getByTestId("monitor-checks-records")).getAllByTestId(
        "monitor-check-url-changed",
      ),
    ).toHaveLength(1);
    const change = screen.getByTestId("monitor-check-url-change");
    expect(
      within(change).getByTestId("monitor-check-url-change-time"),
    ).toHaveAttribute("dateTime", changedAt);
    expect(change).toHaveTextContent(TIME_ZONE);
    expect(
      within(change).getByTestId("monitor-check-url-change-url"),
    ).toHaveTextContent("https://new.acme.example/health");
    await user.click(summary);
    expect(within(row).getByTestId("monitor-check-assertions")).toHaveAttribute(
      "open",
    );
    expect(assertionRecords(row)).toHaveLength(1);
    expect(
      assertionRecords(row).map(({ expected, actual, status, truncated }) => ({
        expected,
        actual,
        status,
        truncated,
      })),
    ).toEqual([
      { expected: "ok", actual: null, status: "fail", truncated: "false" },
    ]);
    expect(
      within(row).getByTestId("monitor-check-assertion-table-label"),
    ).toHaveTextContent(/\S/);
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
    await screen.findByTestId("monitor-checks-table");
    const rows = historyRows();
    expect(rows).toHaveLength(1);
    const row = must(rows[0]);
    const summary = within(row).getByTestId("monitor-check-assertions-summary");
    expect(summary.textContent.match(/\d+/g)).toEqual(["1", "2"]);
    await user.click(summary);
    expect(within(row).getByTestId("monitor-check-assertions")).toHaveAttribute(
      "open",
    );
    const records = assertionRecords(row);
    expect(records).toHaveLength(2);
    expect(
      records.map(({ expected, actual, status, truncated }) => ({
        expected,
        actual,
        status,
        truncated,
      })),
    ).toEqual([
      { expected: '"ok"', actual: cut, status: "fail", truncated: "true" },
      { expected: "ready", actual: null, status: "pass", truncated: "false" },
    ]);
    for (const record of records) {
      expect(record.label).toMatch(/\S/);
      expect(record.description).toMatch(/\S/);
    }
    expect(
      within(row).getAllByTestId("monitor-check-assertion-table-truncated"),
    ).toHaveLength(1);
  });
});

// Wording of a saved result that the Detail last-result card used to show alone (AC-84).
describe("Checks history saved-result wording", () => {
  const reasonCell = (row: HTMLElement) =>
    within(row).getByTestId("monitor-check-cell-reason");

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
    await screen.findByTestId("monitor-checks-table");
    const rows = historyRows();
    expect(rows).toHaveLength(3);
    expect(checkTimes()).toEqual([scheduled(0), scheduled(1), scheduled(2)]);
    const records = rows.map((row) => ({
      reason: within(row)
        .getByTestId("monitor-check-time-cell")
        .getAttribute("data-failure-reason"),
      tls: within(row)
        .getByTestId("monitor-check-time-cell")
        .getAttribute("data-tls-reason"),
      text: reasonCell(row).textContent,
    }));
    expect(records.map(({ reason, tls }) => ({ reason, tls }))).toEqual([
      { reason: "tls_invalid", tls: "expired" },
      { reason: "tls_invalid", tls: "handshake_failed" },
      { reason: null, tls: null },
    ]);
    expect(new Set(records.map((x) => x.text)).size).toBe(3);
    expect(records.filter((x) => x.reason === null).map((x) => x.text)).toEqual(
      ["–"],
    );
    expect(
      rows.map(
        (row) => within(row).getByTestId("monitor-check-cell-http").textContent,
      ),
    ).toEqual(["–", "–", "200"]);
    expect(
      rows.map(
        (row) =>
          within(row).getByTestId("monitor-check-cell-response").textContent,
      ),
    ).toEqual(["–", "–", "182 ms"]);
    for (const row of rows) {
      expect(reasonCell(row)).toHaveTextContent(/\S/);
    }
    expect(screen.getByTestId("monitor-check-heading-reason").tagName).toBe(
      "TH",
    );
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
    await screen.findByTestId("monitor-checks-table");
    const rows = historyRows();
    expect(rows).toHaveLength(2);
    expect(checkTimes()).toEqual([scheduled(0), scheduled(1)]);
    for (const row of rows) {
      const summary = within(row).getByTestId(
        "monitor-check-assertions-summary",
      );
      expect(summary.textContent.match(/\d+/g)).toEqual(["1", "1"]);
      await user.click(summary);
      expect(
        within(row).getByTestId("monitor-check-assertions"),
      ).toHaveAttribute("open");
    }
    const records = rows.flatMap(assertionRecords);
    expect(records).toHaveLength(2);
    expect(
      records.map(({ expected, actual, status, truncated }) => ({
        expected,
        actual,
        status,
        truncated,
      })),
    ).toEqual([
      {
        expected: "800 ms",
        actual: null,
        status: "not_evaluated",
        truncated: "false",
      },
      { expected: "1", actual: '"1"', status: "fail", truncated: "false" },
    ]);
    for (const record of records) {
      expect(record.label).toMatch(/\S/);
      expect(record.description).toMatch(/\S/);
    }
    expect(new Set(records.map((x) => x.description)).size).toBe(2);
    expect(
      records.filter((x) => x.status === "fail").map((x) => x.description),
    ).toEqual([expect.stringContaining("string")]);
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
    const region = screen.getByTestId("monitor-checks-announcement");
    expect(region).toHaveAttribute("role", "status");
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(region).toBeEmptyDOMElement();
    act(() => {
      button.focus();
    });
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(announcementNumbers()).toEqual([50, 51, 100, 150]);
    });
    expect(screen.getByTestId("monitor-checks-announcement")).toBe(region);
    expect(button).toHaveFocus();
    expect(screen.getByTestId("monitor-checks-load-more")).toBe(button);
  });

  it("does not announce a background refresh of the first chunk", async () => {
    refetch.intervalMs = REFRESH_FAST_MS;
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 3), 0, 3))
      .mockResolvedValue(chunk(span(0, 4), 0, 4));
    renderChecks();
    expect(await waitCount([4])).toBeInTheDocument();
    expect(
      screen.getByTestId("monitor-checks-announcement"),
    ).toBeEmptyDOMElement();
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
    const summary = await waitCount([60]);
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    expect(summary).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByTestId("monitor-checks-announcement"),
    ).toBeEmptyDOMElement();
    expect(screen.queryByTestId("monitor-checks-load-more")).toBeNull();
  });

  it("leaves focus where the reader moved it during the final load, and announces the load", async () => {
    const last = deferred<MonitorChecksResponse>();
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(0, 50), 0, 60))
      .mockReturnValueOnce(last.promise);
    const user = userEvent.setup();
    renderChecks();
    await user.click(await loadMoreButton());
    const back = screen.getByTestId("monitor-checks-back");
    act(() => {
      back.focus();
    });
    await act(async () => {
      last.resolve(chunk(span(50, 60), 50, 60));
      await Promise.resolve();
    });
    await waitCount([60]);
    expect(back).toHaveFocus();
    expect(announcementNumbers()).toEqual([10, 51, 60, 60]);
  });
});

describe("Checks history refresh", () => {
  it("refreshes the first chunk on the interval and shows a newer result", async () => {
    refetch.intervalMs = REFRESH_FAST_MS;
    fetchChecksMock
      .mockResolvedValueOnce(chunk(span(1, 4), 0, 3))
      .mockResolvedValue(chunk(span(0, 4), 0, 4));
    renderChecks();
    expect(await waitCount([3])).toBeInTheDocument();
    expect(await waitCount([4])).toBeInTheDocument();
    expect(historyRows()).toHaveLength(4);
  });

  it("refreshes the first chunk on window focus and on reconnect", async () => {
    fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
    renderChecks();
    await waitCount([3]);
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
    await waitCount([1, 100, 120]);
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
    await waitCount([1, 100, 120]);
    first.unmount();
    await sleep(20);
    expect(
      first.queryClient
        .getQueryCache()
        .find({ queryKey: monitorQueryKeys.checksHistory(A, P, MONITOR_ID) }),
    ).toBeUndefined();

    fetchChecksMock.mockClear();
    renderChecks(A, MONITOR_ID, first.queryClient);
    expect(await waitCount([1, 50, 120])).toBeInTheDocument();
    expect(historyRows()).toHaveLength(50);
    expect(fetchChecksMock).toHaveBeenCalledTimes(1);
    expect(fetchChecksMock).toHaveBeenCalledWith(A, P, MONITOR_ID, {
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
      await waitFor(() => {
        expect(screen.getByTestId("monitor-checks-title")).toHaveTextContent(
          /^Payments API$/,
        );
      });
      expect(await waitCount([3])).toBeInTheDocument();
      expect(historyRows()).toHaveLength(3);
      expect(fetchChecksMock).toHaveBeenCalledWith(A, P, MONITOR_ID, {
        limit: 50,
        offset: 0,
      });
    },
  );

  it("shows denied to a non-member without fetching, naming the Organization or the monitor", async () => {
    renderChecks(B.replace("2222", "3333"));
    expect(
      await screen.findByTestId("monitor-checks-denied"),
    ).toBeInTheDocument();
    expect(fetchDetailMock).not.toHaveBeenCalled();
    expect(fetchChecksMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
    expect(document.body.textContent).not.toContain("Acme");
    expect(document.body.innerHTML).not.toContain("Acme");
    expect(document.body.textContent).not.toContain("Beta");
    expect(document.body.innerHTML).not.toContain("Beta");
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
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
    expect(screen.queryByTestId("monitor-checks-denied")).toBeNull();
    await act(async () => {
      reread.resolve(
        context("viewer", [
          { id: B, name: "Beta", slug: "beta", role: "owner" },
        ]),
      );
      await Promise.resolve();
    });
    expect(
      await screen.findByTestId("monitor-checks-denied"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
    expect(document.body.textContent).not.toContain("Acme");
    expect(document.body.innerHTML).not.toContain("Acme");
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
      expect(
        await screen.findByTestId("monitor-checks-not-found"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("monitor-checks-list-link")).toHaveAttribute(
        "href",
        `/organizations/${A}/projects/${P}/monitors`,
      );
      expect(document.body.textContent).not.toContain("Payments API");
      expect(document.body.innerHTML).not.toContain("Payments API");
      expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
    },
  );

  it("shows not-found when only the checks answer 404, without the monitor name from the detail", async () => {
    fetchChecksMock.mockRejectedValue(notFound());
    renderChecks();
    expect(
      await screen.findByTestId("monitor-checks-not-found"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
  });

  it("shows not-found when only the detail answers 404, without the rows", async () => {
    fetchDetailMock.mockRejectedValue(notFound());
    fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
    renderChecks();
    expect(
      await screen.findByTestId("monitor-checks-not-found"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
    expect(screen.queryByTestId("monitor-checks-count")).toBeNull();
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
    expect(
      await screen.findByTestId("monitor-checks-not-found"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
    expect(screen.queryByTestId("monitor-checks-count")).toBeNull();
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
      await screen.findByTestId("monitor-checks-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
    expect(document.body.textContent).not.toContain("Acme");
    expect(document.body.innerHTML).not.toContain("Acme");
    expect(screen.queryByTestId("monitor-checks-count")).toBeNull();
    await sleep(250);
    expect(fetchChecksMock).toHaveBeenCalledTimes(2);
  });

  it("leaves for the new Organization's Projects with no rows from the old one, even when a load more lands late", async () => {
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
    expect(
      monitorQueryKeys.checksHistory(A, P, MONITOR_ID).slice(0, 1),
    ).toEqual(TENANT_QUERY_PREFIX);
    await user.click(await loadMoreButton());
    await waitFor(() => {
      expect(screen.getByTestId("monitor-checks-load-more")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
    await user.click(screen.getByTestId("checks-harness-switch"));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/projects`,
      );
    });
    await act(async () => {
      late.resolve(chunk(span(50, 100), 50, 120));
      await Promise.resolve();
    });
    expect(screen.getByTestId("checks-harness-overview")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Payments API");
    expect(document.body.innerHTML).not.toContain("Payments API");
    expect(screen.queryByTestId("monitor-checks-count")).toBeNull();
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();
    // The unobserved entry leaves the cache on a zero-delay gc timer (gcTime 0), which is a macrotask: under load it can run after the last microtask above.
    await waitFor(() => {
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: monitorQueryKeys.checksHistory(A, P, MONITOR_ID) }),
      ).toBeUndefined();
    });
  });
});

describe("Checks history links", () => {
  it("opens the checks history from the Detail page and returns to it, both as client navigation", async () => {
    fetchChecksMock.mockResolvedValue(chunk(span(0, 3), 0, 3));
    const user = userEvent.setup();
    renderChecks();
    await waitCount([3]);

    const back = screen.getByTestId("monitor-checks-back");
    expect(back).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
    );
    // The router takes the click over: no document load.
    expect(fireEvent.click(back)).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(
        /^Payments API$/,
      );
    });
    expect(screen.queryByTestId("monitor-checks-table")).toBeNull();

    const open = screen.getByTestId("monitor-detail-checks-link");
    expect(open).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/checks`,
    );
    await user.click(open);
    expect(await waitCount([3])).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/checks`,
    );
  });

  it("keeps the monitor leaf active on the checks history path", () => {
    const leaf = {
      path: "/organizations/:organizationId/projects/:projectId/monitors",
    };
    expect(
      isLeafActive(
        leaf,
        `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}/checks`,
      ),
    ).toBe(true);
  });
});
