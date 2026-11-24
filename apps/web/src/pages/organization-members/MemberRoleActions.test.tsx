import type { QueryClient } from "@tanstack/react-query";
import {
  getQueryClientIdentity,
  getContextPublicationSnapshot,
} from "../../lib/queryClient";
import type {
  MeContextResponse,
  OrganizationMemberRoleUpdateResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import {
  fetchOrganizationMembers,
  updateOrganizationMemberRole,
} from "../../lib/api/members";
import {
  A,
  B,
  ME,
  contextFor,
  MemberDirectory,
  mountMembersPage,
} from "./member-action-test-support";

const sessionState = vi.hoisted(() => ({
  data: { user: { id: "user-me" } },
  isPending: false,
}));
vi.mock("../../lib/auth-client", () => ({
  authClient: { useSession: () => sessionState },
}));

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

let directory: MemberDirectory;
let listCalls: string[];
let mounted: ReturnType<typeof mountMembersPage> | undefined;

beforeEach(() => {
  sessionState.data = { user: { id: ME } };
  directory = new MemberDirectory();
  listCalls = [];
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(directory.list(id));
  });
  vi.mocked(updateOrganizationMemberRole).mockImplementation(
    (_org, memberId, role) => {
      directory.setRole(memberId, role);
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
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.resetAllMocks();
});

async function renderAs(role: OrganizationRole) {
  vi.mocked(fetchMeContext).mockResolvedValue(contextFor(role));
  mounted = mountMembersPage();
  expect(await screen.findByTestId("member-row-member-ann")).toHaveTextContent(
    "Ann",
  );
  expect(
    within(screen.getByTestId("member-row-member-ann")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Ann$/);
  return mounted.user;
}

const pillFor = (memberId: string) =>
  within(screen.getByTestId(`member-row-${memberId}`)).getByTestId(
    "member-current-role",
  );
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
  expect(listCalls).toEqual([A, A]);
  await waitFor(() => expect(roleSelect("member-ann")).toHaveFocus());
});

it("reports success and parks focus on the heading when the saved role leaves a role-filtered list", async () => {
  vi.mocked(fetchOrganizationMembers).mockImplementation(
    (id, _limit, _offset, filter) => {
      listCalls.push(id);
      const all = directory.list(id);
      if (filter?.role === undefined) return Promise.resolve(all);
      const members = all.members.filter(
        (member) => member.role === filter.role,
      );
      return Promise.resolve({
        ...all,
        members,
        page: { ...all.page, total: members.length },
      });
    },
  );
  const user = await renderAs("owner");
  await user.selectOptions(screen.getByTestId("members-filter-role"), "viewer");
  expect(await screen.findByTestId("member-row-member-ann")).toBeVisible();
  expect(screen.queryByTestId("member-row-member-boss")).toBeNull();

  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));

  expect(await screen.findByTestId("member-role-success")).toHaveAttribute(
    "role",
    "status",
  );
  expect(screen.queryByTestId("member-role-error")).toBeNull();
  expect(screen.queryByTestId("member-row-member-ann")).toBeNull();
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
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
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  await user.click(save("member-ann"));
  expect(await screen.findByTestId("member-role-success")).toBeInTheDocument();
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
});

it.each(["owner", "admin"] as const)(
  "ORG-32 asks an %s to confirm before setting Admin, and cancel sends no request",
  async (actor) => {
    const user = await renderAs(actor);
    await user.selectOptions(roleSelect("member-ann"), "admin");
    await user.click(save("member-ann"));
    expect(screen.getByTestId("member-role-dialog")).toBeInTheDocument();
    expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("member-role-dialog")).toBeNull();
    expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
    await user.click(save("member-ann"));
    await user.click(screen.getByTestId("member-role-confirm"));
    expect(
      await screen.findByTestId("member-role-success"),
    ).toBeInTheDocument();
    expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
      A,
      "member-ann",
      "admin",
    );
  },
);

