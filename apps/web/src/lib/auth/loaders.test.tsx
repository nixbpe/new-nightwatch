import type {
  InvitationResponse,
  MeContextResponse,
  MonitorListResponse,
  OrganizationMemberListResponse,
} from "@nightwatch/api-contract";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useSearchParams,
  type RouteObject,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditLogQueryKeys,
  fetchAuditActors,
  fetchAuditEvent,
  fetchAuditEvents,
} from "../api/audit-log";
import { fetchInvitation, invitationQueryKey } from "../api/invitations";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import { fetchOrganizationMembers, memberListQueryKey } from "../api/members";
import {
  fetchMonitorDetail,
  fetchMonitorList,
  monitorQueryKeys,
  OVERVIEW_LIST_PARAMS,
} from "../api/monitors";
import {
  fetchNotifications,
  fetchOrganizationNotificationSettings,
  notificationQueryKey,
  organizationNotificationSettingsQueryKey,
} from "../api/notifications";
import {
  peekStagedQueryClient,
  publishTenantScope,
  resetQueryClientRegistry,
  resolveQueryClientForIdentity,
} from "../queryClient";
import { AuditLogPage } from "../../pages/audit-log/AuditLogPage";
import { detail } from "../../pages/monitors/detail-test-support";
import { TenantProvider } from "../tenant/TenantProvider";
import { rememberInvitation, rememberReturnTo } from "./continuation";
import {
  auditLogEventLoader,
  auditLogLoader,
  monitorCreateLoader,
  monitorDetailLoader,
  monitorEditLoader,
  monitorsOverviewLoader,
  notificationSettingsLoader,
  notificationsLoader,
  organizationMembersLoader,
  requireAnonLoader,
  rootLoader,
  settingsLoader,
  verifyEmailLoader,
  workspaceLoader,
} from "./loaders";
type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

const { sessionState, getSessionMock } = vi.hoisted(() => {
  const sessionState = {
    data: null as { user: SessionUser } | null,
  };
  return {
    sessionState,
    getSessionMock: vi.fn(() =>
      Promise.resolve({ data: sessionState.data, error: null }),
    ),
  };
});

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: sessionState.data, isPending: false }),
    getSession: getSessionMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchMeContext: vi.fn() };
});

vi.mock("../api/invitations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchInvitation: vi.fn() };
});

vi.mock("../api/notifications", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchNotifications: vi.fn(),
    fetchOrganizationNotificationSettings: vi.fn(),
  };
});
vi.mock("../api/monitors", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMonitorList: vi.fn(),
    fetchMonitorDetail: vi.fn(),
  };
});
vi.mock("../api/audit-log", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchAuditEvents: vi.fn(),
    fetchAuditEvent: vi.fn(),
    fetchAuditActors: vi.fn(),
  };
});
vi.mock("../api/members", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchOrganizationMembers: vi.fn() };
});

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchInvitationMock = vi.mocked(fetchInvitation);
const fetchNotificationsMock = vi.mocked(fetchNotifications);
const fetchOrganizationNotificationSettingsMock = vi.mocked(
  fetchOrganizationNotificationSettings,
);
const fetchOrganizationMembersMock = vi.mocked(fetchOrganizationMembers);
const fetchMonitorListMock = vi.mocked(fetchMonitorList);
const fetchMonitorDetailMock = vi.mocked(fetchMonitorDetail);

const VERIFIED: SessionUser = {
  id: "user-1",
  email: "member@example.com",
  emailVerified: true,
};

const UNVERIFIED: SessionUser = {
  id: "user-2",
  email: "new@example.com",
  emailVerified: false,
};

