import type {
  LastResponse,
  MonitorEvent,
  MonitorEventsResponse,
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
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
} from "../../lib/api/monitors";
import {
  context,
  detail,
  noChecks,
  noIncidents,
  noResponseTimes,
  NOW,
  renderDetail,
  sectionOf,
} from "./detail-test-support";
import { RecentEventsCard } from "./RecentEventsCard";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
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
  const heading = await screen.findByRole("heading", {
    level: 2,
    name: "ฟีดเหตุการณ์",
  });
  return sectionOf(heading);
}

async function rows(section: HTMLElement) {
  const list = await within(section).findByRole("list", {
    name: "ฟีดเหตุการณ์ของมอนิเตอร์",
  });
  // Direct children only: a config row nests its own list of changes.
  return Array.from(list.children) as HTMLElement[];
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
    const text = items.map((item) => item.textContent);
    expect(text[0]).toContain("ตรวจล้มเหลว · ใบรับรองไม่ถูกต้อง: หมดอายุ");
    expect(text[1]).toContain(
      "ตรวจล้มเหลว · รหัสสถานะ HTTP ไม่ตรงเงื่อนไข · HTTP 503 · 1,200 ms",
    );
    expect(text[2]).toMatch(/ตรวจล้มเหลว$/);
    expect(text[3]).toContain("เริ่มล่ม · หมดเวลารอ");
    expect(text[3]).not.toContain("HTTP");
    expect(text[4]).toContain("กลับมาปกติ · HTTP 200 · 182 ms · ล่ม 12 นาที");
    expect(text[5]).toContain("กลับมาปกติ · ล่ม 1 นาที");
    expect(text[5]).not.toContain("HTTP");
    expect(text[6]).toContain("สิ้นสุดเหตุการณ์ล่ม · หยุดชั่วคราวโดยผู้ใช้");
    const time = items[0]?.querySelector("time");
    expect(time).toHaveAttribute("dateTime", AT);
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
    const text = (await rows(await feedSection())).map(
      (item) => item.textContent,
    );
    expect(text[0]).toContain("หยุดชั่วคราว โดย Somchai");
    expect(text[1]).toContain("เริ่มตรวจต่อ โดย สมาชิก");
    expect(text[2]).toContain("แก้ไขการตั้งค่า โดย อดีตสมาชิก");
    expect(text[3]).toContain("หยุดชั่วคราว โดย ผู้ใช้ที่ถูกลบ");
    expect(text[4]).toMatch(/เริ่มตรวจต่อ$/);
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
    const [withChanges, bare] = await rows(await feedSection());
    const lines = within(withChanges as HTMLElement)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lines).toEqual([
      "เวลารอสูงสุด (วินาที): ก่อน 10 หลัง 30",
      "Header Accept: ก่อน ไม่มี หลัง application/json",
      "Query page: ก่อน ••• หลัง •••",
      "เนื้อหาคำขอ: เปลี่ยน",
      "Assertions: เปลี่ยน",
      "Bearer token: แทนที่ค่าใหม่",
      "ค่า header ลับ X-Api-Key: ตั้งค่าแล้ว",
      "ค่า header ลับ: ลบค่าแล้ว",
      "Header X-Token: ตั้งค่าแล้ว",
    ]);
    expect(within(bare as HTMLElement).queryByRole("list")).toBeNull();
    expect(bare?.textContent).toContain("แก้ไขการตั้งค่า");
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
      await screen.findByText("กำลังโหลดฟีดเหตุการณ์"),
    ).toBeInTheDocument();
    release(feed([]));
    expect(
      await screen.findByText("ยังไม่มีเหตุการณ์ใน 30 วันล่าสุด"),
    ).toBeInTheDocument();
  });

  it("shows an error with retry that stays inside the card", async () => {
    feedMock.mockRejectedValueOnce(new ApiError("INTERNAL", "boom", 500));
    renderDetail();
    const section = await feedSection();
    expect(
      await within(section).findByText("โหลดฟีดเหตุการณ์ไม่สำเร็จ"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(section).getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await within(section).findByText("ยังไม่มีเหตุการณ์ใน 30 วันล่าสุด"),
    ).toBeInTheDocument();
  });

  it("keeps the rows and warns when a refetch fails after data arrived", async () => {
    feedMock.mockResolvedValueOnce(
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
    feedMock.mockRejectedValue(new ApiError("INTERNAL", "boom", 500));
    await queryClient.refetchQueries({ queryKey: ["tenant", "monitors"] });
    expect(
      await within(section).findByText("อัปเดตฟีดเหตุการณ์ไม่สำเร็จ"),
    ).toBeInTheDocument();
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
      .click(await within(section).findByRole("button", { name: "ถัดไป" }));
    await waitFor(() => {
      expect(feedMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { limit: 20, offset: 20 },
      );
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
    { name: "set-cookie", value: "•••", redacted: true },
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
  return sectionOf(
    await screen.findByRole("heading", { level: 2, name: "การตอบกลับล่าสุด" }),
  );
}

describe("Last response panel", () => {
  it("shows status line, URL, headers table, body and the badges for an owner", async () => {
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByText("HTTP/1.1 200 OK"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("https://api.acme.example/health"),
    ).toBeInTheDocument();
    const table = within(section).getByRole("table", {
      name: "headers ของการตอบกลับล่าสุด",
    });
    expect(within(table).getByText("application/json")).toBeInTheDocument();
    expect(within(table).getByText("ค่าถูกซ่อน")).toBeInTheDocument();
    expect(within(section).getAllByText("ตัดแล้ว")).toHaveLength(2);
    const body = within(section).getByText('{"ok":true}');
    expect(body.tagName).toBe("PRE");
    // The body wraps inside its own container instead of widening the page (LAY-02).
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.className).toContain("overflow-auto");
    expect(body.parentElement?.className).toContain("min-w-0");
    expect(
      within(section).getByText("เนื้อหานี้มาจากเป้าหมายโดยตรง"),
    ).toBeInTheDocument();
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
      await within(section).findByText("เนื้อหาไม่ใช่ข้อความ"),
    ).toBeInTheDocument();
    expect(within(section).queryByText("ตัดแล้ว")).toBeNull();
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
      await within(section).findByText("HTTP/1.1 200"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(
        "ไม่เก็บ headers และเนื้อหา เพราะคำขอมี query หรือ body ซึ่งเป้าหมายอาจสะท้อนกลับ",
      ),
    ).toBeInTheDocument();
    expect(within(section).queryByRole("table")).toBeNull();
    expect(
      within(section).queryByText("เนื้อหานี้มาจากเป้าหมายโดยตรง"),
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
      await within(section).findByText("ไม่มี response"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("สาเหตุ redirect เกินกำหนด"),
    ).toBeInTheDocument();
    expect(within(section).queryByText("ตัดแล้ว")).toBeNull();
    expect(within(section).queryByRole("table")).toBeNull();
  });

  it("shows the empty text before any result", async () => {
    renderDetail();
    expect(
      await within(await lastResponseSection()).findByText("ยังไม่มีผลตรวจ"),
    ).toBeInTheDocument();
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
      await within(section).findByText("HTTP/1.1 204 No Content"),
    ).toBeInTheDocument();
    expect(within(section).getByText("ไม่มี headers")).toBeInTheDocument();
    expect(within(section).getByText("ไม่มีเนื้อหา")).toBeInTheDocument();
    expect(within(section).queryByRole("table")).toBeNull();
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
      await within(await lastResponseSection()).findByText(
        "ถอดรหัสเนื้อหาไม่ได้",
      ),
    ).toBeInTheDocument();
  });

  it("makes the body keyboard-focusable with an accessible name", async () => {
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    renderDetail();
    const body = await within(await lastResponseSection()).findByRole(
      "generic",
      { name: "เนื้อหาของการตอบกลับล่าสุด" },
    );
    expect(body.tagName).toBe("PRE");
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
      await within(section).findByText(`HTTP/1.1 200 ${script}`),
    ).toBeInTheDocument();
    expect(within(section).getByText(img)).toBeInTheDocument();
    expect(within(section).getByText(`${script}${img}`).tagName).toBe("PRE");
    expect(section.querySelector("script, img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("drops the panel to the role note and stops polling when a refetch answers PERMISSION_DENIED", async () => {
    lastResponseMock.mockResolvedValueOnce({ response: fullResponse });
    const { queryClient } = renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByText("HTTP/1.1 200 OK"),
    ).toBeInTheDocument();
    lastResponseMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    await queryClient.refetchQueries({
      queryKey: ["tenant", "monitors"],
      type: "active",
    });
    expect(
      await within(section).findByText(
        "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา",
      ),
    ).toBeInTheDocument();
    expect(within(section).queryByRole("table")).toBeNull();
    expect(section.querySelector("pre")).toBeNull();
    expect(
      within(section).queryByText("อัปเดตการตอบกลับล่าสุดไม่สำเร็จ"),
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
      await within(section).findByText(
        "โหลดการตอบกลับล่าสุดไม่สำเร็จ",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(section).getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await within(section).findByText("HTTP/1.1 200 OK"),
    ).toBeInTheDocument();
  });

  it("shows the role note when the API answers PERMISSION_DENIED", async () => {
    lastResponseMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "denied", 403),
    );
    renderDetail();
    const section = await lastResponseSection();
    expect(
      await within(section).findByText(
        "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา",
      ),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "ลองอีกครั้ง" }),
    ).toBeNull();
  });

  it.each(["viewer", "auditor"] as const)(
    "never requests the response for a %s and shows the role note",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      renderDetail();
      const section = await lastResponseSection();
      expect(
        within(section).getByText(
          "เฉพาะเจ้าของและผู้ดูแลเห็น headers และเนื้อหา",
        ),
      ).toBeInTheDocument();
      await screen.findByText("ยังไม่มีเหตุการณ์ใน 30 วันล่าสุด");
      expect(lastResponseMock).not.toHaveBeenCalled();
    },
  );

  it("requests the response for an admin", async () => {
    vi.mocked(fetchMeContext).mockResolvedValue(context("admin"));
    lastResponseMock.mockResolvedValue({ response: fullResponse });
    renderDetail();
    expect(
      await within(await lastResponseSection()).findByText("HTTP/1.1 200 OK"),
    ).toBeInTheDocument();
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
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("เริ่มล่ม");
    expect(items[0]).toHaveTextContent("HTTP 503");
    expect(items[1]).toHaveTextContent("HTTP 200");
    expect(items[2]?.textContent).not.toContain("HTTP");
  });
});
