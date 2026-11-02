import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type {
  MeContextResponse,
  MonitorListResponse,
  ProjectDetail,
} from "@nightwatch/api-contract";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  type RouteObject,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RootLayout } from "../../router";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  monitorQueryKeys,
  MONITOR_LIST_PAGE_SIZE,
  type MonitorRecentEventsResponse,
} from "../api/monitors";
import { fetchProjectDetail, projectQueryKeys } from "../api/projects";
import { TenantProvider } from "../tenant/TenantProvider";
import { ProjectOverviewPage } from "../../pages/projects/overview/ProjectOverviewPage";
import {
  resetQueryClientRegistry,
  resolveQueryClientForIdentity,
  peekActiveQueryClientIdentity,
} from "../queryClient";
import {
  projectOverviewLoader,
  requireAnonLoader,
  workspaceLoader,
} from "./loaders";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

type TestSessionData = { user: SessionUser } | null;

const { sessionStore, transport } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: { data: TestSessionData; isPending: boolean } = {
    data: null,
    isPending: false,
  };
  let freshSession: TestSessionData = null;
  return {
    // Reactive stand-in for the better-auth session atom: mutations notify subscribers.
    sessionStore: {
      get: () => snapshot,
      getFresh: () => freshSession,
      set(data: TestSessionData) {
        snapshot = { data, isPending: false };
        freshSession = data;
        for (const listener of listeners) {
          listener();
        }
      },
      setFresh(data: TestSessionData) {
        freshSession = data;
      },
      reset() {
        snapshot = { data: null, isPending: false };
        freshSession = null;
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    transport: vi.fn<() => Promise<MeContextResponse>>(),
  };
});

vi.mock("better-auth/react", async () => {
  // vi.mock factories are hoisted above static imports, so react must be imported lazily.
  const { useSyncExternalStore } = await import("react");
  return {
    createAuthClient: () => ({
      useSession: () =>
        useSyncExternalStore(
          (listener) => sessionStore.subscribe(listener),
          sessionStore.get,
        ),
      getSession: () =>
        Promise.resolve({ data: sessionStore.getFresh(), error: null }),
    }),
  };
});

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchMeContext: vi.fn(() => transport()) };
});

vi.mock("../api/monitors", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
}));
vi.mock("../api/projects", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchProjectDetail: vi.fn(),
}));

const USER_A: SessionUser = {
  id: "user-a",
  name: "User A",
  email: "a@example.com",
  emailVerified: true,
};

const USER_B: SessionUser = {
  id: "user-b",
  name: "User B",
  email: "b@example.com",
  emailVerified: true,
};

function meContextFor(user: SessionUser): MeContextResponse {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      twoFactorEnabled: false,
    },
    organizations: [],
    lastActiveTenantId: null,
  };
}

// Records every committed frame; a post-hoc DOM assertion could miss a transient frame from the previous identity's cache.
const commitLog: string[] = [];

// Stands in for TenantProvider's /me query; reads only through the provider's QueryClient.
function ContextProbe() {
  const query = useQuery<MeContextResponse>({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
    retry: false,
  });
  const view = query.data === undefined ? "loading" : query.data.user.name;
  useLayoutEffect(() => {
    commitLog.push(view);
  });
  return <div data-testid="view">{view}</div>;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

// Real gate loaders and RootLayout wiring; only the page bodies are probes.
const lifecycleRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        path: "/workspace",
        loader: workspaceLoader,
        element: <ContextProbe />,
      },
      {
        path: "/organizations/:organizationId/projects/:projectId/overview",
        loader: projectOverviewLoader,
        element: <ContextProbe />,
      },
      {
        path: "/login",
        loader: requireAnonLoader,
        element: <div data-testid="login-page">login-page</div>,
      },
      { path: "*", element: <LocationProbe /> },
    ],
  },
];