const meContext: MeContextResponse = {
  user: {
    id: "user-1",
    name: "สมาชิกทดสอบ",
    email: "member@example.com",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [],
  lastActiveTenantId: null,
};

const invitation: InvitationResponse = {
  invitation: {
    id: "inv-5",
    email: "new@example.com",
    organizationName: "Acme Corp",
    role: "viewer",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

function LocationProbe() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  return (
    <div>
      <div data-testid="location">
        {location.pathname + location.search + location.hash}
      </div>
      <div data-testid="from">{searchParams.get("from") ?? "none"}</div>
    </div>
  );
}

function renderAt(routes: RouteObject[], entry: string) {
  const router = createMemoryRouter(
    [...routes, { path: "*", element: <LocationProbe /> }],
    { initialEntries: [entry] },
  );
  return render(<RouterProvider router={router} />);
}

const anonOnly: RouteObject = {
  path: "/anon-only",
  loader: requireAnonLoader,
  element: <div>anon-area</div>,
};

const protectedWorkspace: RouteObject = {
  path: "/workspace",
  loader: workspaceLoader,
  element: <div>protected-area</div>,
};

const protectedNotifications: RouteObject = {
  path: "/notifications",
  loader: notificationsLoader,
  element: <div>notifications-area</div>,
};

describe("requireAnonLoader (anonymous-only gate)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
  });

  it("renders anonymous content for visitors without a session", async () => {
    renderAt([anonOnly], "/anon-only");

    expect(await screen.findByText("anon-area")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("keeps signed-in users out of anonymous-only pages", async () => {
    sessionState.data = { user: VERIFIED };
    renderAt([anonOnly], "/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    expect(screen.queryByText("anon-area")).toBeNull();
  });

  it("resumes the remembered return — query and hash included — and consumes it exactly once", async () => {
    sessionState.data = { user: VERIFIED };
    rememberReturnTo("/settings/security?tab=sessions#current");
    const first = renderAt([anonOnly], "/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );

    // Consumed: a later arrival falls back to the workspace instead of replaying the stale return.
    first.unmount();
    renderAt([anonOnly], "/anon-only");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
  });

  it("prefers a remembered pending invitation over the return path", async () => {
    sessionState.data = { user: VERIFIED };
    rememberReturnTo("/settings/security");
    rememberInvitation("inv-9");
    renderAt([anonOnly], "/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/onboarding",
    );
  });
});

describe("protected-route gates (workspaceLoader / settingsLoader)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchNotificationsMock.mockReset();
    fetchOrganizationNotificationSettingsMock.mockReset();
  });

  it("bounces anonymous visitors to login remembering the deep link", async () => {
    renderAt([protectedWorkspace], "/workspace?tab=security");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent(
      "/workspace?tab=security",
    );
    expect(screen.queryByText("protected-area")).toBeNull();
  });

  it("redirects / to /workspace and remembers /workspace as the bounce origin", async () => {
    // Remembering "/" would loop the login continuation back onto the redirect.
    renderAt([{ path: "/", loader: rootLoader }, protectedWorkspace], "/");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent("/workspace");
  });

  it("bounces an authenticated but unverified session to the resend hub", async () => {
    sessionState.data = { user: UNVERIFIED };
    renderAt([protectedWorkspace], "/workspace");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
    expect(screen.queryByText("protected-area")).toBeNull();
    expect(fetchMeContextMock).not.toHaveBeenCalled();
  });

  it("bounces security settings the same way", async () => {
    renderAt(
      [
        {
          path: "/settings/security",
          loader: settingsLoader,
          element: <div>security-area</div>,
        },
      ],
      "/settings/security",
    );

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent("/settings/security");
    expect(screen.queryByText("security-area")).toBeNull();
  });

  it("admits a verified session and stages the prefetched me/context for its identity", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([protectedWorkspace], "/workspace");

    expect(await screen.findByText("protected-area")).toBeInTheDocument();
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    // The prefetch landed in a client staged for THIS identity, never a shared singleton.
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBe("user-1");
    expect(staged?.client.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      meContext,
    );
  });

  it("stages the notification Center's primary inbox in the verified identity client", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    fetchNotificationsMock.mockResolvedValue({
      organizationId: null,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    renderAt([protectedNotifications], "/notifications");

    expect(await screen.findByText("notifications-area")).toBeInTheDocument();
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBe(VERIFIED.id);
    expect(staged?.client.getQueryData(notificationQueryKey(null))).toEqual({
      organizationId: null,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
  });

  it("stages organization notification settings before its protected route commits", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Acme",
          slug: "acme",
          role: "admin",
        },
      ],
      lastActiveTenantId: "11111111-1111-4111-8111-111111111111",
    });
    fetchOrganizationNotificationSettingsMock.mockResolvedValue({
      organizationId: "11111111-1111-4111-8111-111111111111",
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 2,
    });
    renderAt(
      [
        {
          path: "/organizations/:organizationId/notification-settings",
          loader: notificationSettingsLoader,
          element: <div>notification-settings-area</div>,
        },
      ],
      "/organizations/11111111-1111-4111-8111-111111111111/notification-settings",
    );

    expect(
      await screen.findByText("notification-settings-area"),
    ).toBeInTheDocument();
    expect(
      peekStagedQueryClient()?.client.getQueryData(
        organizationNotificationSettingsQueryKey(
          "11111111-1111-4111-8111-111111111111",
        ),
      ),
    ).toEqual({
      organizationId: "11111111-1111-4111-8111-111111111111",
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
      version: 2,
    });
  });

  it("a failed prefetch does not become a router-level error", async () => {
    // The in-tree query surfaces the error with its retry UI instead.
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockRejectedValue(new Error("api down"));
    renderAt([protectedWorkspace], "/workspace");

    // The session client retries once, so the loader waits out a backoff.
    expect(
      await screen.findByText("protected-area", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe("workspaceLoader overview prefetch", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";
  const overviewList: MonitorListResponse = {
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 50, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  };
  const orgs = [
    { id: otherId, name: "Other", slug: "other", role: "viewer" as const },
    { id: organizationId, name: "Acme", slug: "acme", role: "owner" as const },
  ];

  afterEach(() => {
    sessionState.data = null;
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
  });

  it("stages the active organization's overview list under the page's own key", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: orgs,
      lastActiveTenantId: organizationId,
    });
    fetchMonitorListMock.mockResolvedValue(overviewList);
    renderAt([protectedWorkspace], "/workspace");

    expect(await screen.findByText("protected-area")).toBeInTheDocument();
    expect(fetchMonitorListMock).toHaveBeenCalledWith(
      organizationId,
      OVERVIEW_LIST_PARAMS,
    );
    expect(
      peekStagedQueryClient()?.client.getQueryData(
        monitorQueryKeys.list(organizationId, OVERVIEW_LIST_PARAMS),
      ),
    ).toEqual(overviewList);
  });

  it("does not prefetch a tenant without server-confirmed selection", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: orgs,
      lastActiveTenantId: null,
    });
    fetchMonitorListMock.mockRejectedValue(new Error("boom"));
    renderAt([protectedWorkspace], "/workspace");

    // The identity client retries a failed query once (1 s) before the loader settles.
    expect(
      await screen.findByText("protected-area", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(fetchMonitorListMock).not.toHaveBeenCalled();
  });

  it("requests no list without a membership", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([protectedWorkspace], "/workspace");

    expect(await screen.findByText("protected-area")).toBeInTheDocument();
    expect(fetchMonitorListMock).not.toHaveBeenCalled();
  });
});

