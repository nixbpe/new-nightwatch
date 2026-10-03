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
  MemoryRouter,
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
  revokeOrganizationMember,
} from "../../lib/api/members";
import { TenantProvider, useTenant } from "../../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "../OrganizationMembersPage";

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
  revokeOrganizationMember: vi.fn(),
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ME = "user-me";

function contextFor(
  role: OrganizationRole,
  organizations: MeContextResponse["organizations"] = [
    { id: A, name: "Acme", slug: "acme", role },
    { id: B, name: "Beta", slug: "beta", role: "owner" },
  ],
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
    lastActiveTenantId: organizations[0]?.id ?? null,
  };
}

const MEMBERS = [
  { id: "member-me", userId: ME, name: "Me", role: "owner" },
  { id: "member-ann", userId: "user-ann", name: "Ann", role: "viewer" },
  { id: "member-boss", userId: "user-boss", name: "Boss", role: "owner" },
] as const;

// Server-side membership shared by the mocked list and DELETE.
let removed: Set<string>;
let listCalls: string[];

function listFor(organizationId: string): OrganizationMemberListResponse {
  if (organizationId === B) {
    return {
      organizationId: B,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "Bea",
          email: "bea@example.test",
          role: "viewer",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
  }
  const members = MEMBERS.filter((member) => !removed.has(member.id)).map(
    (member) => ({
      ...member,
      email: `${member.name.toLowerCase()}@example.test`,
    }),
  );
  return {
    organizationId: A,
    members,
    page: { limit: 50, offset: 0, total: members.length },
    memberLimit: 1000,
  };
}

const revoked = (memberId: string, userId = "u") =>
  ({
    member: { id: memberId, userId, organizationId: A, role: "viewer" },
  }) satisfies OrganizationMemberRoleUpdateResponse;

beforeEach(() => {
  removed = new Set();
  listCalls = [];
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(listFor(id));
  });
  vi.mocked(revokeOrganizationMember).mockImplementation((_org, memberId) => {
    removed.add(memberId);
    return Promise.resolve(revoked(memberId));
  });
});
afterEach(() => vi.resetAllMocks());

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
      </Routes>
    </>
  );
}

async function renderAs(role: OrganizationRole) {
  vi.mocked(fetchMeContext).mockResolvedValue(contextFor(role));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <Harness />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Ann");
  return user;
}

const revokeButton = (name: string) =>
  screen.getByRole("button", { name: `ถอน ${name} ออกจากองค์กร` });
const confirmButton = () =>
  screen.getByRole("button", { name: "ยืนยันการถอนสมาชิก" });
const heading = () => screen.getByRole("heading", { name: "สมาชิก" });

it("cancel and Escape send no request and return focus to the opener", async () => {
  const user = await renderAs("owner");
  const opener = revokeButton("Ann");
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "ยืนยันการถอนสมาชิก" });
  expect(dialog).toHaveAccessibleDescription(
    /Ann.*ann@example.test.*Acme \(acme\)/,
  );
  expect(dialog).toHaveAccessibleDescription(/องค์กรอื่นยังอยู่/);
  expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
  await user.click(opener);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
  expect(revokeOrganizationMember).not.toHaveBeenCalled();
  expect(listCalls).toEqual([A]);
});

it("revokes with one DELETE, shows success only after the refetch drops the row and parks focus on the heading", async () => {
  const user = await renderAs("owner");
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  expect(await screen.findByText("ถอน Ann ออกจากองค์กรแล้ว")).toHaveAttribute(
    "role",
    "status",
  );
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  expect(revokeOrganizationMember).toHaveBeenCalledWith(A, "member-ann");
  expect(screen.queryByRole("row", { name: /Ann/ })).toBeNull();
  // Initial load plus the post-DELETE refetch; another member's removal does
  // not touch the actor's context.
  expect(listCalls).toEqual([A, A]);
  expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(heading()).toHaveFocus());
});

it("hides revoke for owner rows from admins and offers it for non-owners", async () => {
  await renderAs("admin");
  expect(revokeButton("Ann")).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "ถอน Boss ออกจากองค์กร" }),
  ).toBeNull();
});

it("blocks a second confirm and pagination while the DELETE is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(revokeOrganizationMember).mockReturnValue(pending.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    const list = listFor(id);
    return Promise.resolve({ ...list, page: { ...list.page, total: 60 } });
  });
  const user = await renderAs("owner");
  expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  expect(await screen.findAllByText("กำลังถอนสมาชิก…")).not.toHaveLength(0);
  // The confirm button is disabled and relabelled while pending.
  const pendingConfirm = screen.getByRole("button", {
    name: "กำลังถอนสมาชิก…",
  });
  expect(pendingConfirm).toBeDisabled();
  await user.click(pendingConfirm);
  expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(revokeButton("Boss")).toBeDisabled();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  await act(async () => {
    removed.add("member-ann");
    pending.resolve(revoked("member-ann"));
    await pending.promise;
  });
  expect(await screen.findByText("ถอน Ann ออกจากองค์กรแล้ว")).toBeVisible();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
});

