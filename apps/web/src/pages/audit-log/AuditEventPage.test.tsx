import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type {
  AuditChange,
  AuditEventDetail,
  AuditLogEventResponse,
} from "@nightwatch/api-contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchAuditActors, fetchAuditEvent } from "../../lib/api/audit-log";
import { PREFERENCES_KEY } from "../../lib/preferences";
import { AuditEventPage } from "./AuditEventPage";
import {
  makeDetail,
  ORG_A,
  renderRoute,
  setTenant,
  setTimeZone,
  type TestRole,
} from "./test-support";

vi.mock("../../lib/tenant/TenantProvider", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./test-support")).tenantMock(),
}));
vi.mock("../../lib/api/audit-log", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAuditEvent: vi.fn(),
  fetchAuditActors: vi.fn(),
}));

const eventMock = vi.mocked(fetchAuditEvent);
const actorsMock = vi.mocked(fetchAuditActors);

const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const PATH = "/organizations/:organizationId/audit-log/:eventId";
const respond = (event: AuditEventDetail): AuditLogEventResponse => ({
  organizationId: ORG_A,
  event,
});
const open = (
  event: AuditEventDetail | ApiError,
  role: TestRole = "owner",
  state?: unknown,
) => {
  setTenant(role);
  if (event instanceof ApiError) eventMock.mockRejectedValue(event);
  else eventMock.mockResolvedValue(respond(event));
  return renderRoute(<AuditEventPage />, {
    path: PATH,
    entry: `/organizations/${ORG_A}/audit-log/${EVENT_ID}`,
    state,
    extraRoutes: (
      <Route
        path="/organizations/:organizationId/audit-log"
        element={<p data-testid="returned-audit-list">list</p>}
      />
    ),
  });
};

beforeEach(() => {
  setTimeZone("Asia/Bangkok");
  actorsMock.mockResolvedValue({
    actors: [
      { userId: "user-1", displayName: "สมชาย ก.", membership: "current" },
    ],
  });
});
afterEach(() => {
  vi.resetAllMocks();
  localStorage.removeItem(PREFERENCES_KEY);
});

