import { act } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { routes } from "./router";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECTS = `/organizations/${ORG}/projects`;

// The real Projects route with its loader counted, so the route's own shouldRevalidate is what runs.
function projectsRouter(entry: string) {
  const route = routes
    .flatMap((root) => root.children ?? [])
    .flatMap((layout) => layout.children ?? [])
    .find(
      (candidate) =>
        candidate.path === "/organizations/:organizationId/projects",
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
    const real = routes
      .flatMap((root) => root.children ?? [])
      .flatMap((layout) => layout.children ?? [])
      .filter((candidate) =>
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
