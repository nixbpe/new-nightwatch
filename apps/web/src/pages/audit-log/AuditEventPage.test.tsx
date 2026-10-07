import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import type {
  AuditChange,
  AuditEventDetail,
  AuditLogEventResponse,
} from "@nightwatch/api-contract";
import { screen, within } from "@testing-library/react";
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
        element={<p>list</p>}
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
    const title = await screen.findByRole("heading", {
      level: 1,
      name: "หยุดมอนิเตอร์ชั่วคราว",
    });
    expect(title).toHaveFocus();
    expect(screen.getByText("2026-10-02 14:00:55")).toBeInTheDocument();
    expect(
      screen.getByText(EVENT_ID, { selector: "span" }),
    ).toBeInTheDocument();
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(
      expect.arrayContaining([
        "ชื่อ",
        "บทบาท ณ เวลานั้น",
        "การกระทำ",
        "รหัสการกระทำ",
        "หมวด",
        "เป้าหมาย",
      ]),
    );
    expect(screen.getByText("organization.monitor.pause")).toBeInTheDocument();
    expect(screen.getByText("ผู้ดูแล")).toBeInTheDocument();
    expect(
      screen.getByText("มอนิเตอร์", { selector: "dd" }),
    ).toBeInTheDocument();
  });

  it("renders no e-mail address or IP anywhere", async () => {
    const { container } = open(makeDetail());
    await screen.findByRole("heading", {
      level: 1,
      name: "หยุดมอนิเตอร์ชั่วคราว",
    });
    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("links a live monitor target by name and shows a deleted one as text", async () => {
    const { unmount } = open(makeDetail());
    expect(
      await screen.findByRole("link", { name: "เปิดมอนิเตอร์ api-prod" }),
    ).toHaveAttribute(
      "href",
      "/organizations/" +
        ORG_A +
        "/monitors/99999999-9999-4999-8999-999999999999",
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
    expect(
      await screen.findByText("ถูกลบแล้ว", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /เปิดมอนิเตอร์/ }),
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
      await screen.findByRole("link", { name: "เปิดสมาชิก ประภา ค." }),
    ).toBeInTheDocument();
    unmount();
    open(memberEvent, "auditor");
    expect(
      await screen.findByText("ประภา ค.", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /เปิดสมาชิก/ }),
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
    expect(
      await screen.findByText("ไม่ใช่สมาชิกแล้ว", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /เปิดสมาชิก/ }),
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
    expect(
      await screen.findByText(/คำเชิญ ผู้ตรวจสอบ/, { selector: "dd" }),
    ).toHaveTextContent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});

describe("AuditEventPage changes", () => {
  const rowsOf = () =>
    within(screen.getByRole("table")).getAllByRole("row").slice(1);

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
    await screen.findByRole("table");
    expect(screen.getByRole("table")).toHaveAccessibleName(
      "การเปลี่ยนแปลงก่อนและหลัง",
    );
    const text = rowsOf().map((row) =>
      Array.from(row.children).map((c) => c.textContent),
    );
    expect(text).toEqual([
      ["บทบาท", "ผู้ชม", "ผู้ดูแล"],
      ["แจ้งเตือนมอนิเตอร์", "เปิด", "ปิด"],
      ["หมดเวลารอ (วินาที)", "10", "30"],
      ["ชื่อมอนิเตอร์", "old", "new"],
      ["แจ้งเมื่อมีการเปลี่ยนการตั้งค่าการแจ้งเตือน", "ปิด", "เปิด"],
      ["รอบตรวจ (วินาที)", "60", "300"],
      ["รหัสสถานะที่ถือว่าปกติ", "200", "2xx"],
      ["Query parameter token", "—", "•••"],
      ["ค่าลับ Authorization", "—", "ตั้งค่าแล้ว"],
      ["ค่าลับ auth.token", "ตั้งค่าแล้ว", "เปลี่ยนแล้ว"],
      ["Body", "—", "เปลี่ยนแล้ว"],
      ["เงื่อนไขตรวจสอบ", "bodyContains ok", "—"],
    ]);
  });

  it("wraps the changes table in a named, focusable, horizontal-only scroll region", async () => {
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
    const region = await screen.findByRole("region", {
      name: "ตารางการเปลี่ยนแปลง",
    });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(screen.getByRole("table"));
    expect(region.className).toContain("overflow-x-auto");
    expect(region.className).not.toContain("overflow-auto");
    expect(region.className).toContain("focus:outline-primary");
    region.focus();
    expect(region).toHaveFocus();
  });

  it("says so when an event has no changes", async () => {
    open(makeDetail());
    expect(
      await screen.findByText("เหตุการณ์นี้ไม่มีข้อมูลการเปลี่ยนแปลง"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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
    expect(
      await screen.findByText("ไฟล์ส่งออก CSV", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /ไฟล์ส่งออก/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "ขอบเขตการส่งออก" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "การเปลี่ยนแปลง" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/2026-09-26 00:00:00 – 2026-10-03 14:02:00/),
    ).toBeInTheDocument();
    const scope = screen.getByRole("region", { name: "ขอบเขตการส่งออก" });
    expect(await within(scope).findByText("สมชาย ก.")).toBeInTheDocument();
    expect(screen.getByText("มีการค้นหาข้อความ").nextSibling).toHaveTextContent(
      "ใช่",
    );
    expect(screen.getByText("สมาชิก", { selector: "dd" })).toBeInTheDocument();
  });

  it("says no search applied, and a missing actor reads as a former member", async () => {
    open(exportEvent(false, "user-404"));
    expect(
      await screen.findByText("ไม่ใช่สมาชิกแล้ว", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(screen.getByText("มีการค้นหาข้อความ").nextSibling).toHaveTextContent(
      "ไม่",
    );
  });
});

describe("AuditEventPage states and navigation", () => {
  it("shows the shared not-found copy and a back link on a 404", async () => {
    open(new ApiError("AUDIT_EVENT_NOT_FOUND", "x", 404));
    expect(
      await screen.findByText(
        "ไม่พบบันทึกนี้ อาจพ้นระยะเก็บบันทึกแล้ว หรือลิงก์ไม่ถูกต้อง",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "กลับไปบันทึกกิจกรรม" }),
    ).toBeInTheDocument();
  });

  it("offers a retry on another failure", async () => {
    const user = userEvent.setup();
    open(new ApiError("INTERNAL", "x", 500));
    expect(
      await screen.findByText(
        "โหลดรายละเอียดไม่สำเร็จ ลองใหม่อีกครั้ง",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    eventMock.mockResolvedValue(respond(makeDetail()));
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "หยุดมอนิเตอร์ชั่วคราว",
      }),
    ).toBeInTheDocument();
  });

  it("makes no request for a viewer", async () => {
    open(makeDetail(), "viewer");
    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม"),
    ).toBeInTheDocument();
    expect(eventMock).not.toHaveBeenCalled();
  });

  it("drops the event when the server denies a later read", async () => {
    open(new ApiError("PERMISSION_DENIED", "x", 403));
    expect(
      await screen.findByRole("heading", {
        name: "เข้าถึงบันทึกกิจกรรมไม่ได้",
      }),
    ).toHaveFocus();
    expect(
      screen.queryByText("organization.monitor.pause"),
    ).not.toBeInTheDocument();
  });

  it("goes back to the list with the original query string", async () => {
    const user = userEvent.setup();
    open(makeDetail(), "owner", {
      search: "?range=30d&page=2",
      eventId: EVENT_ID,
    });
    await user.click(
      await screen.findByRole("link", { name: "กลับไปบันทึกกิจกรรม" }),
    );
    expect(await screen.findByText("list")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${ORG_A}/audit-log?range=30d&page=2`,
    );
  });
});
