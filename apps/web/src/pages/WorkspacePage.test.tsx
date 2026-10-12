import { bindQueryClientIdentity } from "../lib/queryClient";
import type {
  MeContextResponse,
  OrganizationMemberListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MonitorListResponse } from "@nightwatch/api-contract";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../lib/api/members";
import { fetchMeContext, updateActiveOrganization } from "../lib/api/me";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  monitorQueryKeys,
} from "../lib/api/monitors";
import { TenantProvider } from "../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "./OrganizationMembersPage";
import { SslCard } from "./monitors/detail/SslCard";
import { formatDate } from "./monitors/format";
import { WorkspacePage } from "./WorkspacePage";
import type { MonitorRow } from "./workspace/rows";

async function findScope(name: string, role: string) {
  return waitFor(() => {
    const header = screen.getByTestId("page-header");
    expect(within(header).getByTestId("page-scope")).toHaveTextContent(
      new RegExp(`^${name}$`),
    );
    expect(within(header).getByTestId("workspace-identity")).toHaveAttribute(
      "data-member-role",
      role,
    );
    expect(
      within(header).getByTestId("page-scope-tag"),
    ).not.toBeEmptyDOMElement();
    return header;
  });
}

const { projectState, sessionState, signOutMock } = vi.hoisted(() => {
  const projectState: { myRole: "admin" | "member" | null } = {
    myRole: "member",
  };
  const sessionState: {
    data: { user: Record<string, unknown> } | null;
    isPending: boolean;
  } = { data: null, isPending: false };
  return { projectState, sessionState, signOutMock: vi.fn() };
});

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    signOut: signOutMock,
    organization: {},
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../lib/api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});
vi.mock("../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(async (organizationId: string) =>
    (await import("../test/pendingInvitations")).emptyPendingInvitationList(
      organizationId,
    ),
  ),
}));
vi.mock("../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
}));

// The overview shows one Project's monitors: the one the server resolves as last used.
vi.mock("../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectList: () =>
    Promise.resolve({
      projects: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          name: "Payments Platform",
          slug: "payments",
          description: null,
          memberCount: 2,
          myRole: projectState.myRole,
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    }),
  fetchLastProject: () =>
    Promise.resolve({ projectId: "55555555-5555-4555-8555-555555555555" }),
}));
vi.mock("../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
}));

afterEach(() => {
  projectState.myRole = "member";
});

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchMonitorListMock = vi.mocked(fetchMonitorList);
const fetchMonitorRecentEventsMock = vi.mocked(fetchMonitorRecentEvents);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchOrganizationMembersMock = vi.mocked(fetchOrganizationMembers);

const P = "55555555-5555-4555-8555-555555555555";
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const MONITOR_A = "33333333-3333-4333-8333-333333333333";
const MONITOR_B = "44444444-4444-4444-8444-444444444444";
const okUptime = { percent: 99.5, checks: 10, coveragePercent: 100 };

function monitorItem(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    url: `https://${name}.example.com/health`,
    method: "GET",
    intervalSeconds: 300,
    status: "active",
    health: "up",
    healthReason: null,
    lastKnownDown: false,
    consecutiveFailures: 0,
    lastCheckAt: "2026-10-02T05:00:00.000Z",
    openIncident: null,
    lastResponseTimeMs: 120,
    responseP95Ms24h: 120,
    responseSparkline: Array.from({ length: 24 }, (_, hour) => ({
      hourStart: new Date(Date.UTC(2026, 9, 1, 6 + hour)).toISOString(),
      avgMs: null,
    })),
    ssl: {
      level: "ok",
      daysRemaining: 90,
      host: `${name}.example.com`,
      issuer: null,
      notAfter: null,
    },
    uptime: { h24: okUptime, d30: okUptime },
    ...overrides,
  } as MonitorRow;
}

function monitorList(total = 3): MonitorListResponse {
  return {
    summary: { up: 1, down: 1, unknown: 0, paused: 0, total, limit: 20 },
    monitors: [
      monitorItem(MONITOR_A, "api-payments", {
        health: "down",
        consecutiveFailures: 3,
        openIncident: {
          startedAt: "2026-10-02T04:00:00.000Z",
          reason: "dns_not_found",
        },
      }),
      monitorItem(MONITOR_B, "portal", {
        ssl: {
          level: "caution",
          daysRemaining: 12,
          host: "portal.example.com",
          issuer: "Let's Encrypt R11",
          notAfter: "2026-10-14T05:00:00.000Z",
        },
      }),
    ],
    page: { limit: 50, offset: 0, total },
    dataAsOf: "2026-10-02T05:00:00.000Z",
  };
}

