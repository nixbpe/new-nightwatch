import type {
  MeContextResponse,
  ProjectSummary,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  redirect,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMeContext } from "../../lib/api/me";
import {
  fetchLastProject,
  fetchProjectList,
  projectQueryKeys,
  rememberLastProject,
} from "../../lib/api/projects";
import {
  bindQueryClientIdentity,
  resetQueryClientRegistry,
} from "../../lib/queryClient";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { guardUnassignedNetwork } from "../../test/guard-network";
import { AppShell } from "./AppShell";

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({
      data: {
        user: { id: "user-1", email: "napat@example.com", name: "นภัส" },
      },
      isPending: false,
    }),
    signOut: vi.fn(),
    organization: { inviteMember: vi.fn() },
  }),
}));
vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectList: vi.fn(),
  fetchLastProject: vi.fn(),
  rememberLastProject: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(() =>
    Promise.resolve({
      summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
      monitors: [],
      page: { limit: 50, offset: 0, total: 0 },
      dataAsOf: "2026-10-02T05:00:00.000Z",
    }),
  ),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNotifications: () =>
    Promise.resolve({ items: [], nextCursor: null, unreadCount: 0 }),
  fetchUnreadCount: () => Promise.resolve({ unreadCount: 0 }),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchProjectListMock = vi.mocked(fetchProjectList);
const fetchLastProjectMock = vi.mocked(fetchLastProject);
const rememberLastProjectMock = vi.mocked(rememberLastProject);

guardUnassignedNetwork();

const ORG_A = "11111111-1111-4111-8111-111111111111";
const P_ALPHA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_BRAVO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_CHARLIE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const project = (
  id: string,
  name: string,
  myRole: ProjectSummary["myRole"],
): ProjectSummary => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  memberCount: 2,
  myRole,
  updatedAt: "2026-10-01T00:00:00.000Z",
});
const ALPHA = project(P_ALPHA, "Alpha", "admin");
const BRAVO = project(P_BRAVO, "Bravo", "member");
const CHARLIE = project(P_CHARLIE, "Charlie", null);

const ORG_B = "22222222-2222-4222-8222-222222222222";
const P_OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER = project(P_OTHER, "Delta", "member");

function meContext(
  role: "owner" | "viewer",
  secondOrgRole?: "owner" | "viewer",
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "นภัส",
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: true,
    },
    organizations: [
      { id: ORG_A, name: "Org A", slug: "org-a", role },
      ...(secondOrgRole === undefined
        ? []
        : [{ id: ORG_B, name: "Org B", slug: "org-b", role: secondOrgRole }]),
    ],
    lastActiveTenantId: ORG_A,
  };
}

// When set, the Project members route redirects there, as a route guard would.
let membersRedirect: string | null = null;

function Probe() {
  const location = useLocation();
  return <p data-testid="probe">{`${location.pathname}${location.search}`}</p>;
}

