import { bindQueryClientIdentity } from "../../lib/queryClient";
import type {
  MeContextResponse,
  OrganizationMemberListResponse,
  OrganizationMemberRoleUpdateResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  updateOrganizationMemberRole,
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
  updateOrganizationMemberRole: vi.fn(),
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ME = "user-me";

function contextFor(role: OrganizationRole): MeContextResponse {
  return {
    user: {
      id: ME,
      name: "Me",
      email: "me@example.test",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [
      { id: A, name: "Acme", slug: "acme", role },
      { id: B, name: "Beta", slug: "beta", role: "owner" },
    ],
    lastActiveTenantId: A,
  };
}

// Server-side member roles the mocked list and PATCH share.
let roles: Record<string, OrganizationRole>;
let listCalls: string[];

function listFor(
  organizationId: string,
  total = 3,
): OrganizationMemberListResponse {
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
  return {
    organizationId: A,
    members: [
      {
        id: "member-me",
        userId: ME,
        name: "Me",
        email: "me@example.test",
        role: roles["member-me"] ?? "owner",
      },
      {
        id: "member-ann",
        userId: "user-ann",
        name: "Ann",
        email: "ann@example.test",
        role: roles["member-ann"] ?? "viewer",
      },
      {
        id: "member-boss",
        userId: "user-boss",
        name: "Boss",
        email: "boss@example.test",
        role: roles["member-boss"] ?? "owner",
      },
    ],
    page: { limit: 50, offset: 0, total },
    memberLimit: 1000,
  };
}

beforeEach(() => {
  roles = {};
  listCalls = [];
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(listFor(id));
  });
  vi.mocked(updateOrganizationMemberRole).mockImplementation(
    (_org, memberId, role) => {
      roles[memberId] = role;
      return Promise.resolve({
        member: {
          id: memberId,
          userId: "u",
          organizationId: A,
          role,
        },
      } satisfies OrganizationMemberRoleUpdateResponse);
    },
  );
});
afterEach(() => vi.resetAllMocks());

function Harness() {
  const { switchOrg } = useTenant();
  const navigate = useNavigate();
  return (
    <>
      <button
        data-testid="test-member-navigate"
        type="button"
        onClick={() => void navigate(`/organizations/${B}/members`)}
      >
        navigate B
      </button>
      <button
        data-testid="test-member-switch"
        type="button"
        onClick={() => void switchOrg(B)}
      >
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
  bindQueryClientIdentity(queryClient, ME);
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
  expect(await screen.findByTestId("member-row-member-ann")).toHaveTextContent(
    "Ann",
  );
  expect(
    within(screen.getByTestId("member-row-member-ann")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Ann$/);
  return user;
}

const pillFor = (memberId: string) =>
  within(screen.getByTestId(`member-row-${memberId}`)).getByTestId(
    "member-current-role",
  );
// The submit finishes after its refresh branch: pending text gone, control enabled.
const submitSettled = (memberId: string) =>
  waitFor(() => {
    expect(screen.queryByTestId("member-role-pending")).toBeNull();
    expect(roleSelect(memberId)).toBeEnabled();
  });
const save = (memberId: string) =>
  screen.getByTestId(`member-role-save-${memberId}`);
const roleSelect = (memberId: string) =>
  screen.getByTestId(`member-role-select-${memberId}`);

it("saves a non-owner change directly, without a dialog, and reports success only after the refetch shows the role", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(await screen.findByTestId("member-role-success")).toHaveAttribute(
    "role",
    "status",
  );
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
    A,
    "member-ann",
    "auditor",
  );
  expect(pillFor("member-ann")).toHaveAttribute("data-member-role", "auditor");
  // Initial load plus the post-PATCH refetch.
  expect(listCalls).toEqual([A, A]);
  // Keyboard focus returns to the same member's control after the list reloads.
  await waitFor(() => expect(roleSelect("member-ann")).toHaveFocus());
});

it("asks owners to confirm owner-involved changes, and cancel sends no request", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "owner");
  const opener = save("member-ann");
  await user.click(opener);
  const dialog = screen.getByTestId(
    /^(member-(role|revoke)|self-leave)-dialog$/,
  );
  expect(dialog).toHaveAccessibleDescription(/Ann.*Acme \(acme\)/);
  expect(screen.getByTestId("confirmation-cancel")).toHaveFocus();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("confirmation-cancel"));
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  expect(opener).toHaveFocus();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
  expect(listCalls).toEqual([A]);

  // Demoting an owner also needs confirmation; Escape cancels.
  await user.selectOptions(roleSelect("member-boss"), "admin");
  await user.click(save("member-boss"));
  expect(
    screen.getByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
});

