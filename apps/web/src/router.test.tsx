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

  it("runs the loader for any other navigation", async () => {
    const { router, loader } = projectsRouter(`${PROJECTS}?create=1`);
    await settled(router);
    await act(() => router.navigate("/elsewhere"));
    await act(() => router.navigate(`${PROJECTS}?create=1`));
    expect(loader).toHaveBeenCalledTimes(2);
    router.dispose();
  });
});
