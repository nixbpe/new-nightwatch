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
import { fetchProjectDetail } from "../../lib/api/projects";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { TenantProvider, useTenant } from "../../lib/tenant/TenantProvider";
import { formatDateTime, formatTimeWithSeconds, TIME_ZONE } from "./format";
import { MONITOR_LIST_SORTS } from "@nightwatch/api-contract";
import { OverviewPage } from "./OverviewPage";
import { PROJECT_NAME, projectDetail } from "./detail-test-support";

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
const P = "33333333-3333-4333-8333-333333333333";
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
    responseP95Ms24h: 182,
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
      limit: 20,
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
        data-testid="overview-switch-organization"
        type="button"
        onClick={() =>
          void switchOrg(B).then((switched) => {
            if (switched)
              void navigate(`/organizations/${B}/projects/${P}/monitors`);
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
            path: "/organizations/:organizationId/projects/:projectId/monitors",
            element: <OverviewPage />,
          },
        ],
      },
    ],
    {
      initialEntries: [
        {
          pathname: `/organizations/${organizationId}/projects/${P}/monitors`,
          state,
        },
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
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fetchMeContextMock.mockResolvedValue(context());
  fetchEventsMock.mockResolvedValue(noEvents);
});

afterEach(() => {
  window.localStorage.removeItem("nightwatch:monitors-view");
  vi.useRealTimers();
  vi.resetAllMocks();
});

function rowOf(id: string): HTMLElement {
  return screen.getByTestId(`monitor-list-row-${id}`);
}

describe("Overview view toggle", () => {
  it("shows the table by default, switches to cards and back", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("nightwatch:monitors-view");
    fetchListMock.mockResolvedValue(
      list([item({ id: "f1aa7885-89ec-4742-b180-cba178eb6d40", name: "Web" })]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-f1aa7885-89ec-4742-b180-cba178eb6d40",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f1aa7885-89ec-4742-b180-cba178eb6d40",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f1aa7885-89ec-4742-b180-cba178eb6d40`,
    );
    expect(screen.getByTestId("monitor-overview-table")).toBeInTheDocument();

    await user.click(screen.getByTestId("monitor-overview-view-cards"));
    expect(screen.queryByTestId("monitor-overview-table")).toBeNull();
    expect(window.localStorage.getItem("nightwatch:monitors-view")).toBe(
      "cards",
    );
    expect(screen.getByTestId("monitor-list-cell-p95")).toHaveTextContent(
      /^182 ms$/,
    );
    expect(screen.getByTestId("monitor-list-check-time")).toHaveAttribute(
      "datetime",
      "2026-09-30T07:30:00.000Z",
    );
    expect(
      screen.getByTestId(
        "monitor-list-name-f1aa7885-89ec-4742-b180-cba178eb6d40",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f1aa7885-89ec-4742-b180-cba178eb6d40",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f1aa7885-89ec-4742-b180-cba178eb6d40`,
    );

    expect(screen.getByTestId("monitor-overview-view-cards")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("monitor-overview-view-table")).toHaveFocus();
    expect(screen.getByTestId("monitor-overview-view-table")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(window.localStorage.getItem("nightwatch:monitors-view")).toBe(
      "table",
    );
    expect(screen.getByTestId("monitor-overview-table")).toBeInTheDocument();
  });

  it("names the status chip group and keeps counts out of the chip names", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ id: "cc2c1bb9-982f-4928-b022-8f808a7a1926", name: "Web" })]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-cc2c1bb9-982f-4928-b022-8f808a7a1926",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-cc2c1bb9-982f-4928-b022-8f808a7a1926",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/cc2c1bb9-982f-4928-b022-8f808a7a1926`,
    );
    const group = screen.getByTestId("monitor-overview-health-filter");
    expect(group).toHaveRole("group");
    expect(group).toHaveAccessibleName();
    const all = within(group).getByTestId("monitor-overview-health-all");
    expect(all).toHaveAccessibleName();
    expect(all).toHaveAttribute("aria-pressed", "true");
    const count = within(all).getByTestId("monitor-overview-health-count");
    expect(count).toHaveAttribute("aria-hidden", "true");
    expect(count).toHaveTextContent(/^1$/);
  });

  it("shows no-data text without a time zone note and the full URL in cards", async () => {
    const url = `https://example.com/${"a".repeat(120)}`;
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "f0067249-5706-4d15-8c26-20883d42c86e",
          name: "Web",
          url,
          lastCheckAt: null,
          lastResponseTimeMs: null,
          responseP95Ms24h: null,
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-f0067249-5706-4d15-8c26-20883d42c86e",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f0067249-5706-4d15-8c26-20883d42c86e",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f0067249-5706-4d15-8c26-20883d42c86e`,
    );
    expect(screen.getByTestId("monitor-list-cell-url")).toHaveTextContent(url);
    expect(screen.queryByTestId("monitor-list-check-time")).toBeNull();
    expect(
      screen.getByTestId("monitor-list-check-empty"),
    ).not.toBeEmptyDOMElement();
    expect(
      screen.getByTestId("monitor-list-cell-p95"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("monitor-list-cell-p95")).not.toHaveTextContent(
      /\d/,
    );
  });

  it("restores the persisted cards view and falls back to the table when storage throws", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ id: "3852bb10-1633-4893-8308-22781b496670", name: "Web" })]),
    );
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    const first = renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-3852bb10-1633-4893-8308-22781b496670",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-3852bb10-1633-4893-8308-22781b496670",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/3852bb10-1633-4893-8308-22781b496670`,
    );
    expect(screen.queryByTestId("monitor-overview-table")).toBeNull();
    first.unmount();

    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-3852bb10-1633-4893-8308-22781b496670",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-3852bb10-1633-4893-8308-22781b496670",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/3852bb10-1633-4893-8308-22781b496670`,
    );
    expect(screen.getByTestId("monitor-overview-table")).toBeInTheDocument();
    getItem.mockRestore();
  });
});

describe("Overview sort", () => {
  it("offers five options in order, defaulting to problems without sending sort", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ id: "2dffe3b9-9919-40f5-b97d-48bce56292b2", name: "Web" })]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-2dffe3b9-9919-40f5-b97d-48bce56292b2",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-2dffe3b9-9919-40f5-b97d-48bce56292b2",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/2dffe3b9-9919-40f5-b97d-48bce56292b2`,
    );
    const select = screen.getByTestId("monitor-overview-sort");
    expect(
      within(select)
        .getAllByTestId(/^monitor-overview-sort-option-/)
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["problems", "name", "uptime", "response_time", "newest"]);
    expect(select).toHaveAccessibleName();
    expect(select).toHaveValue("problems");
    expect(fetchListMock.mock.calls[0]?.[2].sort).toBeUndefined();
  });

  it("caches the default order under the loader and nav counts key", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ id: "f6f65455-42cb-4673-9f75-cffc5d108f77", name: "Web" })]),
    );
    const { queryClient } = renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-f6f65455-42cb-4673-9f75-cffc5d108f77",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f6f65455-42cb-4673-9f75-cffc5d108f77",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f6f65455-42cb-4673-9f75-cffc5d108f77`,
    );
    expect(
      queryClient.getQueryData(
        monitorQueryKeys.list(A, P, { limit: 25, offset: 0 }),
      ),
    ).toBeDefined();
  });

  it("sends each sort under its own key, returns to the first page and announces it", async () => {
    const user = userEvent.setup();
    const leading = item({
      id: "a91d2cbc-bc31-44f3-995f-7711fe7d5aa5",
      name: "Row0",
    });
    const many = [
      leading,
      ...Array.from({ length: 24 }, (_, index) =>
        item({ name: `Row${String(index + 1)}` }),
      ),
    ];
    fetchListMock.mockImplementation((_org, _project, params) =>
      Promise.resolve(
        list(
          params.offset === 0
            ? many
            : [
                item({
                  id: "1c5b88f4-8c3b-4ffc-bda5-d8c868e59ea6",
                  name: "Last",
                }),
              ],
          {
            total: 26,
            pageTotal: 26,
            offset: params.offset,
          },
        ),
      ),
    );
    const { queryClient } = renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-a91d2cbc-bc31-44f3-995f-7711fe7d5aa5",
      ),
    ).toHaveTextContent(/^Row0$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-a91d2cbc-bc31-44f3-995f-7711fe7d5aa5",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/a91d2cbc-bc31-44f3-995f-7711fe7d5aa5`,
    );
    await user.click(screen.getByTestId("monitor-overview-next"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-1c5b88f4-8c3b-4ffc-bda5-d8c868e59ea6",
      ),
    ).toHaveTextContent(/^Last$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-1c5b88f4-8c3b-4ffc-bda5-d8c868e59ea6",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/1c5b88f4-8c3b-4ffc-bda5-d8c868e59ea6`,
    );

    const select = screen.getByTestId("monitor-overview-sort");
    const sorted = MONITOR_LIST_SORTS.filter((value) => value !== "problems");
    for (const value of sorted) {
      await user.selectOptions(select, value);
      expect(
        await screen.findByTestId(
          "monitor-list-name-a91d2cbc-bc31-44f3-995f-7711fe7d5aa5",
        ),
      ).toHaveTextContent(/^Row0$/);
      expect(
        screen.getByTestId(
          "monitor-list-name-a91d2cbc-bc31-44f3-995f-7711fe7d5aa5",
        ),
      ).toHaveAttribute(
        "href",
        `/organizations/${A}/projects/${P}/monitors/a91d2cbc-bc31-44f3-995f-7711fe7d5aa5`,
      );
      await waitFor(() => {
        expect(
          screen
            .getByTestId("monitor-overview-announcement")
            .textContent.match(/\d+/g),
        ).toEqual(["26", "26"]);
      });
      expect(fetchListMock).toHaveBeenLastCalledWith(A, P, {
        limit: 25,
        offset: 0,
        health: undefined,
        q: undefined,
        sort: value,
      });
      expect(
        queryClient.getQueryData(
          monitorQueryKeys.list(A, P, { limit: 25, offset: 0, sort: value }),
        ),
      ).toBeDefined();
    }
    const keys = sorted.map((value) =>
      JSON.stringify(
        monitorQueryKeys.list(A, P, { limit: 25, offset: 0, sort: value }),
      ),
    );
    expect(new Set(keys).size).toBe(sorted.length);

    await user.selectOptions(select, "problems");
    await waitFor(() => {
      expect(
        screen
          .getByTestId("monitor-overview-announcement")
          .textContent.match(/\d+/g),
      ).toEqual(["26", "26"]);
    });
  });

  it("keeps the sort when filters are cleared and forgets it on a new mount", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(
      list([item({ id: "78b764c9-0199-4ef6-a42d-43e750c7d806", name: "Web" })]),
    );
    const first = renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-78b764c9-0199-4ef6-a42d-43e750c7d806",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-78b764c9-0199-4ef6-a42d-43e750c7d806",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/78b764c9-0199-4ef6-a42d-43e750c7d806`,
    );
    await user.selectOptions(
      screen.getByTestId("monitor-overview-sort"),
      "newest",
    );
    await user.click(screen.getByTestId("monitor-overview-health-down"));
    await user.click(await screen.findByTestId("monitor-overview-clear"));
    expect(screen.getByTestId("monitor-overview-sort")).toHaveValue("newest");
    expect(window.localStorage.getItem("nightwatch:monitors-sort")).toBeNull();
    first.unmount();

    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-78b764c9-0199-4ef6-a42d-43e750c7d806",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-78b764c9-0199-4ef6-a42d-43e750c7d806",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/78b764c9-0199-4ef6-a42d-43e750c7d806`,
    );
    expect(screen.getByTestId("monitor-overview-sort")).toHaveValue("problems");
  });

  it("does not let an older sort response replace the newer one", async () => {
    const user = userEvent.setup();
    const resolvers: Record<string, (value: MonitorListResponse) => void> = {};
    fetchListMock.mockImplementation((_org, _project, params) => {
      if (params.sort === undefined) {
        return Promise.resolve(
          list([
            item({
              id: "f537dc96-0bf0-4782-8b0a-a916e0a9c91e",
              name: "Initial",
            }),
          ]),
        );
      }
      return new Promise((resolve) => {
        resolvers[params.sort ?? ""] = resolve;
      });
    });
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-f537dc96-0bf0-4782-8b0a-a916e0a9c91e",
      ),
    ).toHaveTextContent(/^Initial$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f537dc96-0bf0-4782-8b0a-a916e0a9c91e",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f537dc96-0bf0-4782-8b0a-a916e0a9c91e`,
    );
    const select = screen.getByTestId("monitor-overview-sort");

    await user.selectOptions(select, "name");
    await user.selectOptions(select, "newest");
    await waitFor(() => {
      expect(resolvers["newest"]).toBeDefined();
    });
    expect(
      screen.getByTestId(
        "monitor-list-name-f537dc96-0bf0-4782-8b0a-a916e0a9c91e",
      ),
    ).toHaveTextContent(/^Initial$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f537dc96-0bf0-4782-8b0a-a916e0a9c91e",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f537dc96-0bf0-4782-8b0a-a916e0a9c91e`,
    );

    await act(async () => {
      resolvers["newest"]?.(
        list([
          item({
            id: "04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd",
            name: "NewestResult",
          }),
        ]),
      );
      await Promise.resolve();
    });
    expect(
      await screen.findByTestId(
        "monitor-list-name-04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd",
      ),
    ).toHaveTextContent(/^NewestResult$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd`,
    );
    await act(async () => {
      resolvers["name"]?.(
        list([
          item({
            id: "b1878d87-01eb-424c-98e2-971687c7766e",
            name: "NameResult",
          }),
        ]),
      );
      await Promise.resolve();
    });
    expect(
      screen.getByTestId(
        "monitor-list-name-04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd",
      ),
    ).toHaveTextContent(/^NewestResult$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/04b20bbe-ed80-4ed5-aa22-e068bc8ee7cd`,
    );
    expect(
      screen.queryByTestId(
        "monitor-list-name-b1878d87-01eb-424c-98e2-971687c7766e",
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("NameResult");
    expect(screen.getByTestId("monitor-overview-sort")).toHaveValue("newest");
  });
});

