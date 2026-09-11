import type { MeContextResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("ProfilePage", () => {
  beforeEach(() => {
    meState.name = "นภัส วงศ์สกุล";
    updateUserMock.mockReset();
    fetchMeContextMock.mockReset();
    fetchMeContextMock.mockImplementation(() => Promise.resolve(meContext()));
  });

  it("shows the stored name, the read-only verified email and the initials avatar", async () => {
    renderPage();

    const name = await screen.findByLabelText("ชื่อที่แสดง");
    expect(name).toHaveValue("นภัส วงศ์สกุล");
    const email = screen.getByLabelText(/อีเมล/);
    expect(email).toHaveValue("napat@example.com");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByText("ยืนยันแล้ว")).toBeInTheDocument();
    expect(screen.getByText("นว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เปลี่ยนอีเมล/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    ).toBeDisabled();
  });

  it("validates the name and never calls the API with an empty one", async () => {
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByLabelText("ชื่อที่แสดง");

    await user.clear(name);
    await user.click(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("กรุณากรอกชื่อที่แสดง");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("saves exactly { name }, invalidates me/context, and the avatar follows", async () => {
    updateUserMock.mockImplementation(({ name }: { name: string }) => {
      meState.name = name;
      return Promise.resolve({ data: { status: true }, error: null });
    });
    const user = userEvent.setup();
    const { invalidate } = renderPage();
    const name = await screen.findByLabelText("ชื่อที่แสดง");

    await user.clear(name);
    await user.type(name, "  ปวีณา ยอดเยี่ยม ");
    expect(screen.getByText("ปย")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    );

    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({ name: "ปวีณา ยอดเยี่ยม" });
    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกแล้ว");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me", "context"] });
    expect(await screen.findByLabelText("ชื่อที่แสดง")).toHaveValue(
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
    const name = await screen.findByLabelText("ชื่อที่แสดง");

    await user.clear(name);
    await user.type(name, "ชื่อใหม่");
    await user.click(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Name too long");
    expect(name).toHaveValue("ชื่อใหม่");
  });

  it("cancel restores the stored name", async () => {
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByLabelText("ชื่อที่แสดง");

    await user.type(name, " เพิ่ม");
    expect(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));

    expect(name).toHaveValue("นภัส วงศ์สกุล");
    expect(
      screen.getByRole("button", { name: "บันทึกการเปลี่ยนแปลง" }),
    ).toBeDisabled();
  });
});