describe("per-identity cache lifecycle across logout → login", () => {
  afterEach(() => {
    sessionStore.reset();
    transport.mockReset();
    vi.mocked(fetchMonitorList).mockReset();
    vi.mocked(fetchMonitorRecentEvents).mockReset();
    vi.mocked(fetchProjectDetail).mockReset();
    commitLog.length = 0;
    sessionStorage.clear();
    resetQueryClientRegistry();
  });

  it.each(["/workspace", "/organizations/org/projects/project/overview"])(
    "isolates account caches and loader prefetches by identity: %s",
    async (entry) => {
      // Logs which identity each fetch served; a cache leak would surface A's payload without a new fetch.
      const fetchLog: string[] = [];
      transport.mockImplementation(() => {
        const user = sessionStore.get().data?.user;
        fetchLog.push(user?.id ?? "anonymous");
        if (user === undefined) {
          // The logout epoch remount briefly mounts the probe under the anonymous client; that fetch
          // fails and is cancelled. It never carries user data.
          return Promise.reject(new Error("anonymous transport call"));
        }
        return Promise.resolve(meContextFor(user));
      });

      sessionStore.set({ user: USER_A });
      const router = createMemoryRouter(lifecycleRoutes, {
        initialEntries: [entry],
      });
      render(<RouterProvider router={router} />);

      expect(await screen.findByTestId("view")).toHaveTextContent("User A");
      // The ONLY fetch so far is the loader's — the in-tree query hit cache.
      expect(fetchLog).toEqual(["user-a"]);
      // Logout without navigation: revalidation bounces to the login gate.
      act(() => {
        sessionStore.set(null);
      });

      expect(await screen.findByTestId("login-page")).toBeInTheDocument();
      const commitsBeforeB = commitLog.length;

      // Login as B without navigation: B's loader prefetch must land in the client B's tree consumes.
      act(() => {
        sessionStore.set({ user: USER_B });
      });

      expect(await screen.findByTestId("view")).toHaveTextContent("User B");
      // One fetch per identity: B's prefetch was consumed (no refetch) and no singleton served A's
      // cache. Any "anonymous" entry is the bounce-window fetch above.
      expect(fetchLog.filter((id) => id === "user-a")).toHaveLength(1);
      expect(fetchLog.filter((id) => id === "user-b")).toHaveLength(1);
      // No committed frame after the switch ever showed A's data.
      expect(commitLog.slice(commitsBeforeB)).toContain("User B");
      expect(commitLog.slice(commitsBeforeB)).not.toContain("User A");
    },
  );

  it("retires pending overview list, events and detail across identities without publishing A into B", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const projectId = "33333333-3333-4333-8333-333333333333";
    const listKey = monitorQueryKeys.list(organizationId, projectId, {
      limit: MONITOR_LIST_PAGE_SIZE,
      offset: 0,
    });
    const eventsKey = monitorQueryKeys.recentEvents(organizationId, projectId);
    const detailKey = projectQueryKeys.detail(organizationId, projectId);
    const asOf = "2026-10-31T00:00:00.000Z";
    const listFor = (total: number): MonitorListResponse => ({
      monitors: [],
      summary: { total, up: total, down: 0, unknown: 0, paused: 0, limit: 20 },
      page: { limit: MONITOR_LIST_PAGE_SIZE, offset: 0, total },
      dataAsOf: asOf,
    });
    const eventsFor = (name: string): MonitorRecentEventsResponse => ({
      events: [
        {
          kind: "incident_opened",
          monitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          monitorName: name,
          at: asOf,
          reason: "http_status",
          httpStatus: 503,
        },
      ],
    });
    const detailFor = (name: string, count: number): ProjectDetail => ({
      id: projectId,
      name,
      slug: "identity-project",
      description: null,
      memberCount: count,
      adminCount: 1,
      myRole: "admin",
      updatedAt: asOf,
    });
    transport.mockImplementation(() => {
      const user = sessionStore.getFresh()?.user;
      if (user === undefined) return Promise.reject(new Error("anonymous"));
      return Promise.resolve({
        ...meContextFor(user),
        organizations: [
          {
            id: organizationId,
            name: "Shared Organization",
            slug: "shared",
            role: "owner",
          },
        ],
        lastActiveTenantId: organizationId,
      });
    });
    const oldList = Promise.withResolvers<MonitorListResponse>();
    const oldEvents = Promise.withResolvers<MonitorRecentEventsResponse>();
    const oldDetail = Promise.withResolvers<ProjectDetail>();
    let deferA = false;
    const reads: string[] = [];
    vi.mocked(fetchMonitorList).mockImplementation(() => {
      const identity = sessionStore.getFresh()?.user.id;
      reads.push(`list:${identity ?? "anonymous"}`);
      return identity === USER_A.id
        ? deferA
          ? oldList.promise
          : Promise.resolve(listFor(11))
        : Promise.resolve(listFor(2));
    });
    vi.mocked(fetchMonitorRecentEvents).mockImplementation(() => {
      const identity = sessionStore.getFresh()?.user.id;
      reads.push(`events:${identity ?? "anonymous"}`);
      return identity === USER_A.id
        ? deferA
          ? oldEvents.promise
          : Promise.resolve(eventsFor("A-only event"))
        : Promise.resolve(eventsFor("B-only event"));
    });
    vi.mocked(fetchProjectDetail).mockImplementation(() => {
      const identity = sessionStore.getFresh()?.user.id;
      reads.push(`detail:${identity ?? "anonymous"}`);
      return identity === USER_A.id
        ? deferA
          ? oldDetail.promise
          : Promise.resolve(detailFor("A-only Project", 11))
        : Promise.resolve(detailFor("B-only Project", 2));
    });
    const frames: {
      identity: string | undefined;
      text: string;
      total: string | null;
      members: string | null;
    }[] = [];
    const consumed = new Map<string, QueryClient>();
    function OverviewProbe() {
      const client = useQueryClient();
      useQuery({ queryKey: listKey, enabled: false });
      useQuery({ queryKey: eventsKey, enabled: false });
      useQuery({ queryKey: detailKey, enabled: false });
      useLayoutEffect(() => {
        const identity = sessionStore.get().data?.user.id;
        if (identity !== undefined) consumed.set(identity, client);
        frames.push({
          identity,
          text: document.body.textContent,
          total:
            document.querySelector('[data-testid="project-overview-total"]')
              ?.textContent ?? null,
          members:
            document.querySelector(
              '[data-testid="project-overview-member-count"]',
            )?.textContent ?? null,
        });
      });
      return <ProjectOverviewPage />;
    }
    const loaded: string[] = [];
    const loader: typeof projectOverviewLoader = (args) => {
      loaded.push(sessionStore.getFresh()?.user.id ?? "anonymous");
      return projectOverviewLoader(args);
    };
    sessionStore.set({ user: USER_A });
    const router = createMemoryRouter(
      [
        {
          element: <RootLayout />,
          children: [
            {
              element: (
                <TenantProvider>
                  <OverviewProbe />
                </TenantProvider>
              ),
              path: "/organizations/:organizationId/projects/:projectId/overview",
              loader,
            },
          ],
        },
      ],
      {
        initialEntries: [
          `/organizations/${organizationId}/projects/${projectId}/overview`,
        ],
      },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(
        screen.getByTestId("project-overview-member-count"),
      ).toHaveTextContent("11");
    });
    expect(screen.getByTestId("project-overview-event")).toHaveTextContent(
      "A-only event",
    );
    const retired = resolveQueryClientForIdentity(USER_A.id);
    expect(consumed.get(USER_A.id)).toBe(retired);
    expect(retired.getQueryData(listKey)).toEqual(listFor(11));
    expect(retired.getQueryData(eventsKey)).toEqual(eventsFor("A-only event"));
    deferA = true;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = Promise.all(
        [listKey, eventsKey, detailKey].map((queryKey) =>
          retired.invalidateQueries({ queryKey }),
        ),
      );
    });
    await waitFor(() => {
      for (const kind of ["list", "events", "detail"])
        expect(
          reads.filter((read) => read === `${kind}:user-a`).length,
        ).toBeGreaterThanOrEqual(2);
    });
    const firstBFrame = frames.length;
    act(() => {
      sessionStore.set({ user: USER_B });
    });
    await waitFor(() => {
      expect(screen.getByTestId("project-overview-scope")).toHaveTextContent(
        "B-only Project",
      );
      expect(screen.getByTestId("project-overview-total")).toHaveTextContent(
        "2",
      );
      expect(screen.getByTestId("project-overview-event")).toHaveTextContent(
        "B-only event",
      );
    });
    const active = resolveQueryClientForIdentity(USER_B.id);
    expect(consumed.get(USER_B.id)).toBe(active);
    expect(active).not.toBe(retired);
    expect(loaded).toContain(USER_A.id);
    expect(loaded).toContain(USER_B.id);
    for (const kind of ["list", "events", "detail"])
      expect(reads).toContain(`${kind}:user-b`);
    await act(async () => {
      oldList.resolve(listFor(19));
      oldEvents.resolve(eventsFor("A-only late event"));
      oldDetail.resolve(detailFor("A-only late Project", 19));
      await pending;
    });
    await waitFor(() => {
      expect(retired.getQueryCache().getAll()).toHaveLength(0);
    });
    expect(active.getQueryData(listKey)).toEqual(listFor(2));
    expect(active.getQueryData(eventsKey)).toEqual(eventsFor("B-only event"));
    expect(active.getQueryData(detailKey)).toEqual(
      detailFor("B-only Project", 2),
    );
    expect(screen.getByTestId("project-overview-total")).toHaveTextContent("2");
    expect(screen.queryByText(/A-only/)).toBeNull();
    const bFrames = frames
      .slice(firstBFrame)
      .filter((frame) => frame.identity === USER_B.id);
    expect(bFrames.length).toBeGreaterThan(0);
    for (const frame of bFrames) {
      expect(frame.text).not.toMatch(/A-only/);
      if (frame.total !== null) expect(frame.total).toBe("2");
      if (frame.members !== null) expect(frame.members).toBe("2");
    }
    router.dispose();
  });

  it("reloads the document when a fresh loader identity differs from the committed provider", async () => {
    const fetchLog: string[] = [];
    transport.mockImplementation(() => {
      const user = sessionStore.getFresh()?.user;
      if (user === undefined) {
        return Promise.reject(new Error("anonymous transport call"));
      }
      fetchLog.push(user.id);
      return Promise.resolve(meContextFor(user));
    });

    sessionStore.set({ user: USER_A });
    const router = createMemoryRouter(lifecycleRoutes, {
      initialEntries: ["/workspace"],
    });
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId("view")).toHaveTextContent("User A");
      expect(peekActiveQueryClientIdentity()).toBe("user-a");
    });
    expect(fetchLog).toEqual(["user-a"]);
    const commitsBeforeFreshB = commitLog.length;

    // Race: the cookie-backed loader sees B while the session atom and committed boundary are still A.
    sessionStore.setFresh({ user: USER_B });
    const conflictingRequest = new Request(
      "http://localhost/workspace?account=user-b",
    );
    const result = await workspaceLoader({
      request: conflictingRequest,
      url: new URL(conflictingRequest.url),
      pattern: "/workspace",
      params: {},
      context: {},
    });

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) {
      throw new Error("identity conflict did not request a document resync");
    }
    expect(result.headers.get("Location")).toBe(
      "http://localhost/workspace?account=user-b",
    );
    expect(result.headers.get("X-Remix-Reload-Document")).toBe("true");
    // The conflicting loader never stages B; the browser reloads instead.
    expect(fetchLog).toEqual(["user-a"]);
    expect(commitLog.slice(commitsBeforeFreshB)).not.toContain("User B");
  });

  it("same-identity navigation resolves afresh into the rendered identity client", async () => {
    const fetchLog: string[] = [];
    transport.mockImplementation(() => {
      const user = sessionStore.getFresh()?.user;
      if (user === undefined) {
        return Promise.reject(new Error("anonymous transport call"));
      }
      fetchLog.push(user.id);
      return Promise.resolve(meContextFor(user));
    });

    sessionStore.set({ user: USER_A });
    const router = createMemoryRouter(lifecycleRoutes, {
      initialEntries: ["/workspace"],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByTestId("view")).toHaveTextContent("User A");
      expect(peekActiveQueryClientIdentity()).toBe("user-a");
    });
    const sameIdentityRequest = new Request(
      "http://localhost/workspace?tab=same-user",
    );
    const result = await workspaceLoader({
      request: sameIdentityRequest,
      url: new URL(sameIdentityRequest.url),
      pattern: "/workspace",
      params: {},
      context: {},
    });

    expect(result).toBeNull();
    expect(fetchLog).toEqual(["user-a", "user-a"]);
    expect(screen.getByTestId("view")).toHaveTextContent("User A");
  });
});
