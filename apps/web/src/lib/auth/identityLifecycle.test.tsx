import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
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
import { resetQueryClientRegistry } from "../queryClient";
import { requireAnonLoader, workspaceLoader } from "./loaders";

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
    // Reactive stand-in for the better-auth session atom: mutations notify
    // subscribers so hooks re-read, exactly like the real client.
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
  // Dynamic import: vi.mock factories are hoisted above static imports, so
  // react can only be reached lazily inside the factory.
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

/**
 * Every committed frame, in order. A layout effect observes exactly what
 * users could see; a post-hoc DOM assertion alone could miss a transient
 * frame served from the previous identity's cache.
 */
const commitLog: string[] = [];

/**
 * Stands in for the workspace's tenant consumer (TenantProvider's /me
 * query): reads its data through the provider-supplied QueryClient only.
 */
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

/**
 * The real gate loaders and the real RootLayout wiring (SessionQueryProvider
 * + revalidation-on-identity-change); only the page bodies are probes.
 */
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
    commitLog.length = 0;
    sessionStorage.clear();
    resetQueryClientRegistry();
  });

  it("user B never receives user A's cached data, and each loader prefetch lands in that identity's own client", async () => {
    // The transport answers for whoever the server session currently is,
    // logging which identity each fetch served; a cache leak would surface
    // A's payload without a new fetch.
    const fetchLog: string[] = [];
    transport.mockImplementation(() => {
      const user = sessionStore.get().data?.user;
      fetchLog.push(user?.id ?? "anonymous");
      if (user === undefined) {
        // The epoch remount during the logout bounce window briefly mounts
        // the probe under the fresh anonymous client; that fetch fails and
        // is cancelled with the retired client. It never carries user data.
        return Promise.reject(new Error("anonymous transport call"));
      }
      return Promise.resolve(meContextFor(user));
    });

    // Hard load of /workspace as user A: the loader prefetches me/context
    // and the committed tree consumes exactly that client.
    sessionStore.set({ user: USER_A });
    const router = createMemoryRouter(lifecycleRoutes, {
      initialEntries: ["/workspace"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId("view")).toHaveTextContent("User A");
    // The ONLY fetch so far is the loader's — the in-tree query hit cache.
    expect(fetchLog).toEqual(["user-a"]);
    // Logout: the session drops without any navigation. The identity swap
    // revalidates the active loader, which bounces to the login gate.
    act(() => {
      sessionStore.set(null);
    });

    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    const commitsBeforeB = commitLog.length;

    // Login as user B, again without an explicit navigation: the anonymous
    // gate's loader re-runs, continues to /workspace, and its prefetch must
    // land in B's own client — the one B's committed tree consumes.
    act(() => {
      sessionStore.set({ user: USER_B });
    });

    expect(await screen.findByTestId("view")).toHaveTextContent("User B");
    // Exactly one fetch per identity: B's loader prefetch was consumed by
    // B's tree (no waterfall refetch), and no singleton served A's cache
    // (which would have suppressed B's fetch entirely). Any "anonymous"
    // entry is the failed bounce-window fetch described above.
    expect(fetchLog.filter((id) => id === "user-a")).toHaveLength(1);
    expect(fetchLog.filter((id) => id === "user-b")).toHaveLength(1);
    // No committed frame after the switch ever showed A's data.
    expect(commitLog.slice(commitsBeforeB)).toContain("User B");
    expect(commitLog.slice(commitsBeforeB)).not.toContain("User A");
  });

  it("document-resyncs when a fresh loader resolves B while the committed provider still serves A", async () => {
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

    expect(await screen.findByTestId("view")).toHaveTextContent("User A");
    expect(fetchLog).toEqual(["user-a"]);
    const commitsBeforeFreshB = commitLog.length;

    // Exact race: the cookie-backed loader snapshot has advanced to B, but
    // the client session atom and committed QueryClient boundary are still A.
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
    // The conflicting loader never stages or prefetches B, and nothing can
    // commit under A after it: the browser is instructed to reload instead.
    expect(fetchLog).toEqual(["user-a"]);
    expect(commitLog.slice(commitsBeforeFreshB)).not.toContain("User B");
  });

  it("same-identity navigation reuses the rendered client's loader prefetch", async () => {
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
    expect(await screen.findByTestId("view")).toHaveTextContent("User A");
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
    expect(fetchLog).toEqual(["user-a"]);
    expect(screen.getByTestId("view")).toHaveTextContent("User A");
  });
});
