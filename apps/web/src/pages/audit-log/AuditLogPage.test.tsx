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
  within(screen.getByRole("table")).getAllByRole("row").slice(1);
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

describe("AuditLogPage table (AC-02, AC-09, AC-17)", () => {
  it("shows time in the preference zone with seconds, the zone name, actor role and no result column", async () => {
    listMock.mockResolvedValue(
      makeList([
        makeEvent(0),
        makeEvent(1, {
          actor: {
            userId: "user-9",
            displayName: null,
            roleAtTime: "owner",
            membership: "former",
          },
        }),
      ]),
    );
    open();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "เวลา (Asia/Bangkok)",
      "ผู้ดำเนินการ",
      "การกระทำ",
      "เป้าหมาย",
    ]);
    expect(screen.getAllByRole("columnheader")[0]).toHaveAttribute(
      "scope",
      "col",
    );
    expect(screen.getByRole("table")).toHaveAccessibleName(
      /บันทึกกิจกรรมขององค์กร/,
    );
    expect(
      screen.getByRole("region", { name: "ตารางบันทึกกิจกรรม" }),
    ).toHaveAttribute("tabindex", "0");
    const [first, second] = rows();
    expect(within(first as HTMLElement).getByRole("link")).toHaveTextContent(
      "2026-10-02 14:01:55",
    );
    expect(within(first as HTMLElement).getByRole("link")).toHaveAccessibleName(
      "2026-10-02 14:01:55 หยุดมอนิเตอร์ชั่วคราว",
    );
    expect(first).toHaveTextContent("สมชาย ก. (ผู้ดูแล)");
    expect(first).toHaveTextContent("api-prod");
    expect(second).toHaveTextContent("ไม่ใช่สมาชิกแล้ว (เจ้าของ)");
    expect(screen.getByText(/เวลาแสดงตาม/)).toHaveTextContent("Asia/Bangkok");
    expect(screen.getByText(/ทั้งหมด/, { selector: "span" })).toHaveTextContent(
      "ทั้งหมด 2 รายการ",
    );
  });

  it("renders another zone with a different offset", async () => {
    setTimeZone("America/New_York");
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open();
    expect(
      await screen.findByRole("link", { name: /2026-10-02 03:01:55/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "เวลา (America/New_York)" }),
    ).toBeInTheDocument();
  });

  it("states retention and recording start as dates and shows the scope note in every state", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof makeList>>();
    listMock.mockReturnValue(pending.promise);
    open();
    expect(
      screen.getByText(/บันทึกเฉพาะการกระทำที่สำเร็จ/),
    ).toBeInTheDocument();
    pending.resolve(makeList([makeEvent(0)]));
    expect(await screen.findByText("2025-10-03")).toBeInTheDocument();
    expect(screen.getByText(/ตั้งแต่/)).toHaveTextContent("ตั้งแต่ 2025-06-01");
    expect(screen.getByText(/โหลดเมื่อ/)).toHaveTextContent(
      "โหลดเมื่อ 14:02:11",
    );
  });

  it("shows the later of 365 days back and the recording start as the retained date (AC-09)", async () => {
    // Recording began 40 days before the load, so the log is retained from there, not from 365 days back.
    listMock.mockResolvedValue(
      makeList([makeEvent(0)], 1, {
        retainedFrom: "2026-08-24T00:00:00.000Z",
        recordingStartedAt: "2026-08-24T00:00:00.000Z",
      }),
    );
    open();
    await screen.findByRole("table");
    expect(screen.getByText(/เก็บย้อนหลังถึง/)).toHaveTextContent(
      "เก็บย้อนหลังถึง 2026-08-24",
    );
    expect(screen.getByText(/ตั้งแต่/)).toHaveTextContent("ตั้งแต่ 2026-08-24");
  });

  it("fetches once on a cold load and never shows 0 while the count is unknown", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof makeList>>();
    listMock.mockReturnValue(pending.promise);
    open();
    expect(
      screen.getByRole("status", { name: "กำลังโหลดบันทึกกิจกรรม" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ทั้งหมด \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    pending.resolve(makeList([makeEvent(0)]));
    await screen.findByRole("table");
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("announces the count in one status region", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)], 1234));
    open();
    await screen.findByRole("table");
    expect(screen.getByText("พบ 1,234 รายการ")).toHaveAttribute(
      "role",
      "status",
    );
  });
});

