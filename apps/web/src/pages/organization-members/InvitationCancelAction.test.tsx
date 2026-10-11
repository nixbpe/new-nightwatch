import type {
  PendingInvitation,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  cancelInvitation,
  fetchPendingInvitations,
} from "../../lib/api/invitations";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { PendingInvitationsSection } from "./PendingInvitationsSection";

vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(),
  cancelInvitation: vi.fn(),
}));
const fetchList = vi.mocked(fetchPendingInvitations);
const cancelRequest = vi.mocked(cancelInvitation);
const refreshMembershipContext = vi.fn(() => Promise.resolve(null));
const A = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  fetchList.mockReset();
  cancelRequest.mockReset();
  refreshMembershipContext.mockClear();
});

const publicId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const emailOf = (n: number) => `row-${String(n)}@example.test`;

function invitation(
  n: number,
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    publicId: publicId(n),
    email: emailOf(n),
    role: "viewer",
    sentAt: "2026-09-30T08:00:00.000Z",
    expiresAt: "2026-10-02T08:00:00.000Z",
    expired: false,
    resendAvailableAt: "2026-09-30T08:05:00.000Z",
    manageable: true,
    ...overrides,
  };
}

/** Serves the rows still in `ids` (1-based), sliced like the API. */
function serve(ids: Set<number>) {
  fetchList.mockImplementation((organizationId, limit, offset) => {
    const all = [...ids].sort((left, right) => left - right);
    return Promise.resolve({
      organizationId,
      invitations: all.slice(offset, offset + limit).map((n) => invitation(n)),
      activeCount: all.length,
      activeLimit: 100,
      page: { limit, offset, total: all.length },
    } satisfies PendingInvitationListResponse);
  });
}
const range = (count: number) =>
  new Set(Array.from({ length: count }, (_, index) => index + 1));

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PendingInvitationsSection
        organizationId={A}
        organizationName="Acme"
        refreshMembershipContext={refreshMembershipContext}
        createdSignal={0}
      />
    </QueryClientProvider>,
  );
  return { queryClient };
}

const cancelButton = (n: number) =>
  screen.getByTestId(`invitation-cancel-${publicId(n)}`);
const confirmButton = () =>
  within(screen.getByTestId(/^invitation-(cancel|resend)-dialog$/)).getByTestId(
    "invitation-cancel-confirm",
  );
const heading = () => screen.getByTestId("pending-invitations-heading");
// The section's own region; the open dialog carries a second status element.
const sectionStatus = () => {
  const node = screen.getByTestId("pending-invitations-status");
  expect(node).toHaveAttribute("role", "status");
  return node;
};
const textStatusCount = () => {
  const nodes = screen.getAllByTestId(
    /^(pending-invitations-status|confirmation-pending)$/,
  );
  for (const node of nodes) expect(node).toHaveAttribute("role", "status");
  return nodes.filter((node) => node.textContent !== "").length;
};

async function openAndConfirm(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
) {
  await user.click(cancelButton(n));
  await user.click(confirmButton());
}

