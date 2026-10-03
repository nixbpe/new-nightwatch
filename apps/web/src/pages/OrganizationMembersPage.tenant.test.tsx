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
import {
  cancelInvitation,
  createInvitation,
  fetchPendingInvitations,
  resendInvitation,
} from "../lib/api/invitations";
import { fetchMeContext, updateActiveOrganization } from "../lib/api/me";
import { fetchOrganizationMembers } from "../lib/api/members";
import {
  claimContextPublication,
  createContextPublicationClaim,
  publishContextPublication,
} from "../lib/queryClient";
import { TenantProvider, useTenant } from "../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "./OrganizationMembersPage";

vi.mock("../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  fetchPendingInvitations: vi.fn(async (organizationId: string) =>
    (await import("../test/pendingInvitations")).emptyPendingInvitationList(
      organizationId,
    ),
  ),
}));
vi.mock("../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
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
const aList: OrganizationMemberListResponse = {
  organizationId: A,
  members: [
    {
      id: "member-1",
      userId: "user-1",
      name: "Ada",
      email: "ada@example.test",
      role: "owner",
    },
  ],
  page: { limit: 50, offset: 0, total: 1 },
  memberLimit: 1000,
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
        onClick={() => void navigate(`/organizations/${B}/members`)}
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
            memberLimit: 1000,
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
            memberLimit: 1000,
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

it.each([
  ["succeeds", () => Promise.resolve({ canceled: true as const })],
  [
    "is denied",
    () => Promise.reject(new ApiError("PERMISSION_DENIED", "denied", 403)),
  ],
])(
  "keeps B untouched by a late A cancel that %s after a confirmed switch",
  async (_label, outcome) => {
    const row = (id: string, email: string) => ({
      organizationId: id,
      invitations: [
        {
          publicId: "00000000-0000-4000-8000-000000000001",
          email,
          role: "viewer" as const,
          sentAt: "2026-09-30T08:00:00.000Z",
          expiresAt: "2026-10-02T08:00:00.000Z",
          expired: false,
          resendAvailableAt: "2026-09-30T08:05:00.000Z",
          manageable: true,
        },
      ],
      activeCount: 1,
      activeLimit: 100 as const,
      page: { limit: 50, offset: 0, total: 1 },
    });
    vi.mocked(fetchPendingInvitations).mockImplementation((id) =>
      Promise.resolve(
        id === A
          ? row(A, "a-only@example.test")
          : row(B, "b-only@example.test"),
      ),
    );
    const lateCancel = Promise.withResolvers<undefined>();
    vi.mocked(cancelInvitation).mockImplementation(async () => {
      await lateCancel.promise;
      return outcome();
    });
    vi.mocked(fetchMeContext).mockResolvedValue(context);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context,
      lastActiveTenantId: B,
    });
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
          <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
            <TenantView />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "ยกเลิกคำเชิญถึง a-only@example.test",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "ยืนยันการยกเลิกคำเชิญ" }),
    );
    expect(cancelInvitation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "confirm B" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
    );
    await user.click(screen.getByRole("button", { name: "navigate B" }));
    expect(await screen.findByText("b-only@example.test")).toBeInTheDocument();
    const listCalls = vi.mocked(fetchPendingInvitations).mock.calls.length;
    const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;

    await act(async () => {
      lateCancel.resolve(undefined);
      await lateCancel.promise;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("b-only@example.test")).toBeInTheDocument();
    expect(screen.queryByText(/ยกเลิกคำเชิญถึง .* แล้ว|ไม่สำเร็จ/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(fetchPendingInvitations).mock.calls).toHaveLength(
      listCalls,
    );
    expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
    expect(cancelInvitation).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [
    "succeeds",
    () =>
      Promise.resolve({
        resent: true as const,
        emailDispatch: "accepted" as const,
        sentAt: "2026-10-01T08:00:00.000Z",
        expiresAt: "2026-10-03T08:00:00.000Z",
        resendAvailableAt: "2026-10-01T08:05:00.000Z",
      }),
  ],
  [
    "is denied",
    () => Promise.reject(new ApiError("PERMISSION_DENIED", "denied", 403)),
  ],
])(
  "keeps B untouched by a late A resend that %s after a confirmed switch",
  async (_label, outcome) => {
    const row = (id: string, email: string) => ({
      organizationId: id,
      invitations: [
        {
          publicId: "00000000-0000-4000-8000-000000000001",
          email,
          role: "viewer" as const,
          sentAt: "2026-09-30T08:00:00.000Z",
          expiresAt: "2026-10-02T08:00:00.000Z",
          expired: false,
          resendAvailableAt: "2026-09-30T08:05:00.000Z",
          manageable: true,
        },
      ],
      activeCount: 1,
      activeLimit: 100 as const,
      page: { limit: 50, offset: 0, total: 1 },
    });
    vi.mocked(fetchPendingInvitations).mockImplementation((id) =>
      Promise.resolve(
        id === A
          ? row(A, "a-only@example.test")
          : row(B, "b-only@example.test"),
      ),
    );
    const lateResend = Promise.withResolvers<undefined>();
    vi.mocked(resendInvitation).mockImplementation(async () => {
      await lateResend.promise;
      return outcome();
    });
    vi.mocked(fetchMeContext).mockResolvedValue(context);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context,
      lastActiveTenantId: B,
    });
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
          <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
            <TenantView />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "ส่งซ้ำคำเชิญถึง a-only@example.test",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "ยืนยันการส่งคำเชิญซ้ำ" }),
    );
    expect(resendInvitation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "confirm B" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
    );
    await user.click(screen.getByRole("button", { name: "navigate B" }));
    expect(await screen.findByText("b-only@example.test")).toBeInTheDocument();
    const listCalls = vi.mocked(fetchPendingInvitations).mock.calls.length;
    const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;

    await act(async () => {
      lateResend.resolve(undefined);
      await lateResend.promise;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("b-only@example.test")).toBeInTheDocument();
    expect(screen.queryByText(/ส่งคำเชิญซ้ำ|ไม่สำเร็จ/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(fetchPendingInvitations).mock.calls).toHaveLength(
      listCalls,
    );
    expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
    expect(resendInvitation).toHaveBeenCalledTimes(1);
  },
);