describe("audit log loaders", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const listRoute: RouteObject = {
    path: "/organizations/:organizationId/audit-log",
    loader: auditLogLoader,
    element: <div>audit-area</div>,
  };
  const eventRoute: RouteObject = {
    path: "/organizations/:organizationId/audit-log/:eventId",
    loader: auditLogEventLoader,
    element: <div>audit-event-area</div>,
  };
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
    vi.mocked(fetchAuditEvents).mockReset();
    vi.mocked(fetchAuditEvent).mockReset();
    vi.mocked(fetchAuditActors).mockReset();
    fetchMeContextMock.mockReset();
  });
  const as = (role: "owner" | "admin" | "auditor" | "viewer") =>
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: [{ id: organizationId, name: "Acme", slug: "acme", role }],
      lastActiveTenantId: organizationId,
    });

  it.each(["owner", "admin", "auditor"] as const)(
    "prefetches the list and the actors once for a %s",
    async (role) => {
      sessionState.data = { user: VERIFIED };
      as(role);
      vi.mocked(fetchAuditEvents).mockResolvedValue({
        organizationId,
        asOf: "2026-10-03T07:02:11.000Z",
        retainedFrom: "2025-10-03T07:02:11.000Z",
        recordingStartedAt: "2025-06-01T00:00:00.000Z",
        events: [],
        page: { limit: 50, offset: 0, total: 0 },
      });
      vi.mocked(fetchAuditActors).mockResolvedValue({ actors: [] });
      renderAt([listRoute], `/organizations/${organizationId}/audit-log`);

      expect(await screen.findByText("audit-area")).toBeInTheDocument();
      expect(fetchAuditEvents).toHaveBeenCalledTimes(1);
      expect(fetchAuditActors).toHaveBeenCalledTimes(1);
      const [, params] = vi.mocked(fetchAuditEvents).mock.calls[0] ?? [];
      expect(
        peekStagedQueryClient()?.client.getQueryData(
          auditLogQueryKeys.events(organizationId, params ?? { offset: 0 }),
        ),
      ).toBeDefined();
      // The 7-day default is cut to the minute so the page asks for the same key.
      expect(new Date(params?.from ?? "").getUTCSeconds()).toBe(0);
    },
  );

  it.each([
    ["a reversed", "?range=custom&from=2026-10-02&to=2026-10-01", false],
    ["a valid", "?range=custom&from=2026-10-01&to=2026-10-02", true],
  ])(
    "%s custom range: list prefetch sent is %s (AC-11)",
    async (_name, search, sent) => {
      sessionState.data = { user: VERIFIED };
      as("owner");
      vi.mocked(fetchAuditEvents).mockResolvedValue({
        organizationId,
        asOf: "2026-10-03T07:02:11.000Z",
        retainedFrom: "2025-10-03T07:02:11.000Z",
        recordingStartedAt: "2025-06-01T00:00:00.000Z",
        events: [],
        page: { limit: 50, offset: 0, total: 0 },
      });
      vi.mocked(fetchAuditActors).mockResolvedValue({ actors: [] });
      renderAt(
        [listRoute],
        `/organizations/${organizationId}/audit-log${search}`,
      );
      expect(await screen.findByText("audit-area")).toBeInTheDocument();
      expect(vi.mocked(fetchAuditEvents).mock.calls.length).toBe(sent ? 1 : 0);
    },
  );

  it("asks for the list once when the loader and the page open the same link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T07:02:11.500Z"));
    try {
      sessionState.data = { user: VERIFIED };
      as("owner");
      vi.mocked(fetchAuditEvents).mockResolvedValue({
        organizationId,
        asOf: "2026-10-03T07:02:11.000Z",
        retainedFrom: "2025-10-03T07:02:11.000Z",
        recordingStartedAt: "2025-06-01T00:00:00.000Z",
        events: [],
        page: { limit: 50, offset: 0, total: 0 },
      });
      vi.mocked(fetchAuditActors).mockResolvedValue({ actors: [] });
      renderAt(
        [
          {
            ...listRoute,
            element: (
              <QueryClientProvider
                client={resolveQueryClientForIdentity(VERIFIED.id)}
              >
                <TenantProvider>
                  <AuditLogPage />
                </TenantProvider>
              </QueryClientProvider>
            ),
          },
        ],
        `/organizations/${organizationId}/audit-log`,
      );

      expect(
        await screen.findByText(/ยังไม่มีบันทึกกิจกรรมในช่วงที่เก็บไว้/),
      ).toBeInTheDocument();
      expect(fetchAuditEvents).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["viewer"] as const)("requests nothing for a %s", async (role) => {
    sessionState.data = { user: VERIFIED };
    as(role);
    renderAt(
      [listRoute, eventRoute],
      `/organizations/${organizationId}/audit-log`,
    );
    expect(await screen.findByText("audit-area")).toBeInTheDocument();
    expect(fetchAuditEvents).not.toHaveBeenCalled();
    expect(fetchAuditActors).not.toHaveBeenCalled();
  });

  it("requests nothing for an Organization the user does not belong to", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([eventRoute], `/organizations/${organizationId}/audit-log/evt-1`);
    expect(await screen.findByText("audit-event-area")).toBeInTheDocument();
    expect(fetchAuditEvent).not.toHaveBeenCalled();
  });

  it("prefetches the event for an auditor", async () => {
    sessionState.data = { user: VERIFIED };
    as("auditor");
    vi.mocked(fetchAuditEvent).mockRejectedValue(new Error("not prefetched"));
    renderAt([eventRoute], `/organizations/${organizationId}/audit-log/evt-1`);
    expect(await screen.findByText("audit-event-area")).toBeInTheDocument();
    expect(fetchAuditEvent).toHaveBeenCalledWith(organizationId, "evt-1");
  });
});

