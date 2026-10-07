import { guardUnassignedNetwork } from "../../test/guard-network";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type {
  MeContextResponse,
  MonitorListResponse,
  MonitorRecentEvent,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { TenantProvider, useTenant } from "../../lib/tenant/TenantProvider";
import { formatDateTime, formatTimeWithSeconds, TIME_ZONE } from "./format";
import { MONITOR_LIST_SORTS } from "@nightwatch/api-contract";
import { OverviewPage } from "./OverviewPage";

guardUnassignedNetwork();

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchListMock = vi.mocked(fetchMonitorList);
const fetchEventsMock = vi.mocked(fetchMonitorRecentEvents);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DATA_AS_OF = "2026-09-30T07:32:05.000Z";

function context(
  role: "owner" | "admin" | "viewer" | "auditor" = "owner",
  organizations: MeContextResponse["organizations"] = [
    { id: A, name: "Acme", slug: "acme", role },
    { id: B, name: "Beta", slug: "beta", role: "owner" },
  ],
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "Tester",
      email: "tester@example.test",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId: A,
  };
}

type Item = MonitorListResponse["monitors"][number];

// 24 hourly points ending at the current UTC hour of DATA_AS_OF; null marks an hour without data.
function sparkline(values: (number | null)[] = []): Item["responseSparkline"] {
  const end = Date.UTC(2026, 8, 30, 7);
  return Array.from({ length: 24 }, (_, index) => ({
    hourStart: new Date(end - (23 - index) * 3_600_000).toISOString(),
    avgMs: values[index] ?? null,
  }));
}

let nextId = 0;
function item(overrides: Partial<Item> = {}): Item {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    name: `Monitor ${String(nextId)}`,
    url: `https://m${String(nextId)}.example.test/health`,
    method: "GET",
    intervalSeconds: 300,
    status: "active",
    health: "up",
    healthReason: null,
    lastKnownDown: false,
    consecutiveFailures: 0,
    lastCheckAt: "2026-09-30T07:30:00.000Z",
    openIncident: null,
    lastResponseTimeMs: 182,
    responseSparkline: sparkline(),
    ssl: {
      level: "ok",
      daysRemaining: 128,
      host: "m.example.test",
      issuer: null,
      notAfter: null,
    },
    uptime: {
      h24: { percent: 100, checks: 288, coveragePercent: 100 },
      d30: { percent: 99.9, checks: 8640, coveragePercent: 100 },
    },
    ...overrides,
  };
}

function list(
  monitors: Item[],
  options: {
    total?: number;
    pageTotal?: number;
    summary?: Partial<MonitorListResponse["summary"]>;
    offset?: number;
  } = {},
): MonitorListResponse {
  const total = options.total ?? monitors.length;
  const count = (health: Item["health"]) =>
    monitors.filter((monitor) => monitor.health === health).length;
  return {
    summary: {
      up: count("up"),
      down: count("down"),
      unknown: count("unknown"),
      paused: count("paused"),
      total,
      limit: 50,
      ...options.summary,
    },
    monitors,
    page: {
      limit: 25,
      offset: options.offset ?? 0,
      total: options.pageTotal ?? monitors.length,
    },
    dataAsOf: DATA_AS_OF,
  };
}

const noEvents = { events: [] as MonitorRecentEvent[] };

function Harness({ children }: { children?: React.ReactNode }) {
  const { switchOrg } = useTenant();
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void switchOrg(B).then((switched) => {
            if (switched) void navigate(`/organizations/${B}/monitors`);
          })
        }
      >
        switch to B
      </button>
      <output data-testid="location">{useLocation().pathname}</output>
      <output data-testid="state">{JSON.stringify(useLocation().state)}</output>
      {children}
      <Outlet />
    </>
  );
}

const resources: {
  router: ReturnType<typeof createMemoryRouter>;
  queryClient: QueryClient;
}[] = [];
afterEach(async () => {
  cleanup();
  for (const { router, queryClient } of resources.splice(0)) {
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  }
});

function renderPage(organizationId = A, state?: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  const router = createMemoryRouter(
    [
      {
        element: <Harness />,
        children: [
          {
            path: "/organizations/:organizationId/monitors",
            element: <OverviewPage />,
          },
        ],
      },
    ],
    {
      initialEntries: [
        { pathname: `/organizations/${organizationId}/monitors`, state },
      ],
    },
  );
  resources.push({ router, queryClient });
  return {
    queryClient,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <RouterProvider router={router} />
        </TenantProvider>
      </QueryClientProvider>,
    ),
  };
}

// "Today" decides whether a time shows its date, so the clock is fixed; timers stay real.
const NOW = new Date("2026-09-30T08:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMeContextMock.mockResolvedValue(context());
  fetchEventsMock.mockResolvedValue(noEvents);
});

afterEach(() => {
  window.localStorage.removeItem("nightwatch:monitors-view");
  vi.useRealTimers();
  vi.resetAllMocks();
});

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