describe("Overview method, interval and sparkline", () => {
  it("shows method, URL and interval on cards and as table columns", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "51fd0299-e05f-437b-81c5-d7848b70e032",
          name: "Api",
          url: "https://api.example.test/v1",
          method: "POST",
          intervalSeconds: 900,
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-51fd0299-e05f-437b-81c5-d7848b70e032",
      ),
    ).toHaveTextContent(/^Api$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-51fd0299-e05f-437b-81c5-d7848b70e032",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/51fd0299-e05f-437b-81c5-d7848b70e032`,
    );
    const card = rowOf("51fd0299-e05f-437b-81c5-d7848b70e032");
    const cardScope = within(card);
    expect(cardScope.getByTestId("monitor-list-cell-method")).toHaveTextContent(
      /^POST$/,
    );
    expect(cardScope.getByTestId("monitor-list-cell-url")).toHaveTextContent(
      /^https:\/\/api\.example\.test\/v1$/,
    );
    expect(
      cardScope.getByTestId("monitor-list-cell-interval"),
    ).toHaveTextContent(/\b15\b/);

    await user.click(screen.getByTestId("monitor-overview-view-table"));
    // The Project table is the design's five columns: the URL sits under the name, method and interval are on the monitor page.
    expect(screen.queryByTestId("monitor-list-heading-method")).toBeNull();
    expect(screen.queryByTestId("monitor-list-heading-interval")).toBeNull();
    const row = within(rowOf("51fd0299-e05f-437b-81c5-d7848b70e032"));
    expect(row.getByTestId("monitor-list-url")).toHaveTextContent(
      /^https:\/\/api\.example\.test\/v1$/,
    );
  });

  it("represents 24 hourly values with empty slots for null hours and describes the chart", async () => {
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    const values: (number | null)[] = Array.from({ length: 24 }, () => null);
    values[22] = 1500;
    values[23] = 750;
    values[5] = 0;
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "1b3ebf89-4943-45fb-a57c-97e8c6802978",
          name: "Spark",
          responseSparkline: sparkline(values),
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-1b3ebf89-4943-45fb-a57c-97e8c6802978",
      ),
    ).toHaveTextContent(/^Spark$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-1b3ebf89-4943-45fb-a57c-97e8c6802978",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/1b3ebf89-4943-45fb-a57c-97e8c6802978`,
    );
    const card = within(rowOf("1b3ebf89-4943-45fb-a57c-97e8c6802978"));
    const text = card.getByTestId("monitor-list-spark-description");
    expect(text).toHaveTextContent(/1,500/);
    expect(text.textContent.match(/\d[\d,]*/g)).toEqual(["24", "1,500", "21"]);
    const chart = card.getByTestId("monitor-list-sparkline");
    expect(chart).toHaveAttribute("aria-hidden", "true");
    const slots = within(chart).getAllByTestId("monitor-list-spark-slot");
    expect(slots).toHaveLength(24);
    const records = slots.map((slot) => ({
      hourStart: slot.getAttribute("data-hour-start"),
      avgMs:
        slot.getAttribute("data-avg-ms") === ""
          ? null
          : Number(slot.getAttribute("data-avg-ms")),
      empty: slot.getAttribute("data-empty") === "true",
    }));
    expect(records).toEqual(
      expect.arrayContaining(
        sparkline(values).map((point) => ({
          hourStart: point.hourStart,
          avgMs: point.avgMs,
          empty: point.avgMs === null,
        })),
      ),
    );
    expect(records.filter((record) => record.empty)).toHaveLength(21);
    expect(records.filter((record) => record.avgMs === 0)).toEqual([
      { hourStart: "2026-09-29T13:00:00.000Z", avgMs: 0, empty: false },
    ]);
  });

  it("writes no-data text for a monitor without any hourly average", async () => {
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    fetchListMock.mockResolvedValue(
      list([
        item({ id: "e3c050b4-64fb-434f-a75a-6d13efef0ae4", name: "Empty" }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-e3c050b4-64fb-434f-a75a-6d13efef0ae4",
      ),
    ).toHaveTextContent(/^Empty$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-e3c050b4-64fb-434f-a75a-6d13efef0ae4",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/e3c050b4-64fb-434f-a75a-6d13efef0ae4`,
    );
    const card = within(rowOf("e3c050b4-64fb-434f-a75a-6d13efef0ae4"));
    expect(
      card.getByTestId("monitor-list-spark-empty"),
    ).not.toBeEmptyDOMElement();
    expect(card.queryByTestId("monitor-list-sparkline")).toBeNull();
    expect(card.queryByTestId("monitor-list-spark-description")).toBeNull();
  });
});

