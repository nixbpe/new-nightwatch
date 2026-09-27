import type {
  InvitationResponse,
  MeContextResponse,
  OrganizationMemberListResponse,
} from "@nightwatch/api-contract";
import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useSearchParams,
  type RouteObject,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchInvitation, invitationQueryKey } from "../api/invitations";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../api/me";
import { fetchOrganizationMembers, memberListQueryKey } from "../api/members";
import {
  fetchNotifications,
  fetchOrganizationNotificationSettings,
  notificationQueryKey,
  organizationNotificationSettingsQueryKey,
} from "../api/notifications";
import {
  peekStagedQueryClient,
  resetQueryClientRegistry,
  resolveQueryClientForIdentity,
} from "../queryClient";
import { rememberInvitation, rememberReturnTo } from "./continuation";
import {
  notificationSettingsLoader,
  notificationsLoader,
  organizationMembersLoader,
  requireAnonLoader,
  rootLoader,
  settingsLoader,
  verifyEmailLoader,
  workspaceLoader,
} from "./loaders";
type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: SessionUser } | null,
  },
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: sessionState.data, isPending: false }),
    getSession: () => Promise.resolve({ data: sessionState.data, error: null }),
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchMeContext: vi.fn() };
});

vi.mock("../api/invitations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchInvitation: vi.fn() };
});

vi.mock("../api/notifications", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchNotifications: vi.fn(),
    fetchOrganizationNotificationSettings: vi.fn(),
  };
});
vi.mock("../api/members", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchOrganizationMembers: vi.fn() };
});

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchInvitationMock = vi.mocked(fetchInvitation);
const fetchNotificationsMock = vi.mocked(fetchNotifications);
const fetchOrganizationNotificationSettingsMock = vi.mocked(
  fetchOrganizationNotificationSettings,
);
const fetchOrganizationMembersMock = vi.mocked(fetchOrganizationMembers);

const VERIFIED: SessionUser = {
  id: "user-1",
  email: "member@example.com",
  emailVerified: true,
};

const UNVERIFIED: SessionUser = {
  id: "user-2",
  email: "new@example.com",
  emailVerified: false,
};

