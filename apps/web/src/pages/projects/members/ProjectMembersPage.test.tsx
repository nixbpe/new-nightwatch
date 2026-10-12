import { guardUnassignedNetwork } from "../../../test/guard-network";
import { bindQueryClientIdentity } from "../../../lib/queryClient";
import type {
  MeContextResponse,
  ProjectDetail,
  ProjectMember,
  ProjectMemberCandidate,
  ProjectRole,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../../lib/api/me";
import {
  addProjectMembers,
  fetchProjectDetail,
  fetchProjectList,
  fetchProjectMemberCandidates,
  fetchProjectMembers,
  projectQueryKeys,
  removeProjectMember,
  updateProjectMemberRole,
} from "../../../lib/api/projects";
import { TenantProvider, useTenant } from "../../../lib/tenant/TenantProvider";
import { ProjectsPage } from "../ProjectsPage";
import { PROJECT_GONE_NOTICE, ProjectMembersPage } from "./ProjectMembersPage";

guardUnassignedNetwork();

vi.mock("../../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectDetail: vi.fn(),
  fetchProjectList: vi.fn(),
  fetchProjectMembers: vi.fn(),
  fetchProjectMemberCandidates: vi.fn(),
  addProjectMembers: vi.fn(),
  updateProjectMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
}));

const meMock = vi.mocked(fetchMeContext);
const detailMock = vi.mocked(fetchProjectDetail);
const listMock = vi.mocked(fetchProjectList);
const membersMock = vi.mocked(fetchProjectMembers);
const candidatesMock = vi.mocked(fetchProjectMemberCandidates);
const addMock = vi.mocked(addProjectMembers);
const patchMock = vi.mocked(updateProjectMemberRole);
const removeMock = vi.mocked(removeProjectMember);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "00000000-0000-4000-8000-000000000001";

type OrgRole = "owner" | "admin" | "viewer" | "auditor";

const ME = "user-me";
function context(role: OrgRole): MeContextResponse {
  return {
    user: {
      id: ME,
      name: "Somchai",
      email: "somchai@example.test",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [{ id: A, name: "Acme", slug: "acme", role }],
    lastActiveTenantId: A,
  };
}

function member(
  userId: string,
  projectRole: ProjectRole,
  organizationRole: OrgRole = "viewer",
): ProjectMember {
  return {
    userId,
    name: `Name ${userId}`,
    email: `${userId}@example.test`,
    organizationRole,
    projectRole,
    joinedAt: "2026-08-04T03:00:00.000Z",
  };
}

// The fake server: mutations change it, so refetches show persisted state.
let roster: ProjectMember[];
let orgPeople: { userId: string; name: string; organizationRole: OrgRole }[];
let myRole: ProjectRole | null;

function snapshot(): ProjectDetail {
  return {
    id: P,
    name: "Payments Platform",
    slug: "payments-platform",
    description: null,
    memberCount: roster.length,
    adminCount: roster.filter((item) => item.projectRole === "admin").length,
    myRole,
    updatedAt: "2026-10-10T07:32:00.000Z",
  };
}

const queryClients: QueryClient[] = [];
afterEach(async () => {
  cleanup();
  for (const queryClient of queryClients.splice(0)) {
    await queryClient.cancelQueries();
    queryClient.clear();
  }
  vi.resetAllMocks();
});
beforeEach(() => {
  listMock.mockResolvedValue({ projects: [] });
  meMock.mockResolvedValue(context("owner"));
  myRole = "admin";
  roster = [
    { ...member(ME, "admin", "owner"), name: "Somchai" },
    member("siriporn", "admin", "admin"),
    member("thanakorn", "member"),
  ];
  orgPeople = [
    { userId: ME, name: "Somchai", organizationRole: "owner" },
    { userId: "siriporn", name: "Name siriporn", organizationRole: "admin" },
    { userId: "thanakorn", name: "Name thanakorn", organizationRole: "viewer" },
    { userId: "kitti", name: "Kitti", organizationRole: "viewer" },
    { userId: "napa", name: "Napa", organizationRole: "admin" },
    { userId: "pakorn", name: "Pakorn", organizationRole: "auditor" },
  ];
  detailMock.mockImplementation(() => Promise.resolve(snapshot()));
  membersMock.mockImplementation(() =>
    Promise.resolve({ members: structuredClone(roster) }),
  );
  candidatesMock.mockImplementation((_org, _project, q) => {
    const needle = q.toLowerCase();
    const candidates: ProjectMemberCandidate[] = orgPeople
      .filter(
        (person) =>
          needle === "" ||
          person.name.toLowerCase().includes(needle) ||
          `${person.userId}@example.test`.includes(needle),
      )
      .map((person) => ({
        userId: person.userId,
        name: person.name,
        email: `${person.userId}@example.test`,
        organizationRole: person.organizationRole,
        projectRole:
          roster.find((item) => item.userId === person.userId)?.projectRole ??
          null,
      }));
    return Promise.resolve({ candidates });
  });
});

let lastQueryClient: QueryClient;
function renderPage(organizationId = A) {
  // The app's 30 s staleTime: a cached list is not refetched on mount by itself.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  lastQueryClient = queryClient;
  bindQueryClientIdentity(queryClient, ME);
  queryClients.push(queryClient);
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/members",
        element: <ProjectMembersPage />,
      },
      {
        path: "/organizations/:organizationId/projects",
        element: <ProjectsPage />,
      },
    ],
    {
      initialEntries: [
        `/organizations/${organizationId}/projects/${P}/members`,
      ],
    },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <RouterProvider router={router} />
      </TenantProvider>
    </QueryClientProvider>,
  );
}