describe("Overview states", () => {
  it("shows a loading state without data while the list is pending", async () => {
    fetchListMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-table")).toBeNull();
    expect(screen.queryByTestId("monitor-overview-empty")).toBeNull();
  });

  it("shows the failure with a retry, never the empty state", async () => {
    fetchListMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "down", 0),
    );
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-empty")).toBeNull();

    fetchListMock.mockResolvedValue(
      list([
        item({ id: "fdd8cde2-5118-480e-9c3d-3e151e41e003", name: "Recovered" }),
      ]),
    );
    await user.click(screen.getByTestId("monitor-overview-retry"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-fdd8cde2-5118-480e-9c3d-3e151e41e003",
      ),
    ).toHaveTextContent(/^Recovered$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-fdd8cde2-5118-480e-9c3d-3e151e41e003",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/fdd8cde2-5118-480e-9c3d-3e151e41e003`,
    );
  });

  it("offers the add link on first run to an owner", async () => {
    fetchListMock.mockResolvedValue(list([]));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-empty"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-overview-empty-add")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/new`,
    );
    expect(screen.getByTestId("monitor-overview-empty-add")).toHaveRole("link");
  });

  it.each(["viewer", "auditor"] as const)(
    "shows a %s the read-only first run and status line without an add control",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      fetchListMock.mockResolvedValue(list([]));
      renderPage();
      expect(
        await screen.findByTestId("monitor-overview-empty"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("monitor-overview-empty")).toBeInTheDocument();
      expect(
        screen.getByTestId("monitor-overview-readonly"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("monitor-overview-empty-add")).toBeNull();
    },
  );

  it.each(["viewer", "auditor"] as const)(
    "hides the add control from a %s when monitors exist",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      fetchListMock.mockResolvedValue(
        list([
          item({ id: "42352acb-4c50-4036-b50a-a21c157ed636", name: "Web" }),
        ]),
      );
      renderPage();
      expect(
        await screen.findByTestId(
          "monitor-list-name-42352acb-4c50-4036-b50a-a21c157ed636",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("monitor-overview-readonly"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("monitor-overview-add")).toBeNull();
    },
  );

  it("shows the reason beside a disabled add button at the 20 monitor limit", async () => {
    fetchListMock.mockResolvedValue(
      list(
        [item({ id: "869529e6-7823-4561-adf8-f1cef3c79ce4", name: "Web" })],
        { total: 20 },
      ),
    );
    renderPage();
    const button = await screen.findByTestId("monitor-overview-add-disabled");
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription();
    const reason = screen.getByTestId("monitor-overview-limit-reason");
    expect(reason).toHaveTextContent(/\b20\b/);
    expect(button).toHaveAttribute("aria-describedby", reason.id);
    expect(screen.queryByTestId("monitor-overview-add")).toBeNull();
  });

  it("shows denied without names, urls or counts to a non-member and sends no request", async () => {
    fetchMeContextMock.mockResolvedValue(
      context("owner", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "f3af01ea-886f-4df2-946d-13f1137dc224",
          name: "SecretMonitor",
        }),
      ]),
    );
    renderPage(A);
    expect(
      await screen.findByTestId("monitor-overview-denied"),
    ).toBeInTheDocument();
    expect(fetchListMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(
        "monitor-list-name-f3af01ea-886f-4df2-946d-13f1137dc224",
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("SecretMonitor");
    expect(document.body.innerHTML).not.toContain(
      "https://m1.example.test/health",
    );
    expect(document.body.textContent).not.toContain("Beta");
    // Beta is the only org staged in this context; the denied page names no organization.
    expect(screen.queryByTestId("monitor-overview-scope")).toBeNull();
    expect(screen.queryByTestId("monitor-overview-total")).toBeNull();
    expect(screen.queryAllByTestId(/^monitor-overview-summary-/)).toHaveLength(
      0,
    );
  });

  it("shows denied and refreshes the membership context when the API denies membership", async () => {
    fetchListMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "denied", 403),
    );
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-denied"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });
    // A second denial after the refresh must not start another refresh.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("monitor-overview-denied")).toBeInTheDocument();
  });

  it("shows the filtered empty state with a clear action and announces the result once", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, _project, params) =>
      Promise.resolve(
        params.health === "down"
          ? list([], { total: 2, pageTotal: 0 })
          : list([
              item({ id: "f53d210c-7242-401f-bb68-63f9f23754f5", name: "Web" }),
              item({
                id: "7fc5edb0-a2b9-46f8-a00d-0f06ab3d00ff",
                name: "Docs",
              }),
            ]),
      ),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-f53d210c-7242-401f-bb68-63f9f23754f5",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f53d210c-7242-401f-bb68-63f9f23754f5",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f53d210c-7242-401f-bb68-63f9f23754f5`,
    );

    await user.click(screen.getByTestId("monitor-overview-health-down"));
    expect(
      await screen.findByTestId("monitor-overview-filtered-empty"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId("monitor-overview-announcement")
        .textContent.match(/\d+/g),
    ).toEqual(["0", "2"]);

    await user.click(screen.getByTestId("monitor-overview-clear"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-f53d210c-7242-401f-bb68-63f9f23754f5",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f53d210c-7242-401f-bb68-63f9f23754f5",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f53d210c-7242-401f-bb68-63f9f23754f5`,
    );
    expect(
      screen
        .getByTestId("monitor-overview-announcement")
        .textContent.match(/\d+/g),
    ).toEqual(["2", "2"]);
  });

  it("moves focus to the search field when the inline clear button unmounts", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(
      list([item({ id: "904289d6-2334-48c7-9cd6-ff076ed1c9bd", name: "Web" })]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-904289d6-2334-48c7-9cd6-ff076ed1c9bd",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-904289d6-2334-48c7-9cd6-ff076ed1c9bd",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/904289d6-2334-48c7-9cd6-ff076ed1c9bd`,
    );

    await user.click(screen.getByTestId("monitor-overview-health-down"));
    const clear = await screen.findByTestId("monitor-overview-clear");
    clear.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("monitor-overview-clear")).toBeNull();
    expect(screen.getByTestId("monitor-overview-search")).toHaveFocus();
  });
});

