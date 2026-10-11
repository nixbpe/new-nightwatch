import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import { auditScopeNote } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Route, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  fetchAuditActors,
  fetchAuditEvent,
  fetchAuditEvents,
  fetchAuditExports,
} from "../../lib/api/audit-log";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  claimContextPublication,
  createContextPublicationClaim,
  publishContextPublication,
} from "../../lib/queryClient";
import { PREFERENCES_KEY } from "../../lib/preferences";
import { AuditEventPage } from "./AuditEventPage";
import { AuditLogPage } from "./AuditLogPage";
import {
  makeDetail,
  makeEvent,
  makeList,
  ORG_A,
  ORG_B,
  renderRoute,
  setTenant,
  setTimeZone,
} from "./test-support";

vi.mock("../../lib/tenant/TenantProvider", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./test-support")).tenantMock(),
}));
vi.mock("../../lib/api/audit-log", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAuditEvents: vi.fn(),
  fetchAuditActors: vi.fn(),
  fetchAuditExports: vi.fn(),
  fetchAuditEvent: vi.fn(),
}));

const listMock = vi.mocked(fetchAuditEvents);
const actorsMock = vi.mocked(fetchAuditActors);

const PATH = "/organizations/:organizationId/audit-log";
const open = (
  search = "",
  state?: unknown,
  role: "owner" | "admin" | "auditor" | "viewer" = "owner",
) => {
  setTenant(role);
  return renderRoute(<AuditLogPage />, {
    path: PATH,
    entry: `/organizations/${ORG_A}/audit-log${search}`,
    state,
  });
};
const rows = () =>
  within(screen.getByTestId("audit-events-table")).getAllByTestId(
    /^audit-event-record-/,
  );
const row = (id: string) =>
  within(screen.getByTestId("audit-events-table")).getByTestId(
    `audit-event-record-${id}`,
  );
const pageNumbers = () =>
  screen
    .getByTestId("audit-page-summary")
    .textContent.match(/\d[\d,]*/g)
    ?.map((value) => Number(value.replaceAll(",", "")));
const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  setTimeZone("Asia/Bangkok");
  vi.mocked(fetchAuditExports).mockResolvedValue({
    exports: [],
    inProgress: false,
  });
  actorsMock.mockResolvedValue({
    actors: [
      { userId: "user-1", displayName: "สมชาย ก.", membership: "current" },
      { userId: "user-9", displayName: null, membership: "former" },
    ],
  });
});
afterEach(() => {
  vi.resetAllMocks();
  localStorage.removeItem(PREFERENCES_KEY);
});

