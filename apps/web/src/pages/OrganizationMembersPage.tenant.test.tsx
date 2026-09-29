import type {
  InvitationCreateResponse,
  MeContextResponse,
  OrganizationMemberListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { OrgSwitcher } from "../components/shell/OrgSwitcher";
import { createInvitation } from "../lib/api/invitations";
import {
  ME_CONTEXT_QUERY_KEY,
  fetchMeContext,
  updateActiveOrganization,
} from "../lib/api/me";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
  updateOrganizationMemberRole,
} from "../lib/api/members";
import {
  claimContextPublication,
  createContextPublicationClaim,
  getContextPublicationSnapshot,
  publishContextPublication,
  subscribeToContextPublication,
} from "../lib/queryClient";
import { TenantProvider, useTenant } from "../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "./OrganizationMembersPage";

vi.mock("../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createInvitation: vi.fn(),
}));
vi.mock("../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
  updateOrganizationMemberRole: vi.fn(),
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const context: MeContextResponse = {
  user: {
    id: "user-1",
    name: "Tester",
    email: "tester@example.test",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [
    { id: A, name: "Acme", slug: "acme", role: "owner" },
    { id: B, name: "Beta", slug: "beta", role: "owner" },
  ],
  lastActiveTenantId: A,
};
const aMember = {
  id: "member-1",
  userId: "user-1",
  name: "Ada",
  email: "ada@example.test",
  role: "owner",
} as const;
const aList: OrganizationMemberListResponse = {
  organizationId: A,
  members: [aMember],
  page: { limit: 50, offset: 0, total: 1 },
};
function RepublishSameOrganization({
  queryClient,
}: {
  queryClient: QueryClient;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const claim = createContextPublicationClaim();
        claimContextPublication(queryClient, claim);
        queryClient.setQueryData(["me", "context"], { ...context });
        publishContextPublication(queryClient, claim);
      }}
    >
      republish A
    </button>
  );
}

function SwitcherView() {
  return (
    <>
      <OrgSwitcher collapsed={false} />
      <output data-testid="location">{useLocation().pathname}</output>
      <Routes>
        <Route
          path="/organizations/:organizationId/members"
          element={<OrganizationMembersPage />}
        />
      </Routes>
    </>
  );
}

function TenantView() {
  const { serverActiveOrgId, switchOrg } = useTenant();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void switchOrg(B)}>
        confirm B
      </button>
      <button type="button" onClick={() => void switchOrg(A)}>
        confirm A
      </button>
      <button
        type="button"
        onClick={() =>
          void navigate(`/organizations/${B}/members`, {
            state: { focusMemberHeadingFor: B },
          })
        }
      >
        navigate B
      </button>
      <output data-testid="active-scope">{serverActiveOrgId}</output>
      <output data-testid="location">{useLocation().pathname}</output>
      <Routes>
        <Route
          path="/organizations/:organizationId/members"
          element={<OrganizationMembersPage />}
        />
      </Routes>
    </>
  );
}

it("keeps an A invitation pending and its draft through a confirmed same-org publication", async () => {
  const post = Promise.withResolvers<InvitationCreateResponse>();
  vi.mocked(createInvitation).mockReturnValue(post.promise);
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(fetchOrganizationMembers).mockResolvedValue(aList);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <RepublishSameOrganization queryClient={queryClient} />
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Ada")).toBeInTheDocument();
  await user.type(
    screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
    "a-draft@example.test",
  );
  await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
  await user.click(screen.getByRole("button", { name: "republish A" }));
  expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
    "a-draft@example.test",
  );
  expect(
    screen.getByRole("button", { name: "กำลังส่งคำเชิญ…" }),
  ).toBeDisabled();
  await act(async () => {
    post.resolve({ created: true, emailDispatch: "failed" });
    await post.promise;
  });
  expect(
    screen.getByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ"),
  ).toHaveAttribute("role", "status");
  await user.click(screen.getByRole("button", { name: "republish A" }));
  expect(
    screen.getByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ"),
  ).toHaveAttribute("role", "status");
  expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
});