describe("AuditEventPage", () => {
  it("shows time with zone, id, actor and role at the time, action code, category and focuses the h1", async () => {
    open(makeDetail());
    await screen.findByTestId("audit-event-action");
    const title = screen.getByTestId("page-title");
    expect(title.tagName).toBe("H1");
    expect(title).not.toHaveAccessibleName("");
    expect(title).toHaveFocus();
    expect(screen.getByTestId("audit-event-time")).toHaveTextContent(
      "2026-10-02 14:00:55",
    );
    expect(screen.getByTestId("audit-event-id")).toHaveTextContent(EVENT_ID);
    expect(screen.getByTestId("audit-event-time-context")).toHaveTextContent(
      "2026-10-02 14:00:55 Asia/Bangkok",
    );
    expect(screen.getByTestId("audit-event-actor")).toHaveTextContent(
      "สมชาย ก.",
    );
    expect(screen.getByTestId("audit-event-action")).toHaveTextContent(
      "organization.monitor.pause",
    );
    expect(screen.getByTestId("audit-event-role")).toHaveAttribute(
      "data-value-code",
      "admin",
    );
    expect(screen.getByTestId("audit-event-role").textContent.trim()).not.toBe(
      "",
    );
    expect(screen.getByTestId("audit-event-category")).toHaveAttribute(
      "data-value-code",
      "monitor",
    );
    expect(
      screen.getByTestId("audit-event-category").textContent.trim(),
    ).not.toBe("");
  });

  it("renders no e-mail address or IP anywhere", async () => {
    const { container } = open(makeDetail());
    await screen.findByTestId("audit-event-action");
    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("links a live monitor target by name and shows a deleted one as text", async () => {
    const { unmount } = open(makeDetail());
    expect(
      await screen.findByTestId("audit-event-target-link"),
    ).toHaveAttribute(
      "href",
      "/organizations/" +
        ORG_A +
        "/monitors/99999999-9999-4999-8999-999999999999",
    );
    expect(screen.getByTestId("audit-event-target-link")).toHaveTextContent(
      "api-prod",
    );
    unmount();
    open(
      makeDetail({
        action: "organization.monitor.delete",
        target: {
          type: "monitor",
          monitorId: "99999999-9999-4999-8999-999999999999",
          displayName: null,
          deleted: true,
        },
      }),
    );
    expect(await screen.findByTestId("audit-event-target")).toHaveAttribute(
      "data-state-code",
      "deleted",
    );
    expect(
      screen.getByTestId("audit-event-target").textContent.trim(),
    ).not.toBe("");
    expect(
      screen.queryByTestId("audit-event-target-link"),
    ).not.toBeInTheDocument();
  });

  const memberEvent = makeDetail({
    action: "organization.member.role.update",
    category: "member",
    target: {
      type: "member",
      userId: "user-2",
      displayName: "ประภา ค.",
      membership: "current",
    },
    changes: [
      {
        field: "role",
        before: { kind: "value", value: "viewer" },
        after: { kind: "value", value: "admin" },
      },
    ],
  });

  it("links a member target for an admin and shows plain text for an auditor (a-1)", async () => {
    const { unmount } = open(memberEvent, "admin");
    expect(
      await screen.findByTestId("audit-event-target-link"),
    ).toHaveTextContent("ประภา ค.");
    expect(screen.getByTestId("audit-event-target-link")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/members`,
    );
    unmount();
    open(memberEvent, "auditor");
    expect(await screen.findByTestId("audit-event-target")).toHaveTextContent(
      "ประภา ค.",
    );
    expect(
      screen.queryByTestId("audit-event-target-link"),
    ).not.toBeInTheDocument();
  });

  it("shows a former member target without a name or link", async () => {
    open(
      makeDetail({
        category: "member",
        action: "organization.member.revoke",
        target: {
          type: "member",
          userId: "user-3",
          displayName: null,
          membership: "former",
        },
      }),
    );
    expect(await screen.findByTestId("audit-event-target")).toHaveAttribute(
      "data-state-code",
      "former",
    );
    expect(
      screen.getByTestId("audit-event-target").textContent.trim(),
    ).not.toBe("");
    expect(
      screen.queryByTestId("audit-event-target-link"),
    ).not.toBeInTheDocument();
  });

  it("shows an invitation with its role and public id and no link", async () => {
    open(
      makeDetail({
        category: "invitation",
        action: "organization.invitation.create",
        target: {
          type: "invitation",
          publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "auditor",
        },
        changes: [
          {
            field: "role",
            before: null,
            after: { kind: "value", value: "auditor" },
          },
        ],
      }),
    );
    expect(await screen.findByTestId("audit-event-target")).toHaveTextContent(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(screen.getByTestId("audit-event-target")).toHaveAttribute(
      "data-state-code",
      "auditor",
    );
    expect(
      screen.queryByTestId("audit-event-target-link"),
    ).not.toBeInTheDocument();
  });
});

describe("AuditEventPage changes", () => {
  const rowsOf = () =>
    within(screen.getByTestId("audit-event-changes-table")).getAllByTestId(
      "audit-change-row",
    );

  it("renders every AuditValue kind and role labels, with no value for secrets", async () => {
    const changes: AuditChange[] = [
      {
        field: "role",
        before: { kind: "value", value: "viewer" },
        after: { kind: "value", value: "admin" },
      },
      {
        field: "monitorAlertsEnabled",
        before: { kind: "value", value: true },
        after: { kind: "value", value: false },
      },
      {
        field: "timeoutSeconds",
        before: { kind: "value", value: 10 },
        after: { kind: "value", value: 30 },
      },
      {
        field: "name",
        before: { kind: "value", value: "old" },
        after: { kind: "value", value: "new" },
      },
      {
        field: "settingsChangedEnabled",
        before: { kind: "value", value: false },
        after: { kind: "value", value: true },
      },
      {
        field: "intervalSeconds",
        before: { kind: "value", value: 60 },
        after: { kind: "value", value: 300 },
      },
      {
        field: "expectedStatus",
        before: { kind: "value", value: "200" },
        after: { kind: "value", value: "2xx" },
      },
      {
        field: "queryParam",
        key: "token",
        before: null,
        after: { kind: "masked" },
      },
      {
        field: "secret",
        key: "Authorization",
        before: null,
        after: { kind: "secret_set" },
      },
      {
        field: "secret",
        key: "auth.token",
        before: { kind: "secret_set" },
        after: { kind: "changed" },
      },
      { field: "body", before: null, after: { kind: "changed" } },
      {
        field: "assertions",
        before: { kind: "value", value: "bodyContains ok" },
        after: null,
      },
    ];
    open(makeDetail({ action: "organization.monitor.update", changes }));
    await screen.findByTestId("audit-event-changes-table");
    expect(
      screen.getByTestId("audit-event-changes-table"),
    ).not.toHaveAccessibleName("");
    const records = rowsOf().map((row) => {
      const value = (id: string) => {
        const cell = within(row).getByTestId(id);
        const kind = cell.getAttribute("data-kind");
        const text = cell.textContent.trim();
        expect(text).not.toBe("");
        return {
          kind,
          value:
            cell.getAttribute("data-role") ??
            cell.getAttribute("data-boolean") ??
            (kind === "value" || kind === "masked" || kind === "absent"
              ? text
              : null),
        };
      };
      return {
        field: row.getAttribute("data-field"),
        key:
          within(row).queryByTestId("audit-change-key")?.textContent.trim() ??
          null,
        before: value("audit-change-before"),
        after: value("audit-change-after"),
      };
    });
    const v = (value: string) => ({ kind: "value", value });
    const absent = { kind: "absent", value: "—" };
    const set = { kind: "secret_set", value: null };
    const changed = { kind: "changed", value: null };
    const expected = [
      { field: "role", key: null, before: v("viewer"), after: v("admin") },
      {
        field: "monitorAlertsEnabled",
        key: null,
        before: v("true"),
        after: v("false"),
      },
      { field: "timeoutSeconds", key: null, before: v("10"), after: v("30") },
      { field: "name", key: null, before: v("old"), after: v("new") },
      {
        field: "settingsChangedEnabled",
        key: null,
        before: v("false"),
        after: v("true"),
      },
      { field: "intervalSeconds", key: null, before: v("60"), after: v("300") },
      { field: "expectedStatus", key: null, before: v("200"), after: v("2xx") },
      {
        field: "queryParam",
        key: "token",
        before: absent,
        after: { kind: "masked", value: "•••" },
      },
      { field: "secret", key: "Authorization", before: absent, after: set },
      { field: "secret", key: "auth.token", before: set, after: changed },
      { field: "body", key: null, before: absent, after: changed },
      {
        field: "assertions",
        key: null,
        before: v("bodyContains ok"),
        after: absent,
      },
    ];
    expect(records).toHaveLength(expected.length);
    expect(records).toEqual(expect.arrayContaining(expected));
  });

  it("wraps the changes table in a named, focusable region", async () => {
    open(
      makeDetail({
        changes: [
          {
            field: "name",
            before: { kind: "value", value: "a" },
            after: { kind: "value", value: "b" },
          },
        ],
      }),
    );
    const region = await screen.findByTestId("audit-event-changes-region");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(
      screen.getByTestId("audit-event-changes-table"),
    );
    expect(region).toHaveAttribute("role", "region");
    expect(region).not.toHaveAccessibleName("");
    region.focus();
    expect(region).toHaveFocus();
  });

  it("says so when an event has no changes", async () => {
    open(makeDetail());
    const empty = await screen.findByTestId("audit-event-no-changes");
    expect(empty.textContent.trim()).not.toBe("");
    expect(
      screen.queryByTestId("audit-event-changes-table"),
    ).not.toBeInTheDocument();
  });
});

describe("AuditEventPage export event (a-1, a-2)", () => {
  const exportEvent = (
    searchApplied: boolean,
    actorUserId: string | null = "user-1",
  ) =>
    makeDetail({
      category: "audit_log",
      action: "organization.audit-log.export",
      target: {
        type: "audit_export",
        exportId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        format: "csv",
      },
      exportScope: {
        format: "csv",
        from: "2026-09-25T17:00:00.000Z",
        to: "2026-10-03T07:02:00.000Z",
        categories: ["member"],
        actorUserId,
        searchApplied,
      },
    });

  it("shows the file as text, the scope section instead of changes and no search text", async () => {
    open(exportEvent(true));
    expect(await screen.findByTestId("audit-event-target")).toHaveTextContent(
      "CSV",
    );
    expect(
      screen.queryByTestId("audit-event-target-link"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-event-export-scope")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-event-changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-export-range")).toHaveTextContent(
      "2026-09-26 00:00:00 – 2026-10-03 14:02:00",
    );
    const scope = screen.getByTestId("audit-event-export-scope");
    await waitFor(() =>
      expect(within(scope).getByTestId("audit-export-actor")).toHaveTextContent(
        "สมชาย ก.",
      ),
    );
    expect(
      within(scope).getByTestId("audit-export-search-applied"),
    ).toHaveAttribute("data-value-code", "true");
    expect(within(scope).getByTestId("audit-export-category")).toHaveAttribute(
      "data-value-code",
      "member",
    );
    expect(within(scope).getByTestId("audit-export-format")).toHaveTextContent(
      "CSV",
    );
  });

  it("says no search applied, and a missing actor reads as a former member", async () => {
    open(exportEvent(false, "user-404"));
    await screen.findByTestId("audit-export-actor");
    await waitFor(() =>
      expect(screen.getByTestId("audit-export-actor")).toHaveAttribute(
        "data-state-code",
        "former",
      ),
    );
    expect(
      screen.getByTestId("audit-export-actor").textContent.trim(),
    ).not.toBe("");
    expect(screen.getByTestId("audit-export-search-applied")).toHaveAttribute(
      "data-value-code",
      "false",
    );
  });
});

describe("AuditEventPage states and navigation", () => {
  it("shows the shared not-found copy and a back link on a 404", async () => {
    open(new ApiError("AUDIT_EVENT_NOT_FOUND", "x", 404));
    const notFound = await screen.findByTestId("audit-event-not-found");
    expect(notFound.textContent.trim()).not.toBe("");
    expect(screen.getByTestId("audit-event-back")).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/audit-log`,
    );
  });

  it("offers a retry on another failure", async () => {
    const user = userEvent.setup();
    open(new ApiError("INTERNAL", "x", 500));
    expect(
      await screen.findByTestId("audit-event-error", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    eventMock.mockResolvedValue(respond(makeDetail()));
    expect(screen.getByTestId("audit-event-retry")).toBeEnabled();
    await user.click(screen.getByTestId("audit-event-retry"));
    expect(await screen.findByTestId("audit-event-action")).toHaveTextContent(
      "organization.monitor.pause",
    );
  });

  it("makes no request for a viewer", async () => {
    open(makeDetail(), "viewer");
    const denied = await screen.findByTestId("audit-denied-message");
    expect(denied.textContent.trim()).not.toBe("");
    expect(screen.getByTestId("page-title")).toHaveFocus();
    expect(screen.queryByTestId("audit-event-action")).not.toBeInTheDocument();
    expect(eventMock).not.toHaveBeenCalled();
    expect(actorsMock).not.toHaveBeenCalled();
  });

  it("drops the event when the server denies a later read", async () => {
    open(new ApiError("PERMISSION_DENIED", "x", 403));
    expect(await screen.findByTestId("audit-denied-title")).toHaveFocus();
    expect(screen.queryByTestId("audit-event-action")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      "organization.monitor.pause",
    );
  });

  it("goes back to the list with the original query string", async () => {
    const user = userEvent.setup();
    open(makeDetail(), "owner", {
      search: "?range=30d&page=2",
      eventId: EVENT_ID,
    });
    const back = await screen.findByTestId("audit-event-back");
    expect(back).toHaveAttribute(
      "href",
      `/organizations/${ORG_A}/audit-log?range=30d&page=2`,
    );
    await user.click(back);
    expect(
      await screen.findByTestId("returned-audit-list"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${ORG_A}/audit-log?range=30d&page=2`,
    );
  });
});
