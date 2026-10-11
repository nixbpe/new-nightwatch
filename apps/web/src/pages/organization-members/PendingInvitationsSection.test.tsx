import type {
  PendingInvitation,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchPendingInvitations } from "../../lib/api/invitations";
import { PendingInvitationsSection } from "./PendingInvitationsSection";

vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(),
}));
const fetchList = vi.mocked(fetchPendingInvitations);
const refreshMembershipContext = vi.fn(() => Promise.resolve(null));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  fetchList.mockReset();
  refreshMembershipContext.mockClear();
});

function publicId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function invitation(
  n: number,
  email: string,
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    publicId: publicId(n),
    email,
    role: "viewer",
    sentAt: "2026-09-30T08:00:00.000Z",
    expiresAt: "2026-10-02T08:00:00.000Z",
    expired: false,
    resendAvailableAt: "2026-09-30T08:05:00.000Z",
    manageable: true,
    ...overrides,
  };
}

/** Serves `total` rows `row-1@…` onward, `limit`/`offset` sliced like the API. */
function serve(total: number, activeCount = total) {
  fetchList.mockImplementation((organizationId, limit, offset) => {
    const invitations = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, index) =>
        invitation(
          offset + index + 1,
          `row-${String(offset + index + 1)}@example.test`,
        ),
    );
    return Promise.resolve({
      organizationId,
      invitations,
      activeCount,
      activeLimit: 100,
      page: { limit, offset, total },
    });
  });
}

function listOf(
  organizationId: string,
  invitations: PendingInvitation[],
  total = invitations.length,
  activeCount = total,
): PendingInvitationListResponse {
  return {
    organizationId,
    invitations,
    activeCount,
    activeLimit: 100,
    page: { limit: 50, offset: 0, total },
  };
}

function renderSection(organizationId = A) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const ui = (id: string, createdSignal = 0) => (
    <QueryClientProvider client={queryClient}>
      <PendingInvitationsSection
        key={id}
        organizationId={id}
        organizationName="Acme"
        refreshMembershipContext={refreshMembershipContext}
        createdSignal={createdSignal}
      />
    </QueryClientProvider>
  );
  const view = render(ui(organizationId));
  return {
    queryClient,
    container: view.container,
    switchTo: (id: string) => {
      view.rerender(ui(id));
    },
    announceCreated: () => {
      view.rerender(ui(organizationId, 1));
    },
  };
}