describe("AuditLogPage table", () => {
  it("shows actual event time, zone, actor role and former-member redaction", async () => {
    listMock.mockResolvedValue(
      makeList([
        makeEvent(0),
        makeEvent(1, {
          actor: {
            userId: "user-9",
            displayName: "FORMER_PRIVATE_NAME",
            roleAtTime: "owner",
            membership: "former",
          },
        }),
      ]),
    );
    open();
    expect(await screen.findByTestId("audit-events-table")).toBeInTheDocument();
    expect(screen.getByTestId("audit-events-time-heading")).toHaveAttribute(
      "scope",
      "col",
    );
    expect(screen.getByTestId("audit-events-table")).not.toHaveAccessibleName(
      "",
    );
    expect(screen.getByTestId("audit-events-region")).toHaveAttribute(
      "tabindex",
      "0",
    );
    const first = row(makeEvent(0).id);
    const second = row(makeEvent(1).id);
    expect(within(first).getByTestId("audit-event-row-link")).toHaveTextContent(
      "2026-10-02 14:01:55",
    );
    expect(
      within(first).getByTestId("audit-event-row-link"),
    ).toHaveAccessibleName(/2026-10-02 14:01:55/);
    expect(
      within(first).getByTestId("audit-event-row-actor"),
    ).toHaveTextContent("สมชาย ก.");
    expect(within(first).getByTestId("audit-event-row-actor")).toHaveAttribute(
      "data-member-role",
      "admin",
    );
    expect(within(first).getByTestId("audit-event-row-actor")).toHaveAttribute(
      "data-membership",
      "current",
    );
    expect(within(first).getByTestId("audit-event-row-action")).toHaveAttribute(
      "data-action-code",
      "organization.monitor.pause",
    );
    expect(
      within(first).getByTestId("audit-event-row-action").textContent.trim(),
    ).not.toBe("");
    expect(first).toHaveAttribute("data-category", "monitor");
    expect(within(first).getByTestId("audit-event-row-link")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/audit-log/${makeEvent(0).id}`,
    );
    expect(
      rows().map((record) =>
        within(record).getByTestId("audit-event-row-link").textContent.trim(),
      ),
    ).toEqual(["2026-10-02 14:01:55", "2026-10-02 14:00:55"]);
    expect(first).toHaveTextContent("api-prod");
    expect(within(second).getByTestId("audit-event-row-actor")).toHaveAttribute(
      "data-membership",
      "former",
    );
    expect(within(second).getByTestId("audit-event-row-actor")).toHaveAttribute(
      "data-member-role",
      "owner",
    );
    expect(
      within(second).getByTestId("audit-event-row-actor").textContent.trim(),
    ).not.toBe("");
    expect(document.body.innerHTML).not.toContain("FORMER_PRIVATE_NAME");
    expect(rows()).toHaveLength(2);
    expect(screen.getByTestId("audit-time-zone")).toHaveTextContent(
      "Asia/Bangkok",
    );
    expect(screen.getByTestId("audit-total")).toHaveTextContent(/^2$/);
  });

  it("renders another zone with a different offset", async () => {
    setTimeZone("America/New_York");
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open();
    await screen.findByTestId("audit-events-table");
    expect(
      within(row(makeEvent(0).id)).getByTestId("audit-event-row-link"),
    ).toHaveTextContent(/^2026-10-02 03:01:55$/);
    expect(screen.getByTestId("audit-events-time-heading")).toHaveAttribute(
      "data-time-zone",
      "America/New_York",
    );
  });

  it("states retention and recording start as dates and shows the scope note in every state", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof makeList>>();
    listMock.mockReturnValue(pending.promise);
    open();
    expect(screen.getByTestId("audit-recording-scope")).toHaveTextContent(
      auditScopeNote("…"),
    );
    pending.resolve(makeList([makeEvent(0)]));
    expect(await screen.findByTestId("audit-retained-date")).toHaveTextContent(
      /^2025-10-03$/,
    );
    expect(screen.getByTestId("audit-recording-scope")).toHaveTextContent(
      auditScopeNote("2025-06-01"),
    );
    expect(screen.getByTestId("audit-loaded-at")).toHaveTextContent(
      /^14:02:11$/,
    );
  });

  it("shows the later of 365 days back and the recording start as the retained date", async () => {
    // Recording began 40 days before the load, so the log is retained from there, not from 365 days back.
    listMock.mockResolvedValue(
      makeList([makeEvent(0)], 1, {
        retainedFrom: "2026-08-24T00:00:00.000Z",
        recordingStartedAt: "2026-08-24T00:00:00.000Z",
      }),
    );
    open();
    await screen.findByTestId("audit-events-table");
    expect(screen.getByTestId("audit-retained-date")).toHaveTextContent(
      /^2026-08-24$/,
    );
    expect(screen.getByTestId("audit-recording-scope")).toHaveTextContent(
      auditScopeNote("2026-08-24"),
    );
  });

  it("fetches once on a cold load and never shows 0 while the count is unknown", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof makeList>>();
    listMock.mockReturnValue(pending.promise);
    open();
    expect(screen.getByTestId("audit-list-loading-status")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-total")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b0\b/);
    pending.resolve(makeList([makeEvent(0)]));
    await screen.findByTestId("audit-events-table");
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("announces the count in one status region", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)], 1234));
    open();
    await screen.findByTestId("audit-events-table");
    expect(screen.getByTestId("audit-list-count-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("audit-list-count-status")).toHaveTextContent(
      "1,234",
    );
  });
});

describe("AuditLogPage paging and filters", () => {
  const page1 = () =>
    makeList(
      Array.from({ length: 50 }, (_, i) => makeEvent(i)),
      120,
    );

  it("keeps asOf on a page change and drops it on a filter change", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page1());
    open();
    await screen.findByTestId("audit-events-table");
    expect(listMock.mock.calls[0]?.[1].asOf).toBeUndefined();
    expect(pageNumbers()).toEqual([120, 1, 3]);

    listMock.mockResolvedValue(makeList([makeEvent(60)], 120, {}, 50));
    await user.click(screen.getByTestId("audit-page-next"));
    await waitFor(() => {
      expect(location()).toMatch(/page=2/);
    });
    await waitFor(() => {
      expect(pageNumbers()).toEqual([120, 2, 3]);
    });
    const second = listMock.mock.calls.at(-1)?.[1];
    expect(second?.offset).toBe(50);
    expect(second?.asOf).toBe("2026-10-03T07:02:11.000Z");
    expect(screen.getByTestId("audit-list-title")).toHaveFocus();

    listMock.mockResolvedValue(makeList([makeEvent(2)], 1));
    await user.click(screen.getByTestId("audit-filter-category-member"));
    await waitFor(() => {
      expect(location()).toMatch(/categories=member/);
    });
    expect(location()).not.toMatch(/page=/);
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].categories).toEqual(["member"]);
    });
    const filtered = listMock.mock.calls.at(-1)?.[1];
    expect(filtered?.asOf).toBeUndefined();
    expect(filtered?.offset).toBe(0);
    expect(screen.getByTestId("audit-filter-category-member")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies the search on Enter, writes it to the URL and clears everything with ล้างตัวกรอง", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=30d&actor=user-1");
    await screen.findByTestId("audit-events-table");
    await user.type(
      screen.getByTestId("audit-filter-search"),
      "api-prod{Enter}",
    );
    await waitFor(() => {
      expect(location()).toContain("q=api-prod");
    });
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].q).toBe("api-prod");
    });
    expect(screen.getByTestId("audit-filter-summary")).toHaveAttribute(
      "data-range",
      "30d",
    );
    expect(screen.getByTestId("audit-filter-summary")).toHaveTextContent("30");
    expect(screen.getByTestId("audit-filter-summary")).toHaveTextContent(
      "api-prod",
    );

    await user.click(screen.getByTestId("audit-filter-clear"));
    await waitFor(() => {
      expect(location()).toBe(`/organizations/${ORG_A}/audit-log`);
    });
    expect(screen.getByTestId("audit-filter-search")).toHaveValue("");
    expect(screen.getByTestId("audit-filter-range-7d")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens a shared link with the same filters and ignores invalid URL values", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=24h&categories=member,invitation&actor=user-1&q=ada");
    await screen.findByTestId("audit-events-table");
    const params = listMock.mock.calls[0]?.[1];
    expect(params).toMatchObject({
      categories: ["member", "invitation"],
      actorUserId: "user-1",
      q: "ada",
    });
    expect(screen.getByTestId("audit-filter-range-24h")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("audit-filter-actor")).toHaveValue("user-1");
  });

  it("falls back to the default for an invalid range without an error", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=bogus&page=-3&categories=nope");
    await screen.findByTestId("audit-events-table");
    expect(screen.getByTestId("audit-filter-range-7d")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByTestId("audit-filter-range-error"),
    ).not.toBeInTheDocument();
  });

  it("loads the last page when the page is past the end", async () => {
    listMock.mockImplementation((_org, params) =>
      Promise.resolve(
        params.offset >= 120
          ? makeList([], 120, {}, params.offset)
          : makeList([makeEvent(1)], 120, {}, params.offset),
      ),
    );
    open("?page=9");
    await screen.findByTestId("audit-events-table");
    await waitFor(() => {
      expect(location()).toContain("page=3");
    });
    expect(listMock.mock.calls.map((call) => call[1].offset)).toEqual([
      400, 100,
    ]);
  });
});

describe("AuditLogPage custom range", () => {
  it("shows an error beside the field, keeps the values and sends no request for a reversed range", async () => {
    open("?range=custom&from=2026-10-02&to=2026-10-01");
    expect(
      await screen.findByTestId("audit-filter-range-error"),
    ).toHaveAttribute("data-error-code", "start-after-end");
    expect(screen.getByTestId("audit-filter-from")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByTestId("audit-filter-to")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByTestId("audit-filter-from")).toHaveValue("2026-10-02");
    expect(screen.getByTestId("audit-filter-to")).toHaveValue("2026-10-01");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("does not refetch on รีเฟรช while the range is invalid, and points the button at the error", async () => {
    const user = userEvent.setup();
    open("?range=custom&from=2026-10-02&to=2026-10-01");
    const error = await screen.findByTestId("audit-filter-range-error");
    const refresh = screen.getByTestId("audit-refresh");
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    expect(refresh).toHaveAttribute("aria-describedby", error.id);
    await user.click(refresh);
    await act(() => Promise.resolve());
    expect(listMock).not.toHaveBeenCalled();
  });

  it("rejects a start older than the retained date from the latest response and recovers when fixed", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open();
    await screen.findByTestId("audit-events-table");
    await user.click(screen.getByTestId("audit-filter-range-custom"));
    // Choosing "custom" without dates is a valid, open range and asks once.
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
    await screen.findByTestId("audit-events-table");
    await user.type(screen.getByTestId("audit-filter-from"), "2025-10-02");
    expect(
      await screen.findByTestId("audit-filter-range-error"),
    ).toHaveAttribute("data-error-code", "before-retention");
    expect(screen.getByTestId("audit-filter-range-error")).toHaveTextContent(
      "2025-10-03",
    );
    expect(screen.getByTestId("audit-filter-range-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await act(() => Promise.resolve());
    expect(listMock).toHaveBeenCalledTimes(2);
    const before = listMock.mock.calls.length;
    await user.clear(screen.getByTestId("audit-filter-from"));
    await user.type(screen.getByTestId("audit-filter-from"), "2025-10-04");
    await waitFor(() =>
      expect(
        screen.queryByTestId("audit-filter-range-error"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(before);
    });
    // Days are read in the preference zone: 2025-10-04 starts at 2025-10-03T17:00Z in Asia/Bangkok.
    expect(listMock.mock.calls.at(-1)?.[1].from).toBe(
      "2025-10-03T17:00:00.000Z",
    );
  });
});

describe("AuditLogPage same-tick filter changes (O1)", () => {
  it("keeps both dates when two changes happen before the next render", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=custom");
    await screen.findByTestId("audit-events-table");
    act(() => {
      fireEvent.change(screen.getByTestId("audit-filter-from"), {
        target: { value: "2026-09-30" },
      });
      fireEvent.change(screen.getByTestId("audit-filter-to"), {
        target: { value: "2026-10-02" },
      });
    });
    await waitFor(() => {
      expect(location()).toContain("from=2026-09-30");
    });
    expect(location()).toContain("to=2026-10-02");
    expect(screen.getByTestId("audit-filter-from")).toHaveValue("2026-09-30");
    expect(screen.getByTestId("audit-filter-to")).toHaveValue("2026-10-02");
  });

  it("keeps both dates when the router is still running a loader after the first change", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    setTenant("owner");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: PATH,
          // A slow loader keeps the URL of the last render stale for a while.
          loader: () =>
            new Promise((resolve) =>
              setTimeout(() => {
                resolve(null);
              }, 150),
            ),
          element: <AuditLogPage />,
        },
      ],
      { initialEntries: [`/organizations/${ORG_A}/audit-log?range=custom`] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("audit-events-table");
    fireEvent.change(screen.getByTestId("audit-filter-from"), {
      target: { value: "2026-09-30" },
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    fireEvent.change(screen.getByTestId("audit-filter-to"), {
      target: { value: "2026-10-02" },
    });
    await waitFor(() => {
      expect(router.state.location.search).toContain("to=2026-10-02");
    });
    expect(router.state.location.search).toContain("from=2026-09-30");
  });
});

describe("AuditLogPage states", () => {
  it("claims no data only when the actors list is empty too", async () => {
    listMock.mockResolvedValue(makeList([], 0));
    actorsMock.mockResolvedValue({ actors: [] });
    open();
    await screen.findByTestId("audit-empty");
    expect(screen.getByTestId("audit-recording-scope")).toHaveTextContent(
      auditScopeNote("2025-06-01"),
    );
    expect(screen.getByTestId("audit-total")).toHaveTextContent(/^0$/);
    expect(screen.queryByTestId("audit-no-matches")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-clear")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.queryByTestId("audit-no-matches-clear"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-empty")).toHaveAttribute(
      "data-total",
      "0",
    );
    expect(screen.getByTestId("audit-empty")).toHaveTextContent("2025-10-03");
  });

  it("reads an empty default 7 days as no match when events exist in retention", async () => {
    listMock.mockResolvedValue(makeList([], 0));
    open();
    expect(await screen.findByTestId("audit-no-matches")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-clear")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("audit-no-matches-clear")).toBeEnabled();
    expect(screen.getByTestId("audit-total")).toHaveTextContent(/^0$/);
    expect(screen.getByTestId("audit-no-matches")).toHaveAttribute(
      "data-total",
      "0",
    );
  });

  it("never claims no data while the actors list is loading or failed", async () => {
    listMock.mockResolvedValue(makeList([], 0));
    const pending = Promise.withResolvers<{ actors: [] }>();
    actorsMock.mockReturnValue(pending.promise);
    const view = open();
    expect(await screen.findByTestId("audit-no-matches")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-empty")).not.toBeInTheDocument();
    view.unmount();

    actorsMock.mockRejectedValue(new ApiError("INTERNAL", "x", 500));
    open();
    expect(await screen.findByTestId("audit-no-matches")).toBeInTheDocument();
    await act(() => Promise.resolve());
    expect(screen.queryByTestId("audit-empty")).not.toBeInTheDocument();
  });

  it("keeps the filters, hides the count and retries on a failed load", async () => {
    const user = userEvent.setup();
    listMock.mockRejectedValue(new ApiError("INTERNAL", "boom", 500));
    open("?categories=member");
    expect(
      await screen.findByTestId("audit-list-error", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("audit-total")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-category-member")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("audit-list-error-alert")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(
      screen.getByTestId("audit-list-error-alert").textContent.trim(),
    ).not.toBe("");
    expect(screen.getByTestId("audit-list-retry")).toBeEnabled();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    await user.click(screen.getByTestId("audit-list-retry"));
    await screen.findByTestId("audit-events-table");
    expect(
      within(row(makeEvent(0).id)).getByTestId("audit-event-row-link"),
    ).toHaveTextContent(/^2026-10-02 14:01:55$/);
    expect(
      within(row(makeEvent(0).id)).getByTestId("audit-event-row-target"),
    ).toHaveTextContent("api-prod");
  });

  it("refreshes without the pinned snapshot", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)], 120));
    open();
    await screen.findByTestId("audit-events-table");
    await user.click(screen.getByTestId("audit-page-next"));
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].asOf).toBeDefined();
    });

    await user.click(screen.getByTestId("audit-refresh"));
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].asOf).toBeUndefined();
    });
  });

  it("refreshes a custom range even though its request key does not change (C4-01)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=custom&from=2026-09-30&to=2026-10-02");
    await screen.findByTestId("audit-events-table");
    expect(listMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("audit-refresh"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
    await act(() => Promise.resolve());
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock.mock.calls[1]?.[1].asOf).toBeUndefined();
    expect(listMock.mock.calls[1]?.[1].from).toBe(
      listMock.mock.calls[0]?.[1].from,
    );
  });

  it("refetches the actor options on รีเฟรช so a removed member leaves the list", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    actorsMock.mockResolvedValue({
      actors: [
        { userId: "user-1", displayName: "สมชาย ก.", membership: "current" },
        { userId: "user-2", displayName: "มาลี ข.", membership: "current" },
      ],
    });
    open();
    await screen.findByTestId("audit-events-table");
    const names = () =>
      Array.from(
        screen.getByTestId<HTMLSelectElement>("audit-filter-actor").options,
      ).map((option) => option.textContent);
    await waitFor(() => {
      expect(names()).toContain("มาลี ข.");
    });
    expect(actorsMock).toHaveBeenCalledTimes(1);
    // user-2 was removed in the meantime: the server now lists them as a former member.
    actorsMock.mockResolvedValue({
      actors: [
        { userId: "user-1", displayName: "สมชาย ก.", membership: "current" },
        { userId: "user-2", displayName: null, membership: "former" },
      ],
    });
    await user.click(screen.getByTestId("audit-refresh"));
    await waitFor(() => {
      expect(actorsMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(names()).not.toContain("มาลี ข.");
    });
    expect(screen.getByTestId("audit-actor-user-2")).toHaveAttribute(
      "data-membership",
      "former",
    );
    expect(
      screen.getByTestId("audit-actor-user-2").textContent.trim(),
    ).not.toBe("");
  });

  it("keeps page 1 on the pinned snapshot once page 2 is open (C4-02)", async () => {
    const user = userEvent.setup();
    listMock.mockImplementation((_org, params) =>
      Promise.resolve(
        makeList(
          [makeEvent(params.offset)],
          120,
          { asOf: params.asOf ?? "2026-10-03T07:02:11.000Z" },
          params.offset,
        ),
      ),
    );
    open();
    await screen.findByTestId("audit-events-table");
    await user.click(screen.getByTestId("audit-page-next"));
    await waitFor(() => {
      expect(pageNumbers()).toEqual([120, 2, 3]);
    });
    await user.click(screen.getByTestId("audit-page-previous"));
    await waitFor(() => {
      expect(pageNumbers()).toEqual([120, 1, 3]);
    });
    const last = listMock.mock.calls.at(-1)?.[1];
    expect(last?.offset).toBe(0);
    expect(last?.asOf).toBe("2026-10-03T07:02:11.000Z");
  });
});

describe("AuditLogPage authorization", () => {
  it("makes no request for a viewer and renders only the denied card, focused", async () => {
    open("", undefined, "viewer");
    const heading = await screen.findByTestId("audit-denied-title");
    expect(screen.getByTestId("audit-denied")).toHaveAttribute(
      "data-denial-code",
      "PERMISSION_DENIED",
    );
    expect(
      screen.getByTestId("audit-denied-message").textContent.trim(),
    ).not.toBe("");
    expect(heading).toHaveFocus();
    expect(listMock).not.toHaveBeenCalled();
    expect(actorsMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("audit-events-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audit-export-open")).not.toBeInTheDocument();
  });

  it("clears rows and count when a later request is denied, invalidates the context and stops asking", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce(makeList([makeEvent(0)], 7));
    const view = open();
    await screen.findByTestId("audit-events-table");
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    listMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม", 403),
    );
    await user.click(screen.getByTestId("audit-filter-category-member"));
    const heading = await screen.findByTestId("audit-denied-title");
    expect(heading).toHaveFocus();
    expect(screen.queryByTestId("audit-events-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audit-total")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_CONTEXT_QUERY_KEY });
    expect(
      view.queryClient.getQueryCache().findAll({
        predicate: (q) =>
          q.queryKey[1] === "audit-log" && q.state.data !== undefined,
      }),
    ).toHaveLength(0);
    const calls = listMock.mock.calls.length;
    await act(() => Promise.resolve());
    expect(listMock.mock.calls.length).toBe(calls);
  });

  it("explains a non-member differently from a viewer", async () => {
    listMock.mockRejectedValue(new ApiError("MEMBERSHIP_DENIED", "x", 403));
    open();
    await screen.findByTestId("audit-denied-message");
    expect(screen.getByTestId("audit-denied")).toHaveAttribute(
      "data-denial-code",
      "MEMBERSHIP_DENIED",
    );
    expect(
      screen.getByTestId("audit-denied-message").textContent.trim(),
    ).not.toBe("");
  });
  // An auditor's read access and the absence of export controls are covered
  // by AuditExport.test.tsx's "does not render the button..." case.
});

describe("AuditLogPage Organization scope", () => {
  it("drops origin rows and ignores their late response after the active organization changes", async () => {
    const lateA = Promise.withResolvers<ReturnType<typeof makeList>>();
    listMock.mockReturnValue(lateA.promise);
    setTenant("owner", "owner");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const confirmed = {
      user: {
        id: "user-1",
        name: "Tester",
        email: "test@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [],
      lastActiveTenantId: ORG_A,
    };
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, confirmed);
    renderRoute(<AuditLogPage />, {
      path: PATH,
      entry: `/organizations/${ORG_A}/audit-log`,
      queryClient,
    });
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim, "bootstrap");
      publishContextPublication(queryClient, claim, {
        ...confirmed,
        lastActiveTenantId: ORG_B,
      });
    });
    lateA.resolve(makeList([makeEvent(0)], 1));
    await act(() => Promise.resolve());
    expect(screen.queryByTestId("audit-events-table")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("สมชาย ก.");
    expect(screen.queryByTestId("audit-total")).not.toBeInTheDocument();
  });

  it("keeps the page on its own Organization when a deep link names one that is not active", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    setTenant("owner", "owner");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
      user: {
        id: "user-1",
        name: "Tester",
        email: "test@example.test",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [],
      lastActiveTenantId: ORG_B,
    });
    renderRoute(<AuditLogPage />, {
      path: PATH,
      entry: `/organizations/${ORG_A}/audit-log`,
      queryClient,
    });
    expect(await screen.findByTestId("audit-events-table")).toBeInTheDocument();
  });
});

describe("AuditLogPage return from detail", () => {
  it("comes back to the same snapshot, page and row after opening an event", async () => {
    const user = userEvent.setup();
    const clickedEvent = makeEvent(61);
    const pageTwo = [makeEvent(60), clickedEvent];
    listMock.mockImplementation((_org, params) =>
      Promise.resolve(
        params.offset === 0
          ? makeList(
              Array.from({ length: 50 }, (_, i) => makeEvent(i)),
              52,
            )
          : makeList(pageTwo, 52, {}, params.offset),
      ),
    );
    vi.mocked(fetchAuditEvent).mockResolvedValue({
      organizationId: ORG_A,
      event: makeDetail({ ...clickedEvent, changes: [] }),
    });
    setTenant("owner");
    renderRoute(<AuditLogPage />, {
      path: PATH,
      entry: `/organizations/${ORG_A}/audit-log`,
      extraRoutes: (
        <Route
          path="/organizations/:organizationId/audit-log/:eventId"
          element={<AuditEventPage />}
        />
      ),
    });
    await screen.findByTestId("audit-events-table");
    const firstFrom = listMock.mock.calls[0]?.[1].from;
    await user.click(screen.getByTestId("audit-page-next"));
    await waitFor(() => {
      expect(pageNumbers()).toEqual([52, 2, 2]);
    });
    await user.click(
      within(row(clickedEvent.id)).getByTestId("audit-event-row-link"),
    );
    await screen.findByTestId("audit-event-action");
    const callsBefore = listMock.mock.calls.length;
    await user.click(screen.getByTestId("audit-event-back"));

    await screen.findByTestId("audit-events-table");
    expect(location()).toBe(`/organizations/${ORG_A}/audit-log?page=2`);
    const back = listMock.mock.calls.slice(callsBefore);
    expect(back).toHaveLength(1);
    expect(back[0]?.[1]).toMatchObject({
      offset: 50,
      asOf: "2026-10-03T07:02:11.000Z",
      from: firstFrom,
    });
    await waitFor(() => {
      expect(
        within(row(clickedEvent.id)).getByTestId("audit-event-row-link"),
      ).toHaveFocus();
    });
  });
});

describe("AuditLogPage focus", () => {
  it("returns focus to the row link the user came from", async () => {
    const returnedEvent = makeEvent(1);
    const events = [makeEvent(0), returnedEvent];
    listMock.mockResolvedValue(makeList(events));
    open("", { eventId: returnedEvent.id });
    await screen.findByTestId("audit-events-table");
    await waitFor(() =>
      expect(
        within(row(returnedEvent.id)).getByTestId("audit-event-row-link"),
      ).toHaveFocus(),
    );
  });

  it("falls back to the table heading when that row is gone", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("", { eventId: "missing" });
    await screen.findByTestId("audit-events-table");
    await waitFor(() =>
      expect(screen.getByTestId("audit-list-title")).toHaveFocus(),
    );
  });
});