it("confirms an owner-involved change with one PATCH", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "owner");
  await user.click(save("member-ann"));
  const confirm = screen.getByTestId("member-role-confirm");
  await user.click(confirm);
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
    A,
    "member-ann",
    "owner",
  );
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  // The table reloads behind the dialog; focus must land on a live control.
  await waitFor(() => expect(roleSelect("member-ann")).toHaveFocus());
  expect(document.body).not.toHaveFocus();
});

it("shows admins no controls for owners and no owner option elsewhere", async () => {
  const user = await renderAs("admin");
  expect(screen.queryByTestId("member-role-select-member-boss")).toBeNull();
  const options = within(roleSelect("member-ann"))
    .getAllByTestId(/^member-role-option-/)
    .map((option) => option.getAttribute("value"));
  expect(new Set(options)).toEqual(new Set(["admin", "viewer", "auditor"]));
  await user.selectOptions(roleSelect("member-ann"), "admin");
  await user.click(save("member-ann"));
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
});

it("blocks duplicate submits and pagination while a role save is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(listFor(id, 120));
  });
  const user = await renderAs("owner");
  expect(screen.getByTestId("members-next")).toBeEnabled();
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(screen.getByTestId("member-role-pending")).toHaveAttribute(
    "role",
    "status",
  );
  expect(save("member-ann")).toBeDisabled();
  expect(roleSelect("member-ann")).toBeDisabled();
  expect(screen.getByTestId("members-next")).toBeDisabled();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  await act(async () => {
    roles["member-ann"] = "auditor";
    pending.resolve({
      member: {
        id: "member-ann",
        userId: "user-ann",
        organizationId: A,
        role: "auditor",
      },
    });
    await pending.promise;
  });
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
  expect(screen.getByTestId("members-next")).toBeEnabled();
});

it("explains LAST_OWNER, refreshes the latest roles and shows no success", async () => {
  vi.mocked(updateOrganizationMemberRole).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-boss"), "viewer");
  await user.click(save("member-boss"));
  await user.click(screen.getByTestId("member-role-confirm"));
  expect(await screen.findByTestId("member-role-error")).toBeInTheDocument();
  expect(screen.queryByTestId("member-role-success")).toBeNull();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(listCalls).toEqual([A, A]);
  expect(pillFor("member-boss")).toHaveAttribute("data-member-role", "owner");
  // Focus stays on the member's own controls (opener or its select).
  await waitFor(() => {
    expect(
      screen
        .getByTestId("member-row-member-boss")
        .contains(document.activeElement),
    ).toBe(true);
    expect(
      within(screen.getByTestId("member-row-member-boss")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent(/^Boss$/);
  });
  expect(document.body).not.toHaveFocus();
});

it("reports a persisted role that differs from the requested one instead of success", async () => {
  vi.mocked(updateOrganizationMemberRole).mockImplementation(
    (_org, memberId) => {
      // Another actor wins the race after our PATCH.
      roles[memberId] = "admin";
      return Promise.resolve({
        member: {
          id: memberId,
          userId: "u",
          organizationId: A,
          role: "auditor",
        },
      });
    },
  );
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(await screen.findByTestId("member-role-error")).toBeInTheDocument();
  expect(screen.queryByTestId("member-role-success")).toBeNull();
  expect(pillFor("member-ann")).toHaveAttribute("data-member-role", "admin");
  expect(roleSelect("member-ann")).toHaveValue("admin");
});

it("shows no success when an owner demotes themselves and loses list access", async () => {
  const user = await renderAs("owner");
  vi.mocked(fetchOrganizationMembers).mockRejectedValue(
    new ApiError("PERMISSION_DENIED", "denied", 403),
  );
  vi.mocked(fetchMeContext).mockResolvedValue({
    ...contextFor("viewer"),
    organizations: [
      { id: A, name: "Acme", slug: "acme", role: "viewer" },
      { id: B, name: "Beta", slug: "beta", role: "owner" },
    ],
  });
  await user.selectOptions(roleSelect("member-me"), "viewer");
  await user.click(save("member-me"));
  await user.click(screen.getByTestId("member-role-confirm"));
  await waitFor(() => {
    expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
      A,
      "member-me",
      "viewer",
    );
  });
  await waitFor(() =>
    expect(
      screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByTestId("member-role-success")).toBeNull();
});

it.each(["success", "LAST_OWNER"] as const)(
  "keeps destination role, action and notice unchanged after a late origin %s response",
  async (outcome) => {
    const pending =
      Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...contextFor("owner"),
      lastActiveTenantId: B,
    });
    const user = await renderAs("owner");
    await user.selectOptions(roleSelect("member-ann"), "owner");
    await user.click(save("member-ann"));
    await user.click(screen.getByTestId("member-role-confirm"));
    expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("test-member-switch"));
    await waitFor(() => {
      expect(updateActiveOrganization).toHaveBeenCalled();
    });
    await user.click(screen.getByTestId("test-member-navigate"));
    await screen.findByTestId("member-row-member-b");
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent(/^Bea$/);
    await waitFor(() => {
      expect(
        screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
      ).toBeNull();
    });
    const listCallsBeforeLateResponse = [...listCalls];
    expect(listCallsBeforeLateResponse.filter((id) => id === B)).toHaveLength(
      1,
    );
    await act(async () => {
      if (outcome === "success") {
        pending.resolve({
          member: {
            id: "member-ann",
            userId: "user-ann",
            organizationId: A,
            role: "owner",
          },
        });
      } else {
        pending.reject(new ApiError("LAST_OWNER", "late", 400));
      }
      await pending.promise.catch(() => undefined);
    });
    expect(pillFor("member-b")).toHaveAttribute("data-member-role", "viewer");
    expect(roleSelect("member-b")).toBeEnabled();
    expect(save("member-b")).toBeDisabled();
    await user.selectOptions(roleSelect("member-b"), "auditor");
    expect(save("member-b")).toBeEnabled();
    // Only the harness's own location output may carry status text; the invitation
    // section's region stays mounted and empty.
    expect(
      screen
        .queryAllByTestId(
          /^(member-(role|revoke)-(pending|success)|members-(admission|context|list)-status|self-leave-admission-status|pending-invitations-status|confirmation-pending)$/,
        )
        .filter((element) => element.textContent !== ""),
    ).toEqual([]);
    expect(
      screen.queryByTestId(
        /^(member-(role|revoke)-error|self-leave-error|members-(admission|context|list)-error|members-denied|self-leave-admission-error)$/,
      ),
    ).toBeNull();
    expect(
      screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
    ).toBeNull();
    expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
    expect(listCalls).toEqual(listCallsBeforeLateResponse);
  },
);