describe("AuditLogPage paging and filters (AC-02, AC-10)", () => {
  const page1 = () =>
    makeList(
      Array.from({ length: 50 }, (_, i) => makeEvent(i)),
      120,
    );

  it("keeps asOf on a page change and drops it on a filter change", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page1());
    open();
    await screen.findByRole("table");
    expect(listMock.mock.calls[0]?.[1].asOf).toBeUndefined();
    expect(screen.getByText(/หน้า 1 จาก 3/)).toBeInTheDocument();

    listMock.mockResolvedValue(makeList([makeEvent(60)], 120, {}, 50));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await waitFor(() => {
      expect(location()).toMatch(/page=2/);
    });
    await screen.findByText(/หน้า 2 จาก 3/);
    const second = listMock.mock.calls.at(-1)?.[1];
    expect(second?.offset).toBe(50);
    expect(second?.asOf).toBe("2026-10-03T07:02:11.000Z");
    expect(screen.getByRole("heading", { name: "รายการ" })).toHaveFocus();

    listMock.mockResolvedValue(makeList([makeEvent(2)], 1));
    await user.click(screen.getByRole("button", { name: "สมาชิก" }));
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
    expect(screen.getByRole("button", { name: "สมาชิก" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies the search on Enter, writes it to the URL and clears everything with ล้างตัวกรอง", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=30d&actor=user-1");
    await screen.findByRole("table");
    await user.type(
      screen.getByRole("searchbox", { name: "ค้นหา" }),
      "api-prod{Enter}",
    );
    await waitFor(() => {
      expect(location()).toContain("q=api-prod");
    });
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].q).toBe("api-prod");
    });
    expect(screen.getByText(/ตัวกรองที่ใช้:/)).toHaveTextContent(
      "ช่วงเวลา 30 วัน",
    );

    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    await waitFor(() => {
      expect(location()).toBe(`/organizations/${ORG_A}/audit-log`);
    });
    expect(screen.getByRole("searchbox", { name: "ค้นหา" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "7 วัน" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens a shared link with the same filters and ignores invalid URL values", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=24h&categories=member,invitation&actor=user-1&q=ada");
    await screen.findByRole("table");
    const params = listMock.mock.calls[0]?.[1];
    expect(params).toMatchObject({
      categories: ["member", "invitation"],
      actorUserId: "user-1",
      q: "ada",
    });
    expect(screen.getByRole("button", { name: "24 ชั่วโมง" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "ผู้ดำเนินการ" })).toHaveValue(
      "user-1",
    );
  });

  it("falls back to the default for an invalid range without an error", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=bogus&page=-3&categories=nope");
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "7 วัน" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    await screen.findByRole("table");
    await waitFor(() => {
      expect(location()).toContain("page=3");
    });
    expect(listMock.mock.calls.map((call) => call[1].offset)).toEqual([
      400, 100,
    ]);
  });
});

describe("AuditLogPage custom range (AC-11)", () => {
  it("shows an error beside the field, keeps the values and sends no request for a reversed range", async () => {
    open("?range=custom&from=2026-10-02&to=2026-10-01");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด",
    );
    expect(screen.getByLabelText("วันเริ่ม")).toHaveValue("2026-10-02");
    expect(screen.getByLabelText("วันสิ้นสุด")).toHaveValue("2026-10-01");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("does not refetch on รีเฟรช while the range is invalid, and points the button at the error", async () => {
    const user = userEvent.setup();
    open("?range=custom&from=2026-10-02&to=2026-10-01");
    const error = await screen.findByRole("alert");
    const refresh = screen.getByRole("button", { name: "รีเฟรช" });
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
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    // Choosing "custom" without dates is a valid, open range and asks once.
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("วันเริ่ม"), "2025-10-02");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "วันที่เก็บย้อนหลังถึง (2025-10-03)",
    );
    await act(() => Promise.resolve());
    expect(listMock).toHaveBeenCalledTimes(2);
    const before = listMock.mock.calls.length;
    await user.clear(screen.getByLabelText("วันเริ่ม"));
    await user.type(screen.getByLabelText("วันเริ่ม"), "2025-10-04");
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
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
    await screen.findByRole("table");
    act(() => {
      fireEvent.change(screen.getByLabelText("วันเริ่ม"), {
        target: { value: "2026-09-30" },
      });
      fireEvent.change(screen.getByLabelText("วันสิ้นสุด"), {
        target: { value: "2026-10-02" },
      });
    });
    await waitFor(() => {
      expect(location()).toContain("from=2026-09-30");
    });
    expect(location()).toContain("to=2026-10-02");
    expect(screen.getByLabelText("วันเริ่ม")).toHaveValue("2026-09-30");
    expect(screen.getByLabelText("วันสิ้นสุด")).toHaveValue("2026-10-02");
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
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("วันเริ่ม"), {
      target: { value: "2026-09-30" },
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    fireEvent.change(screen.getByLabelText("วันสิ้นสุด"), {
      target: { value: "2026-10-02" },
    });
    await waitFor(() => {
      expect(router.state.location.search).toContain("to=2026-10-02");
    });
    expect(router.state.location.search).toContain("from=2026-09-30");
  });

  it("marks the pressed chip with the design-system Primary tint", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open();
    await screen.findByRole("table");
    const chip = screen.getByRole("button", { name: "7 วัน" });
    expect(chip.className).toContain("bg-primary-tint");
    expect(chip.className).not.toContain("bg-primary/10");
  });
});