function meContext(
  organizations: MeContextResponse["organizations"],
  lastActiveTenantId: string | null = null,
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "ผู้ใช้ทดสอบ",
      email: "user@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId,
  };
}

const ownerOrg = {
  id: ORG_A,
  name: "Org A",
  slug: "org-a",
  role: "owner" as const,
};
const viewerOrg = {
  id: ORG_B,
  name: "Org B",
  slug: "org-b",
  role: "viewer" as const,
};

const staleMemberPage: OrganizationMemberListResponse = {
  organizationId: ORG_A,
  members: [
    {
      id: "member-1",
      userId: "user-1",
      name: "Cached member",
      email: "cached@example.test",
      role: "owner",
    },
  ],
  page: { limit: 50, offset: 0, total: 51 },
  memberLimit: 1000,
};

function renderPage() {
  if (fetchMonitorListMock.getMockImplementation() === undefined) {
    fetchMonitorListMock.mockResolvedValue(monitorList());
  }
  if (fetchMonitorRecentEventsMock.getMockImplementation() === undefined) {
    fetchMonitorRecentEventsMock.mockResolvedValue({ events: [] });
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route
            path="/workspace"
            element={
              <TenantProvider>
                <WorkspacePage />
              </TenantProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDeniedMembershipPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  queryClient.setQueryData(memberListQueryKey(ORG_A, 50, 0), staleMemberPage);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${ORG_A}/members`]}>
        <TenantProvider>
          <Link data-testid="workspace-return" to="/workspace">
            ไปภาพรวม
          </Link>
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </TenantProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("WorkspacePage context states", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    signOutMock.mockReset();
    sessionState.data = null;
    fetchOrganizationMembersMock.mockReset();
  });

  it("shows loading only while the context is actually pending, then renders the organization", async () => {
    // A slow /me response is a pending state that resolves into content, never a permanent spinner.
    const pending = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockImplementation(() => pending.promise);
    renderPage();

    expect(screen.getByTestId("workspace-context-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    pending.resolve(meContext([ownerOrg], ORG_A));

    await findScope("Org A", "owner");
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-context-loading")).toBeNull();
    });
  });

  it("a failed context load offers an explicit retry that recovers", async () => {
    // A /me failure is a retryable error state, not the spinner or the zero-membership screen.
    fetchMeContextMock.mockRejectedValueOnce(
      new ApiError("INTERNAL", "server exploded", 500),
    );
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByTestId("workspace-context-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("page-title")).toHaveRole("heading");
    expect(screen.getByTestId("page-title")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("workspace-context-alert")).toHaveRole("alert");
    expect(screen.getByTestId("workspace-context-alert")).toHaveTextContent(
      "server exploded",
    );
    expect(screen.queryByTestId("workspace-context-loading")).toBeNull();
    expect(screen.queryByTestId("workspace-access-needed")).toBeNull();

    await user.click(screen.getByTestId("workspace-context-retry"));

    await findScope("Org A", "owner");
  });

  it("a successful context with zero memberships shows the access-needed state", async () => {
    // Access-needed is exclusively the successful zero-membership outcome.
    fetchMeContextMock.mockResolvedValue(meContext([]));
    renderPage();

    expect(
      await screen.findByTestId("workspace-access-needed"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-access-needed")).toHaveTextContent(
      "user@example.com",
    );
    expect(screen.getByTestId("page-title")).toHaveRole("heading");
    expect(screen.getByTestId("page-title")).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId("workspace-context-loading")).toBeNull();
    expect(screen.queryByTestId("members-invitation-send")).toBeNull();
  });

  it.each([
    {
      name: "B",
      error: new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      retryContext: meContext([viewerOrg], ORG_B),
      expected: ["Org B", "viewer"] as const,
    },
    {
      name: "downgraded role",
      error: new ApiError("PERMISSION_DENIED", "role downgraded", 403),
      retryContext: meContext([{ ...ownerOrg, role: "viewer" }], ORG_A),
      expected: ["Org A", "viewer"] as const,
    },
    {
      name: "no-access",
      error: new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      retryContext: meContext([]),
      expected: "access-needed",
    },
  ])(
    "withholds the denied organization until retry confirms $name",
    async ({ error, retryContext, expected }) => {
      fetchMeContextMock
        .mockResolvedValueOnce(meContext([ownerOrg], ORG_A))
        .mockRejectedValueOnce(new Error("context unavailable"))
        .mockResolvedValueOnce(retryContext);
      fetchOrganizationMembersMock.mockRejectedValueOnce(error);
      const user = userEvent.setup();
      const queryClient = renderDeniedMembershipPage();

      expect(
        await screen.findByTestId("members-admission-retry"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("page-scope")).toBeNull();
      expect(document.body.textContent).not.toContain("Org A · org-a");
      expect(document.body.textContent).not.toContain("Cached member");
      expect(document.body.innerHTML).not.toContain("cached@example.test");
      expect(screen.queryByTestId("members-total")).toBeNull();
      expect(
        queryClient.getQueryData(["tenant", "members", ORG_A]),
      ).toBeUndefined();
      expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();

      await user.click(screen.getByTestId("workspace-return"));
      expect(
        await screen.findByTestId("workspace-context-error"),
      ).toBeInTheDocument();

      await user.click(screen.getByTestId("workspace-context-retry"));

      if (typeof expected === "string") {
        expect(
          await screen.findByTestId("workspace-access-needed"),
        ).toBeInTheDocument();
      } else {
        await findScope(expected[0], expected[1]);
      }
      expect(screen.queryByTestId("members-invitation-send")).toBeNull();
      expect(screen.queryByTestId("workspace-context-error")).toBeNull();
      expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();
    },
  );
});

describe("WorkspacePage organization views", () => {
  afterEach(() => {
    projectState.myRole = "member";
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    signOutMock.mockReset();
    sessionState.data = null;
  });

  it("an owner sees overview without the removed invitation form", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    await findScope("Org A", "owner");
    expect(screen.queryByTestId("members-invitation-send")).toBeNull();
    expect(screen.queryByTestId("members-invitation-email")).toBeNull();
  });
});

describe("WorkspacePage overview content", () => {
  afterEach(() => {
    projectState.myRole = "member";
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    sessionState.data = null;
  });

  it("shows identity, freshness, stats and the problem monitors", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const issues = await screen.findByTestId("workspace-issues");
    await findScope(ownerOrg.name, ownerOrg.role);
    expect(screen.getByTestId("workspace-identity")).toHaveAttribute(
      "data-organization-id",
      ownerOrg.id,
    );
    expect(screen.getByTestId("workspace-slug")).toHaveTextContent(/^org-a$/);
    expect(screen.getByTestId("page-title")).toHaveRole("heading");
    expect(screen.getByTestId("page-title")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("workspace-fresh")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("workspace-as-of")).toHaveAttribute(
      "datetime",
      "2026-10-02T05:00:00.000Z",
    );
    const stats = screen.getByTestId("workspace-stats");
    expect(stats).toHaveRole("region");
    expect(stats).toHaveAccessibleName();
    for (const [kind, value] of [
      ["up", 1],
      ["down", 1],
      ["ssl", 1],
      ["paused", 0],
    ] as const) {
      const tile = within(stats).getByTestId(`workspace-stat-${kind}`);
      expect(tile).toHaveAttribute(
        "href",
        `/organizations/${ORG_A}/projects/${P}/monitors`,
      );
      expect(
        within(tile)
          .getByTestId("workspace-stat-value")
          .textContent.match(/\d+/g),
      ).toEqual([String(value), "3"]);
    }
    expect(within(issues).getAllByTestId(/^monitor-list-row-/)).toHaveLength(2);
    for (const monitor of monitorList().monitors) {
      const row = within(issues).getByTestId(`monitor-list-row-${monitor.id}`);
      expect(within(row).getByTestId("monitor-list-name").textContent).toBe(
        monitor.name,
      );
      expect(within(row).getByTestId("monitor-list-cell-url").textContent).toBe(
        monitor.url,
      );
      expect(row).toHaveAttribute(
        "href",
        `/organizations/${ORG_A}/projects/${P}/monitors/${monitor.id}`,
      );
      expect(row).toHaveAttribute("data-health", monitor.health);
    }
    expect(screen.getByTestId("workspace-add")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/projects/${P}/monitors/new`,
    );
  });

  it("marks every remaining sample region as an example with its issue link", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    await screen.findByTestId("workspace-issues");
    for (const [hook, issue] of [
      ["workspace-uptime-example", 56],
      ["workspace-events-example", 63],
    ] as const) {
      const sample = screen.getByTestId(hook);
      expect(sample).toHaveRole("group");
      expect(sample).toHaveAccessibleName();
      expect(
        within(sample).getByTestId("mockup-notice"),
      ).not.toBeEmptyDOMElement();
      const link = within(sample).getByTestId("mockup-issue");
      expect(link).toHaveAttribute(
        "href",
        `https://github.com/nixbpe/new-nightwatch/issues/${String(issue)}`,
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(sample.getElementsByTagName("time")).toHaveLength(0);
    }
    expect(screen.getByTestId("workspace-ssl-expiry")).toHaveAttribute(
      "datetime",
      "2026-10-14T05:00:00.000Z",
    );
  });

  it("a viewer sees no add button", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([viewerOrg], ORG_B));
    renderPage();

    await screen.findByTestId("workspace-issues");
    expect(screen.queryByTestId("workspace-add")).toBeNull();
    expect(screen.getByTestId("workspace-monitors")).toHaveAttribute(
      "href",
      `/organizations/${ORG_B}/projects/${P}/monitors`,
    );
  });

  it("gives a Project admin who is only an Organization viewer the add button, and names the Project", async () => {
    projectState.myRole = "admin";
    fetchMeContextMock.mockResolvedValue(meContext([viewerOrg], ORG_B));
    renderPage();

    await screen.findByTestId("workspace-issues");
    expect(screen.getByTestId("workspace-add")).toHaveAttribute(
      "href",
      `/organizations/${ORG_B}/projects/${P}/monitors/new`,
    );
    expect(screen.getByTestId("workspace-project")).toHaveTextContent(
      "Payments Platform",
    );
  });

  it("measures the outage against the server's dataAsOf, not the client clock", async () => {
    // Incident starts 04:00Z and dataAsOf is 05:00Z; a client clock a day ahead must not show "1 วัน".
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-03T05:00:00Z"),
    });
    try {
      fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
      renderPage();
      const issues = await screen.findByTestId("workspace-issues");
      const row = within(issues).getByTestId(`monitor-list-row-${MONITOR_A}`);
      const duration = within(row).getByTestId("workspace-issue-duration");
      expect(duration).toHaveAttribute("data-duration-seconds", "3600");
      expect(duration).toHaveTextContent(/^1 ชั่วโมง$/);
      expect(duration.textContent.match(/\d+/g)).toEqual(["1"]);
      expect(
        within(row).getByTestId("monitor-list-incident-time"),
      ).toHaveAttribute("datetime", "2026-10-02T04:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an organization without monitors shows the first-run state", async () => {
    fetchMonitorListMock.mockResolvedValue({
      ...monitorList(0),
      summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
      monitors: [],
    });
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();

    expect(await screen.findByTestId("workspace-empty")).toBeInTheDocument();
  });

  it("a failed list offers a retry", async () => {
    fetchMonitorListMock.mockRejectedValueOnce(new Error("boom"));
    fetchMonitorListMock.mockResolvedValue(monitorList());
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByTestId("workspace-list-error"),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("workspace-list-retry"));
    expect(await screen.findByTestId("workspace-issues")).toBeInTheDocument();
  });
});