it("ignores Escape while a confirmed change is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "owner");
  await user.click(save("member-ann"));
  await user.click(screen.getByTestId("member-role-confirm"));
  await user.keyboard("{Escape}");
  expect(
    screen.getByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeInTheDocument();
  expect(
    screen.getByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toHaveFocus();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  await act(async () => {
    roles["member-ann"] = "owner";
    pending.resolve({
      member: {
        id: "member-ann",
        userId: "user-ann",
        organizationId: A,
        role: "owner",
      },
    });
    await pending.promise;
  });
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
});

it("reenables pagination after a confirmed switch retires the origin operation while its route remains", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(listFor(id, 120));
  });
  vi.mocked(updateActiveOrganization).mockResolvedValue({
    ...contextFor("owner"),
    lastActiveTenantId: B,
  });
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(screen.getByTestId("members-next")).toBeDisabled();
  await user.click(screen.getByTestId("test-member-switch"));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  await waitFor(() => expect(screen.getByTestId("members-next")).toBeEnabled());
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  expect(
    screen
      .queryAllByTestId(
        /^(member-(role|revoke)-(pending|success)|members-(admission|context|list)-status|self-leave-admission-status|pending-invitations-status|confirmation-pending)$/,
      )
      .filter((element) => element.textContent !== ""),
  ).toEqual([]);
});

it("keeps the origin role change pending and applies its result when the organization switch is denied", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  vi.mocked(updateActiveOrganization).mockRejectedValue(new Error("denied"));
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  await user.click(screen.getByTestId("test-member-switch"));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  expect(save("member-ann")).toBeDisabled();
  await act(async () => {
    roles["member-ann"] = "auditor";
    pending.resolve({
      member: {
        id: "member-ann",
        userId: "user-ann",
        organizationId: A,
        role: "auditor",
      },
    });
    await pending.promise;
  });
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
});

it.each([
  ["a generic failure", () => Promise.reject(new Error("boom")), /ไม่สำเร็จ/],
  [
    "a member missing from the refetched list",
    () => {
      roles["member-ann"] = "auditor";
      vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
        listCalls.push(id);
        const list = listFor(id);
        return Promise.resolve({
          ...list,
          members: list.members.filter((item) => item.id !== "member-ann"),
        });
      });
      return Promise.resolve({
        member: {
          id: "member-ann",
          userId: "user-ann",
          organizationId: A,
          role: "auditor" as const,
        },
      });
    },
    /ไม่สามารถยืนยันบทบาทได้/,
  ],
])("shows an error and no success for %s", async (_name, patch) => {
  vi.mocked(updateOrganizationMemberRole).mockImplementation(patch);
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(await screen.findByTestId("member-role-error")).toBeInTheDocument();
  expect(screen.queryByTestId("member-role-success")).toBeNull();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  if (_name === "a member missing from the refetched list") {
    expect(screen.queryByTestId("member-row-member-ann")).toBeNull();
  } else {
    expect(pillFor("member-ann")).toHaveAttribute("data-member-role", "viewer");
  }
});

