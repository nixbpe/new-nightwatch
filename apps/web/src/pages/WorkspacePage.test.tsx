import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../lib/api/me";
import { TenantProvider } from "../lib/tenant/TenantProvider";
import { WorkspacePage } from "./WorkspacePage";

const { sessionState, signOutMock, inviteMemberMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: Record<string, unknown> } | null,
    isPending: false,
  },
  signOutMock: vi.fn(),
  inviteMemberMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    signOut: signOutMock,
    organization: { inviteMember: inviteMemberMock },
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../lib/api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function meContext(
  organizations: MeContextResponse["organizations"],
  lastActiveTenantId: string | null = null,
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "ผู้ใช้ทดสอบ",
      email: "user@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId,
  };
}

const ownerOrg = {
  id: ORG_A,
  name: "Org A",
  slug: "org-a",
  role: "owner" as const,
};
const viewerOrg = {
  id: ORG_B,
  name: "Org B",
  slug: "org-b",
  role: "viewer" as const,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route
            path="/workspace"
            element={
              <TenantProvider>
                <WorkspacePage />
              </TenantProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspacePage context states", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    inviteMemberMock.mockReset();
    signOutMock.mockReset();
    sessionState.data = null;
  });

  it("shows loading only while the context is actually pending, then renders the organization", async () => {
    // QA-12 regression: a slow /me response is a pending state that
    // resolves into content — never a permanent spinner.
    const pending = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockImplementation(() => pending.promise);
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "กำลังโหลดข้อมูลองค์กร…",
    );

    pending.resolve(meContext([ownerOrg], ORG_A));

    expect(
      await screen.findByRole("heading", { name: "Org A" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a failed context load offers an explicit retry that recovers", async () => {
    // SEC-C2-UI-002 regression: a /me failure is a retryable error state —
    // not the loading spinner, not the zero-membership screen.
    fetchMeContextMock.mockRejectedValueOnce(
      new ApiError("INTERNAL", "server exploded", 500),
    );
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "โหลดข้อมูลองค์กรไม่สำเร็จ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
      }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

    expect(
      await screen.findByRole("heading", { name: "Org A" }),
    ).toBeInTheDocument();
  });

  it("a successful context with zero memberships shows the access-needed state", async () => {
    // Access-needed is exclusively the successful zero-membership outcome.
    fetchMeContextMock.mockResolvedValue(meContext([]));
    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่เป็นสมาชิกขององค์กรใด/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
  });
});

describe("WorkspacePage organization views", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    inviteMemberMock.mockReset();
    signOutMock.mockReset();
    sessionState.data = null;
  });

  it("a viewer membership sees no invite controls", async () => {
    // Role boundary: invitation is owner/admin-only in the UI, matching the
    // server-side 403 for lesser roles.
    fetchMeContextMock.mockResolvedValue(meContext([viewerOrg], ORG_B));
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Org B" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ผู้ชม/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
    expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  });

  it("an owner sees invite controls and a successful invite confirms", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    inviteMemberMock.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Org A" });
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "new@example.com",
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));

    expect(
      await screen.findByText(/ส่งคำเชิญถึง new@example\.com/),
    ).toBeInTheDocument();
    // The form resets after a confirmed send.
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
  });

  it("a failed invite shows the error and keeps the entered email", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    inviteMemberMock.mockResolvedValue({
      data: null,
      error: { message: "ส่งคำเชิญไม่สำเร็จ" },
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Org A" });
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "new@example.com",
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ส่งคำเชิญไม่สำเร็จ",
    );
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
      "new@example.com",
    );
  });

  it("switching organization publishes the new tenant only after the PATCH succeeds", async () => {
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_B),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Org A" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "องค์กร" }),
      ORG_B,
    );

    expect(
      await screen.findByRole("heading", { name: "Org B" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ผู้ชม/)).toBeInTheDocument();
  });

  it("a denied switch keeps the current organization", async () => {
    // MEMBERSHIP_DENIED (403) from the server: the selection snaps back to
    // the still-valid tenant instead of showing an org the user left.
    fetchMeContextMock.mockResolvedValue(
      meContext([ownerOrg, viewerOrg], ORG_A),
    );
    updateActiveOrganizationMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "denied", 403),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Org A" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "องค์กร" }),
      ORG_B,
    );

    // Once the failed PATCH settles, the view must be back on Org A.
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "องค์กร" })).toHaveValue(
        ORG_A,
      );
    });
    expect(screen.getByRole("heading", { name: "Org A" })).toBeInTheDocument();
  });
});