it("keeps a bookmarked B draft when A is republished without a switch", async () => {
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve({ ...aList, organizationId: id }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${B}/members`]}>
          <RepublishSameOrganization queryClient={queryClient} />
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  const email = await screen.findByLabelText("อีเมลของผู้ได้รับเชิญ");
  await user.type(email, "bookmarked@example.test");
  await user.click(screen.getByRole("button", { name: "republish A" }));
  expect(email).toHaveValue("bookmarked@example.test");
  expect(screen.getByTestId("active-scope")).toHaveTextContent(A);
});

it("keeps a bookmarked B invitation draft through confirmed A to B publication and settled navigation", async () => {
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(updateActiveOrganization).mockResolvedValue({
    ...context,
    lastActiveTenantId: B,
  });
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve(
      id === A
        ? aList
        : {
            organizationId: B,
            members: [
              {
                id: "member-b",
                userId: "user-b",
                name: "Bea",
                email: "bea@example.test",
                role: "owner",
              },
            ],
            page: { limit: 50, offset: 0, total: 1 },
          },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${B}/members`]}>
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Bea")).toBeInTheDocument();
  expect(screen.queryByText("Ada")).toBeNull();
  expect(screen.getByTestId("active-scope")).toHaveTextContent(A);
  const email = screen.getByLabelText("อีเมลของผู้ได้รับเชิญ");
  await user.type(email, "b-draft@example.test");
  await user.selectOptions(screen.getByLabelText("บทบาท"), "admin");
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() =>
    expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${B}/members`,
  );
  expect(
    screen.getByRole("heading", { name: "เชิญสมาชิกเข้าสู่ Beta" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
    "b-draft@example.test",
  );
  expect(screen.getByLabelText("บทบาท")).toHaveValue("admin");
  await user.click(screen.getByRole("button", { name: "navigate B" }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${B}/members`,
  );
  expect(screen.getByText("Bea")).toBeInTheDocument();
  expect(screen.queryByText("Ada")).toBeNull();
  expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
    "b-draft@example.test",
  );
  expect(screen.getByLabelText("บทบาท")).toHaveValue("admin");
});

it("retains A on denied B, then rejects old A completion after confirmed B then A", async () => {
  const post = Promise.withResolvers<InvitationCreateResponse>();
  vi.mocked(createInvitation).mockReturnValue(post.promise);
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(updateActiveOrganization)
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce({ ...context, lastActiveTenantId: B })
    .mockResolvedValueOnce(context);
  vi.mocked(fetchOrganizationMembers).mockResolvedValue(aList);
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Ada")).toBeInTheDocument();
  await user.type(
    screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
    "a-draft@example.test",
  );
  await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() => {
    expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByTestId("active-scope")).toHaveTextContent(A);
  expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
    "a-draft@example.test",
  );
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() =>
    expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
  );
  expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  await user.click(screen.getByRole("button", { name: "confirm A" }));
  await waitFor(() =>
    expect(screen.getByTestId("active-scope")).toHaveTextContent(A),
  );
  expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  await act(async () => {
    post.resolve({ created: true, emailDispatch: "failed" });
    await post.promise;
  });
  expect(screen.queryByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ")).toBeNull();
  expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
});

afterEach(() => vi.resetAllMocks());

it("retires an A invitation on real tenant publication while navigation still holds A", async () => {
  const post = Promise.withResolvers<InvitationCreateResponse>();
  vi.mocked(createInvitation).mockImplementation(() => post.promise);
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(updateActiveOrganization).mockResolvedValue({
    ...context,
    lastActiveTenantId: B,
  });
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve(
      id === A
        ? aList
        : {
            organizationId: B,
            members: [],
            page: { limit: 50, offset: 0, total: 0 },
          },
    ),
  );
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Ada")).toBeInTheDocument();
  await user.type(
    screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
    "a-draft@example.test",
  );
  await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
  expect(vi.mocked(createInvitation)).toHaveBeenCalledWith(A, {
    email: "a-draft@example.test",
    role: "viewer",
  });
  expect(
    screen.getByRole("button", { name: "กำลังส่งคำเชิญ…" }),
  ).toBeDisabled();
  expect(screen.getByTestId("active-scope")).toHaveTextContent(A);
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() =>
    expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "เชิญสมาชิกเข้าสู่ Acme" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "confirm B" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "navigate B" }));
  const bEmail = await screen.findByLabelText("อีเมลของผู้ได้รับเชิญ");
  await user.type(bEmail, "b-draft@example.test");
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${B}/members`,
  );
  expect(bEmail).toHaveValue("b-draft@example.test");
  await act(async () => {
    post.resolve({ created: true, emailDispatch: "failed" });
    await post.promise;
  });
  expect(screen.queryByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "เชิญสมาชิกเข้าสู่ Acme" }),
  ).toBeNull();
  expect(
    screen.getByRole("heading", { name: "เชิญสมาชิกเข้าสู่ Beta" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("active-scope")).toHaveTextContent(B);
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${B}/members`,
  );
  expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
    "b-draft@example.test",
  );
  expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
});

