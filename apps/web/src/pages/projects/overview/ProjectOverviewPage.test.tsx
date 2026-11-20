import type { MonitorListResponse } from "@nightwatch/api-contract";
import { MONITOR_LIMIT_PER_PROJECT } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardUnassignedNetwork } from "../../../test/guard-network";
import { bindQueryClientIdentity } from "../../../lib/queryClient";
import { fetchMeContext, updateActiveOrganization } from "../../../lib/api/me";
import {
  fetchProjectDetail,
  fetchProjectMembers,
  projectQueryKeys,
} from "../../../lib/api/projects";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  MONITOR_LIST_PAGE_SIZE,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import { ApiError } from "../../../lib/api/client";
import { TenantProvider, useTenant } from "../../../lib/tenant/TenantProvider";
import {
  A,
  B,
  P,
  DATA_AS_OF,
  context,
  createMonitorListFixtures,
  projectDetail,
  must,
} from "../../monitors/detail-test-support";
import { formatDuration, incidentReasonLabel } from "../../monitors/format";
import { ProjectOverviewPage } from "./ProjectOverviewPage";

guardUnassignedNetwork();
vi.mock("../../../lib/api/me", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../../lib/api/projects", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchProjectDetail: vi.fn(),
  fetchProjectMembers: vi.fn(),
}));
vi.mock("../../../lib/api/monitors", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
}));

const { item, list } = createMonitorListFixtures();

