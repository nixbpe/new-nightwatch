import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from "react-router";
import { describe, expect, it, vi } from "vitest";

import { routes } from "./router";

// The shell, its providers and the two pages are stand-ins: these tests are about which boundary
// shows a loader error, not about what those parts render.
const loaders = vi.hoisted(() => ({
  workspaceLoader: vi.fn(),
  requireAnonLoader: vi.fn(),
}));
vi.mock("./lib/auth/loaders", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...loaders,
}));
vi.mock("./components/shell/AppShell", async () => {
  const { Outlet: Content } = await import("react-router");
  return {
    AppShell: () => (
      <div>
        <nav data-testid="shell-nav" />
        <main>
          <Content />
        </main>
      </div>
    ),
  };
});
vi.mock("./lib/tenant/TenantProvider", () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./lib/auth/SessionQueryProvider", () => ({
  SessionQueryProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("./pages/WorkspaceEntryFallback", () => ({
  WorkspaceEntryFallback: () => <div data-testid="workspace-page" />,
}));
vi.mock("./pages/LoginPage", () => ({
  LoginPage: () => <div data-testid="login-page" />,
}));

function allRoutes(list: RouteObject[]): RouteObject[] {
  return list.flatMap((route) => [route, ...allRoutes(route.children ?? [])]);
}

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECTS = `/organizations/${ORG}/projects`;

// The real Projects route with its loader counted, so the route's own shouldRevalidate is what runs.
function projectsRouter(entry: string) {
  const route = allRoutes(routes).find(
    (candidate) => candidate.path === "/organizations/:organizationId/projects",
  );
  if (route === undefined) throw new Error("projects route not found");
  const loader = vi.fn(() => null);
  const router = createMemoryRouter(
    [
      { ...route, loader, element: null },
      { path: "/elsewhere", element: null },
    ],
    { initialEntries: [entry] },
  );
  return { router, loader };
}

// The first load has committed, so the route holds loader data and later navigations may skip it.
const settled = (router: ReturnType<typeof createMemoryRouter>) =>
  vi.waitFor(() => {
    expect(router.state.initialized).toBe(true);
    expect(router.state.navigation.state).toBe("idle");
  });

describe("Projects route revalidation", () => {
  it.each([PROJECTS, `${PROJECTS}?create=1`])(
    "runs the loader again on a revalidation of %s, so a session change reaches its gate",
    async (entry) => {
      const { router, loader } = projectsRouter(entry);
      await settled(router);
      await act(() => router.revalidate());
      expect(loader).toHaveBeenCalledTimes(2);
      router.dispose();
    },
  );

  it("skips the loader only when the same page drops ?create=1", async () => {
    const { router, loader } = projectsRouter(`${PROJECTS}?create=1`);
    await settled(router);
    await act(() => router.navigate(PROJECTS, { replace: true }));
    expect(loader).toHaveBeenCalledTimes(1);
    router.dispose();
  });

  it.each([
    [`${PROJECTS}?view=all`, `${PROJECTS}?view=mine`],
    [`${PROJECTS}?create=1`, `${PROJECTS}?create=1&view=mine`],
    [PROJECTS, `${PROJECTS}?view=mine`],
  ])(
    "runs the loader for a same-page change that does not drop create (%s to %s)",
    async (from, to) => {
      const { router, loader } = projectsRouter(from);
      await settled(router);
      await act(() => router.navigate(to, { replace: true }));
      expect(loader).toHaveBeenCalledTimes(2);
      router.dispose();
    },
  );

  it("runs the loader for any other navigation", async () => {
    const { router, loader } = projectsRouter(`${PROJECTS}?create=1`);
    await settled(router);
    await act(() => router.navigate("/elsewhere"));
    await act(() => router.navigate(`${PROJECTS}?create=1`));
    expect(loader).toHaveBeenCalledTimes(2);
    router.dispose();
  });
});

describe("Vulnerability routes", () => {
  const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const VULNERABILITIES = `${PROJECTS}/${PROJECT}/vulnerabilities`;

  // The real routes of the two retired pages, with a bare target in place of the findings page.
  function vulnerabilityRouter(entry: string) {
    const real = allRoutes(routes).filter((candidate) =>
      [`${VULNERABILITIES}/new`, `${VULNERABILITIES}/priority`]
        .map((path) =>
          path.replace(ORG, ":organizationId").replace(PROJECT, ":projectId"),
        )
        .includes(candidate.path ?? ""),
    );
    expect(real).toHaveLength(2);
    return createMemoryRouter(
      [
        ...real,
        {
          path: "/organizations/:organizationId/projects/:projectId/vulnerabilities",
          element: null,
        },
      ],
      { initialEntries: [entry] },
    );
  }

  it.each([
    [`${VULNERABILITIES}/new`, `${VULNERABILITIES}?new=1`],
    [`${VULNERABILITIES}/priority`, VULNERABILITIES],
    // What a link already sent carried stays, the filter is added or kept.
    [`${VULNERABILITIES}/new?system=s1`, `${VULNERABILITIES}?system=s1&new=1`],
    [`${VULNERABILITIES}/new?new=1`, `${VULNERABILITIES}?new=1`],
    [`${VULNERABILITIES}/priority?kev=1`, `${VULNERABILITIES}?kev=1`],
    // Decoded route params are encoded again: a slash or a question mark cannot change the path.
    [`${PROJECTS}/${PROJECT}/vulnerabilities/new`, `${VULNERABILITIES}?new=1`],
    [
      `${PROJECTS.replace(ORG, "a%2Fb")}/p%3Fx/vulnerabilities/new`,
      `${PROJECTS.replace(ORG, "a%2Fb")}/p%3Fx/vulnerabilities?new=1`,
    ],
  ])("sends %s to %s", async (from, to) => {
    const router = vulnerabilityRouter(from);
    await settled(router);
    expect(router.state.location.pathname + router.state.location.search).toBe(
      to,
    );
    router.dispose();
  });
});

describe("A loader that throws", () => {
  function open(entry: string) {
    const router = createMemoryRouter(routes, { initialEntries: [entry] });
    render(<RouterProvider router={router} />);
    return router;
  }

  it("shows the error inside the shell and runs the loader again on retry", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    loaders.workspaceLoader
      .mockRejectedValueOnce(new Error("loader failed"))
      .mockResolvedValue(null);
    const router = open("/workspace");

    // The detail stays in the console; the screen carries fixed Thai text, not the raw message.
    expect(await screen.findByTestId("render-error")).toBeInTheDocument();
    expect(screen.queryByText("loader failed")).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Unhandled route error",
      expect.objectContaining({ message: "loader failed" }),
    );
    expect(screen.getByTestId("shell-nav")).toBeInTheDocument();
    expect(screen.queryByText("Unexpected Application Error!")).toBeNull();

    await userEvent.click(screen.getByTestId("render-error-retry"));
    expect(await screen.findByTestId("workspace-page")).toBeInTheDocument();
    expect(screen.queryByTestId("render-error")).toBeNull();
    expect(loaders.workspaceLoader).toHaveBeenCalledTimes(2);
    router.dispose();
  });

  it("shows the error on its own page outside the shell, with a retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    loaders.requireAnonLoader
      .mockRejectedValueOnce(new Error("loader failed"))
      .mockResolvedValue(null);
    const router = open("/login");

    expect(await screen.findByTestId("render-error")).toBeInTheDocument();
    expect(screen.queryByText("loader failed")).toBeNull();
    expect(screen.queryByTestId("shell-nav")).toBeNull();
    expect(screen.queryByText("Unexpected Application Error!")).toBeNull();

    await userEvent.click(screen.getByTestId("render-error-retry"));
    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    router.dispose();
  });
});

