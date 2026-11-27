import { guardUnassignedNetwork } from "../test/guard-network";
guardUnassignedNetwork();
import type {
  InvitationResponse,
  MeContextResponse,
} from "@nightwatch/api-contract";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { acceptInvitation, fetchInvitation } from "../lib/api/invitations";
import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../lib/api/me";
import {
  resolveQueryClientForIdentity,
  resetQueryClientRegistry,
} from "../lib/queryClient";
import { readInvitation, rememberInvitation } from "../lib/auth/continuation";
import { requireAnonLoader } from "../lib/auth/loaders";
import { RootLayout } from "../router";
import { AcceptInvitationPage } from "./AcceptInvitationPage";
import { LoginPage } from "./LoginPage";
import { OnboardingPage } from "./OnboardingPage";

type TestSessionData = {
  user: { id: string; email: string; emailVerified: boolean };
} | null;

const { sessionStore, signUpEmailMock, signInEmailMock } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: { data: TestSessionData; isPending: boolean } = {
    data: null,
    isPending: false,
  };
  return {
    sessionStore: {
      get: () => snapshot,
      set(data: TestSessionData) {
        snapshot = { data, isPending: false };
        for (const listener of listeners) {
          listener();
        }
      },
      reset() {
        snapshot = { data: null, isPending: false };
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    signUpEmailMock: vi.fn(),
    signInEmailMock: vi.fn(),
  };
});

vi.mock("better-auth/react", async () => {
  // vi.mock factories are hoisted above static imports, so react must be imported lazily.
  const { useSyncExternalStore } = await import("react");
  return {
    createAuthClient: () => ({
      useSession: () =>
        useSyncExternalStore(
          (listener) => sessionStore.subscribe(listener),
          sessionStore.get,
        ),
      getSession: () =>
        Promise.resolve({ data: sessionStore.get().data, error: null }),
      signUp: { email: signUpEmailMock },
      signIn: { email: signInEmailMock },
      organization: {},
      signOut: vi.fn(),
    }),
  };
});

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../lib/api/invitations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchInvitation: vi.fn(), acceptInvitation: vi.fn() };
});

vi.mock("../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));

const fetchInvitationMock = vi.mocked(fetchInvitation);
const acceptInvitationMock = vi.mocked(acceptInvitation);
const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);