describe("Overview view toggle", () => {
  it("shows the table by default, switches to cards and back", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("nightwatch:monitors-view");
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    renderPage();
    await screen.findByRole("link", { name: "Web" });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^ตัวอย่าง: / })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "การ์ด" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(window.localStorage.getItem("nightwatch:monitors-view")).toBe(
      "cards",
    );
    expect(screen.getByText("ตอบสนอง")).toBeInTheDocument();
    expect(screen.getByText(`(${TIME_ZONE})`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Web" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^ตัวอย่าง: / })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "ตาราง" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^ตัวอย่าง: / })).toBeNull();
  });

  it("names the status chip group and keeps counts out of the chip names", async () => {
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    renderPage();
    await screen.findByRole("link", { name: "Web" });
    const group = screen.getByRole("group", { name: "สถานะ" });
    expect(
      within(group).getByRole("button", { name: "ทั้งหมด" }),
    ).toBeInTheDocument();
  });

  it("shows no-data text without a time zone note and the full URL in cards", async () => {
    const url = `https://example.com/${"a".repeat(120)}`;
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    fetchListMock.mockResolvedValue(
      list([
        item({
          name: "Web",
          url,
          lastCheckAt: null,
          lastResponseTimeMs: null,
        }),
      ]),
    );
    renderPage();
    await screen.findByRole("link", { name: "Web" });
    expect(screen.getByText(url)).toHaveClass("break-all");
    expect(screen.queryByText(`(${TIME_ZONE})`)).toBeNull();
    expect(screen.getAllByText("ไม่มีข้อมูล").length).toBeGreaterThan(0);
  });

  it("restores the persisted cards view and falls back to the table when storage throws", async () => {
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    const first = renderPage();
    await screen.findByRole("link", { name: "Web" });
    expect(screen.queryByRole("table")).toBeNull();
    first.unmount();

    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    renderPage();
    await screen.findByRole("link", { name: "Web" });
    expect(screen.getByRole("table")).toBeInTheDocument();
    getItem.mockRestore();
  });
});

const SORT_LABELS = [
  "ปัญหาก่อน",
  "ชื่อ A-Z",
  "ความพร้อมใช้งานต่ำสุด",
  "ตอบกลับช้าสุด",
  "เพิ่มล่าสุด",
];

describe("Overview sort", () => {
  it("offers five options in order, defaulting to problems without sending sort", async () => {
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    renderPage();
    await screen.findByRole("link", { name: "Web" });
    const select = screen.getByRole("combobox", { name: "เรียงตาม" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(SORT_LABELS);
    expect(select).toHaveValue("problems");
    expect(fetchListMock.mock.calls[0]?.[1].sort).toBeUndefined();
  });

  it("caches the default order under the loader and nav counts key", async () => {
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    const { queryClient } = renderPage();
    await screen.findByRole("link", { name: "Web" });
    expect(
      queryClient.getQueryData(
        monitorQueryKeys.list(A, { limit: 25, offset: 0 }),
      ),
    ).toBeDefined();
  });

  it("sends each sort under its own key, returns to the first page and announces it", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 25 }, (_, index) =>
      item({ name: `Row${String(index)}` }),
    );
    fetchListMock.mockImplementation((_org, params) =>
      Promise.resolve(
        list(params.offset === 0 ? many : [item({ name: "Last" })], {
          total: 26,
          pageTotal: 26,
          offset: params.offset,
        }),
      ),
    );
    const { queryClient } = renderPage();
    await screen.findByRole("link", { name: "Row0" });
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await screen.findByRole("link", { name: "Last" });

    const select = screen.getByRole("combobox", { name: "เรียงตาม" });
    const sorted = MONITOR_LIST_SORTS.filter((value) => value !== "problems");
    for (const value of sorted) {
      await user.selectOptions(select, value);
      await screen.findByRole("link", { name: "Row0" });
      await waitFor(() => {
        expect(
          screen.getByRole("status", { name: "ผลการกรอง" }),
        ).toHaveTextContent(
          `เรียงตาม ${SORT_LABELS[MONITOR_LIST_SORTS.indexOf(value)] ?? ""} · พบ 26 จาก 26`,
        );
      });
      expect(fetchListMock).toHaveBeenLastCalledWith(A, {
        limit: 25,
        offset: 0,
        health: undefined,
        q: undefined,
        sort: value,
      });
      expect(
        queryClient.getQueryData(
          monitorQueryKeys.list(A, { limit: 25, offset: 0, sort: value }),
        ),
      ).toBeDefined();
    }
    const keys = sorted.map((value) =>
      JSON.stringify(
        monitorQueryKeys.list(A, { limit: 25, offset: 0, sort: value }),
      ),
    );
    expect(new Set(keys).size).toBe(sorted.length);

    await user.selectOptions(select, "problems");
    await waitFor(() => {
      expect(
        screen.getByRole("status", { name: "ผลการกรอง" }),
      ).toHaveTextContent("เรียงตาม ปัญหาก่อน · พบ 26 จาก 26");
    });
  });

  it("keeps the sort when filters are cleared and forgets it on a new mount", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    const first = renderPage();
    await screen.findByRole("link", { name: "Web" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "เรียงตาม" }),
      "newest",
    );
    await user.click(screen.getByRole("button", { name: "ล่ม" }));
    await user.click(
      await screen.findByRole("button", { name: "ล้างตัวกรอง" }),
    );
    expect(screen.getByRole("combobox", { name: "เรียงตาม" })).toHaveValue(
      "newest",
    );
    expect(window.localStorage.getItem("nightwatch:monitors-sort")).toBeNull();
    first.unmount();

    renderPage();
    await screen.findByRole("link", { name: "Web" });
    expect(screen.getByRole("combobox", { name: "เรียงตาม" })).toHaveValue(
      "problems",
    );
  });

  it("does not let an older sort response replace the newer one", async () => {
    const user = userEvent.setup();
    const resolvers: Record<string, (value: MonitorListResponse) => void> = {};
    fetchListMock.mockImplementation((_org, params) => {
      if (params.sort === undefined) {
        return Promise.resolve(list([item({ name: "Initial" })]));
      }
      return new Promise((resolve) => {
        resolvers[params.sort ?? ""] = resolve;
      });
    });
    renderPage();
    await screen.findByRole("link", { name: "Initial" });
    const select = screen.getByRole("combobox", { name: "เรียงตาม" });

    await user.selectOptions(select, "name");
    await user.selectOptions(select, "newest");
    await waitFor(() => {
      expect(resolvers["newest"]).toBeDefined();
    });
    expect(screen.getByRole("link", { name: "Initial" })).toBeInTheDocument();

    await act(async () => {
      resolvers["newest"]?.(list([item({ name: "NewestResult" })]));
      await Promise.resolve();
    });
    await screen.findByRole("link", { name: "NewestResult" });
    await act(async () => {
      resolvers["name"]?.(list([item({ name: "NameResult" })]));
      await Promise.resolve();
    });
    expect(
      screen.getByRole("link", { name: "NewestResult" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "NameResult" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "เรียงตาม" })).toHaveValue(
      "newest",
    );
  });
});