describe("An unknown address", () => {
  it("shows the not-found page outside the shell with a way back", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/no/such/page"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId("not-found-page")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-nav")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("not-found-workspace")).toHaveAttribute(
      "href",
      "/workspace",
    );
    router.dispose();
  });
});

describe("Inventory route revalidation", () => {
  it("keeps filter navigation mounted, but explicit revalidation still reaches the session gate", async () => {
    const path = `/organizations/${ORG}/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/inventory`;
    const route = allRoutes(routes).find(
      (candidate) =>
        candidate.path ===
        "/organizations/:organizationId/projects/:projectId/inventory",
    );
    if (route === undefined) throw new Error("inventory route not found");
    const loader = vi.fn(() => null);
    const router = createMemoryRouter([{ ...route, loader, element: null }], {
      initialEntries: [path + "?q=x"],
    });
    await settled(router);
    await act(() => router.navigate(path + "?q=Redis&page=2"));
    expect(loader).toHaveBeenCalledTimes(1);
    await act(() => router.navigate(-1));
    expect(loader).toHaveBeenCalledTimes(1);
    await act(() => router.revalidate());
    expect(loader).toHaveBeenCalledTimes(2);
    await act(() => router.navigate(path + "?arbitrary=1"));
    expect(loader).toHaveBeenCalledTimes(3);
    router.dispose();
  });
});
