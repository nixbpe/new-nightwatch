import { guardUnassignedNetwork } from "../../test/guard-network";
import { bindQueryClientIdentity } from "../../lib/queryClient";
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
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import {
  createProject,
  deleteProject,
  fetchProjectList,
  projectQueryKeys,
  updateProject,
} from "../../lib/api/projects";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { ProjectsPage } from "./ProjectsPage";

guardUnassignedNetwork();

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
}));
vi.mock("../../lib/api/projects", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProjectList: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchListMock = vi.mocked(fetchProjectList);
const createMock = vi.mocked(createProject);
const updateMock = vi.mocked(updateProject);
const deleteMock = vi.mocked(deleteProject);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

type Role = "owner" | "admin" | "viewer" | "auditor";

function context(role: Role): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "Tester",
      email: "tester@example.test",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [{ id: A, name: "Acme", slug: "acme", role }],
    lastActiveTenantId: A,
  };
}

let nextId = 0;
function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    name: `Project ${String(nextId)}`,
    slug: `project-${String(nextId)}`,
    description: null,
    memberCount: 3,
    myRole: "member",
    updatedAt: "2026-10-10T07:32:00.000Z",
    ...overrides,
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
  fetchMeContextMock.mockResolvedValue(context("owner"));
});

let lastRouter: ReturnType<typeof createMemoryRouter>;
let navigateSpy: MockInstance<
  ReturnType<typeof createMemoryRouter>["navigate"]
>;
function renderPage(
  organizationId = A,
  state?: unknown,
  search = "",
  hash = "",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  queryClients.push(queryClient);
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects",
        element: <ProjectsPage />,
      },
    ],
    {
      initialEntries: [
        {
          pathname: `/organizations/${organizationId}/projects`,
          search,
          hash,
          state,
        },
      ],
    },
  );
  lastRouter = router;
  navigateSpy = vi.spyOn(router, "navigate");
  return render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <RouterProvider router={router} />
      </TenantProvider>
    </QueryClientProvider>,
  );
}

const row = (id: string) => screen.getByTestId(`project-row-${id}`);

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("projects-create"));
  return screen.findByTestId("project-create-dialog");
}