describe("monitorsOverviewLoader", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const route: RouteObject = {
    path: "/organizations/:organizationId/monitors",
    loader: monitorsOverviewLoader,
    element: <div>monitors-area</div>,
  };
  const emptyList: MonitorListResponse = {
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  };

  it("stages the first list page in the identity client for a member", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
      lastActiveTenantId: organizationId,
    });
    fetchMonitorListMock.mockResolvedValue(emptyList);
    renderAt([route], `/organizations/${organizationId}/monitors`);

    expect(await screen.findByText("monitors-area")).toBeInTheDocument();
    expect(
      peekStagedQueryClient()?.client.getQueryData(
        monitorQueryKeys.list(organizationId, { limit: 25, offset: 0 }),
      ),
    ).toEqual(emptyList);
  });

  it("requests nothing for an Organization the user does not belong to", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([route], `/organizations/${organizationId}/monitors`);

    expect(await screen.findByText("monitors-area")).toBeInTheDocument();
    expect(fetchMonitorListMock).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to sign in with a return path", async () => {
    sessionState.data = null;
    renderAt([route], `/organizations/${organizationId}/monitors`);

    expect(await screen.findByTestId("from")).toHaveTextContent(
      `/organizations/${organizationId}/monitors`,
    );
    expect(fetchMonitorListMock).not.toHaveBeenCalled();
  });
});

