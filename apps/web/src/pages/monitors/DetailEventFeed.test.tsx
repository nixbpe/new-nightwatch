import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type {
  LastResponse,
  MonitorEvent,
  MonitorEventsResponse,
  MonitorIncidentsResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import {
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorEvents,
  fetchMonitorIncidents,
  fetchMonitorLastResponse,
  monitorQueryKeys,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
} from "../../lib/api/monitors";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  A,
  context,
  detail,
  noChecks,
  noIncidents,
  noResponseTimes,
  MONITOR_ID,
  NOW,
  renderDetail,
} from "./detail-test-support";
import { RecentEventsCard } from "./RecentEventsCard";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Short enough to observe polling, and its absence, inside a test.
  MONITOR_REFETCH_INTERVAL_MS: 60,
  fetchMonitorDetail: vi.fn(),
  fetchMonitorEvents: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
}));

const feedMock = vi.mocked(fetchMonitorEvents);
const lastResponseMock = vi.mocked(fetchMonitorLastResponse);

const INCIDENT = "00000000-0000-4000-8000-000000000001";
const HEADER_ID = "5c2f0a86-7d0e-4c58-9f4e-1a2b3c4d5e6f";
const AT = "2026-09-30T07:30:00.000Z";
const nonempty: unknown = expect.stringMatching(/\S/);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  feedMock.mockResolvedValue(feed([]));
  lastResponseMock.mockResolvedValue({ response: null });
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function feed(
  events: MonitorEvent[],
  total = events.length,
): MonitorEventsResponse {
  return { events, page: { limit: 20, offset: 0, total } };
}

async function feedSection() {
  return screen.findByTestId("monitor-event-feed");
}

async function rows(section: HTMLElement) {
  const list = await within(section).findByTestId("monitor-event-feed-list");
  expect(list.tagName).toBe("OL");
  expect(list).toHaveAccessibleName(/\S/);
  return within(list).queryAllByTestId(/^monitor-event-record-/);
}

function eventRecord(item: HTMLElement) {
  const text = item.textContent;
  const time = within(item).getByTestId("monitor-event-time");
  expect(time).toHaveAttribute("dateTime", AT);
  expect(time).toHaveTextContent(
    new Date(AT).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  );
  expect(within(item).getByTestId("monitor-event-title")).toHaveTextContent(
    /\S/,
  );
  const clone = item.cloneNode(true) as HTMLElement;
  within(clone).getByTestId("monitor-event-title").remove();
  within(clone).getByTestId("monitor-event-time").remove();
  expect(clone.textContent.trim().length > 0).toBe(
    item.getAttribute("data-reason") !== null ||
      text.includes("HTTP") ||
      text.includes("ms") ||
      item.getAttribute("data-event-kind") === "incident_closed",
  );
  return {
    id: item.getAttribute("data-testid")?.slice("monitor-event-record-".length),
    kind: item.getAttribute("data-event-kind"),
    reason: item.getAttribute("data-reason"),
    tls: item.getAttribute("data-tls-reason"),
    incident: item.getAttribute("data-incident-id"),
    http: text.match(/HTTP (\d+)/)?.[1] ?? null,
    ms: text.match(/([\d,]+) ms/)?.[1] ?? null,
    duration: text.match(/(\d+ นาที)/)?.[1] ?? null,
  };
}
function actorRecord(item: HTMLElement) {
  const clone = item.cloneNode(true) as HTMLElement;
  within(clone).getByTestId("monitor-event-time").remove();
  within(clone).getByTestId("monitor-event-title").remove();
  const text = clone.textContent.trim();
  const actor = text.replace(/^\S+\s+/, "");
  return {
    id: item.getAttribute("data-testid")?.slice("monitor-event-record-".length),
    kind: item.getAttribute("data-event-kind"),
    actorKind: item.getAttribute("data-actor-kind"),
    actor,
  };
}
function changeRecords(item: HTMLElement) {
  return within(item)
    .getAllByTestId("monitor-event-change")
    .map((line) => {
      const kind = line.getAttribute("data-kind");
      const tail = line.textContent
        .slice(line.textContent.indexOf(":") + 1)
        .trim();
      expect(tail).toMatch(/\S/);
      if (kind === "value") {
        const pair = tail.match(/^\S+\s+(.+?)\s+\S+\s+(.+)$/);
        expect(pair).not.toBeNull();
        return {
          field: line.getAttribute("data-field"),
          kind,
          beforeKind: line.getAttribute("data-before-kind"),
          afterKind: line.getAttribute("data-after-kind"),
          before: pair?.[1],
          after: pair?.[2],
        };
      }
      return {
        field: line.getAttribute("data-field"),
        kind,
        action: line.getAttribute("data-action-code"),
        description: tail,
      };
    });
}
function responseHeaderRecords(section: HTMLElement) {
  return within(section)
    .queryAllByTestId("monitor-response-header")
    .map((row) => {
      const name = within(row).getByTestId("monitor-response-header-name");
      const value = within(row).getByTestId("monitor-response-header-value");
      expect(name.tagName).toBe("TH");
      expect(name).toHaveAttribute("scope", "row");
      expect(value.tagName).toBe("TD");
      return {
        name: name.textContent,
        value: value.textContent,
        redacted: row.getAttribute("data-redacted"),
      };
    });
}