it("ORG-17 shows the role once: a select with Save only after a change, a pill where the actor cannot change it", async () => {
  const user = await renderAs("admin");
  expect(screen.queryByTestId("member-role-save-member-ann")).toBeNull();
  await user.selectOptions(roleSelect("member-ann"), "auditor");
  expect(save("member-ann")).toBeEnabled();
  await user.selectOptions(roleSelect("member-ann"), "viewer");
  expect(screen.queryByTestId("member-role-save-member-ann")).toBeNull();
  const boss = within(screen.getByTestId("member-row-member-boss"));
  expect(boss.queryByRole("combobox")).toBeNull();
  expect(boss.getByTestId("member-current-role")).toHaveAttribute(
    "data-member-role",
    "owner",
  );
  expect(
    within(screen.getByTestId("members-table")).getAllByRole("columnheader"),
  ).toHaveLength(4);
});

it("blocks duplicate submits and pagination while a role save is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(directory.list(id, 120));
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
    directory.setRole("member-ann", "auditor");
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
      directory.setRole(memberId, "admin");
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
    expect(screen.queryByTestId("member-role-save-member-b")).toBeNull();
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
    directory.setRole("member-ann", "owner");
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
    return Promise.resolve(directory.list(id, 120));
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
    directory.setRole("member-ann", "auditor");
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
      directory.setRole("member-ann", "auditor");
      vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
        listCalls.push(id);
        const list = directory.list(id);
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
    const list = directory.list(id);
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
  directory.setRole("member-me", "admin");
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
    const list = directory.list(id);
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

it.each(["organization", "member"] as const)(
  "rejects a filtered PATCH with mismatched %s identity despite matching role",
  async (mismatch) => {
    let patchReturned = false;
    vi.mocked(fetchOrganizationMembers).mockImplementation(
      (id, _limit, _offset, filter) => {
        const list = directory.list(id);
        const members = list.members.filter(
          (member) =>
            !filter?.role || (!patchReturned && member.role === filter.role),
        );
        return Promise.resolve({
          ...list,
          members,
          page: { ...list.page, total: members.length },
        });
      },
    );
    vi.mocked(updateOrganizationMemberRole).mockImplementation(() => {
      patchReturned = true;
      return Promise.resolve({
        member: {
          id: mismatch === "member" ? "member-other" : "member-ann",
          userId: "user-ann",
          organizationId: mismatch === "organization" ? B : A,
          role: "auditor",
        },
      });
    });
    const user = await renderAs("owner");
    await user.selectOptions(
      screen.getByTestId("members-filter-role"),
      "viewer",
    );
    await user.selectOptions(roleSelect("member-ann"), "auditor");
    await user.click(save("member-ann"));
    expect(await screen.findByTestId("member-role-error")).toBeVisible();
    expect(screen.queryByTestId("member-role-success")).toBeNull();
    expect(screen.queryByTestId("member-row-member-ann")).toBeNull();
    await user.click(screen.getByTestId("members-filter-clear"));
    await screen.findByTestId("member-row-member-ann");
    expect(pillFor("member-ann")).toHaveAttribute("data-member-role", "viewer");
    await submitSettled("member-ann");
    await user.selectOptions(roleSelect("member-ann"), "auditor");
    expect(save("member-ann")).toBeEnabled();
  },
);

it.each(["success", "error"] as const)(
  "retires old role %s through confirmed A→B→A without releasing the new guard",
  async (outcome) => {
    const old = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    const current =
      Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(updateOrganizationMemberRole)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    vi.mocked(updateActiveOrganization).mockImplementation(
      ({ organizationId }) =>
        Promise.resolve({
          ...contextFor("owner"),
          lastActiveTenantId: organizationId,
        }),
    );
    const user = await renderAs("owner");
    await user.selectOptions(roleSelect("member-ann"), "auditor");
    await user.click(save("member-ann"));
    await user.click(screen.getByTestId("test-member-switch"));
    await waitFor(() => {
      expect(updateActiveOrganization).toHaveBeenCalledWith({
        organizationId: B,
      });
    });
    await user.click(screen.getByTestId("test-member-navigate"));
    await screen.findByTestId("member-row-member-b");
    await user.click(screen.getByTestId("test-member-switch-a"));
    await waitFor(() => {
      expect(updateActiveOrganization).toHaveBeenCalledWith({
        organizationId: A,
      });
    });
    await user.click(screen.getByTestId("test-member-navigate-a"));
    await screen.findByTestId("member-row-member-ann");
    await user.selectOptions(roleSelect("member-ann"), "auditor");
    await user.click(save("member-ann"));
    expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(2);
    const calls = [...listCalls];
    await act(async () => {
      if (outcome === "success")
        old.resolve({
          member: {
            id: "member-ann",
            userId: "user-ann",
            organizationId: A,
            role: "owner",
          },
        });
      else old.reject(new ApiError("LAST_OWNER", "late", 400));
      await old.promise.catch(() => undefined);
    });
    expect(pillFor("member-ann")).toHaveAttribute("data-member-role", "viewer");
    expect(screen.queryByTestId("member-role-success")).toBeNull();
    expect(screen.queryByTestId("member-role-error")).toBeNull();
    expect(save("member-ann")).toBeDisabled();
    expect(roleSelect("member-ann")).toBeDisabled();
    expect(listCalls).toEqual(calls);
    await user.click(save("member-ann"));
    expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(2);
    await act(async () => {
      directory.setRole("member-ann", "auditor");
      current.resolve({
        member: {
          id: "member-ann",
          userId: "user-ann",
          organizationId: A,
          role: "auditor",
        },
      });
      await current.promise;
    });
    expect(await screen.findByTestId("member-role-success")).toBeVisible();
    expect(pillFor("member-ann")).toHaveAttribute(
      "data-member-role",
      "auditor",
    );
    await submitSettled("member-ann");
  },
);

it.each(["success", "error"] as const)(
  "isolates an old actor role %s from the replacement session client and private controls",
  async (outcome) => {
    const old = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(updateOrganizationMemberRole).mockReturnValueOnce(old.promise);
    vi.mocked(fetchMeContext).mockResolvedValue(contextFor("owner"));
    const clients: QueryClient[] = [];
    mounted = mountMembersPage({ onClient: (client) => clients.push(client) });
    const sessionMount = mounted;
    const user = sessionMount.user;
    await screen.findByTestId("member-row-member-ann");
    const origin = clients.at(-1);
    assert(origin);
    expect(getQueryClientIdentity(origin)).toBe(ME);
    origin.setQueryData(["private-origin"], "origin only");
    await user.selectOptions(roleSelect("member-ann"), "auditor");
    await user.click(save("member-ann"));
    const nextContext = contextFor("viewer");
    nextContext.user = { ...nextContext.user, id: "replacement-actor" };
    vi.mocked(fetchMeContext).mockResolvedValue(nextContext);
    act(() => {
      sessionState.data = { user: { id: "replacement-actor" } };
      sessionMount.rerenderSession();
    });
    await screen.findByTestId("members-denied");
    const destination = clients.at(-1);
    assert(destination);
    expect(destination).not.toBe(origin);
    expect(getQueryClientIdentity(destination)).toBe("replacement-actor");
    expect(getContextPublicationSnapshot(origin).admission.kind).toBe(
      "retired",
    );
    expect(destination.getQueryData(["private-origin"])).toBeUndefined();
    destination.setQueryData(["private-destination"], "replacement only");
    const calls = [...listCalls];
    await act(async () => {
      if (outcome === "success")
        old.resolve({
          member: {
            id: "member-ann",
            userId: "user-ann",
            organizationId: A,
            role: "auditor",
          },
        });
      else old.reject(new ApiError("LAST_OWNER", "late", 400));
      await old.promise.catch(() => undefined);
    });
    expect(screen.getByTestId("members-denied")).toBeVisible();
    expect(screen.queryByTestId("member-row-member-ann")).toBeNull();
    expect(screen.queryByTestId("member-role-select-member-ann")).toBeNull();
    expect(screen.queryByTestId("member-role-save-member-ann")).toBeNull();
    expect(screen.queryByTestId("member-role-success")).toBeNull();
    expect(screen.queryByTestId("member-role-error")).toBeNull();
    expect(listCalls).toEqual(calls);
    expect(destination.getQueryData(["private-destination"])).toBe(
      "replacement only",
    );
    expect(origin.getQueryData(["private-destination"])).toBeUndefined();
  },
);