describe("monitorDetailLoader", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const monitorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const route: RouteObject = {
    path: "/organizations/:organizationId/monitors/:monitorId",
    loader: monitorDetailLoader,
    element: <div>detail-area</div>,
  };
  const path = `/organizations/${organizationId}/monitors/${monitorId}`;

  it("stages the monitor in the identity client for a member", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
      lastActiveTenantId: organizationId,
    });
    const response = { monitor: detail() };
    fetchMonitorDetailMock.mockResolvedValue(response);
    renderAt([route], path);

    expect(await screen.findByText("detail-area")).toBeInTheDocument();
    expect(fetchMonitorDetailMock).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      monitorId,
    );
    expect(
      peekStagedQueryClient()?.client.getQueryData(
        monitorQueryKeys.detail(organizationId, monitorId),
      ),
    ).toEqual(response);
  });

  it("requests nothing for an Organization the user does not belong to", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([route], path);

    expect(await screen.findByText("detail-area")).toBeInTheDocument();
    expect(fetchMonitorDetailMock).not.toHaveBeenCalled();
  });

  it("still renders the page when the prefetch fails, so the page shows its own state", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue({
      ...meContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
      lastActiveTenantId: organizationId,
    });
    fetchMonitorDetailMock.mockRejectedValue(new Error("404"));
    renderAt([route], path);

    expect(
      await screen.findByText("detail-area", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it("sends an anonymous visitor to sign in with a return path", async () => {
    sessionState.data = null;
    renderAt([route], path);

    expect(await screen.findByTestId("from")).toHaveTextContent(path);
    expect(fetchMonitorDetailMock).not.toHaveBeenCalled();
  });
});

describe("monitorEditLoader and monitorCreateLoader", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const monitorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const editRoute: RouteObject = {
    path: "/organizations/:organizationId/monitors/:monitorId/edit",
    loader: monitorEditLoader,
    element: <div>edit-area</div>,
  };
  const createRoute: RouteObject = {
    path: "/organizations/:organizationId/monitors/new",
    loader: monitorCreateLoader,
    element: <div>create-area</div>,
  };
  const member = {
    ...meContext,
    organizations: [
      {
        id: organizationId,
        name: "Acme",
        slug: "acme",
        role: "admin" as const,
      },
    ],
    lastActiveTenantId: organizationId,
  };
  const editPath = `/organizations/${organizationId}/monitors/${monitorId}/edit`;

  afterEach(() => {
    sessionState.data = null;
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchMonitorDetailMock.mockReset();
  });

  it("reads the monitor fresh for Edit even when a Detail poll is cached", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(member);
    const fresh = { monitor: detail({ version: 9 }) };
    fetchMonitorDetailMock.mockResolvedValue(fresh);
    renderAt([editRoute], editPath);

    expect(await screen.findByText("edit-area")).toBeInTheDocument();
    expect(fetchMonitorDetailMock).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      monitorId,
    );
    expect(
      peekStagedQueryClient()?.client.getQueryData(
        monitorQueryKeys.detail(organizationId, monitorId),
      ),
    ).toEqual(fresh);
  });

  it("requests no monitor for an Organization the user does not belong to", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([editRoute], editPath);

    expect(await screen.findByText("edit-area")).toBeInTheDocument();
    expect(fetchMonitorDetailMock).not.toHaveBeenCalled();
  });

  it("renders the Edit page when the read fails so the page shows its own state", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(member);
    fetchMonitorDetailMock.mockRejectedValue(new Error("404"));
    renderAt([editRoute], editPath);

    expect(await screen.findByText("edit-area")).toBeInTheDocument();
  });

  it("sends an anonymous visitor to sign in from Edit and from Create", async () => {
    sessionState.data = null;
    renderAt([editRoute], editPath);
    expect(await screen.findByTestId("from")).toHaveTextContent(editPath);
    expect(fetchMonitorDetailMock).not.toHaveBeenCalled();
  });

  it("lets a signed-in member open Create without any monitor request", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(member);
    renderAt([createRoute], `/organizations/${organizationId}/monitors/new`);
    expect(await screen.findByText("create-area")).toBeInTheDocument();
    expect(fetchMonitorDetailMock).not.toHaveBeenCalled();
  });
});

