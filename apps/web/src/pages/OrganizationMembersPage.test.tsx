import { SelfLeaveRouteBoundary } from "./organization-members/SelfLeaveAction";
import type {
  InvitationCreateResponse,
  OrganizationMemberListResponse,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import {
  createMemoryRouter,
  RouterProvider,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { OrgSwitcher } from "../components/shell/OrgSwitcher";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../lib/api/members";
import {
  cancelInvitation,
  createInvitation,
  fetchPendingInvitations,
} from "../lib/api/invitations";
import { OrganizationMembersPage } from "./OrganizationMembersPage";

function MemberDataRouter({
  initialEntries,
  children,
}: {
  initialEntries: string[];
  children: ReactNode;
}) {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        {
          path: "*",
          element: <SelfLeaveRouteBoundary>{children}</SelfLeaveRouteBoundary>,
        },
      ],
      { initialEntries },
    ),
  );
  return <RouterProvider router={router} />;
}

const organizationId = "11111111-1111-4111-8111-111111111111";
const response: OrganizationMemberListResponse = {
  organizationId,
  members: [
    {
      id: "member-1",
      userId: "user-1",
      name: "Ada",
      email: "ada@example.test",
      role: "owner",
    },
  ],
  page: { limit: 50, offset: 0, total: 51 },
  memberLimit: 1000,
};

const firstMember = response.members[0];
if (firstMember === undefined) {
  throw new Error("directory test fixture needs a first member");
}

const organizationBId = "22222222-2222-4222-8222-222222222222";
const organizationA = {
  id: organizationId,
  name: "Acme",
  slug: "acme",
  role: "owner" as const,
};
const organizationB = {
  id: organizationBId,
  name: "Beta",
  slug: "beta",
  role: "owner" as const,
};

type TenantOrganization = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "viewer" | "auditor";
};

type TenantStub = {
  mePending: boolean;
  me: { organizations: TenantOrganization[] } | undefined;
  meError: Error | null;
  refreshMembershipContext: Mock;
  activeOrg: TenantOrganization;
  orgSwitchPending: boolean;
  switchOrg: (organizationId: string) => Promise<boolean>;
};

let tenant: TenantStub = {
  mePending: false,
  me: { organizations: [organizationA] },
  meError: null,
  refreshMembershipContext: vi.fn(),
  activeOrg: organizationA,
  orgSwitchPending: false,
  switchOrg: () => Promise.resolve(false),
};

vi.mock("../lib/tenant/TenantProvider", () => ({
  useTenant: () => ({
    ...tenant,
    selfLeave: { kind: "idle" },
    deliverSelfLeave: () => false,
    consumeSelfLeaveNotice: () => undefined,
    settleSelfLeave: () => Promise.resolve(),
    retrySelfLeave: () => Promise.resolve(),
    me: tenant.me && { user: { id: "user-1" }, ...tenant.me },
  }),
}));
vi.mock("../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
}));
vi.mock("../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  fetchPendingInvitations: vi.fn(async (organizationId: string) =>
    (await import("../test/pendingInvitations")).emptyPendingInvitationList(
      organizationId,
    ),
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  vi.resetAllMocks();
  tenant = {
    mePending: false,
    me: { organizations: [organizationA] },
    meError: null,
    refreshMembershipContext: vi.fn(),
    activeOrg: organizationA,
    orgSwitchPending: false,
    switchOrg: () => Promise.resolve(false),
  };
});

// The invitation section keeps an empty status region mounted, so member and
// notice assertions address the one status region that carries text.
const textStatuses = () =>
  screen
    .queryAllByTestId(
      /^(members-(list|admission|context)-status|members-invitation-(success|warning)|pending-invitations-(status|loading|(?:cancel|resend)-(pending|success|warning))|member-(role|revoke)-(pending|success))$/,
    )
    .filter((node) => node.textContent !== "");
const getStatus = () => {
  const found = textStatuses();
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
};
const findStatus = () => waitFor(getStatus);