it("keeps A role action on denied switch and discards late A mutation after confirmed B", async () => {
  const patch = Promise.withResolvers<{
    member: {
      id: string;
      userId: string;
      organizationId: string;
      role: "admin";
    };
  }>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(patch.promise);
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(updateActiveOrganization)
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce({ ...context, lastActiveTenantId: B });
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve(
      id === A
        ? aList
        : {
            organizationId: B,
            members: [
              {
                ...aMember,
                id: "member-b",
                name: "Bea",
                role: "viewer",
              },
            ],
            page: { limit: 50, offset: 0, total: 1 },
          },
    ),
  );
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Ada");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "บทบาทของ Ada" }),
    "admin",
  );
  await user.click(screen.getByRole("button", { name: "บันทึกบทบาทของ Ada" }));
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  expect(screen.getByTestId("active-scope")).toHaveTextContent(A);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() =>
    expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  const oldHeading = screen.getByRole("heading", { name: "สมาชิก" });
  expect(oldHeading).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "navigate B" }));
  expect(await screen.findByText("Bea")).toBeInTheDocument();
  expect(oldHeading.isConnected).toBe(false);
  expect(screen.getByRole("heading", { name: "สมาชิก" })).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "บทบาทของ Bea" })).toHaveValue(
    "viewer",
  );
  await act(async () => {
    patch.resolve({
      member: {
        id: "member-1",
        userId: "user-1",
        organizationId: A,
        role: "admin",
      },
    });
    await patch.promise;
  });
  expect(screen.getByTestId("active-scope")).toHaveTextContent(B);
  expect(screen.getByRole("combobox", { name: "บทบาทของ Bea" })).toHaveValue(
    "viewer",
  );
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["updated", "removed"] as const)(
  "restores direct role-save focus after the table remounts: target %s",
  async (outcome) => {
    const target = {
      id: "member-2",
      userId: "user-2",
      name: "Bea",
      email: "bea@example.test",
      role: "viewer" as const,
    };
    const refreshed = Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchMeContext).mockResolvedValue(context);
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce({
        ...aList,
        members: [aMember, target],
        page: { limit: 50, offset: 0, total: 2 },
      })
      .mockImplementationOnce(() => refreshed.promise);
    vi.mocked(updateOrganizationMemberRole).mockResolvedValue({
      member: {
        id: target.id,
        userId: target.userId,
        organizationId: A,
        role: "admin",
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
            <TenantView />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Bea");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "บทบาทของ Bea" }),
      "admin",
    );
    const oldSave = screen.getByRole("button", { name: "บันทึกบทบาทของ Bea" });
    oldSave.focus();
    await user.keyboard("{Enter}");
    expect(oldSave.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByText("กำลังโหลดสมาชิก")).toBeInTheDocument();
    await act(async () => {
      refreshed.resolve({
        ...aList,
        members:
          outcome === "updated"
            ? [aMember, { ...target, role: "admin" }]
            : [aMember],
        page: { limit: 50, offset: 0, total: outcome === "updated" ? 2 : 1 },
      });
      await refreshed.promise;
    });
    if (outcome === "updated") {
      const liveAction = screen.getByRole("combobox", {
        name: "บทบาทของ Bea",
      });
      expect(liveAction).toHaveFocus();
      expect(liveAction).not.toBe(oldSave);
      expect(
        screen.getByRole("button", { name: "บันทึกบทบาทของ Bea" }),
      ).toBeDisabled();
    } else {
      expect(
        screen.queryByRole("combobox", { name: "บทบาทของ Bea" }),
      ).toBeNull();
      expect(screen.getByRole("heading", { name: "สมาชิก" })).toHaveFocus();
    }
    expect(oldSave.isConnected).toBe(false);
  },
);

it("does not restore the old direct role action over B after a confirmed switch", async () => {
  const patch = Promise.withResolvers<{
    member: { id: string; userId: string; organizationId: string; role: "admin" };
  }>();
  const target = {
    ...aMember,
    id: "member-2",
    userId: "user-2",
    name: "Bea",
    role: "viewer" as const,
  };
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(updateActiveOrganization).mockResolvedValue({
    ...context,
    lastActiveTenantId: B,
  });
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve(
      id === A
        ? {
            ...aList,
            members: [aMember, target],
            page: { ...aList.page, total: 2 },
          }
        : {
            organizationId: B,
            members: [{ ...target, id: "member-b", name: "Bree" }],
            page: { limit: 50, offset: 0, total: 1 },
          },
    ),
  );
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(patch.promise);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <TenantView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Bea");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "บทบาทของ Bea" }),
    "admin",
  );
  const oldSave = screen.getByRole("button", { name: "บันทึกบทบาทของ Bea" });
  oldSave.focus();
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await user.click(screen.getByRole("button", { name: "navigate B" }));
  expect(await screen.findByText("Bree")).toBeInTheDocument();
  const bHeading = screen.getByRole("heading", { name: "สมาชิก" });
  expect(bHeading).toHaveFocus();
  await act(async () => {
    patch.resolve({
      member: {
        id: target.id,
        userId: target.userId,
        organizationId: A,
        role: "admin",
      },
    });
    await patch.promise;
  });
  expect(oldSave.isConnected).toBe(false);
  expect(bHeading).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "บทบาทของ Bree" })).toHaveValue(
    "viewer",
  );
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
});