describe("invitation cancel", () => {
  it("opens a confirmation naming the email, role, Organization and impact, with no id or link", async () => {
    serve(range(2));
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    const row = screen.getByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      within(row).getByTestId("pending-invitation-sent-at"),
    ).toHaveAttribute("datetime", invitation(1).sentAt);
    expect(
      within(row).getByTestId("pending-invitation-expires-at"),
    ).toHaveAttribute("datetime", invitation(1).expiresAt);
    await user.click(cancelButton(1));

    const dialog = screen.getByTestId(/^invitation-(cancel|resend)-dialog$/);
    expect(dialog).toHaveTextContent(emailOf(1));
    expect(
      within(dialog).getByTestId("pending-invitation-confirm-role-viewer"),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("Acme");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription();
    expect(document.body.textContent).not.toContain(publicId(1));
    expect(document.body.innerHTML).not.toMatch(/https?:\/\//);
    expect(cancelRequest).not.toHaveBeenCalled();
  });

  it("sends no request on กลับ or Escape and returns focus to the opener", async () => {
    serve(range(2));
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await user.click(cancelButton(2));
    await user.click(screen.getByTestId("confirmation-cancel"));
    expect(
      screen.queryByTestId(/^invitation-(cancel|resend)-dialog$/),
    ).toBeNull();
    expect(cancelButton(2)).toHaveFocus();

    await user.click(cancelButton(1));
    await user.keyboard("{Escape}");
    expect(
      screen.queryByTestId(/^invitation-(cancel|resend)-dialog$/),
    ).toBeNull();
    expect(cancelButton(1)).toHaveFocus();
    expect(cancelRequest).not.toHaveBeenCalled();
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it("blocks other actions while pending, sends one request and shows success only after the refreshed list lacks the row", async () => {
    const ids = range(3);
    serve(ids);
    const held = Promise.withResolvers<{ canceled: true }>();
    cancelRequest.mockReturnValue(held.promise);
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await user.click(cancelButton(2));
    await user.click(confirmButton());
    expect(
      screen.getByTestId("confirmation-pending"),
    ).not.toBeEmptyDOMElement();
    expect(
      within(
        screen.getByTestId(/^invitation-(cancel|resend)-dialog$/),
      ).getByTestId("invitation-cancel-confirm"),
    ).toBeDisabled();
    // One announcement while the dialog is open: the dialog's own region.
    expect(textStatusCount()).toBe(1);
    expect(cancelButton(1)).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(
      screen.getByTestId(/^invitation-(cancel|resend)-dialog$/),
    ).toBeVisible();
    expect(cancelRequest).toHaveBeenCalledTimes(1);

    // The list refetch is held: the server confirmed, the list has not.
    const refreshed = Promise.withResolvers<PendingInvitationListResponse>();
    ids.delete(2);
    fetchList.mockReturnValueOnce(refreshed.promise);
    held.resolve({ canceled: true });
    await waitFor(() => {
      expect(fetchList).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.queryByTestId("pending-invitations-cancel-success"),
    ).toBeNull();
    expect(screen.queryByTestId("pending-invitations-table")).toBeNull();
    expect(
      screen.queryByTestId(/^invitation-(cancel|resend)-dialog$/),
    ).toBeNull();
    expect(
      screen.getByTestId("pending-invitations-cancel-pending"),
    ).not.toBeEmptyDOMElement();
    expect(textStatusCount()).toBe(1);

    refreshed.resolve({
      organizationId: A,
      invitations: [invitation(1), invitation(3)],
      activeCount: 2,
      activeLimit: 100,
      page: { limit: 50, offset: 0, total: 2 },
    });
    expect(
      await screen.findByTestId("pending-invitations-cancel-success"),
    ).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(2));
    expect(sectionStatus()).toHaveTextContent(emailOf(2));
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toBeVisible();
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(2)}`),
    ).toBeNull();
    expect(screen.getByTestId("pending-invitations-count")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("pending-invitations-limit")).toHaveTextContent(
      "100",
    );
    expect(cancelRequest).toHaveBeenCalledTimes(1);
    expect(cancelRequest).toHaveBeenCalledWith(A, publicId(2));
  });

  it("shows no success or notice when the DELETE succeeds and the refetch fails, and focuses the heading", async () => {
    serve(range(2));
    cancelRequest.mockResolvedValue({ canceled: true });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await user.click(cancelButton(1));
    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await user.click(confirmButton());

    expect(
      await screen.findByTestId("pending-invitations-load-error"),
    ).toBeVisible();
    expect(screen.getByTestId("pending-invitations-retry")).toBeVisible();
    expect(
      screen.queryByTestId("pending-invitations-cancel-success"),
    ).toBeNull();
    expect(screen.queryByTestId("pending-invitations-cancel-error")).toBeNull();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it("keeps the open page and pulls row 51 up when a first-page row of 51 is canceled", async () => {
    const ids = range(51);
    serve(ids);
    cancelRequest.mockImplementation(() => {
      ids.delete(1);
      return Promise.resolve({ canceled: true });
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeNull();

    await openAndConfirm(user, 1);

    expect(
      await screen.findByTestId("pending-invitations-cancel-success"),
    ).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(1));
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent(emailOf(51));
    expect(fetchList.mock.calls.map((call) => call[2])).toEqual([0, 0]);
    expect(screen.getByTestId("pending-invitations-count")).toHaveTextContent(
      "50",
    );
    expect(screen.getByTestId("pending-invitations-limit")).toHaveTextContent(
      "100",
    );
    // Focus goes to the next row's cancel button.
    await waitFor(() => {
      expect(cancelButton(2)).toHaveFocus();
    });
  });

  it("focuses the row pulled up from the next page when the last row of page one is canceled", async () => {
    const ids = range(51);
    serve(ids);
    cancelRequest.mockImplementation(() => {
      ids.delete(50);
      return Promise.resolve({ canceled: true });
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await openAndConfirm(user, 50);

    await screen.findByTestId("pending-invitations-cancel-success");
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(50));
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent(emailOf(51));
    await waitFor(() => {
      expect(cancelButton(51)).toHaveFocus();
    });
  });

  it("loads the last page that has rows after the only row of the last page is canceled", async () => {
    const ids = range(51);
    serve(ids);
    cancelRequest.mockImplementation(() => {
      ids.delete(51);
      return Promise.resolve({ canceled: true });
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    await user.click(screen.getByTestId("pending-invitations-next"));
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent(emailOf(51));

    await openAndConfirm(user, 51);

    expect(
      await screen.findByTestId("pending-invitations-cancel-success"),
    ).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(51));
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    expect(fetchList.mock.calls.map((call) => call[2])).toEqual([0, 50, 50, 0]);
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it("moves focus to the next row, else the previous row, else the heading", async () => {
    const ids = range(3);
    serve(ids);
    cancelRequest.mockImplementation((_organizationId, id) => {
      ids.delete(Number(id.slice(-12)));
      return Promise.resolve({ canceled: true });
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await openAndConfirm(user, 3);
    await screen.findByTestId("pending-invitations-cancel-success");
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(3));
    await waitFor(() => {
      expect(cancelButton(2)).toHaveFocus();
    });

    await openAndConfirm(user, 2);
    await screen.findByTestId("pending-invitations-cancel-success");
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(2));
    await waitFor(() => {
      expect(cancelButton(1)).toHaveFocus();
    });

    await openAndConfirm(user, 1);
    expect(
      await screen.findByTestId("pending-invitations-empty"),
    ).toBeVisible();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
    expect(sectionStatus()).toHaveTextContent(emailOf(1));
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toBeVisible();
  });

  it("skips rows without a button when choosing the focus neighbour", async () => {
    const ids = range(3);
    fetchList.mockImplementation((organizationId, limit, offset) => {
      const rows = [...ids]
        .sort((left, right) => left - right)
        .map((n) => invitation(n, { manageable: n !== 2 }));
      return Promise.resolve({
        organizationId,
        invitations: rows.slice(offset, offset + limit),
        activeCount: rows.length,
        activeLimit: 100,
        page: { limit, offset, total: rows.length },
      });
    });
    cancelRequest.mockImplementation(() => {
      ids.delete(1);
      return Promise.resolve({ canceled: true });
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await openAndConfirm(user, 1);

    await screen.findByTestId("pending-invitations-cancel-success");
    expect(
      screen.getByTestId("pending-invitations-cancel-success"),
    ).toHaveTextContent(emailOf(1));
    await waitFor(() => {
      expect(cancelButton(3)).toHaveFocus();
    });
  });

  it("shows the owner-only text and no button for a row the actor cannot manage", async () => {
    fetchList.mockResolvedValue({
      organizationId: A,
      invitations: [
        invitation(1, { role: "owner", manageable: false }),
        invitation(2),
      ],
      activeCount: 2,
      activeLimit: 100,
      page: { limit: 50, offset: 0, total: 2 },
    });
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    expect(
      within(
        screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
      ).getByTestId("pending-invitation-role-owner"),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    expect(
      within(
        screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
      ).getByTestId("invitation-owner-only"),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    expect(
      within(
        screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
      ).queryAllByTestId(/^invitation-(cancel|resend)-/),
    ).toHaveLength(0);
    expect(
      within(
        screen.getByTestId(`pending-invitation-row-${publicId(2)}`),
      ).getByTestId(`invitation-cancel-${publicId(2)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(2)}`),
    ).toHaveTextContent(emailOf(2));
  });

  it("shows the 404 message without an email, refreshes once, never replays and focuses the heading when the row is gone", async () => {
    const ids = range(2);
    serve(ids);
    cancelRequest.mockImplementation(() => {
      // Another session canceled it first.
      ids.delete(1);
      return Promise.reject(
        new ApiError("INVITATION_NOT_FOUND", "not found", 404),
      );
    });
    const user = userEvent.setup();
    const { queryClient } = renderSection();
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, { marker: true });
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await openAndConfirm(user, 1);

    expect(
      await screen.findByTestId("pending-invitations-cancel-error"),
    ).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-cancel-error"),
    ).toBeVisible();
    expect(sectionStatus()).not.toHaveTextContent("@");
    expect(
      screen.queryByTestId("pending-invitations-cancel-success"),
    ).toBeNull();
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeNull();
    expect(cancelRequest).toHaveBeenCalledTimes(1);
    expect(fetchList).toHaveBeenCalledTimes(2);
    expect(refreshMembershipContext).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(ME_CONTEXT_QUERY_KEY)?.isInvalidated).toBe(
      false,
    );
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it("returns focus to the opener after a general failure while the row is still listed", async () => {
    serve(range(2));
    cancelRequest.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    await openAndConfirm(user, 2);

    expect(
      await screen.findByTestId("pending-invitations-cancel-error"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("pending-invitations-cancel-success"),
    ).toBeNull();
    await waitFor(() => {
      expect(cancelButton(2)).toHaveFocus();
    });
    expect(cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("loads the last page with rows, or empty, when another session canceled every row of the open last page", async () => {
    const ids = range(51);
    serve(ids);
    cancelRequest.mockImplementation(() => {
      ids.delete(51);
      return Promise.reject(
        new ApiError("INVITATION_NOT_FOUND", "not found", 404),
      );
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    await user.click(screen.getByTestId("pending-invitations-next"));
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent(emailOf(51));

    await openAndConfirm(user, 51);

    expect(
      await screen.findByTestId("pending-invitations-cancel-error"),
    ).toBeVisible();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));
    expect(fetchList.mock.calls.map((call) => call[2])).toEqual([0, 50, 50, 0]);

    // Every row of the last page canceled elsewhere, nothing left at all.
    ids.clear();
    cancelRequest.mockRejectedValue(
      new ApiError("INVITATION_NOT_FOUND", "not found", 404),
    );
    await user.click(cancelButton(1));
    await user.click(confirmButton());
    expect(
      await screen.findByTestId("pending-invitations-empty"),
    ).toBeVisible();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it.each(["PERMISSION_DENIED", "MEMBERSHIP_DENIED"])(
    "refreshes the membership context and shows no success on %s",
    async (code) => {
      serve(range(2));
      cancelRequest.mockRejectedValue(new ApiError(code, "denied", 403));
      const user = userEvent.setup();
      const { queryClient } = renderSection();
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, { marker: true });
      expect(
        await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
      ).toHaveTextContent(emailOf(1));

      await openAndConfirm(user, 1);

      expect(
        await screen.findByTestId("pending-invitations-cancel-error"),
      ).toBeVisible();
      expect(
        screen.queryByTestId("pending-invitations-cancel-success"),
      ).toBeNull();
      await waitFor(() => {
        expect(refreshMembershipContext).toHaveBeenCalledTimes(1);
      });
      expect(
        queryClient.getQueryState(ME_CONTEXT_QUERY_KEY)?.isInvalidated,
      ).toBe(true);
      expect(cancelRequest).toHaveBeenCalledTimes(1);
      expect(fetchList).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["PERMISSION_DENIED", "MEMBERSHIP_DENIED"])(
    "refreshes the membership context once on %s even when the list refetch is denied too",
    async (code) => {
      serve(range(2));
      cancelRequest.mockRejectedValue(new ApiError(code, "denied", 403));
      const user = userEvent.setup();
      renderSection();
      expect(
        await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
      ).toHaveTextContent(emailOf(1));
      fetchList.mockRejectedValue(new ApiError(code, "denied", 403));

      await openAndConfirm(user, 1);

      expect(
        await screen.findByTestId("pending-invitations-load-error"),
      ).toBeVisible();
      await waitFor(() => {
        expect(refreshMembershipContext).toHaveBeenCalledTimes(1);
      });
      expect(
        screen.queryByTestId("pending-invitations-cancel-success"),
      ).toBeNull();
      expect(cancelRequest).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the status region mounted and empty while idle", async () => {
    serve(range(1));
    renderSection();
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent(emailOf(1));

    expect(
      screen.getAllByTestId(
        /^(pending-invitations-status|confirmation-pending)$/,
      ),
    ).toHaveLength(1);
    expect(sectionStatus()).toBeEmptyDOMElement();
  });
});