describe("Overview method, interval and sparkline", () => {
  it("shows method, URL and interval on cards and as table columns", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    fetchListMock.mockResolvedValue(
      list([
        item({
          name: "Api",
          url: "https://api.example.test/v1",
          method: "POST",
          intervalSeconds: 900,
        }),
      ]),
    );
    renderPage();
    await screen.findByRole("link", { name: "Api" });
    const card = screen.getByRole("link", { name: "Api" }).closest("li");
    const cardScope = within(card as HTMLElement);
    expect(cardScope.getByText("POST")).toBeInTheDocument();
    expect(cardScope.getByText("https://api.example.test/v1")).toHaveClass(
      "break-all",
    );
    expect(cardScope.getByText(/^ทุก/)).toHaveTextContent("ทุก 15 นาที");

    await user.click(screen.getByRole("radio", { name: "ตาราง" }));
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      `สถานะ (${TIME_ZONE})`,
      "ชื่อ",
      "URL",
      "เมธอด",
      "รอบตรวจ",
      "24 ชม.",
      "30 วัน",
      "ตอบสนอง",
      "SSL",
      `ตรวจล่าสุด (${TIME_ZONE})`,
    ]);
    const row = within(rowOf("Api"));
    expect(row.getByText("POST")).toBeInTheDocument();
    expect(row.getByText(/^ทุก/)).toHaveTextContent("ทุก 15 นาที");
  });

  it("draws 24 bars with empty slots for null hours and describes the chart", async () => {
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    const values: (number | null)[] = Array.from({ length: 24 }, () => null);
    values[22] = 1500;
    values[23] = 750;
    values[5] = 0;
    fetchListMock.mockResolvedValue(
      list([item({ name: "Spark", responseSparkline: sparkline(values) })]),
    );
    renderPage();
    await screen.findByRole("link", { name: "Spark" });
    const text = screen.getByText(/เวลาตอบสนองเฉลี่ยรายชั่วโมง/);
    expect(text).toHaveClass("sr-only");
    expect(text).toHaveTextContent(
      "เวลาตอบสนองเฉลี่ยรายชั่วโมงจากผลตรวจของมอนิเตอร์นี้ 24 ชม. ล่าสุด สูงสุด 1,500 ms ไม่มีข้อมูล 21 ชั่วโมง",
    );
    const chart = text.previousElementSibling as HTMLElement;
    expect(chart).toHaveAttribute("aria-hidden", "true");
    const slots = Array.from(chart.children) as HTMLElement[];
    expect(slots).toHaveLength(24);
    const empty = slots.filter((slot) => slot.dataset["empty"] === "true");
    expect(empty).toHaveLength(21);
    expect(slots[23]?.style.height).toBe("50%");
    expect(slots[22]?.style.height).toBe("100%");
    // A zero average is a low bar, not an empty slot.
    expect(slots[5]?.dataset["empty"]).toBeUndefined();
    expect(slots[5]?.style.height).toBe("8%");
  });

  it("writes no-data text for a monitor without any hourly average", async () => {
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    fetchListMock.mockResolvedValue(list([item({ name: "Empty" })]));
    renderPage();
    await screen.findByRole("link", { name: "Empty" });
    const card = screen.getByRole("link", { name: "Empty" }).closest("li");
    expect(
      within(card as HTMLElement).getAllByText("ไม่มีข้อมูล").length,
    ).toBeGreaterThan(0);
    expect(card?.querySelector('[aria-hidden="true"] i')).toBeNull();
    expect(
      within(card as HTMLElement).queryByText(/เวลาตอบสนองเฉลี่ยรายชั่วโมง/),
    ).toBeNull();
  });
});

