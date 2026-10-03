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

const pillFor = (name: string) =>
  screen
    .getByRole("row", { name: new RegExp(name) })
    .querySelector('[data-slot="status-pill"]');
// The submit finishes after its refresh branch: pending text gone, control enabled.
const submitSettled = (name: string) =>
  waitFor(() => {
    expect(screen.queryByText(/กำลังบันทึกบทบาทของ/)).toBeNull();
    expect(roleSelect(name)).toBeEnabled();
  });
const save = (name: string) =>
  screen.getByRole("button", { name: `บันทึกบทบาทของ ${name}` });
const roleSelect = (name: string) =>
  screen.getByRole("combobox", { name: `บทบาทใหม่ของ ${name}` });

it("saves a non-owner change directly, without a dialog, and reports success only after the refetch shows the role", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toHaveAttribute(
    "role",
    "status",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
    A,
    "member-ann",
    "auditor",
  );
  expect(pillFor("Ann")).toHaveTextContent("ผู้ตรวจสอบ");
  // Initial load plus the post-PATCH refetch.
  expect(listCalls).toEqual([A, A]);
  // Keyboard focus returns to the same member's control after the list reloads.
  await waitFor(() => expect(roleSelect("Ann")).toHaveFocus());
});

it("asks owners to confirm owner-involved changes, and cancel sends no request", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "owner");
  const opener = save("Ann");
  await user.click(opener);
  const dialog = screen.getByRole("dialog", {
    name: "ยืนยันการเปลี่ยนบทบาท",
  });
  expect(dialog).toHaveAccessibleDescription(/Ann.*Acme \(acme\)/);
  expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
  expect(listCalls).toEqual([A]);

  // Demoting an owner also needs confirmation; Escape cancels.
  await user.selectOptions(roleSelect("Boss"), "admin");
  await user.click(save("Boss"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
});

it("confirms an owner-involved change with one PATCH", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "owner");
  await user.click(save("Ann"));
  const confirm = screen.getByRole("button", {
    name: "ยืนยันการเปลี่ยนบทบาท",
  });
  await user.click(confirm);
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
    A,
    "member-ann",
    "owner",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  // The table reloads behind the dialog; focus must land on a live control.
  await waitFor(() => expect(roleSelect("Ann")).toHaveFocus());
  expect(document.body).not.toHaveFocus();
});

it("shows admins no controls for owners and no owner option elsewhere", async () => {
  const user = await renderAs("admin");
  expect(screen.queryByRole("combobox", { name: /Boss/ })).toBeNull();
  const options = within(roleSelect("Ann"))
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(options).toEqual(["ผู้ดูแล", "ผู้ชม", "ผู้ตรวจสอบ"]);
  await user.selectOptions(roleSelect("Ann"), "admin");
  await user.click(save("Ann"));
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("blocks duplicate submits and pagination while a role save is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  vi.mocked(fetchOrganizationMembers).mockImplementation((id) => {
    listCalls.push(id);
    return Promise.resolve(listFor(id, 120));
  });
  const user = await renderAs("owner");
  expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  expect(
    screen.getByText("กำลังบันทึกบทบาทของ Ann เป็น ผู้ตรวจสอบ…"),
  ).toHaveAttribute("role", "status");
  expect(save("Ann")).toBeDisabled();
  expect(roleSelect("Ann")).toBeDisabled();
  expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
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
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
});

it("explains LAST_OWNER, refreshes the latest roles and shows no success", async () => {
  vi.mocked(updateOrganizationMemberRole).mockRejectedValue(
    new ApiError("LAST_OWNER", "last", 400),
  );
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Boss"), "viewer");
  await user.click(save("Boss"));
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
  expect(
    await screen.findByText(/องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน/),
  ).toBeInTheDocument();
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(listCalls).toEqual([A, A]);
  expect(pillFor("Boss")).toHaveTextContent("เจ้าของ");
  // Focus stays on the member's own controls (opener or its select).
  await waitFor(() => {
    expect(
      screen
        .getByRole("row", { name: /Boss/ })
        .contains(document.activeElement),
    ).toBe(true);
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
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  expect(
    await screen.findByText(/บทบาทของสมาชิกถูกเปลี่ยนโดยผู้อื่น/),
  ).toBeInTheDocument();
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
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
  await user.selectOptions(roleSelect("Me"), "viewer");
  await user.click(save("Me"));
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
  await waitFor(() => {
    expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
      A,
      "member-me",
      "viewer",
    );
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
});

it.each(["success", "LAST_OWNER"] as const)(
  "keeps B role, action and notice untouched by a late A %s response",
  async (outcome) => {
    const pending =
      Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
    vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...contextFor("owner"),
      lastActiveTenantId: B,
    });
    const user = await renderAs("owner");
    await user.selectOptions(roleSelect("Ann"), "owner");
    await user.click(save("Ann"));
    await user.click(
      screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
    );
    expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
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
    expect(pillFor("Bea")).toHaveTextContent("ผู้ชม");
    expect(roleSelect("Bea")).toBeEnabled();
    expect(save("Bea")).toBeDisabled();
    await user.selectOptions(roleSelect("Bea"), "auditor");
    expect(save("Bea")).toBeEnabled();
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
    expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
    expect(listCalls).toEqual(listCallsBeforeLateResponse);
  },
);

it("ignores Escape while a confirmed change is pending", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "owner");
  await user.click(save("Ann"));
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveFocus();
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
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not leave pagination disabled when a confirmed switch retires A while staying on A", async () => {
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
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled(),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  expect(
    screen
      .queryAllByRole("status")
      .filter(
        (element) =>
          !element.hasAttribute("data-testid") && element.textContent !== "",
      ),
  ).toEqual([]);
});

