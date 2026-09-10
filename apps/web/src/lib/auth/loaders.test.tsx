import type { InvitationResponse, MeContextResponse } from "@nightwatch/api-contract";
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
import {
  peekStagedQueryClient,
  resetQueryClientRegistry,
} from "../queryClient";
import {
  rememberInvitation,
  rememberReturnTo,
} from "./continuation";
import {
  requireAnonLoader,
  rootLoader,
  securitySettingsLoader,
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
    getSession: () =>
      Promise.resolve({ data: sessionState.data, error: null }),
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

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchInvitationMock = vi.mocked(fetchInvitation);

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

/** Reports the landed route plus the login continuation parameter. */
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

    // Consumed: a later signed-in arrival at the gate falls back to the
    // workspace instead of replaying the stale return.
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

describe("protected-route gates (workspaceLoader / securitySettingsLoader)", () => {
  afterEach(() => {
    sessionState.data = null;
    sessionStorage.clear();
    resetQueryClientRegistry();
    fetchMeContextMock.mockReset();
  });

  it("bounces anonymous visitors to login remembering the deep link", async () => {
    renderAt([protectedWorkspace], "/workspace?tab=security");

    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    // The intended destination survives the round trip, query included.
    expect(screen.getByTestId("from")).toHaveTextContent(
      "/workspace?tab=security",
    );
    expect(screen.queryByText("protected-area")).toBeNull();
  });

  it("redirects / to /workspace and remembers /workspace as the bounce origin", async () => {
    // "/" itself redirects to /workspace; remembering "/" would loop the
    // login continuation back onto the bounce.
    renderAt(
      [{ path: "/", loader: rootLoader }, protectedWorkspace],
      "/",
    );

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
          loader: securitySettingsLoader,
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
    // The prefetch landed in a client keyed to THIS identity, staged for
    // SessionQueryProvider to adopt — never a shared singleton.
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBe("user-1");
    expect(staged?.client.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(
      meContext,
    );
  });

  it("a failed prefetch does not become a router-level error", async () => {
    // The in-tree query surfaces the error with its retry UI instead; the
    sessionState.data = { user: VERIFIED };
    fetchMeContextMock.mockRejectedValue(new Error("api down"));
    renderAt([protectedWorkspace], "/workspace");

    // The client retries once (session-client default), so the loader takes
    // a retry backoff before resolving to the page.
    expect(
      await screen.findByText("protected-area", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
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
