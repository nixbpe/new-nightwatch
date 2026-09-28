import type { OrganizationMemberListResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchOrganizationMembers, updateOrganizationMemberRole } from "../../lib/api/members";
import { OrganizationMembersPage } from "../OrganizationMembersPage";

const org = "11111111-1111-4111-8111-111111111111";
const members: OrganizationMemberListResponse = {
  organizationId: org,
  members: [
    { id: "member-1", userId: "user-1", name: "Ada", email: "ada@example.test", role: "owner" },
    { id: "member-2", userId: "user-2", name: "Bea", email: "bea@example.test", role: "viewer" },
  ],
  page: { limit: 50, offset: 0, total: 2 },
};
let actorRole: "owner" | "admin" | "viewer" | "auditor" = "owner";
vi.mock("../../lib/tenant/TenantProvider", () => ({
  useTenant: () => ({
    mePending: false, meError: null,
    me: { user: { id: "actor", name: "Actor", email: "actor@example.test", emailVerified: true, twoFactorEnabled: false }, organizations: [{ id: org, name: "Acme", slug: "acme", role: actorRole }] },
    refreshMembershipContext: vi.fn(),
  }),
}));
vi.mock("../../lib/api/members", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
  updateOrganizationMemberRole: vi.fn(),
}));

function page() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/organizations/${org}/members`]}>
      <Routes><Route path="/organizations/:organizationId/members" element={<OrganizationMembersPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}
function row(name: string) {
  return screen.getByText(name).closest("tr")!;
}
afterEach(() => { vi.resetAllMocks(); actorRole = "owner"; });

it("owner confirmation names target, organization, new role and consequence; cancel has no mutation and restores focus", async () => {
  vi.mocked(fetchOrganizationMembers).mockResolvedValue(members);
  const user = userEvent.setup(); page();
  await screen.findByText("Bea");
  const select = within(row("Bea")).getByRole("combobox", { name: "บทบาทของ Bea" });
  await user.selectOptions(select, "owner");
  const opener = within(row("Bea")).getByRole("button", { name: "บันทึกบทบาทของ Bea" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "ยืนยันการเปลี่ยนบทบาท" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveTextContent("Bea");
  expect(dialog).toHaveTextContent("Acme (acme)");
  expect(dialog).toHaveTextContent("เจ้าของ");
  expect(dialog).toHaveTextContent("การจัดการสมาชิกและการเข้าถึงองค์กร");
  expect(within(dialog).getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog).getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(updateOrganizationMemberRole).not.toHaveBeenCalled();
});

it("admin can directly save a non-owner role but has no owner controls or owner choice", async () => {
  actorRole = "admin";
  const pending = Promise.withResolvers<{ member: { id: string; userId: string; organizationId: string; role: "admin" } }>();
  vi.mocked(fetchOrganizationMembers).mockResolvedValueOnce(members).mockResolvedValueOnce({ ...members, members: [members.members[0]!, { ...members.members[1]!, role: "admin" }] });
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  const user = userEvent.setup(); page();
  expect(await screen.findByText("Ada")).toBeInTheDocument();
  expect(within(row("Ada")).queryByRole("combobox")).toBeNull();
  const select = within(row("Bea")).getByRole("combobox", { name: "บทบาทของ Bea" });
  expect(within(select).queryByRole("option", { name: "เจ้าของ" })).toBeNull();
  await user.selectOptions(select, "admin");
  await user.click(within(row("Bea")).getByRole("button", { name: "บันทึกบทบาทของ Bea" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("กำลังบันทึกบทบาท");
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ member: { id: "member-2", userId: "user-2", organizationId: org, role: "admin" } }); await pending.promise; });
  await waitFor(() => expect(within(row("Bea")).getAllByRole("cell")[2]).toHaveTextContent("ผู้ดูแล"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("บันทึกบทบาทแล้ว"));
});

it.each(["viewer", "auditor"] as const)("%s cannot see member actions or the directory", async (role) => {
  actorRole = role;
  page();
  expect(await screen.findByText("คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: /บทบาทของ/ })).toBeNull();
  expect(fetchOrganizationMembers).not.toHaveBeenCalled();
});

it("LAST_OWNER keeps server-confirmed role, disables duplicate submit and never announces success", async () => {
  const pending = Promise.withResolvers<never>();
  vi.mocked(fetchOrganizationMembers).mockResolvedValue(members);
  vi.mocked(updateOrganizationMemberRole).mockReturnValue(pending.promise);
  const user = userEvent.setup(); page();
  await screen.findByText("Ada");
  const select = within(row("Ada")).getByRole("combobox", { name: "บทบาทของ Ada" });
  await user.selectOptions(select, "viewer");
  await user.click(within(row("Ada")).getByRole("button", { name: "บันทึกบทบาทของ Ada" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "ยืนยันการเปลี่ยนบทบาท" }));
  expect(within(dialog).getByRole("button", { name: "กำลังบันทึกบทบาท…" })).toBeDisabled();
  expect(within(dialog).getByRole("status")).toHaveTextContent("กำลังบันทึกบทบาท");
  expect(updateOrganizationMemberRole).toHaveBeenCalledTimes(1);
  await act(async () => { pending.reject(new ApiError("LAST_OWNER", "last owner", 400)); try { await pending.promise; } catch {} });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ต้องมีเจ้าขององค์กรอย่างน้อยหนึ่งคน"));
  expect(within(row("Ada")).getAllByRole("cell")[2]).toHaveTextContent("เจ้าของ");
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
});

it("refreshes the latest persisted role after a failed mutation without false success", async () => {
  const changed = { ...members, members: [members.members[0]!, { ...members.members[1]!, role: "auditor" as const }] };
  vi.mocked(fetchOrganizationMembers).mockResolvedValueOnce(members).mockResolvedValueOnce(changed);
  vi.mocked(updateOrganizationMemberRole).mockRejectedValueOnce(new ApiError("PERMISSION_DENIED", "denied", 403));
  const user = userEvent.setup();
  page();
  await screen.findByText("Bea");
  await user.selectOptions(within(row("Bea")).getByRole("combobox"), "admin");
  await user.click(within(row("Bea")).getByRole("button", { name: "บันทึกบทบาทของ Bea" }));
  await waitFor(() => expect(within(row("Bea")).getAllByRole("cell")[2]).toHaveTextContent("ผู้ตรวจสอบ"));
  expect(screen.getByRole("alert")).toHaveTextContent("บันทึกบทบาทไม่สำเร็จ");
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
});

it("does not claim the requested role is current when another actor changes it before refresh", async () => {
  vi.mocked(fetchOrganizationMembers)
    .mockResolvedValueOnce(members)
    .mockResolvedValueOnce({ ...members, members: [members.members[0]!, { ...members.members[1]!, role: "auditor" }] });
  vi.mocked(updateOrganizationMemberRole).mockResolvedValueOnce({
    member: { id: "member-2", userId: "user-2", organizationId: org, role: "admin" },
  });
  const user = userEvent.setup();
  page();
  await screen.findByText("Bea");
  await user.selectOptions(within(row("Bea")).getByRole("combobox"), "admin");
  await user.click(within(row("Bea")).getByRole("button", { name: "บันทึกบทบาทของ Bea" }));
  await waitFor(() => expect(within(row("Bea")).getAllByRole("cell")[2]).toHaveTextContent("ผู้ตรวจสอบ"));
  expect(screen.getByRole("alert")).toHaveTextContent("บทบาทถูกเปลี่ยนอีกครั้ง");
  expect(screen.queryByText("บันทึกบทบาทแล้ว")).toBeNull();
});

it("removes admin role controls after a denied request reveals an owner target", async () => {
  actorRole = "admin";
  vi.mocked(fetchOrganizationMembers)
    .mockResolvedValueOnce(members)
    .mockResolvedValueOnce({ ...members, members: [members.members[0]!, { ...members.members[1]!, role: "owner" }] });
  vi.mocked(updateOrganizationMemberRole).mockRejectedValueOnce(new ApiError("PERMISSION_DENIED", "denied", 403));
  const user = userEvent.setup();
  page();
  await screen.findByText("Bea");
  await user.selectOptions(within(row("Bea")).getByRole("combobox"), "admin");
  await user.click(within(row("Bea")).getByRole("button", { name: "บันทึกบทบาทของ Bea" }));
  await waitFor(() => expect(within(row("Bea")).getAllByRole("cell")[2]).toHaveTextContent("เจ้าของ"));
  expect(within(row("Bea")).queryByRole("combobox")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("บันทึกบทบาทไม่สำเร็จ");
});
