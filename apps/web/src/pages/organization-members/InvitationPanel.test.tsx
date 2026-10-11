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
    screen.getByTestId("members-invitation-email"),
    "new@example.com",
  );
  await user.click(screen.getByTestId("members-invitation-send"));
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
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByTestId("members-invitation-role-owner")).toHaveAttribute(
      "value",
      "owner",
    );
    rerender(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="admin"
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("members-invitation-role-owner")).toBeNull();
    await user.type(
      screen.getByTestId("members-invitation-email"),
      "NEW@EXAMPLE.COM",
    );
    await user.click(screen.getByTestId("members-invitation-send"));
    expect(create).toHaveBeenCalledWith(A, {
      email: "new@example.com",
      role: "viewer",
    });
    expect(
      await screen.findByTestId("members-invitation-success"),
    ).toHaveAttribute("role", "status");
    expect(screen.getByTestId("members-invitation-notice-focus")).toHaveFocus();
    expect(screen.getByTestId("members-invitation-email")).toHaveValue("");
  });

  it.each(["accepted", "failed"] as const)(
    "announces a created invitation once when the email is %s",
    async (emailDispatch) => {
      create.mockResolvedValue({ created: true, emailDispatch });
      const onCreated = vi.fn();
      const user = userEvent.setup();
      render(
        <InvitationPanel
          organizationId={A}
          organizationName="Acme"
          actorRole="owner"
          onCreated={onCreated}
        />,
      );
      await draft(user);
      const outcome = await screen.findByTestId(
        emailDispatch === "accepted"
          ? "members-invitation-success"
          : "members-invitation-warning",
      );
      expect(outcome).toHaveAttribute("role", "status");
      expect(
        screen.queryByTestId(
          emailDispatch === "accepted"
            ? "members-invitation-warning"
            : "members-invitation-success",
        ),
      ).toBeNull();
      expect(onCreated).toHaveBeenCalledTimes(1);
    },
  );

  it("does not announce a creation that the server rejected", async () => {
    create.mockRejectedValue(
      new ApiError("INVITATION_LIMIT_REACHED", "full", 409),
    );
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="owner"
        onCreated={onCreated}
      />,
    );
    await draft(user);
    await screen.findByTestId("members-invitation-error");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("focuses invalid email with inline error and sends nothing", async () => {
    const user = userEvent.setup();
    render(
      <InvitationPanel
        organizationId={A}
        organizationName="Acme"
        actorRole="admin"
        onCreated={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("members-invitation-send"));
    const email = screen.getByTestId("members-invitation-email");
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("members-invitation-email-error").id,
    );
    expect(
      screen.getByTestId("members-invitation-email-error"),
    ).toHaveAttribute("role", "alert");
    expect(email).toHaveAccessibleDescription();
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
        onCreated={vi.fn()}
      />,
    );
    await draft(user);
    expect(screen.getByTestId("members-invitation-send")).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferred.reject(new ApiError("INVITATION_LIMIT_REACHED", "limit", 409));
      await Promise.resolve();
    });
    const error = await screen.findByTestId("members-invitation-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error.textContent.match(/\d+/g)).toEqual(["100"]);
    expect(screen.getByTestId("members-invitation-email")).toHaveValue(
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
        onCreated={vi.fn()}
      />,
    );
    await draft(user);
    expect(
      await screen.findByTestId("members-invitation-warning"),
    ).toHaveAttribute("role", "status");
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
        onCreated={vi.fn()}
      />,
    );
    await draft(user);
    rerender(
      <InvitationPanel
        key={B}
        organizationId={B}
        organizationName="Beta"
        actorRole="owner"
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByTestId("members-invitation-email")).toHaveValue("");
    await act(async () => {
      delayed.resolve({ created: true, emailDispatch: "failed" });
      await delayed.promise;
    });
    expect(
      screen.queryByTestId(/^members-invitation-(success|warning)$/),
    ).toBeNull();
    expect(screen.getByTestId("members-invitation-email")).toHaveValue("");
  });
});