it("does not refresh membership context when another member changes on a page without the actor", async () => {
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    const list = listFor(id);
    return Promise.resolve({
      ...list,
      members: list.members.filter((item) => item.userId !== ME),
    });
  });
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
  await submitSettled("member-ann");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
});

it("refreshes membership context when another member changes and the actor's listed role differs", async () => {
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  // Another session demoted the actor; the refetched list shows the new role.
  roles["member-me"] = "admin";
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  await waitFor(() => {
    expect(vi.mocked(fetchMeContext).mock.calls.length).toBeGreaterThan(
      contextFetches,
    );
  });
});

it("does not refresh membership context when the actor's own role change fails", async () => {
  vi.mocked(updateOrganizationMemberRole).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.selectOptions(roleSelect("member-me"), "admin");
  await user.click(save("member-me"));
  await user.click(screen.getByTestId("member-role-confirm"));
  expect(await screen.findByTestId("member-role-error")).toBeInTheDocument();
  await submitSettled("member-me");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
});

it("refreshes membership context when the actor changes their own role", async () => {
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.selectOptions(roleSelect("member-me"), "admin");
  await user.click(save("member-me"));
  await user.click(screen.getByTestId("member-role-confirm"));
  await waitFor(() => {
    expect(vi.mocked(fetchMeContext).mock.calls.length).toBeGreaterThan(
      contextFetches,
    );
  });
});

async function changeOwnRoleToAdmin(
  user: Awaited<ReturnType<typeof renderAs>>,
) {
  await user.selectOptions(roleSelect("member-me"), "admin");
  await user.click(save("member-me"));
  await user.click(screen.getByTestId("member-role-confirm"));
}

it("shows loading, never a restricted state, while context refreshes after an own role change", async () => {
  const user = await renderAs("owner");
  const refresh = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValue(refresh.promise);
  await changeOwnRoleToAdmin(user);
  expect(
    await screen.findByTestId("members-admission-loading"),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("members-denied")).toBeNull();
  await act(async () => {
    refresh.resolve(contextFor("admin"));
    await refresh.promise;
  });
  expect(
    await screen.findByTestId("member-row-member-ann"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByTestId("member-row-member-ann")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Ann$/);
  expect(screen.queryByTestId("members-denied")).toBeNull();
  expect(screen.getByTestId("member-role-success")).toBeInTheDocument();
  // The table unmounted during the refresh; focus must return to a live control.
  await waitFor(() => expect(roleSelect("member-me")).toHaveFocus());
});

it("shows a retryable error, not a restricted state, when the context refresh fails after an own role change", async () => {
  const user = await renderAs("owner");
  vi.mocked(fetchMeContext).mockRejectedValue(new Error("network"));
  await changeOwnRoleToAdmin(user);
  const retry = await screen.findByTestId("members-admission-retry");
  expect(screen.getByTestId("members-admission-error")).toBeInTheDocument();
  expect(screen.queryByTestId("members-denied")).toBeNull();
  const failedFetches = vi.mocked(fetchMeContext).mock.calls.length;
  vi.mocked(fetchMeContext).mockResolvedValue(contextFor("admin"));
  await user.click(retry);
  expect(
    await screen.findByTestId("member-row-member-ann"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByTestId("member-row-member-ann")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Ann$/);
  expect(vi.mocked(fetchMeContext).mock.calls.length).toBeGreaterThan(
    failedFetches,
  );
  expect(screen.queryByTestId("members-denied")).toBeNull();
  await waitFor(() => expect(roleSelect("member-me")).toHaveFocus());
});

async function saveAnnAsAuditorWithActorOffPage(failure: Error) {
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    const list = listFor(id);
    return Promise.resolve({
      ...list,
      members: list.members.filter((item) => item.userId !== ME),
    });
  });
  vi.mocked(updateOrganizationMemberRole).mockRejectedValue(failure);
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  return { contextFetches };
}

it("refreshes membership context once when a PERMISSION_DENIED PATCH leaves the actor off the page", async () => {
  const { contextFetches } = await saveAnnAsAuditorWithActorOffPage(
    new ApiError("PERMISSION_DENIED", "denied", 403),
  );
  expect(await screen.findByTestId("member-role-error")).toBeInTheDocument();
  await waitFor(() => {
    expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(
      contextFetches + 1,
    );
  });
  await submitSettled("member-ann");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches + 1);
  expect(screen.queryByTestId("member-role-success")).toBeNull();
});

it.each([
  ["LAST_OWNER", new ApiError("LAST_OWNER", "last", 400)],
  ["a generic failure", new Error("boom")],
])("does not refresh membership context for %s", async (_name, failure) => {
  const { contextFetches } = await saveAnnAsAuditorWithActorOffPage(failure);
  expect(await screen.findByTestId("member-role-error")).toBeInTheDocument();
  await submitSettled("member-ann");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
});