describe("Event feed rows", () => {
  it("words every event kind without colour or arrows", async () => {
    feedMock.mockResolvedValue(
      feed([
        {
          id: "event:1",
          at: AT,
          kind: "check_failed",
          failureReason: "tls_invalid",
          tlsReason: "expired",
          httpStatus: null,
          responseTimeMs: null,
        },
        {
          id: "event:2",
          at: AT,
          kind: "check_failed",
          failureReason: "http_status",
          tlsReason: null,
          httpStatus: 503,
          responseTimeMs: 1200,
        },
        {
          id: "event:3",
          at: AT,
          kind: "check_failed",
          failureReason: null,
          tlsReason: null,
          httpStatus: null,
          responseTimeMs: null,
        },
        {
          id: "incident:a:opened",
          at: AT,
          kind: "incident_opened",
          incidentId: INCIDENT,
          reason: "timeout",
          httpStatus: null,
        },
        {
          id: "incident:a:closed",
          at: AT,
          kind: "incident_closed",
          incidentId: INCIDENT,
          endReason: "recovered",
          durationSeconds: 720,
          httpStatus: 200,
          responseTimeMs: 182,
        },
        {
          id: "incident:b:closed",
          at: AT,
          kind: "incident_closed",
          incidentId: INCIDENT,
          endReason: "recovered",
          durationSeconds: 60,
          httpStatus: null,
          responseTimeMs: null,
        },
        {
          id: "incident:c:closed",
          at: AT,
          kind: "incident_closed",
          incidentId: INCIDENT,
          endReason: "paused_by_user",
          durationSeconds: 600,
          httpStatus: null,
          responseTimeMs: null,
        },
      ]),
    );
    renderDetail();
    const items = await rows(await feedSection());
    expect(items.map(eventRecord)).toEqual([
      {
        id: "event:1",
        kind: "check_failed",
        reason: "tls_invalid",
        tls: "expired",
        incident: null,
        http: null,
        ms: null,
        duration: null,
      },
      {
        id: "event:2",
        kind: "check_failed",
        reason: "http_status",
        tls: null,
        incident: null,
        http: "503",
        ms: "1,200",
        duration: null,
      },
      {
        id: "event:3",
        kind: "check_failed",
        reason: null,
        tls: null,
        incident: null,
        http: null,
        ms: null,
        duration: null,
      },
      {
        id: "incident:a:opened",
        kind: "incident_opened",
        reason: "timeout",
        tls: null,
        incident: INCIDENT,
        http: null,
        ms: null,
        duration: null,
      },
      {
        id: "incident:a:closed",
        kind: "incident_closed",
        reason: "recovered",
        tls: null,
        incident: INCIDENT,
        http: "200",
        ms: "182",
        duration: "12 นาที",
      },
      {
        id: "incident:b:closed",
        kind: "incident_closed",
        reason: "recovered",
        tls: null,
        incident: INCIDENT,
        http: null,
        ms: null,
        duration: "1 นาที",
      },
      {
        id: "incident:c:closed",
        kind: "incident_closed",
        reason: "paused_by_user",
        tls: null,
        incident: INCIDENT,
        http: null,
        ms: null,
        duration: "10 นาที",
      },
    ]);
  });

  it("names the actor of pause, resume and config rows in all five forms", async () => {
    feedMock.mockResolvedValue(
      feed([
        {
          id: "event:1",
          at: AT,
          kind: "paused",
          actor: { kind: "member", userId: "u1", displayName: "Somchai" },
        },
        {
          id: "event:2",
          at: AT,
          kind: "resumed",
          actor: { kind: "member_hidden" },
        },
        {
          id: "event:3",
          at: AT,
          kind: "config_changed",
          actor: { kind: "former_member" },
          changes: [],
        },
        { id: "event:4", at: AT, kind: "paused", actor: { kind: "deleted" } },
        {
          id: "event:5",
          at: AT,
          kind: "resumed",
          actor: { kind: "unrecorded" },
        },
      ]),
    );
    renderDetail();
    const actors = (await rows(await feedSection())).map(actorRecord);
    expect(actors).toEqual([
      { id: "event:1", kind: "paused", actorKind: "member", actor: "Somchai" },
      {
        id: "event:2",
        kind: "resumed",
        actorKind: "member_hidden",
        actor: nonempty,
      },
      {
        id: "event:3",
        kind: "config_changed",
        actorKind: "former_member",
        actor: nonempty,
      },
      {
        id: "event:4",
        kind: "paused",
        actorKind: "deleted",
        actor: nonempty,
      },
      { id: "event:5", kind: "resumed", actorKind: "unrecorded", actor: "" },
    ]);
    expect(
      new Set(
        actors.filter((x) => x.actorKind !== "unrecorded").map((x) => x.actor),
      ).size,
    ).toBe(4);
  });

  it("lists changes with ก่อน and หลัง, secrets as actions only, and an empty list as the bare row", async () => {
    vi.mocked(fetchMonitorDetail).mockResolvedValue({
      monitor: detail({
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
      }),
    });
    feedMock.mockResolvedValue(
      feed([
        {
          id: "event:1",
          at: AT,
          kind: "config_changed",
          actor: { kind: "member", userId: "u1", displayName: "Somchai" },
          changes: [
            { field: "timeoutSeconds", kind: "value", before: 10, after: 30 },
            {
              field: "headers.Accept",
              kind: "value",
              before: null,
              after: "application/json",
            },
            {
              field: "queryParams.page",
              kind: "value",
              before: "•••",
              after: "•••",
            },
            { field: "body", kind: "changed" },
            { field: "assertions", kind: "changed" },
            { field: "auth.token", kind: "secret", action: "replaced" },
            { field: `header.${HEADER_ID}`, kind: "secret", action: "set" },
            {
              field: "header.99999999-9999-4999-8999-999999999999",
              kind: "secret",
              action: "deleted",
            },
            { field: "headers.X-Token", kind: "secret", action: "set" },
          ],
        },
        {
          id: "event:2",
          at: AT,
          kind: "config_changed",
          actor: { kind: "unrecorded" },
          changes: [],
        },
      ]),
    );
    renderDetail();
    const section = await feedSection();
    await rows(section);
    const withChanges = within(section).getByTestId(
      "monitor-event-record-event:1",
    );
    const bare = within(section).getByTestId("monitor-event-record-event:2");
    expect(changeRecords(withChanges)).toEqual(
      expect.arrayContaining([
        {
          field: "timeoutSeconds",
          kind: "value",
          beforeKind: "number",
          afterKind: "number",
          before: "10",
          after: "30",
        },
        {
          field: "headers.Accept",
          kind: "value",
          beforeKind: "null",
          afterKind: "string",
          before: nonempty,
          after: "application/json",
        },
        {
          field: "queryParams.page",
          kind: "value",
          beforeKind: "string",
          afterKind: "string",
          before: "•••",
          after: "•••",
        },
        {
          field: "body",
          kind: "changed",
          action: null,
          description: nonempty,
        },
        {
          field: "assertions",
          kind: "changed",
          action: null,
          description: nonempty,
        },
        {
          field: "auth.token",
          kind: "secret",
          action: "replaced",
          description: nonempty,
        },
        {
          field: `header.${HEADER_ID}`,
          kind: "secret",
          action: "set",
          description: nonempty,
        },
        {
          field: "header.99999999-9999-4999-8999-999999999999",
          kind: "secret",
          action: "deleted",
          description: nonempty,
        },
        {
          field: "headers.X-Token",
          kind: "secret",
          action: "set",
          description: nonempty,
        },
      ]),
    );
    expect(changeRecords(withChanges)).toHaveLength(9);
    expect(withChanges).toHaveTextContent("Accept");
    expect(withChanges).toHaveTextContent("page");
    expect(withChanges).toHaveTextContent("X-Api-Key");
    expect(withChanges).toHaveTextContent("X-Token");
    const secrets = changeRecords(withChanges).filter(
      (x) => x.kind === "secret",
    );
    expect(new Set(secrets.map((x) => x.description)).size).toBe(3);
    expect(within(bare).queryAllByTestId("monitor-event-change")).toEqual([]);
    expect(bare).toHaveAttribute("data-event-kind", "config_changed");
    expect(within(bare).getByTestId("monitor-event-title")).toHaveTextContent(
      /\S/,
    );
  });

  it("shows Thai labels and before-and-after values for all four alert settings, with toggles shown as เปิด or ปิด", async () => {
    feedMock.mockResolvedValue(
      feed([
        {
          id: "event:alerts",
          at: AT,
          kind: "config_changed",
          actor: { kind: "member", userId: "u1", displayName: "Somchai" },
          changes: [
            {
              field: "alerts.failureThreshold",
              kind: "value",
              before: 2,
              after: 3,
            },
            {
              field: "alerts.downEnabled",
              kind: "value",
              before: "enabled",
              after: "disabled",
            },
            {
              field: "alerts.sslEnabled",
              kind: "value",
              before: "disabled",
              after: "enabled",
            },
            {
              field: "alerts.sslCautionDays",
              kind: "value",
              before: 30,
              after: 10,
            },
          ],
        },
      ]),
    );
    renderDetail();
    const section = await feedSection();
    await rows(section);
    const withChanges = within(section).getByTestId(
      "monitor-event-record-event:alerts",
    );
    expect(changeRecords(withChanges)).toEqual(
      expect.arrayContaining([
        {
          field: "alerts.failureThreshold",
          kind: "value",
          beforeKind: "number",
          afterKind: "number",
          before: "2",
          after: "3",
        },
        {
          field: "alerts.downEnabled",
          kind: "value",
          beforeKind: "string",
          afterKind: "string",
          before: "เปิด",
          after: "ปิด",
        },
        {
          field: "alerts.sslEnabled",
          kind: "value",
          beforeKind: "string",
          afterKind: "string",
          before: "ปิด",
          after: "เปิด",
        },
        {
          field: "alerts.sslCautionDays",
          kind: "value",
          beforeKind: "number",
          afterKind: "number",
          before: "30",
          after: "10",
        },
      ]),
    );
    expect(changeRecords(withChanges)).toHaveLength(4);
  });
});