describe("Overview states", () => {
  it("shows a loading state without data while the list is pending", async () => {
    fetchListMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(
      await screen.findByRole("status", { name: "กำลังโหลดมอนิเตอร์" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("ยังไม่มีมอนิเตอร์")).toBeNull();
  });

  it("shows the failure with a retry, never the empty state", async () => {
    fetchListMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "down", 0),
    );
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByText("โหลดมอนิเตอร์ไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีมอนิเตอร์")).toBeNull();

    fetchListMock.mockResolvedValue(list([item({ name: "Recovered" })]));
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
  });

  it("offers the add link on first run to an owner", async () => {
    fetchListMock.mockResolvedValue(list([]));
    renderPage();
    expect(await screen.findByText("ยังไม่มีมอนิเตอร์")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "เพิ่มมอนิเตอร์" }),
    ).toHaveAttribute("href", `/organizations/${A}/monitors/new`);
    expect(
      screen.getAllByRole("link", { name: "เพิ่มมอนิเตอร์" }),
    ).toHaveLength(1);
  });

  it.each(["viewer", "auditor"] as const)(
    "shows a %s the read-only first run and status line without an add control",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      fetchListMock.mockResolvedValue(list([]));
      renderPage();
      expect(await screen.findByText("ยังไม่มีมอนิเตอร์")).toBeInTheDocument();
      expect(
        screen.getByText("ผู้ดูแลหรือเจ้าขององค์กรเพิ่มได้"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("สิทธิ์ของคุณ: ดูอย่างเดียว"),
      ).toBeInTheDocument();
      expect(screen.queryByText("เพิ่มมอนิเตอร์")).toBeNull();
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "hides the add control from a %s when monitors exist",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
      renderPage();
      expect(await screen.findByText("Web")).toBeInTheDocument();
      expect(
        screen.getByText("สิทธิ์ของคุณ: ดูอย่างเดียว"),
      ).toBeInTheDocument();
      expect(screen.queryByText("เพิ่มมอนิเตอร์")).toBeNull();
    },
  );

  it("shows the reason beside a disabled add button at the 50 monitor limit", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ name: "Web" })], { total: 50 }),
    );
    renderPage();
    const button = await screen.findByRole("button", {
      name: "เพิ่มมอนิเตอร์",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "องค์กรนี้มีมอนิเตอร์ครบ 50 ตัวแล้ว ลบมอนิเตอร์เดิมก่อนจึงจะเพิ่มได้",
    );
    expect(screen.queryByRole("link", { name: "เพิ่มมอนิเตอร์" })).toBeNull();
  });

  it("shows denied without names, urls or counts to a non-member and sends no request", async () => {
    fetchMeContextMock.mockResolvedValue(
      context("owner", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    fetchListMock.mockResolvedValue(list([item({ name: "SecretMonitor" })]));
    renderPage(A);
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(fetchListMock).not.toHaveBeenCalled();
    expect(screen.queryByText("SecretMonitor")).toBeNull();
    // Beta is the only org staged in this context; the denied page names no organization.
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.queryByText(/มอนิเตอร์ทั้งหมด/)).toBeNull();
  });

  it("shows denied and refreshes the membership context when the API denies membership", async () => {
    fetchListMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "denied", 403),
    );
    renderPage();
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    // A second denial after the refresh must not start another refresh.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
  });

  it("shows the filtered empty state with a clear action and announces the result once", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, params) =>
      Promise.resolve(
        params.health === "down"
          ? list([], { total: 2, pageTotal: 0 })
          : list([item({ name: "Web" }), item({ name: "Docs" })]),
      ),
    );
    renderPage();
    await screen.findByText("Web");

    await user.click(screen.getByRole("button", { name: "ล่ม" }));
    expect(
      await screen.findByText("ไม่พบมอนิเตอร์ที่ตรงกับตัวกรอง"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "ผลการกรอง" })).toHaveTextContent(
      "พบ 0 จาก 2",
    );

    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(await screen.findByText("Web")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "ผลการกรอง" })).toHaveTextContent(
      "พบ 2 จาก 2",
    );
  });

  it("moves focus to the search field when the inline clear button unmounts", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    renderPage();
    await screen.findByText("Web");

    await user.click(screen.getByRole("button", { name: "ล่ม" }));
    const clear = await screen.findByRole("button", { name: "ล้างตัวกรอง" });
    clear.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("button", { name: "ล้างตัวกรอง" })).toBeNull();
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});

