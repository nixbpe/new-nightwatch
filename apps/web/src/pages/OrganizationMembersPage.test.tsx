import type { OrganizationMemberListResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOrganizationMembers } from "../lib/api/members";
import { OrganizationMembersPage } from "./OrganizationMembersPage";

const organizationId = "11111111-1111-4111-8111-111111111111";
const response: OrganizationMemberListResponse = {
  organizationId,
  members: [{ id: "member-1", userId: "user-1", name: "Ada", email: "ada@example.test", role: "owner" }],
  page: { limit: 50, offset: 0, total: 51 },
};

vi.mock("../lib/tenant/TenantProvider", () => ({
  useTenant: () => ({
    mePending: false,
    me: { organizations: [{ id: organizationId, name: "Acme", slug: "acme", role: "owner" }] },
  }),
}));
vi.mock("../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/organizations/${organizationId}/members`]}>
        <Routes><Route path="/organizations/:organizationId/members" element={<OrganizationMembersPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.resetAllMocks());

describe("OrganizationMembersPage", () => {
  it("shows total and moves through offset pagination without stale first-page rows", async () => {
    const secondPage: OrganizationMemberListResponse = {
      organizationId,
      members: [
        {
          id: "member-51",
          userId: "user-51",
          name: "Zoe",
          email: "zoe@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 50, total: 51 },
    };
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(secondPage);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("สมาชิกทั้งหมด 51 คน")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("Zoe")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
  });
});
