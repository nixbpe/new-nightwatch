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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import {
  createProject,
  deleteProject,
  fetchProjectList,
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

function renderPage(organizationId = A) {
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
    { initialEntries: [`/organizations/${organizationId}/projects`] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <RouterProvider router={router} />
      </TenantProvider>
    </QueryClientProvider>,
  );
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "สร้างโปรเจกต์" }),
  );
  return screen.findByRole("dialog", { name: "สร้างโปรเจกต์" });
}

describe("create button (AC-01)", () => {
  it.each(["viewer", "auditor"] as const)("is absent for %s", async (role) => {
    fetchMeContextMock.mockResolvedValue(context(role));
    fetchListMock.mockResolvedValue({
      projects: [project({ name: "Payments" })],
    });
    renderPage();
    await screen.findByText("Payments");
    expect(screen.queryByRole("button", { name: "สร้างโปรเจกต์" })).toBeNull();
  });

  it.each(["owner", "admin"] as const)("is shown for %s", async (role) => {
    fetchMeContextMock.mockResolvedValue(context(role));
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    expect(
      await screen.findByRole("button", { name: "สร้างโปรเจกต์" }),
    ).toBeEnabled();
  });
});

describe("list (AC-05)", () => {
  it("shows name, slug, member count, role pills and the update time", async () => {
    fetchListMock.mockResolvedValue({
      projects: [
        project({
          name: "Payments Platform",
          slug: "payments-platform",
          memberCount: 5,
          myRole: "admin",
          updatedAt: "2026-10-10T07:32:00.000Z",
        }),
        project({ name: "Customer Portal", memberCount: 4, myRole: "member" }),
        project({ name: "Hidden", myRole: null }),
      ],
    });
    renderPage();
    const table = await screen.findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers.slice(0, 4)).toEqual([
      "โปรเจกต์",
      "สมาชิก",
      "บทบาทของคุณ",
      "อัปเดตล่าสุด",
    ]);
    const row = screen.getByText("Payments Platform").closest("tr");
    if (row === null) throw new Error("no row");
    expect(within(row).getByText("payments-platform")).toBeInTheDocument();
    expect(within(row).getByText("5")).toBeInTheDocument();
    expect(within(row).getByText("ผู้ดูแล")).toBeInTheDocument();
    expect(row.querySelector("time")).toHaveTextContent(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect(
      screen.getByText("สมาชิก", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ไม่ได้เข้าร่วม")).toBeInTheDocument();
    expect(screen.getByText(/คุณเข้าร่วม/)).toHaveTextContent(
      "3 โปรเจกต์ · คุณเข้าร่วม 2 โปรเจกต์",
    );
  });
});

describe("empty states (AC-06, AC-07)", () => {
  it("tells a viewer outside every project to contact an owner or admin", async () => {
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValue({ projects: [] });
    renderPage();
    expect(
      await screen.findByText("คุณยังไม่ได้อยู่ในโปรเจกต์ใด"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ติดต่อเจ้าของหรือผู้ดูแลองค์กรเพื่อเข้าร่วมโปรเจกต์"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "สร้างโปรเจกต์" })).toBeNull();
  });

  it("offers an owner the first-run create button", async () => {
    fetchListMock.mockResolvedValue({ projects: [] });
    renderPage();
    expect(await screen.findByText("ยังไม่มีโปรเจกต์")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "สร้างโปรเจกต์" }),
    ).toHaveLength(1);
  });

  it("filters by membership, name and slug, and keeps no-results apart from first-run", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({
      projects: [
        project({ name: "Payments", slug: "pay-core", myRole: "admin" }),
        project({ name: "Portal", slug: "customer-web", myRole: "member" }),
        project({ name: "Secret", slug: "hidden-one", myRole: null }),
      ],
    });
    renderPage();
    await screen.findByText("Payments");

    await user.click(screen.getByRole("radio", { name: "ที่ฉันเข้าร่วม" }));
    expect(screen.queryByText("Secret")).toBeNull();
    expect(screen.getByText("Portal")).toBeInTheDocument();
    expect(
      await screen.findByRole("status", { name: "ผลการกรอง" }),
    ).toHaveTextContent("พบ 2 จาก 3");
    await user.click(screen.getByRole("radio", { name: "ทั้งหมด" }));
    expect(screen.getByText("Secret")).toBeInTheDocument();

    const search = screen.getByRole("searchbox");
    await user.type(search, "PAY");
    await waitFor(() => {
      expect(screen.queryByText("Portal")).toBeNull();
    });
    expect(screen.getByText("Payments")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "customer-web");
    await waitFor(() => {
      expect(screen.queryByText("Payments")).toBeNull();
    });
    expect(screen.getByText("Portal")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(
      await screen.findByText("ไม่พบโปรเจกต์ที่ตรงกับตัวกรอง"),
    ).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีโปรเจกต์")).toBeNull();
    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(await screen.findByText("Secret")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("status", { name: "ผลการกรอง" })).toHaveTextContent(
      "",
    );
  });
});

describe("denied state", () => {
  it("shows denied for an Organization the user does not belong to, without a request", async () => {
    renderPage(B);
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูโปรเจกต์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(fetchListMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it.each(["MEMBERSHIP_DENIED", "PERMISSION_DENIED"])(
    "shows denied when the API answers 403 %s",
    async (code) => {
      fetchListMock.mockRejectedValue(new ApiError(code, "denied", 403));
      renderPage();
      expect(
        await screen.findByText("คุณไม่มีสิทธิ์ดูโปรเจกต์ขององค์กรนี้"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    },
  );
});

describe("row actions (OD-01)", () => {
  it("gives an owner edit and delete on every row", async () => {
    fetchListMock.mockResolvedValue({
      projects: [project({ name: "A1", myRole: null })],
    });
    renderPage();
    await screen.findByText("A1");
    expect(
      screen.getByRole("button", { name: "แก้ไข A1" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบ A1" })).toBeInTheDocument();
  });

  it("gives a project admin edit only, and a project member nothing", async () => {
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValue({
      projects: [
        project({ name: "Mine", myRole: "admin" }),
        project({ name: "Joined", myRole: "member" }),
      ],
    });
    renderPage();
    await screen.findByText("Mine");
    expect(
      screen.getByRole("button", { name: "แก้ไข Mine" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลบ Mine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "แก้ไข Joined" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ลบ Joined" })).toBeNull();
  });
});

describe("limit (AC-11)", () => {
  it("disables create with the cap message at 50 projects", async () => {
    fetchListMock.mockResolvedValue({
      projects: Array.from({ length: 50 }, () => project()),
    });
    renderPage();
    const button = await screen.findByRole("button", { name: "สร้างโปรเจกต์" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "องค์กรมีโปรเจกต์ครบ 50 โปรเจกต์แล้ว ลบโปรเจกต์ที่ไม่ใช้ก่อนสร้างใหม่",
    );
  });

  it("keeps create enabled at 49 projects", async () => {
    fetchListMock.mockResolvedValue({
      projects: Array.from({ length: 49 }, () => project()),
    });
    renderPage();
    expect(
      await screen.findByRole("button", { name: "สร้างโปรเจกต์" }),
    ).toBeEnabled();
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
      within(dialog).getByLabelText("ชื่อโปรเจกต์"),
      "  New one ",
    );
    await user.type(within(dialog).getByLabelText("slug"), "new-one");
    await user.click(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(A, {
        name: "  New one ",
        slug: "new-one",
        description: "",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(await screen.findByText("new-one")).toBeInTheDocument();
    expect(screen.getByText("สร้างโปรเจกต์ New one แล้ว")).toBeInTheDocument();
  });

  it("marks the slug field on 409 and keeps every value (AC-04)", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockRejectedValue(
      new ApiError("PROJECT_SLUG_TAKEN", "taken", 409, { field: "slug" }),
    );
    await user.type(within(dialog).getByLabelText("ชื่อโปรเจกต์"), "Payments");
    await user.type(within(dialog).getByLabelText("slug"), "payments");
    await user.type(
      within(dialog).getByLabelText("คำอธิบาย (ไม่บังคับ)"),
      "Team A",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    );

    const slug = within(dialog).getByLabelText("slug");
    await waitFor(() => {
      expect(slug).toHaveAccessibleDescription(
        expect.stringContaining("slug นี้ถูกใช้แล้วในองค์กร"),
      );
    });
    expect(slug).toBeInvalid();
    expect(slug).toHaveFocus();
    expect(slug).toHaveValue("payments");
    expect(within(dialog).getByLabelText("ชื่อโปรเจกต์")).toHaveValue(
      "Payments",
    );
    expect(within(dialog).getByLabelText("คำอธิบาย (ไม่บังคับ)")).toHaveValue(
      "Team A",
    );
  });

  it("rejects an invalid slug in the browser without a request", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("ชื่อโปรเจกต์"), "Payments");
    await user.type(within(dialog).getByLabelText("slug"), "Bad Slug");
    await user.click(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    );
    expect(
      await within(dialog).findByText(/slug ยาว 3 ถึง 40 ตัว/, {
        selector: "span[role=alert]",
      }),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("shows the cap message at form level on PROJECT_LIMIT_REACHED", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockRejectedValue(
      new ApiError("PROJECT_LIMIT_REACHED", "limit", 409),
    );
    await user.type(within(dialog).getByLabelText("ชื่อโปรเจกต์"), "Payments");
    await user.type(within(dialog).getByLabelText("slug"), "payments");
    await user.click(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    );
    expect(
      await within(dialog).findByText(
        "องค์กรมีโปรเจกต์ครบ 50 โปรเจกต์แล้ว ลบโปรเจกต์ที่ไม่ใช้ก่อนสร้างใหม่",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the dialog and reloads the list on PERMISSION_DENIED", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({ projects: [project()] });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    await user.type(within(dialog).getByLabelText("ชื่อโปรเจกต์"), "Payments");
    await user.type(within(dialog).getByLabelText("slug"), "payments");
    const callsBefore = fetchListMock.mock.calls.length;
    await user.click(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
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
    const opener = await screen.findByRole("button", { name: "สร้างโปรเจกต์" });
    const dialog = await openCreate(user);
    const name = within(dialog).getByLabelText("ชื่อโปรเจกต์");
    expect(name).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    ).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
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
      await screen.findByRole("button", { name: "แก้ไข Payments" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "แก้ไขโปรเจกต์ Payments",
    });
    expect(within(dialog).queryByLabelText("slug")).toBeNull();
    expect(within(dialog).getByText("payments")).toHaveClass("font-mono");
    updateMock.mockResolvedValue({ ...target, name: "Payments v2" });

    const name = within(dialog).getByLabelText("ชื่อโปรเจกต์");
    await user.clear(name);
    await user.type(name, "Payments v2");
    await user.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(A, target.id, {
        name: "Payments v2",
        description: "Team A",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("delete (AC-08)", () => {
  it("names the consequences and makes no request on cancel", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({
      projects: [project({ name: "Payments" })],
    });
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "ลบ Payments" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "ลบโปรเจกต์ Payments",
    });
    expect(dialog).toHaveTextContent(
      "มอนิเตอร์ สมาชิก และการเชื่อมต่อ AWS ของโปรเจกต์นี้จะถูกลบด้วย และกู้คืนไม่ได้",
    );
    await user.click(within(dialog).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes after confirmation and reloads the list", async () => {
    const user = userEvent.setup();
    const target = project({ name: "Payments" });
    fetchListMock.mockResolvedValueOnce({ projects: [target] });
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "ลบ Payments" }),
    );
    const dialog = await screen.findByRole("dialog");
    deleteMock.mockResolvedValue(undefined);
    fetchListMock.mockResolvedValue({ projects: [] });
    await user.click(
      within(dialog).getByRole("button", { name: "ลบโปรเจกต์" }),
    );
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(A, target.id);
    });
    expect(await screen.findByText("ยังไม่มีโปรเจกต์")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes and reloads when the project is already gone", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValue({
      projects: [project({ name: "Payments" })],
    });
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "ลบ Payments" }),
    );
    const dialog = await screen.findByRole("dialog");
    deleteMock.mockRejectedValue(
      new ApiError("PROJECT_NOT_FOUND", "gone", 404),
    );
    const callsBefore = fetchListMock.mock.calls.length;
    await user.click(
      within(dialog).getByRole("button", { name: "ลบโปรเจกต์" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(fetchListMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe("role changed under the user", () => {
  const ROLE_CHANGED =
    "สิทธิ์ของคุณในองค์กรเปลี่ยนไป รายการถูกโหลดใหม่ตามสิทธิ์ปัจจุบัน";

  it.each(["edit", "delete"] as const)(
    "reloads the list and the role after a denied %s",
    async (action) => {
      const user = userEvent.setup();
      const target = project({ name: "Payments", myRole: "admin" });
      fetchListMock.mockResolvedValueOnce({ projects: [target] });
      renderPage();
      const opener = await screen.findByRole("button", {
        name: `${action === "edit" ? "แก้ไข" : "ลบ"} Payments`,
      });
      fetchMeContextMock.mockResolvedValue(context("viewer"));
      fetchListMock.mockResolvedValue({ projects: [target] });
      const denied = new ApiError("PERMISSION_DENIED", "no", 403);
      updateMock.mockRejectedValue(denied);
      deleteMock.mockRejectedValue(denied);

      await user.click(opener);
      const dialog = await screen.findByRole("dialog");
      const listCallsBefore = fetchListMock.mock.calls.length;
      await user.click(
        within(dialog).getByRole("button", {
          name: action === "edit" ? "บันทึก" : "ลบโปรเจกต์",
        }),
      );

      expect(await screen.findByText(ROLE_CHANGED)).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "สร้างโปรเจกต์" }),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: /^ลบ / })).toBeNull();
      });
      expect(fetchMeContextMock.mock.calls.length).toBeGreaterThan(1);
      expect(fetchListMock.mock.calls.length - listCallsBefore).toBe(1);
    },
  );
  it("reloads the list once when only the project role changed", async () => {
    const user = userEvent.setup();
    fetchMeContextMock.mockResolvedValue(context("viewer"));
    fetchListMock.mockResolvedValueOnce({
      projects: [project({ name: "Payments", myRole: "admin" })],
    });
    renderPage();
    const opener = await screen.findByRole("button", {
      name: "แก้ไข Payments",
    });
    fetchListMock.mockResolvedValue({
      projects: [project({ name: "Payments", myRole: "member" })],
    });
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no", 403));
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    const listCallsBefore = fetchListMock.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "บันทึก" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "แก้ไข Payments" }),
      ).toBeNull();
    });
    expect(fetchListMock.mock.calls.length - listCallsBefore).toBe(1);
  });
});

describe("stale list", () => {
  it("warns when a refetch fails after a successful load and drops the success notice", async () => {
    const user = userEvent.setup();
    fetchListMock.mockResolvedValueOnce({
      projects: [project({ name: "Old" })],
    });
    renderPage();
    const dialog = await openCreate(user);
    createMock.mockResolvedValue(project({ name: "Fresh" }));
    fetchListMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    await user.type(within(dialog).getByLabelText("ชื่อโปรเจกต์"), "Fresh");
    await user.type(within(dialog).getByLabelText("slug"), "fresh");
    await user.click(
      within(dialog).getByRole("button", { name: "สร้างโปรเจกต์" }),
    );

    expect(
      await screen.findByText(/อัปเดตรายการไม่สำเร็จ/),
    ).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.queryByText("สร้างโปรเจกต์ Fresh แล้ว")).toBeNull();

    // A later reload that succeeds must not bring back the old notice.
    fetchListMock.mockResolvedValue({
      projects: [project({ name: "Old" }), project({ name: "Fresh" })],
    });
    await queryClients.at(-1)?.invalidateQueries();
    expect(await screen.findByText("Fresh")).toBeInTheDocument();
    expect(screen.queryByText(/อัปเดตรายการไม่สำเร็จ/)).toBeNull();
    expect(screen.queryByText("สร้างโปรเจกต์ Fresh แล้ว")).toBeNull();
  });
});