function summaryCount(label: string): string {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

describe("Overview success", () => {
  it("lists rows in server order, sums the summary to the total and labels the table", async () => {
    const monitors = [
      item({ name: "Payments", health: "down" }),
      item({ name: "Docs", health: "unknown", healthReason: "stale" }),
      item({ name: "Web", health: "up" }),
      item({ name: "Web2", health: "up" }),
      item({ name: "Legacy", health: "paused", status: "paused" }),
    ];
    fetchListMock.mockResolvedValue(list(monitors));
    renderPage();
    await screen.findByText("Payments");

    expect(
      screen.getByRole("region", { name: "ตารางมอนิเตอร์" }),
    ).toContainElement(screen.getByRole("table"));
    const names = within(screen.getByRole("table"))
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual(["Payments", "Docs", "Web", "Web2", "Legacy"]);

    const counts = ["ปกติ", "ล่ม", "ไม่ทราบสถานะ", "หยุดชั่วคราว"].map(
      (label) => Number(summaryCount(label)),
    );
    expect(counts).toEqual([2, 1, 1, 1]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5);
    expect(screen.getByText(/ข้อมูล ณ/)).toHaveTextContent(
      formatTimeWithSeconds(DATA_AS_OF),
    );
    expect(screen.getByText(formatTimeWithSeconds(DATA_AS_OF))).toHaveAttribute(
      "datetime",
      DATA_AS_OF,
    );
  });

  it("writes the state as words and keeps the primary tone and check icon for up only", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({ name: "UpRow", health: "up" }),
        item({
          name: "DownRow",
          health: "down",
          openIncident: {
            startedAt: "2026-09-30T07:02:00.000Z",
            reason: "http_status",
          },
        }),
        item({
          name: "NeverRow",
          health: "unknown",
          healthReason: "never_checked",
          lastCheckAt: null,
          lastResponseTimeMs: null,
        }),
        item({
          name: "SysRow",
          health: "unknown",
          healthReason: "check_error",
        }),
        item({ name: "PausedRow", health: "paused", status: "paused" }),
      ]),
    );
    renderPage();
    await screen.findByText("UpRow");

    const pillOf = (name: string, text: string) =>
      within(rowOf(name)).getByText(text, {
        selector: "[data-slot=status-pill]",
      });
    const up = pillOf("UpRow", "ปกติ");
    expect(up).toHaveClass("text-primary");
    expect(up.querySelector("svg")).not.toBeNull();

    for (const [name, text] of [
      ["DownRow", "ล่ม"],
      ["NeverRow", "ไม่ทราบสถานะ"],
      ["SysRow", "ไม่ทราบสถานะ"],
      ["PausedRow", "หยุดชั่วคราว"],
    ] as const) {
      const pill = pillOf(name, text);
      expect(pill).not.toHaveClass("text-primary");
      expect(pill.querySelector("svg")).toBeNull();
    }
    expect(within(rowOf("DownRow")).getByText(/สาเหตุ/)).toHaveTextContent(
      "สาเหตุ รหัสสถานะ HTTP ไม่ตรงเงื่อนไข",
    );
    expect(
      within(rowOf("NeverRow")).getByText("รอตรวจครั้งแรก"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("SysRow")).getByText("ตรวจไม่ได้ (ปัญหาฝั่งระบบ)"),
    ).toBeInTheDocument();
  });

  it("shows failure counts, last-known-down and stale wording without changing the health", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({ name: "Flaky", health: "up", consecutiveFailures: 1 }),
        item({
          name: "Silent",
          health: "unknown",
          healthReason: "stale",
          lastKnownDown: true,
          lastCheckAt: "2026-09-30T06:10:00.000Z",
        }),
        item({
          name: "Edited",
          health: "unknown",
          healthReason: "awaiting_new_config",
        }),
      ]),
    );
    renderPage();
    await screen.findByText("Flaky");

    const flaky = rowOf("Flaky");
    expect(within(flaky).getByText("ล้มเหลว 1 ครั้ง")).toHaveClass(
      "text-caution",
    );
    expect(within(flaky).getByText("ปกติ")).toBeInTheDocument();
    const silent = rowOf("Silent");
    expect(within(silent).getByText("ล่าสุดทราบว่าล่ม")).toBeInTheDocument();
    expect(within(silent).getByText(/ไม่มีผลใหม่ตั้งแต่/)).toBeInTheDocument();
    expect(
      within(rowOf("Edited")).getByText("รอตรวจตามค่าใหม่"),
    ).toBeInTheDocument();
  });

  it("words every SSL level with its tone", async () => {
    const levels: [Item["ssl"], string, string][] = [
      [
        {
          level: "ok",
          daysRemaining: 128,
          host: "h",
          issuer: null,
          notAfter: null,
        },
        "เหลือ 128 วัน",
        "text-foreground",
      ],
      [
        {
          level: "caution",
          daysRemaining: 30,
          host: "h",
          issuer: null,
          notAfter: null,
        },
        "ใกล้หมดอายุ เหลือ 30 วัน",
        "text-caution",
      ],
      [
        {
          level: "danger",
          daysRemaining: 7,
          host: "h",
          issuer: null,
          notAfter: null,
        },
        "หมดอายุใน 7 วัน",
        "text-danger",
      ],
      [
        {
          level: "expired",
          daysRemaining: -2,
          host: "h",
          issuer: null,
          notAfter: null,
        },
        "หมดอายุแล้ว เมื่อ 2 วันก่อน",
        "text-danger",
      ],
      [
        {
          level: "expired",
          daysRemaining: null,
          host: "h",
          issuer: null,
          notAfter: null,
        },
        "หมดอายุแล้ว",
        "text-danger",
      ],
      [
        {
          level: "not_https",
          daysRemaining: null,
          host: null,
          issuer: null,
          notAfter: null,
        },
        "ไม่ใช้ HTTPS",
        "text-foreground-secondary",
      ],
      [
        {
          level: "unreadable",
          daysRemaining: null,
          host: "h",
          issuer: null,
          notAfter: null,
        },
        "อ่านใบรับรองไม่ได้",
        "text-foreground",
      ],
      [
        {
          level: "no_data",
          daysRemaining: null,
          host: null,
          issuer: null,
          notAfter: null,
        },
        "ยังไม่มีข้อมูล",
        "text-foreground",
      ],
    ];
    fetchListMock.mockResolvedValue(
      list(
        levels.map(([ssl], index) =>
          item({ name: `Ssl${String(index)}`, ssl }),
        ),
      ),
    );
    renderPage();
    await screen.findByText("Ssl0");

    levels.forEach(([, text, tone], index) => {
      const label = within(rowOf(`Ssl${String(index)}`)).getByText(text);
      expect(label).toHaveClass(tone);
    });
  });

  it("writes missing uptime and response time as text and shows partial coverage", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          name: "Fresh",
          lastResponseTimeMs: null,
          lastCheckAt: null,
          uptime: {
            h24: { percent: null, checks: 0, coveragePercent: 0 },
            d30: { percent: 97.5, checks: 10, coveragePercent: 61 },
          },
        }),
      ]),
    );
    renderPage();
    await screen.findByText("Fresh");
    const row = within(rowOf("Fresh"));
    expect(row.getAllByText("ไม่มีข้อมูล").length).toBeGreaterThanOrEqual(3);
    expect(row.getByText("97.50%")).toBeInTheDocument();
    expect(row.getByText("ครอบคลุม 61.00%")).toBeInTheDocument();
  });

  it("marks each last check time with its instant", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ name: "Web", lastCheckAt: "2026-09-30T07:30:00.000Z" })]),
    );
    renderPage();
    await screen.findByText("Web");
    const times = within(rowOf("Web")).getAllByText(/^\d{2}:\d{2}$/);
    expect(times[0]).toHaveAttribute("datetime", "2026-09-30T07:30:00.000Z");
    expect(
      screen.getByRole("columnheader", { name: /ตรวจล่าสุด \(/ }),
    ).toBeInTheDocument();
  });
});