describe("Event feed states", () => {
  it("shows loading, then the empty text", async () => {
    let release: (value: MonitorEventsResponse) => void = () => undefined;
    feedMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderDetail();
    expect(
      await screen.findByTestId("monitor-event-feed-loading"),
    ).toHaveTextContent(/\S/);
    release(feed([]));
    expect(
      await screen.findByTestId("monitor-event-feed-empty"),
    ).toHaveTextContent(/\S/);
  });

  it("shows an error with retry that stays inside the card", async () => {
    feedMock.mockRejectedValueOnce(new ApiError("INTERNAL", "boom", 500));
    renderDetail();
    const section = await feedSection();
    expect(
      await within(section).findByTestId("monitor-event-feed-error"),
    ).toHaveTextContent(/\S/);
    expect(screen.getByTestId("monitor-detail-title")).toHaveTextContent(/\S/);
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(section).getByTestId("monitor-event-feed-retry"));
    expect(
      await within(section).findByTestId("monitor-event-feed-empty"),
    ).toHaveTextContent(/\S/);
  });

  it("keeps the rows and warns when a refetch fails after data arrived", async () => {
    feedMock.mockResolvedValue(
      feed([
        {
          id: "event:1",
          at: AT,
          kind: "paused",
          actor: { kind: "member_hidden" },
        },
      ]),
    );
    const { queryClient } = renderDetail();
    const section = await feedSection();
    await rows(section);
    await waitFor(() => {
      expect(feedMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(await rows(section)).toHaveLength(1);
    feedMock.mockRejectedValue(new ApiError("INTERNAL", "boom", 500));
    await queryClient.refetchQueries({ queryKey: ["tenant", "monitors"] });
    expect(
      await within(section).findByTestId("monitor-event-feed-refresh-error"),
    ).toHaveTextContent(/\S/);
    expect(await rows(section)).toHaveLength(1);
  });

  it("pages through the feed with the existing pagination", async () => {
    feedMock.mockResolvedValue(
      feed(
        [
          {
            id: "event:1",
            at: AT,
            kind: "paused",
            actor: { kind: "member_hidden" },
          },
        ],
        45,
      ),
    );
    renderDetail();
    const section = await feedSection();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(await within(section).findByTestId("monitor-event-feed-next"));
    await waitFor(() => {
      expect(feedMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { limit: 20, offset: 20 },
      );
    });
  });
});

function eventRows(count: number): MonitorEvent[] {
  return Array.from({ length: count }, (_, index): MonitorEvent => ({
    id: `event:${String(index)}`,
    at: AT,
    kind: "paused",
    actor: { kind: "member_hidden" },
  }));
}

function incidentRows(count: number): MonitorIncidentsResponse["incidents"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    startedAt: AT,
    endedAt: AT,
    durationSeconds: 60,
    startReason: "http_status",
    startHttpStatus: 503,
    endReason: "recovered" as const,
  }));
}