describe("organizationMembersLoader (fresh membership gate)", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const cachedOwnerContext: MeContextResponse = {
    ...meContext,
    organizations: [
      {
        id: organizationId,
        name: "Acme",
        slug: "acme",
        role: "owner",
      },
    ],
    lastActiveTenantId: organizationId,
  };
  const cachedMembers = {
    organizationId,
    members: [
      {
        id: "member-1",
        userId: "user-1",
        name: "Cached member",
        email: "cached@example.test",
        role: "owner" as const,
      },
    ],
    page: { limit: 50, offset: 0, total: 1 },
    memberLimit: 1000,
  };

  afterEach(() => {
    sessionState.data = null;
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchOrganizationMembersMock.mockReset();
    getSessionMock.mockReset();
    getSessionMock.mockImplementation(() =>
      Promise.resolve({ data: sessionState.data, error: null }),
    );
  });

  it("leaves destination context and member cache untouched after an aborted late success", async () => {
    sessionState.data = { user: VERIFIED };
    const pendingContext = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockImplementationOnce(() => pendingContext.promise);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    const destinationContext: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
    };
    const abortController = new AbortController();
    const loading = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
        { signal: abortController.signal },
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledOnce();
    });

    abortController.abort();
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, destinationContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    pendingContext.resolve(cachedOwnerContext);
    await loading;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      destinationContext,
    );
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toEqual(cachedMembers);
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("leaves destination context and member cache untouched after an aborted late failure", async () => {
    sessionState.data = { user: VERIFIED };
    const pendingContext = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockImplementationOnce(() => pendingContext.promise);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    const abortController = new AbortController();
    const loading = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
        { signal: abortController.signal },
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledOnce();
    });

    abortController.abort();
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    pendingContext.reject(new Error("context unavailable"));
    await loading;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      cachedOwnerContext,
    );
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toEqual(cachedMembers);
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("retires cached membership and directory data when the fresh decision fails", async () => {
    sessionState.data = { user: VERIFIED };
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    fetchMeContextMock.mockRejectedValue(new Error("context unavailable"));

    const result = await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    expect(result).toBeNull();
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
  });

  it("waits for a fresh stale directory page before publishing the member route", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:31.000Z"));
      sessionState.data = { user: VERIFIED };
      const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
      queryClient.setQueryData(
        memberListQueryKey(organizationId, 50, 0),
        cachedMembers,
        { updatedAt: Date.now() - 30_001 },
      );
      const freshMembers: OrganizationMemberListResponse = {
        organizationId,
        members: [
          {
            id: "member-fresh",
            userId: "user-fresh",
            name: "Fresh member",
            email: "fresh@example.test",
            role: "admin",
          },
        ],
        page: { limit: 50, offset: 0, total: 7 },
        memberLimit: 1000,
      };
      const freshRequest =
        Promise.withResolvers<OrganizationMemberListResponse>();
      const freshContext: MeContextResponse = {
        ...cachedOwnerContext,
        organizations: [
          {
            id: organizationId,
            name: "Fresh Acme",
            slug: "acme",
            role: "owner",
          },
        ],
      };
      fetchMeContextMock.mockResolvedValue(freshContext);
      fetchOrganizationMembersMock.mockImplementationOnce(
        () => freshRequest.promise,
      );

      let completed = false;
      const decision = organizationMembersLoader({
        params: { organizationId },
        request: new Request(
          `http://localhost/organizations/${organizationId}/members`,
        ),
      } as never).then(() => {
        completed = true;
      });
      await vi.waitFor(() => {
        expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();
      });
      expect(completed).toBe(false);

      freshRequest.resolve(freshMembers);
      await decision;

      expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
        freshContext,
      );
      expect(
        queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
      ).toEqual(freshMembers);
      expect(fetchOrganizationMembersMock).toHaveBeenCalledWith(
        organizationId,
        50,
        0,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an aborted in-flight member page overwrite the destination's same cache key", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(cachedOwnerContext);
    const pendingMembers =
      Promise.withResolvers<OrganizationMemberListResponse>();
    fetchOrganizationMembersMock.mockImplementationOnce(
      () => pendingMembers.promise,
    );
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    const destinationContext: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
    };
    const oldMembers: OrganizationMemberListResponse = {
      organizationId,
      members: [
        {
          id: "old-member",
          userId: "old-user",
          name: "Old member",
          email: "old@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    const abortController = new AbortController();
    const loading = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
        { signal: abortController.signal },
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();
    });

    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, destinationContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    abortController.abort();
    pendingMembers.resolve(oldMembers);
    await loading;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      destinationContext,
    );
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toEqual(cachedMembers);
    expect(
      queryClient.getQueryState(memberListQueryKey(organizationId, 50, 0))
        ?.status,
    ).toBe("success");
    expect(fetchOrganizationMembersMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a different destination organization's member page after an in-flight abort", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(cachedOwnerContext);
    const pendingMembers =
      Promise.withResolvers<OrganizationMemberListResponse>();
    fetchOrganizationMembersMock.mockImplementationOnce(
      () => pendingMembers.promise,
    );
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    const organizationB = "22222222-2222-4222-8222-222222222222";
    const destinationContext: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        { id: organizationB, name: "Bravo", slug: "bravo", role: "owner" },
      ],
      lastActiveTenantId: organizationB,
    };
    const destinationMembers: OrganizationMemberListResponse = {
      ...cachedMembers,
      organizationId: organizationB,
    };
    const abortController = new AbortController();
    const loading = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
        { signal: abortController.signal },
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();
    });

    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, destinationContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationB, 50, 0),
      destinationMembers,
    );
    abortController.abort();
    pendingMembers.resolve(cachedMembers);
    await loading;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      destinationContext,
    );
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationB, 50, 0)),
    ).toEqual(destinationMembers);
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
    expect(fetchOrganizationMembersMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a fresh directory page without a duplicate request", async () => {
    sessionState.data = { user: VERIFIED };
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    fetchMeContextMock.mockResolvedValue(cachedOwnerContext);

    await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toEqual(cachedMembers);
  });

  it("keeps B's fresh context and directory when older A resolves after B", async () => {
    sessionState.data = { user: VERIFIED };
    const staleA: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        {
          id: organizationId,
          name: "Alpha",
          slug: "acme",
          role: "owner",
        },
      ],
    };
    const freshB: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        {
          id: organizationId,
          name: "Bravo",
          slug: "acme",
          role: "owner",
        },
      ],
    };
    const membersB: OrganizationMemberListResponse = {
      organizationId,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "Bravo member",
          email: "bravo@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    const membersA: OrganizationMemberListResponse = {
      organizationId,
      members: [
        {
          id: "member-a",
          userId: "user-a",
          name: "Alpha member",
          email: "alpha@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    const newRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    fetchOrganizationMembersMock
      .mockResolvedValueOnce(membersB)
      .mockResolvedValueOnce(membersA);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);

    const oldDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    });
    const newDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });

    newRequest.resolve(freshB);
    await newDecision;
    oldRequest.resolve(staleA);
    await oldDecision;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(freshB);
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toEqual(membersB);
    expect(fetchOrganizationMembersMock).toHaveBeenCalledTimes(1);
  });

  it("keeps B's tenant cache when delayed A resolves its session after B", async () => {
    const organizationA = "11111111-1111-4111-8111-111111111111";
    const organizationB = "22222222-2222-4222-8222-222222222222";
    const staleContextA: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        {
          id: organizationA,
          name: "Alpha",
          slug: "alpha",
          role: "owner",
        },
      ],
      lastActiveTenantId: organizationA,
    };
    const freshContextB: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        {
          id: organizationB,
          name: "Bravo",
          slug: "bravo",
          role: "owner",
        },
      ],
      lastActiveTenantId: organizationB,
    };
    const membersB: OrganizationMemberListResponse = {
      organizationId: organizationB,
      members: [],
      page: { limit: 50, offset: 0, total: 0 },
      memberLimit: 1000,
    };
    const sessionA = Promise.withResolvers<{
      data: { user: SessionUser };
      error: null;
    }>();
    const sessionB = Promise.withResolvers<{
      data: { user: SessionUser };
      error: null;
    }>();
    const contextB = Promise.withResolvers<MeContextResponse>();
    const contextA = Promise.withResolvers<MeContextResponse>();
    getSessionMock
      .mockImplementationOnce(() => sessionA.promise)
      .mockImplementationOnce(() => sessionB.promise);
    fetchMeContextMock
      .mockImplementationOnce(() => contextB.promise)
      .mockImplementationOnce(() => contextA.promise);
    fetchOrganizationMembersMock.mockResolvedValueOnce(membersB);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);

    const olderA = organizationMembersLoader({
      params: { organizationId: organizationA },
      request: new Request(
        `http://localhost/organizations/${organizationA}/members`,
      ),
    } as never);
    const newerB = organizationMembersLoader({
      params: { organizationId: organizationB },
      request: new Request(
        `http://localhost/organizations/${organizationB}/members`,
      ),
    } as never);
    sessionB.resolve({ data: { user: VERIFIED }, error: null });
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    });
    contextB.resolve(freshContextB);
    await newerB;

    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    sessionA.resolve({ data: { user: VERIFIED }, error: null });
    contextA.resolve(staleContextA);
    await olderA;

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    expect(fetchOrganizationMembersMock).toHaveBeenCalledWith(
      organizationB,
      50,
      0,
    );
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      freshContextB,
    );
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationB, 50, 0)),
    ).toEqual(membersB);
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationA, 50, 0)),
    ).toBeUndefined();
  });

  it("does not publish an older direct directory decision after a confirmed tenant scope", async () => {
    sessionState.data = { user: VERIFIED };
    const staleContext = Promise.withResolvers<MeContextResponse>();
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    fetchMeContextMock.mockImplementationOnce(() => staleContext.promise);

    const directA = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledOnce();
    });

    publishTenantScope(queryClient);
    staleContext.resolve(cachedOwnerContext);
    await directA;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("keeps the unavailable state when newer B fails before older A resolves", async () => {
    sessionState.data = { user: VERIFIED };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    const newRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );

    const oldDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    });
    const newDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });

    newRequest.reject(new Error("context unavailable"));
    await newDecision;
    oldRequest.resolve(cachedOwnerContext);
    await oldDecision;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("keeps the fresh no-A decision when an older context query resolves stale A", async () => {
    sessionState.data = { user: VERIFIED };
    const staleA: MeContextResponse = {
      ...cachedOwnerContext,
      lastActiveTenantId: organizationId,
    };
    const freshB: MeContextResponse = {
      ...meContext,
      organizations: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Bravo",
          slug: "bravo",
          role: "viewer",
        },
      ],
      lastActiveTenantId: "22222222-2222-4222-8222-222222222222",
    };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce(freshB);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );

    const oldQuery = queryClient
      .query({
        queryKey: ME_CONTEXT_QUERY_KEY,
        queryFn: fetchMeContext,
      })
      .catch(() => undefined);

    const result = await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    oldRequest.resolve(staleA);
    await oldQuery;

    expect(result).toBeNull();
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(freshB);
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("retires membership data when a fresh decision fails during an older context query", async () => {
    sessionState.data = { user: VERIFIED };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockRejectedValueOnce(new Error("context unavailable"));
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    const oldQuery = queryClient
      .query({
        queryKey: ME_CONTEXT_QUERY_KEY,
        queryFn: fetchMeContext,
      })
      .catch(() => undefined);

    const result = await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    oldRequest.resolve(cachedOwnerContext);
    await oldQuery;

    expect(result).toBeNull();
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
  });
});