describe("WorkspacePage denied list", () => {
  afterEach(() => {
    projectState.myRole = "member";
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    sessionState.data = null;
  });

  it("a denied first load refreshes the membership context and shows no organization data", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchMonitorListMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "revoked", 403),
    );
    renderPage();

    expect(await screen.findByTestId("workspace-denied")).toBeInTheDocument();
    expect(fetchMeContextMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("page-scope")).toBeNull();
    expect(document.body.textContent).not.toContain("Org A");
    expect(
      screen.queryAllByTestId(`monitor-list-row-${MONITOR_A}`),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain("api-payments");
  });

  it("a denied refetch after a successful load drops the cached monitors", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchMonitorListMock.mockResolvedValueOnce(monitorList());
    fetchMonitorListMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "revoked", 403),
    );
    fetchMonitorRecentEventsMock.mockResolvedValue({ events: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    bindQueryClientIdentity(queryClient, "user-1");
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <TenantProvider>
            <WorkspacePage />
          </TenantProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await within(
        await screen.findByTestId("workspace-issues"),
      ).findAllByTestId(`monitor-list-row-${MONITOR_A}`),
    ).not.toHaveLength(0);
    const callsBefore = fetchMeContextMock.mock.calls.length;

    await queryClient.refetchQueries({ queryKey: monitorQueryKeys.all(ORG_A) });

    expect(await screen.findByTestId("workspace-denied")).toBeInTheDocument();
    expect(
      screen.queryAllByTestId(`monitor-list-row-${MONITOR_A}`),
    ).toHaveLength(0);
    expect(
      screen.queryAllByTestId(`monitor-list-row-${MONITOR_B}`),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain("api-payments");
    expect(document.body.textContent).not.toContain("portal");
    expect(document.body.innerHTML).not.toContain(
      "https://api-payments.example.com/health",
    );
    await waitFor(() => {
      expect(fetchMeContextMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe("WorkspacePage overview details", () => {
  afterEach(() => {
    projectState.myRole = "member";
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    sessionState.data = null;
  });

  it("shows issuer and expiry on SSL warning rows only when present, never on a down row", async () => {
    const notAfter = "2026-10-14T05:00:00.000Z";
    const ssl = (level: "caution" | "danger" | "expired", extra = {}) => ({
      level,
      daysRemaining: 12,
      host: "h.example.com",
      issuer: null,
      notAfter: null,
      ...extra,
    });
    const list = monitorList(5);
    list.monitors = [
      monitorItem(MONITOR_A, "api-payments", {
        health: "down",
        openIncident: {
          startedAt: "2026-10-02T04:00:00.000Z",
          reason: "dns_not_found",
        },
        ssl: ssl("danger", { issuer: "Down CA", notAfter }),
      }),
      monitorItem(MONITOR_B, "portal", {
        ssl: ssl("caution", { issuer: "Let's Encrypt R11", notAfter }),
      }),
      monitorItem("55555555-5555-4555-8555-555555555555", "bare", {
        ssl: ssl("expired"),
      }),
      monitorItem("66666666-6666-4666-8666-666666666666", "issuer-only", {
        ssl: ssl("danger", { issuer: "Only CA" }),
      }),
      monitorItem("77777777-7777-4777-8777-777777777777", "date-only", {
        ssl: ssl("caution", { notAfter }),
      }),
    ];
    fetchMonitorListMock.mockResolvedValue(list);
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const issues = await screen.findByTestId("workspace-issues");
    const row = (monitor: MonitorRow) =>
      within(within(issues).getByTestId(`monitor-list-row-${monitor.id}`));
    for (const monitor of list.monitors) {
      const scope = row(monitor);
      const issuer = scope.queryByTestId("workspace-ssl-issuer"),
        expiry = scope.queryByTestId("workspace-ssl-expiry");
      expect(scope.getByTestId("monitor-list-name").textContent).toBe(
        monitor.name,
      );
      if (monitor.health === "down" || monitor.ssl.issuer === null)
        expect(issuer).toBeNull();
      else expect(issuer).toHaveTextContent(monitor.ssl.issuer);
      if (monitor.health === "down" || monitor.ssl.notAfter === null)
        expect(expiry).toBeNull();
      else {
        expect(expiry).toHaveAttribute("datetime", notAfter);
        expect(expiry).toHaveTextContent(formatDate(notAfter));
      }
    }
    const down = within(
      within(issues).getByTestId(`monitor-list-row-${MONITOR_A}`),
    );
    expect(down.getByTestId("monitor-list-ssl")).toHaveAttribute(
      "data-days-remaining",
      "12",
    );
    expect(
      down.getByTestId("monitor-list-ssl").textContent.match(/\d+/g),
    ).toEqual(["12"]);
    expect(down.queryByTestId("workspace-ssl-issuer")).toBeNull();
    expect(
      within(issues).getByTestId(`monitor-list-row-${MONITOR_A}`).textContent,
    ).not.toContain("Down CA");
  });

  it("writes the expiry date exactly as the monitor detail SSL card does", async () => {
    fetchMonitorListMock.mockResolvedValue(monitorList());
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const issues = await screen.findByTestId("workspace-issues");
    const workspaceTime = within(issues).getByTestId("workspace-ssl-expiry");
    const workspaceDate = workspaceTime.textContent;
    expect(workspaceTime).toHaveAttribute(
      "datetime",
      "2026-10-14T05:00:00.000Z",
    );
    expect(workspaceDate).toBe(formatDate("2026-10-14T05:00:00.000Z"));
    const card = render(
      <SslCard
        ssl={{
          state: "caution",
          daysRemaining: 12,
          host: "portal.example.com",
          issuer: "Let's Encrypt R11",
          notAfter: "2026-10-14T05:00:00.000Z",
          reason: null,
        }}
      />,
    );
    expect(workspaceDate).toBeTruthy();
    expect(
      within(card.container).getByTestId("monitor-detail-ssl-expiry")
        .textContent,
    ).toBe(workspaceDate);
  });

  it("limit reached disables add with its reason", async () => {
    fetchMonitorListMock.mockResolvedValue(monitorList(50));
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const add = await screen.findByTestId("workspace-add-disabled");
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("aria-describedby", "monitor-limit-reason");
    expect(screen.getByTestId("workspace-limit-reason")).toBeInTheDocument();
  });

  it("shows tile values, expired note and orders down before SSL rows", async () => {
    const list = monitorList(3);
    list.monitors.push(
      monitorItem("55555555-5555-4555-8555-555555555555", "legacy", {
        ssl: {
          level: "expired",
          daysRemaining: -2,
          host: "legacy.example.com",
          issuer: null,
          notAfter: null,
        },
      }),
    );
    list.monitors.reverse();
    fetchMonitorListMock.mockResolvedValue(list);
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const stats = await screen.findByTestId("workspace-stats");
    const downTile = within(stats).getByTestId("workspace-stat-down");
    const sslTile = within(stats).getByTestId("workspace-stat-ssl");
    expect(downTile).toHaveTextContent("api-payments");
    expect(
      within(sslTile)
        .getByTestId("workspace-stat-value")
        .textContent.match(/\d+/g),
    ).toEqual(["2", "3"]);
    expect(sslTile).toHaveAttribute("data-expired-count", "1");
    expect(sslTile.textContent.match(/\d+/g)).toEqual([
      "2",
      "3",
      "1",
      "30",
      "7",
    ]);
    const issues = screen.getByTestId("workspace-issues");
    const names = within(issues)
      .getAllByTestId("monitor-list-name")
      .map((node) => node.textContent);
    expect(names).toEqual(["api-payments", "legacy", "portal"]);
  });

  it("renders no-data uptime, populated events and the stale warning", async () => {
    const list = monitorList();
    list.monitors[1] = monitorItem(MONITOR_B, "portal", {
      uptime: {
        h24: okUptime,
        d30: { percent: null, checks: 0, coveragePercent: 0 },
      },
    });
    fetchMonitorListMock.mockResolvedValueOnce(list);
    fetchMonitorListMock.mockRejectedValue(new Error("boom"));
    fetchMonitorRecentEventsMock.mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          at: "2026-10-02T04:00:00.000Z",
          monitorId: MONITOR_A,
          monitorName: "api-payments",
          reason: "dns_not_found",
          httpStatus: 503,
        },
      ],
    });
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    bindQueryClientIdentity(queryClient, "user-1");
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <TenantProvider>
            <WorkspacePage />
          </TenantProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const events = await screen.findByTestId("workspace-events");
    const link = await within(events).findByTestId("workspace-event-monitor");
    expect(link).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/projects/${P}/monitors/${MONITOR_A}`,
    );
    expect(link.textContent).toBe("api-payments");
    const event = within(events).getByTestId("workspace-event");
    expect(event).toHaveAttribute("data-event-kind", "incident_opened");
    expect(event).toHaveAttribute("data-reason", "dns_not_found");
    expect(
      within(event).getByTestId("monitor-event-http-status"),
    ).toHaveTextContent(/^HTTP 503$/);
    expect(within(event).getByTestId("workspace-event-time")).toHaveAttribute(
      "datetime",
      "2026-10-02T04:00:00.000Z",
    );
    const uptime = within(screen.getByTestId("workspace-uptime"));
    const portal = within(uptime.getByTestId(`monitor-list-row-${MONITOR_B}`));
    expect(
      portal.getByTestId("monitor-list-cell-d30"),
    ).not.toBeEmptyDOMElement();
    expect(portal.getByTestId("monitor-list-cell-d30")).not.toHaveTextContent(
      /\d/,
    );
    expect(
      portal.getByTestId("monitor-list-cell-responseTime"),
    ).toHaveTextContent(/^120 ms$/);
    await queryClient.refetchQueries({ queryKey: monitorQueryKeys.all(ORG_A) });
    expect(
      await screen.findByTestId("workspace-refetch-error"),
    ).toBeInTheDocument();
    expect(
      portal.getByTestId(`monitor-list-name-${MONITOR_B}`).textContent,
    ).toBe("portal");
    expect(screen.queryByTestId("workspace-fresh")).toBeNull();
  });
});