const row = (userId: string) =>
  screen.getByTestId(`project-member-row-${userId}`);
const select = (userId: string) =>
  within(row(userId)).getByTestId("project-member-role-select");

async function loaded() {
  await screen.findByTestId("project-members-table");
}

describe("members list", () => {
  it("shows name, email, (คุณ), organization role, project role and join date", async () => {
    renderPage();
    await loaded();
    const mine = row(ME);
    expect(within(mine).getByTestId("project-member-name")).toHaveTextContent(
      "Somchai",
    );
    expect(within(mine).getByTestId("project-member-self")).toBeInTheDocument();
    expect(
      within(row("siriporn")).queryByTestId("project-member-self"),
    ).toBeNull();
    expect(
      within(row("thanakorn")).getByTestId("project-member-email"),
    ).toHaveTextContent("thanakorn@example.test");
    expect(
      within(mine).getByTestId("project-member-organization-role"),
    ).toHaveAttribute("data-organization-role", "owner");
    expect(select("siriporn")).toHaveValue("admin");
    expect(select("thanakorn")).toHaveValue("member");
    expect(
      within(mine).getByTestId("project-member-joined-at"),
    ).toHaveTextContent(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByTestId("project-member-count")).toHaveTextContent("3");
    expect(screen.getByTestId("project-admin-count")).toHaveTextContent("2");
    expect(screen.getByTestId("project-slug")).toHaveTextContent(
      "payments-platform",
    );
  });

  it("filters by name or email in the browser", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await user.type(screen.getByTestId("project-members-search"), "THANA");
    expect(screen.queryByTestId(`project-member-row-siriporn`)).toBeNull();
    expect(row("thanakorn")).toBeInTheDocument();
    expect(screen.getByTestId("project-members-shown")).toHaveTextContent(
      "แสดง 1–1 จาก 3",
    );
    await user.clear(screen.getByTestId("project-members-search"));
    await user.type(screen.getByTestId("project-members-search"), "zzz");
    expect(screen.getByTestId("project-members-no-results")).toBeVisible();
  });

  it("states the role descriptions and both rules (AC-11)", async () => {
    renderPage();
    await loaded();
    const panel = screen.getByTestId("project-roles-panel");
    expect(
      within(panel).getByTestId("project-role-description-admin"),
    ).toHaveTextContent(
      "เพิ่มและนำสมาชิกออก เปลี่ยนบทบาท และแก้ไขการตั้งค่าโปรเจกต์",
    );
    expect(
      within(panel).getByTestId("project-role-description-member"),
    ).toHaveTextContent("ดูและทำงานในโปรเจกต์ จัดการสมาชิกไม่ได้");
    expect(
      within(panel).getByTestId("project-rule-last-admin"),
    ).toHaveTextContent(
      "ต้องมีผู้ดูแลอย่างน้อย 1 คน ระบบไม่ให้เปลี่ยนบทบาทหรือนำผู้ดูแลคนสุดท้ายออก",
    );
    expect(
      within(panel).getByTestId("project-rule-organization-only"),
    ).toHaveTextContent("เพิ่มได้เฉพาะคนที่เป็นสมาชิกขององค์กร Acme อยู่แล้ว");
    expect(
      within(panel).getByTestId("project-members-organization-link"),
    ).toHaveAttribute("href", `/organizations/${A}/members`);
  });
});

