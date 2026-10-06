import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type { MeContextResponse } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
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
  resetQueryClientRegistry,
  peekActiveQueryClientIdentity,
} from "../queryClient";
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
      initialEntries: ["/workspace"],
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