// AC-86: the pager shows only when there is another page to reach or a page to return from.
describe("Pagination threshold of the feed and the incidents", () => {
  const cases = [
    [1, 1, false],
    [20, 20, false],
    [21, 20, true],
  ] as const;

  async function incidentsSection() {
    return screen.findByTestId("monitor-incidents");
  }

  it.each(cases)(
    "feed with a total of %i (%i rows on the page) shows its pager: %s",
    async (total, rowCount, pager) => {
      feedMock.mockResolvedValue(feed(eventRows(rowCount), total));
      renderDetail();
      const section = await feedSection();
      expect(await rows(section)).toHaveLength(rowCount);
      const nav = within(section).queryByTestId(
        "monitor-event-feed-pagination",
      );
      if (pager) {
        expect(
          within(section)
            .getByTestId("monitor-event-feed-summary")
            .textContent.match(/\d+/g)
            ?.map(Number),
        ).toEqual([1, rowCount, total]);
        expect(
          within(section).getByTestId("monitor-event-feed-next"),
        ).toBeEnabled();
      } else {
        expect(nav).toBeNull();
        expect(
          within(section).queryByTestId("monitor-event-feed-next"),
        ).toBeNull();
      }
    },
  );

  it.each(cases)(
    "incidents with a total of %i (%i rows on the page) shows its pager: %s",
    async (total, rowCount, pager) => {
      vi.mocked(fetchMonitorIncidents).mockResolvedValue({
        incidents: incidentRows(rowCount),
        page: { limit: 20, offset: 0, total },
      });
      renderDetail();
      const section = await incidentsSection();
      await within(section).findByTestId("monitor-incidents-region");
      const nav = within(section).queryByTestId("monitor-incidents-pagination");
      if (pager) {
        expect(
          within(section)
            .getByTestId("monitor-incidents-summary")
            .textContent.match(/\d+/g)
            ?.map(Number),
        ).toEqual([1, rowCount, total]);
      } else {
        expect(nav).toBeNull();
      }
    },
  );

  it("keeps the way back on a later page after the total shrank to one page, then hides the pager at offset 0", async () => {
    let shrunk = false;
    feedMock.mockImplementation((_org, _monitor, page) =>
      Promise.resolve(
        page.offset === 20
          ? // The rows beyond the first page went away while the reader was on page 2.
            { events: [], page: { limit: 20, offset: 20, total: 15 } }
          : page.offset === 0 && shrunk
            ? feed(eventRows(15), 15)
            : feed(eventRows(20), 45),
      ),
    );
    renderDetail();
    const section = await feedSection();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(
      await within(section).findByTestId("monitor-event-feed-next"),
    );

    const nav = await within(section).findByTestId(
      "monitor-event-feed-pagination",
    );
    const previous = within(nav).getByTestId("monitor-event-feed-previous");
    expect(previous).toBeEnabled();
    expect(within(nav).getByTestId("monitor-event-feed-next")).toBeDisabled();

    shrunk = true;
    await user.click(previous);
    expect(await rows(section)).toHaveLength(15);
    await waitFor(() => {
      expect(
        within(section).queryByTestId("monitor-event-feed-pagination"),
      ).toBeNull();
    });
  });

  it("keeps the way back on a later page of the incidents after the total shrank", async () => {
    let shrunk = false;
    vi.mocked(fetchMonitorIncidents).mockImplementation(
      (_org, _monitor, page) =>
        Promise.resolve(
          page.offset === 20
            ? { incidents: [], page: { limit: 20, offset: 20, total: 15 } }
            : shrunk
              ? {
                  incidents: incidentRows(15),
                  page: { limit: 20, offset: 0, total: 15 },
                }
              : {
                  incidents: incidentRows(20),
                  page: { limit: 20, offset: 0, total: 45 },
                },
        ),
    );
    renderDetail();
    const section = await incidentsSection();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(
      await within(section).findByTestId("monitor-incidents-next"),
    );

    const nav = await within(section).findByTestId(
      "monitor-incidents-pagination",
    );
    const previous = within(nav).getByTestId("monitor-incidents-previous");
    expect(previous).toBeEnabled();
    expect(within(nav).getByTestId("monitor-incidents-next")).toBeDisabled();

    shrunk = true;
    await user.click(previous);
    await within(section).findByTestId("monitor-incidents-region");
    await waitFor(() => {
      expect(
        within(section).queryByTestId("monitor-incidents-pagination"),
      ).toBeNull();
    });
  });
});