describe("who can manage", () => {
  it("gives a project member text roles and no controls (AC-07)", async () => {
    meMock.mockResolvedValue(context("viewer"));
    myRole = "member";
    renderPage();
    await loaded();
    expect(screen.queryByTestId("project-members-add")).toBeNull();
    expect(screen.queryByTestId("project-member-role-select")).toBeNull();
    expect(screen.queryByTestId("project-member-remove")).toBeNull();
    expect(
      within(row("siriporn")).getByTestId("project-member-role"),
    ).toHaveAttribute("data-project-role", "admin");
    expect(screen.getByTestId("project-my-role")).toHaveAttribute(
      "data-project-role",
      "member",
    );
  });

  it("gives an organization admin outside the project the controls (AC-09)", async () => {
    meMock.mockResolvedValue(context("admin"));
    myRole = null;
    roster = roster.filter((item) => item.userId !== ME);
    renderPage();
    await loaded();
    expect(screen.getByTestId("project-my-role")).toHaveAttribute(
      "data-project-role",
      "none",
    );
    expect(screen.getByTestId("project-members-add")).toBeEnabled();
    expect(select("thanakorn")).toBeEnabled();
    expect(
      within(row("thanakorn")).getByTestId("project-member-remove"),
    ).toBeEnabled();
  });

  it("gives a project admin who is only an organization viewer the controls, without the organization members link", async () => {
    meMock.mockResolvedValue(context("viewer"));
    renderPage();
    await loaded();
    expect(screen.getByTestId("project-members-add")).toBeEnabled();
    expect(
      screen.queryByTestId("project-members-organization-link"),
    ).toBeNull();
  });
});

describe("states", () => {
  it("clears the Project's cached queries and returns to the list with a notice on 404 (AC-05)", async () => {
    const error = new ApiError("PROJECT_NOT_FOUND", "missing", 404);
    detailMock.mockRejectedValue(error);
    membersMock.mockRejectedValue(error);
    renderPage();
    expect(
      await screen.findByTestId("projects-notice-role-changed"),
    ).toHaveTextContent(PROJECT_GONE_NOTICE);
    expect(screen.queryByTestId("project-members-table")).toBeNull();
    expect(
      lastQueryClient.getQueryCache().findAll({
        queryKey: projectQueryKeys.project(A, P),
      }),
    ).toEqual([]);
  });

  it("returns to the list when a demotion makes a later request answer 404 (AC-05)", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    expect(
      lastQueryClient.getQueryCache().findAll({
        queryKey: projectQueryKeys.project(A, P),
      }),
    ).not.toEqual([]);
    const gone = new ApiError("PROJECT_NOT_FOUND", "missing", 404);
    patchMock.mockRejectedValue(gone);
    detailMock.mockRejectedValue(gone);
    membersMock.mockRejectedValue(gone);
    await user.selectOptions(select("thanakorn"), "admin");
    expect(
      await screen.findByTestId("projects-notice-role-changed"),
    ).toBeVisible();
    expect(
      lastQueryClient.getQueryCache().findAll({
        queryKey: projectQueryKeys.project(A, P),
      }),
    ).toEqual([]);
  });

  it("refetches a cached list that still holds the lost Project, so its row is gone (AC-03, AC-05)", async () => {
    renderPage();
    await loaded();
    const stale = {
      id: P,
      name: "Payments Platform",
      slug: "payments-platform",
      description: null,
      memberCount: 2,
      myRole: null,
      updatedAt: "2026-10-10T07:32:00.000Z",
    };
    lastQueryClient.setQueryData(projectQueryKeys.list(A), {
      projects: [stale],
    });
    const contextCalls = meMock.mock.calls.length;
    const gone = new ApiError("PROJECT_NOT_FOUND", "missing", 404);
    detailMock.mockRejectedValue(gone);
    membersMock.mockRejectedValue(gone);
    // A plain refetch, not a failed write: nothing else invalidates the list.
    await act(async () => {
      await lastQueryClient.refetchQueries({
        queryKey: projectQueryKeys.detail(A, P),
      });
    });
    expect(await screen.findByTestId("projects-empty-first-run")).toBeVisible();
    expect(screen.queryByTestId(`project-row-${P}`)).toBeNull();
    expect(listMock).toHaveBeenCalled();
    expect(meMock.mock.calls.length).toBeGreaterThan(contextCalls);
  });

  it("does not cancel a navigation the user started while the context reload was pending", async () => {
    const gone = new ApiError("PROJECT_NOT_FOUND", "missing", 404);
    detailMock.mockRejectedValue(gone);
    membersMock.mockRejectedValue(gone);
    let finishReload: (value: MeContextResponse) => void = () => undefined;
    meMock.mockResolvedValueOnce(context("owner"));
    meMock.mockImplementationOnce(
      () =>
        new Promise<MeContextResponse>((resolve) => {
          finishReload = resolve;
        }),
    );
    let finishLoader: (value: null) => void = () => undefined;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    bindQueryClientIdentity(queryClient, ME);
    queryClients.push(queryClient);
    const router = createMemoryRouter(
      [
        {
          path: "/organizations/:organizationId/projects/:projectId/members",
          element: <ProjectMembersPage />,
        },
        {
          path: "/organizations/:organizationId/projects",
          element: <ProjectsPage />,
        },
        {
          path: "/elsewhere",
          loader: () =>
            new Promise<null>((resolve) => {
              finishLoader = resolve;
            }),
          element: <p data-testid="elsewhere">elsewhere</p>,
        },
      ],
      { initialEntries: [`/organizations/${A}/projects/${P}/members`] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <RouterProvider router={router} />
        </TenantProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(meMock).toHaveBeenCalledTimes(2);
    });
    // The user picks another page and the reload settles before React renders
    // the new navigation state: only the router itself knows it is loading.
    void router.navigate("/elsewhere");
    expect(router.state.navigation.state).toBe("loading");
    finishReload(context("owner"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    act(() => {
      finishLoader(null);
    });
    expect(await screen.findByTestId("elsewhere")).toBeVisible();
    expect(router.state.location.pathname).toBe("/elsewhere");
    expect(screen.queryByTestId("projects-notice-role-changed")).toBeNull();
  });

  it("shows denied for an organization the user does not belong to, without a request", async () => {
    renderPage(B);
    expect(
      await screen.findByTestId("project-members-denied-alert"),
    ).toHaveRole("alert");
    expect(detailMock).not.toHaveBeenCalled();
    expect(membersMock).not.toHaveBeenCalled();
  });

  it("shows denied when the API answers MEMBERSHIP_DENIED", async () => {
    const error = new ApiError("MEMBERSHIP_DENIED", "denied", 403);
    detailMock.mockRejectedValue(error);
    membersMock.mockRejectedValue(error);
    renderPage();
    expect(
      await screen.findByTestId("project-members-denied-alert"),
    ).toBeInTheDocument();
  });

  it("offers a retry after a load failure", async () => {
    const user = userEvent.setup();
    membersMock.mockRejectedValueOnce(new ApiError("INTERNAL", "boom", 500));
    renderPage();
    await user.click(await screen.findByTestId("project-members-retry"));
    await loaded();
  });
});

describe("role change (AC-05)", () => {
  it("sends the chosen role and shows the persisted result", async () => {
    const user = userEvent.setup();
    patchMock.mockImplementation((_org, _project, userId, role) => {
      roster = roster.map((item) =>
        item.userId === userId ? { ...item, projectRole: role } : item,
      );
      return Promise.resolve({ ...member(userId, role) });
    });
    renderPage();
    await loaded();
    await user.selectOptions(select("thanakorn"), "admin");
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith(A, P, "thanakorn", "admin");
    });
    await waitFor(() => {
      expect(screen.getByTestId("project-admin-count")).toHaveTextContent("3");
    });
    expect(select("thanakorn")).toHaveValue("admin");
    expect(screen.queryByTestId("project-members-problem")).toBeNull();
  });

  it("reverts the select and says why on 409 LAST_PROJECT_ADMIN", async () => {
    const user = userEvent.setup();
    roster = [member("siriporn", "admin"), member("thanakorn", "member")];
    myRole = "admin";
    patchMock.mockRejectedValue(
      new ApiError("LAST_PROJECT_ADMIN", "last", 409),
    );
    renderPage();
    await loaded();
    await user.selectOptions(select("siriporn"), "member");
    const problem = await screen.findByTestId("project-members-problem");
    expect(problem).toHaveRole("alert");
    expect(select("siriporn")).toHaveValue("admin");
    expect(select("siriporn")).toHaveAccessibleDescription(problem.textContent);
    expect(screen.getByTestId("project-admin-count")).toHaveTextContent("1");
  });
});