const ORG = "11111111-1111-4111-8111-111111111111";
const context: MeContextResponse = {
  user: {
    id: "user-1",
    name: "User",
    email: "new@example.com",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [{ id: ORG, name: "Acme Corp", slug: "acme", role: "viewer" }],
  lastActiveTenantId: null,
};

const invitation: InvitationResponse = {
  invitation: {
    id: "inv-123",
    email: "new@example.com",
    organizationName: "Acme Corp",
    role: "viewer",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

function LocationProbe() {
  const location = useLocation();
  const state = location.state as { email?: string; sent?: boolean } | null;
  return (
    <div
      data-testid="location"
      data-email={state?.email}
      data-sent={state?.sent}
    >
      {location.pathname}
    </div>
  );
}

// Real anonymous-gate loader and root layout, so a session resolving mid-sign-in continues as in the app.
function renderPage(path = "/accept-invitation/inv-123") {
  const router = createMemoryRouter(
    [
      {
        element: <RootLayout />,
        children: [
          {
            path: "/accept-invitation/:invitationId",
            element: <AcceptInvitationPage />,
          },
          { path: "/login", loader: requireAnonLoader, element: <LoginPage /> },
          { path: "/onboarding", element: <OnboardingPage /> },
          { path: "*", element: <LocationProbe /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return {
    router,
    resolveSession() {
      act(() => {
        sessionStore.set({
          user: {
            id: "user-1",
            email: "new@example.com",
            emailVerified: true,
          },
        });
      });
    },
  };
}

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    sessionStore.reset();
  });

  afterEach(() => {
    fetchInvitationMock.mockReset();
    signUpEmailMock.mockReset();
    signInEmailMock.mockReset();
    acceptInvitationMock.mockReset();
    fetchMeContextMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    sessionStorage.clear();
    resetQueryClientRegistry();
  });

  it("signup from invitation continues to verification", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    renderPage();

    await screen.findByTestId("invitation-signup-page");
    await userEvent.type(
      screen.getByTestId("invitation-signup-name"),
      "สมชาย ใจดี",
    );
    await userEvent.type(
      screen.getByTestId("invitation-signup-password"),
      "super-secret-1",
    );
    await userEvent.click(screen.getByTestId("invitation-signup-submit"));

    const location = await screen.findByTestId("location");
    expect(location).toHaveTextContent("/verify-email");
    expect(location).toHaveAttribute("data-email", "new@example.com");
    expect(location).toHaveAttribute("data-sent", "true");
    expect(readInvitation()).toBe("inv-123");
    expect(signUpEmailMock).toHaveBeenCalledWith(
      {
        name: "สมชาย ใจดี",
        email: "new@example.com",
        password: "super-secret-1",
        callbackURL: "/onboarding?invitationId=inv-123",
      },
      { headers: { "X-Invitation-ID": "inv-123" } },
    );
  });

  it("returns from login automatically and keeps the invitation until explicit acceptance succeeds", async () => {
    const signIn = Promise.withResolvers<{
      data: TestSessionData;
      error: null;
    }>();
    const acceptance = Promise.withResolvers<{ organizationId: string }>();
    fetchInvitationMock.mockResolvedValue(invitation);
    signInEmailMock.mockReturnValue(signIn.promise);
    acceptInvitationMock.mockReturnValue(acceptance.promise);
    fetchMeContextMock.mockResolvedValue(context);
    updateActiveOrganizationMock.mockResolvedValue({
      ...context,
      lastActiveTenantId: ORG,
    });
    const user = userEvent.setup();
    const page = renderPage();

    await user.click(await screen.findByTestId("invitation-login"));
    await screen.findByTestId("login-page");

    await user.type(screen.getByTestId("login-email"), "new@example.com");
    await user.type(screen.getByTestId("login-password"), "super-secret-1");
    await user.click(screen.getByTestId("login-submit"));
    page.resolveSession();

    // The remounted anonymous guard must resume the invitation while the original sign-in still awaits.
    expect(
      await screen.findByTestId("invitation-accept-page"),
    ).toBeInTheDocument();
    expect(readInvitation()).toBe("inv-123");
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    await act(async () => {
      signIn.resolve({ data: sessionStore.get().data, error: null });
      await signIn.promise;
    });
    expect(screen.getByTestId("invitation-accept-page")).toBeInTheDocument();

    const client = resolveQueryClientForIdentity("user-1");
    client.setQueryData(["tenant", "old-org", "retired"], { old: true });
    await user.click(screen.getByTestId("invitation-accept"));
    expect(readInvitation()).toBe("inv-123");
    expect(screen.queryByTestId("location")).toBeNull();
    await act(async () => {
      acceptance.resolve({ organizationId: ORG });
      await acceptance.promise;
    });

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace",
    );
    expect(readInvitation()).toBeNull();
    expect(
      client.getQueryData(["tenant", "old-org", "retired"]),
    ).toBeUndefined();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    expect(updateActiveOrganizationMock).toHaveBeenCalledWith({
      organizationId: ORG,
    });
  });

  it("shows until when the invitation works on the signup and the accept pages", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    renderPage();

    const signupExpiry = await screen.findByTestId("invitation-expires-at");
    expect(signupExpiry).toHaveAttribute(
      "datetime",
      "2099-01-01T00:00:00.000Z",
    );
    expect(screen.getByTestId("invitation-signup-page")).toContainElement(
      signupExpiry,
    );
    cleanup();

    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    renderPage();

    const acceptExpiry = await screen.findByTestId("invitation-expires-at");
    expect(acceptExpiry).toHaveAttribute(
      "datetime",
      "2099-01-01T00:00:00.000Z",
    );
    expect(screen.getByTestId("invitation-accept-page")).toContainElement(
      acceptExpiry,
    );
  });

  it("reveals and hides the signup password with the toggle", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    renderPage();

    const password = await screen.findByTestId("invitation-signup-password");
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(
      screen.getByTestId("invitation-signup-password-toggle"),
    );
    expect(password).toHaveAttribute("type", "text");
    await userEvent.click(
      screen.getByTestId("invitation-signup-password-toggle"),
    );
    expect(password).toHaveAttribute("type", "password");
  });

  it("names the signup fields by their labels alone and describes each invalid one by its error", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    renderPage();

    await userEvent.click(
      await screen.findByTestId("invitation-signup-submit"),
    );

    const name = screen.getByRole("textbox", { name: "ชื่อที่แสดง" });
    expect(name).toBeInvalid();
    expect(name).toHaveAccessibleDescription("ชื่อต้องมีอย่างน้อย 2 ตัวอักษร");
    const password = screen.getByLabelText("รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)");
    expect(password).toBeInvalid();
    expect(password).toHaveAccessibleDescription(
      "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
    );
  });

  it("keeps the invitation pending on cap denial, announces the cap, and focuses the error", async () => {
    rememberInvitation("inv-123");
    fetchInvitationMock.mockResolvedValue(invitation);
    acceptInvitationMock.mockRejectedValue(
      new ApiError("ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", "cap", 409),
    );
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    renderPage();
    await userEvent.click(await screen.findByTestId("invitation-accept"));
    expect(await screen.findByTestId("invitation-accept-error")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId("invitation-accept-error-focus")).toHaveFocus(),
    );
    expect(readInvitation()).toBe("inv-123");
    expect(screen.getByTestId("invitation-accept-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByTestId("invitation-accept-error")).toHaveTextContent(
      "1,000",
    );
    expect(acceptInvitationMock).toHaveBeenCalledWith("inv-123");
    expect(screen.getByTestId("invitation-accept")).toBeEnabled();
    expect(screen.queryByTestId("invitation-workspace")).toBeNull();
    expect(screen.queryByTestId("location")).toBeNull();
    expect(updateActiveOrganizationMock).not.toHaveBeenCalled();
  });

  it("does not repeat accepted mutation when later active selection fails", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    acceptInvitationMock.mockResolvedValue({ organizationId: ORG });
    fetchMeContextMock.mockResolvedValue(context);
    updateActiveOrganizationMock.mockRejectedValue(
      new ApiError("NETWORK_ERROR", "offline", 0),
    );
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    renderPage();
    await userEvent.click(await screen.findByTestId("invitation-accept"));
    expect(await screen.findByTestId("invitation-accept-error")).toBeVisible();
    expect(screen.getByTestId("invitation-workspace")).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.queryByTestId("invitation-accept")).toBeNull();
    expect(screen.getByTestId("invitation-workspace")).toBeInTheDocument();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "switch"] as const)(
    "refuses a foreign identity's late invitation %s response",
    async (phase) => {
      sessionStore.set({
        user: { id: "user-1", email: "new@example.com", emailVerified: true },
      });
      fetchInvitationMock.mockResolvedValue(invitation);
      acceptInvitationMock.mockResolvedValue({ organizationId: ORG });
      const completion = Promise.withResolvers<MeContextResponse>();
      if (phase === "resolve")
        fetchMeContextMock.mockReturnValueOnce(completion.promise);
      else fetchMeContextMock.mockResolvedValueOnce(context);
      updateActiveOrganizationMock.mockReturnValueOnce(completion.promise);
      renderPage();
      const client = resolveQueryClientForIdentity("user-1");
      client.setQueryData(ME_CONTEXT_QUERY_KEY, context);
      await userEvent.click(await screen.findByTestId("invitation-accept"));
      await waitFor(() => {
        if (phase === "switch")
          expect(updateActiveOrganizationMock).toHaveBeenCalledTimes(1);
        else expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
      });
      await act(async () => {
        completion.resolve({
          ...context,
          user: { ...context.user, id: "user-b" },
          lastActiveTenantId: ORG,
        });
        await completion.promise;
      });
      expect(
        await screen.findByTestId("invitation-accept-error"),
      ).toBeVisible();
      expect(screen.getByTestId("invitation-workspace")).toHaveAttribute(
        "href",
        "/workspace",
      );
      expect(client.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(context);
      expect(screen.queryByTestId("location")).toBeNull();
      if (phase === "resolve")
        expect(updateActiveOrganizationMock).not.toHaveBeenCalled();
    },
  );

  it("ignores the previous invitation completion and preserves the destination continuation after navigation", async () => {
    const acceptance = Promise.withResolvers<{ organizationId: string }>();
    fetchInvitationMock.mockResolvedValue(invitation);
    acceptInvitationMock.mockReturnValue(acceptance.promise);
    fetchMeContextMock.mockResolvedValue(context);
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    const { router } = renderPage();
    await userEvent.click(await screen.findByTestId("invitation-accept"));
    await act(async () => {
      await router.navigate("/workspace");
    });
    rememberInvitation("inv-B");
    await act(async () => {
      acceptance.resolve({ organizationId: ORG });
      await acceptance.promise;
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/workspace");
    expect(readInvitation()).toBe("inv-B");
    expect(fetchMeContextMock).not.toHaveBeenCalled();
    expect(updateActiveOrganizationMock).not.toHaveBeenCalled();
  });

  it("an unverified signed-in account keeps the invitation and is sent on to verify its email", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: false },
    });
    renderPage();

    expect(await screen.findByTestId("invitation-unverified")).toBeVisible();
    expect(readInvitation()).toBe("inv-123");
    await userEvent.click(screen.getByTestId("invitation-verify-email"));
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
  });

  it("refuses an invitation addressed to a different email", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    sessionStore.set({
      user: {
        id: "user-9",
        email: "other@example.com",
        emailVerified: true,
      },
    });
    renderPage();

    expect(
      await screen.findByTestId("invitation-wrong-account"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("invitation-accept")).toBeNull();
    expect(screen.getByTestId("invitation-recipient")).toHaveTextContent(
      "new@example.com",
    );
    expect(screen.getByTestId("invitation-recipient")).toHaveTextContent(
      "other@example.com",
    );
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it("fails safely when the invitation preview cannot be loaded", async () => {
    fetchInvitationMock.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    renderPage();

    expect(
      await screen.findByTestId("invitation-preview-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invitation-login")).toBeInTheDocument();
    expect(screen.queryByTestId("invitation-signup-submit")).toBeNull();
    expect(screen.getByTestId("invitation-login")).toHaveAttribute(
      "href",
      "/login",
    );
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
    // A missing invitation will not come back, so there is nothing to retry.
    expect(screen.queryByTestId("invitation-preview-retry")).toBeNull();
  });

  it("offers a retry for a failed load that can pass and shows the invitation after it does", async () => {
    fetchInvitationMock
      .mockRejectedValueOnce(new ApiError("SERVER_ERROR", "down", 503))
      .mockResolvedValue(invitation);
    renderPage();

    await userEvent.click(
      await screen.findByTestId("invitation-preview-retry"),
    );

    expect(await screen.findByTestId("invitation-signup-page")).toBeVisible();
    expect(fetchInvitationMock).toHaveBeenCalledTimes(2);
  });

  it("sends a signed-in visitor with a dead link to the workspace, not to sign-in", async () => {
    fetchInvitationMock.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    renderPage();

    expect(
      await screen.findByTestId("invitation-preview-workspace"),
    ).toHaveAttribute("href", "/workspace");
    expect(screen.queryByTestId("invitation-login")).toBeNull();
  });
});