const fullResponse: LastResponse = {
  checkedAt: AT,
  scheduledFor: AT,
  configVersion: 1,
  outcome: "pass",
  failureReason: null,
  url: "https://api.acme.example/health",
  detailOmitted: null,
  statusLine: { httpVersion: "HTTP/1.1", status: 200, reasonPhrase: "OK" },
  headers: [
    { name: "content-type", value: "application/json", redacted: false },
    {
      name: "set-cookie",
      value: "PRIVATE_RESPONSE_HEADER_VALUE",
      redacted: true,
    },
  ],
  headersTruncated: true,
  body: {
    kind: "text",
    text: '{"ok":true}',
    truncated: true,
    totalBytesRead: 20000,
  },
};

async function lastResponseSection() {
  return screen.findByTestId("monitor-last-response");
}

describe("Last response panel", () => {
  it("shows status line, URL, headers table, body and the badges for an owner", async () => {
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    const { queryClient } = renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-status"),
    ).toHaveTextContent("HTTP/1.1 200 OK");
    expect(
      within(section).getByTestId("monitor-response-url"),
    ).toHaveTextContent(/^https:\/\/api\.acme\.example\/health$/);
    const table = within(section).getByTestId("monitor-response-headers");
    expect(table.tagName).toBe("TABLE");
    expect(table).toHaveAccessibleName(/\S/);
    expect(
      queryClient.getQueryData(monitorQueryKeys.lastResponse(A, MONITOR_ID)),
    ).toEqual({ response: fullResponse });
    expect(lastResponseMock).toHaveBeenCalledWith(A, MONITOR_ID);
    expect(section.innerHTML).not.toContain("PRIVATE_RESPONSE_HEADER_VALUE");
    expect(responseHeaderRecords(section)).toEqual(
      expect.arrayContaining([
        { name: "content-type", value: "application/json", redacted: "false" },
        {
          name: "set-cookie",
          value: nonempty,
          redacted: "true",
        },
      ]),
    );
    expect(responseHeaderRecords(section)).toHaveLength(2);
    expect(
      within(
        within(section).getByTestId("monitor-response-header-section"),
      ).getByTestId("monitor-response-truncated"),
    ).toHaveTextContent(/\S/);
    expect(
      within(
        within(section).getByTestId("monitor-response-body-section"),
      ).getByTestId("monitor-response-truncated"),
    ).toHaveTextContent(/\S/);
    const body = within(section).getByTestId("monitor-response-body");
    expect(body.tagName).toBe("PRE");
    expect(body).toHaveTextContent(/^\{"ok":true\}$/);
    expect(
      within(section).getByTestId("monitor-response-target-disclosure"),
    ).toHaveTextContent(/\S/);
  });

  it("shows a non-text body as words and no truncated badge", async () => {
    lastResponseMock.mockResolvedValue({
      response: {
        ...fullResponse,
        headersTruncated: false,
        body: { kind: "omitted", reason: "not_text" },
      },
    });
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-body-omitted"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).getByTestId("monitor-response-body-omitted"),
    ).toHaveAttribute("data-reason", "not_text");
    expect(
      within(section).queryByTestId("monitor-response-truncated"),
    ).toBeNull();
  });

  it("shows only version and status, with the reason, when request values were involved", async () => {
    lastResponseMock.mockResolvedValue({
      response: {
        ...fullResponse,
        detailOmitted: "request_values",
        statusLine: {
          httpVersion: "HTTP/1.1",
          status: 200,
          reasonPhrase: null,
        },
        headers: [],
        headersTruncated: false,
        body: { kind: "omitted", reason: "request_values" },
      },
    });
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-status"),
    ).toHaveTextContent("HTTP/1.1 200");
    expect(
      within(section).getByTestId("monitor-response-request-values"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).queryByTestId("monitor-response-headers"),
    ).toBeNull();
    expect(section.querySelector("table")).toBeNull();
    expect(
      within(section).queryByTestId("monitor-response-target-disclosure"),
    ).toBeNull();
  });

  it("shows 'ไม่มี response' with the cause and never a truncated badge, even for redirect_limit with headersTruncated", async () => {
    lastResponseMock.mockResolvedValue({
      response: {
        ...fullResponse,
        outcome: "fail",
        failureReason: "redirect_limit",
        statusLine: null,
        headers: [],
        headersTruncated: true,
        body: null,
      },
    });
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-missing"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).getByTestId("monitor-response-cause"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).queryByTestId("monitor-response-truncated"),
    ).toBeNull();
    expect(
      within(section).queryByTestId("monitor-response-headers"),
    ).toBeNull();
    expect(section.querySelector("table")).toBeNull();
  });

  it("shows the empty text before any result", async () => {
    renderDetail();
    expect(
      await within(await lastResponseSection()).findByTestId(
        "monitor-response-empty",
      ),
    ).toHaveTextContent(/\S/);
  });

  it("shows 'ไม่มีเนื้อหา' for a null body and 'ไม่มี headers' for an empty list (204)", async () => {
    lastResponseMock.mockResolvedValue({
      response: {
        ...fullResponse,
        statusLine: {
          httpVersion: "HTTP/1.1",
          status: 204,
          reasonPhrase: "No Content",
        },
        headers: [],
        headersTruncated: false,
        body: null,
      },
    });
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-status"),
    ).toHaveTextContent("HTTP/1.1 204 No Content");
    expect(
      within(section).getByTestId("monitor-response-no-headers"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).getByTestId("monitor-response-body-omitted"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).getByTestId("monitor-response-body-omitted"),
    ).toHaveAttribute("data-reason", "no_body");
    expect(
      within(section).queryByTestId("monitor-response-headers"),
    ).toBeNull();
    expect(section.querySelector("table")).toBeNull();
  });

  it("shows 'ถอดรหัสเนื้อหาไม่ได้' for an undecodable body", async () => {
    lastResponseMock.mockResolvedValue({
      response: {
        ...fullResponse,
        headersTruncated: false,
        body: { kind: "omitted", reason: "undecodable" },
      },
    });
    renderDetail();
    expect(
      await within(await lastResponseSection()).findByTestId(
        "monitor-response-body-omitted",
      ),
    ).toHaveTextContent(/\S/);
    expect(
      within(await lastResponseSection()).getByTestId(
        "monitor-response-body-omitted",
      ),
    ).toHaveAttribute("data-reason", "undecodable");
  });

  it("makes the body keyboard-focusable with an accessible name", async () => {
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    renderDetail();
    const body = await within(await lastResponseSection()).findByTestId(
      "monitor-response-body",
    );
    expect(body.tagName).toBe("PRE");
    expect(body).toHaveAttribute("role", "region");
    expect(body).toHaveAttribute("tabindex", "0");
    expect(body).toHaveAccessibleName(/\S/);
    expect(body).toHaveTextContent(/^\{"ok":true\}$/);
    body.focus();
    expect(body).toHaveFocus();
  });

  it("renders target text as text, never as markup", async () => {
    const script = "<script>window.__pwned = 1</script>";
    const img = '<img src=x onerror="window.__pwned = 2">';
    lastResponseMock.mockResolvedValue({
      response: {
        ...fullResponse,
        statusLine: {
          httpVersion: "HTTP/1.1",
          status: 200,
          reasonPhrase: script,
        },
        headers: [{ name: "x-note", value: img, redacted: false }],
        body: {
          kind: "text",
          text: `${script}${img}`,
          truncated: false,
          totalBytesRead: 80,
        },
      },
    });
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-status"),
    ).toHaveTextContent(`HTTP/1.1 200 ${script}`);
    expect(responseHeaderRecords(section)).toEqual([
      { name: "x-note", value: img, redacted: "false" },
    ]);
    expect(within(section).getByTestId("monitor-response-body").tagName).toBe(
      "PRE",
    );
    expect(
      within(section).getByTestId("monitor-response-body"),
    ).toHaveTextContent(`${script}${img}`);
    expect(section.querySelector("script, img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("drops the panel to the role note and stops polling when a refetch answers PERMISSION_DENIED", async () => {
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    const { queryClient } = renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-status"),
    ).toHaveTextContent("HTTP/1.1 200 OK");
    lastResponseMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    await queryClient.refetchQueries({
      queryKey: ["tenant", "monitors"],
      type: "active",
    });
    expect(
      await within(section).findByTestId("monitor-response-read-role"),
    ).toHaveTextContent(/\S/);
    expect(
      within(section).queryByTestId("monitor-response-headers"),
    ).toBeNull();
    expect(section.querySelector("table")).toBeNull();
    expect(section.querySelector("pre")).toBeNull();
    expect(section.innerHTML).not.toContain('{"ok":true}');
    expect(section.innerHTML).not.toContain("application/json");
    expect(section.innerHTML).not.toContain("PRIVATE_RESPONSE_HEADER_VALUE");
    expect(
      within(section).queryByTestId("monitor-response-refresh-error"),
    ).toBeNull();
    const calls = lastResponseMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lastResponseMock.mock.calls.length).toBe(calls);
  });

  it("shows an error with retry", async () => {
    lastResponseMock.mockRejectedValueOnce(
      new ApiError("INTERNAL", "boom", 500),
    );
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId(
        "monitor-response-error",
        {},
        { timeout: 4000 },
      ),
    ).toHaveTextContent(/\S/);
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(section).getByTestId("monitor-response-retry"));
    expect(
      await within(section).findByTestId("monitor-response-status"),
    ).toHaveTextContent("HTTP/1.1 200 OK");
  });

  it("shows the role note when the API answers PERMISSION_DENIED", async () => {
    lastResponseMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByTestId("monitor-response-read-role"),
    ).toHaveTextContent(/\S/);
    expect(within(section).queryByTestId("monitor-response-retry")).toBeNull();
  });

  it.each(["viewer", "auditor"] as const)(
    "never requests the response for a %s and shows the role note",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      renderDetail();
      const section = await lastResponseSection();
      expect(
        within(section).getByTestId("monitor-response-read-role"),
      ).toHaveTextContent(/\S/);
      await screen.findByTestId("monitor-event-feed-empty");
      expect(lastResponseMock).not.toHaveBeenCalled();
    },
  );

  it("requests the response for an admin", async () => {
    vi.mocked(fetchMeContext).mockResolvedValue(context("admin"));
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    renderDetail();
    expect(
      await within(await lastResponseSection()).findByTestId(
        "monitor-response-status",
      ),
    ).toHaveTextContent("HTTP/1.1 200 OK");
  });
});