describe("self changes", () => {
  it("keeps focus on the page heading when demoting yourself removes the select", async () => {
    const user = userEvent.setup();
    meMock.mockResolvedValue(context("viewer"));
    patchMock.mockImplementation((_org, _project, userId, role) => {
      roster = roster.map((item) =>
        item.userId === userId ? { ...item, projectRole: role } : item,
      );
      if (userId === ME) myRole = role;
      return Promise.resolve({ ...member(userId, role) });
    });
    renderPage();
    await loaded();
    await user.selectOptions(select(ME), "member");
    await waitFor(() => {
      expect(screen.queryByTestId("project-member-role-select")).toBeNull();
    });
    expect(screen.queryByTestId("project-members-add")).toBeNull();
    expect(screen.getByTestId("page-title")).toHaveFocus();
  });

  it("says you left the project, not a bare not-found, after removing yourself", async () => {
    const user = userEvent.setup();
    meMock.mockResolvedValue(context("viewer"));
    removeMock.mockImplementation(() => {
      const gone = new ApiError("PROJECT_NOT_FOUND", "missing", 404);
      detailMock.mockRejectedValue(gone);
      membersMock.mockRejectedValue(gone);
      return Promise.resolve(undefined);
    });
    renderPage();
    await loaded();
    await user.click(within(row(ME)).getByTestId("project-member-remove"));
    await user.click(screen.getByTestId("project-member-remove-confirm"));
    expect(
      await screen.findByTestId("projects-notice-role-changed"),
    ).toBeVisible();
    expect(removeMock).toHaveBeenCalledWith(A, P, ME);
    expect(
      screen.getByTestId("projects-notice-role-changed"),
    ).toHaveTextContent(/^คุณออกจากโปรเจกต์ .+ แล้ว$/);
  });

  it("keeps the organization owner on the page after removing themself", async () => {
    const user = userEvent.setup();
    removeMock.mockImplementation((_org, _project, userId) => {
      roster = roster.filter((item) => item.userId !== userId);
      myRole = null;
      return Promise.resolve(undefined);
    });
    renderPage();
    await loaded();
    await user.click(within(row(ME)).getByTestId("project-member-remove"));
    await user.click(screen.getByTestId("project-member-remove-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("project-my-role")).toHaveAttribute(
        "data-project-role",
        "none",
      );
    });
  });
});