describe("AuditLogPage states (AC-08)", () => {
  const NO_DATA = /ยังไม่มีบันทึกกิจกรรมในช่วงที่เก็บไว้ \(ถึง 2025-10-03\)/;
  const NO_MATCH =
    /ไม่พบบันทึกที่ตรงกับตัวกรองนี้ ลองขยายช่วงเวลาหรือล้างตัวกรอง/;

  it("claims no data only when the actors list is empty too", async () => {
    listMock.mockResolvedValue(makeList([], 0));
    actorsMock.mockResolvedValue({ actors: [] });
    open();
    expect(await screen.findByText(NO_DATA)).toBeInTheDocument();
    expect(
      screen.getByText(/ไม่ได้ยืนยันว่าไม่มีกิจกรรมในหมวดที่ไม่ได้บันทึก/),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ล้างตัวกรอง" })).toHaveLength(
      1,
    );
  });

  it("reads an empty default 7 days as no match when events exist in retention", async () => {
    listMock.mockResolvedValue(makeList([], 0));
    open();
    expect(await screen.findByText(NO_MATCH)).toBeInTheDocument();
    expect(screen.queryByText(NO_DATA)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ล้างตัวกรอง" })).toHaveLength(
      2,
    );
  });

  it("never claims no data while the actors list is loading or failed", async () => {
    listMock.mockResolvedValue(makeList([], 0));
    const pending = Promise.withResolvers<{ actors: [] }>();
    actorsMock.mockReturnValue(pending.promise);
    const view = open();
    expect(await screen.findByText(NO_MATCH)).toBeInTheDocument();
    expect(screen.queryByText(NO_DATA)).not.toBeInTheDocument();
    view.unmount();

    actorsMock.mockRejectedValue(new ApiError("INTERNAL", "x", 500));
    open();
    expect(await screen.findByText(NO_MATCH)).toBeInTheDocument();
    await act(() => Promise.resolve());
    expect(screen.queryByText(NO_DATA)).not.toBeInTheDocument();
  });

  it("keeps the filters, hides the count and retries on a failed load", async () => {
    const user = userEvent.setup();
    listMock.mockRejectedValue(new ApiError("INTERNAL", "boom", 500));
    open("?categories=member");
    expect(
      await screen.findByText(
        "โหลดบันทึกกิจกรรมไม่สำเร็จ ตัวกรองของคุณยังอยู่ ลองใหม่อีกครั้ง",
        {},
        // One automatic retry runs first.
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ทั้งหมด \d/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สมาชิก" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("refreshes without the pinned snapshot", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)], 120));
    open();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].asOf).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "รีเฟรช" }));
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1].asOf).toBeUndefined();
    });
  });

  it("refreshes a custom range even though its request key does not change (C4-01)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("?range=custom&from=2026-09-30&to=2026-10-02");
    await screen.findByRole("table");
    expect(listMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "รีเฟรช" }));
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
    await screen.findByRole("table");
    const names = () =>
      within(screen.getByRole("combobox", { name: "ผู้ดำเนินการ" }))
        .getAllByRole("option")
        .map((option) => option.textContent);
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
    await user.click(screen.getByRole("button", { name: "รีเฟรช" }));
    await waitFor(() => {
      expect(actorsMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(names()).not.toContain("มาลี ข.");
    });
    expect(names()).toContain("ไม่ใช่สมาชิกแล้ว");
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
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await screen.findByText(/หน้า 2 จาก 3/);
    await user.click(screen.getByRole("button", { name: "ก่อนหน้า" }));
    await screen.findByText(/หน้า 1 จาก 3/);
    const last = listMock.mock.calls.at(-1)?.[1];
    expect(last?.offset).toBe(0);
    expect(last?.asOf).toBe("2026-10-03T07:02:11.000Z");
  });
});

