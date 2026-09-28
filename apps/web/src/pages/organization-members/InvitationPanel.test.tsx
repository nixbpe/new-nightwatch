import type { InvitationCreateResponse } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render as renderWithTestingLibrary,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { createInvitation } from "../../lib/api/invitations";
import { InvitationPanel } from "./InvitationPanel";

vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createInvitation: vi.fn(),
}));
const create = vi.mocked(createInvitation);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

afterEach(() => create.mockReset());
function render(ui: ReactElement) {
  const queryClient = new QueryClient();
  return renderWithTestingLibrary(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

async function draft(user: UserEvent) {
  await user.type(
    screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
    "new@example.com",
  );
  await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
}

describe("InvitationPanel", () => {
  it("offers owner to owners only, and submits a normalized address", async () => {
    create.mockResolvedValue({ created: true, emailDispatch: "accepted" });
    const user = userEvent.setup();
    const { rerender } = render(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="owner"
      />,
    );
    expect(screen.getByRole("option", { name: "เจ้าของ" })).toBeInTheDocument();
    rerender(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="admin"
      />,
    );
    expect(screen.queryByRole("option", { name: "เจ้าของ" })).toBeNull();
    await user.type(
      screen.getByLabelText("อีเมลของผู้ได้รับเชิญ"),
      "NEW@EXAMPLE.COM",
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
    expect(create).toHaveBeenCalledWith(A, {
      email: "new@example.com",
      role: "viewer",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "สร้างคำเชิญแล้ว",
    );
    expect(screen.getByRole("status").parentElement).toHaveFocus();
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
  });

  it("focuses invalid email with inline error and sends nothing", async () => {
    const user = userEvent.setup();
    render(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="admin"
      />,
    );
    await user.click(screen.getByRole("button", { name: "ส่งคำเชิญ" }));
    const email = screen.getByLabelText("อีเมลของผู้ได้รับเชิญ");
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("กรุณากรอกอีเมลผู้รับคำเชิญ");
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks duplicate submit while pending, keeps draft on pre-insert failure", async () => {
    const deferred = Promise.withResolvers<InvitationCreateResponse>();
    create.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    render(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="owner"
      />,
    );
    await draft(user);
    expect(
      screen.getByRole("button", { name: "กำลังส่งคำเชิญ…" }),
    ).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferred.reject(new ApiError("INVITATION_LIMIT_REACHED", "limit", 409));
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ครบ 100 รายการ",
    );
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue(
      "new@example.com",
    );
  });

  it("announces persisted invitation with failed SMTP as warning and never retries", async () => {
    create.mockResolvedValue({ created: true, emailDispatch: "failed" });
    const user = userEvent.setup();
    render(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="owner"
      />,
    );
    await draft(user);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "สร้างคำเชิญแล้ว แต่อีเมลส่งไม่สำเร็จ",
    );
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  it("drops old A completion and draft on a keyed organization switch to B", async () => {
    const delayed = Promise.withResolvers<InvitationCreateResponse>();
    create.mockReturnValue(delayed.promise);
    const user = userEvent.setup();
    const { rerender } = render(
      <InvitationPanel
        key={A}
        organizationId={A}
        organizationName="Acme"
        actorRole="owner"
      />,
    );
    await draft(user);
    rerender(
      <InvitationPanel
        key={B}
        organizationId={B}
        organizationName="Beta"
        actorRole="owner"
      />,
    );
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
    await act(async () => {
      delayed.resolve({ created: true, emailDispatch: "failed" });
      await delayed.promise;
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("อีเมลของผู้ได้รับเชิญ")).toHaveValue("");
  });
});