function summaryCount(health: string): string {
  return within(
    screen.getByTestId(`monitor-overview-health-${health}`),
  ).getByTestId("monitor-overview-health-count").textContent;
}

describe("Overview success", () => {
  it("lists rows in server order, sums the summary to the total and labels the table", async () => {
    const monitors = [
      item({
        id: "5a39cdda-9552-4e75-a4a1-1290ef26c13b",
        name: "Payments",
        health: "down",
      }),
      item({
        id: "ecbeec11-a378-41e0-841b-0b72aa82c3e2",
        name: "Docs",
        health: "unknown",
        healthReason: "stale",
      }),
      item({
        id: "7ce7b1fa-99f3-4f1f-aa14-02aec4e3bd95",
        name: "Web",
        health: "up",
      }),
      item({
        id: "f81280bb-8d92-4f3e-a681-9218e20d7aec",
        name: "Web2",
        health: "up",
      }),
      item({
        id: "9879b1b2-29ce-465d-bd4b-d2305a95f9ea",
        name: "Legacy",
        health: "paused",
        status: "paused",
      }),
    ];
    fetchListMock.mockResolvedValue(list(monitors));
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-5a39cdda-9552-4e75-a4a1-1290ef26c13b",
      ),
    ).toHaveTextContent(/^Payments$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-5a39cdda-9552-4e75-a4a1-1290ef26c13b",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/5a39cdda-9552-4e75-a4a1-1290ef26c13b`,
    );

    expect(
      screen.getByTestId("monitor-overview-table-region"),
    ).toContainElement(screen.getByTestId("monitor-overview-table"));
    const names = within(screen.getByTestId("monitor-overview-table"))
      .getAllByTestId(/^monitor-list-name-/)
      .map((link) => link.textContent);
    expect(names).toEqual(["Payments", "Docs", "Web", "Web2", "Legacy"]);

    const counts = ["up", "down", "unknown", "paused"].map((label) =>
      Number(summaryCount(label)),
    );
    expect(counts).toEqual([2, 1, 1, 1]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5);
    expect(screen.getByTestId("monitor-overview-as-of")).toHaveTextContent(
      formatTimeWithSeconds(DATA_AS_OF),
    );
    expect(screen.getByTestId("monitor-overview-as-of")).toHaveAttribute(
      "datetime",
      DATA_AS_OF,
    );
  });

  it("writes the actual health and reason for each monitor", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "4ad6ee28-2136-4e2b-8bbc-f9ea2768cb96",
          name: "UpRow",
          health: "up",
        }),
        item({
          id: "a50193a1-4705-43e1-b2d0-d7b4125db6de",
          name: "DownRow",
          health: "down",
          openIncident: {
            startedAt: "2026-09-30T07:02:00.000Z",
            reason: "http_status",
          },
        }),
        item({
          id: "6f473ce2-b29a-4b66-8aa7-2571328e193d",
          name: "NeverRow",
          health: "unknown",
          healthReason: "never_checked",
          lastCheckAt: null,
          lastResponseTimeMs: null,
          responseP95Ms24h: null,
        }),
        item({
          id: "a68aa8f9-e3eb-448e-9776-83d1af0913cc",
          name: "SysRow",
          health: "unknown",
          healthReason: "check_error",
        }),
        item({
          id: "275d6d7f-92d3-4b86-a8d8-4c49fc03eea2",
          name: "PausedRow",
          health: "paused",
          status: "paused",
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-4ad6ee28-2136-4e2b-8bbc-f9ea2768cb96",
      ),
    ).toHaveTextContent(/^UpRow$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-4ad6ee28-2136-4e2b-8bbc-f9ea2768cb96",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/4ad6ee28-2136-4e2b-8bbc-f9ea2768cb96`,
    );

    for (const [name, health] of [
      ["4ad6ee28-2136-4e2b-8bbc-f9ea2768cb96", "up"],
      ["a50193a1-4705-43e1-b2d0-d7b4125db6de", "down"],
      ["6f473ce2-b29a-4b66-8aa7-2571328e193d", "unknown"],
      ["a68aa8f9-e3eb-448e-9776-83d1af0913cc", "unknown"],
      ["275d6d7f-92d3-4b86-a8d8-4c49fc03eea2", "paused"],
    ] as const) {
      const pill = within(rowOf(name)).getByTestId("monitor-list-health");
      expect(pill).toHaveAttribute("data-health", health);
      expect(pill).not.toBeEmptyDOMElement();
    }
    expect(
      within(rowOf("a50193a1-4705-43e1-b2d0-d7b4125db6de")).getByTestId(
        "monitor-list-incident",
      ),
    ).toHaveAttribute("data-reason", "http_status");
    expect(
      within(rowOf("6f473ce2-b29a-4b66-8aa7-2571328e193d")).getByTestId(
        "monitor-list-reason",
      ),
    ).toHaveAttribute("data-health-reason", "never_checked");
    expect(
      within(rowOf("a68aa8f9-e3eb-448e-9776-83d1af0913cc")).getByTestId(
        "monitor-list-reason",
      ),
    ).toHaveAttribute("data-health-reason", "check_error");
  });

  it("shows failure counts, last-known-down and stale wording without changing the health", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "ceadac25-860f-450b-8a5a-919bed1d4be9",
          name: "Flaky",
          health: "up",
          consecutiveFailures: 1,
        }),
        item({
          id: "c58aad2b-5f18-4621-8be3-7725e021ac31",
          name: "Silent",
          health: "unknown",
          healthReason: "stale",
          lastKnownDown: true,
          lastCheckAt: "2026-09-30T06:10:00.000Z",
        }),
        item({
          id: "7c5345e5-3c1f-4063-b889-7293a19f0c26",
          name: "Edited",
          health: "unknown",
          healthReason: "awaiting_new_config",
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-ceadac25-860f-450b-8a5a-919bed1d4be9",
      ),
    ).toHaveTextContent(/^Flaky$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-ceadac25-860f-450b-8a5a-919bed1d4be9",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/ceadac25-860f-450b-8a5a-919bed1d4be9`,
    );

    const flaky = rowOf("ceadac25-860f-450b-8a5a-919bed1d4be9");
    expect(
      within(flaky).getByTestId("monitor-list-failures"),
    ).toHaveTextContent(/\b1\b/);
    expect(within(flaky).getByTestId("monitor-list-health")).toHaveAttribute(
      "data-health",
      "up",
    );
    const silent = rowOf("c58aad2b-5f18-4621-8be3-7725e021ac31");
    expect(
      within(silent).getByTestId("monitor-list-last-known-down"),
    ).not.toBeEmptyDOMElement();
    expect(within(silent).getByTestId("monitor-list-reason")).toHaveAttribute(
      "data-health-reason",
      "stale",
    );
    expect(within(silent).getByTestId("monitor-list-health")).toHaveAttribute(
      "data-health",
      "unknown",
    );
    expect(
      within(silent).getByTestId("monitor-list-reason-time"),
    ).toHaveAttribute("datetime", "2026-09-30T06:10:00.000Z");
    expect(
      within(rowOf("7c5345e5-3c1f-4063-b889-7293a19f0c26")).getByTestId(
        "monitor-list-reason",
      ),
    ).toHaveAttribute("data-health-reason", "awaiting_new_config");
  });

  it("renders every SSL level and its actual days remaining", async () => {
    // The table keeps to the design's columns; SSL stays on the cards.
    window.localStorage.setItem("nightwatch:monitors-view", "cards");
    const levels: Item["ssl"][] = [
      {
        level: "ok",
        daysRemaining: 128,
        host: "h",
        issuer: null,
        notAfter: null,
      },
      {
        level: "caution",
        daysRemaining: 30,
        host: "h",
        issuer: null,
        notAfter: null,
      },
      {
        level: "danger",
        daysRemaining: 7,
        host: "h",
        issuer: null,
        notAfter: null,
      },
      {
        level: "expired",
        daysRemaining: -2,
        host: "h",
        issuer: null,
        notAfter: null,
      },
      {
        level: "expired",
        daysRemaining: null,
        host: "h",
        issuer: null,
        notAfter: null,
      },
      {
        level: "not_https",
        daysRemaining: null,
        host: null,
        issuer: null,
        notAfter: null,
      },
      {
        level: "unreadable",
        daysRemaining: null,
        host: "h",
        issuer: null,
        notAfter: null,
      },
      {
        level: "no_data",
        daysRemaining: null,
        host: null,
        issuer: null,
        notAfter: null,
      },
    ];
    const monitors = levels.map((ssl, index) =>
      item({ name: `Ssl${String(index)}`, ssl }),
    );
    fetchListMock.mockResolvedValue(list(monitors));
    renderPage();
    await screen.findAllByTestId(/^monitor-list-row-/);
    for (const monitor of monitors) {
      const label = within(rowOf(monitor.id)).getByTestId("monitor-list-ssl");
      expect(label).toHaveAttribute("data-ssl-level", monitor.ssl.level);
      expect(label).not.toBeEmptyDOMElement();
      expect(label).toHaveAttribute(
        "data-days-remaining",
        monitor.ssl.daysRemaining === null
          ? ""
          : String(monitor.ssl.daysRemaining),
      );
      if (monitor.ssl.daysRemaining !== null)
        expect(label).toHaveTextContent(
          new RegExp(`\\b${String(Math.abs(monitor.ssl.daysRemaining))}\\b`),
        );
    }
  });

  it("writes missing uptime, p95 and last check as text and shows partial coverage", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "6bbcaabc-5861-41de-a99a-6cab673d04ac",
          name: "Fresh",
          lastResponseTimeMs: null,
          responseP95Ms24h: null,
          lastCheckAt: null,
          uptime: {
            h24: { percent: null, checks: 0, coveragePercent: 0 },
            d30: { percent: null, checks: 0, coveragePercent: 0 },
          },
        }),
        item({
          id: "0d3c2a55-0b0e-4d0a-9d36-1f1d2f0c7a11",
          name: "Partial",
          responseP95Ms24h: 240,
          uptime: {
            h24: { percent: 97.5, checks: 10, coveragePercent: 61 },
            d30: { percent: 99, checks: 10, coveragePercent: 61 },
          },
        }),
      ]),
    );
    renderPage();
    await screen.findByTestId(
      "monitor-list-name-6bbcaabc-5861-41de-a99a-6cab673d04ac",
    );
    const fresh = within(rowOf("6bbcaabc-5861-41de-a99a-6cab673d04ac"));
    for (const key of ["h24", "p95", "lastCheck"]) {
      expect(
        fresh.getByTestId(`monitor-list-cell-${key}`),
      ).not.toBeEmptyDOMElement();
      expect(
        fresh.getByTestId(`monitor-list-cell-${key}`),
      ).not.toHaveTextContent(/\d/);
      // The dash is the mark; the sentence is for screen readers.
      expect(fresh.getByTestId(`monitor-list-cell-${key}`)).toHaveTextContent(
        "ไม่มีข้อมูล",
      );
    }
    const partial = within(rowOf("0d3c2a55-0b0e-4d0a-9d36-1f1d2f0c7a11"));
    expect(partial.getByTestId("monitor-list-p95-value")).toHaveTextContent(
      /^240 ms$/,
    );
    expect(partial.getByTestId("monitor-list-uptime-value")).toHaveTextContent(
      /^97\.50%$/,
    );
    expect(
      partial
        .getByTestId("monitor-list-coverage")
        .textContent.match(/[\d.]+%/g),
    ).toEqual(["61.00%"]);
  });

  it("marks each last check time with its instant", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "cde37086-af6e-4878-abc7-84b2238f07a7",
          name: "Web",
          lastCheckAt: "2026-09-30T07:30:00.000Z",
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-cde37086-af6e-4878-abc7-84b2238f07a7",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-cde37086-af6e-4878-abc7-84b2238f07a7",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/cde37086-af6e-4878-abc7-84b2238f07a7`,
    );
    expect(
      within(rowOf("cde37086-af6e-4878-abc7-84b2238f07a7")).getByTestId(
        "monitor-list-check-time",
      ),
    ).toHaveAttribute("datetime", "2026-09-30T07:30:00.000Z");
    expect(
      screen.getByTestId("monitor-list-heading-lastCheck"),
    ).toBeInTheDocument();
  });
});

describe("Overview times, focus and filter failures", () => {
  it("shows the date for a time that is not today and only the time for today", async () => {
    const earlier = "2026-09-28T07:02:00.000Z";
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "5189c3f5-3cef-4149-92be-d16080697bc0",
          name: "DownOld",
          health: "down",
          openIncident: { startedAt: earlier, reason: "timeout" },
          lastCheckAt: earlier,
        }),
        item({
          id: "6b47e17b-00ed-4564-9005-03d938329580",
          name: "StaleOld",
          health: "unknown",
          healthReason: "stale",
          lastCheckAt: earlier,
        }),
        item({
          id: "66b38107-4146-4365-b9c2-271fa7ee2be1",
          name: "Today",
          lastCheckAt: "2026-09-30T07:30:00.000Z",
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-5189c3f5-3cef-4149-92be-d16080697bc0",
      ),
    ).toHaveTextContent(/^DownOld$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-5189c3f5-3cef-4149-92be-d16080697bc0",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/5189c3f5-3cef-4149-92be-d16080697bc0`,
    );

    const withDate = formatDateTime(earlier);
    for (const [name, source] of [
      ["5189c3f5-3cef-4149-92be-d16080697bc0", "incident"],
      ["6b47e17b-00ed-4564-9005-03d938329580", "reason"],
    ] as const) {
      const row = within(rowOf(name));
      for (const key of [
        `monitor-list-${source}-time`,
        "monitor-list-check-time",
      ]) {
        expect(row.getByTestId(key)).toHaveAttribute("datetime", earlier);
        expect(row.getByTestId(key)).toHaveTextContent(withDate);
      }
    }
    expect(
      within(rowOf("66b38107-4146-4365-b9c2-271fa7ee2be1")).getByTestId(
        "monitor-list-check-time",
      ),
    ).toHaveAttribute("datetime", "2026-09-30T07:30:00.000Z");
    expect(
      screen.getByTestId("monitor-list-heading-health"),
    ).toBeInTheDocument();
  });

  it("names the timezone on the recent events card and shows each event's date", async () => {
    const at = "2026-09-29T07:02:00.000Z";
    fetchListMock.mockResolvedValue(
      list([item({ id: "05f30d02-294a-4928-8c7f-97a047149b30", name: "Web" })]),
    );
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
    const card = await screen.findByTestId("monitor-overview-events");
    expect(
      await within(card).findByTestId("monitor-overview-event-time"),
    ).toHaveAttribute("datetime", at);
    expect(card).toHaveTextContent(TIME_ZONE);
  });

  it("keeps focus on the refresh button while it refreshes and ignores a second press", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValueOnce(
      list([item({ id: "69dfad28-dc40-44c9-a526-6355ac476e6e", name: "Web" })]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-69dfad28-dc40-44c9-a526-6355ac476e6e",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-69dfad28-dc40-44c9-a526-6355ac476e6e",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/69dfad28-dc40-44c9-a526-6355ac476e6e`,
    );

    const pending = Promise.withResolvers<MonitorListResponse>();
    fetchListMock.mockReturnValue(pending.promise);
    const callsBefore = fetchListMock.mock.calls.length;
    const button = screen.getByTestId("monitor-overview-refresh");
    await user.click(button);

    const busy = screen.getByTestId("monitor-overview-refresh");
    expect(busy).toBe(button);
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(fetchListMock.mock.calls.length).toBe(callsBefore + 1);

    await act(async () => {
      pending.resolve(
        list([
          item({ id: "69dfad28-dc40-44c9-a526-6355ac476e6e", name: "Web" }),
        ]),
      );
      await pending.promise;
    });
    expect(await screen.findByTestId("monitor-overview-refresh")).toHaveFocus();
  });

  it("keeps the filter controls and offers a clear action when a new filter fails to load", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, _project, params) =>
      params.health === "down"
        ? Promise.reject(new ApiError("NETWORK_ERROR", "x", 0))
        : Promise.resolve(
            list([
              item({ id: "1a36311e-1088-40d4-9ec9-4be380a096fe", name: "Web" }),
            ]),
          ),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-1a36311e-1088-40d4-9ec9-4be380a096fe",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-1a36311e-1088-40d4-9ec9-4be380a096fe",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/1a36311e-1088-40d4-9ec9-4be380a096fe`,
    );

    await user.click(screen.getByTestId("monitor-overview-health-down"));
    expect(
      await screen.findByTestId("monitor-overview-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-overview-health-down")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("monitor-overview-search")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-empty")).toBeNull();

    await user.click(screen.getByTestId("monitor-overview-clear"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-1a36311e-1088-40d4-9ec9-4be380a096fe",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-1a36311e-1088-40d4-9ec9-4be380a096fe",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/1a36311e-1088-40d4-9ec9-4be380a096fe`,
    );
    expect(screen.getByTestId("monitor-overview-health-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the failure count on an unknown row whose first result in the new config failed", async () => {
    fetchListMock.mockResolvedValue(
      list([
        item({
          id: "5e6076a6-6e93-4a7d-b2b3-95cd099e403c",
          name: "FirstFail",
          health: "unknown",
          healthReason: null,
          consecutiveFailures: 1,
        }),
      ]),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-5e6076a6-6e93-4a7d-b2b3-95cd099e403c",
      ),
    ).toHaveTextContent(/^FirstFail$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-5e6076a6-6e93-4a7d-b2b3-95cd099e403c",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/5e6076a6-6e93-4a7d-b2b3-95cd099e403c`,
    );
    const row = within(rowOf("5e6076a6-6e93-4a7d-b2b3-95cd099e403c"));
    expect(row.getByTestId("monitor-list-failures")).toHaveTextContent(/\b1\b/);
    expect(row.getByTestId("monitor-list-health")).toHaveAttribute(
      "data-health",
      "unknown",
    );
  });

  it("offers no add control until the monitor count is known", async () => {
    fetchListMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByTestId("monitor-overview-loading");
    expect(screen.queryByTestId("monitor-overview-add")).toBeNull();
  });

  it("hides the pagination summary under the filtered-empty state", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, _project, params) =>
      Promise.resolve(
        params.health === "down"
          ? list([], { total: 2, pageTotal: 0 })
          : list([
              item({ id: "0efa9833-5468-426d-83e5-077fc85d867d", name: "Web" }),
            ]),
      ),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-0efa9833-5468-426d-83e5-077fc85d867d",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-0efa9833-5468-426d-83e5-077fc85d867d",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/0efa9833-5468-426d-83e5-077fc85d867d`,
    );
    await user.click(screen.getByTestId("monitor-overview-health-down"));
    await screen.findByTestId("monitor-overview-filtered-empty");
    expect(screen.queryByTestId("monitor-overview-pagination")).toBeNull();
    expect(screen.queryByTestId("monitor-overview-pagination")).toBeNull();
  });
});

describe("Overview recent events", () => {
  it("lists incidents and SSL warnings", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ id: "2cb57076-453e-4285-8976-6495150a3fdd", name: "Web" })]),
    );
    const opened = item(),
      warned = item(),
      closed = item();
    fetchEventsMock.mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          monitorId: opened.id,
          monitorName: "Payments",
          at: "2026-09-30T07:02:00.000Z",
          reason: "timeout",
        },
        {
          kind: "ssl_level",
          monitorId: warned.id,
          monitorName: "Payments",
          at: "2026-09-30T05:00:00.000Z",
          reason: null,
          sslLevel: "danger",
          daysRemaining: 5,
        },
        {
          kind: "incident_closed",
          monitorId: closed.id,
          monitorName: "Web",
          at: "2026-09-29T14:14:00.000Z",
          reason: "recovered",
          durationSeconds: 480,
        },
      ],
    });
    renderPage();
    const card = await screen.findByTestId("monitor-overview-events");
    const rows = await within(card).findAllByTestId("monitor-overview-event");
    expect(rows).toHaveLength(3);
    const records = rows.map((row) => {
      const scope = within(row),
        description = scope
          .getByTestId("monitor-overview-event-description")
          .cloneNode(true) as HTMLElement;
      within(description).getByTestId("monitor-overview-event-time").remove();
      expect(description).not.toBeEmptyDOMElement();
      const name = scope.getByTestId("monitor-overview-event-monitor");
      return {
        kind: row.getAttribute("data-event-kind"),
        reason: row.getAttribute("data-reason"),
        sslLevel: row.getAttribute("data-ssl-level"),
        days: row.getAttribute("data-days-remaining"),
        duration: row.getAttribute("data-duration-seconds"),
        name: name.textContent,
        href: name.getAttribute("href"),
        at: scope
          .getByTestId("monitor-overview-event-time")
          .getAttribute("datetime"),
        numbers: description.textContent.match(/\d+/g) ?? [],
      };
    });
    expect(records).toEqual(
      expect.arrayContaining([
        {
          kind: "incident_opened",
          href: `/organizations/${A}/projects/${P}/monitors/${opened.id}`,
          reason: "timeout",
          sslLevel: "",
          days: "",
          duration: "",
          name: "Payments",
          at: "2026-09-30T07:02:00.000Z",
          numbers: [],
        },
        {
          kind: "ssl_level",
          href: `/organizations/${A}/projects/${P}/monitors/${warned.id}`,
          reason: "",
          sslLevel: "danger",
          days: "5",
          duration: "",
          name: "Payments",
          at: "2026-09-30T05:00:00.000Z",
          numbers: ["5"],
        },
        {
          kind: "incident_closed",
          href: `/organizations/${A}/projects/${P}/monitors/${closed.id}`,
          reason: "recovered",
          sslLevel: "",
          days: "",
          duration: "480",
          name: "Web",
          at: "2026-09-29T14:14:00.000Z",
          numbers: ["8"],
        },
      ]),
    );
  });

  it("shows its own empty text", async () => {
    fetchListMock.mockResolvedValue(
      list([item({ id: "5991a0a4-323a-48a5-8238-505645ec0855", name: "Web" })]),
    );
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-health-down"),
    ).toBeInTheDocument();
  });

  it("keeps the table when the card fails and retries only the card", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(
      list([item({ id: "f00e20af-74f7-4105-a609-63f14cebb06b", name: "Web" })]),
    );
    fetchEventsMock.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "x", 0),
    );
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-events-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "monitor-list-name-f00e20af-74f7-4105-a609-63f14cebb06b",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-f00e20af-74f7-4105-a609-63f14cebb06b",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/f00e20af-74f7-4105-a609-63f14cebb06b`,
    );

    fetchEventsMock.mockResolvedValue(noEvents);
    const listCalls = fetchListMock.mock.calls.length;
    await user.click(
      within(screen.getByTestId("monitor-overview-events")).getByTestId(
        "monitor-overview-events-retry",
      ),
    );
    expect(
      await screen.findByTestId("monitor-overview-health-down"),
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
    fetchListMock.mockImplementation((_org, _project, params) => {
      calls += 1;
      if (params.health === "down") {
        // Later refetches report other totals: a live region bound to the data would change.
        return Promise.resolve(
          list(
            [
              item({
                id: "b4c61fe5-fa39-466d-b38f-2909834195e7",
                name: "Down1",
              }),
            ],
            {
              total: 12 + calls,
              pageTotal: 3 + calls,
            },
          ),
        );
      }
      return Promise.resolve(
        list(
          [item({ id: "5c7aa54f-24bd-46b6-a1e0-c33542227d8c", name: "Web" })],
          { total: 12, pageTotal: 12 },
        ),
      );
    });
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-5c7aa54f-24bd-46b6-a1e0-c33542227d8c",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-5c7aa54f-24bd-46b6-a1e0-c33542227d8c",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/5c7aa54f-24bd-46b6-a1e0-c33542227d8c`,
    );
    const region = screen.getByTestId("monitor-overview-announcement");
    expect(region).toHaveTextContent("");

    await user.click(screen.getByTestId("monitor-overview-health-down"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-b4c61fe5-fa39-466d-b38f-2909834195e7",
      ),
    ).toHaveTextContent(/^Down1$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-b4c61fe5-fa39-466d-b38f-2909834195e7",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/b4c61fe5-fa39-466d-b38f-2909834195e7`,
    );
    await waitFor(() => {
      expect(region.textContent.match(/\d+/g)).toHaveLength(2);
    });
    const announced = region.textContent;
    expect(announced.match(/\d+/g)).toEqual([
      String(3 + calls),
      String(12 + calls),
    ]);

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
    expect(screen.getByTestId("monitor-overview-results")).toBeInTheDocument();
  });

  it("debounces the search and resets to the first page", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, _project, params) =>
      Promise.resolve(
        params.q === "pay"
          ? list(
              [
                item({
                  id: "145b829a-4b43-4c4a-89fc-904b5256ee80",
                  name: "Payments",
                }),
              ],
              { total: 12, pageTotal: 1 },
            )
          : list(
              [
                item({
                  id: "7e634261-a627-4884-a7e4-61ecef13ae89",
                  name: "Web",
                }),
              ],
              { total: 12, pageTotal: 12 },
            ),
      ),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-7e634261-a627-4884-a7e4-61ecef13ae89",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-7e634261-a627-4884-a7e4-61ecef13ae89",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/7e634261-a627-4884-a7e4-61ecef13ae89`,
    );
    await user.type(screen.getByTestId("monitor-overview-search"), "pay");
    expect(
      await screen.findByTestId(
        "monitor-list-name-145b829a-4b43-4c4a-89fc-904b5256ee80",
      ),
    ).toHaveTextContent(/^Payments$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-145b829a-4b43-4c4a-89fc-904b5256ee80",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/145b829a-4b43-4c4a-89fc-904b5256ee80`,
    );
    expect(
      screen
        .getByTestId("monitor-overview-announcement")
        .textContent.match(/\d+/g),
    ).toEqual(["1", "12"]);
    const queries = fetchListMock.mock.calls.map(([, , params]) => params.q);
    expect(queries).not.toContain("p");
    expect(queries).not.toContain("pa");
  });

  it("keeps the data and warns with its time when a refetch fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    fetchListMock.mockResolvedValueOnce(
      list([item({ id: "8f278a12-a6af-445b-8805-d2597bf624d4", name: "Web" })]),
    );
    fetchListMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-8f278a12-a6af-445b-8805-d2597bf624d4",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-8f278a12-a6af-445b-8805-d2597bf624d4",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/8f278a12-a6af-445b-8805-d2597bf624d4`,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const warning = await screen.findByTestId("monitor-overview-as-of");
    expect(warning).toHaveTextContent(formatTimeWithSeconds(DATA_AS_OF));
    expect(
      screen.getByTestId(
        "monitor-list-name-8f278a12-a6af-445b-8805-d2597bf624d4",
      ),
    ).toHaveTextContent(/^Web$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-8f278a12-a6af-445b-8805-d2597bf624d4",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/8f278a12-a6af-445b-8805-d2597bf624d4`,
    );
    expect(screen.queryByTestId("monitor-overview-error")).toBeNull();
  });

  it("pages with the server offset", async () => {
    const user = userEvent.setup();
    fetchListMock.mockImplementation((_org, _project, params) =>
      Promise.resolve(
        params.offset === 0
          ? list(
              [
                item({
                  id: "df1835fa-2769-4db7-9344-a88a483ceaa9",
                  name: "First",
                }),
              ],
              { total: 30, pageTotal: 30 },
            )
          : list(
              [
                item({
                  id: "7e0ff85c-bf37-4aa4-b51a-610770787bf2",
                  name: "Second",
                }),
              ],
              {
                total: 30,
                pageTotal: 30,
                offset: 25,
              },
            ),
      ),
    );
    renderPage();
    expect(
      await screen.findByTestId(
        "monitor-list-name-df1835fa-2769-4db7-9344-a88a483ceaa9",
      ),
    ).toHaveTextContent(/^First$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-df1835fa-2769-4db7-9344-a88a483ceaa9",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/df1835fa-2769-4db7-9344-a88a483ceaa9`,
    );
    await user.click(screen.getByTestId("monitor-overview-next"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-7e0ff85c-bf37-4aa4-b51a-610770787bf2",
      ),
    ).toHaveTextContent(/^Second$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-7e0ff85c-bf37-4aa4-b51a-610770787bf2",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/7e0ff85c-bf37-4aa4-b51a-610770787bf2`,
    );
    expect(screen.getByTestId("monitor-overview-previous")).toBeEnabled();
  });
});

