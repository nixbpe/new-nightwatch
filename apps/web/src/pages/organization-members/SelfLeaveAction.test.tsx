import { guardUnassignedNetwork } from "../../test/guard-network";
import { useState, type ReactNode } from "react";
import { SelfLeaveRouteBoundary } from "./SelfLeaveAction";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type {
  MeContextResponse,
  OrganizationMemberListResponse,
  OrganizationMemberRoleUpdateResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import {
  fetchOrganizationMembers,
  leaveOrganization,
} from "../../lib/api/members";
import { TenantProvider, useTenant } from "../../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "../OrganizationMembersPage";
import { WorkspacePage } from "../WorkspacePage";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(async (organizationId: string) =>
    (await import("../../test/pendingInvitations")).emptyPendingInvitationList(
      organizationId,
    ),
  ),
}));
vi.mock("../../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
  leaveOrganization: vi.fn(),
}));

function MemberDataRouter({
  initialEntries,
  children,
}: {
  initialEntries: string[];
  children: ReactNode;
}) {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        {
          path: "*",
          element: <SelfLeaveRouteBoundary>{children}</SelfLeaveRouteBoundary>,
        },
      ],
      { initialEntries },
    ),
  );
  return <RouterProvider router={router} />;
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ME = "user-me";

const ORG_A = (role: OrganizationRole) =>
  ({ id: A, name: "Acme", slug: "acme", role }) as const;
const ORG_B = { id: B, name: "Beta", slug: "beta", role: "viewer" } as const;

function contextWith(
  organizations: MeContextResponse["organizations"],
  lastActiveTenantId: string | null = organizations[0]?.id ?? null,
): MeContextResponse {
  return {
    user: {
      id: ME,
      name: "Me",
      email: "me@example.test",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId,
  };
}

const list = (organizationId: string): OrganizationMemberListResponse => ({
  organizationId,
  members: [
    {
      id: "member-me",
      userId: ME,
      name: "Me",
      email: "me@example.test",
      role: "owner",
    },
  ],
  page: { limit: 50, offset: 0, total: 1 },
  memberLimit: 1000,
});

const left = (role: OrganizationRole = "viewer") =>
  ({
    member: { id: "member-me", userId: ME, organizationId: A, role },
  }) satisfies OrganizationMemberRoleUpdateResponse;

guardUnassignedNetwork();

beforeEach(() => {
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) =>
    Promise.resolve(list(id)),
  );
  vi.mocked(leaveOrganization).mockResolvedValue(left());
});
afterEach(async () => {
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.resetAllMocks();
});

function Harness() {
  const { switchOrg } = useTenant();
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => void navigate(`/organizations/${B}/members`)}
      >
        navigate B
      </button>
      <button type="button" onClick={() => void switchOrg(B)}>
        confirm B
      </button>
      <output data-testid="location">{useLocation().pathname}</output>
      <Routes>
        <Route
          path="/organizations/:organizationId/members"
          element={<OrganizationMembersPage />}
        />
        <Route path="/workspace" element={<WorkspacePage />} />
      </Routes>
    </>
  );
}

let queryClient: QueryClient;

async function renderAs(
  role: OrganizationRole,
  organizations: MeContextResponse["organizations"] = [ORG_A(role), ORG_B],
) {
  vi.mocked(fetchMeContext).mockResolvedValue(contextWith(organizations));
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, ME);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemberDataRouter initialEntries={[`/organizations/${A}/members`]}>
          <Harness />
        </MemberDataRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "ออกจากองค์กร" });
  return user;
}

const entry = () => screen.getByRole("button", { name: "ออกจากองค์กร" });
const confirmButton = () =>
  screen.getByRole("button", { name: "ยืนยันการออกจากองค์กร" });
const afterLeaveContext = () => {
  vi.mocked(fetchMeContext).mockResolvedValue(contextWith([ORG_B], B));
};