describe("Overview times, focus and filter failures", () => {
  it("shows the date for a time that is not today and only the time for today", async () => {
    const earlier = "2026-09-28T07:02:00.000Z";
    fetchListMock.mockResolvedValue(
      list([
        item({
          name: "DownOld",
          health: "down",
          openIncident: { startedAt: earlier, reason: "timeout" },
          lastCheckAt: earlier,
        }),
        item({
          name: "StaleOld",
          health: "unknown",
          healthReason: "stale",
          lastCheckAt: earlier,
        }),
        item({ name: "Today", lastCheckAt: "2026-09-30T07:30:00.000Z" }),
      ]),
    );
    renderPage();
    await screen.findByText("DownOld");

    const withDate = formatDateTime(earlier);
    expect(within(rowOf("DownOld")).getAllByText(withDate)).toHaveLength(2);
    expect(within(rowOf("StaleOld")).getAllByText(withDate)).toHaveLength(2);
    expect(within(rowOf("Today")).getByText(/^\d{2}:\d{2}$/)).toHaveAttribute(
      "datetime",
      "2026-09-30T07:30:00.000Z",
    );
    expect(
      screen.getByRole("columnheader", { name: `สถานะ (${TIME_ZONE})` }),
    ).toBeInTheDocument();
  });

  it("names the timezone on the recent events card and shows each event's date", async () => {
    const at = "2026-09-29T07:02:00.000Z";
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    fetchEventsMock.mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          monitorId: item().id,
          monitorName: "Payments",
          at,
          reason: "timeout",
        },
      ],
    });
    renderPage();
    const card = await screen.findByRole("region", { name: "เหตุการณ์ล่าสุด" });
    expect(await within(card).findByText(formatDateTime(at))).toHaveAttribute(
      "datetime",
      at,
    );
    expect(card).toHaveTextContent(`เวลาแสดงตามเขตเวลา ${TIME_ZONE}`);
  });

  it("keeps focus on the refresh button while it refreshes and ignores a second press", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValueOnce(list([item({ name: "Web" })]));
    renderPage();
    await screen.findByText("Web");

    const pending = Promise.withResolvers<MonitorListResponse>();
    fetchListMock.mockReturnValue(pending.promise);
    const callsBefore = fetchListMock.mock.calls.length;
    const button = screen.getByRole("button", { name: "รีเฟรช" });
    await user.click(button);

    const busy = screen.getByRole("button", { name: "กำลังรีเฟรช…" });
    expect(busy).toBe(button);
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(fetchListMock.mock.calls.length).toBe(callsBefore + 1);

    await act(async () => {
      pending.resolve(list([item({ name: "Web" })]));
      await pending.promise;
    });
    expect(await screen.findByRole("button", { name: "รีเฟรช" })).toHaveFocus();
  });

  it("keeps the filter controls and offers a clear action when a new filter fails to load", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, params) =>
      params.health === "down"
        ? Promise.reject(new ApiError("NETWORK_ERROR", "x", 0))
        : Promise.resolve(list([item({ name: "Web" })])),
    );
    renderPage();
    await screen.findByText("Web");

    await user.click(screen.getByRole("button", { name: "ล่ม" }));
    expect(
      await screen.findByText("โหลดมอนิเตอร์ไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ล่ม" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("ค้นหาชื่อหรือ URL")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีมอนิเตอร์")).toBeNull();

    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(await screen.findByText("Web")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the failure count on an unknown row whose first result in the new config failed", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          name: "FirstFail",
          health: "unknown",
          healthReason: null,
          consecutiveFailures: 1,
        }),
      ]),
    );
    renderPage();
    await screen.findByText("FirstFail");
    const row = within(rowOf("FirstFail"));
    expect(row.getByText("ล้มเหลว 1 ครั้ง")).toHaveClass("text-caution");
    expect(row.getByText("ไม่ทราบสถานะ")).toBeInTheDocument();
  });

  it("offers no add control until the monitor count is known", async () => {
    fetchListMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByRole("status", { name: "กำลังโหลดมอนิเตอร์" });
    expect(screen.queryByText("เพิ่มมอนิเตอร์")).toBeNull();
  });

  it("hides the pagination summary under the filtered-empty state", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, params) =>
      Promise.resolve(
        params.health === "down"
          ? list([], { total: 2, pageTotal: 0 })
          : list([item({ name: "Web" })]),
      ),
    );
    renderPage();
    await screen.findByText("Web");
    await user.click(screen.getByRole("button", { name: "ล่ม" }));
    await screen.findByText("ไม่พบมอนิเตอร์ที่ตรงกับตัวกรอง");
    expect(
      screen.queryByRole("navigation", { name: "หน้ามอนิเตอร์" }),
    ).toBeNull();
    expect(screen.queryByText(/แสดง 0/)).toBeNull();
  });
});

