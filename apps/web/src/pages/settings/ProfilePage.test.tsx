import { StrictMode } from "react";
import { contextQueryOptions } from "../../lib/tenant/bootstrap";
import { guardUnassignedNetwork } from "../../test/guard-network";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfilePage } from "./ProfilePage";

const { meState, fetchMeContextMock, updateUserMock } = vi.hoisted(() => ({
  meState: { name: "นภัส วงศ์สกุล" },
  fetchMeContextMock: vi.fn<() => Promise<MeContextResponse>>(),
  updateUserMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false }),
    updateUser: updateUserMock,
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../../lib/api/me", () => ({
  ME_CONTEXT_QUERY_KEY: ["me", "context"],
  fetchMeContext: () => fetchMeContextMock(),
}));

function meContext(): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: meState.name,
      email: "napat@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [],
    lastActiveTenantId: null,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(queryClient, "user-1");
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>,
  );
  return { invalidate };
}

guardUnassignedNetwork();

describe("ProfilePage", () => {
  beforeEach(() => {
    meState.name = "นภัส วงศ์สกุล";
    updateUserMock.mockReset();
    fetchMeContextMock.mockReset();
    fetchMeContextMock.mockImplementation(() => Promise.resolve(meContext()));
  });

  it("keeps failed context stable during StrictMode mount and retries only on page action", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    bindQueryClientIdentity(queryClient, "user-1");
    fetchMeContextMock.mockRejectedValue(new Error("offline"));
    await queryClient
      .query(contextQueryOptions(queryClient))
      .catch(() => undefined);
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    const view = render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ProfilePage />
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByTestId("profile-load-error");
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
    fetchMeContextMock.mockResolvedValue(meContext());
    await userEvent.setup().click(screen.getByTestId("profile-load-retry"));
    await screen.findByTestId("profile-name");
    expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await queryClient.query(contextQueryOptions(queryClient));
    });
    expect(fetchMeContextMock).toHaveBeenCalledTimes(3);
    view.unmount();
    await queryClient.cancelQueries();
    queryClient.clear();
  });
  it("shows the stored name, the read-only verified email and the initials avatar", async () => {
    renderPage();

    const name = await screen.findByTestId("profile-name");
    expect(name).toHaveValue("นภัส วงศ์สกุล");
    const email = screen.getByTestId("profile-email");
    expect(email).toHaveValue("napat@example.com");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByTestId("profile-email-verified")).toBeInTheDocument();
    expect(screen.getByTestId("profile-avatar")).toHaveTextContent("นว");
    expect(screen.getByTestId("profile-cancel")).toBeDisabled();
    expect(screen.getByTestId("profile-save")).toBeDisabled();
  });

  it("validates the name and never calls the API with an empty one", async () => {
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByTestId("profile-name");

    await user.clear(name);
    await user.click(screen.getByTestId("profile-save"));

    expect(screen.getByTestId("profile-name-error")).toBeVisible();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("profile-name-error").id,
    );
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("saves exactly { name }, invalidates me/context, and the avatar follows", async () => {
    updateUserMock.mockImplementation(({ name }: { name: string }) => {
      meState.name = name;
      return Promise.resolve({ data: { status: true }, error: null });
    });
    const user = userEvent.setup();
    const { invalidate } = renderPage();
    const name = await screen.findByTestId("profile-name");

    await user.clear(name);
    await user.type(name, "  ปวีณา ยอดเยี่ยม ");
    expect(screen.getByTestId("profile-avatar")).toHaveTextContent("ปย");
    await user.click(screen.getByTestId("profile-save"));

    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({ name: "ปวีณา ยอดเยี่ยม" });
    expect(await screen.findByTestId("profile-save-success")).toBeVisible();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me", "context"] });
    expect(await screen.findByTestId("profile-name")).toHaveValue(
      "ปวีณา ยอดเยี่ยม",
    );
  });

  it("a server error keeps the typed name for a retry", async () => {
    updateUserMock.mockResolvedValue({
      data: null,
      error: { message: "Name too long" },
    });
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByTestId("profile-name");

    await user.clear(name);
    await user.type(name, "ชื่อใหม่");
    await user.click(screen.getByTestId("profile-save"));

    expect(await screen.findByTestId("profile-save-error")).toBeVisible();
    expect(name).toHaveValue("ชื่อใหม่");
    expect(screen.getByTestId("profile-save")).toBeEnabled();
    expect(updateUserMock).toHaveBeenCalledWith({ name: "ชื่อใหม่" });
  });

  it("cancel restores the stored name", async () => {
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByTestId("profile-name");

    await user.type(name, " เพิ่ม");
    expect(screen.getByTestId("profile-save")).toBeEnabled();
    expect(screen.getByTestId("profile-cancel")).toBeEnabled();
    expect(screen.getByTestId("profile-email")).toHaveAttribute("readonly");
    expect(screen.getByTestId("profile-email")).toHaveValue(
      "napat@example.com",
    );
    await user.click(screen.getByTestId("profile-cancel"));

    expect(name).toHaveValue("นภัส วงศ์สกุล");
    expect(screen.getByTestId("profile-save")).toBeDisabled();
    expect(screen.getByTestId("profile-cancel")).toBeDisabled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
