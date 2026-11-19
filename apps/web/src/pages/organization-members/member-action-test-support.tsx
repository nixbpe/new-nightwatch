import type {
  MeContextResponse,
  OrganizationMember,
  OrganizationMemberListResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";

import { bindQueryClientIdentity } from "../../lib/queryClient";
import { TenantProvider, useTenant } from "../../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "../OrganizationMembersPage";

export const A = "11111111-1111-4111-8111-111111111111";
export const B = "22222222-2222-4222-8222-222222222222";
export const ME = "user-me";

export function contextFor(
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

export class MemberDirectory {
  private members: Record<typeof A | typeof B, OrganizationMember[]> = {
    [A]: [
      {
        id: "member-me",
        userId: ME,
        name: "Me",
        email: "me@example.test",
        role: "owner",
      },
      {
        id: "member-ann",
        userId: "user-ann",
        name: "Ann",
        email: "ann@example.test",
        role: "viewer",
      },
      {
        id: "member-boss",
        userId: "user-boss",
        name: "Boss",
        email: "boss@example.test",
        role: "owner",
      },
    ],
    [B]: [
      {
        id: "member-b",
        userId: "user-b",
        name: "Bea",
        email: "bea@example.test",
        role: "viewer",
      },
    ],
  };

  setRole(memberId: string, role: OrganizationRole) {
    for (const member of this.members[A]) {
      if (member.id === memberId) member.role = role;
    }
  }

  remove(memberId: string) {
    this.members[A] = this.members[A].filter(
      (member) => member.id !== memberId,
    );
  }

  list(organizationId: string, total?: number): OrganizationMemberListResponse {
    const directoryId = organizationId === B ? B : A;
    const members = this.members[directoryId].map((member) => ({
      ...member,
    }));
    return {
      organizationId,
      members,
      page: {
        limit: 50,
        offset: 0,
        total:
          organizationId === B ? members.length : (total ?? members.length),
      },
      memberLimit: 1000,
    };
  }
}

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

export function mountMembersPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, ME);
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <MemoryRouter initialEntries={[`/organizations/${A}/members`]}>
          <Harness />
        </MemoryRouter>
      </TenantProvider>
    </QueryClientProvider>,
  );
  return {
    user,
    dispose() {
      view.unmount();
      queryClient.clear();
    },
  };
}
