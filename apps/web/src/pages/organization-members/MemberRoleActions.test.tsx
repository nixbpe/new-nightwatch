import type {
  MeContextResponse,
  OrganizationMemberListResponse,
  OrganizationMemberRoleUpdateResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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
  return (
    <>
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

it("traps Tab inside the dialog and confirms with one PATCH", async () => {
  const user = await renderAs("owner");
  await user.selectOptions(roleSelect("Ann"), "owner");
  await user.click(save("Ann"));
  const cancel = screen.getByRole("button", { name: "ยกเลิก" });
  const confirm = screen.getByRole("button", {
    name: "ยืนยันการเปลี่ยนบทบาท",
  });
  await user.tab();
  expect(confirm).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.tab({ shift: true });
  expect(confirm).toHaveFocus();
  await user.click(confirm);
  expect(await screen.findByText("บันทึกบทบาทแล้ว")).toBeInTheDocument();
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  expect(updateOrganizationMemberRole).toHaveBeenCalledWith(
    A,
    "member-ann",
    "owner",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
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
  expect(screen.getByText("กำลังบันทึกบทบาท…")).toHaveAttribute(
    "role",
    "status",
  );
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

it("drops a late A role response after a confirmed switch to B", async () => {
  const pending = Promise.withResolvers<OrganizationMemberRoleUpdateResponse>();
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
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  const callsBefore = listCalls.length;
  await act(async () => {
    pending.reject(new ApiError("LAST_OWNER", "late", 400));
    await pending.promise.catch(() => undefined);
  });
  expect(screen.queryByText(/องค์กรต้องมีเจ้าของ/)).toBeNull();
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  // No A refetch or notice after the switch; the page's A scope is retired.
  expect(listCalls.length).toBe(callsBefore);
  expect(listCalls.filter((id) => id === A).length).toBe(callsBefore);
});