function renderShell({
  path = "/workspace",
  role = "owner",
  projects = [ALPHA, BRAVO, CHARLIE],
  last = P_BRAVO,
  lastFails = false,
  secondOrgRole,
  listGate,
}: {
  path?: string;
  role?: "owner" | "viewer";
  projects?: ProjectSummary[];
  last?: string | null;
  lastFails?: boolean;
  /** Adds Org B, whose only Project is Delta; Org A stays the active one. */
  secondOrgRole?: "owner" | "viewer";
  /** Holds every Project list fetch until it resolves. */
  listGate?: Promise<void>;
} = {}) {
  fetchMeContextMock.mockResolvedValue(meContext(role, secondOrgRole));
  fetchProjectListMock.mockImplementation(async (organizationId) => {
    await listGate;
    return { projects: organizationId === ORG_B ? [OTHER] : projects };
  });
  if (lastFails) fetchLastProjectMock.mockRejectedValue(new Error("down"));
  else fetchLastProjectMock.mockResolvedValue({ projectId: last });
  rememberLastProjectMock.mockImplementation((_org, projectId) =>
    Promise.resolve({ projectId }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  const router = createMemoryRouter(
    [
      {
        element: (
          <QueryClientProvider client={queryClient}>
            <TenantProvider>
              <AppShell />
            </TenantProvider>
          </QueryClientProvider>
        ),
        children: [
          { path: "/workspace", element: <Probe /> },
          {
            path: "/organizations/:organizationId/projects",
            element: <Probe />,
          },
          {
            path: "/organizations/:organizationId/projects/:projectId/members",
            loader: () =>
              membersRedirect === null ? null : redirect(membersRedirect),
            element: <Probe />,
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return { router, queryClient, ...render(<RouterProvider router={router} />) };
}

function mockNarrowViewport(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
      }) satisfies MediaQueryList,
  );
}

const membersPath = (projectId: string) =>
  `/organizations/${ORG_A}/projects/${projectId}/members`;

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("shell-project-switch"));
  return screen.getByTestId("shell-project-menu");
}

describe("ProjectSwitcher", () => {
  afterEach(() => {
    membersRedirect = null;
    fetchMeContextMock.mockReset();
    fetchProjectListMock.mockReset();
    fetchLastProjectMock.mockReset();
    rememberLastProjectMock.mockReset();
    vi.restoreAllMocks();
    resetQueryClientRegistry();
  });

  it("AC-01: opens a menu with search and the joined and not-joined groups for an Owner", async () => {
    const user = userEvent.setup();
    renderShell();
    const button = await screen.findByTestId("shell-project-switch");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");

    const menu = await openMenu(user);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("shell-project-search")).toHaveFocus();
    const joined = within(menu).getByRole("group", {
      name: "โปรเจกต์ที่เข้าร่วม",
    });
    expect(
      within(joined)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["ALAlphaalphaผู้ดูแล", "BRBravobravoสมาชิก"]);
    const other = within(menu).getByRole("group", { name: "ไม่ได้เข้าร่วม" });
    expect(within(other).getByRole("menuitemradio")).toHaveTextContent(
      "Charlie",
    );
  });

  it("AC-01: bounds the menu to the viewport; only the Project list scrolls, the search field and the links stay", async () => {
    const user = userEvent.setup();
    renderShell();
    await openMenu(user);
    const panel = screen.getByTestId("shell-project-menu-panel");
    const list = screen.getByTestId("shell-project-list");
    expect(panel).toHaveClass("max-h-[calc(100dvh-9rem)]", "flex-col");
    expect(list).toHaveClass("overflow-y-auto");
    expect(list).toContainElement(
      screen.getByTestId(`shell-project-option-${P_ALPHA}`),
    );
    for (const outside of [
      "shell-project-search",
      "shell-project-all",
      "shell-project-create",
    ]) {
      expect(list).not.toContainElement(screen.getByTestId(outside));
      expect(panel).toContainElement(screen.getByTestId(outside));
    }
  });

  it("AC-01: hides the not-joined group and the create link from a role below Admin", async () => {
    const user = userEvent.setup();
    renderShell({ role: "viewer" });
    const menu = await openMenu(user);
    expect(
      within(menu).queryByRole("group", { name: "ไม่ได้เข้าร่วม" }),
    ).toBeNull();
    expect(within(menu).queryByText("Charlie")).toBeNull();
    expect(screen.queryByTestId("shell-project-create")).toBeNull();
    expect(screen.getByTestId("shell-project-all")).toBeInTheDocument();
  });

  it("AC-01: search narrows by name or slug and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderShell();
    const menu = await openMenu(user);
    await user.type(screen.getByTestId("shell-project-search"), "brav");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(1);
    await user.clear(screen.getByTestId("shell-project-search"));
    await user.type(screen.getByTestId("shell-project-search"), "zzz");
    expect(within(menu).queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(within(menu).getByText("ไม่พบโปรเจกต์")).toBeInTheDocument();
  });

  it("AC-02: the current Project is the checked radio with the primary tint", async () => {
    const user = userEvent.setup();
    renderShell();
    const menu = await openMenu(user);
    const current = within(menu).getByTestId(`shell-project-option-${P_BRAVO}`);
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(current).toHaveClass("bg-primary-tint");
    expect(current.querySelector("svg")).not.toBeNull();
    const other = within(menu).getByTestId(`shell-project-option-${P_ALPHA}`);
    expect(other).toHaveAttribute("aria-checked", "false");
    expect(other.querySelector("svg")).toBeNull();
  });

  it("AC-03: arrows move through the items, Enter opens one, Escape closes and refocuses the button", async () => {
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveTextContent("Alpha");
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("shell-project-search")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId(`shell-project-option-${P_ALPHA}`)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId(`shell-project-option-${P_BRAVO}`)).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByTestId("shell-project-search")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("shell-project-menu")).toBeNull();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_BRAVO),
      );
    });
    expect(rememberLastProjectMock).toHaveBeenCalledWith(
      ORG_A,
      P_BRAVO,
      expect.any(String),
    );
  });

  it("AC-04: switching on a Project page opens the same page of the new Project and remembers it", async () => {
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    await openMenu(user);
    await user.click(screen.getByTestId(`shell-project-option-${P_BRAVO}`));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_BRAVO),
      );
    });
    // Landing on Alpha's page saved Alpha; landing on Bravo's saves Bravo.
    await waitFor(() => {
      expect(rememberLastProjectMock.mock.calls).toEqual([
        [ORG_A, P_ALPHA, expect.any(String)],
        [ORG_A, P_BRAVO, expect.any(String)],
      ]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Bravo",
      );
    });
    expect(screen.getByTestId("shell-project-switch")).toHaveFocus();
  });

  it("AC-04: switching from a page outside any Project lands on the new Project's members page", async () => {
    const user = userEvent.setup();
    renderShell({ path: "/workspace" });
    await openMenu(user);
    await user.click(screen.getByTestId(`shell-project-option-${P_ALPHA}`));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_ALPHA),
      );
    });
  });

  it("AC-04: choosing the current Project changes nothing", async () => {
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    await openMenu(user);
    await user.click(screen.getByTestId(`shell-project-option-${P_ALPHA}`));
    expect(screen.getByTestId("probe")).toHaveTextContent(membersPath(P_ALPHA));
    expect(rememberLastProjectMock.mock.calls).toEqual([
      [ORG_A, P_ALPHA, expect.any(String)],
    ]);
    expect(screen.queryByTestId("shell-project-menu")).toBeNull();
  });

  it("AC-06: landing on a Project route saves it once, however often the shell renders", async () => {
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    await waitFor(() => {
      expect(rememberLastProjectMock).toHaveBeenCalledExactlyOnceWith(
        ORG_A,
        P_ALPHA,
        expect.any(String),
      );
    });
    // Opening and closing the menu re-renders the shell; nothing is sent again.
    await openMenu(user);
    await user.keyboard("{Escape}");
    expect(rememberLastProjectMock).toHaveBeenCalledTimes(1);
  });

  describe("AC-06: saves are serialized", () => {
    type Save = {
      organizationId: string;
      projectId: string;
      selectedAt: string;
      settle: (outcome: "ok" | "fail", storedId?: string) => void;
    };
    // Every save waits until the test settles it.
    function deferSaves(): Save[] {
      const saves: Save[] = [];
      rememberLastProjectMock.mockImplementation(
        (organizationId, projectId, selectedAt) =>
          new Promise((resolve, reject) => {
            saves.push({
              organizationId,
              projectId,
              selectedAt,
              settle: (outcome, storedId = projectId) => {
                if (outcome === "ok") resolve({ projectId: storedId });
                else reject(new Error("down"));
              },
            });
          }),
      );
      return saves;
    }
    const sentIds = (saves: Save[]) => saves.map((save) => save.projectId);
    const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
    const cached = (view: ReturnType<typeof renderShell>) =>
      view.queryClient.getQueryData(projectQueryKeys.last(ORG_A));

    it("holds the next save until the one in flight settles, and the cache ends on the newest", async () => {
      // Nothing remembered yet, so only a save can put a Project in the cache.
      const view = renderShell({ path: "/workspace", last: null });
      const saves = deferSaves();
      await view.router.navigate(membersPath(P_ALPHA));
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA]);
      });
      await view.router.navigate(membersPath(P_BRAVO));
      await settled();
      expect(sentIds(saves)).toEqual([P_ALPHA]);

      saves[0]?.settle("ok");
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA, P_BRAVO]);
      });
      // The earlier reply does not take the cache from the newer Project.
      expect(cached(view)).not.toEqual({ projectId: P_ALPHA });
      saves[1]?.settle("ok");
      await waitFor(() => {
        expect(cached(view)).toEqual({ projectId: P_BRAVO });
      });
    });

    it("a queued save keeps the time of its landing, and the cache follows the stored Project in the reply", async () => {
      const clock = vi.spyOn(Date, "now");
      try {
        const view = renderShell({ path: "/workspace", last: null });
        const saves = deferSaves();
        clock.mockReturnValue(Date.parse("2026-10-12T10:00:00.000Z"));
        await view.router.navigate(membersPath(P_ALPHA));
        await waitFor(() => {
          expect(sentIds(saves)).toEqual([P_ALPHA]);
        });
        clock.mockReturnValue(Date.parse("2026-10-12T10:00:05.000Z"));
        await view.router.navigate(membersPath(P_BRAVO));
        await waitFor(() => {
          expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
            "Bravo",
          );
        });
        // The save of Bravo is sent a minute after the landing on it.
        clock.mockReturnValue(Date.parse("2026-10-12T10:01:00.000Z"));
        saves[0]?.settle("ok");
        await waitFor(() => {
          expect(sentIds(saves)).toEqual([P_ALPHA, P_BRAVO]);
        });
        expect(saves.map((save) => save.selectedAt)).toEqual([
          "2026-10-12T10:00:00.000Z",
          "2026-10-12T10:00:05.000Z",
        ]);
        // Another tab stored Charlie after this landing; the reply says so.
        saves[1]?.settle("ok", P_CHARLIE);
        await waitFor(() => {
          expect(cached(view)).toEqual({ projectId: P_CHARLIE });
        });
      } finally {
        clock.mockRestore();
      }
    });

    it("the save keeps the time the route changed to the Project, not the time the list validated it", async () => {
      const clock = vi.spyOn(Date, "now");
      try {
        let openList: () => void = () => undefined;
        const listGate = new Promise<void>((resolve) => {
          openList = resolve;
        });
        clock.mockReturnValue(Date.parse("2026-10-12T10:00:00.000Z"));
        const view = renderShell({ path: "/workspace", last: null, listGate });
        const saves = deferSaves();
        clock.mockReturnValue(Date.parse("2026-10-12T10:00:05.000Z"));
        await view.router.navigate(membersPath(P_BRAVO));
        await settled();
        expect(saves).toEqual([]);
        // The list is slow; another tab could land and save in the meantime.
        clock.mockReturnValue(Date.parse("2026-10-12T10:01:00.000Z"));
        openList();
        await waitFor(() => {
          expect(sentIds(saves)).toEqual([P_BRAVO]);
        });
        expect(saves[0]?.selectedAt).toBe("2026-10-12T10:00:05.000Z");
      } finally {
        clock.mockRestore();
      }
    });

    it("a route to a Project outside the list sends nothing, even once the list arrives", async () => {
      let openList: () => void = () => undefined;
      const listGate = new Promise<void>((resolve) => {
        openList = resolve;
      });
      const view = renderShell({ path: "/workspace", last: null, listGate });
      const saves = deferSaves();
      await view.router.navigate(membersPath(P_OTHER));
      openList();
      await settled();
      expect(saves).toEqual([]);
    });

    it("two landings in the same millisecond get increasing times", async () => {
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValue(Date.parse("2026-10-12T10:00:00.000Z"));
      try {
        const view = renderShell({ path: "/workspace", last: null });
        const saves = deferSaves();
        await view.router.navigate(membersPath(P_ALPHA));
        await waitFor(() => {
          expect(sentIds(saves)).toEqual([P_ALPHA]);
        });
        await view.router.navigate(membersPath(P_BRAVO));
        await waitFor(() => {
          expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
            "Bravo",
          );
        });
        saves[0]?.settle("ok");
        await waitFor(() => {
          expect(sentIds(saves)).toEqual([P_ALPHA, P_BRAVO]);
        });
        const [first, second] = saves.map((save) =>
          Date.parse(save.selectedAt),
        );
        expect(second).toBeGreaterThan(first ?? Infinity);
      } finally {
        clock.mockRestore();
      }
    });

    it("sends only the latest target after the one in flight", async () => {
      const view = renderShell({ path: "/workspace", last: null });
      const saves = deferSaves();
      await view.router.navigate(membersPath(P_ALPHA));
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA]);
      });
      for (const [path, name] of [
        [membersPath(P_BRAVO), "Bravo"],
        [membersPath(P_CHARLIE), "Charlie"],
      ] as const) {
        await view.router.navigate(path);
        // The shell has rendered this Project, so its target was seen before the next one.
        await waitFor(() => {
          expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
            name,
          );
        });
      }
      await settled();
      expect(sentIds(saves)).toEqual([P_ALPHA]);
      saves[0]?.settle("ok");
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA, P_CHARLIE]);
      });
      await settled();
      expect(sentIds(saves)).toEqual([P_ALPHA, P_CHARLIE]);
    });

    it("a shell retired by an identity change sends nothing more and writes no cache", async () => {
      const view = renderShell({ path: "/workspace", last: null });
      const saves = deferSaves();
      await view.router.navigate(membersPath(P_ALPHA));
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA]);
      });
      await view.router.navigate(membersPath(P_BRAVO));
      await waitFor(() => {
        expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
          "Bravo",
        );
      });
      // SessionQueryProvider remounts its subtree (key = epoch) when the identity changes.
      view.unmount();
      saves[0]?.settle("ok");
      await settled();
      expect(sentIds(saves)).toEqual([P_ALPHA]);
      // Still the fetched "nothing remembered"; the retired instance wrote nothing.
      expect(cached(view)).toEqual({ projectId: null });
    });

    it("a last-Project read started while the save is pending cannot bring the previous Project back", async () => {
      const view = renderShell({ path: "/workspace", last: P_ALPHA });
      await waitFor(() => {
        expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
          "Alpha",
        );
      });
      const saves = deferSaves();
      // The first read keeps its fixture; the next one (on leaving Project scope) is held
      // and reads the previous Project; later reads see what the server stored.
      let reads = 0;
      let answerStale: (() => void) | undefined;
      fetchLastProjectMock.mockImplementation(() => {
        reads += 1;
        if (reads === 1)
          return new Promise((resolve) => {
            answerStale = () => {
              resolve({ projectId: P_ALPHA });
            };
          });
        return Promise.resolve({ projectId: P_BRAVO });
      });
      await view.router.navigate(membersPath(P_BRAVO));
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_BRAVO]);
      });
      await view.router.navigate("/workspace");
      await waitFor(() => {
        expect(reads).toBe(1);
      });

      saves[0]?.settle("ok");
      await waitFor(() => {
        expect(cached(view)).toEqual({ projectId: P_BRAVO });
      });
      answerStale?.();
      await settled();
      expect(cached(view)).toEqual({ projectId: P_BRAVO });
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Bravo",
      );
    });

    it("sends the waiting save after a failed one, without an error", async () => {
      const view = renderShell({ path: "/workspace", last: null });
      const saves = deferSaves();
      await view.router.navigate(membersPath(P_ALPHA));
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA]);
      });
      await view.router.navigate(membersPath(P_BRAVO));
      saves[0]?.settle("fail");
      await waitFor(() => {
        expect(sentIds(saves)).toEqual([P_ALPHA, P_BRAVO]);
      });
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("AC-06: each landing on a Project is saved", () => {
    async function leaveAndReturn(
      view: ReturnType<typeof renderShell>,
      projectId: string,
    ) {
      await view.router.navigate("/workspace");
      await waitFor(() => {
        expect(screen.getByTestId("probe")).toHaveTextContent("/workspace");
      });
      await view.router.navigate(membersPath(projectId));
    }

    it("sends a Project again on return after its save failed", async () => {
      const view = renderShell({ path: "/workspace", last: null });
      rememberLastProjectMock.mockRejectedValueOnce(new Error("down"));
      await view.router.navigate(membersPath(P_BRAVO));
      await waitFor(() => {
        expect(rememberLastProjectMock).toHaveBeenCalledTimes(1);
      });
      await leaveAndReturn(view, P_BRAVO);
      await waitFor(() => {
        expect(rememberLastProjectMock).toHaveBeenCalledTimes(2);
      });
      expect(rememberLastProjectMock).toHaveBeenLastCalledWith(
        ORG_A,
        P_BRAVO,
        expect.any(String),
      );
      await waitFor(() => {
        expect(
          view.queryClient.getQueryData(projectQueryKeys.last(ORG_A)),
        ).toEqual({ projectId: P_BRAVO });
      });
    });

    it("sends a Project again on return after its save succeeded", async () => {
      const view = renderShell({ path: "/workspace", last: null });
      await view.router.navigate(membersPath(P_BRAVO));
      await waitFor(() => {
        expect(rememberLastProjectMock).toHaveBeenCalledTimes(1);
      });
      await leaveAndReturn(view, P_BRAVO);
      await waitFor(() => {
        expect(rememberLastProjectMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  it("AC-06: nothing is saved outside a Project route, or for a Project missing from the list", async () => {
    renderShell({ path: "/workspace" });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Bravo",
      );
    });
    expect(rememberLastProjectMock).not.toHaveBeenCalled();
    cleanup();
    renderShell({ path: membersPath(crypto.randomUUID()) });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "เลือกโปรเจกต์",
      );
    });
    expect(rememberLastProjectMock).not.toHaveBeenCalled();
  });

  it("AC-06: a failed save is silent and the switch still happens", async () => {
    const user = userEvent.setup();
    renderShell({ path: "/workspace" });
    await openMenu(user);
    rememberLastProjectMock.mockRejectedValueOnce(new Error("gone"));
    await user.click(screen.getByTestId(`shell-project-option-${P_ALPHA}`));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_ALPHA),
      );
      expect(rememberLastProjectMock).toHaveBeenCalledWith(
        ORG_A,
        P_ALPHA,
        expect.any(String),
      );
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("AC-05: links to all Projects and, for an Owner, to the create dialog", async () => {
    const user = userEvent.setup();
    renderShell();
    await openMenu(user);
    expect(screen.getByTestId("shell-project-all")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/projects`,
    );
    expect(screen.getByTestId("shell-project-create")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/projects?create=1`,
    );
    await user.click(screen.getByTestId("shell-project-create"));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        `/organizations/${ORG_A}/projects?create=1`,
      );
    });
    expect(screen.getByTestId("shell-project-switch")).toHaveFocus();
  });

  it("AC-06: a Project in the URL is current and the server's last Project is not asked for", async () => {
    renderShell({ path: membersPath(P_ALPHA), last: P_BRAVO });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveTextContent("Alpha");
    });
    expect(fetchLastProjectMock).not.toHaveBeenCalled();
  });

  it("AC-06: outside a Project the server's resolved Project is current", async () => {
    renderShell({ path: "/workspace", last: P_BRAVO });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveTextContent("Bravo");
    });
    expect(fetchLastProjectMock).toHaveBeenCalledWith(ORG_A);
    expect(screen.getByTestId("shell-project-navigation")).toHaveTextContent(
      "สมาชิกโปรเจกต์",
    );
  });

  it("AC-06: with no Project the switcher links to the projects page and the Project leaves stay out", async () => {
    renderShell({ projects: [], last: null });
    const empty = await screen.findByTestId("shell-project-empty");
    expect(empty).toHaveAttribute("href", `/organizations/${ORG_A}/projects`);
    expect(empty).toHaveTextContent("ยังไม่มีโปรเจกต์");
    expect(screen.queryByTestId("shell-project-switch")).toBeNull();
    expect(screen.queryByTestId("shell-project-navigation")).toBeNull();
  });

  it("a Project id in upper case in the URL is the same Project: current, in the nav and breadcrumb, and saved once in lower case", async () => {
    renderShell({ path: membersPath(P_ALPHA.toUpperCase()) });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveTextContent("Alpha");
    });
    const link = screen.getByTestId(
      "shell-nav-/organizations/:organizationId/projects/:projectId/members",
    );
    expect(link).toHaveAttribute("href", membersPath(P_ALPHA));
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      within(screen.getByTestId("shell-breadcrumb"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Org A", "Alpha", "สมาชิกโปรเจกต์"]);
    await waitFor(() => {
      expect(rememberLastProjectMock).toHaveBeenCalledTimes(1);
    });
    expect(rememberLastProjectMock).toHaveBeenCalledWith(
      ORG_A,
      P_ALPHA,
      expect.any(String),
    );
  });

  it("upper-case static segments name the same Project: current, in the nav and breadcrumb, and saved once in lower case", async () => {
    renderShell({
      path: `/ORGANIZATIONS/${ORG_A}/PROJECTS/${P_ALPHA.toUpperCase()}/MEMBERS`,
    });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveTextContent("Alpha");
    });
    const link = screen.getByTestId(
      "shell-nav-/organizations/:organizationId/projects/:projectId/members",
    );
    expect(link).toHaveAttribute("href", membersPath(P_ALPHA));
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      within(screen.getByTestId("shell-breadcrumb"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Org A", "Alpha", "สมาชิกโปรเจกต์"]);
    await waitFor(() => {
      expect(rememberLastProjectMock).toHaveBeenCalledTimes(1);
    });
    expect(rememberLastProjectMock).toHaveBeenCalledWith(
      ORG_A,
      P_ALPHA,
      expect.any(String),
    );
  });

  describe("a bookmarked Project of another Organization the user belongs to", () => {
    const otherPath = `/organizations/${ORG_B}/projects/${P_OTHER}/members`;

    it("is the current Project, saved under its own Organization, with the breadcrumb and nav of that Organization", async () => {
      renderShell({ path: otherPath, secondOrgRole: "viewer" });
      const button = await screen.findByTestId("shell-project-switch");
      await waitFor(() => {
        expect(button).toHaveTextContent("Delta");
      });
      await waitFor(() => {
        expect(rememberLastProjectMock).toHaveBeenCalledExactlyOnceWith(
          ORG_B,
          P_OTHER,
          expect.any(String),
        );
      });
      expect(
        within(screen.getByTestId("shell-breadcrumb"))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Org B", "Delta", "สมาชิกโปรเจกต์"]);
      expect(
        screen.getByTestId(
          "shell-nav-/organizations/:organizationId/projects/:projectId/members",
        ),
      ).toHaveAttribute("href", otherPath);
      expect(
        screen.getByTestId(
          "shell-nav-/organizations/:organizationId/projects/:projectId/members",
        ),
      ).toHaveAttribute("aria-current", "page");
      // No request pairs Org A with Org B's Project, and the active Organization's last Project is not asked for.
      expect(rememberLastProjectMock).not.toHaveBeenCalledWith(ORG_A, P_OTHER);
      expect(fetchLastProjectMock).not.toHaveBeenCalled();
      expect(fetchProjectListMock).not.toHaveBeenCalledWith(ORG_A);
    });

    it("judges create rights by the role in that Organization, not the active one", async () => {
      const user = userEvent.setup();
      renderShell({ path: otherPath, role: "owner", secondOrgRole: "viewer" });
      await waitFor(() => {
        expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
          "Delta",
        );
      });
      await openMenu(user);
      expect(screen.queryByTestId("shell-project-create")).toBeNull();
      expect(screen.getByTestId("shell-project-all")).toHaveAttribute(
        "href",
        `/organizations/${ORG_B}/projects`,
      );
    });

    it("switches within that Organization", async () => {
      const user = userEvent.setup();
      renderShell({ path: otherPath, secondOrgRole: "owner" });
      await waitFor(() => {
        expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
          "Delta",
        );
      });
      await openMenu(user);
      expect(screen.getByTestId("shell-project-create")).toHaveAttribute(
        "href",
        `/organizations/${ORG_B}/projects?create=1`,
      );
    });
  });

  it("AC-06: a failed last-Project lookup shows the retry state, not an empty selection", async () => {
    const user = userEvent.setup();
    renderShell({ path: "/workspace", lastFails: true });
    const retry = await screen.findByTestId("shell-project-retry");
    expect(screen.queryByText("เลือกโปรเจกต์")).toBeNull();
    fetchLastProjectMock.mockResolvedValue({ projectId: P_BRAVO });
    await user.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Bravo",
      );
    });
  });

  it("AC-06: a failed Project list refetch replaces cached options with the retry state until a retry succeeds", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderShell({ path: membersPath(P_ALPHA) });
    await openMenu(user);
    expect(screen.getByTestId(`shell-project-option-${P_BRAVO}`)).toBeVisible();
    fetchProjectListMock.mockRejectedValue(new Error("down"));
    await queryClient.refetchQueries({
      queryKey: projectQueryKeys.list(ORG_A),
    });
    const retry = await screen.findByTestId("shell-project-retry");
    expect(screen.queryByTestId("shell-project-switch")).toBeNull();
    expect(screen.queryByTestId(`shell-project-option-${P_BRAVO}`)).toBeNull();
    fetchProjectListMock.mockResolvedValue({ projects: [ALPHA, BRAVO] });
    await user.click(retry);
    await user.click(await screen.findByTestId("shell-project-switch"));
    expect(screen.getByTestId(`shell-project-option-${P_BRAVO}`)).toBeVisible();
    expect(
      screen.queryByTestId(`shell-project-option-${P_CHARLIE}`),
    ).toBeNull();
  });

  it("AC-06: a failed last-Project refetch with a cached value shows the retry state and recovers", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderShell({ path: "/workspace" });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Bravo",
      );
    });
    fetchLastProjectMock.mockRejectedValue(new Error("down"));
    await queryClient.refetchQueries({
      queryKey: projectQueryKeys.last(ORG_A),
    });
    const retry = await screen.findByTestId("shell-project-retry");
    expect(screen.queryByText("Bravo")).toBeNull();
    expect(screen.queryByTestId("shell-project-navigation")).toBeNull();
    fetchLastProjectMock.mockResolvedValue({ projectId: P_ALPHA });
    await user.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Alpha",
      );
    });
  });

  it("AC-04: focus is not pulled back after a redirect, even when the destination is visited later", async () => {
    const user = userEvent.setup();
    const view = renderShell({ path: "/workspace" });
    membersRedirect = `/organizations/${ORG_A}/projects`;
    await openMenu(user);
    await user.click(screen.getByTestId(`shell-project-option-${P_ALPHA}`));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        `/organizations/${ORG_A}/projects`,
      );
    });
    membersRedirect = null;
    screen.getByTestId("shell-search-open").focus();
    await view.router.navigate(membersPath(P_ALPHA));
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_ALPHA),
      );
    });
    expect(screen.getByTestId("shell-search-open")).toHaveFocus();
  });

  it("AC-06: a URL naming a Project the user cannot see selects nothing", async () => {
    renderShell({ path: membersPath(crypto.randomUUID()) });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveTextContent("เลือกโปรเจกต์");
    });
    expect(screen.queryByTestId("shell-project-navigation")).toBeNull();
  });

  it("AC-06: a Project URL of an Organization the user is not in selects nothing and asks for no Project data", async () => {
    const ORG_C = "33333333-3333-4333-8333-333333333333";
    renderShell({
      path: `/organizations/${ORG_C}/projects/${P_ALPHA}/members`,
    });
    // The active Organization stays reachable through the empty state, which links to its projects page.
    const empty = await screen.findByTestId("shell-project-empty");
    expect(empty).toHaveAttribute("href", `/organizations/${ORG_A}/projects`);
    expect(screen.queryByTestId("shell-project-switch")).toBeNull();
    expect(screen.queryByTestId("shell-project-name")).toBeNull();
    expect(screen.queryByTestId("shell-project-navigation")).toBeNull();
    expect(
      within(screen.getByTestId("shell-breadcrumb")).queryByText("Alpha"),
    ).toBeNull();
    // Let any query or save that would be wrongly started settle before asserting it was not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchProjectListMock).not.toHaveBeenCalled();
    expect(fetchLastProjectMock).not.toHaveBeenCalled();
    expect(rememberLastProjectMock).not.toHaveBeenCalled();
  });

  it("AC-07: the breadcrumb reads Organization, Project, page on a Project route", async () => {
    renderShell({ path: membersPath(P_ALPHA) });
    const breadcrumb = await screen.findByTestId("shell-breadcrumb");
    await waitFor(() => {
      expect(within(breadcrumb).getAllByRole("listitem")).toHaveLength(3);
      expect(breadcrumb).toHaveTextContent("Alpha");
    });
    expect(
      within(breadcrumb)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Org A", "Alpha", "สมาชิกโปรเจกต์"]);
    expect(
      within(breadcrumb).getByTestId("shell-breadcrumb-current"),
    ).toHaveAttribute("aria-current", "page");
  });

  it("AC-07: the command palette finds the current Project's pages", async () => {
    const user = userEvent.setup();
    renderShell({ path: "/workspace", last: P_BRAVO });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveTextContent(
        "Bravo",
      );
    });
    await user.click(screen.getByTestId("shell-search-open"));
    await user.type(
      screen.getByTestId("shell-command-query"),
      "สมาชิกโปรเจกต์",
    );
    const option = await screen.findByTestId(
      `shell-command-option-${membersPath(P_BRAVO)}`,
    );
    expect(option).toHaveTextContent("โปรเจกต์");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_BRAVO),
      );
    });
  });

  it("AC-08: groups carry their scope and only the current Project's pages sit in the Project group", async () => {
    renderShell({ path: membersPath(P_ALPHA) });
    const nav = await screen.findByTestId("shell-navigation");
    await waitFor(() => {
      expect(within(nav).getByTestId("shell-project-navigation")).toBeVisible();
    });
    const scoped = (scope: string) =>
      within(nav)
        .getAllByRole("link")
        .filter((link) => link.closest(`[data-scope="${scope}"]`) !== null)
        .map((link) => link.getAttribute("data-testid"));
    expect(scoped("project")).toEqual([
      "shell-nav-/organizations/:organizationId/projects/:projectId/members",
    ]);
    expect(scoped("organization")).toEqual([
      "shell-nav-/organizations/:organizationId/projects",
      "shell-nav-/organizations/:organizationId/members",
      "shell-nav-/organizations/:organizationId/notification-settings",
      "shell-nav-/organizations/:organizationId/audit-log",
    ]);
    // The overview and the monitors stay top-level, above every group.
    const topLevel = within(nav)
      .getAllByRole("link")
      .filter((link) => link.closest("[data-scope]") === null)
      .map((link) => link.getAttribute("data-testid"));
    expect(topLevel).toEqual([
      "shell-nav-/workspace",
      "shell-nav-/organizations/:organizationId/monitors",
    ]);
    expect(scoped("personal")).toEqual([
      "shell-nav-/notifications",
      "shell-nav-/settings",
    ]);
    // The Project's members page is current; the organization's Project list above it is not.
    expect(
      within(nav).getByTestId(
        "shell-nav-/organizations/:organizationId/projects/:projectId/members",
      ),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByTestId(
        "shell-nav-/organizations/:organizationId/projects",
      ),
    ).not.toHaveAttribute("aria-current");
  });

  it("AC-09: the rail shows the Project as its initials and still opens the menu", async () => {
    mockNarrowViewport();
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    const button = await screen.findByTestId("shell-project-switch");
    await waitFor(() => {
      expect(button).toHaveAccessibleName("โปรเจกต์: Alpha");
    });
    expect(button).toHaveTextContent("AL");
    expect(button).not.toHaveTextContent("Alpha");
    await user.click(button);
    expect(screen.getByTestId("shell-project-menu")).toBeInTheDocument();
  });

  it("AC-09: inside the drawer Escape closes the menu first, then the drawer", async () => {
    mockNarrowViewport();
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveAccessibleName(
        "โปรเจกต์: Alpha",
      );
    });
    await user.click(screen.getByTestId("shell-mobile-open"));
    const drawer = screen.getByTestId("shell-mobile-menu");
    const button = within(drawer).getByTestId("shell-project-switch");
    expect(button).toHaveTextContent("Alpha");
    await user.click(button);
    expect(within(drawer).getByTestId("shell-project-menu")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(within(drawer).queryByTestId("shell-project-menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(screen.getByTestId("shell-mobile-menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("shell-mobile-menu")).toBeNull();
    });
  });

  it("AC-09: choosing a Project in the drawer navigates and closes the drawer", async () => {
    mockNarrowViewport();
    const user = userEvent.setup();
    renderShell({ path: membersPath(P_ALPHA) });
    await waitFor(() => {
      expect(screen.getByTestId("shell-project-switch")).toHaveAccessibleName(
        "โปรเจกต์: Alpha",
      );
    });
    await user.click(screen.getByTestId("shell-mobile-open"));
    const drawer = screen.getByTestId("shell-mobile-menu");
    await user.click(within(drawer).getByTestId("shell-project-switch"));
    await user.click(
      within(drawer).getByTestId(`shell-project-option-${P_BRAVO}`),
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        membersPath(P_BRAVO),
      );
      expect(screen.queryByTestId("shell-mobile-menu")).toBeNull();
    });
  });
});