it.each(["viewer", "auditor"] as const)(
  "%s leaves without ever loading the member list and lands on the server-confirmed Organization",
  async (role) => {
    const user = await renderAs(role);
    expect(fetchOrganizationMembers).not.toHaveBeenCalled();
    expect(
      screen.getByText("คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้"),
    ).toBeInTheDocument();
    await user.click(entry());
    const dialog = screen.getByRole("dialog", {
      name: "ยืนยันการออกจากองค์กร",
    });
    expect(dialog).toHaveAccessibleDescription(
      /Me \(me@example.test\).*Acme \(acme\)/,
    );
    expect(dialog).toHaveAccessibleDescription(/องค์กรอื่นยังอยู่/);
    afterLeaveContext();
    await user.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/members`,
      ),
    );
    expect(leaveOrganization).toHaveBeenCalledTimes(1);
    expect(leaveOrganization).toHaveBeenCalledWith(A);
    expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/ไม่สำเร็จ/)).toBeNull();
  },
);

it.each(["owner", "admin"] as const)(
  "%s sees the self-leave entry below the member list and leaves to no-access when no Organization remains",
  async (role) => {
    const user = await renderAs(role, [ORG_A(role)]);
    expect(await screen.findByRole("row", { name: /Me/ })).toBeInTheDocument();
    const cachedLists = () =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["tenant", "members", A] })
        .filter((query) => query.state.data !== undefined);
    expect(cachedLists()).toHaveLength(1);
    vi.mocked(fetchMeContext).mockResolvedValue(contextWith([]));
    await user.click(entry());
    await user.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/workspace"),
    );
    expect(
      screen.getByRole("heading", {
        name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
      }),
    ).toHaveFocus();
    // A's member list data is gone with the membership.
    expect(cachedLists()).toHaveLength(0);
    expect(leaveOrganization).toHaveBeenCalledTimes(1);
  },
);

it("cancel and Escape send no request, keep the context and return focus to the opener", async () => {
  const user = await renderAs("viewer");
  const opener = entry();
  await user.click(opener);
  expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
  await user.click(opener);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
  expect(leaveOrganization).not.toHaveBeenCalled();
  expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
});

it("blocks a second confirm, cancel and Escape while the DELETE is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(leaveOrganization).mockReturnValue(pending.promise);
  const user = await renderAs("viewer");
  await user.click(entry());
  await user.click(confirmButton());
  const pendingConfirm = await screen.findByRole("button", {
    name: "กำลังออกจากองค์กร…",
  });
  expect(pendingConfirm).toBeDisabled();
  expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
  await user.click(pendingConfirm);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
  afterLeaveContext();
  await act(async () => {
    pending.resolve(left());
    await pending.promise;
  });
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
});

it("explains LAST_OWNER, refreshes the server-confirmed context, stays on A and returns focus to the entry", async () => {
  vi.mocked(leaveOrganization).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  await screen.findByRole("row", { name: /Me/ });
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.click(entry());
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
    /เจ้าของคนสุดท้ายออกไม่ได้/,
  );
  await user.click(confirmButton());
  expect(
    await screen.findByText(/องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน/),
  ).toHaveAttribute("role", "alert");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches + 1);
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(entry()).toHaveFocus());
  expect(await screen.findByRole("row", { name: /Me/ })).toBeInTheDocument();
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
});

it("announces another failure, refreshes the context and never replays the DELETE", async () => {
  vi.mocked(leaveOrganization).mockRejectedValue(
    new ApiError("INTERNAL_ERROR", "boom", 500),
  );
  const user = await renderAs("viewer");
  await user.click(entry());
  await user.click(confirmButton());
  expect(await screen.findByText(/ออกจากองค์กรไม่สำเร็จ/)).toHaveAttribute(
    "role",
    "alert",
  );
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  await waitFor(() => expect(entry()).toBeEnabled());
});

it("follows the server context when a failed DELETE had actually removed the actor", async () => {
  vi.mocked(leaveOrganization).mockRejectedValue(
    new ApiError("INTERNAL_ERROR", "boom", 500),
  );
  const user = await renderAs("viewer");
  await user.click(entry());
  afterLeaveContext();
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
  expect(screen.queryByText(/ไม่สำเร็จ|เจ้าของอย่างน้อย/)).toBeNull();
});

it("offers a retry of the context refresh, not of the DELETE, when the refresh fails", async () => {
  const user = await renderAs("viewer");
  await user.click(entry());
  vi.mocked(fetchMeContext).mockRejectedValueOnce(new Error("offline"));
  await user.click(confirmButton());
  const retry = await screen.findByRole("button", { name: "ลองอีกครั้ง" });
  afterLeaveContext();
  await user.click(retry);
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
});

it.each(["success", "LAST_OWNER"] as const)(
  "keeps B untouched by a late A %s response after switching to B",
  async (outcome) => {
    const pending =
      Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(leaveOrganization).mockReturnValue(pending.promise);
    vi.mocked(updateActiveOrganization).mockResolvedValue(
      contextWith([ORG_A("viewer"), ORG_B], B),
    );
    const user = await renderAs("viewer");
    await user.click(entry());
    await user.click(confirmButton());
    await user.click(screen.getByRole("button", { name: "confirm B" }));
    await waitFor(() => {
      expect(updateActiveOrganization).toHaveBeenCalled();
    });
    await user.click(screen.getByRole("button", { name: "navigate B" }));
    await screen.findByRole("button", { name: "ออกจากองค์กร" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
    await act(async () => {
      if (outcome === "success") pending.resolve(left());
      else pending.reject(new ApiError("LAST_OWNER", "late", 400));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    );
    expect(entry()).toBeEnabled();
    expect(screen.queryByText(/ไม่สำเร็จ|เจ้าของอย่างน้อย/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen
        .queryAllByRole("status")
        .filter((element) => !element.hasAttribute("data-testid")),
    ).toEqual([]);
    expect(leaveOrganization).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
  },
);

it("shows the Organization name and slug in the header of a viewer without a list", async () => {
  await renderAs("auditor");
  expect(screen.getByText("Acme")).toBeInTheDocument();
  expect(screen.getByText("acme")).toBeInTheDocument();
});

it("keeps the LAST_OWNER explanation when the refresh fails and is retried", async () => {
  vi.mocked(leaveOrganization).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  await screen.findByRole("row", { name: /Me/ });
  await user.click(entry());
  vi.mocked(fetchMeContext).mockRejectedValueOnce(new Error("offline"));
  await user.click(confirmButton());
  await user.click(await screen.findByRole("button", { name: "ลองอีกครั้ง" }));
  expect(
    await screen.findByText(/องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน/),
  ).toHaveAttribute("role", "alert");
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
});

it("applies a late A leave to A when the switch to B is denied", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(leaveOrganization).mockReturnValue(pending.promise);
  vi.mocked(updateActiveOrganization).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  const user = await renderAs("viewer");
  await user.click(entry());
  await user.click(confirmButton());
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  afterLeaveContext();
  await act(async () => {
    pending.resolve(left());
    await pending.promise;
  });
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
});

it("uses account destination when resolver returns B membership but no confirmed active selection", async () => {
  const user = await renderAs("viewer");
  await user.click(entry());
  vi.mocked(fetchMeContext).mockResolvedValueOnce(contextWith([ORG_B], null));
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace"),
  );
  expect(leaveOrganization).toHaveBeenCalledTimes(1);
});
it("uses exact resolver C destination rather than a disagreeing DELETE B hint", async () => {
  const C = "33333333-3333-4333-8333-333333333333";
  const orgC = { ...ORG_B, id: C, name: "Gamma", slug: "gamma" };
  const user = await renderAs("viewer");
  await user.click(entry());
  vi.mocked(leaveOrganization).mockResolvedValueOnce({
    member: { ...left().member, organizationId: B },
  });
  vi.mocked(fetchMeContext).mockResolvedValueOnce(
    contextWith([ORG_B, orgC], C),
  );
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${C}/members`,
    ),
  );
  expect(screen.queryByText(/ออกจากองค์กรไม่สำเร็จ/)).toBeNull();
});