describe("remove (AC-05)", () => {
  it("closes the dialog, says the member is gone and refetches on 404 PROJECT_MEMBER_NOT_FOUND", async () => {
    const user = userEvent.setup();
    removeMock.mockRejectedValue(
      new ApiError("PROJECT_MEMBER_NOT_FOUND", "gone", 404),
    );
    renderPage();
    await loaded();
    const calls = membersMock.mock.calls.length;
    await user.click(
      within(row("thanakorn")).getByTestId("project-member-remove"),
    );
    await user.click(screen.getByTestId("project-member-remove-confirm"));
    expect(
      await screen.findByTestId("project-members-notice-info"),
    ).toBeVisible();
    expect(screen.queryByTestId("project-member-remove-dialog")).toBeNull();
    await waitFor(() => {
      expect(membersMock.mock.calls.length).toBeGreaterThan(calls);
    });
  });

  it("confirms, sends the delete, closes and refreshes the list", async () => {
    const user = userEvent.setup();
    removeMock.mockImplementation((_org, _project, userId) => {
      roster = roster.filter((item) => item.userId !== userId);
      return Promise.resolve(undefined);
    });
    renderPage();
    await loaded();
    await user.click(
      within(row("thanakorn")).getByTestId("project-member-remove"),
    );
    const dialog = screen.getByTestId("project-member-remove-dialog");
    expect(within(dialog).getByTestId("confirmation-cancel")).toHaveFocus();
    expect(removeMock).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByTestId("project-member-remove-confirm"),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("project-member-remove-dialog")).toBeNull();
    });
    expect(removeMock).toHaveBeenCalledWith(A, P, "thanakorn");
    expect(screen.queryByTestId("project-member-row-thanakorn")).toBeNull();
    expect(screen.getByTestId("project-member-count")).toHaveTextContent("2");
    expect(screen.getByTestId("project-members-notice-saved")).toBeVisible();
  });

  it("keeps the dialog open and says why on 409 LAST_PROJECT_ADMIN", async () => {
    const user = userEvent.setup();
    roster = [member("siriporn", "admin"), member("thanakorn", "member")];
    removeMock.mockRejectedValue(
      new ApiError("LAST_PROJECT_ADMIN", "last", 409),
    );
    renderPage();
    await loaded();
    await user.click(
      within(row("siriporn")).getByTestId("project-member-remove"),
    );
    await user.click(screen.getByTestId("project-member-remove-confirm"));
    expect(await screen.findByTestId("project-member-remove-error")).toHaveRole(
      "alert",
    );
    expect(screen.getByTestId("project-member-remove-dialog")).toBeVisible();
    expect(row("siriporn")).toBeInTheDocument();
  });
});