it.each([
  { actorRole: "owner", nextRole: "viewer", readableB: true },
  { actorRole: "admin", nextRole: "auditor", readableB: false },
] as const)(
  "routes a successful $actorRole self-demotion to $nextRole after one denied-list context refresh (readable B: $readableB)",
  async ({ actorRole, nextRole, readableB }) => {
    const initial: MeContextResponse = {
      ...context,
      organizations: [
        { id: A, name: "Acme", slug: "acme", role: actorRole },
        {
          id: B,
          name: "Beta",
          slug: "beta",
          role: readableB ? "owner" : "viewer",
        },
      ],
    };
    const refreshed: MeContextResponse = {
      ...initial,
      organizations: initial.organizations.map((organization) =>
        organization.id === A
          ? { ...organization, role: nextRole }
          : organization,
      ),
    };
    const nextContext = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext)
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(nextContext.promise)
      .mockRejectedValue(new Error("unexpected second context refresh"));
    let changed = false;
    vi.mocked(updateOrganizationMemberRole).mockImplementation(() => {
      changed = true;
      return Promise.resolve({
        member: {
          id: aMember.id,
          userId: aMember.userId,
          organizationId: A,
          role: nextRole,
        },
      });
    });
    vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
      if (id === B) {
        return Promise.resolve({
          organizationId: B,
          members: [
            {
              ...aMember,
              id: "member-b",
              userId: "user-b",
              name: "Bea",
              email: "bea@example.test",
            },
          ],
          page: { limit: 50, offset: 0, total: 1 },
        });
      }
      if (changed)
        return Promise.reject(
          new ApiError("PERMISSION_DENIED", "role downgraded", 403),
        );
      return Promise.resolve({
        ...aList,
        members: [{ ...aMember, role: actorRole }],
      });
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const claims: (bigint | null)[] = [];
    const unsubscribe = subscribeToContextPublication(queryClient, () => {
      claims.push(getContextPublicationSnapshot(queryClient).claim);
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
            <TenantView />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Ada");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "บทบาทของ Ada" }),
      nextRole,
    );
    await user.click(
      screen.getByRole("button", { name: "บันทึกบทบาทของ Ada" }),
    );
    if (actorRole === "owner") {
      await user.click(
        screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
      );
    }
    expect(
      await screen.findByRole("status", {
        name: "กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ada@example.test")).toBeNull();
    expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/members`,
    );
    expect(fetchMeContext).toHaveBeenCalledTimes(2);
    await act(async () => {
      nextContext.resolve(refreshed);
      await nextContext.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        readableB ? `/organizations/${B}/members` : "/workspace",
      ),
    );
    if (readableB) {
      expect(await screen.findByText("Bea")).toBeInTheDocument();
      expect(screen.queryByText("Ada")).toBeNull();
      expect(screen.queryByText("ada@example.test")).toBeNull();
      expect(fetchOrganizationMembers).toHaveBeenCalledTimes(3);
    } else {
      expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    }
    expect(fetchMeContext).toHaveBeenCalledTimes(2);
    expect(claims).toHaveLength(1);
    expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
    expect(
      screen.queryByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
    ).toBeNull();
    unsubscribe();
  },
);

it.each(["success", "failure"] as const)(
  "refreshes both cached pages and context after role %s",
  async (outcome) => {
    const secondMember = {
      ...aMember,
      id: "member-51",
      userId: "user-51",
      name: "Bea",
      role: "admin",
    } as const;
    const secondPage: OrganizationMemberListResponse = {
      organizationId: A,
      members: [secondMember],
      page: { limit: 50, offset: 50, total: 51 },
    };
    const confirmedFirstPage =
      Promise.withResolvers<OrganizationMemberListResponse>();
    let changed = false;
    vi.mocked(fetchMeContext).mockResolvedValue(context);
    vi.mocked(fetchOrganizationMembers).mockImplementation(
      (_id, _limit, offset) => {
        if (offset === 50) {
          return Promise.resolve(
            changed
              ? {
                  ...secondPage,
                  members: [
                    {
                      ...secondMember,
                      role: outcome === "success" ? "viewer" : "auditor",
                    },
                  ],
                }
              : secondPage,
          );
        }
        return changed
          ? confirmedFirstPage.promise
          : Promise.resolve({ ...aList, page: { ...aList.page, total: 51 } });
      },
    );
    vi.mocked(updateOrganizationMemberRole).mockImplementation(() => {
      changed = true;
      return outcome === "failure"
        ? Promise.reject(new Error("concurrent update"))
        : Promise.resolve({
            member: {
              id: "member-51",
              userId: "user-51",
              organizationId: A,
              role: "viewer",
            },
          });
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
            <TenantView />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("Bea")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "บทบาทของ Bea" }),
      "viewer",
    );
    await user.click(
      screen.getByRole("button", { name: "บันทึกบทบาทของ Bea" }),
    );
    expect(
      await screen.findByText(
        outcome === "success"
          ? "บันทึกบทบาทแล้ว"
          : "บันทึกบทบาทไม่สำเร็จ โหลดบทบาทล่าสุดแล้ว",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "บทบาทของ Bea" })).toHaveValue(
      outcome === "success" ? "viewer" : "auditor",
    );
    expect(queryClient.getQueryState(ME_CONTEXT_QUERY_KEY)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(memberListQueryKey(A, 50, 0))?.isInvalidated,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "ก่อนหน้า" }));
    expect(screen.getByText("กำลังโหลดสมาชิก")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "บทบาทของ Ada" })).toBeNull();
    confirmedFirstPage.resolve({
      ...aList,
      members: [{ ...aMember, role: "admin" }],
      page: { ...aList.page, total: 51 },
    });
    expect(
      await screen.findByRole("combobox", { name: "บทบาทของ Ada" }),
    ).toHaveValue("admin");
    expect(
      vi
        .mocked(fetchOrganizationMembers)
        .mock.calls.filter(([, , offset]) => offset === 0),
    ).toHaveLength(2);
  },
);

it("focuses the live B heading after a confirmed switch closes the A role dialog", async () => {
  const switchResponse = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockResolvedValue(context);
  vi.mocked(updateActiveOrganization).mockReturnValue(switchResponse.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve(
      id === A
        ? aList
        : {
            organizationId: B,
            members: [
              {
                ...aMember,
                id: "member-b",
                userId: "user-b",
                name: "Bea",
              },
            ],
            page: { limit: 50, offset: 0, total: 1 },
          },
    ),
  );
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <SwitcherView />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Ada");
  await user.click(screen.getByRole("button", { name: /Acme/ }));
  await user.click(screen.getByRole("menuitemradio", { name: /Beta/ }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "บทบาทของ Ada" }),
    "admin",
  );
  await user.click(screen.getByRole("button", { name: "บันทึกบทบาทของ Ada" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  await act(async () => {
    switchResponse.resolve({ ...context, lastActiveTenantId: B });
    await switchResponse.promise;
  });
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
  const heading = screen.getByRole("heading", { name: "สมาชิก" });
  expect(heading).toHaveFocus();
  expect(heading.isConnected).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});