it("explains LAST_OWNER, refreshes the list, shows no success and returns focus to the member's control", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("Boss"));
  await user.click(confirmButton());
  expect(
    await screen.findByText(/องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/ออกจากองค์กรแล้ว/)).toBeNull();
  expect(screen.getByRole("row", { name: /Boss/ })).toBeInTheDocument();
  expect(listCalls).toEqual([A, A]);
  await waitFor(() => expect(revokeButton("Boss")).toHaveFocus());
});

it("shows a generic failure without success and refreshes the list without replaying the DELETE", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("INTERNAL_ERROR", "boom", 500),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  expect(await screen.findByText(/ถอนสมาชิกไม่สำเร็จ/)).toBeInTheDocument();
  expect(screen.queryByText(/ออกจากองค์กรแล้ว/)).toBeNull();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  expect(listCalls).toEqual([A, A]);
});

it("refreshes context once when the DELETE is PERMISSION_DENIED but the list is still readable", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("PERMISSION_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  expect(await screen.findByText(/ถอนสมาชิกไม่สำเร็จ/)).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByText("กำลังถอนสมาชิก…")).toBeNull();
    expect(revokeButton("Ann")).toBeEnabled();
  });
  expect(screen.queryByText(/ออกจากองค์กรแล้ว/)).toBeNull();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches + 1);
});

it("reports an error instead of success when the refetched list still holds the member", async () => {
  vi.mocked(revokeOrganizationMember).mockResolvedValue(revoked("member-ann"));
  const user = await renderAs("owner");
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  expect(
    await screen.findByText(/ยังพบสมาชิกในรายการล่าสุด/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/ออกจากองค์กรแล้ว/)).toBeNull();
});

it("offers no revoke on the actor's own row, which is the self-leave flow", async () => {
  await renderAs("owner");
  expect(
    screen.queryByRole("button", { name: "ถอน Me ออกจากองค์กร" }),
  ).toBeNull();
  expect(revokeButton("Boss")).toBeEnabled();
});

it("goes to no-access when the server denies the actor and no Organization is left", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  vi.mocked(fetchOrganizationMembers).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  vi.mocked(fetchMeContext).mockResolvedValue(contextFor("owner", []));
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace"),
  );
  expect(screen.queryByText(/ออกจากองค์กรแล้ว/)).toBeNull();
});

it("refreshes context and redirects when the server denies the actor's revoke", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  // Another session removed the actor from A.
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return id === A
      ? Promise.reject(new ApiError("MEMBERSHIP_DENIED", "denied", 403))
      : Promise.resolve(listFor(id));
  });
  // The revoked session's mirror was cleared, so the server confirms no active
  // Organization and the page falls back to a remaining readable one.
  vi.mocked(fetchMeContext).mockResolvedValue({
    ...contextFor("owner", [
      { id: B, name: "Beta", slug: "beta", role: "owner" },
    ]),
    lastActiveTenantId: null,
  });
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
  expect(screen.queryByText(/ออกจากองค์กรแล้ว/)).toBeNull();
});

it("applies a late A result to A when the switch to B is denied", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(revokeOrganizationMember).mockReturnValue(pending.promise);
  vi.mocked(updateActiveOrganization).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("Ann"));
  await user.click(confirmButton());
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  await act(async () => {
    removed.add("member-ann");
    pending.resolve(revoked("member-ann"));
    await pending.promise;
  });
  expect(await screen.findByText("ถอน Ann ออกจากองค์กรแล้ว")).toBeVisible();
  expect(screen.queryByRole("row", { name: /Ann/ })).toBeNull();
  expect(screen.queryByText("Bea")).toBeNull();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
});

it.each(["success", "LAST_OWNER"] as const)(
  "keeps B untouched by a late A %s response after switching to B",
  async (outcome) => {
    const pending =
      Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(revokeOrganizationMember).mockReturnValue(pending.promise);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...contextFor("owner"),
      lastActiveTenantId: B,
    });
    const user = await renderAs("owner");
    await user.click(revokeButton("Ann"));
    await user.click(confirmButton());
    expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "confirm B" }));
    await waitFor(() => {
      expect(updateActiveOrganization).toHaveBeenCalled();
    });
    await user.click(screen.getByRole("button", { name: "navigate B" }));
    await screen.findByText("Bea");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const listCallsBeforeLateResponse = [...listCalls];
    await act(async () => {
      if (outcome === "success") {
        pending.resolve(revoked("member-ann"));
      } else {
        pending.reject(new ApiError("LAST_OWNER", "late", 400));
      }
      await pending.promise.catch(() => undefined);
    });
    expect(screen.getByRole("row", { name: /Bea/ })).toBeInTheDocument();
    // B is owned by the actor, so B's own control is live and idle.
    expect(revokeButton("Bea")).toBeEnabled();
    // Only the harness's own location output may carry status text; the invitation
    // section's region stays mounted and empty.
    expect(
      screen
        .queryAllByRole("status")
        .filter(
          (element) =>
            !element.hasAttribute("data-testid") && element.textContent !== "",
        ),
    ).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
    expect(listCalls).toEqual(listCallsBeforeLateResponse);
  },
);