describe("OrganizationMembersPage", () => {
  // The outcome messages (pre-insert failure, SMTP accepted, SMTP failed) are
  // each asserted by InvitationPanel.test.tsx; this page-level test only
  // needs one outcome to exercise the behavior unique to it, which is
  // outcome-independent: the draft survives a background member-list
  // refetch and pagination while the create is still pending.
  it("keeps the organization invitation mounted across refetch and pagination", async () => {
    const post = Promise.withResolvers<InvitationCreateResponse>();
    const nextPage = Promise.withResolvers<OrganizationMemberListResponse>();
    const refreshedPage =
      Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(createInvitation).mockReturnValue(post.promise);
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => refreshedPage.promise)
      .mockImplementationOnce(() => nextPage.promise);
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    const email = screen.getByTestId("members-invitation-email");
    await user.type(email, "new@example.com");
    await user.click(screen.getByTestId("members-invitation-send"));
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: memberListQueryKey(organizationId, 50, 0),
        exact: true,
      });
    });
    expect(await findStatus()).toHaveRole("status");
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(email).toBeInTheDocument();
    expect(email).toHaveValue("new@example.com");
    expect(screen.getByTestId("members-invitation-send")).toBeDisabled();
    refreshedPage.resolve(response);
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.click(screen.getByTestId("members-next"));
    expect(await findStatus()).toHaveRole("status");
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(email).toBeInTheDocument();
    nextPage.resolve({
      ...response,
      members: [{ ...firstMember, id: "member-51", name: "Zoe" }],
      page: { limit: 50, offset: 50, total: 51 },
      memberLimit: 1000,
    });
    expect(
      await screen.findByTestId("member-row-member-51"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-51")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Zoe");
    await act(async () => {
      post.resolve({ created: true, emailDispatch: "accepted" });
      await post.promise;
    });
    // The pending list reloads page 1 after a create; its own loading
    // status leaves once that fetch settles, leaving the panel's notice.
    await waitFor(() => {
      expect(getStatus()).toHaveRole("status");
    });
    expect(email).toHaveValue("");
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
  });
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
      memberLimit: 1000,
    };
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(secondPage);
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByTestId("members-total-count"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-total")).toHaveTextContent("51");
    expect(screen.getByTestId("members-limit")).toHaveTextContent("1,000");
    expect(screen.getByTestId("member-row-member-1")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.click(screen.getByTestId("members-next"));
    expect(
      await screen.findByTestId("member-row-member-51"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-51")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Zoe");
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("members-next")).toBeDisabled();
  });
  it("renders the redesigned page structure: actor marker, headings and mono counts", async () => {
    vi.mocked(fetchOrganizationMembers).mockResolvedValueOnce(response);
    renderPage();

    await screen.findByTestId("members-total-count");
    expect(screen.getByTestId("members-total")).toHaveTextContent("51");
    expect(screen.getByTestId("members-limit")).toHaveTextContent("1,000");

    const actor = screen.getByTestId("member-row-member-1");
    expect(
      within(actor).getByTestId("member-current-actor"),
    ).not.toBeEmptyDOMElement();
    expect(within(actor).getByTestId("member-name")).toHaveTextContent(/^Ada$/);
    expect(within(actor).getByTestId("member-email")).toHaveTextContent(
      /^ada@example.test$/,
    );
    expect(within(actor).getByTestId("member-current-role")).toHaveAttribute(
      "data-member-role",
      "owner",
    );
    expect(screen.queryByTestId("member-revoke-member-1")).toBeNull();
    expect(screen.getByTestId("member-role-select-member-1")).toHaveValue(
      "owner",
    );
    expect(screen.getByTestId("page-title").tagName).toBe("H1");
    expect(screen.getByTestId("members-directory-heading")).toHaveRole(
      "heading",
    );
    expect(screen.getByTestId("members-total")).toHaveTextContent(/^51$/);
    expect(screen.getByTestId("members-limit")).toHaveTextContent(/^1,000$/);
  });
  it("shows the member limit from the response with thousands separators", async () => {
    vi.mocked(fetchOrganizationMembers).mockResolvedValueOnce({
      ...response,
      page: { limit: 50, offset: 0, total: 1234 },
      memberLimit: 2500,
    });
    renderPage();

    await screen.findByTestId("members-total-count");
    expect(screen.getByTestId("members-total")).toHaveTextContent("1,234");
    expect(screen.getByTestId("members-limit")).toHaveTextContent("2,500");
  });
  it("hides stale first-page member data while revisiting it refetches", async () => {
    const secondPage: OrganizationMemberListResponse = {
      ...response,
      members: [
        {
          ...firstMember,
          id: "member-51",
          name: "Zoe",
          email: "zoe@example.test",
        },
      ],
      page: { limit: 50, offset: 50, total: 51 },
      memberLimit: 1000,
    };
    const freshFirstPage =
      Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(secondPage)
      .mockImplementationOnce(() => freshFirstPage.promise);
    const user = userEvent.setup();
    const { queryClient } = renderPage();

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.click(screen.getByTestId("members-next"));
    expect(
      await screen.findByTestId("member-row-member-51"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-51")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Zoe");
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      response,
      {
        updatedAt: Date.now() - 30_001,
      },
    );
    await user.click(screen.getByTestId("members-previous"));

    expect(await findStatus()).toHaveRole("status");
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("members-pagination-summary"),
    ).not.toBeInTheDocument();

    freshFirstPage.resolve({
      ...response,
      members: [{ ...firstMember, name: "Fresh Ada" }],
    });

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Fresh Ada");
    expect(screen.getByTestId("members-total-count")).toBeInTheDocument();
    expect(screen.getByTestId("members-total")).toHaveTextContent("51");
    expect(screen.getByTestId("members-limit")).toHaveTextContent("1,000");
    expect(
      screen.getByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /1\s*[–-]\s*1.*51/,
    );
  });

  it("hides current-page member data during a background refetch", async () => {
    const freshPage = Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => freshPage.promise);
    const { queryClient } = renderPage();

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: memberListQueryKey(organizationId, 50, 0),
        exact: true,
      });
    });

    expect(await findStatus()).toHaveRole("status");
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("members-pagination-summary"),
    ).not.toBeInTheDocument();

    freshPage.resolve({
      ...response,
      members: [{ ...firstMember, name: "Fresh Ada" }],
    });

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Fresh Ada");
  });
  it("returns to first-page rows by keyboard after the next page fails", async () => {
    const restoredPage =
      Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => restoredPage.promise);
    const user = userEvent.setup();
    const { queryClient } = renderPage();

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.click(screen.getByTestId("members-next"));

    expect(await screen.findByTestId("members-list-alert")).toBeInTheDocument();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(screen.getByTestId("members-list-retry")).toBeEnabled();
    const previous = screen.getByTestId("members-previous");
    expect(previous).toBeEnabled();
    previous.focus();
    expect(previous).toHaveFocus();
    queryClient.removeQueries({
      queryKey: memberListQueryKey(organizationId, 50, 0),
      exact: true,
    });
    await user.keyboard("{Enter}");

    expect(await findStatus()).toHaveRole("status");
    const heading = screen.getByTestId("page-title");
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");

    restoredPage.resolve(response);

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    expect(heading).toHaveFocus();
    expect(
      screen.getByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /1\s*[–-]\s*1.*51/,
    );
    expect(screen.queryByTestId("members-list-alert")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(3);
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      3,
      organizationId,
      50,
      0,
    );
  });
  it("moves focus to the heading after pointer Previous from a failed page", async () => {
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response);
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.click(screen.getByTestId("members-next"));
    expect(await screen.findByTestId("members-list-alert")).toBeInTheDocument();
    await user.click(screen.getByTestId("members-previous"));

    const heading = await screen.findByTestId("page-title");
    expect(heading).toHaveFocus();
    expect(
      screen.getByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /1\s*[–-]\s*1.*51/,
    );
  });

  it("resets an invalid later page before success rendering and refetches page one once", async () => {
    const invalidSecondPage: OrganizationMemberListResponse = {
      organizationId,
      members: [],
      page: { limit: 50, offset: 50, total: 49 },
      memberLimit: 1000,
    };
    const repairedFirstPage: OrganizationMemberListResponse = {
      ...response,
      members: [{ ...firstMember, name: "Repaired first member" }],
      page: { limit: 50, offset: 0, total: 49 },
      memberLimit: 1000,
    };
    const repairedFirstPageResult =
      Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(invalidSecondPage)
      .mockImplementationOnce(() => repairedFirstPageResult.promise);
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("member-row-member-1");
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.click(screen.getByTestId("members-next"));

    expect(await findStatus()).toHaveRole("status");
    expect(screen.queryByTestId("members-pagination-summary")).toBeNull();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    repairedFirstPageResult.resolve(repairedFirstPage);
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Repaired first member");
    expect(
      screen.getByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /1\s*[–-]\s*1.*49/,
    );
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      3,
      organizationId,
      50,
      0,
    );
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(3);
  });

  it("renders a zero-total first page as empty success without refetching", async () => {
    vi.mocked(fetchOrganizationMembers).mockResolvedValueOnce({
      organizationId,
      members: [],
      page: { limit: 50, offset: 0, total: 0 },
      memberLimit: 1000,
    });
    renderPage();

    expect(
      await screen.findByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /0\s*[–-]\s*0.*0/,
    );
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(1);
  });

  it("announces denied access without requesting or rendering directory data", () => {
    tenant = {
      ...tenant,
      me: {
        organizations: [
          {
            id: organizationId,
            name: "Acme",
            slug: "acme",
            role: "viewer",
          },
        ],
      },
    };
    renderPage();

    expect(screen.getByTestId("members-denied-alert")).toHaveRole("alert");
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("members-invitation-send")).toBeNull();
    expect(fetchOrganizationMembers).not.toHaveBeenCalled();
  });

  it("offers context retry without rendering cached directory data after a fresh decision fails", () => {
    tenant = {
      ...tenant,
      me: undefined,
      meError: new Error("context unavailable"),
    };
    renderPage();

    expect(screen.getByTestId("members-context-alert")).toHaveRole("alert");
    expect(screen.getByTestId("members-context-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("member-row-member-1")).toBeNull();
    expect(screen.queryByTestId("members-total-count")).toBeNull();
    expect(fetchOrganizationMembers).not.toHaveBeenCalled();
  });

  it("announces loading and a retryable failure without stale rows", async () => {
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId("members-list-alert")).toHaveRole("alert");
    expect(screen.queryByTestId("members-previous")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("members-list-retry"));
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
  });

  it("unmounts a pending invitation when fresh permission denies its organization", async () => {
    const post = Promise.withResolvers<InvitationCreateResponse>();
    vi.mocked(createInvitation).mockReturnValue(post.promise);
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new ApiError("PERMISSION_DENIED", "revoked", 403));
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => {
        tenant = {
          ...tenant,
          me: { organizations: [{ ...organizationA, role: "viewer" }] },
        };
        return Promise.resolve({
          organizations: tenant.me?.organizations ?? [],
          lastActiveTenantId: organizationId,
        });
      }),
    };
    const user = userEvent.setup();
    const { queryClient } = renderPage();
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    await user.type(
      screen.getByTestId("members-invitation-email"),
      "a-draft@example.test",
    );
    await user.click(screen.getByTestId("members-invitation-send"));
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: memberListQueryKey(organizationId, 50, 0),
        exact: true,
      });
    });
    await waitFor(() => {
      expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("members-invitation-email"),
      ).not.toBeInTheDocument();
    });
    await act(async () => {
      post.resolve({ created: true, emailDispatch: "accepted" });
      await post.promise;
    });
    expect(
      screen.queryByTestId("members-invitation-success"),
    ).not.toBeInTheDocument();
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
  });

  it("recovers membership when an initial list retry is denied", async () => {
    const viewerOrganization = {
      ...organizationA,
      role: "viewer" as const,
    };
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => {
        tenant = {
          ...tenant,
          me: { organizations: [viewerOrganization] },
          activeOrg: viewerOrganization,
        };
        return Promise.resolve({
          organizations: [viewerOrganization],
          lastActiveTenantId: organizationId,
        });
      }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      );
    const user = userEvent.setup();

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route
              path="/workspace"
              element={<p data-testid="test-members-workspace">workspace</p>}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("members-list-alert")).toBeInTheDocument();
    await user.click(screen.getByTestId("members-list-retry"));
    expect(
      await screen.findByTestId("test-members-workspace"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
  });

  it("keeps a delayed origin member page and offset out of the confirmed destination scope", async () => {
    const pendingInvitation = Promise.withResolvers<InvitationCreateResponse>();
    vi.mocked(createInvitation).mockReturnValue(pendingInvitation.promise);
    let resolveASecondPage!: (value: OrganizationMemberListResponse) => void;
    const delayedASecondPage = new Promise<OrganizationMemberListResponse>(
      (resolve) => {
        resolveASecondPage = resolve;
      },
    );
    const aFirstPage: OrganizationMemberListResponse = {
      ...response,
      members: [{ ...firstMember, name: "A-first" }],
    };
    const bPage: OrganizationMemberListResponse = {
      organizationId: organizationBId,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "B-only",
          email: "b@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(aFirstPage)
      .mockImplementationOnce(() => delayedASecondPage)
      .mockResolvedValueOnce(bPage);
    const user = userEvent.setup();

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    function SwitchableDirectory() {
      const [, setRevision] = useState(0);
      tenant = {
        ...tenant,
        me: { organizations: [organizationA, organizationB] },
        activeOrg: organizationA,
        switchOrg: (nextOrganizationId: string) => {
          if (nextOrganizationId !== organizationBId)
            return Promise.resolve(false);
          tenant = { ...tenant, activeOrg: organizationB };
          setRevision((value) => value + 1);
          return Promise.resolve(true);
        },
      };
      return (
        <>
          <OrgSwitcher collapsed={false} />
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </>
      );
    }

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <SwitchableDirectory />
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("A-first");
    await user.type(
      screen.getByTestId("members-invitation-email"),
      "a-draft@example.test",
    );
    await user.click(screen.getByTestId("members-invitation-send"));
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("members-next"));
    expect(await screen.findByTestId("members-list-status")).toHaveAttribute(
      "role",
      "status",
    );
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(
      screen.getByTestId(`shell-organization-${organizationBId}`),
    );

    expect(
      await screen.findByTestId("member-row-member-b"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("B-only");
    expect(screen.getByTestId("members-invitation-email")).toHaveValue("");
    expect(screen.getByTestId("members-invitation-email")).not.toHaveValue(
      "a-draft@example.test",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(screen.getByTestId("members-organization-slug")).toBeInTheDocument();
    expect(screen.getByTestId("members-organization-slug")).toHaveTextContent(
      "beta",
    );
    expect(
      screen.getByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /1\s*[–-]\s*1.*1/,
    );
    expect(screen.getByTestId("members-previous")).toBeDisabled();
    expect(screen.getByTestId("members-next")).toBeDisabled();

    resolveASecondPage({
      ...response,
      members: [{ ...firstMember, name: "A-late" }],
      page: { limit: 50, offset: 50, total: 51 },
      memberLimit: 1000,
    });
    await Promise.resolve();
    await act(async () => {
      pendingInvitation.resolve({ created: true, emailDispatch: "failed" });
      await pendingInvitation.promise;
    });
    expect(
      screen.queryByTestId("members-invitation-warning"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("members-invitation-email")).toHaveValue("");
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);

    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("member-row-member-b")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("B-only");
  });

  it("keeps the origin scope, route, list and offset when an organization switch is denied", async () => {
    const aSecondPage: OrganizationMemberListResponse = {
      ...response,
      members: [{ ...firstMember, name: "A-second" }],
      page: { limit: 50, offset: 50, total: 51 },
      memberLimit: 1000,
    };
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce({
        ...response,
        members: [{ ...firstMember, name: "A-first" }],
      })
      .mockResolvedValueOnce(aSecondPage);
    const user = userEvent.setup();

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    function DeniedSwitchDirectory() {
      tenant = {
        ...tenant,
        me: { organizations: [organizationA, organizationB] },
        activeOrg: organizationA,
        switchOrg: () => Promise.resolve(false),
      };
      return (
        <>
          <OrgSwitcher collapsed={false} />
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </>
      );
    }

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <DeniedSwitchDirectory />
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("A-first");
    await user.click(screen.getByTestId("members-next"));
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("A-second");
    await user.type(
      screen.getByTestId("members-invitation-email"),
      "a-draft@example.test",
    );
    await user.click(screen.getByTestId("shell-organization-switch"));
    await user.click(
      screen.getByTestId(`shell-organization-${organizationBId}`),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationId}/members`,
    );
    expect(screen.getByTestId("members-organization-slug")).toBeInTheDocument();
    expect(screen.getByTestId("members-organization-slug")).toHaveTextContent(
      "acme",
    );
    expect(screen.getByTestId("member-row-member-1")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("A-second");
    expect(screen.queryByTestId("member-row-member-b")).not.toBeInTheDocument();
    expect(screen.getByTestId("members-invitation-email")).toHaveValue(
      "a-draft@example.test",
    );
    expect(
      screen.getByTestId("members-pagination-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-pagination-summary")).toHaveTextContent(
      /51\s*[–-]\s*51.*51/,
    );
    expect(screen.getByTestId("members-previous")).toBeEnabled();
  });

  it("keeps revoked organization access restricted until fresh context confirms a replacement", async () => {
    const bPage: OrganizationMemberListResponse = {
      organizationId: organizationBId,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "B-confirmed",
          email: "b@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    tenant = {
      ...tenant,
      refreshMembershipContext: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(() => {
          tenant = {
            ...tenant,
            me: { organizations: [organizationB] },
            activeOrg: organizationB,
          };
          return Promise.resolve({
            organizations: [organizationB],
            lastActiveTenantId: organizationBId,
          });
        }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      )
      .mockResolvedValueOnce(bPage);

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route
              path="/workspace"
              element={<p data-testid="test-members-workspace">workspace</p>}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("members-admission-retry"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationId}/members`,
    );
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-row-member-1")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByTestId("members-admission-retry"));

    expect(
      await screen.findByTestId("member-row-member-b"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("B-confirmed");
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(screen.getByTestId("members-organization-slug")).toHaveTextContent(
      /^beta$/,
    );
    expect(
      screen.getByTestId("members-organization-slug"),
    ).not.toHaveTextContent("acme");
  });

  it("announces a pending membership refresh and recovers after a denied list", async () => {
    const context = Promise.withResolvers<{
      organizations: TenantOrganization[];
      lastActiveTenantId: string;
    }>();
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => context.promise),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("PERMISSION_DENIED", "authorization stale", 403),
      )
      .mockResolvedValueOnce(response);

    renderPage();

    expect(
      await screen.findByTestId("members-admission-status"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-admission-status")).toBeVisible();
    expect(
      screen.queryByTestId("members-admission-alert"),
    ).not.toBeInTheDocument();

    context.resolve({
      organizations: [organizationA],
      lastActiveTenantId: organizationId,
    });

    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    expect(
      screen.queryByTestId("members-admission-alert"),
    ).not.toBeInTheDocument();
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    // The retry after a confirmed, unchanged membership requests the same
    // organization and page, not a reset.
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      1,
      organizationId,
      50,
      0,
    );
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      2,
      organizationId,
      50,
      0,
    );
  });

  it("recovers fresh membership again when the bounded refetch is denied", async () => {
    const viewerOrganization = {
      ...organizationA,
      role: "viewer" as const,
    };
    tenant = {
      ...tenant,
      refreshMembershipContext: vi
        .fn()
        .mockResolvedValueOnce({
          organizations: [organizationA],
          lastActiveTenantId: organizationId,
        })
        .mockImplementationOnce(() => {
          tenant = {
            ...tenant,
            me: { organizations: [viewerOrganization] },
            activeOrg: viewerOrganization,
          };
          return Promise.resolve({
            organizations: [viewerOrganization],
            lastActiveTenantId: organizationId,
          });
        }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("PERMISSION_DENIED", "authorization stale", 403),
      )
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      );

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route
              path="/workspace"
              element={<p data-testid="test-members-workspace">workspace</p>}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("test-members-workspace"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
  });

  it("stops at context retry when a second fresh owner context cannot explain denial", async () => {
    tenant = {
      ...tenant,
      refreshMembershipContext: vi
        .fn()
        .mockResolvedValueOnce({
          organizations: [organizationA],
          lastActiveTenantId: organizationId,
        })
        .mockResolvedValueOnce({
          organizations: [organizationA],
          lastActiveTenantId: organizationId,
        }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("PERMISSION_DENIED", "authorization stale", 403),
      )
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      );

    renderPage();

    expect(
      await screen.findByTestId("members-admission-alert"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-admission-retry")).toBeInTheDocument();
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
  });

  it("stops at context retry when the second membership recovery fails", async () => {
    tenant = {
      ...tenant,
      refreshMembershipContext: vi
        .fn()
        .mockResolvedValueOnce({
          organizations: [organizationA],
          lastActiveTenantId: organizationId,
        })
        .mockResolvedValueOnce(null),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("PERMISSION_DENIED", "authorization stale", 403),
      )
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      );

    renderPage();

    expect(
      await screen.findByTestId("members-admission-alert"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("members-admission-retry")).toBeInTheDocument();
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
  });

  it("ignores a late membership recovery after the page unmounts", async () => {
    const context = Promise.withResolvers<{
      organizations: TenantOrganization[];
      lastActiveTenantId: string;
    }>();
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => context.promise),
    };
    vi.mocked(fetchOrganizationMembers).mockRejectedValueOnce(
      new ApiError("PERMISSION_DENIED", "authorization stale", 403),
    );

    const page = renderPage();

    expect(
      await screen.findByTestId("members-admission-status"),
    ).toBeInTheDocument();
    page.unmount();
    context.resolve({
      organizations: [organizationA],
      lastActiveTenantId: organizationId,
    });

    await waitFor(() => {
      expect(fetchOrganizationMembers).toHaveBeenCalledOnce();
    });
  });

  it("shows normal retry after the bounded same-organization refetch fails", async () => {
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn().mockResolvedValue({
        organizations: [organizationA],
        lastActiveTenantId: organizationId,
      }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("PERMISSION_DENIED", "authorization stale", 403),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response);
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByTestId("members-list-alert")).toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    await user.click(screen.getByTestId("members-list-retry"));
    expect(
      await screen.findByTestId("member-row-member-1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-1")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Ada");
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(3);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
  });

  it("recovers membership after a manual list retry is denied", async () => {
    const viewerOrganization = {
      ...organizationA,
      role: "viewer" as const,
    };
    tenant = {
      ...tenant,
      refreshMembershipContext: vi
        .fn()
        .mockResolvedValueOnce({
          organizations: [organizationA],
          lastActiveTenantId: organizationId,
        })
        .mockImplementationOnce(() => {
          tenant = {
            ...tenant,
            me: { organizations: [viewerOrganization] },
            activeOrg: viewerOrganization,
          };
          return Promise.resolve({
            organizations: [viewerOrganization],
            lastActiveTenantId: organizationId,
          });
        }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("PERMISSION_DENIED", "authorization stale", 403),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      );
    const user = userEvent.setup();

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route
              path="/workspace"
              element={<p data-testid="test-members-workspace">workspace</p>}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("members-list-alert")).toBeInTheDocument();
    await user.click(screen.getByTestId("members-list-retry"));
    expect(
      await screen.findByTestId("test-members-workspace"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(3);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
  });

  it("retires revoked scope after the next list denial and routes to the confirmed replacement", async () => {
    const bPage: OrganizationMemberListResponse = {
      organizationId: organizationBId,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "B-confirmed",
          email: "b@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    tenant = {
      ...tenant,
      me: { organizations: [organizationA, organizationB] },
      activeOrg: organizationA,
      refreshMembershipContext: vi.fn(() => {
        tenant = {
          ...tenant,
          me: { organizations: [organizationB] },
          activeOrg: organizationB,
        };
        return Promise.resolve({
          organizations: [organizationB],
          lastActiveTenantId: organizationBId,
        });
      }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      )
      .mockResolvedValueOnce(bPage);

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("member-row-member-b"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("B-confirmed");
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(
      screen.getByTestId("members-organization-slug"),
    ).not.toHaveTextContent("acme");
    expect(screen.getByTestId("members-organization-slug")).toBeInTheDocument();
    expect(screen.getByTestId("members-organization-slug")).toHaveTextContent(
      "beta",
    );
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      1,
      organizationId,
      50,
      0,
    );
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      2,
      organizationBId,
      50,
      0,
    );
  });

  it("routes a permission-denied directory to workspace when fresh memberships are not list-readable", async () => {
    const viewerOrganization = {
      ...organizationA,
      role: "viewer" as const,
    };
    const auditorOrganization = {
      id: organizationBId,
      name: "Beta",
      slug: "beta",
      role: "auditor" as const,
    };
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => {
        tenant = {
          ...tenant,
          me: { organizations: [viewerOrganization, auditorOrganization] },
          activeOrg: viewerOrganization,
        };
        return Promise.resolve({
          organizations: [viewerOrganization, auditorOrganization],
          lastActiveTenantId: organizationId,
        });
      }),
    };
    vi.mocked(fetchOrganizationMembers).mockRejectedValueOnce(
      new ApiError("PERMISSION_DENIED", "role downgraded", 403),
    );

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route
              path="/workspace"
              element={<p data-testid="test-members-workspace">workspace</p>}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("test-members-workspace"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(
      screen.queryByTestId("members-organization-slug"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("members-total-count")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledOnce();
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
  });

  it("uses a fresh owner organization instead of a fresh viewer last-active organization", async () => {
    const viewerOrganization = {
      ...organizationA,
      role: "viewer" as const,
    };
    const bPage: OrganizationMemberListResponse = {
      organizationId: organizationBId,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "B-confirmed",
          email: "b@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      memberLimit: 1000,
    };
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => {
        tenant = {
          ...tenant,
          me: { organizations: [viewerOrganization, organizationB] },
          activeOrg: organizationB,
        };
        return Promise.resolve({
          organizations: [viewerOrganization, organizationB],
          lastActiveTenantId: organizationId,
        });
      }),
    };
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(
        new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      )
      .mockResolvedValueOnce(bPage);

    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemberDataRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </MemberDataRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("member-row-member-b"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-b")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("B-confirmed");
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      1,
      organizationId,
      50,
      0,
    );
    expect(fetchOrganizationMembers).toHaveBeenNthCalledWith(
      2,
      organizationBId,
      50,
      0,
    );
  });
});

describe("OrganizationMembersPage pending invitations", () => {
  function asRole(role: TenantOrganization["role"]) {
    const org = { ...organizationA, role };
    tenant = { ...tenant, me: { organizations: [org] }, activeOrg: org };
  }
  const pending = (emails: string[]): PendingInvitationListResponse => ({
    organizationId,
    invitations: emails.map((email, index) => ({
      publicId: `00000000-0000-4000-8000-00000000000${String(index)}`,
      email,
      role: "viewer",
      sentAt: "2026-09-30T08:00:00.000Z",
      expiresAt: "2026-10-02T08:00:00.000Z",
      expired: false,
      resendAvailableAt: "2026-09-30T08:05:00.000Z",
      manageable: true,
    })),
    activeCount: emails.length,
    activeLimit: 100,
    page: { limit: 50, offset: 0, total: emails.length },
  });

  it.each(["viewer", "auditor"] as const)(
    "hides the section and requests no invitations for %s",
    async (role) => {
      asRole(role);
      renderPage();

      expect(
        await screen.findByTestId("members-denied-alert"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("pending-invitations-section"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("pending-invitations-limit"),
      ).not.toBeInTheDocument();
      expect(fetchPendingInvitations).not.toHaveBeenCalled();
    },
  );

  it("drops the section when a cancel and the list refresh are denied after the actor was demoted", async () => {
    vi.mocked(fetchOrganizationMembers).mockResolvedValue(response);
    vi.mocked(fetchPendingInvitations)
      .mockResolvedValueOnce(pending(["gone@example.test"]))
      .mockRejectedValue(new ApiError("PERMISSION_DENIED", "demoted", 403));
    vi.mocked(cancelInvitation).mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "demoted", 403),
    );
    tenant = {
      ...tenant,
      refreshMembershipContext: vi.fn(() => {
        tenant = {
          ...tenant,
          me: { organizations: [{ ...organizationA, role: "viewer" }] },
        };
        return Promise.resolve({
          organizations: tenant.me?.organizations ?? [],
          lastActiveTenantId: organizationId,
        });
      }),
    };
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByTestId(
        "invitation-cancel-00000000-0000-4000-8000-000000000000",
      ),
    );
    await user.click(screen.getByTestId("invitation-cancel-confirm"));

    await waitFor(() => {
      expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("pending-invitations-section"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(/^pending-invitations-cancel-(success|error)$/),
    ).toBeNull();
    expect(cancelInvitation).toHaveBeenCalledOnce();
  });

  it.each(["owner", "admin"] as const)(
    "exposes invite, pending and member capabilities for %s",
    async (role) => {
      asRole(role);
      vi.mocked(fetchOrganizationMembers).mockResolvedValue(response);
      vi.mocked(fetchPendingInvitations).mockResolvedValue(
        pending(["wait@example.test"]),
      );
      renderPage();

      const invite = await screen.findByTestId("members-invitation-heading");
      const section = await screen.findByTestId("pending-invitations-heading");
      const members = await screen.findByTestId("members-table");
      expect(invite).toHaveRole("heading");
      expect(invite).toHaveTextContent("Acme");
      expect(section).toHaveRole("heading");
      expect(screen.getByTestId("members-invitation-email")).toBeEnabled();
      expect(screen.getByTestId("members-invitation-send")).toBeEnabled();
      const allowed = within(screen.getByTestId("members-invitation-role"))
        .getAllByTestId(/^members-invitation-role-/)
        .map((option) => option.getAttribute("value"));
      expect(new Set(allowed)).toEqual(
        new Set(
          role === "owner"
            ? ["owner", "admin", "viewer", "auditor"]
            : ["admin", "viewer", "auditor"],
        ),
      );
      const actor = within(members).getByTestId("member-row-member-1");
      expect(within(actor).getByTestId("member-name")).toHaveTextContent(
        /^Ada$/,
      );
      expect(within(actor).getByTestId("member-current-role")).toHaveAttribute(
        "data-member-role",
        "owner",
      );
      expect(screen.queryByTestId("member-revoke-member-1")).toBeNull();
      expect(
        await screen.findByTestId(
          "pending-invitation-row-00000000-0000-4000-8000-000000000000",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          "pending-invitation-row-00000000-0000-4000-8000-000000000000",
        ),
      ).toHaveTextContent("wait@example.test");
    },
  );

  it("shows the new invitation on page 1 after a create made from page 2", async () => {
    vi.mocked(fetchOrganizationMembers).mockResolvedValue(response);
    const rows = (offset: number): PendingInvitationListResponse => {
      const emails =
        offset === 0
          ? ["new@example.com", "old-1@example.test"]
          : ["old-51@example.test"];
      return { ...pending(emails), page: { limit: 50, offset, total: 51 } };
    };
    vi.mocked(fetchPendingInvitations).mockImplementation(
      (_organizationId, _limit, offset) =>
        Promise.resolve(offset === 0 ? rows(0) : rows(50)),
    );
    vi.mocked(createInvitation).mockResolvedValue({
      created: true,
      emailDispatch: "accepted",
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId(
      "pending-invitation-row-00000000-0000-4000-8000-000000000001",
    );
    expect(
      screen.getByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000001",
      ),
    ).toHaveTextContent("old-1@example.test");
    await user.click(screen.getByTestId("pending-invitations-next"));
    await screen.findByTestId(
      "pending-invitation-row-00000000-0000-4000-8000-000000000000",
    );
    expect(
      screen.getByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000000",
      ),
    ).toHaveTextContent("old-51@example.test");

    await user.type(
      screen.getByTestId("members-invitation-email"),
      "new@example.com",
    );
    await user.click(screen.getByTestId("members-invitation-send"));

    expect(
      await screen.findByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000000",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000000",
      ),
    ).toHaveTextContent("new@example.com");
    expect(
      screen.queryByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000000",
      ),
    ).not.toHaveTextContent("old-51@example.test");
    expect(fetchPendingInvitations).toHaveBeenLastCalledWith(
      organizationId,
      50,
      0,
    );
  });

  it("drops an accepted invitation from the list and shows the recipient as a member", async () => {
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValue({
        ...response,
        members: [
          ...response.members,
          {
            id: "member-2",
            userId: "user-2",
            name: "Recipient",
            email: "wait@example.test",
            role: "viewer",
          },
        ],
      });
    vi.mocked(fetchPendingInvitations)
      .mockResolvedValueOnce(pending(["wait@example.test"]))
      .mockResolvedValue(pending([]));
    const { queryClient } = renderPage();
    expect(
      await screen.findByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000000",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "pending-invitation-row-00000000-0000-4000-8000-000000000000",
      ),
    ).toHaveTextContent("wait@example.test");
    expect(screen.queryByTestId("member-row-member-2")).not.toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["tenant"] });
    });

    expect(
      await screen.findByTestId("pending-invitations-empty"),
    ).toBeInTheDocument();
    const members = await screen.findByTestId("members-table");
    expect(
      within(members).getByTestId("member-row-member-2"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("member-row-member-2")).getByTestId(
        "member-name",
      ),
    ).toHaveTextContent("Recipient");
    expect(
      within(within(members).getByTestId("member-row-member-2")).getByTestId(
        "member-email",
      ),
    ).toBeInTheDocument();
    expect(
      within(within(members).getByTestId("member-row-member-2")).getByTestId(
        "member-email",
      ),
    ).toHaveTextContent("wait@example.test");
    expect(
      screen.queryByTestId("pending-invitations-table"),
    ).not.toBeInTheDocument();
  });
});