const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function Switch() {
  const { switchOrg } = useTenant();
  return (
    <>
      <button data-testid="switch" onClick={() => void switchOrg(B)}>
        switch
      </button>
      <Outlet />
    </>
  );
}
function renderPage(org = A) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(client, "user-1");
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        element: <Switch />,
        children: [
          {
            path: "/organizations/:organizationId/projects/:projectId/overview",
            element: <ProjectOverviewPage />,
          },
          {
            path: "/organizations/:organizationId/projects",
            element: <div data-testid="projects">projects</div>,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${org}/projects/${P}/overview`] },
  );
  routers.push(router);
  render(
    <QueryClientProvider client={client}>
      <TenantProvider>
        <RouterProvider router={router} />
      </TenantProvider>
    </QueryClientProvider>,
  );
  return { client, router };
}
beforeEach(() => {
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.mocked(fetchMonitorList).mockResolvedValue(list([item()]));
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
});
afterEach(async () => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  for (const client of clients.splice(0)) {
    await client.cancelQueries();
    client.clear();
  }
  vi.useRealTimers();
  vi.resetAllMocks();
});
const ready = () => screen.findByTestId("project-overview-summary");
const refreshList = (client: QueryClient) =>
  act(() =>
    client.invalidateQueries({
      queryKey: monitorQueryKeys.list(A, P, {
        limit: MONITOR_LIST_PAGE_SIZE,
        offset: 0,
      }),
    }),
  );

describe.each(["list", "recent-events"] as const)(
  "Project overview %s polling",
  (consumer) => {
    it.each([
      ["MEMBERSHIP_DENIED", 403, 0],
      ["PERMISSION_DENIED", 403, 0],
      ["MONITOR_NOT_FOUND", 404, 0],
      ["PROJECT_NOT_FOUND", 404, 0],
      ["NETWORK_ERROR", 0, 2],
      ["HTTP_404", 404, 2],
    ])(
      "polls after %s only when recoverable",
      async (code, status, additionalCalls) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const failure = new ApiError(code, "read failed", status);
        const fetchMock =
          consumer === "list"
            ? vi.mocked(fetchMonitorList)
            : vi.mocked(fetchMonitorRecentEvents);
        fetchMock.mockRejectedValue(failure);
        const { client } = renderPage();
        const key =
          consumer === "list"
            ? monitorQueryKeys.list(A, P, { limit: 25, offset: 0 })
            : monitorQueryKeys.recentEvents(A, P);
        await waitFor(() => {
          expect(client.getQueryState(key)?.error).toBe(failure);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        const before = fetchMock.mock.calls.length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(before + additionalCalls);
      },
    );
  },
);

describe("Project overview", () => {
  it("shows the down banner with reason and start time and hides it at zero (AC-01)", async () => {
    const down = item({
      health: "down",
      openIncident: { startedAt: DATA_AS_OF, reason: "http_status" },
    });
    vi.mocked(fetchMonitorList).mockResolvedValue(list([down]));
    const { client } = renderPage();
    const banner = await screen.findByTestId("project-overview-down-banner");
    expect(
      within(banner).getByRole("link", { name: down.name }),
    ).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/${down.id}`,
    );
    expect(within(banner).getByText("http_status")).toBeInTheDocument();
    expect(banner.querySelector("time")).toHaveAttribute(
      "datetime",
      DATA_AS_OF,
    );
    vi.mocked(fetchMonitorList).mockResolvedValue(list([item()]));
    await refreshList(client);
    await waitFor(() => {
      expect(screen.queryByTestId("project-overview-down-banner")).toBeNull();
    });
  });
  it("a down monitor without an open incident shows its health reason and no time", async () => {
    vi.mocked(fetchMonitorList).mockResolvedValue(
      list([item({ health: "down", healthReason: "check_error" })]),
    );
    renderPage();
    const banner = await screen.findByTestId("project-overview-down-banner");
    expect(within(banner).getByText("check_error")).toBeInTheDocument();
    expect(banner.querySelector("time")).toBeNull();
  });
  it("lists every down monitor of a Project at its cap of 20", async () => {
    const monitors = Array.from({ length: MONITOR_LIMIT_PER_PROJECT }, () =>
      item({ health: "down" }),
    );
    vi.mocked(fetchMonitorList).mockResolvedValue(list(monitors));
    renderPage();
    await ready();
    expect(screen.getAllByTestId("project-overview-down-row")).toHaveLength(20);
    expect(MONITOR_LIST_PAGE_SIZE).toBeGreaterThanOrEqual(
      MONITOR_LIMIT_PER_PROJECT,
    );
    expect(fetchMonitorList).toHaveBeenCalledWith(A, P, {
      limit: MONITOR_LIST_PAGE_SIZE,
      offset: 0,
    });
  });
  it("renders the four summary numbers from the server and never zero before data (AC-02)", async () => {
    const pending = Promise.withResolvers<MonitorListResponse>();
    vi.mocked(fetchMonitorList).mockReturnValue(pending.promise);
    renderPage();
    await screen.findByTestId("project-overview-loading");
    expect(screen.queryByTestId("project-overview-total")).toBeNull();
    act(() => {
      pending.resolve(
        list([], {
          summary: { total: 17, up: 9, down: 4, paused: 3, unknown: 1 },
        }),
      );
    });
    await ready();
    expect(screen.queryByText(/AWS/)).toBeNull();
    for (const [key, value] of Object.entries({
      total: 17,
      up: 9,
      down: 4,
      paused: 3,
      unknown: 1,
    }))
      expect(screen.getByTestId(`project-overview-${key}`)).toHaveTextContent(
        String(value),
      );
  });
  it("keeps the last numbers with a stale warning when a refetch fails", async () => {
    const { client } = renderPage();
    await ready();
    vi.mocked(fetchMonitorList).mockRejectedValue(new Error("offline"));
    await refreshList(client);
    expect(
      await screen.findByTestId("project-overview-stale"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-overview-total")).toHaveTextContent("1");
  });
  it("labels the data by dataAsOf and never by a window the response does not carry", async () => {
    renderPage();
    await ready();
    expect(screen.getByTestId("project-overview-as-of")).toHaveAttribute(
      "datetime",
      DATA_AS_OF,
    );
    expect(screen.queryByText(/24.*ชม/)).toBeNull();
  });
  it("lists recent events with time, monitor and result (AC-03)", async () => {
    vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          monitorId: "m1",
          monitorName: "Broken API",
          at: DATA_AS_OF,
          reason: "http_status",
          httpStatus: 503,
        },
        {
          kind: "incident_closed",
          monitorId: "m1",
          monitorName: "Recovered API",
          at: DATA_AS_OF,
          reason: "recovered",
          durationSeconds: 120,
        },
        {
          kind: "ssl_level",
          monitorId: "m2",
          monitorName: "Certificate",
          at: DATA_AS_OF,
          reason: null,
          sslLevel: "expired",
          daysRemaining: -2,
        },
      ],
    });
    renderPage();
    const rows = await screen.findAllByTestId("project-overview-event");
    expect(rows).toHaveLength(3);
    expect(within(must(rows[0])).getByRole("link")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/monitors/m1`,
    );
    expect(must(rows[0]).querySelector("time")).toHaveAttribute(
      "datetime",
      DATA_AS_OF,
    );
    expect(rows[0]).toHaveTextContent("503");
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[2]).toHaveTextContent("2");
  });
  it.each([
    { reason: "recovered", outcome: "recovered" },
    { reason: "paused_by_user", outcome: "paused" },
    { reason: null, outcome: "closed" },
    { reason: "future_closure_reason", outcome: "closed" },
    { reason: "timeout", outcome: "closed" },
  ])(
    "shows the actual closure outcome for $reason (AC-03)",
    async ({ reason, outcome }) => {
      const monitor = item();
      vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({
        events: [
          {
            kind: "incident_closed",
            monitorId: monitor.id,
            monitorName: monitor.name,
            at: DATA_AS_OF,
            reason,
            durationSeconds: 120,
          },
        ],
      });
      renderPage();
      const row = await screen.findByTestId("project-overview-event");
      const result = within(row).getByTestId(
        `project-overview-event-${outcome}`,
      );
      expect(result).toBeVisible();
      if (reason === "recovered" || reason === "paused_by_user")
        expect(result).toHaveTextContent(incidentReasonLabel(reason));
      if (outcome !== "recovered")
        expect(
          within(row).queryByTestId("project-overview-event-recovered"),
        ).toBeNull();
      expect(row).toHaveTextContent(formatDuration(120));
      expect(within(row).getByRole("link")).toHaveAttribute(
        "href",
        `/organizations/${A}/projects/${P}/monitors/${monitor.id}`,
      );
      expect(row.querySelector("time")).toHaveAttribute("datetime", DATA_AS_OF);
      expect(fetchMonitorRecentEvents).toHaveBeenCalledWith(A, P);
    },
  );
  it("shows an in-section empty and error state for events", async () => {
    const { client } = renderPage();
    await screen.findByTestId("project-overview-events-empty");
    vi.mocked(fetchMonitorRecentEvents).mockRejectedValue(new Error("offline"));
    await act(() =>
      client.resetQueries({
        queryKey: monitorQueryKeys.recentEvents(A, P),
      }),
    );
    await screen.findByTestId("project-overview-events-error");
    expect(screen.getByTestId("project-overview-total")).toHaveTextContent("1");
  });
  it("shows member and admin counts with a link to members (AC-05)", async () => {
    renderPage();
    await ready();
    expect(fetchProjectMembers).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("project-overview-member-count"),
    ).toHaveTextContent("3");
    expect(
      screen.getByTestId("project-overview-admin-count"),
    ).toHaveTextContent("1");
    expect(screen.getByTestId("project-overview-members-link")).toHaveAttribute(
      "href",
      `/organizations/${A}/projects/${P}/members`,
    );
  });
  it("shows unknown, not zero, while the Project detail is unavailable", async () => {
    vi.mocked(fetchProjectDetail).mockReturnValue(new Promise(() => {}));
    renderPage();
    await ready();
    expect(
      screen.getByTestId("project-overview-members-unknown"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("project-overview-member-count")).toBeNull();
  });
  it.each(["owner", "viewer"] as const)(
    "shows the first-run empty state with an add link for writers and read-only text for members (AC-06): %s",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      vi.mocked(fetchMonitorList).mockResolvedValue(list([]));
      renderPage();
      await screen.findByTestId("project-overview-empty");
      if (role === "owner")
        expect(screen.getByTestId("project-overview-add")).toHaveAttribute(
          "href",
          `/organizations/${A}/projects/${P}/monitors/new`,
        );
      else expect(screen.queryByTestId("project-overview-add")).toBeNull();
      expect(
        screen.getByTestId("project-overview-members"),
      ).toBeInTheDocument();
    },
  );
  it.each(["list", "events", "project"] as const)(
    "A Project that is gone after the page loaded: %s",
    async (source) => {
      const { client } = renderPage();
      await ready();
      const error = new ApiError("PROJECT_NOT_FOUND", "gone", 404);
      if (source === "list") {
        vi.mocked(fetchMonitorList).mockRejectedValue(error);
        await refreshList(client);
      }
      if (source === "events") {
        vi.mocked(fetchMonitorRecentEvents).mockRejectedValue(error);
        await act(() =>
          client.invalidateQueries({
            queryKey: monitorQueryKeys.recentEvents(A, P),
          }),
        );
      }
      if (source === "project") {
        vi.mocked(fetchProjectDetail).mockRejectedValue(error);
        await act(() =>
          client.invalidateQueries({ queryKey: projectQueryKeys.detail(A, P) }),
        );
      }
      await screen.findByTestId("project-overview-project-gone");
      expect(screen.queryByTestId("project-overview-summary")).toBeNull();
      expect(screen.queryByTestId("project-overview-scope")).toBeNull();
    },
  );
  it.each(["list", "events", "project"] as const)(
    "withdraws all Project data after permission is denied: %s",
    async (source) => {
      const { client } = renderPage();
      await ready();
      const error = new ApiError("PERMISSION_DENIED", "denied", 403);
      if (source === "list") {
        vi.mocked(fetchMonitorList).mockRejectedValue(error);
        await refreshList(client);
      }
      if (source === "events") {
        vi.mocked(fetchMonitorRecentEvents).mockRejectedValue(error);
        await act(() =>
          client.invalidateQueries({
            queryKey: monitorQueryKeys.recentEvents(A, P),
          }),
        );
      }
      if (source === "project") {
        vi.mocked(fetchProjectDetail).mockRejectedValue(error);
        await act(() =>
          client.invalidateQueries({ queryKey: projectQueryKeys.detail(A, P) }),
        );
      }
      await screen.findByTestId("project-overview-denied");
      expect(screen.queryByTestId("project-overview-summary")).toBeNull();
      expect(screen.queryByTestId("project-overview-scope")).toBeNull();
      expect(screen.queryByTestId("project-overview-members")).toBeNull();
    },
  );
  it("A failed Project lookup", async () => {
    vi.mocked(fetchMeContext).mockResolvedValue(context("viewer"));
    vi.mocked(fetchProjectDetail).mockRejectedValue(new Error("offline"));
    renderPage();
    await screen.findByTestId("project-overview-access-error");
    expect(screen.queryByTestId("project-overview-denied")).toBeNull();
  });
  it("a non-member sees no Project name or numbers", async () => {
    vi.mocked(fetchMeContext).mockResolvedValue(context("viewer", []));
    renderPage();
    await screen.findByTestId("project-overview-denied");
    expect(screen.queryByTestId("project-overview-scope")).toBeNull();
    expect(screen.queryByTestId("project-overview-total")).toBeNull();
  });
  it("a bookmark of another Organization the user belongs to reads that Organization, not the active one", async () => {
    renderPage(B);
    await ready();
    expect(fetchMonitorList).toHaveBeenCalledWith(B, P, {
      limit: MONITOR_LIST_PAGE_SIZE,
      offset: 0,
    });
    expect(fetchProjectDetail).toHaveBeenCalledWith(B, P);
  });
  it("a bookmark of an Organization the user is not in sends no request", async () => {
    renderPage("foreign");
    await screen.findByTestId("project-overview-denied");
    expect(fetchMonitorList).not.toHaveBeenCalled();
    expect(fetchMonitorRecentEvents).not.toHaveBeenCalled();
    expect(fetchProjectDetail).not.toHaveBeenCalled();
  });
  it("drops rows and counts on a Project switch and never renders the old Project's late response", async () => {
    const late = Promise.withResolvers<MonitorListResponse>();
    const next = Promise.withResolvers<MonitorListResponse>();
    const { client, router } = renderPage();
    await ready();
    vi.mocked(fetchMonitorList)
      .mockReturnValueOnce(late.promise)
      .mockReturnValue(next.promise);
    void client.invalidateQueries({
      queryKey: monitorQueryKeys.list(A, P, {
        limit: MONITOR_LIST_PAGE_SIZE,
        offset: 0,
      }),
    });
    await waitFor(() => {
      expect(fetchMonitorList).toHaveBeenCalledTimes(2);
    });
    await act(() =>
      router.navigate(`/organizations/${A}/projects/new-project/overview`),
    );
    expect(screen.queryByTestId("project-overview-total")).toBeNull();
    act(() => {
      late.resolve(list([], { summary: { total: 19 } }));
    });
    expect(screen.queryByTestId("project-overview-total")).toBeNull();
    act(() => {
      next.resolve(list([], { summary: { total: 2 } }));
    });
    expect(
      await screen.findByTestId("project-overview-total"),
    ).toHaveTextContent("2");
  });
  it("ignores a late response after an Organization switch", async () => {
    const late = Promise.withResolvers<MonitorListResponse>();
    vi.mocked(fetchMonitorList).mockReturnValue(late.promise);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    vi.mocked(fetchMeContext)
      .mockResolvedValueOnce(context())
      .mockResolvedValue({ ...context(), lastActiveTenantId: B });
    renderPage();
    await waitFor(() => {
      expect(fetchMonitorList).toHaveBeenCalled();
    });
    act(() => {
      screen.getByTestId("switch").click();
    });
    await screen.findByTestId("projects");
    act(() => {
      late.resolve(list([item()]));
    });
    expect(screen.queryByTestId("project-overview-summary")).toBeNull();
  });
});