describe("Recent events HTTP status", () => {
  it("adds the status only to rows that carry one", async () => {
    vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          monitorId: "m1",
          monitorName: "A",
          at: AT,
          reason: "http_status",
          httpStatus: 503,
        },
        {
          kind: "incident_closed",
          monitorId: "m1",
          monitorName: "A",
          at: AT,
          reason: "recovered",
          durationSeconds: 120,
          httpStatus: 200,
        },
        {
          kind: "incident_opened",
          monitorId: "m2",
          monitorName: "B",
          at: AT,
          reason: "timeout",
        },
      ],
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <RecentEventsCard organizationId="o1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const items = await screen.findAllByTestId("monitor-overview-event");
    const records = items.map((item) => {
      const link = within(item).getByTestId("monitor-overview-event-monitor");
      const time = within(item).getByTestId("monitor-overview-event-time");
      expect(time).toHaveAttribute("dateTime", AT);
      expect(time).toHaveTextContent(
        new Date(AT).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
      const description = within(item).getByTestId(
        "monitor-overview-event-description",
      );
      expect(description).toHaveTextContent(/\S/);
      return {
        kind: item.getAttribute("data-event-kind"),
        name: link.textContent,
        href: link.getAttribute("href"),
        http: description.textContent.match(/HTTP (\d+)/)?.[1] ?? null,
        duration: description.textContent.match(/(\d+ นาที)/)?.[1] ?? null,
      };
    });
    expect(records).toEqual(
      expect.arrayContaining([
        {
          kind: "incident_opened",
          name: "A",
          href: "/organizations/o1/monitors/m1",
          http: "503",
          duration: null,
        },
        {
          kind: "incident_closed",
          name: "A",
          href: "/organizations/o1/monitors/m1",
          http: "200",
          duration: "2 นาที",
        },
        {
          kind: "incident_opened",
          name: "B",
          href: "/organizations/o1/monitors/m2",
          http: null,
          duration: null,
        },
      ]),
    );
    expect(records).toHaveLength(3);
  });
});