describe("verifyEmailLoader (anonymous-reachable resend hub)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
    fetchInvitationMock.mockReset();
  });

  const verifyEmail: RouteObject = {
    path: "/verify-email",
    loader: verifyEmailLoader,
    element: <div>verify-area</div>,
  };

  it("prefetches the remembered invitation preview into the anonymous identity", async () => {
    rememberInvitation("inv-5");
    fetchInvitationMock.mockResolvedValue(invitation);
    renderAt([verifyEmail], "/verify-email");

    expect(await screen.findByText("verify-area")).toBeInTheDocument();
    expect(fetchInvitationMock).toHaveBeenCalledTimes(1);
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBeNull();
    expect(staged?.client.getQueryData(invitationQueryKey("inv-5"))).toEqual(
      invitation,
    );
  });

  it("an unknown invitation yields the page without prefill, never a router error", async () => {
    rememberInvitation("inv-gone");
    fetchInvitationMock.mockRejectedValue(new Error("not found"));
    renderAt([verifyEmail], "/verify-email");

    expect(await screen.findByText("verify-area")).toBeInTheDocument();
  });

  it("stages nothing for signed-in visitors — they never run the preview query", async () => {
    sessionState.data = { user: UNVERIFIED };
    rememberInvitation("inv-5");
    renderAt([verifyEmail], "/verify-email");

    expect(await screen.findByText("verify-area")).toBeInTheDocument();
    expect(fetchInvitationMock).not.toHaveBeenCalled();
    expect(peekStagedQueryClient()).toBeNull();
  });
});