it("keeps A pending, and its result, when the switch to B is denied", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  vi.mocked(updateActiveOrganization).mockRejectedValue(new Error("denied"));
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() => {
    expect(updateActiveOrganization).toHaveBeenCalled();
  });
  expect(save("Ann")).toBeDisabled();
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
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
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
])("shows an error and no success for %s", async (_name, patch, message) => {
  vi.mocked(updateOrganizationMemberRole).mockImplementation(patch);
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
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
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  await submitSettled("Ann");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
});

it("refreshes membership context when another member changes and the actor's listed role differs", async () => {
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  // Another session demoted the actor; the refetched list shows the new role.
  roles["member-me"] = "admin";
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
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
  await user.selectOptions(roleSelect("Me"), "admin");
  await user.click(save("Me"));
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
  expect(
    await screen.findByText(/องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน/),
  ).toBeInTheDocument();
  await submitSettled("Me");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
});

it("refreshes membership context when the actor changes their own role", async () => {
  const user = await renderAs("owner");
  const contextFetches = vi.mocked(fetchMeContext).mock.calls.length;
  await user.selectOptions(roleSelect("Me"), "admin");
  await user.click(save("Me"));
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
  await waitFor(() => {
    expect(vi.mocked(fetchMeContext).mock.calls.length).toBeGreaterThan(
      contextFetches,
    );
  });
});

const RESTRICTED = "คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้";

async function changeOwnRoleToAdmin(
  user: Awaited<ReturnType<typeof renderAs>>,
) {
  await user.selectOptions(roleSelect("Me"), "admin");
  await user.click(save("Me"));
  await user.click(
    screen.getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }),
  );
}

it("shows loading, never a restricted state, while context refreshes after an own role change", async () => {
  const user = await renderAs("owner");
  const refresh = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValue(refresh.promise);
  await changeOwnRoleToAdmin(user);
  expect(
    await screen.findByText("กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก"),
  ).toBeInTheDocument();
  expect(screen.queryByText(RESTRICTED)).toBeNull();
  await act(async () => {
    refresh.resolve(contextFor("admin"));
    await refresh.promise;
  });
  expect(await screen.findByText("Ann")).toBeInTheDocument();
  expect(screen.queryByText(RESTRICTED)).toBeNull();
  expect(screen.getByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  // The table unmounted during the refresh; focus must return to a live control.
  await waitFor(() => expect(roleSelect("Me")).toHaveFocus());
});

it("shows a retryable error, not a restricted state, when the context refresh fails after an own role change", async () => {
  const user = await renderAs("owner");
  vi.mocked(fetchMeContext).mockRejectedValue(new Error("network"));
  await changeOwnRoleToAdmin(user);
  const retry = await screen.findByRole("button", { name: "ลองอีกครั้ง" });
  expect(
    screen.getByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
  ).toBeInTheDocument();
  expect(screen.queryByText(RESTRICTED)).toBeNull();
  const failedFetches = vi.mocked(fetchMeContext).mock.calls.length;
  vi.mocked(fetchMeContext).mockResolvedValue(contextFor("admin"));
  await user.click(retry);
  expect(await screen.findByText("Ann")).toBeInTheDocument();
  expect(vi.mocked(fetchMeContext).mock.calls.length).toBeGreaterThan(
    failedFetches,
  );
  expect(screen.queryByText(RESTRICTED)).toBeNull();
  await waitFor(() => expect(roleSelect("Me")).toHaveFocus());
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
  await user.selectOptions(roleSelect("Ann"), "auditor");
  await user.click(save("Ann"));
  return { contextFetches };
}

it("refreshes membership context once when a PERMISSION_DENIED PATCH leaves the actor off the page", async () => {
  const { contextFetches } = await saveAnnAsAuditorWithActorOffPage(
    new ApiError("PERMISSION_DENIED", "denied", 403),
  );
  expect(await screen.findByText(/บันทึกบทบาทไม่สำเร็จ/)).toBeInTheDocument();
  await waitFor(() => {
    expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(
      contextFetches + 1,
    );
  });
  await submitSettled("Ann");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches + 1);
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
});

it.each([
  ["LAST_OWNER", new ApiError("LAST_OWNER", "last", 400)],
  ["a generic failure", new Error("boom")],
])("does not refresh membership context for %s", async (_name, failure) => {
  const { contextFetches } = await saveAnnAsAuditorWithActorOffPage(failure);
  expect(
    await screen.findByText(/ไม่สำเร็จ|เจ้าของอย่างน้อย/),
  ).toBeInTheDocument();
  await submitSettled("Ann");
  expect(vi.mocked(fetchMeContext).mock.calls).toHaveLength(contextFetches);
});
