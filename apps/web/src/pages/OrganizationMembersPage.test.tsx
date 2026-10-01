import type {
  InvitationCreateResponse,
  MeContextResponse,
  OrganizationMemberListResponse,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { OrgSwitcher } from "../components/shell/OrgSwitcher";
import { ApiError } from "../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../lib/api/me";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../lib/api/members";
import {
  createInvitation,
  fetchPendingInvitations,
} from "../lib/api/invitations";
import {
  claimContextPublication,
  createContextPublicationClaim,
  publishContextPublication,
} from "../lib/queryClient";
import { OrganizationMembersPage } from "./OrganizationMembersPage";

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

// The page reads the signed-in user id from the confirmed context.
vi.mock("../lib/tenant/TenantProvider", () => ({
  useTenant: () => ({
    ...tenant,
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </MemoryRouter>
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

const invitationOutcomes: [
  string,
  InvitationCreateResponse | ApiError,
  string,
][] = [
  [
    "pre-insert failure",
    new ApiError("INVITATION_LIMIT_REACHED", "limit", 409),
    "ครบ 100 รายการ",
  ],
  [
    "SMTP accepted",
    { created: true, emailDispatch: "accepted" },
    "สร้างคำเชิญแล้ว",
  ],
  [
    "SMTP failed",
    { created: true, emailDispatch: "failed" },
    "สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ",
  ],
];

// The invitation section keeps an empty status region mounted, so member and
// notice assertions address the one status region that carries text.
const textStatuses = () =>
  screen.queryAllByRole("status").filter((node) => node.textContent !== "");
const getStatus = () => {
  const found = textStatuses();
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
};
const findStatus = () => waitFor(getStatus);

describe("OrganizationMembersPage", () => {
  it.each(invitationOutcomes)(
    "keeps the A invitation mounted across refetch and pagination: %s",
    async (_scenario, outcome, message) => {
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
      expect(await screen.findByText("Ada")).toBeInTheDocument();
      const email = screen.getByLabelText("อีเมลของผู้ได้รับเชิญ");
      await user.type(email, "new@example.com");
      await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
      expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
      act(() => {
        void queryClient.invalidateQueries({
          queryKey: memberListQueryKey(organizationId, 50, 0),
          exact: true,
        });
      });
      expect(await findStatus()).toHaveTextContent("กำลังโหลดสมาชิก");
      expect(screen.queryByText("Ada")).not.toBeInTheDocument();
      expect(email).toBeInTheDocument();
      expect(email).toHaveValue("new@example.com");
      expect(
        screen.getByRole("button", { name: "กำลังส่งคำเชิญ…" }),
      ).toBeDisabled();
      refreshedPage.resolve(response);
      expect(await screen.findByText("Ada")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "ถัดไป" }));
      expect(await findStatus()).toHaveTextContent("กำลังโหลดสมาชิก");
      expect(screen.queryByText("Ada")).not.toBeInTheDocument();
      expect(email).toBeInTheDocument();
      nextPage.resolve({
        ...response,
        members: [{ ...firstMember, id: "member-51", name: "Zoe" }],
        page: { limit: 50, offset: 50, total: 51 },
      });
      expect(await screen.findByText("Zoe")).toBeInTheDocument();
      if (outcome instanceof Error) {
        await act(async () => {
          post.reject(outcome);
          await Promise.resolve();
        });
        expect(screen.getByRole("alert")).toHaveTextContent(message);
        expect(email).toHaveValue("new@example.com");
      } else {
        await act(async () => {
          post.resolve(outcome);
          await post.promise;
        });
        expect(getStatus()).toHaveTextContent(message);
        expect(email).toHaveValue("");
      }
      expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
    },
  );
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
    };
    const freshFirstPage =
      Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(secondPage)
      .mockImplementationOnce(() => freshFirstPage.promise);
    const user = userEvent.setup();
    const { queryClient } = renderPage();

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("Zoe")).toBeInTheDocument();
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      response,
      {
        updatedAt: Date.now() - 30_001,
      },
    );
    await user.click(screen.getByRole("button", { name: "ก่อนหน้า" }));

    expect(await findStatus()).toHaveTextContent("กำลังโหลดสมาชิก");
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.queryByText("ada@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("สมาชิกทั้งหมด 51 คน")).not.toBeInTheDocument();
    expect(screen.queryByText("แสดง 1–1 จาก 51")).not.toBeInTheDocument();

    freshFirstPage.resolve({
      ...response,
      members: [{ ...firstMember, name: "Fresh Ada" }],
    });

    expect(await screen.findByText("Fresh Ada")).toBeInTheDocument();
    expect(screen.getByText("สมาชิกทั้งหมด 51 คน")).toBeInTheDocument();
    expect(screen.getByText("แสดง 1–1 จาก 51")).toBeInTheDocument();
  });

  it("hides current-page member data during a background refetch", async () => {
    const freshPage = Promise.withResolvers<OrganizationMemberListResponse>();
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => freshPage.promise);
    const { queryClient } = renderPage();

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: memberListQueryKey(organizationId, 50, 0),
        exact: true,
      });
    });

    expect(await findStatus()).toHaveTextContent("กำลังโหลดสมาชิก");
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.queryByText("ada@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("สมาชิกทั้งหมด 51 คน")).not.toBeInTheDocument();
    expect(screen.queryByText("แสดง 1–1 จาก 51")).not.toBeInTheDocument();

    freshPage.resolve({
      ...response,
      members: [{ ...firstMember, name: "Fresh Ada" }],
    });

    expect(await screen.findByText("Fresh Ada")).toBeInTheDocument();
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

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    expect(await screen.findByText("โหลดสมาชิกไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeEnabled();
    const previous = screen.getByRole("button", { name: "ก่อนหน้า" });
    expect(previous).toBeEnabled();
    previous.focus();
    expect(previous).toHaveFocus();
    queryClient.removeQueries({
      queryKey: memberListQueryKey(organizationId, 50, 0),
      exact: true,
    });
    await user.keyboard("{Enter}");

    expect(await findStatus()).toHaveTextContent("กำลังโหลดสมาชิก");
    const heading = screen.getByRole("heading", { name: "สมาชิก" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveClass(
      "focus:outline-2",
      "focus:outline-offset-2",
      "focus:outline-primary",
    );

    restoredPage.resolve(response);

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(screen.getByText("แสดง 1–1 จาก 51")).toBeInTheDocument();
    expect(screen.queryByText("โหลดสมาชิกไม่สำเร็จ")).not.toBeInTheDocument();
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

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("โหลดสมาชิกไม่สำเร็จ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ก่อนหน้า" }));

    const heading = await screen.findByRole("heading", { name: "สมาชิก" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveClass(
      "focus:outline-2",
      "focus:outline-offset-2",
      "focus:outline-primary",
    );
    expect(screen.getByText("แสดง 1–1 จาก 51")).toBeInTheDocument();
  });

  it("resets an invalid later page before success rendering and refetches page one once", async () => {
    const invalidSecondPage: OrganizationMemberListResponse = {
      organizationId,
      members: [],
      page: { limit: 50, offset: 50, total: 49 },
    };
    const repairedFirstPage: OrganizationMemberListResponse = {
      ...response,
      members: [{ ...firstMember, name: "Repaired first member" }],
      page: { limit: 50, offset: 0, total: 49 },
    };
    vi.mocked(fetchOrganizationMembers)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(invalidSecondPage)
      .mockResolvedValueOnce(repairedFirstPage);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    expect(await findStatus()).toHaveTextContent("กำลังโหลดสมาชิก");
    expect(screen.queryByText("แสดง 0–50 จาก 49")).toBeNull();
    expect(
      await screen.findByText("Repaired first member"),
    ).toBeInTheDocument();
    expect(screen.getByText("แสดง 1–1 จาก 49")).toBeInTheDocument();
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
    });
    renderPage();

    expect(await screen.findByText("แสดง 0–0 จาก 0")).toBeInTheDocument();
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

    expect(screen.getByRole("alert")).toHaveTextContent(
      "คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้",
    );
    expect(screen.queryByText("สมาชิกทั้งหมด")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
    expect(fetchOrganizationMembers).not.toHaveBeenCalled();
  });

  it("offers context retry without rendering cached directory data after a fresh decision fails", () => {
    tenant = {
      ...tenant,
      me: undefined,
      meError: new Error("context unavailable"),
    };
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้",
    );
    expect(
      screen.getByRole("button", { name: "ลองอีกครั้ง" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ada")).toBeNull();
    expect(screen.queryByText("สมาชิกทั้งหมด")).toBeNull();
    expect(fetchOrganizationMembers).not.toHaveBeenCalled();
  });

  it("announces loading and a retryable failure without stale rows", async () => {
    vi.mocked(fetchOrganizationMembers)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "โหลดสมาชิกไม่สำเร็จ",
    );
    expect(
      screen.queryByRole("button", { name: "ก่อนหน้า" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("Ada")).toBeInTheDocument();
  });

  it("unmounts a pending invitation when fresh permission denies A", async () => {
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
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "a-draft@example.test",
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
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
        screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ"),
      ).not.toBeInTheDocument();
    });
    await act(async () => {
      post.resolve({ created: true, emailDispatch: "accepted" });
      await post.promise;
    });
    expect(screen.queryByText("สร้างคำเชิญแล้ว")).not.toBeInTheDocument();
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<p>workspace</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("โหลดสมาชิกไม่สำเร็จ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("workspace")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
  });

  it("keeps a delayed A page and its offset out of confirmed B scope", async () => {
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <SwitchableDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("A-first")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "a-draft@example.test",
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("กำลังโหลดสมาชิก")).toHaveAttribute(
      "role",
      "status",
    );
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Beta/ }));

    expect(await screen.findByText("B-only")).toBeInTheDocument();
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
    expect(screen.queryByText("a-draft@example.test")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("แสดง 1–1 จาก 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ก่อนหน้า" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();

    resolveASecondPage({
      ...response,
      members: [{ ...firstMember, name: "A-late" }],
      page: { limit: 50, offset: 50, total: 51 },
    });
    await Promise.resolve();
    await act(async () => {
      pendingInvitation.resolve({ created: true, emailDispatch: "failed" });
      await pendingInvitation.promise;
    });
    expect(
      screen.queryByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("A-late")).not.toBeInTheDocument();
    expect(screen.queryByText("A-first")).not.toBeInTheDocument();
    expect(screen.getByText("B-only")).toBeInTheDocument();
  });

  it("hides A invitation immediately on confirmed B publication before navigation", async () => {
    const post = Promise.withResolvers<InvitationCreateResponse>();
    const navigation = Promise.withResolvers<boolean>();
    vi.mocked(createInvitation).mockReturnValue(post.promise);
    vi.mocked(fetchOrganizationMembers).mockResolvedValue(response);
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const confirmedContext: MeContextResponse = {
      user: {
        id: "user-1",
        name: "Tester",
        email: "tester@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [organizationA, organizationB],
      lastActiveTenantId: organizationId,
    };
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, confirmedContext);

    function SwitchableDirectory() {
      const [, setRevision] = useState(0);
      tenant = {
        ...tenant,
        me: { organizations: [organizationA, organizationB] },
        activeOrg: tenant.activeOrg,
        switchOrg: (id: string) => {
          if (id !== organizationBId) return Promise.resolve(false);
          const claim = createContextPublicationClaim();
          claimContextPublication(queryClient, claim);
          tenant = { ...tenant, activeOrg: organizationB };
          queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
            ...confirmedContext,
            lastActiveTenantId: organizationBId,
          });
          publishContextPublication(queryClient, claim);
          setRevision((value) => value + 1);
          return navigation.promise;
        },
      };
      return (
        <>
          <OrgSwitcher collapsed={false} />
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

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <SwitchableDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "a-draft@example.test",
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
    expect(vi.mocked(createInvitation)).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Beta/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationId}/members`,
    );
    expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
    await act(async () => {
      post.resolve({ created: true, emailDispatch: "failed" });
      await post.promise;
    });
    expect(
      screen.queryByRole("status", { name: /สร้างคำเชิญแล้ว/ }),
    ).toBeNull();
    expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
    await act(async () => {
      navigation.resolve(true);
      await navigation.promise;
    });
    expect(await screen.findByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
      "",
    );
    expect(
      screen.queryByText("สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ"),
    ).toBeNull();
  });

  it("keeps A scope, route, list, and offset when an A to B switch is denied", async () => {
    const aSecondPage: OrganizationMemberListResponse = {
      ...response,
      members: [{ ...firstMember, name: "A-second" }],
      page: { limit: 50, offset: 50, total: 51 },
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <DeniedSwitchDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("A-first")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByText("A-second")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "a-draft@example.test",
    );
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Beta/ }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationId}/members`,
    );
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("A-second")).toBeInTheDocument();
    expect(screen.queryByText("B-only")).not.toBeInTheDocument();
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
      "a-draft@example.test",
    );
    expect(screen.getByText("แสดง 51–51 จาก 51")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ก่อนหน้า" })).toBeEnabled();
  });

  it("keeps revoked A restricted until a fresh context confirms B", async () => {
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<p>workspace</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "ลองอีกครั้ง" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationId}/members`,
    );
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
    expect(screen.queryByText("สมาชิกทั้งหมด 51 คน")).not.toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));

    expect(await screen.findByText("B-confirmed")).toBeInTheDocument();
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
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
      await screen.findByRole("status", {
        name: "กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก")).toBeVisible();
    expect(
      screen.queryByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
    ).not.toBeInTheDocument();

    context.resolve({
      organizations: [organizationA],
      lastActiveTenantId: organizationId,
    });

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(
      screen.queryByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
    ).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
  });

  it("refetches once after fresh owner confirmation for the same organization", async () => {
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
      .mockResolvedValueOnce(response);

    renderPage();

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
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
    expect(
      screen.queryByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
    ).not.toBeInTheDocument();
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<p>workspace</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("workspace")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
    expect(screen.queryByText("สมาชิกทั้งหมด 51 คน")).not.toBeInTheDocument();
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
      await screen.findByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ลองอีกครั้ง" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
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
      await screen.findByText("ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ลองอีกครั้ง" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
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
      await screen.findByRole("status", {
        name: "กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก",
      }),
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

    expect(await screen.findByText("โหลดสมาชิกไม่สำเร็จ")).toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(2);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("Ada")).toBeInTheDocument();
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<p>workspace</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("โหลดสมาชิกไม่สำเร็จ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("workspace")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
    expect(fetchOrganizationMembers).toHaveBeenCalledTimes(3);
    expect(tenant.refreshMembershipContext).toHaveBeenCalledTimes(2);
  });

  it("retires revoked A scope after the next list denial and routes to confirmed B", async () => {
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("B-confirmed")).toBeInTheDocument();
    expect(tenant.refreshMembershipContext).toHaveBeenCalledOnce();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${organizationBId}/members`,
    );
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<p>workspace</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("workspace")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(screen.queryByText("acme")).not.toBeInTheDocument();
    expect(screen.queryByText("สมาชิกทั้งหมด 51 คน")).not.toBeInTheDocument();
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
        <MemoryRouter
          initialEntries={[`/organizations/${organizationId}/members`]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("B-confirmed")).toBeInTheDocument();
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
        await screen.findByText("คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/คำเชิญที่รอตอบรับ/)).not.toBeInTheDocument();
      expect(screen.queryByText(/จาก 100/)).not.toBeInTheDocument();
      expect(fetchPendingInvitations).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "admin"] as const)(
    "places the section after the invite card and before the member table for %s",
    async (role) => {
      asRole(role);
      vi.mocked(fetchOrganizationMembers).mockResolvedValue(response);
      vi.mocked(fetchPendingInvitations).mockResolvedValue(
        pending(["wait@example.test"]),
      );
      renderPage();

      const invite = await screen.findByRole("heading", {
        name: /เชิญสมาชิกเข้าสู่/,
      });
      const section = await screen.findByRole("heading", {
        name: /คำเชิญที่รอตอบรับ/,
      });
      const members = await screen.findByRole("region", {
        name: "ตารางสมาชิก",
      });
      expect(
        invite.compareDocumentPosition(section) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        section.compareDocumentPosition(members) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(await screen.findByText("wait@example.test")).toBeInTheDocument();
    },
  );

  it.each([
    ["SMTP accepted", { created: true, emailDispatch: "accepted" }],
    ["SMTP failed", { created: true, emailDispatch: "failed" }],
  ] as [string, InvitationCreateResponse][])(
    "refreshes the list after a created invitation, newest first: %s",
    async (_scenario, outcome) => {
      vi.mocked(fetchOrganizationMembers).mockResolvedValue(response);
      vi.mocked(fetchPendingInvitations)
        .mockResolvedValueOnce(pending(["old@example.test"]))
        .mockResolvedValueOnce(
          pending(["new@example.com", "old@example.test"]),
        );
      vi.mocked(createInvitation).mockResolvedValue(outcome);
      const user = userEvent.setup();
      renderPage();
      expect(await screen.findByText("old@example.test")).toBeInTheDocument();

      await user.type(
        screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
        "new@example.com",
      );
      await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));

      await waitFor(() => {
        expect(fetchPendingInvitations).toHaveBeenCalledTimes(2);
      });
      const table = await screen.findByRole("region", {
        name: "ตารางคำเชิญที่รอตอบรับ",
      });
      expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
        "new@example.com",
      );
    },
  );

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
    expect(await screen.findByText("wait@example.test")).toBeInTheDocument();
    expect(screen.queryByText("Recipient")).not.toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["tenant"] });
    });

    expect(
      await screen.findByText("ไม่มีคำเชิญที่รอตอบรับ"),
    ).toBeInTheDocument();
    const members = await screen.findByRole("region", { name: "ตารางสมาชิก" });
    expect(within(members).getByText("Recipient")).toBeInTheDocument();
    expect(within(members).getByText("wait@example.test")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ตารางคำเชิญที่รอตอบรับ" }),
    ).not.toBeInTheDocument();
  });
});