describe("verified bootstrap barrier", () => {
  afterEach(() => {
    sessionState.data = null;
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchNotificationsMock.mockReset();
    fetchOrganizationMembersMock.mockReset();
  });

  it("keeps parallel tenant and inbox loaders idle until one identity-bound resolution completes", async () => {
    sessionState.data = { user: VERIFIED };
    const resolution = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockImplementationOnce(() => resolution.promise);
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const request = new Request("http://localhost/workspace");
    const args = {
      request,
      url: new URL(request.url),
      pattern: "/workspace",
      params: {},
      context: {},
    };
    fetchMonitorListMock.mockResolvedValue({
      summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
      monitors: [],
      page: { limit: 50, offset: 0, total: 0 },
      dataAsOf: "2026-09-30T07:32:05.000Z",
    });
    fetchNotificationsMock.mockResolvedValue({
      organizationId,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    const loading = Promise.all([
      workspaceLoader(args),
      notificationsLoader(args),
    ]);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMonitorListMock).not.toHaveBeenCalled();
    expect(fetchNotificationsMock).not.toHaveBeenCalled();
    resolution.resolve({
      ...meContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
      lastActiveTenantId: organizationId,
    });
    await loading;
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    expect(fetchMonitorListMock).toHaveBeenCalledWith(
      organizationId,
      OVERVIEW_LIST_PARAMS,
    );
    expect(fetchNotificationsMock).toHaveBeenCalledWith(organizationId);
  });

  it("does not use a cached tenant context or account-only inbox when fresh resolution fails", async () => {
    sessionState.data = { user: VERIFIED };
    const client = resolveQueryClientForIdentity(VERIFIED.id);
    const organizationId = "11111111-1111-4111-8111-111111111111";
    client.setQueryData(ME_CONTEXT_QUERY_KEY, {
      ...meContext,
      organizations: [
        { id: organizationId, name: "Acme", slug: "acme", role: "viewer" },
      ],
      lastActiveTenantId: organizationId,
    });
    client.setQueryData(["tenant", organizationId, "retired"], { old: true });
    fetchMeContextMock.mockRejectedValueOnce(new Error("unavailable"));
    const request = new Request("http://localhost/notifications");
    await notificationsLoader({
      request,
      url: new URL(request.url),
      pattern: "/notifications",
      params: {},
      context: {},
    });
    expect(fetchNotificationsMock).not.toHaveBeenCalled();
    expect(
      client.getQueryData(["tenant", organizationId, "retired"]),
    ).toBeUndefined();
    expect(client.getQueryState(ME_CONTEXT_QUERY_KEY)?.status).toBe("error");
  });
});

describe("bootstrap response identity", () => {
  afterEach(() => {
    sessionState.data = null;
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchNotificationsMock.mockReset();
    fetchOrganizationMembersMock.mockReset();
  });

  it.each([workspaceLoader, organizationMembersLoader])(
    "rejects a deferred B response after the loader verified A without publishing or tenant prefetch (%s)",
    async (loader) => {
      sessionState.data = { user: VERIFIED };
      const response = Promise.withResolvers<MeContextResponse>();
      fetchMeContextMock.mockReturnValueOnce(response.promise);
      const request = new Request("http://localhost/workspace");
      const loading = loader({
        request,
        url: new URL(request.url),
        pattern: "/workspace",
        params: { organizationId: "11111111-1111-4111-8111-111111111111" },
        context: {},
      });
      await vi.waitFor(() => {
        expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
      });
      response.resolve({
        ...meContext,
        user: { ...meContext.user, id: "user-b" },
        organizations: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Foreign",
            slug: "foreign",
            role: "owner",
          },
        ],
        lastActiveTenantId: "11111111-1111-4111-8111-111111111111",
      });
      await loading;
      const client = resolveQueryClientForIdentity(VERIFIED.id);
      expect(client.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
      expect(fetchMonitorListMock).not.toHaveBeenCalled();
      expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
      expect(client.getQueriesData({ queryKey: ["tenant"] })).toEqual([]);
    },
  );
});