describe("create button (AC-01)", () => {
  it.each(["viewer", "auditor"] as const)("is absent for %s", async (role) => {
    fetchMeContextMock.mockResolvedValue(context(role));
    const payments = project({ name: "Payments" });
    fetchListMock.mockResolvedValue({ projects: [payments] });
    renderPage();
    expect(
      await screen.findByTestId(`project-row-${payments.id}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projects-create")).toBeNull();
  });

  it.each(["owner", "admin"] as const)("is shown for %s", async (role) => {
    fetchMeContextMock.mockResolvedValue(context(role));
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    expect(await screen.findByTestId("projects-create")).toBeEnabled();
  });
});

describe("create link from the sidebar (F-010 AC-05)", () => {
  it("opens the create dialog for an Owner and drops the parameter, so a reload does not reopen it", async () => {
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage(A, undefined, "?create=1");
    expect(await screen.findByTestId("project-create-dialog")).toBeVisible();
    await waitFor(() => {
      expect(lastRouter.state.location.search).toBe("");
    });
    expect(screen.getAllByTestId("project-create-dialog")).toHaveLength(1);
  });

  it("sends one navigation however often the effect re-runs before it commits, so the route does not see a same-URL navigation", async () => {
    // Observed in the app: a second navigation to the already-stripped URL is a revalidation, which re-runs the loader and remounts the page.
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage(A, undefined, "?create=1");
    await screen.findByTestId("projects-create");
    // Holds the first navigation back, then refreshes the list so the effect runs again.
    navigateSpy.mockImplementation(() => new Promise<void>(() => undefined));
    await queryClients[0]?.setQueryData(projectQueryKeys.list(A), {
      projects: [project()],
    });
    await queryClients[0]?.setQueryData(projectQueryKeys.list(A), {
      projects: [project()],
    });
    await waitFor(() => {
      expect(navigateSpy.mock.calls.length).toBeGreaterThan(0);
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it("drops only the create parameter and keeps the other parameters and the hash", async () => {
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage(A, undefined, "?create=1&view=mine", "#top");
    await screen.findByTestId("project-create-dialog");
    await waitFor(() => {
      expect(lastRouter.state.location.search).toBe("?view=mine");
    });
    expect(lastRouter.state.location.hash).toBe("#top");
  });

  it("opens nothing for a role below Admin, still dropping the parameter", async () => {
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    const listed = project();
    fetchListMock.mockResolvedValue({ projects: [listed] });
    renderPage(A, undefined, "?create=1");
    await screen.findByTestId(`project-row-${listed.id}`);
    await waitFor(() => {
      expect(lastRouter.state.location.search).toBe("");
    });
    expect(screen.queryByTestId("project-create-dialog")).toBeNull();
  });

  it("opens nothing at the Project limit", async () => {
    fetchListMock.mockResolvedValue({
      projects: Array.from({ length: 50 }, () => project()),
    });
    renderPage(A, undefined, "?create=1");
    expect(await screen.findByTestId("projects-create")).toBeDisabled();
    await waitFor(() => {
      expect(lastRouter.state.location.search).toBe("");
    });
    expect(screen.queryByTestId("project-create-dialog")).toBeNull();
  });
});

describe("list (AC-05)", () => {
  it("shows name, slug, member count, role and the update time", async () => {
    const payments = project({
      name: "Payments Platform",
      slug: "payments-platform",
      memberCount: 5,
      myRole: "admin",
      updatedAt: "2026-10-10T07:32:00.000Z",
    });
    const portal = project({
      name: "Customer Portal",
      memberCount: 4,
      myRole: "member",
    });
    const hidden = project({ name: "Hidden", myRole: null });
    fetchListMock.mockResolvedValue({ projects: [payments, portal, hidden] });
    renderPage();
    await screen.findByTestId("projects-table");

    const first = row(payments.id);
    expect(within(first).getByTestId("project-name")).toHaveTextContent(
      /^Payments Platform$/,
    );
    expect(within(first).getByTestId("project-slug")).toHaveTextContent(
      /^payments-platform$/,
    );
    expect(within(first).getByTestId("project-member-count")).toHaveTextContent(
      /^5$/,
    );
    expect(within(first).getByTestId("project-role")).toHaveAttribute(
      "data-project-role",
      "admin",
    );
    const updatedAt = within(first).getByTestId("project-updated-at");
    expect(updatedAt).toHaveAttribute("datetime", "2026-10-10T07:32:00.000Z");
    expect(updatedAt).toHaveTextContent(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(within(row(portal.id)).getByTestId("project-role")).toHaveAttribute(
      "data-project-role",
      "member",
    );
    expect(within(row(hidden.id)).getByTestId("project-role")).toHaveAttribute(
      "data-project-role",
      "none",
    );
    expect(screen.getByTestId("projects-total")).toHaveTextContent(/^3$/);
    expect(screen.getByTestId("projects-joined")).toHaveTextContent(/^2$/);
  });
});

describe("members entry point", () => {
  it.each(["owner", "viewer"] as const)(
    "links every row to its members page for %s",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      const joined = project({ myRole: "member" });
      const other = project({ myRole: null });
      fetchListMock.mockResolvedValue({ projects: [joined, other] });
      renderPage();
      await screen.findByTestId("projects-table");
      for (const item of [joined, other]) {
        expect(
          within(row(item.id)).getByTestId("project-members-link"),
        ).toHaveAttribute(
          "href",
          `/organizations/${A}/projects/${item.id}/members`,
        );
      }
    },
  );
});

describe("empty states (AC-06, AC-07)", () => {
  it("tells a viewer outside every project to contact an owner or admin", async () => {
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValue({ projects: [] });
    renderPage();
    expect(
      await screen.findByTestId("projects-empty-not-joined"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projects-empty-first-run")).toBeNull();
    expect(screen.queryByTestId("projects-create")).toBeNull();
  });

  it("offers an owner the first-run create button", async () => {
    fetchListMock.mockResolvedValue({ projects: [] });
    renderPage();
    const empty = await screen.findByTestId("projects-empty-first-run");
    expect(screen.getAllByTestId("projects-create")).toHaveLength(1);
    expect(within(empty).getByTestId("projects-create")).toBeEnabled();
    expect(screen.queryByTestId("projects-empty-not-joined")).toBeNull();
  });

  it("filters by membership, name and slug, and keeps no-results apart from first-run", async () => {
    const user = userEvent.setup();
    const payments = project({
      name: "Payments",
      slug: "pay-core",
      myRole: "admin",
    });
    const portal = project({
      name: "Portal",
      slug: "customer-web",
      myRole: "member",
    });
    const secret = project({
      name: "Secret",
      slug: "hidden-one",
      myRole: null,
    });
    fetchListMock.mockResolvedValue({ projects: [payments, portal, secret] });
    const rowId = (id: string) => `project-row-${id}`;
    renderPage();
    await screen.findByTestId(rowId(payments.id));

    await user.click(screen.getByTestId("projects-view-mine"));
    expect(screen.getByTestId("projects-view-mine")).toBeChecked();
    expect(screen.queryByTestId(rowId(secret.id))).toBeNull();
    expect(screen.getByTestId(rowId(portal.id))).toBeInTheDocument();
    const result = screen.getByTestId("projects-filter-result");
    expect(result).toHaveRole("status");
    await waitFor(() => {
      expect(result).toHaveTextContent(/2\D+3/);
    });
    await user.click(screen.getByTestId("projects-view-all"));
    expect(screen.getByTestId(rowId(secret.id))).toBeInTheDocument();

    const search = screen.getByTestId("projects-search");
    await user.type(search, "PAY");
    await waitFor(() => {
      expect(screen.queryByTestId(rowId(portal.id))).toBeNull();
    });
    expect(screen.getByTestId(rowId(payments.id))).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "customer-web");
    await waitFor(() => {
      expect(screen.queryByTestId(rowId(payments.id))).toBeNull();
    });
    expect(screen.getByTestId(rowId(portal.id))).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(
      await screen.findByTestId("projects-no-results"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projects-empty-first-run")).toBeNull();
    await user.click(screen.getByTestId("projects-clear-filters"));
    expect(await screen.findByTestId(rowId(secret.id))).toBeInTheDocument();
    expect(screen.getByTestId("projects-search")).toHaveFocus();
    expect(screen.getByTestId("projects-search")).toHaveValue("");
    expect(screen.getByTestId("projects-view-all")).toBeChecked();
    expect(screen.getByTestId("projects-filter-result")).toBeEmptyDOMElement();
  });
});

describe("denied state", () => {
  it("shows denied for an Organization the user does not belong to, without a request", async () => {
    renderPage(B);
    expect(await screen.findByTestId("projects-denied-alert")).toHaveRole(
      "alert",
    );
    expect(fetchListMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("page-scope")).toBeNull();
    // "Acme" is the member Organization's fixture name; it must not leak here.
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it.each(["MEMBERSHIP_DENIED", "PERMISSION_DENIED"])(
    "shows denied when the API answers 403 %s",
    async (code) => {
      fetchListMock.mockRejectedValue(new ApiError(code, "denied", 403));
      renderPage();
      expect(await screen.findByTestId("projects-denied-alert")).toHaveRole(
        "alert",
      );
      expect(screen.queryByTestId("projects-table")).toBeNull();
    },
  );
});

describe("row actions (OD-01)", () => {
  it("gives an owner edit and delete on every row", async () => {
    const a1 = project({ name: "A1", myRole: null });
    fetchListMock.mockResolvedValue({ projects: [a1] });
    renderPage();
    const target = await screen.findByTestId(`project-row-${a1.id}`);
    expect(within(target).getByTestId("project-edit")).toBeEnabled();
    expect(within(target).getByTestId("project-delete")).toBeEnabled();
  });

  it("gives a project admin edit only, and a project member nothing", async () => {
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    const mine = project({ name: "Mine", myRole: "admin" });
    const joined = project({ name: "Joined", myRole: "member" });
    fetchListMock.mockResolvedValue({ projects: [mine, joined] });
    renderPage();
    const mineRow = await screen.findByTestId(`project-row-${mine.id}`);
    expect(within(mineRow).getByTestId("project-edit")).toBeEnabled();
    expect(within(mineRow).queryByTestId("project-delete")).toBeNull();
    const joinedRow = row(joined.id);
    expect(within(joinedRow).queryByTestId("project-edit")).toBeNull();
    expect(within(joinedRow).queryByTestId("project-delete")).toBeNull();
  });
});

describe("limit (AC-11)", () => {
  it("disables create and describes it with the cap reason at 50 projects", async () => {
    fetchListMock.mockResolvedValue({
      projects: Array.from({ length: 50 }, () => project()),
    });
    renderPage();
    const button = await screen.findByTestId("projects-create");
    expect(button).toBeDisabled();
    const reason = screen.getByTestId("projects-limit-reason");
    expect(reason).not.toBeEmptyDOMElement();
    expect(button).toHaveAttribute("aria-describedby", reason.id);
  });

  it("keeps create enabled at 49 projects", async () => {
    fetchListMock.mockResolvedValue({
      projects: Array.from({ length: 49 }, () => project()),
    });
    renderPage();
    expect(await screen.findByTestId("projects-create")).toBeEnabled();
    expect(screen.queryByTestId("projects-limit-reason")).toBeNull();
  });
});

describe("create dialog", () => {
  it("creates a project and reloads the list", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValueOnce({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    const created = project({
      name: "New one",
      slug: "new-one",
      myRole: "admin",
    });
    createMock.mockResolvedValue(created);
    fetchListMock.mockResolvedValue({ projects: [created] });

    await user.type(
      within(dialog).getByTestId("project-form-name"),
      "  New one ",
    );
    await user.type(within(dialog).getByTestId("project-form-slug"), "new-one");
    await user.click(within(dialog).getByTestId("project-form-submit"));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(A, {
        name: "  New one ",
        slug: "new-one",
        description: "",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("project-create-dialog")).toBeNull();
    });
    const createdRow = await screen.findByTestId(`project-row-${created.id}`);
    expect(within(createdRow).getByTestId("project-slug")).toHaveTextContent(
      /^new-one$/,
    );
    const notice = screen.getByTestId("projects-notice-saved");
    expect(notice).toHaveRole("status");
    expect(notice).toHaveTextContent("New one");
  });

  it("marks the slug field on 409 and keeps every value (AC-04)", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockRejectedValue(
      new ApiError("PROJECT_SLUG_TAKEN", "taken", 409, { field: "slug" }),
    );
    await user.type(
      within(dialog).getByTestId("project-form-name"),
      "Payments",
    );
    await user.type(
      within(dialog).getByTestId("project-form-slug"),
      "payments",
    );
    await user.type(
      within(dialog).getByTestId("project-form-description"),
      "Team A",
    );
    await user.click(within(dialog).getByTestId("project-form-submit"));

    const error = await within(dialog).findByTestId("project-form-slug-error");
    const slug = within(dialog).getByTestId("project-form-slug");
    expect(createMock).toHaveBeenCalledWith(A, {
      name: "Payments",
      slug: "payments",
      description: "Team A",
    });
    expect(slug.getAttribute("aria-describedby")?.split(" ")).toContain(
      error.id,
    );
    expect(slug).toBeInvalid();
    expect(slug).toHaveFocus();
    expect(slug).toHaveValue("payments");
    expect(within(dialog).getByTestId("project-form-name")).toHaveValue(
      "Payments",
    );
    expect(within(dialog).getByTestId("project-form-description")).toHaveValue(
      "Team A",
    );
    expect(within(dialog).queryByTestId("project-form-name-error")).toBeNull();
  });

  it("rejects an invalid slug in the browser without a request", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    await user.type(
      within(dialog).getByTestId("project-form-name"),
      "Payments",
    );
    await user.type(
      within(dialog).getByTestId("project-form-slug"),
      "Bad Slug",
    );
    await user.click(within(dialog).getByTestId("project-form-submit"));
    const error = await within(dialog).findByTestId("project-form-slug-error");
    expect(error).toHaveRole("alert");
    const slug = within(dialog).getByTestId("project-form-slug");
    expect(slug).toBeInvalid();
    expect(slug).toHaveFocus();
    expect(slug.getAttribute("aria-describedby")?.split(" ")).toContain(
      error.id,
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("shows the cap at form level on PROJECT_LIMIT_REACHED", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockRejectedValue(
      new ApiError("PROJECT_LIMIT_REACHED", "limit", 409),
    );
    await user.type(
      within(dialog).getByTestId("project-form-name"),
      "Payments",
    );
    await user.type(
      within(dialog).getByTestId("project-form-slug"),
      "payments",
    );
    await user.click(within(dialog).getByTestId("project-form-submit"));
    expect(await within(dialog).findByTestId("project-form-error")).toHaveRole(
      "alert",
    );
    expect(within(dialog).queryByTestId("project-form-slug-error")).toBeNull();
    expect(screen.getByTestId("project-create-dialog")).toBeInTheDocument();
  });

  it("closes the dialog and reloads the list on PERMISSION_DENIED", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    await user.type(
      within(dialog).getByTestId("project-form-name"),
      "Payments",
    );
    await user.type(
      within(dialog).getByTestId("project-form-slug"),
      "payments",
    );
    const callsBefore = fetchListMock.mock.calls.length;
    await user.click(within(dialog).getByTestId("project-form-submit"));
    await waitFor(() => {
      expect(screen.queryByTestId("project-create-dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(fetchListMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe("dialog focus (CMP-03)", () => {
  it("starts on the first field, traps Tab, closes on Escape and returns focus to the opener", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const opener = await screen.findByTestId("projects-create");
    const dialog = await openCreate(user);
    const name = within(dialog).getByTestId("project-form-name");
    expect(name).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(dialog).getByTestId("project-form-submit")).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("project-create-dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe("edit dialog", () => {
  it("shows the slug as fixed text and sends only name and description", async () => {
    const user = userEvent.setup();
    const target = project({
      name: "Payments",
      slug: "payments",
      description: "Team A",
      myRole: "admin",
    });
    fetchListMock.mockResolvedValue({ projects: [target] });
    renderPage();
    await user.click(
      within(await screen.findByTestId(`project-row-${target.id}`)).getByTestId(
        "project-edit",
      ),
    );
    const dialog = await screen.findByTestId("project-edit-dialog");
    expect(dialog).toHaveAccessibleName(expect.stringContaining("Payments"));
    expect(within(dialog).queryByTestId("project-form-slug")).toBeNull();
    expect(
      within(dialog).getByTestId("project-form-slug-fixed"),
    ).toHaveTextContent(/^payments$/);
    expect(within(dialog).getByTestId("project-form-description")).toHaveValue(
      "Team A",
    );
    updateMock.mockResolvedValue({ ...target, name: "Payments v2" });

    const name = within(dialog).getByTestId("project-form-name");
    expect(name).toHaveValue("Payments");
    await user.clear(name);
    await user.type(name, "Payments v2");
    await user.click(within(dialog).getByTestId("project-form-submit"));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(A, target.id, {
        name: "Payments v2",
        description: "Team A",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("project-edit-dialog")).toBeNull();
    });
  });
});

describe("delete (AC-08)", () => {
  it("names the project and its consequences, and makes no request on cancel", async () => {
    const user = userEvent.setup();
    const payments = project({ name: "Payments" });
    fetchListMock.mockResolvedValue({ projects: [payments] });
    renderPage();
    await user.click(
      within(
        await screen.findByTestId(`project-row-${payments.id}`),
      ).getByTestId("project-delete"),
    );
    const dialog = await screen.findByTestId("project-delete-dialog");
    expect(dialog).toHaveAccessibleName(expect.stringContaining("Payments"));
    expect(dialog).toHaveAccessibleDescription(/\S/);
    expect(within(dialog).getByTestId("confirmation-cancel")).toHaveFocus();
    await user.click(within(dialog).getByTestId("confirmation-cancel"));
    expect(screen.queryByTestId("project-delete-dialog")).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes after confirmation and reloads the list", async () => {
    const user = userEvent.setup();
    const target = project({ name: "Payments" });
    fetchListMock.mockResolvedValueOnce({ projects: [target] });
    renderPage();
    await user.click(
      within(await screen.findByTestId(`project-row-${target.id}`)).getByTestId(
        "project-delete",
      ),
    );
    const dialog = await screen.findByTestId("project-delete-dialog");
    deleteMock.mockResolvedValue(undefined);
    fetchListMock.mockResolvedValue({ projects: [] });
    await user.click(within(dialog).getByTestId("project-delete-confirm"));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(A, target.id);
    });
    expect(
      await screen.findByTestId("projects-empty-first-run"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("project-delete-dialog")).toBeNull();
    expect(screen.getByTestId("projects-notice-saved")).toHaveTextContent(
      "Payments",
    );
  });

  it("closes and reloads when the project is already gone", async () => {
    const user = userEvent.setup();
    const payments = project({ name: "Payments" });
    fetchListMock.mockResolvedValue({ projects: [payments] });
    renderPage();
    await user.click(
      within(
        await screen.findByTestId(`project-row-${payments.id}`),
      ).getByTestId("project-delete"),
    );
    const dialog = await screen.findByTestId("project-delete-dialog");
    deleteMock.mockRejectedValue(
      new ApiError("PROJECT_NOT_FOUND", "gone", 404),
    );
    const callsBefore = fetchListMock.mock.calls.length;
    await user.click(within(dialog).getByTestId("project-delete-confirm"));
    await waitFor(() => {
      expect(screen.queryByTestId("project-delete-dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(fetchListMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe("a 404 on edit or delete removes the row even if the reload fails (AC-05)", () => {
  it.each(["edit", "delete"] as const)(
    "drops the Project from the cached list on %s when the refetch fails",
    async (action) => {
      const user = userEvent.setup();
      const gone = project({ name: "Payments", myRole: "admin" });
      const other = project({ name: "Other", myRole: "admin" });
      fetchListMock.mockResolvedValueOnce({ projects: [gone, other] });
      renderPage();
      const opener = within(
        await screen.findByTestId(`project-row-${gone.id}`),
      ).getByTestId(`project-${action}`);
      fetchListMock.mockRejectedValue(new ApiError("INTERNAL_ERROR", "x", 500));
      const notFound = new ApiError("PROJECT_NOT_FOUND", "gone", 404);
      updateMock.mockRejectedValue(notFound);
      deleteMock.mockRejectedValue(notFound);
      await user.click(opener);
      const dialog = await screen.findByTestId(
        action === "edit" ? "project-edit-dialog" : "project-delete-dialog",
      );
      await user.click(
        within(dialog).getByTestId(
          action === "edit" ? "project-form-submit" : "project-delete-confirm",
        ),
      );
      await waitFor(() => {
        expect(screen.queryByTestId(`project-row-${gone.id}`)).toBeNull();
      });
      expect(screen.getByTestId(`project-row-${other.id}`)).toBeVisible();
      await waitFor(() => {
        expect(fetchListMock.mock.calls.length).toBeGreaterThan(1);
      });
      expect(screen.queryByTestId(`project-row-${gone.id}`)).toBeNull();
    },
  );
});

describe("a 404 while a list refetch is in flight (AC-05)", () => {
  it.each(["edit", "delete"] as const)(
    "keeps the Project out of the list on %s although the context refresh cancels that refetch and the next one fails",
    async (action) => {
      const user = userEvent.setup();
      const gone = project({ name: "Payments", myRole: "admin" });
      const other = project({ name: "Other", myRole: "admin" });
      fetchListMock.mockResolvedValueOnce({ projects: [gone, other] });
      renderPage();
      const opener = within(
        await screen.findByTestId(`project-row-${gone.id}`),
      ).getByTestId(`project-${action}`);
      const queryClient = queryClients[0];
      if (queryClient === undefined) throw new Error("no query client");
      // A refetch that never settles by itself: only a cancellation ends it.
      fetchListMock.mockImplementationOnce(() => new Promise(() => undefined));
      void queryClient.refetchQueries({
        queryKey: projectQueryKeys.list(A),
      });
      await waitFor(() => {
        expect(fetchListMock).toHaveBeenCalledTimes(2);
      });
      fetchListMock.mockRejectedValue(new ApiError("INTERNAL_ERROR", "x", 500));
      const notFound = new ApiError("PROJECT_NOT_FOUND", "gone", 404);
      updateMock.mockRejectedValue(notFound);
      deleteMock.mockRejectedValue(notFound);
      await user.click(opener);
      const dialog = await screen.findByTestId(
        action === "edit" ? "project-edit-dialog" : "project-delete-dialog",
      );
      await user.click(
        within(dialog).getByTestId(
          action === "edit" ? "project-form-submit" : "project-delete-confirm",
        ),
      );
      await waitFor(() => {
        expect(fetchListMock.mock.calls.length).toBeGreaterThan(2);
      });
      await waitFor(() => {
        expect(screen.queryByTestId(`project-row-${gone.id}`)).toBeNull();
      });
      expect(screen.getByTestId(`project-row-${other.id}`)).toBeVisible();
    },
  );
});

describe("role changed under the user", () => {
  it.each(["edit", "delete"] as const)(
    "reloads the list and the role after a denied %s",
    async (action) => {
      const user = userEvent.setup();
      const target = project({ name: "Payments", myRole: "admin" });
      fetchListMock.mockResolvedValueOnce({ projects: [target] });
      renderPage();
      const opener = within(
        await screen.findByTestId(`project-row-${target.id}`),
      ).getByTestId(`project-${action}`);
      expect(screen.getByTestId("projects-create")).toBeEnabled();
      fetchMeContextMock.mockResolvedValue(context("viewer"));
      fetchListMock.mockResolvedValue({ projects: [target] });
      const denied = new ApiError("PERMISSION_DENIED", "no", 403);
      updateMock.mockRejectedValue(denied);
      deleteMock.mockRejectedValue(denied);

      await user.click(opener);
      const dialog = await screen.findByTestId(
        action === "edit" ? "project-edit-dialog" : "project-delete-dialog",
      );
      const listCallsBefore = fetchListMock.mock.calls.length;
      await user.click(
        within(dialog).getByTestId(
          action === "edit" ? "project-form-submit" : "project-delete-confirm",
        ),
      );

      expect(
        await screen.findByTestId("projects-notice-role-changed"),
      ).toHaveRole("status");
      expect(screen.queryByTestId("project-edit-dialog")).toBeNull();
      expect(screen.queryByTestId("project-delete-dialog")).toBeNull();
      await waitFor(() => {
        expect(screen.queryByTestId("projects-create")).toBeNull();
        expect(screen.queryByTestId("project-delete")).toBeNull();
      });
      expect(
        within(row(target.id)).getByTestId("project-edit"),
      ).toBeInTheDocument();
      expect(fetchMeContextMock.mock.calls.length).toBeGreaterThan(1);
      expect(fetchListMock.mock.calls.length - listCallsBefore).toBe(1);
    },
  );
  it.each(["edit", "delete"] as const)(
    "reloads the role when a %s answers 404 for a Project the user can no longer see",
    async (action) => {
      const user = userEvent.setup();
      const hidden = project({ name: "Payments", myRole: null });
      fetchListMock.mockResolvedValueOnce({ projects: [hidden] });
      renderPage();
      const opener = within(
        await screen.findByTestId(`project-row-${hidden.id}`),
      ).getByTestId(`project-${action}`);
      fetchMeContextMock.mockResolvedValue(context("viewer"));
      fetchListMock.mockResolvedValue({ projects: [] });
      const concealed = new ApiError("PROJECT_NOT_FOUND", "gone", 404);
      updateMock.mockRejectedValue(concealed);
      deleteMock.mockRejectedValue(concealed);

      await user.click(opener);
      const dialog = await screen.findByTestId(
        action === "edit" ? "project-edit-dialog" : "project-delete-dialog",
      );
      const listCallsBefore = fetchListMock.mock.calls.length;
      await user.click(
        within(dialog).getByTestId(
          action === "edit" ? "project-form-submit" : "project-delete-confirm",
        ),
      );

      expect(
        await screen.findByTestId("projects-empty-not-joined"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("projects-create")).toBeNull();
      expect(screen.queryByTestId("projects-empty-first-run")).toBeNull();
      expect(fetchListMock.mock.calls.length - listCallsBefore).toBe(1);
    },
  );
  it("reloads the list once when only the project role changed", async () => {
    const user = userEvent.setup();
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    const target = project({ name: "Payments", myRole: "admin" });
    fetchListMock.mockResolvedValueOnce({ projects: [target] });
    renderPage();
    const opener = within(
      await screen.findByTestId(`project-row-${target.id}`),
    ).getByTestId("project-edit");
    fetchListMock.mockResolvedValue({
      projects: [{ ...target, myRole: "member" }],
    });
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    await user.click(opener);
    const dialog = await screen.findByTestId("project-edit-dialog");
    const listCallsBefore = fetchListMock.mock.calls.length;
    await user.click(within(dialog).getByTestId("project-form-submit"));

    await waitFor(() => {
      expect(
        within(row(target.id)).getByTestId("project-role"),
      ).toHaveAttribute("data-project-role", "member");
    });
    expect(within(row(target.id)).queryByTestId("project-edit")).toBeNull();
    expect(fetchListMock.mock.calls.length - listCallsBefore).toBe(1);
  });
  it("shows the stale list warning next to the role notice when the reload fails", async () => {
    const user = userEvent.setup();
    const target = project({ name: "Payments", myRole: "admin" });
    fetchListMock.mockResolvedValueOnce({ projects: [target] });
    renderPage();
    const opener = within(
      await screen.findByTestId(`project-row-${target.id}`),
    ).getByTestId("project-edit");
    fetchListMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    await user.click(opener);
    const dialog = await screen.findByTestId("project-edit-dialog");
    await user.click(within(dialog).getByTestId("project-form-submit"));

    expect(await screen.findByTestId("projects-stale-warning")).toHaveRole(
      "alert",
    );
    expect(screen.getByTestId("projects-notice-role-changed")).toHaveRole(
      "status",
    );
    expect(row(target.id)).toBeInTheDocument();
  });
  it("shows the list error next to the role notice when the Organization role changed and the reload fails", async () => {
    const user = userEvent.setup();
    const target = project({ name: "Payments", myRole: "admin" });
    fetchListMock.mockResolvedValueOnce({ projects: [target] });
    renderPage();
    const opener = within(
      await screen.findByTestId(`project-row-${target.id}`),
    ).getByTestId("project-edit");
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    await user.click(opener);
    const dialog = await screen.findByTestId("project-edit-dialog");
    await user.click(within(dialog).getByTestId("project-form-submit"));

    expect(await screen.findByTestId("projects-list-alert")).toHaveRole(
      "alert",
    );
    expect(screen.getByTestId("projects-list-retry")).toBeEnabled();
    expect(screen.getByTestId("projects-notice-role-changed")).toHaveRole(
      "status",
    );
  });
});

describe("stale list", () => {
  it("warns when a refetch fails after a successful load and drops the success notice", async () => {
    const user = userEvent.setup();
    const old = project({ name: "Old" });
    fetchListMock.mockResolvedValueOnce({ projects: [old] });
    renderPage();
    const dialog = await openCreate(user);
    const fresh = project({ name: "Fresh" });
    createMock.mockResolvedValue(fresh);
    fetchListMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    await user.type(within(dialog).getByTestId("project-form-name"), "Fresh");
    await user.type(within(dialog).getByTestId("project-form-slug"), "fresh");
    await user.click(within(dialog).getByTestId("project-form-submit"));

    expect(
      await screen.findByTestId("projects-stale-warning"),
    ).toBeInTheDocument();
    expect(row(old.id)).toBeInTheDocument();
    expect(screen.queryByTestId("projects-notice-saved")).toBeNull();

    // A later reload that succeeds must not bring back the old notice.
    fetchListMock.mockResolvedValue({ projects: [old, fresh] });
    await queryClients.at(-1)?.invalidateQueries();
    expect(
      await screen.findByTestId(`project-row-${fresh.id}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projects-stale-warning")).toBeNull();
    expect(screen.queryByTestId("projects-notice-saved")).toBeNull();
  });
});

describe("a Project that answers 404 (AC-05)", () => {
  it.each(["edit", "delete"] as const)(
    "drops the Project's cached detail, members and candidates after a 404 on %s",
    async (action) => {
      const user = userEvent.setup();
      const gone = project({ name: "Payments", myRole: "admin" });
      const other = project({ name: "Other", myRole: "admin" });
      fetchListMock.mockResolvedValue({ projects: [gone, other] });
      renderPage();
      const queryClient = queryClients[0];
      if (queryClient === undefined) throw new Error("no query client");
      for (const id of [gone.id, other.id]) {
        for (const kind of ["detail", "members", "candidates"] as const) {
          queryClient.setQueryData([...projectQueryKeys.all(A), id, kind], {
            cached: id,
          });
        }
      }
      const denied = new ApiError("PROJECT_NOT_FOUND", "gone", 404);
      updateMock.mockRejectedValue(denied);
      deleteMock.mockRejectedValue(denied);
      await user.click(
        within(await screen.findByTestId(`project-row-${gone.id}`)).getByTestId(
          `project-${action}`,
        ),
      );
      const dialog = await screen.findByTestId(
        action === "edit" ? "project-edit-dialog" : "project-delete-dialog",
      );
      await user.click(
        within(dialog).getByTestId(
          action === "edit" ? "project-form-submit" : "project-delete-confirm",
        ),
      );
      await waitFor(() => {
        expect(
          queryClient
            .getQueryCache()
            .findAll({ queryKey: projectQueryKeys.project(A, gone.id) }),
        ).toEqual([]);
      });
      expect(
        queryClient
          .getQueryCache()
          .findAll({ queryKey: projectQueryKeys.project(A, other.id) }),
      ).toHaveLength(3);
    },
  );

  it("announces the notice carried from a Project page and focuses the heading", async () => {
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage(A, { projectNotice: "ไม่พบโปรเจกต์นี้" });
    expect(
      await screen.findByTestId("projects-notice-role-changed"),
    ).toHaveTextContent("ไม่พบโปรเจกต์นี้");
    await waitFor(() => {
      expect(screen.getByTestId("page-title")).toHaveFocus();
    });
    // The heading reads the notice after its name, so focus announces it.
    expect(screen.getByTestId("page-title")).toHaveAccessibleDescription(
      "ไม่พบโปรเจกต์นี้",
    );
  });

  it("drops the carried notice from history after reading it, so reload or back does not replay it", async () => {
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage(A, { projectNotice: "ไม่พบโปรเจกต์นี้" });
    expect(
      await screen.findByTestId("projects-notice-role-changed"),
    ).toBeVisible();
    await waitFor(() => {
      expect(lastRouter.state.location.state).toBeNull();
    });
    expect(lastRouter.state.location.pathname).toBe(
      `/organizations/${A}/projects`,
    );
    expect(screen.getByTestId("projects-notice-role-changed")).toBeVisible();
  });
});