describe("add member dialog", () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await loaded();
    await user.click(screen.getByTestId("project-members-add"));
    const dialog = await screen.findByTestId("add-member-dialog");
    await within(dialog).findByTestId("add-member-row-kitti");
    return dialog;
  }
  const candidate = (dialog: HTMLElement, userId: string) =>
    within(within(dialog).getByTestId(`add-member-row-${userId}`));

  it("lists organization members only, disables those already in the project (AC-01)", async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDialog(user);
    expect(candidatesMock).toHaveBeenCalledWith(A, P, "");
    for (const id of ["kitti", "napa", "pakorn"]) {
      expect(
        candidate(dialog, id).getByTestId("add-member-checkbox"),
      ).toBeEnabled();
    }
    const inProject = candidate(dialog, "thanakorn");
    expect(inProject.getByTestId("add-member-checkbox")).toBeDisabled();
    expect(inProject.getByTestId("add-member-note")).toHaveTextContent(
      "อยู่ในโปรเจกต์แล้ว · สมาชิก",
    );
    expect(
      candidate(dialog, "siriporn").getByTestId("add-member-note"),
    ).toHaveTextContent("อยู่ในโปรเจกต์แล้ว · ผู้ดูแล");
    expect(
      candidate(dialog, "pakorn").getByTestId("add-member-note"),
    ).toHaveTextContent("องค์กร · ผู้ตรวจสอบ");
    expect(within(dialog).queryByText("outsider")).toBeNull();
  });

  it("keeps the add button disabled until someone is selected, then sends the default role member (AC-02)", async () => {
    const user = userEvent.setup();
    addMock.mockImplementation((_org, _project, body) => {
      roster = [...roster, ...body.userIds.map((id) => member(id, body.role))];
      return Promise.resolve({ members: roster, addedUserIds: body.userIds });
    });
    renderPage();
    const dialog = await openDialog(user);
    const submit = within(dialog).getByTestId("add-member-submit");
    expect(submit).toBeDisabled();
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "0",
    );
    expect(within(dialog).getByTestId("add-member-role-member")).toBeChecked();

    await user.click(
      candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
    );
    await user.click(
      candidate(dialog, "pakorn").getByTestId("add-member-checkbox"),
    );
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "2",
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(screen.queryByTestId("add-member-dialog")).toBeNull();
    });
    expect(addMock).toHaveBeenCalledWith(A, P, {
      userIds: ["kitti", "pakorn"],
      role: "member",
    });
    expect(screen.getByTestId("project-member-count")).toHaveTextContent("5");
    expect(screen.getByTestId("project-members-notice-saved")).toBeVisible();
    expect(screen.getByTestId("project-members-add")).toHaveFocus();
  });

  // Another admin adds kitti after the picks were made, and this page's list has
  // not refetched: the API keeps kitti's role (ON CONFLICT DO NOTHING) and its
  // addedUserIds names only the insert that happened.
  it("counts only the people this request added when another admin added some first", async () => {
    const user = userEvent.setup();
    addMock.mockImplementation(() => {
      roster = [
        ...roster,
        member("kitti", "admin"),
        member("pakorn", "member"),
      ];
      return Promise.resolve({ members: roster, addedUserIds: ["pakorn"] });
    });
    renderPage();
    const dialog = await openDialog(user);
    await user.click(
      candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
    );
    await user.click(
      candidate(dialog, "pakorn").getByTestId("add-member-checkbox"),
    );
    await user.click(within(dialog).getByTestId("add-member-submit"));
    const notice = await screen.findByTestId("project-members-notice-saved");
    expect(notice).toHaveTextContent("เพิ่ม 1 คนเป็นสมาชิกแล้ว");
    expect(notice).toHaveTextContent("1 คนอยู่ในโปรเจกต์อยู่แล้ว");
  });

  it("does not report a success when everyone picked was already in the project", async () => {
    const user = userEvent.setup();
    addMock.mockImplementation(() => {
      roster = [...roster, member("kitti", "admin")];
      return Promise.resolve({ members: roster, addedUserIds: [] });
    });
    renderPage();
    const dialog = await openDialog(user);
    await user.click(
      candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
    );
    await user.click(within(dialog).getByTestId("add-member-submit"));
    const notice = await screen.findByTestId("project-members-notice-info");
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(
      "คนที่เลือกอยู่ในโปรเจกต์อยู่แล้ว ไม่มีใครถูกเพิ่ม",
    );
    expect(screen.queryByTestId("project-members-notice-saved")).toBeNull();
  });

  it("drops a selected person whom a refreshed list shows as already in the project", async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDialog(user);
    for (const id of ["kitti", "napa"]) {
      await user.click(
        candidate(dialog, id).getByTestId("add-member-checkbox"),
      );
    }
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "2",
    );
    // Another administrator adds kitti while the dialog is open.
    roster = [...roster, member("kitti", "member")];
    await user.type(within(dialog).getByTestId("add-member-search"), "kitti");
    await waitFor(() => {
      expect(
        candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
      ).toBeDisabled();
    });
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "1",
    );
    await user.click(within(dialog).getByTestId("add-member-submit"));
    await waitFor(() => {
      expect(addMock).toHaveBeenCalled();
    });
    expect(addMock.mock.calls[0]?.[2]).toMatchObject({ userIds: ["napa"] });
  });

  it("stops selecting at the API's limit of 100 people per request", async () => {
    const user = userEvent.setup();
    for (let index = 0; index < 101; index += 1) {
      orgPeople.push({
        userId: `bulk-${String(index).padStart(3, "0")}`,
        name: `Bulk ${String(index).padStart(3, "0")}`,
        organizationRole: "viewer",
      });
    }
    renderPage();
    const dialog = await openDialog(user);
    await within(dialog).findByTestId("add-member-row-bulk-100");
    for (let index = 0; index < 100; index += 1) {
      fireEvent.click(
        candidate(dialog, `bulk-${String(index).padStart(3, "0")}`).getByTestId(
          "add-member-checkbox",
        ),
      );
    }
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "100",
    );
    expect(within(dialog).getByTestId("add-member-limit")).toHaveTextContent(
      "เพิ่มได้ครั้งละไม่เกิน 100 คน",
    );
    const last = candidate(dialog, "bulk-100").getByTestId(
      "add-member-checkbox",
    );
    expect(last).toBeDisabled();
    expect(last).toHaveAccessibleDescription(/เพิ่มได้ครั้งละไม่เกิน 100 คน/);
    expect(
      candidate(dialog, "bulk-000").getByTestId("add-member-checkbox"),
    ).not.toHaveAccessibleDescription(/เพิ่มได้ครั้งละไม่เกิน/);
    // Unticking one frees a slot again.
    fireEvent.click(
      candidate(dialog, "bulk-000").getByTestId("add-member-checkbox"),
    );
    expect(last).toBeEnabled();
    expect(within(dialog).queryByTestId("add-member-limit")).toBeNull();
  });

  it("selects an owner, admin, viewer and auditor candidate (AC-12)", async () => {
    const user = userEvent.setup();
    orgPeople.push({ userId: "boss", name: "Boss", organizationRole: "owner" });
    renderPage();
    const dialog = await openDialog(user);
    await within(dialog).findByTestId("add-member-row-boss");
    for (const id of ["boss", "napa", "kitti", "pakorn"]) {
      await user.click(
        candidate(dialog, id).getByTestId("add-member-checkbox"),
      );
      expect(
        candidate(dialog, id).getByTestId("add-member-checkbox"),
      ).toBeChecked();
    }
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "4",
    );
  });

  it("searches on the server with a debounce, keeps selections and explains no match (AC-03)", async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDialog(user);
    await user.click(
      candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
    );

    await user.type(within(dialog).getByTestId("add-member-search"), "nap");
    await waitFor(() => {
      expect(candidatesMock).toHaveBeenCalledWith(A, P, "nap");
    });
    // Typed one character at a time inside the debounce window: no per-key requests.
    expect(candidatesMock).not.toHaveBeenCalledWith(A, P, "n");
    await waitFor(() => {
      expect(within(dialog).queryByTestId("add-member-row-kitti")).toBeNull();
    });
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "1",
    );

    await user.clear(within(dialog).getByTestId("add-member-search"));
    await user.type(within(dialog).getByTestId("add-member-search"), "nobody");
    const none = await within(dialog).findByTestId("add-member-no-match");
    expect(none).toHaveTextContent("“nobody”");
    expect(none).toHaveTextContent(
      "คนที่ยังไม่อยู่ในองค์กรต้องได้รับคำเชิญเข้าองค์กรก่อน",
    );

    await user.clear(within(dialog).getByTestId("add-member-search"));
    const back = await within(dialog).findByTestId("add-member-row-kitti");
    expect(within(back).getByTestId("add-member-checkbox")).toBeChecked();
  });

  it("picks the admin role with the arrow keys and sends it", async () => {
    const user = userEvent.setup();
    addMock.mockResolvedValue({ members: roster, addedUserIds: ["napa"] });
    renderPage();
    const dialog = await openDialog(user);
    await user.click(
      candidate(dialog, "napa").getByTestId("add-member-checkbox"),
    );
    within(dialog).getByTestId("add-member-role-member").focus();
    await user.keyboard("{ArrowRight}");
    expect(within(dialog).getByTestId("add-member-role-admin")).toBeChecked();
    expect(within(dialog).getByTestId("add-member-role-admin")).toHaveFocus();
    await user.click(within(dialog).getByTestId("add-member-submit"));
    await waitFor(() => {
      expect(addMock).toHaveBeenCalledWith(A, P, {
        userIds: ["napa"],
        role: "admin",
      });
    });
  });

  it("traps Tab, closes on Escape and returns focus to the opener", async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDialog(user);
    expect(within(dialog).getByTestId("add-member-search")).toHaveFocus();
    const cancel = within(dialog).getByTestId("add-member-cancel");
    cancel.focus();
    await user.tab();
    // The submit button is disabled, so Tab from Cancel wraps to the search field.
    expect(within(dialog).getByTestId("add-member-search")).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("add-member-dialog")).toBeNull();
    expect(screen.getByTestId("project-members-add")).toHaveFocus();
  });

  it("shows a form error and clears the selection on 422, then refetches candidates", async () => {
    const user = userEvent.setup();
    addMock.mockRejectedValue(
      new ApiError("PROJECT_MEMBER_NOT_IN_ORGANIZATION", "gone", 422),
    );
    renderPage();
    const dialog = await openDialog(user);
    await user.click(
      candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
    );
    const calls = candidatesMock.mock.calls.length;
    await user.click(within(dialog).getByTestId("add-member-submit"));
    expect(await within(dialog).findByTestId("add-member-error")).toHaveRole(
      "alert",
    );
    expect(within(dialog).getByTestId("add-member-count")).toHaveTextContent(
      "0",
    );
    await waitFor(() => {
      expect(candidatesMock.mock.calls.length).toBeGreaterThan(calls);
    });
  });

  it("announces an empty search result in a live region", async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openDialog(user);
    const status = within(dialog).getByTestId("add-member-result-status");
    expect(status).toHaveRole("status");
    await user.type(within(dialog).getByTestId("add-member-search"), "nobody");
    await waitFor(() => {
      expect(status).toHaveTextContent("ไม่พบสมาชิกองค์กร");
    });
  });

  it.each([
    ["PERMISSION_DENIED", 403, "project-members-notice-role-changed"],
    ["PROJECT_NOT_FOUND", 404, undefined],
  ])(
    "closes the dialog when the candidate search answers %s",
    async (code, status, noticeId) => {
      const user = userEvent.setup();
      candidatesMock.mockRejectedValue(new ApiError(code, "stale", status));
      renderPage();
      await loaded();
      const contextCalls = meMock.mock.calls.length;
      const detailCalls = detailMock.mock.calls.length;
      await user.click(screen.getByTestId("project-members-add"));
      await waitFor(() => {
        expect(screen.queryByTestId("add-member-dialog")).toBeNull();
      });
      // Either answer may mean the role or the Project changed: reload both.
      await waitFor(() => {
        expect(meMock.mock.calls.length).toBeGreaterThan(contextCalls);
        expect(detailMock.mock.calls.length).toBeGreaterThan(detailCalls);
      });
      if (noticeId === undefined) {
        expect(
          screen.queryByTestId("project-members-notice-role-changed"),
        ).toBeNull();
      } else {
        expect(await screen.findByTestId(noticeId)).toBeVisible();
      }
    },
  );

  it("closes the dialog and reloads on 403 from the add request", async () => {
    const user = userEvent.setup();
    addMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    renderPage();
    const dialog = await openDialog(user);
    await user.click(
      candidate(dialog, "kitti").getByTestId("add-member-checkbox"),
    );
    await user.click(within(dialog).getByTestId("add-member-submit"));
    await waitFor(() => {
      expect(screen.queryByTestId("add-member-dialog")).toBeNull();
    });
    expect(
      await screen.findByTestId("project-members-notice-role-changed"),
    ).toBeVisible();
  });
});