describe("Overview recent events", () => {
  it("lists incidents and SSL warnings", async () => {
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    fetchEventsMock.mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          monitorId: item().id,
          monitorName: "Payments",
          at: "2026-09-30T07:02:00.000Z",
          reason: "timeout",
        },
        {
          kind: "ssl_level",
          monitorId: item().id,
          monitorName: "Payments",
          at: "2026-09-30T05:00:00.000Z",
          reason: null,
          sslLevel: "danger",
          daysRemaining: 5,
        },
        {
          kind: "incident_closed",
          monitorId: item().id,
          monitorName: "Web",
          at: "2026-09-29T14:14:00.000Z",
          reason: "recovered",
          durationSeconds: 480,
        },
      ],
    });
    renderPage();
    const card = await screen.findByRole("region", { name: "เหตุการณ์ล่าสุด" });
    expect(await within(card).findByText("SSL วิกฤต")).toBeInTheDocument();
    expect(within(card).getByText(/หมดอายุใน 5 วัน/)).toBeInTheDocument();
    expect(within(card).getByText(/เริ่มล่ม/)).toHaveTextContent(
      "สาเหตุ หมดเวลารอ",
    );
    expect(within(card).getByText(/ล่ม 8 นาที/)).toBeInTheDocument();
  });

  it("shows its own empty text", async () => {
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    renderPage();
    expect(
      await screen.findByText(
        "ไม่มีเหตุการณ์ล่มหรือ SSL เตือนในช่วงที่เก็บข้อมูล",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the table when the card fails and retries only the card", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(list([item({ name: "Web" })]));
    fetchEventsMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "x", 0),
    );
    renderPage();
    expect(
      await screen.findByText("โหลดเหตุการณ์ล่าสุดไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();

    fetchEventsMock.mockResolvedValue(noEvents);
    const listCalls = fetchListMock.mock.calls.length;
    await user.click(
      within(screen.getByRole("region", { name: "เหตุการณ์ล่าสุด" })).getByRole(
        "button",
        { name: "ลองอีกครั้ง" },
      ),
    );
    expect(
      await screen.findByText(
        "ไม่มีเหตุการณ์ล่มหรือ SSL เตือนในช่วงที่เก็บข้อมูล",
      ),
    ).toBeInTheDocument();
    expect(fetchListMock.mock.calls.length).toBe(listCalls);
  });
});

