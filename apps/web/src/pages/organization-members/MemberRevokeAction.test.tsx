import type {
  OrganizationMemberRoleUpdateResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import {
  fetchOrganizationMembers,
  revokeOrganizationMember,
} from "../../lib/api/members";
import {
  A,
  B,
  contextFor,
  MemberDirectory,
  mountMembersPage,
} from "./member-action-test-support";

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

let directory: MemberDirectory;
let listCalls: string[];
let mounted: ReturnType<typeof mountMembersPage> | undefined;

const revoked = (memberId: string, userId = "u") =>
  ({
    member: { id: memberId, userId, organizationId: A, role: "viewer" },
  }) satisfies OrganizationMemberRoleUpdateResponse;

beforeEach(() => {
  directory = new MemberDirectory();
  listCalls = [];
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(directory.list(id));
  });
  vi.mocked(revokeOrganizationMember).mockImplementation((_org, memberId) => {
    directory.remove(memberId);
    return Promise.resolve(revoked(memberId));
  });
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

const revokeButton = (memberId: string) =>
  screen.getByTestId(`member-revoke-${memberId}`);
const confirmButton = () => screen.getByTestId("member-revoke-confirm");
const heading = () => screen.getByTestId("page-title");

it("cancel and Escape send no request and return focus to the opener", async () => {
  const user = await renderAs("owner");
  const opener = revokeButton("member-ann");
  await user.click(opener);
  const dialog = screen.getByTestId(
    /^(member-(role|revoke)|self-leave)-dialog$/,
  );
  expect(dialog).toHaveAccessibleDescription(
    /Ann.*ann@example.test.*Acme \(acme\)/,
  );
  expect(dialog).toHaveAccessibleDescription();
  expect(screen.getByTestId("confirmation-cancel")).toHaveFocus();
  await user.click(screen.getByTestId("confirmation-cancel"));
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  expect(opener).toHaveFocus();
  await user.click(opener);
  await user.keyboard("{Escape}");
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  expect(opener).toHaveFocus();
  expect(revokeOrganizationMember).not.toHaveBeenCalled();
  expect(listCalls).toEqual([A]);
});

it("revokes with one DELETE, shows success only after the refetch drops the row and parks focus on the heading", async () => {
  const user = await renderAs("owner");
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  expect(await screen.findByTestId("member-revoke-success")).toHaveAttribute(
    "role",
    "status",
  );
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  expect(revokeOrganizationMember).toHaveBeenCalledWith(A, "member-ann");
  expect(screen.queryByTestId("member-row-member-ann")).toBeNull();
  // Initial load plus the post-DELETE refetch; another member's removal does
  // not touch the actor's context.
  expect(listCalls).toEqual([A, A]);
  expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeNull();
  await waitFor(() => expect(heading()).toHaveFocus());
});

it("hides revoke for owner rows from admins and offers it for non-owners", async () => {
  await renderAs("admin");
  expect(revokeButton("member-ann")).toBeEnabled();
  expect(screen.queryByTestId("member-revoke-member-boss")).toBeNull();
});

it("blocks a second confirm and pagination while the DELETE is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(revokeOrganizationMember).mockReturnValue(pending.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    const list = directory.list(id);
    return Promise.resolve({ ...list, page: { ...list.page, total: 60 } });
  });
  const user = await renderAs("owner");
  expect(screen.getByTestId("members-next")).toBeEnabled();
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  expect(
    await screen.findAllByTestId(
      /^(member-revoke-pending|confirmation-pending)$/,
    ),
  ).not.toHaveLength(0);
  const pendingConfirm = screen.getByTestId("member-revoke-confirm");
  expect(pendingConfirm).toBeDisabled();
  await user.click(pendingConfirm);
  expect(screen.getByTestId("members-next")).toBeDisabled();
  expect(screen.getByTestId("confirmation-cancel")).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(
    screen.getByTestId(/^(member-(role|revoke)|self-leave)-dialog$/),
  ).toBeInTheDocument();
  expect(revokeButton("member-boss")).toBeDisabled();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  await act(async () => {
    directory.remove("member-ann");
    pending.resolve(revoked("member-ann"));
    await pending.promise;
  });
  expect(await screen.findByTestId("member-revoke-success")).toBeVisible();
  expect(screen.getByTestId("member-revoke-success")).toHaveTextContent(
    /\bAnn\b/,
  );
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
});

it("explains LAST_OWNER, refreshes the list, shows no success and returns focus to the member's control", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("member-boss"));
  await user.click(confirmButton());
  expect(await screen.findByTestId("member-revoke-error")).toBeInTheDocument();
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
  expect(screen.getByTestId("member-row-member-boss")).toBeInTheDocument();
  expect(
    within(screen.getByTestId("member-row-member-boss")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Boss$/);
  expect(
    within(screen.getByTestId("member-row-member-boss")).getByTestId(
      "member-current-role",
    ),
  ).toHaveAttribute("data-member-role", "owner");
  expect(
    within(screen.getByTestId("member-row-member-boss")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Boss$/);
  expect(listCalls).toEqual([A, A]);
  await waitFor(() => expect(revokeButton("member-boss")).toHaveFocus());
});

