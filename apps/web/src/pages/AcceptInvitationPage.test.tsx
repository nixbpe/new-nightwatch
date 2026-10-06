import { guardUnassignedNetwork } from "../test/guard-network";
guardUnassignedNetwork();
import type {
  InvitationResponse,
  MeContextResponse,
} from "@nightwatch/api-contract";
import { act, render, screen, waitFor } from "@testing-library/react";
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
    // Reactive stand-in for the better-auth session atom: mutations notify subscribers.
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
  return <div data-testid="location">{location.pathname}</div>;
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

    await screen.findByText("สร้างบัญชีจากคำเชิญ");
    await userEvent.type(screen.getByLabelText("ชื่อที่แสดง"), "สมชาย ใจดี");
    await userEvent.type(
      screen.getByLabelText("รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"),
      "super-secret-1",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "สร้างบัญชีและรอการยืนยันอีเมล" }),
    );

    // Signup routes to the resend hub with the invitation remembered for post-verification acceptance.
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email",
    );
    expect(readInvitation()).toBe("inv-123");
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

    await user.click(
      await screen.findByRole("link", { name: "เข้าสู่ระบบเพื่อรับคำเชิญ" }),
    );
    await screen.findByRole("heading", { name: "เข้าสู่ระบบ" });

    await user.type(screen.getByLabelText("อีเมล"), "new@example.com");
    await user.type(screen.getByLabelText("รหัสผ่าน"), "super-secret-1");
    await user.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
    page.resolveSession();

    // The remounted anonymous guard must resume the invitation while the original sign-in still awaits.
    expect(
      await screen.findByRole("heading", { name: "ยอมรับคำเชิญ" }),
    ).toBeInTheDocument();
    expect(readInvitation()).toBe("inv-123");
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    await act(async () => {
      signIn.resolve({ data: sessionStore.get().data, error: null });
      await signIn.promise;
    });
    expect(
      screen.getByRole("heading", { name: "ยอมรับคำเชิญ" }),
    ).toBeInTheDocument();

    const client = resolveQueryClientForIdentity("user-1");
    client.setQueryData(["tenant", "old-org", "retired"], { old: true });
    await user.click(screen.getByRole("button", { name: "เข้าร่วมองค์กร" }));
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

  it("keeps the invitation pending on cap denial, announces the cap, and focuses the error", async () => {
    fetchInvitationMock.mockResolvedValue(invitation);
    acceptInvitationMock.mockRejectedValue(
      new ApiError("ORGANIZATION_MEMBERSHIP_LIMIT_REACHED", "cap", 409),
    );
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "เข้าร่วมองค์กร" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("ครบ 1,000 คน");
    await waitFor(() =>
      expect(screen.getByRole("alert").parentElement).toHaveFocus(),
    );
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
    await userEvent.click(
      await screen.findByRole("button", { name: "เข้าร่วมองค์กร" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "เลือกองค์กรไม่สำเร็จ",
    );
    expect(screen.queryByRole("button", { name: "เข้าร่วมองค์กร" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "ไปหน้าองค์กร" }),
    ).toBeInTheDocument();
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
      await userEvent.click(
        await screen.findByRole("button", { name: "เข้าร่วมองค์กร" }),
      );
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
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "เลือกองค์กรไม่สำเร็จ",
      );
      expect(client.getQueryData(ME_CONTEXT_QUERY_KEY)).toEqual(context);
      expect(screen.queryByTestId("location")).toBeNull();
      if (phase === "resolve")
        expect(updateActiveOrganizationMock).not.toHaveBeenCalled();
    },
  );

  it("does not publish A completion or erase B continuation after navigation", async () => {
    const acceptance = Promise.withResolvers<{ organizationId: string }>();
    fetchInvitationMock.mockResolvedValue(invitation);
    acceptInvitationMock.mockReturnValue(acceptance.promise);
    fetchMeContextMock.mockResolvedValue(context);
    sessionStore.set({
      user: { id: "user-1", email: "new@example.com", emailVerified: true },
    });
    const { router } = renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "เข้าร่วมองค์กร" }),
    );
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
      await screen.findByText("บัญชีนี้ไม่ตรงกับคำเชิญ"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เข้าร่วมองค์กร" })).toBeNull();
  });

  it("fails safely when the invitation preview cannot be loaded", async () => {
    fetchInvitationMock.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    renderPage();

    expect(
      await screen.findByText(
        "ไม่พบคำเชิญนี้ ตรวจสอบลิงก์จากอีเมลอีกครั้งหรือติดต่อผู้เชิญ",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ไปที่หน้าเข้าสู่ระบบ" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "สร้างบัญชีและรอการยืนยันอีเมล" }),
    ).toBeNull();
  });
});
