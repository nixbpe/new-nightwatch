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

import { createInvitation } from "../lib/api/invitations";
import { fetchMeContext, updateActiveOrganization } from "../lib/api/me";
import { fetchOrganizationMembers } from "../lib/api/members";
import { TenantProvider, useTenant } from "../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "./OrganizationMembersPage";

vi.mock("../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createInvitation: vi.fn(),
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
};

function TenantView() {
  const { serverActiveOrgId, switchOrg } = useTenant();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void switchOrg(B)}>
        confirm B
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

afterEach(() => vi.resetAllMocks());

it("retires an A invitation on real tenant publication while navigation still holds A", async () => {
  const post = Promise.withResolvers<InvitationCreateResponse>();
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
  expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "confirm B" }));
  await waitFor(() =>
    expect(screen.getByTestId("active-scope")).toHaveTextContent(B),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/organizations/${A}/members`,
  );
  expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  await act(async () => {
    post.resolve({ created: true, emailDispatch: "failed" });
    await post.promise;
  });
  expect(screen.queryByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ")).toBeNull();
  expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  await user.click(screen.getByRole("button", { name: "navigate B" }));
  expect(await screen.findByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
});