const meContext: MeContextResponse = {
  user: {
    id: "user-1",
    name: "สมาชิกทดสอบ",
    email: "member@example.com",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [],
  lastActiveTenantId: null,
};

const invitation: InvitationResponse = {
  invitation: {
    id: "inv-5",
    email: "new@example.com",
    organizationName: "Acme Corp",
    role: "viewer",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

function LocationProbe() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  return (
    <div>
      <div data-testid="location">
        {location.pathname + location.search + location.hash}
      </div>
      <div data-testid="from">{searchParams.get("from") ?? "none"}</div>
    </div>
  );
}

function renderAt(routes: RouteObject[], entry: string) {
  const router = createMemoryRouter(
    [...routes, { path: "*", element: <LocationProbe /> }],
    { initialEntries: [entry] },
  );
  return render(<RouterProvider router={router} />);
}

const anonOnly: RouteObject = {
  path: "/anon-only",
  loader: requireAnonLoader,
  element: <div>anon-area</div>,
};

const protectedWorkspace: RouteObject = {
  path: "/workspace",
  loader: workspaceLoader,
  element: <div>protected-area</div>,
};

const protectedNotifications: RouteObject = {
  path: "/notifications",
  loader: notificationsLoader,
  element: <div>notifications-area</div>,
};

describe("requireAnonLoader (anonymous-only gate)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
  });

  it("renders anonymous content for visitors without a session", async () => {
    renderAt([anonOnly], "/anon-only");

    expect(await screen.findByText("anon-area")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("keeps signed-in users out of anonymous-only pages", async () => {
    sessionState.data = { user: VERIFIED };
    renderAt([anonOnly], "/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    expect(screen.queryByText("anon-area")).toBeNull();
  });

  it("resumes the remembered return — query and hash included — and consumes it exactly once", async () => {
    sessionState.data = { user: VERIFIED };
    rememberReturnTo("/settings/security?tab=sessions#current");
    const first = renderAt([anonOnly], "/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/settings/security?tab=sessions#current",
    );

    // Consumed: a later arrival falls back to the workspace instead of replaying the stale return.
    first.unmount();
    renderAt([anonOnly], "/anon-only");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
  });

  it("prefers a remembered pending invitation over the return path", async () => {
    sessionState.data = { user: VERIFIED };
    rememberReturnTo("/settings/security");
    rememberInvitation("inv-9");
    renderAt([anonOnly], "/anon-only");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/onboarding",
    );
  });
});

describe("protected-route gates (workspaceLoader / settingsLoader)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchNotificationsMock.mockReset();
    fetchOrganizationNotificationSettingsMock.mockReset();
  });

  it("bounces anonymous visitors to login remembering the deep link", async () => {
    renderAt([protectedWorkspace], "/workspace?tab=security");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent(
      "/workspace?tab=security",
    );
    expect(screen.queryByText("protected-area")).toBeNull();
  });

  it("redirects / to /workspace and remembers /workspace as the bounce origin", async () => {
    // Remembering "/" would loop the login continuation back onto the redirect.
    renderAt([{ path: "/", loader: rootLoader }, protectedWorkspace], "/");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent("/workspace");
  });

  it("bounces an authenticated but unverified session to the resend hub", async () => {
    sessionState.data = { user: UNVERIFIED };
    renderAt([protectedWorkspace], "/workspace");

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
    expect(screen.queryByText("protected-area")).toBeNull();
    expect(fetchMeContextMock).not.toHaveBeenCalled();
  });

  it("bounces security settings the same way", async () => {
    renderAt(
      [
        {
          path: "/settings/security",
          loader: settingsLoader,
          element: <div>security-area</div>,
        },
      ],
      "/settings/security",
    );

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(screen.getByTestId("from")).toHaveTextContent("/settings/security");
    expect(screen.queryByText("security-area")).toBeNull();
  });

  it("admits a verified session and stages the prefetched me/context for its identity", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    renderAt([protectedWorkspace], "/workspace");

    expect(await screen.findByText("protected-area")).toBeInTheDocument();
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    // The prefetch landed in a client staged for THIS identity, never a shared singleton.
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBe("user-1");
    expect(staged?.client.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      meContext,
    );
  });

  it("stages the notification Center's primary inbox in the verified identity client", async () => {
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockResolvedValue(meContext);
    fetchNotificationsMock.mockResolvedValue({
      organizationId: null,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    renderAt([protectedNotifications], "/notifications");

    expect(await screen.findByText("notifications-area")).toBeInTheDocument();
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBe(VERIFIED.id);
    expect(staged?.client.getQueryData(notificationQueryKey(null))).toEqual({
      organizationId: null,
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
  });

  it("stages organization notification settings before its protected route commits", async () => {
    sessionState.data = { user: VERIFIED };
    fetchOrganizationNotificationSettingsMock.mockResolvedValue({
      organizationId: "11111111-1111-4111-8111-111111111111",
      settingsChangedEnabled: true,
      version: 2,
    });
    renderAt(
      [
        {
          path: "/organizations/:organizationId/notification-settings",
          loader: notificationSettingsLoader,
          element: <div>notification-settings-area</div>,
        },
      ],
      "/organizations/11111111-1111-4111-8111-111111111111/notification-settings",
    );

    expect(
      await screen.findByText("notification-settings-area"),
    ).toBeInTheDocument();
    expect(
      peekStagedQueryClient()?.client.getQueryData(
        organizationNotificationSettingsQueryKey(
          "11111111-1111-4111-8111-111111111111",
        ),
      ),
    ).toEqual({
      organizationId: "11111111-1111-4111-8111-111111111111",
      settingsChangedEnabled: true,
      version: 2,
    });
  });

  it("a failed prefetch does not become a router-level error", async () => {
    // The in-tree query surfaces the error with its retry UI instead.
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockRejectedValue(new Error("api down"));
    renderAt([protectedWorkspace], "/workspace");

    // The session client retries once, so the loader waits out a backoff.
    expect(
      await screen.findByText("protected-area", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe("organizationMembersLoader (fresh membership gate)", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const cachedOwnerContext: MeContextResponse = {
    ...meContext,
    organizations: [
      {
        id: organizationId,
        name: "Acme",
        slug: "acme",
        role: "owner",
      },
    ],
    lastActiveTenantId: organizationId,
  };
  const cachedMembers = {
    organizationId,
    members: [
      {
        id: "member-1",
        userId: "user-1",
        name: "Cached member",
        email: "cached@example.test",
        role: "owner" as const,
      },
    ],
    page: { limit: 50, offset: 0, total: 1 },
  };

  afterEach(() => {
    sessionState.data = null;
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
    fetchOrganizationMembersMock.mockReset();
  });

  it("retires cached membership and directory data when the fresh decision fails", async () => {
    sessionState.data = { user: VERIFIED };
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    fetchMeContextMock.mockRejectedValue(new Error("context unavailable"));

    const result = await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    expect(result).toBeNull();
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
  });

  it("keeps B's fresh context and directory when older A resolves after B", async () => {
    sessionState.data = { user: VERIFIED };
    const staleA: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        {
          id: organizationId,
          name: "Alpha",
          slug: "acme",
          role: "owner",
        },
      ],
    };
    const freshB: MeContextResponse = {
      ...cachedOwnerContext,
      organizations: [
        {
          id: organizationId,
          name: "Bravo",
          slug: "acme",
          role: "owner",
        },
      ],
    };
    const membersB: OrganizationMemberListResponse = {
      organizationId,
      members: [
        {
          id: "member-b",
          userId: "user-b",
          name: "Bravo member",
          email: "bravo@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
    };
    const membersA: OrganizationMemberListResponse = {
      organizationId,
      members: [
        {
          id: "member-a",
          userId: "user-a",
          name: "Alpha member",
          email: "alpha@example.test",
          role: "owner",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
    };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    const newRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    fetchOrganizationMembersMock
      .mockResolvedValueOnce(membersB)
      .mockResolvedValueOnce(membersA);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);

    const oldDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    });
    const newDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });

    newRequest.resolve(freshB);
    await newDecision;
    oldRequest.resolve(staleA);
    await oldDecision;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(freshB);
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toEqual(membersB);
    expect(fetchOrganizationMembersMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the unavailable state when newer B fails before older A resolves", async () => {
    sessionState.data = { user: VERIFIED };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    const newRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, cachedOwnerContext);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );

    const oldDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    });
    const newDecision = organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);
    await vi.waitFor(() => {
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    });

    newRequest.reject(new Error("context unavailable"));
    await newDecision;
    oldRequest.resolve(cachedOwnerContext);
    await oldDecision;

    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("keeps the fresh no-A decision when an older context query resolves stale A", async () => {
    sessionState.data = { user: VERIFIED };
    const staleA: MeContextResponse = {
      ...cachedOwnerContext,
      lastActiveTenantId: organizationId,
    };
    const freshB: MeContextResponse = {
      ...meContext,
      organizations: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Bravo",
          slug: "bravo",
          role: "viewer",
        },
      ],
      lastActiveTenantId: "22222222-2222-4222-8222-222222222222",
    };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce(freshB);
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );

    const oldQuery = queryClient
      .query({
        queryKey: ME_CONTEXT_QUERY_KEY,
        queryFn: fetchMeContext,
      })
      .catch(() => undefined);

    const result = await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    oldRequest.resolve(staleA);
    await oldQuery;

    expect(result).toBeNull();
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(freshB);
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
    expect(fetchOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("retires membership data when a fresh decision fails during an older context query", async () => {
    sessionState.data = { user: VERIFIED };
    const oldRequest = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock
      .mockImplementationOnce(() => oldRequest.promise)
      .mockRejectedValueOnce(new Error("context unavailable"));
    const queryClient = resolveQueryClientForIdentity(VERIFIED.id);
    queryClient.setQueryData(
      memberListQueryKey(organizationId, 50, 0),
      cachedMembers,
    );
    const oldQuery = queryClient
      .query({
        queryKey: ME_CONTEXT_QUERY_KEY,
        queryFn: fetchMeContext,
      })
      .catch(() => undefined);

    const result = await organizationMembersLoader({
      params: { organizationId },
      request: new Request(
        `http://localhost/organizations/${organizationId}/members`,
      ),
    } as never);

    oldRequest.resolve(cachedOwnerContext);
    await oldQuery;

    expect(result).toBeNull();
    expect(queryClient.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    expect(
      queryClient.getQueryData(memberListQueryKey(organizationId, 50, 0)),
    ).toBeUndefined();
  });
});

describe("verifyEmailLoader (anonymous-reachable resend hub)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
    fetchInvitationMock.mockReset();
  });

  const verifyEmail: RouteObject = {
    path: "/verify-email",
    loader: verifyEmailLoader,
    element: <div>verify-area</div>,
  };

  it("prefetches the remembered invitation preview into the anonymous identity", async () => {
    rememberInvitation("inv-5");
    fetchInvitationMock.mockResolvedValue(invitation);
    renderAt([verifyEmail], "/verify-email");

    expect(await screen.findByText("verify-area")).toBeInTheDocument();
    expect(fetchInvitationMock).toHaveBeenCalledTimes(1);
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBeNull();
    expect(staged?.client.getQueryData(invitationQueryKey("inv-5"))).toEqual(
      invitation,
    );
  });

  it("an unknown invitation yields the page without prefill, never a router error", async () => {
    rememberInvitation("inv-gone");
    fetchInvitationMock.mockRejectedValue(new Error("not found"));
    renderAt([verifyEmail], "/verify-email");

    expect(await screen.findByText("verify-area")).toBeInTheDocument();
  });

  it("stages nothing for signed-in visitors — they never run the preview query", async () => {
    sessionState.data = { user: UNVERIFIED };
    rememberInvitation("inv-5");
    renderAt([verifyEmail], "/verify-email");

    expect(await screen.findByText("verify-area")).toBeInTheDocument();
    expect(fetchInvitationMock).not.toHaveBeenCalled();
    expect(peekStagedQueryClient()).toBeNull();
  });
});