describe("organization switch", () => {
  function SwitchHarness() {
    const { switchOrg } = useTenant();
    return (
      <>
        <button
          data-testid="harness-switch"
          type="button"
          onClick={() => {
            void switchOrg(B);
          }}
        >
          switch
        </button>
        <p data-testid="harness-location">{useLocation().pathname}</p>
        <Outlet />
      </>
    );
  }

  it("leaves for the new organization's project list and sends nothing to the old one", async () => {
    const user = userEvent.setup();
    const both: MeContextResponse = {
      ...context("owner"),
      organizations: [
        { id: A, name: "Acme", slug: "acme", role: "owner" },
        { id: B, name: "Beta", slug: "beta", role: "owner" },
      ],
    };
    meMock.mockResolvedValue(both);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...both,
      lastActiveTenantId: B,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    bindQueryClientIdentity(queryClient, ME);
    queryClients.push(queryClient);
    const router = createMemoryRouter(
      [
        {
          element: <SwitchHarness />,
          children: [
            {
              path: "/organizations/:organizationId/projects/:projectId/members",
              element: <ProjectMembersPage />,
            },
            {
              path: "/organizations/:organizationId/projects",
              element: <p data-testid="harness-projects">projects</p>,
            },
          ],
        },
      ],
      { initialEntries: [`/organizations/${A}/projects/${P}/members`] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <RouterProvider router={router} />
        </TenantProvider>
      </QueryClientProvider>,
    );
    await loaded();
    const calls = [detailMock, membersMock, candidatesMock].map(
      (mock) => mock.mock.calls.length,
    );

    await user.click(screen.getByTestId("harness-switch"));
    await waitFor(() => {
      expect(screen.getByTestId("harness-location")).toHaveTextContent(
        `/organizations/${B}/projects`,
      );
    });
    expect(screen.getByTestId("harness-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("project-members-table")).toBeNull();
    expect(
      [detailMock, membersMock, candidatesMock].map(
        (mock) => mock.mock.calls.length,
      ),
    ).toEqual(calls);
    for (const mock of [addMock, patchMock, removeMock]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});