describe("Overview refetch and announcements", () => {
  it("announces a filter result once and leaves the live region alone through two 30 s refetches", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    let calls = 0;
    fetchListMock.mockImplementation((_org, params) => {
      calls += 1;
      if (params.health === "down") {
        // Later refetches report other totals: a live region bound to the data would change.
        return Promise.resolve(
          list([item({ name: "Down1" })], {
            total: 12 + calls,
            pageTotal: 3 + calls,
          }),
        );
      }
      return Promise.resolve(
        list([item({ name: "Web" })], { total: 12, pageTotal: 12 }),
      );
    });
    renderPage();
    await screen.findByText("Web");
    const region = screen.getByRole("status", { name: "ผลการกรอง" });
    expect(region).toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: "ล่ม" }));
    await screen.findByText("Down1");
    await waitFor(() => {
      expect(region).toHaveTextContent(/^พบ \d+ จาก \d+$/);
    });
    const announced = region.textContent;
    expect(announced).toBe(`พบ ${String(3 + calls)} จาก ${String(12 + calls)}`);

    const before = calls;
    for (let round = 0; round < 2; round += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
    }
    await waitFor(() => {
      expect(calls).toBe(before + 2);
    });
    expect(region.textContent).toBe(announced);
    // The visible count follows the data; only the live region stays put.
    expect(
      screen.getByText(`พบ ${String(3 + calls)} จาก ${String(12 + calls)}`, {
        selector: "p:not([role=status])",
      }),
    ).toBeInTheDocument();
  });

  it("debounces the search and resets to the first page", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, params) =>
      Promise.resolve(
        params.q === "pay"
          ? list([item({ name: "Payments" })], { total: 12, pageTotal: 1 })
          : list([item({ name: "Web" })], { total: 12, pageTotal: 12 }),
      ),
    );
    renderPage();
    await screen.findByText("Web");
    await user.type(screen.getByLabelText("ค้นหาชื่อหรือ URL"), "pay");
    expect(await screen.findByText("Payments")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "ผลการกรอง" })).toHaveTextContent(
      "พบ 1 จาก 12",
    );
    const queries = fetchListMock.mock.calls.map(([, params]) => params.q);
    expect(queries).not.toContain("p");
    expect(queries).not.toContain("pa");
  });

  it("keeps the data and warns with its time when a refetch fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    fetchListMock.mockResolvedValueOnce(list([item({ name: "Web" })]));
    fetchListMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    renderPage();
    await screen.findByText("Web");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const warning = await screen.findByText(
      /อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ/,
    );
    expect(warning).toHaveTextContent(formatTimeWithSeconds(DATA_AS_OF));
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.queryByText("โหลดมอนิเตอร์ไม่สำเร็จ")).toBeNull();
  });

  it("pages with the server offset", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, params) =>
      Promise.resolve(
        params.offset === 0
          ? list([item({ name: "First" })], { total: 30, pageTotal: 30 })
          : list([item({ name: "Second" })], {
              total: 30,
              pageTotal: 30,
              offset: 25,
            }),
      ),
    );
    renderPage();
    await screen.findByText("First");
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ก่อนหน้า" })).toBeEnabled();
  });
});

describe("Overview Organization switch", () => {
  it("shows no data of the previous Organization while its request is pending or after it resolves late", async () => {
    const user = userEvent.setup();
    const late = Promise.withResolvers<MonitorListResponse>();
    fetchListMock.mockImplementation((organizationId) =>
      organizationId === A
        ? late.promise
        : Promise.resolve(list([item({ name: "BetaMonitor" })])),
    );
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    renderPage(A);
    await screen.findByRole("status", { name: "กำลังโหลดมอนิเตอร์" });

    await user.click(screen.getByRole("button", { name: "switch to B" }));
    expect(await screen.findByText("BetaMonitor")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/monitors`,
    );

    await act(async () => {
      late.resolve(list([item({ name: "AlphaMonitor" })]));
      await late.promise;
    });
    expect(screen.queryByText("AlphaMonitor")).toBeNull();
    expect(screen.getByText("BetaMonitor")).toBeInTheDocument();
  });

  it("hides origin organization rows while the destination organization loads", async () => {
    const user = userEvent.setup();
    const pendingB = Promise.withResolvers<MonitorListResponse>();
    fetchListMock.mockImplementation((organizationId) =>
      organizationId === A
        ? Promise.resolve(list([item({ name: "AlphaMonitor" })]))
        : pendingB.promise,
    );
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    renderPage(A);
    await screen.findByText("AlphaMonitor");

    await user.click(screen.getByRole("button", { name: "switch to B" }));
    expect(
      await screen.findByRole("status", { name: "กำลังโหลดมอนิเตอร์" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("AlphaMonitor")).toBeNull();
  });
});

describe("Overview one-time notice", () => {
  it("shows the notice a monitor page handed over and moves focus to the heading", async () => {
    fetchListMock.mockResolvedValue(list([item()]));
    renderPage(A, { notice: "deleted" });
    expect(await screen.findByText("ลบมอนิเตอร์แล้ว")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "ตรวจสถานะบริการ" }),
    ).toHaveFocus();
  });

  it("clears the state so the notice does not come back on reload or back", async () => {
    fetchListMock.mockResolvedValue(list([item()]));
    renderPage(A, { notice: "alreadyDeleted" });
    expect(
      await screen.findByText("มอนิเตอร์นี้ถูกลบแล้ว"),
    ).toBeInTheDocument();
    // The history entry no longer carries it, so a reload or a back navigation shows nothing.
    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("null");
    });
  });

  it("ignores state that is not one of the known notice keys", async () => {
    fetchListMock.mockResolvedValue(list([item()]));
    renderPage(A, { notice: "<b>free text</b>" });
    await screen.findByRole("heading", { level: 1, name: "ตรวจสถานะบริการ" });
    expect(screen.queryByText("<b>free text</b>")).toBeNull();
    expect(document.querySelector('[data-slot="notice"]')).toBeNull();
  });
});