it("shows the server message naming the Projects on LAST_PROJECT_ADMIN, with no success", async () => {
  const message =
    "ถอนสมาชิกไม่ได้ ต้องตั้งผู้ดูแลคนอื่นก่อนในโปรเจกต์: Alpha, Beta";
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("LAST_PROJECT_ADMIN", message, 409),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  expect(await screen.findByTestId("member-revoke-error")).toHaveTextContent(
    message,
  );
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
  expect(screen.getByTestId("member-row-member-ann")).toBeInTheDocument();
  await waitFor(() => expect(revokeButton("member-ann")).toHaveFocus());
});

it("shows a generic failure without success and refreshes the list without replaying the DELETE", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("INTERNAL_ERROR", "boom", 500),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  expect(await screen.findByTestId("member-revoke-error")).toBeInTheDocument();
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  expect(listCalls).toEqual([A, A]);
});

it("refreshes context once when the DELETE is PERMISSION_DENIED but the list is still readable", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("PERMISSION_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  expect(await screen.findByTestId("member-revoke-error")).toBeInTheDocument();
  await waitFor(() => {
    expect(
      screen.queryByTestId(/^(member-revoke-pending|confirmation-pending)$/),
    ).toBeNull();
    expect(revokeButton("member-ann")).toBeEnabled();
  });
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches + 1);
});

it("reports an error instead of success when the refetched list still holds the member", async () => {
  vi.mocked(revokeOrganizationMember).mockResolvedValue(revoked("member-ann"));
  const user = await renderAs("owner");
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  expect(await screen.findByTestId("member-revoke-error")).toBeInTheDocument();
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
  expect(screen.getByTestId("member-row-member-ann")).toHaveTextContent("Ann");
  expect(
    within(screen.getByTestId("member-row-member-ann")).getByTestId(
      "member-name",
    ),
  ).toHaveTextContent(/^Ann$/);
  expect(revokeButton("member-ann")).toBeEnabled();
});

it("offers no revoke on the actor's own row, which is the self-leave flow", async () => {
  await renderAs("owner");
  expect(screen.queryByTestId("member-revoke-member-me")).toBeNull();
  expect(revokeButton("member-boss")).toBeEnabled();
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
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace"),
  );
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
});

it("refreshes context and redirects when the server denies the actor's revoke", async () => {
  vi.mocked(revokeOrganizationMember).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return id === A
      ? Promise.reject(new ApiError("MEMBERSHIP_DENIED", "denied", 403))
      : Promise.resolve(directory.list(id));
  });
  // The revoked session's mirror was cleared, so the server confirms no active
  // Organization and the page falls back to a remaining readable one.
  vi.mocked(fetchMeContext).mockResolvedValue({
    ...contextFor("owner", [
      { id: B, name: "Beta", slug: "beta", role: "owner" },
    ]),
    lastActiveTenantId: null,
  });
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${B}/members`,
    ),
  );
  expect(screen.queryByTestId("member-revoke-success")).toBeNull();
});

it("applies the late revoke result to the origin when the organization switch is denied", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(revokeOrganizationMember).mockReturnValue(pending.promise);
  vi.mocked(updateActiveOrganization).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "denied", 403),
  );
  const user = await renderAs("owner");
  await user.click(revokeButton("member-ann"));
  await user.click(confirmButton());
  await user.click(screen.getByTestId("test-member-switch"));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  await act(async () => {
    directory.remove("member-ann");
    pending.resolve(revoked("member-ann"));
    await pending.promise;
  });
  expect(await screen.findByTestId("member-revoke-success")).toBeVisible();
  expect(screen.getByTestId("member-revoke-success")).toHaveTextContent(
    /\bAnn\b/,
  );
  expect(screen.queryByTestId("member-row-member-ann")).toBeNull();
  expect(screen.queryByTestId("member-row-member-b")).toBeNull();
  expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
});

it.each(["success", "LAST_OWNER"] as const)(
  "ignores late origin revoke %s responses after a confirmed organization switch",
  async (outcome) => {
    const pending =
      Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(revokeOrganizationMember).mockReturnValue(pending.promise);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...contextFor("owner"),
      lastActiveTenantId: B,
    });
    const user = await renderAs("owner");
    await user.click(revokeButton("member-ann"));
    await user.click(confirmButton());
    expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
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
    await act(async () => {
      if (outcome === "success") {
        pending.resolve(revoked("member-ann"));
      } else {
        pending.reject(new ApiError("LAST_OWNER", "late", 400));
      }
      await pending.promise.catch(() => undefined);
    });
    expect(screen.getByTestId("member-row-member-b")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent(/^Bea$/);
    expect(revokeButton("member-b")).toBeEnabled();
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
    expect(revokeOrganizationMember).toHaveBeenCalledTimes(1);
    expect(listCalls).toEqual(listCallsBeforeLateResponse);
  },
);