describe("AuditLogPage authorization (AC-05, AC-06)", () => {
  it("makes no request for a viewer and renders only the denied card, focused", async () => {
    open("", undefined, "viewer");
    const heading = await screen.findByRole("heading", {
      name: "เข้าถึงบันทึกกิจกรรมไม่ได้",
    });
    expect(
      screen.getByText("คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม"),
    ).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(listMock).not.toHaveBeenCalled();
    expect(actorsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ส่งออก" }),
    ).not.toBeInTheDocument();
  });

  it("clears rows and count when a later request is denied, invalidates the context and stops asking", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce(makeList([makeEvent(0)], 7));
    const view = open();
    await screen.findByRole("table");
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    listMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม", 403),
    );
    await user.click(screen.getByRole("button", { name: "สมาชิก" }));
    const heading = await screen.findByRole("heading", {
      name: "เข้าถึงบันทึกกิจกรรมไม่ได้",
    });
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/ทั้งหมด \d/)).not.toBeInTheDocument();
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
    expect(
      await screen.findByText("คุณไม่ใช่สมาชิกขององค์กรนี้"),
    ).toBeInTheDocument();
  });

  it("lets an auditor read and never offers export", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("", undefined, "auditor");
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ส่งออก/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
    ).not.toBeInTheDocument();
  });
});

describe("AuditLogPage Organization scope (AC-07)", () => {
  it("drops A's rows and ignores A's late response once the active Organization moves to B", async () => {
    const lateA = Promise.withResolvers<ReturnType<typeof makeList>>();
    listMock.mockReturnValue(lateA.promise);
    setTenant("owner", "owner");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const confirmed = {
      user: { id: "user-1" },
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

    // What TenantProvider.switchOrg does after the server confirms: publish B as active.
    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim);
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
        ...confirmed,
        lastActiveTenantId: ORG_B,
      });
      publishContextPublication(queryClient, claim);
    });
    lateA.resolve(makeList([makeEvent(0)], 1));
    await act(() => Promise.resolve());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("สมชาย ก.")).not.toBeInTheDocument();
    expect(screen.queryByText(/ทั้งหมด \d/)).not.toBeInTheDocument();
  });

  it("keeps the page on its own Organization when a deep link names one that is not active", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    setTenant("owner", "owner");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
      user: { id: "user-1" },
      organizations: [],
      lastActiveTenantId: ORG_B,
    });
    renderRoute(<AuditLogPage />, {
      path: PATH,
      entry: `/organizations/${ORG_A}/audit-log`,
      queryClient,
    });
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("AuditLogPage return from detail (AC-18, spec API)", () => {
  it("comes back to the same snapshot, page and row after opening an event", async () => {
    const user = userEvent.setup();
    const pageTwo = [makeEvent(60), makeEvent(61)];
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
      event: makeDetail({ ...pageTwo[1], changes: [] }),
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
    await screen.findByRole("table");
    const firstFrom = listMock.mock.calls[0]?.[1].from;
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await screen.findByText(/หน้า 2 จาก 2/);
    await user.click(within(rows()[1] as HTMLElement).getByRole("link"));
    await screen.findByRole("heading", {
      level: 1,
      name: "หยุดมอนิเตอร์ชั่วคราว",
    });
    const callsBefore = listMock.mock.calls.length;
    await user.click(screen.getByRole("link", { name: "กลับไปบันทึกกิจกรรม" }));

    await screen.findByRole("table");
    expect(location()).toBe(`/organizations/${ORG_A}/audit-log?page=2`);
    const back = listMock.mock.calls.slice(callsBefore);
    expect(back).toHaveLength(1);
    expect(back[0]?.[1]).toMatchObject({
      offset: 50,
      asOf: "2026-10-03T07:02:11.000Z",
      from: firstFrom,
    });
    await waitFor(() => {
      expect(within(rows()[1] as HTMLElement).getByRole("link")).toHaveFocus();
    });
  });
});

describe("AuditLogPage focus (AC-18)", () => {
  it("returns focus to the row link the user came from", async () => {
    const events = [makeEvent(0), makeEvent(1)];
    listMock.mockResolvedValue(makeList(events));
    open("", { eventId: events[1]?.id });
    await screen.findByRole("table");
    await waitFor(() =>
      expect(within(rows()[1] as HTMLElement).getByRole("link")).toHaveFocus(),
    );
  });

  it("falls back to the table heading when that row is gone", async () => {
    listMock.mockResolvedValue(makeList([makeEvent(0)]));
    open("", { eventId: "missing" });
    await screen.findByRole("table");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "รายการ" })).toHaveFocus(),
    );
  });
});