describe("Overview Organization switch", () => {
  it("shows no data of the previous Organization while its request is pending or after it resolves late", async () => {
    const user = userEvent.setup();
    const late = Promise.withResolvers<MonitorListResponse>();
    fetchListMock.mockImplementation((organizationId) =>
      organizationId === A
        ? late.promise
        : Promise.resolve(
            list([
              item({
                id: "127ba746-07b5-46c1-b7bc-9fe0588f66a3",
                name: "BetaMonitor",
              }),
            ]),
          ),
    );
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    renderPage(A);
    await screen.findByTestId("monitor-overview-loading");

    await user.click(screen.getByTestId("overview-switch-organization"));
    expect(
      await screen.findByTestId(
        "monitor-list-name-127ba746-07b5-46c1-b7bc-9fe0588f66a3",
      ),
    ).toHaveTextContent(/^BetaMonitor$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-127ba746-07b5-46c1-b7bc-9fe0588f66a3",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${B}/projects/${P}/monitors/127ba746-07b5-46c1-b7bc-9fe0588f66a3`,
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/projects/${P}/monitors`,
    );

    await act(async () => {
      late.resolve(
        list([
          item({
            id: "71412444-46ff-4aa5-83b3-9bb9d10786a3",
            name: "AlphaMonitor",
          }),
        ]),
      );
      await late.promise;
    });
    expect(
      screen.queryByTestId(
        "monitor-list-name-71412444-46ff-4aa5-83b3-9bb9d10786a3",
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("AlphaMonitor");
    expect(
      screen.getByTestId(
        "monitor-list-name-127ba746-07b5-46c1-b7bc-9fe0588f66a3",
      ),
    ).toHaveTextContent(/^BetaMonitor$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-127ba746-07b5-46c1-b7bc-9fe0588f66a3",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${B}/projects/${P}/monitors/127ba746-07b5-46c1-b7bc-9fe0588f66a3`,
    );
  });

  it("hides origin organization rows while the destination organization loads", async () => {
    const user = userEvent.setup();
    const pendingB = Promise.withResolvers<MonitorListResponse>();
    fetchListMock.mockImplementation((organizationId) =>
      organizationId === A
        ? Promise.resolve(
            list([
              item({
                id: "5446de89-f053-45c5-a4e1-c13b82620c60",
                name: "AlphaMonitor",
              }),
            ]),
          )
        : pendingB.promise,
    );
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    renderPage(A);
    expect(
      await screen.findByTestId(
        "monitor-list-name-5446de89-f053-45c5-a4e1-c13b82620c60",
      ),
    ).toHaveTextContent(/^AlphaMonitor$/);
    expect(
      screen.getByTestId(
        "monitor-list-name-5446de89-f053-45c5-a4e1-c13b82620c60",
      ),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/5446de89-f053-45c5-a4e1-c13b82620c60`,
    );

    await user.click(screen.getByTestId("overview-switch-organization"));
    expect(
      await screen.findByTestId("monitor-overview-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "monitor-list-name-5446de89-f053-45c5-a4e1-c13b82620c60",
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("AlphaMonitor");
  });
});

describe("Overview one-time notice", () => {
  it("shows the notice a monitor page handed over and moves focus to the heading", async () => {
    fetchListMock.mockResolvedValue(list([item()]));
    renderPage(A, { notice: "deleted" });
    expect(
      await screen.findByTestId("monitor-overview-notice"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-overview-heading")).toHaveFocus();
  });

  it("clears the state so the notice does not come back on reload or back", async () => {
    fetchListMock.mockResolvedValue(list([item()]));
    renderPage(A, { notice: "alreadyDeleted" });
    expect(
      await screen.findByTestId("monitor-overview-notice"),
    ).toBeInTheDocument();
    // The history entry no longer carries it, so a reload or a back navigation shows nothing.
    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent(/^null$/);
    });
  });

  it("ignores state that is not one of the known notice keys", async () => {
    fetchListMock.mockResolvedValue(list([item()]));
    renderPage(A, { notice: "<b>free text</b>" });
    await screen.findByTestId("monitor-overview-heading");
    expect(screen.queryByTestId("monitor-overview-notice")).toBeNull();
    expect(screen.queryByTestId("monitor-overview-notice")).toBeNull();
  });
});

describe("Project monitor list", () => {
  const ids = {
    down: "a1000000-0000-4000-8000-000000000001",
    up: "a1000000-0000-4000-8000-000000000002",
    paused: "a1000000-0000-4000-8000-000000000003",
  };
  const monitors = () => [
    item({
      id: ids.down,
      name: "Checkout API",
      url: "https://api.acme.example/checkout/health",
      health: "down",
      intervalSeconds: 60,
      responseP95Ms24h: null,
      uptime: {
        h24: { percent: 98.12, checks: 100, coveragePercent: 100 },
        d30: { percent: 99, checks: 100, coveragePercent: 100 },
      },
    }),
    item({
      id: ids.up,
      name: "Payment Gateway",
      url: "https://pay.acme.example",
      health: "up",
      intervalSeconds: 60,
      responseP95Ms24h: 212,
    }),
    item({
      id: ids.paused,
      name: "Batch Settlement",
      health: "paused",
      status: "paused",
      intervalSeconds: 300,
    }),
  ];

  it("names the Project and the caller's Project role in the header", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: "admin" }),
    );
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-scope"),
    ).toHaveTextContent(PROJECT_NAME);
    expect(screen.getByTestId("page-scope-tag")).toHaveTextContent(
      "โปรเจกต์ · ผู้ดูแล",
    );
    expect(screen.getByTestId("monitor-overview-heading")).toHaveTextContent(
      "ตรวจสถานะบริการ",
    );
  });

  it("names the Organization role for an Owner who is not a member of the Project", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: null }),
    );
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    await screen.findByTestId("monitor-overview-scope");
    expect(screen.getByTestId("page-scope-tag")).toHaveTextContent(
      "องค์กร · เจ้าของ",
    );
  });

  it("requests the Project's own list and sums the summary line", async () => {
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    await screen.findByTestId("monitor-overview-total");
    expect(fetchListMock).toHaveBeenCalledWith(A, P, expect.any(Object));
    expect(screen.getByTestId("monitor-overview-total")).toHaveTextContent(
      "3 มอนิเตอร์",
    );
    expect(screen.getByTestId("monitor-overview-down")).toHaveTextContent(
      "ล่ม 1",
    );
    // Mixed intervals: the shortest one is named as the fastest pace.
    expect(screen.getByTestId("monitor-overview-interval")).toHaveTextContent(
      /ตรวจถี่สุดทุก 1 นาที/,
    );
  });

  it("names the one interval when every monitor shares it", async () => {
    fetchListMock.mockResolvedValue(list(monitors().slice(0, 2)));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-interval"),
    ).toHaveTextContent(/^ตรวจทุก 1 นาที$/);
  });

  it("filters by status in the design's order, each with its count and a pressed state", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    const group = await screen.findByTestId("monitor-overview-health-filter");
    expect(group).toHaveRole("group");
    const labels = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual([
      "ทั้งหมด3",
      "ล่ม1",
      "ใช้งานได้1",
      "หยุดชั่วคราว1",
      expect.stringMatching(/^ไม่ทราบ?สถานะ0$|0$/),
    ]);
    expect(screen.getByTestId("monitor-overview-health-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByTestId("monitor-overview-health-down"));
    expect(screen.getByTestId("monitor-overview-health-down")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(fetchListMock).toHaveBeenLastCalledWith(
      A,
      P,
      expect.objectContaining({ health: "down" }),
    );
  });

  it("lists name with URL, status, p95, 24 h availability and last check", async () => {
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    await screen.findByTestId(`monitor-list-name-${ids.down}`);
    const headings = within(screen.getByTestId("monitor-overview-table"))
      .getAllByRole("columnheader")
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "มอนิเตอร์",
      "สถานะ",
      "เวลาตอบสนอง · p95 · 24 ชม.",
      "ความพร้อมใช้งาน · 24 ชม.",
      `ตรวจล่าสุด (${TIME_ZONE})`,
    ]);
    const down = within(rowOf(ids.down));
    expect(down.getByTestId("monitor-list-url")).toHaveTextContent(
      "https://api.acme.example/checkout/health",
    );
    expect(down.getByTestId("monitor-list-cell-p95")).toHaveTextContent(
      "ไม่มีข้อมูล",
    );
    expect(down.getByTestId("monitor-list-uptime-value")).toHaveTextContent(
      "98.12%",
    );
    expect(
      within(rowOf(ids.up)).getByTestId("monitor-list-p95-value"),
    ).toHaveTextContent("212 ms");
  });

  it("closes the list with the range shown and the Project it is limited to", async () => {
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-pagination"),
    ).toHaveTextContent(`แสดง 1–3 จาก 3 · เฉพาะมอนิเตอร์ของ ${PROJECT_NAME}`);
  });

  it("tells a Project without monitors that it has none and offers the add link to a Project admin", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: "admin" }),
    );
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValue(list([]));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-empty"),
    ).toHaveTextContent("ยังไม่มีมอนิเตอร์ในโปรเจกต์นี้");
    expect(screen.getByTestId("monitor-overview-empty-add")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/new`,
    );
  });

  it("gives a Project admin who is only an Organization viewer the add control", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: "admin" }),
    );
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    expect(await screen.findByTestId("monitor-overview-add")).toHaveRole(
      "link",
    );
    expect(screen.queryByTestId("monitor-overview-readonly")).toBeNull();
  });

  it("keeps a Project member who is only an Organization viewer read-only", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue(
      projectDetail({ myRole: "member" }),
    );
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValue(list(monitors()));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-readonly"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-add")).toBeNull();
  });

  it("shows the same gone state for a Project the caller cannot read", async () => {
    vi.mocked(fetchProjectDetail).mockRejectedValue(
      new ApiError("PROJECT_NOT_FOUND", "not found", 404),
    );
    fetchListMock.mockRejectedValue(
      new ApiError("PROJECT_NOT_FOUND", "not found", 404),
    );
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    renderPage();
    expect(
      await screen.findByTestId("monitor-overview-project-gone"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-total")).toBeNull();
    expect(document.body.textContent).not.toContain(PROJECT_NAME);
  });
});