describe("PendingInvitationsSection", () => {
  it("returns to page 1 when the page announces a created invitation", async () => {
    serve(120);
    const user = userEvent.setup();
    const { announceCreated } = renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    await user.click(screen.getByTestId("pending-invitations-next"));
    await screen.findByTestId(`pending-invitation-row-${publicId(51)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");

    announceCreated();

    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeNull();
  });

  it("shows rows, n of 100, the total and an expired label that is text", async () => {
    fetchList.mockResolvedValue(
      listOf(
        A,
        [
          invitation(1, "live@example.test", { role: "admin" }),
          invitation(2, "old@example.test", {
            expired: true,
            expiresAt: "2026-09-28T08:00:00.000Z",
          }),
          invitation(3, "null@example.test", {
            expired: true,
            expiresAt: null,
          }),
        ],
        3,
        1,
      ),
    );
    renderSection();

    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("live@example.test");
    expect(screen.getByTestId("pending-invitations-count")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("pending-invitations-limit")).toHaveTextContent(
      "100",
    );
    expect(screen.getByTestId("pending-invitations-count")).toBeVisible();
    const rows = screen.getAllByTestId(/^pending-invitation-row-/);
    expect(rows).toHaveLength(3);
    const live = screen.getByTestId(`pending-invitation-row-${publicId(1)}`);
    const old = screen.getByTestId(`pending-invitation-row-${publicId(2)}`);
    const nullDate = screen.getByTestId(
      `pending-invitation-row-${publicId(3)}`,
    );
    expect(live).toBeVisible();
    expect(live).toHaveTextContent("live@example.test");
    expect(
      within(live).getByTestId("pending-invitation-sent-at"),
    ).toHaveAttribute("datetime", "2026-09-30T08:00:00.000Z");
    expect(
      within(live).getByTestId("pending-invitation-expires-at"),
    ).toHaveAttribute("datetime", "2026-10-02T08:00:00.000Z");
    expect(
      within(live).getByTestId("pending-invitation-role-admin"),
    ).toBeVisible();
    expect(within(live).queryByTestId("pending-invitation-expired")).toBeNull();
    expect(within(old).getByTestId("pending-invitation-expired")).toBeVisible();
    expect(
      within(nullDate).getByTestId("pending-invitation-expired"),
    ).toBeVisible();
    for (const field of ["email", "role", "sentAt", "expiresAt", "actions"]) {
      const column = screen.getByTestId(`pending-invitation-column-${field}`);
      expect(column).toHaveAttribute("scope", "col");
      expect(column).toHaveRole("columnheader");
      expect(column).toHaveAccessibleName();
    }
    expect(
      within(live).getByTestId(`invitation-cancel-${publicId(1)}`),
    ).toBeEnabled();
    expect(
      within(live).getByTestId(`invitation-resend-${publicId(1)}`),
    ).toBeEnabled();
    expect(screen.getByTestId("pending-invitations-total")).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-total").textContent.match(/\d+/g),
    ).toEqual(["3"]);
    expect(fetchList).toHaveBeenCalledWith(A, 50, 0);
  });

  it("renders no invitation id or link and exposes public id only in row/action hooks", async () => {
    fetchList.mockResolvedValue(
      listOf(A, [invitation(7, "someone@example.test")]),
    );
    const { container } = renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(7)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(7)}`),
    ).toHaveTextContent("someone@example.test");

    expect(container.querySelector("a, [href]")).toBeNull();
    const hooks =
      /^(pending-invitation-row|invitation-cancel|invitation-resend)-/;
    expect(
      within(container)
        .getAllByTestId(hooks)
        .map((node) => node.getAttribute("data-testid"))
        .sort(),
    ).toEqual(
      [
        `pending-invitation-row-${publicId(7)}`,
        `invitation-cancel-${publicId(7)}`,
        `invitation-resend-${publicId(7)}`,
      ].sort(),
    );
    const withoutPublicHooks = container.cloneNode(true) as HTMLElement;
    for (const node of within(withoutPublicHooks).getAllByTestId(hooks))
      node.removeAttribute("data-testid");
    expect(withoutPublicHooks.innerHTML).not.toContain(publicId(7));
    // The bearer invitation.id is a UUID, excluded by the list DTO. Only
    // the three exact verified public hook attributes above are removed.
    expect(withoutPublicHooks.innerHTML).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    );
  });

  it.each([
    { total: 49, next: false, rows: 49 },
    { total: 50, next: false, rows: 50 },
    { total: 51, next: true, rows: 50 },
  ])(
    "enables next page only past 50 rows ($total rows)",
    async ({ total, next, rows }) => {
      serve(total);
      renderSection();
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
      expect(
        screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
      ).toHaveTextContent("row-1@example.test");

      expect(screen.getAllByTestId(/^pending-invitation-row-/)).toHaveLength(
        rows,
      );
      expect(screen.getByTestId("pending-invitations-previous")).toBeDisabled();
      const nextButton = screen.getByTestId("pending-invitations-next");
      if (next) expect(nextButton).toBeEnabled();
      else expect(nextButton).toBeDisabled();
      expect(screen.getByTestId("pending-invitations-total")).toBeVisible();
      expect(
        screen
          .getByTestId("pending-invitations-total")
          .textContent.match(/\d+/g),
      ).toEqual([String(total)]);
    },
  );

  it("loads page two by keyboard without old rows, keeps n, then focuses the heading", async () => {
    serve(51, 40);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");

    const second = Promise.withResolvers<PendingInvitationListResponse>();
    fetchList.mockImplementationOnce(() => second.promise);
    const next = screen.getByTestId("pending-invitations-next");
    next.focus();
    await user.keyboard("{Enter}");

    expect(fetchList).toHaveBeenLastCalledWith(A, 50, 50);
    expect(screen.getByTestId("pending-invitations-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.getByTestId("pending-invitations-status"),
    ).not.toBeEmptyDOMElement();
    expect(
      await screen.findByTestId("pending-invitations-loading"),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeNull();
    expect(screen.queryByTestId("pending-invitations-table")).toBeNull();
    expect(screen.queryByTestId("pending-invitations-count")).toBeNull();

    second.resolve({
      organizationId: A,
      invitations: [invitation(51, "row-51@example.test")],
      activeCount: 40,
      activeLimit: 100,
      page: { limit: 50, offset: 50, total: 51 },
    });
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");
    expect(screen.getByTestId("pending-invitations-count")).toHaveTextContent(
      "40",
    );
    expect(screen.getByTestId("pending-invitations-limit")).toHaveTextContent(
      "100",
    );
    expect(screen.getByTestId("pending-invitations-heading")).toHaveFocus();
    expect(screen.getByTestId("pending-invitations-next")).toBeDisabled();
    expect(screen.getByTestId("pending-invitations-previous")).toBeEnabled();
  });

  it("focuses the heading when the page changes to a page already in the cache", async () => {
    serve(51, 40);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    await user.click(screen.getByTestId("pending-invitations-next"));
    await screen.findByTestId(`pending-invitation-row-${publicId(51)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");
    const callsBefore = fetchList.mock.calls.length;

    await user.click(screen.getByTestId("pending-invitations-previous"));

    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    expect(fetchList).toHaveBeenCalledTimes(callsBefore);
    expect(screen.getByTestId("pending-invitations-heading")).toHaveFocus();
  });

  it("loads the last page with rows when a refresh returns none past the end", async () => {
    serve(130);
    const user = userEvent.setup();
    const { queryClient } = renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    await user.click(screen.getByTestId("pending-invitations-next"));
    await screen.findByTestId(`pending-invitation-row-${publicId(51)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");
    await user.click(screen.getByTestId("pending-invitations-next"));
    await screen.findByTestId(`pending-invitation-row-${publicId(101)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(101)}`),
    ).toHaveTextContent("row-101@example.test");

    // Another session cancels rows: 60 remain, so offset 100 is past the end.
    serve(60);
    fetchList.mockImplementationOnce((organizationId, limit, offset) =>
      Promise.resolve({
        ...listOf(organizationId, [], 60),
        page: { limit, offset, total: 60 },
      }),
    );
    await queryClient.invalidateQueries({
      queryKey: ["tenant", "invitations", A],
    });

    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");
    expect(fetchList).toHaveBeenLastCalledWith(A, 50, 50);
    expect(screen.getByTestId("pending-invitations-total")).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-total").textContent.match(/\d+/g),
    ).toEqual(["60"]);
  });

  it("shows empty only when the total is 0", async () => {
    fetchList.mockResolvedValue(listOf(A, [], 0));
    renderSection();

    expect(
      await screen.findByTestId("pending-invitations-empty"),
    ).toBeVisible();
    expect(screen.queryByTestId("pending-invitations-table")).toBeNull();
    expect(screen.getByTestId("pending-invitations-count")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("pending-invitations-limit")).toHaveTextContent(
      "100",
    );
  });

  it("shows a retryable error instead of empty, then recovers", async () => {
    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    const user = userEvent.setup();
    renderSection();

    expect(
      await screen.findByTestId("pending-invitations-load-error"),
    ).toBeVisible();
    expect(screen.queryByTestId("pending-invitations-empty")).toBeNull();
    expect(screen.queryByTestId("pending-invitations-count")).toBeNull();

    fetchList.mockResolvedValueOnce(
      listOf(A, [invitation(1, "back@example.test")]),
    );
    await user.click(screen.getByTestId("pending-invitations-retry"));
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("back@example.test");
    expect(screen.queryByTestId("pending-invitations-load-error")).toBeNull();
  });

  it("focuses the heading and offers the previous page when the next page fails", async () => {
    serve(51);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");

    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await user.click(screen.getByTestId("pending-invitations-next"));

    expect(
      await screen.findByTestId("pending-invitations-load-error"),
    ).toBeVisible();
    expect(screen.getByTestId("pending-invitations-heading")).toHaveFocus();
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeNull();
    await user.tab();
    await user.tab();
    expect(screen.getByTestId("pending-invitations-previous")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    expect(screen.queryByTestId("pending-invitations-load-error")).toBeNull();
  });

  it("focuses the heading when a retry succeeds after a failed page change", async () => {
    serve(51);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");

    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await user.click(screen.getByTestId("pending-invitations-next"));
    expect(
      await screen.findByTestId("pending-invitations-load-error"),
    ).toBeVisible();

    await user.click(screen.getByTestId("pending-invitations-retry"));

    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");
    expect(screen.getByTestId("pending-invitations-heading")).toHaveFocus();
  });

  it("announces loading while a retry runs after a failed refresh", async () => {
    serve(2);
    const user = userEvent.setup();
    const { queryClient } = renderSection();
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");

    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await queryClient.invalidateQueries({
      queryKey: ["tenant", "invitations", A],
    });
    expect(
      await screen.findByTestId("pending-invitations-load-error"),
    ).toBeVisible();

    fetchList.mockReturnValueOnce(new Promise(() => undefined));
    await user.click(screen.getByTestId("pending-invitations-retry"));

    expect(screen.getByTestId("pending-invitations-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.getByTestId("pending-invitations-status"),
    ).not.toBeEmptyDOMElement();
    expect(
      await screen.findByTestId("pending-invitations-loading"),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("pending-invitations-load-error")).toBeNull();
  });

  it("announces loading and shows no rows while the first request is pending", async () => {
    fetchList.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect(screen.getByTestId("pending-invitations-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.getByTestId("pending-invitations-status"),
    ).not.toBeEmptyDOMElement();
    expect(
      await screen.findByTestId("pending-invitations-loading"),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("pending-invitations-table")).toBeNull();
    expect(screen.queryByTestId("pending-invitations-empty")).toBeNull();
  });

  it("keeps Organization B untouched by a late response for A", async () => {
    const lateA = Promise.withResolvers<PendingInvitationListResponse>();
    fetchList.mockImplementation((organizationId) =>
      organizationId === A
        ? lateA.promise
        : Promise.resolve(listOf(B, [invitation(2, "b-only@example.test")])),
    );
    const { switchTo } = renderSection(A);
    switchTo(B);
    expect(
      await screen.findByTestId(`pending-invitation-row-${publicId(2)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(2)}`),
    ).toHaveTextContent("b-only@example.test");

    lateA.resolve(listOf(A, [invitation(1, "a-only@example.test")], 9));
    await Promise.resolve();
    await Promise.resolve();

    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(2)}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(2)}`),
    ).toHaveTextContent("b-only@example.test");
    expect(
      screen.queryByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toBeNull();
    expect(screen.getByTestId("pending-invitations-total")).toBeVisible();
    expect(
      screen.getByTestId("pending-invitations-total").textContent.match(/\d+/g),
    ).toEqual(["1"]);
  });

  it("starts Organization B at offset 0 after paging in A", async () => {
    serve(120);
    const user = userEvent.setup();
    const { switchTo } = renderSection(A);
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    await user.click(screen.getByTestId("pending-invitations-next"));
    await screen.findByTestId(`pending-invitation-row-${publicId(51)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(51)}`),
    ).toHaveTextContent("row-51@example.test");

    switchTo(B);
    await screen.findByTestId(`pending-invitation-row-${publicId(1)}`);
    expect(
      screen.getByTestId(`pending-invitation-row-${publicId(1)}`),
    ).toHaveTextContent("row-1@example.test");
    expect(fetchList).toHaveBeenLastCalledWith(B, 50, 0);
  });
});
