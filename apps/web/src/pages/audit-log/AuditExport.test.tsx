import type {
  AuditExportListResponse,
  AuditExportRecord,
} from "@nightwatch/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  claimContextPublication,
  createContextPublicationClaim,
  publishContextPublication,
} from "../../lib/queryClient";
import {
  createAuditExport,
  downloadAuditExport,
  fetchAuditActors,
  fetchAuditEvents,
  fetchAuditExports,
} from "../../lib/api/audit-log";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { PREFERENCES_KEY } from "../../lib/preferences";
import { AuditLogPage } from "./AuditLogPage";
import {
  makeEvent,
  makeList,
  makeRecord,
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
  fetchAuditEvents: vi.fn(),
  fetchAuditActors: vi.fn(),
  fetchAuditExports: vi.fn(),
  createAuditExport: vi.fn(),
  downloadAuditExport: vi.fn(),
}));

const listMock = vi.mocked(fetchAuditEvents);
const exportsMock = vi.mocked(fetchAuditExports);
const createMock = vi.mocked(createAuditExport);
const downloadMock = vi.mocked(downloadAuditExport);

const PATH = "/organizations/:organizationId/audit-log";
const LIST_ASOF = "2026-10-03T07:02:11.000Z";
const denied = (code: "PERMISSION_DENIED" | "MEMBERSHIP_DENIED") =>
  new ApiError(code, "x", 403);
const exportList = (
  exports: AuditExportRecord[],
  inProgress = exports.some((row) => row.status === "generating"),
): AuditExportListResponse => ({ exports, inProgress });

function open(
  options: {
    role?: TestRole;
    rows?: AuditExportRecord[];
    inProgress?: boolean;
    total?: number;
    search?: string;
    hash?: string;
    queryClient?: QueryClient;
    exportsError?: ApiError;
  } = {},
) {
  setTenant(options.role ?? "owner");
  listMock.mockResolvedValue(
    makeList([makeEvent(0)], options.total ?? 1234, { asOf: LIST_ASOF }),
  );
  if (options.exportsError === undefined) {
    exportsMock.mockResolvedValue(
      exportList(options.rows ?? [], options.inProgress),
    );
  } else {
    exportsMock.mockRejectedValue(options.exportsError);
  }
  return renderRoute(<AuditLogPage />, {
    path: PATH,
    entry: `/organizations/${ORG_A}/audit-log${options.search ?? ""}${options.hash ?? ""}`,
    queryClient: options.queryClient,
  });
}
const exportButton = () =>
  screen.findByRole("button", { name: /^(ส่งออก|กำลังสร้างไฟล์…)$/ });
const sectionHeading = async () => {
  await screen.findByRole("table", { name: "ไฟล์ส่งออกของฉัน" });
  return screen.getByRole("heading", { name: "ไฟล์ส่งออกของฉัน" });
};
const row = (n: number) =>
  within(screen.getByRole("table", { name: "ไฟล์ส่งออกของฉัน" }))
    .getAllByRole("row")
    .slice(1)[n] as HTMLElement;
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await exportButton());
  return screen.findByRole("dialog", { name: "ส่งออกบันทึกกิจกรรม" });
}

beforeEach(() => {
  setTimeZone("Asia/Bangkok");
  vi.mocked(fetchAuditActors).mockResolvedValue({ actors: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  localStorage.removeItem(PREFERENCES_KEY);
});

describe("export button (AC-05, AC-16, M-2, N-2)", () => {
  it.each(["auditor", "viewer"] as const)(
    "does not render the button or the section and never asks for the exports of a %s",
    async (role) => {
      open({ role });
      if (role === "auditor") await screen.findByRole("table");
      else await screen.findByRole("heading", { name: /เข้าถึงบันทึก/ });
      expect(screen.queryByRole("button", { name: /ส่งออก/ })).toBeNull();
      expect(
        screen.queryByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
      ).toBeNull();
      expect(exportsMock).not.toHaveBeenCalled();
    },
  );

  it("is aria-disabled with the visible reason when the filter matches nothing", async () => {
    open({ total: 0 });
    const button = await exportButton();
    await screen.findByText("ไม่มีรายการให้ส่งออกตามตัวกรองนี้", {
      selector: "p#audit-export-reason",
    });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "audit-export-reason");
    await userEvent.setup().click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains why ส่งออก is unavailable while the list loads", async () => {
    setTenant("owner");
    listMock.mockReturnValue(new Promise(() => undefined));
    exportsMock.mockResolvedValue(exportList([]));
    renderRoute(<AuditLogPage />, {
      path: PATH,
      entry: `/organizations/${ORG_A}/audit-log`,
    });
    const button = await exportButton();
    expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText("กำลังโหลดรายการ…", { selector: "p" });
    expect(button).toHaveAttribute("aria-describedby", reason.id);
  });

  it("explains why ส่งออก is unavailable for an invalid custom range", async () => {
    open({ search: "?range=custom&from=2026-10-02&to=2026-10-01" });
    const button = await exportButton();
    const reason = screen.getByText(
      /ช่วงวันที่ไม่ถูกต้อง แก้ไขช่วงวันที่ก่อนส่งออก/,
    );
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-describedby", reason.id);
  });

  it("shows กำลังสร้างไฟล์… and shares one reason with every ขอใหม่ while a request runs", async () => {
    open({
      inProgress: true,
      rows: [
        makeRecord({ id: "11111111-1111-4111-8111-111111111111" }),
        makeRecord({
          id: "22222222-2222-4222-8222-222222222222",
          status: "failed",
          failureCode: "EXPORT_FAILED",
        }),
        makeRecord({
          id: "33333333-3333-4333-8333-333333333333",
          status: "expired",
        }),
      ],
    });
    const button = await screen.findByRole("button", {
      name: "กำลังสร้างไฟล์…",
    });
    expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText(
      /สร้างไฟล์ส่งออกได้ครั้งละ 1 คำขอ รอให้ไฟล์ปัจจุบันเสร็จก่อน คำขอที่ยังไม่เสร็จภายใน 60 นาที/,
    );
    expect(screen.getAllByText(reason.textContent)).toHaveLength(1);
    const retries = await screen.findAllByRole("button", {
      name: /^ขอใหม่ CSV/,
    });
    expect(retries).toHaveLength(2);
    for (const control of [button, ...retries]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("aria-describedby", reason.id);
    }
  });
});

describe("export dialog (M-3, M-4)", () => {
  it("starts on the first format, shows the snapshot and the scope note, and scrolls inside", async () => {
    const user = userEvent.setup();
    open({ search: "?categories=member" });
    const dialog = await openDialog(user);
    expect(within(dialog).getByRole("radio", { name: "CSV" })).toHaveFocus();
    expect(within(dialog).getByRole("radio", { name: "CSV" })).toBeChecked();
    expect(
      within(dialog).getByRole("group", { name: "รูปแบบไฟล์" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("ณ โหลดเมื่อ 14:02:11 (Asia/Bangkok)");
    expect(dialog).toHaveTextContent("1,234 รายการ");
    expect(dialog).toHaveTextContent("หมวด สมาชิก");
    expect(dialog).toHaveTextContent("บันทึกเฉพาะการกระทำที่สำเร็จในหมวด");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The content scrolls; the title and the button row do not.
    expect(dialog.querySelector(".overflow-y-auto")).not.toBeNull();
    expect(dialog).not.toHaveClass("overflow-y-auto");
  });

  it("traps Tab inside and returns focus to the button on cancel", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    const cancel = within(dialog).getByRole("button", { name: "ยกเลิก" });
    const create = within(dialog).getByRole("button", { name: "สร้างไฟล์" });
    create.focus();
    await user.tab();
    expect(within(dialog).getByRole("radio", { name: "CSV" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(create).toHaveFocus();
    await user.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await exportButton()).toHaveFocus();
  });

  it("sends the list's asOf and absolute from/to, the zone and the filters", async () => {
    const user = userEvent.setup();
    open({ search: "?categories=member&q=ada&actor=user-1" });
    const dialog = await openDialog(user);
    createMock.mockResolvedValue({ export: makeRecord() });
    await user.click(within(dialog).getByRole("radio", { name: "JSON" }));
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const [organizationId, body] = createMock.mock.calls[0] ?? [];
    const listParams = listMock.mock.calls[0]?.[1];
    expect(organizationId).toBe(ORG_A);
    expect(body).toEqual({
      format: "json",
      timeZone: "Asia/Bangkok",
      filters: {
        from: listParams?.from,
        to: LIST_ASOF,
        categories: ["member"],
        actorUserId: "user-1",
        q: "ada",
      },
      asOf: LIST_ASOF,
    });
  });

  it("keeps a custom range's own from and to", async () => {
    const user = userEvent.setup();
    open({ search: "?range=custom&from=2026-09-26&to=2026-10-02" });
    const dialog = await openDialog(user);
    createMock.mockResolvedValue({ export: makeRecord() });
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalled();
    });
    expect(createMock.mock.calls[0]?.[1].filters).toMatchObject({
      from: "2026-09-25T17:00:00.000Z",
      to: "2026-10-02T16:59:59.999Z",
    });
  });

  it("ignores a second press, Cancel and Escape while the request is out", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    const pending = Promise.withResolvers<{ export: AuditExportRecord }>();
    createMock.mockReturnValue(pending.promise);
    const create = within(dialog).getByRole("button", { name: "สร้างไฟล์" });
    await user.click(create);
    await user.click(create);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(create).toHaveAttribute("aria-busy", "true");
    expect(create).toHaveTextContent("กำลังส่งคำขอ…");
    expect(dialog).toHaveAttribute("aria-busy", "true");
    const cancel = within(dialog).getByRole("button", { name: "ยกเลิก" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    await user.click(cancel);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pending.resolve({ export: makeRecord() });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows the too-large state with the server's total and an aria-disabled button", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(
      new ApiError("AUDIT_EXPORT_TOO_LARGE", "x", 422, {
        limit: 50000,
        total: 61234,
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(
      "ข้อมูลมากเกินไปสำหรับการส่งออกครั้งเดียว ลดช่วงเวลาแล้วลองใหม่ (พบ 61,234 รายการ สูงสุด 50,000)",
    );
    const create = within(dialog).getByRole("button", { name: "สร้างไฟล์" });
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute("aria-describedby", alert.id);
    await user.click(create);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("opens already too large when the list has more than 50,000 rows", async () => {
    const user = userEvent.setup();
    open({ total: 50_001 });
    const dialog = await openDialog(user);
    const create = within(dialog).getByRole("button", { name: "สร้างไฟล์" });
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute(
      "aria-describedby",
      within(dialog).getByRole("alert").id,
    );
    await user.click(create);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("explains an empty result and keeps the choices", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(new ApiError("AUDIT_EXPORT_EMPTY", "x", 422));
    await user.click(within(dialog).getByRole("radio", { name: "JSON" }));
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "ไม่มีรายการให้ส่งออกตามตัวกรองนี้",
    );
    expect(within(dialog).getByRole("radio", { name: "JSON" })).toBeChecked();
  });

  it("closes on 409 and loads the exports again", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(
      new ApiError("AUDIT_EXPORT_IN_PROGRESS", "x", 409),
    );
    const before = exportsMock.mock.calls.length;
    exportsMock.mockResolvedValue(exportList([makeRecord()], true));
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(exportsMock.mock.calls.length).toBeGreaterThan(before);
    });
    expect(
      await screen.findByRole("button", { name: "กำลังสร้างไฟล์…" }),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open with the retry message on a network error", async () => {
    const user = userEvent.setup();
    open();
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "ส่งคำขอส่งออกไม่สำเร็จ ตัวเลือกของคุณยังอยู่ ลองใหม่อีกครั้ง",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("aborts a request that takes more than 15 s and gives Cancel and Escape back (N-4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    open();
    const dialog = await openDialog(user);
    createMock.mockImplementation(
      (_org, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new ApiError("NETWORK_ERROR", "x", 0));
          });
        }),
    );
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    expect(
      within(dialog).getByRole("button", { name: "กำลังส่งคำขอ…" }),
    ).toHaveAttribute("aria-busy", "true");
    await act(() => vi.advanceTimersByTimeAsync(15_001));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "ส่งคำขอส่งออกไม่สำเร็จ ตัวเลือกของคุณยังอยู่",
    );
    expect(
      within(dialog).getByRole("button", { name: "ยกเลิก" }),
    ).not.toHaveAttribute("aria-disabled");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("after the request is accepted (M-1, M-5, N-1)", () => {
  it("shows กำลังสร้างไฟล์… before the refetch lands, then the notice with working links", async () => {
    const user = userEvent.setup();
    const view = open();
    const dialog = await openDialog(user);
    // C6-02: the page's live region is there before the request, empty.
    const region = document.querySelector(
      '[data-slot="export-announcement"]',
    ) as HTMLElement;
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();
    const refetch = Promise.withResolvers<AuditExportListResponse>();
    exportsMock.mockReturnValue(refetch.promise);
    createMock.mockResolvedValue({ export: makeRecord() });
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const button = screen.getByRole("button", { name: "กำลังสร้างไฟล์…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    expect(
      view.queryClient.getQueryData(["tenant", "audit-log", "exports", ORG_A]),
    ).toMatchObject({ inProgress: true });
    expect(
      screen.getByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent(
      "กำลังสร้างไฟล์ เราจะแจ้งใน การแจ้งเตือน เมื่อพร้อมดาวน์โหลด",
    );
    const notice = screen
      .getAllByText(/กำลังสร้างไฟล์ เราจะแจ้งใน/)
      .find((element) => !region.contains(element))
      ?.closest("p") as HTMLElement;
    // The visible notice is not a second live region, so nothing is announced twice.
    expect(notice).not.toHaveAttribute("role");
    expect(
      within(notice).getByRole("link", { name: "การแจ้งเตือน" }),
    ).toHaveAttribute("href", "/notifications");
    const showFiles = screen.getByRole("link", { name: "ดูไฟล์ส่งออกของฉัน" });
    expect(notice).not.toContainElement(showFiles);
    await user.click(showFiles);
    expect(
      screen.getByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
    ).toHaveFocus();
    const close = screen.getByRole("button", { name: "ปิดข้อความ" });
    expect(notice).not.toContainElement(close);
    await user.click(close);
    expect(screen.queryByText(/กำลังสร้างไฟล์ เราจะแจ้งใน/)).toBeNull();
    expect(region).toBeEmptyDOMElement();
    expect(button).toHaveFocus();
    refetch.resolve(
      exportList(
        [
          makeRecord({
            status: "ready",
            expiresAt: "2026-10-04T07:07:30.000Z",
          }),
        ],
        false,
      ),
    );
    expect(
      await screen.findByRole("button", { name: "ส่งออก" }),
    ).toBeInTheDocument();
  });
});

describe("my exports section (M-8, M-6, M-9, N-3)", () => {
  it("is a captioned table with one live region and rows with their own button names", async () => {
    open({
      rows: [
        makeRecord({
          id: "11111111-1111-4111-8111-111111111111",
          status: "ready",
          expiresAt: "2026-10-04T07:07:30.000Z",
          filters: {
            ...makeRecord().filters,
            q: "secret-term",
            actorUserId: "user-1",
          },
        }),
        makeRecord({
          id: "22222222-2222-4222-8222-222222222222",
          format: "json",
          status: "expired",
        }),
      ],
    });
    await sectionHeading();
    const table = screen.getByRole("table", { name: "ไฟล์ส่งออกของฉัน" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["รูปแบบ", "ขอบเขต", "ขอเมื่อ", "สถานะ", "การดำเนินการ"]);
    const first = row(0);
    expect(first).toHaveTextContent(
      "2026-09-26 00:00:00 – 2026-10-03 14:02:00 (Asia/Bangkok)",
    );
    expect(first).toHaveTextContent("หมวด สมาชิก");
    expect(first).toHaveTextContent("มีการค้นหาข้อความ");
    expect(first).not.toHaveTextContent("secret-term");
    expect(first).toHaveTextContent("2026-10-03 14:05:10 Asia/Bangkok");
    expect(first).toHaveTextContent(
      "พร้อมดาวน์โหลด · ดาวน์โหลดได้ถึง 2026-10-04 14:07:30 Asia/Bangkok",
    );
    expect(
      within(first).getByRole("button", {
        name: "ดาวน์โหลด CSV ที่ขอเมื่อ 2026-10-03 14:05",
      }),
    ).toBeInTheDocument();
    expect(row(1)).toHaveTextContent("หมดอายุ · ไฟล์หมดอายุแล้ว");
    expect(
      within(row(1)).getByRole("button", {
        name: "ขอใหม่ JSON ที่ขอเมื่อ 2026-10-03 14:05",
      }),
    ).not.toHaveAttribute("aria-disabled");
    const section = document.getElementById("my-exports") as HTMLElement;
    expect(within(section).getAllByRole("status")).toHaveLength(1);
  });

  it("hides the section when there are no requests", async () => {
    open({ rows: [] });
    await screen.findByRole("table");
    await waitFor(() => {
      expect(exportsMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
    ).toBeNull();
  });

  it.each([
    [
      "EXPORT_TOO_LARGE",
      "ไฟล์ใหญ่เกิน 25 MiB ขอใหม่ด้วยขอบเขตเดิมจะล้มเหลวอีก ลดช่วงเวลาหรือเพิ่มตัวกรองก่อน",
    ],
    [
      "EXPORT_FAILED",
      "สร้างไฟล์ไม่สำเร็จเพราะระบบขัดข้อง ขอใหม่ได้ด้วยขอบเขตเดิม",
    ],
    [
      "REQUESTER_NOT_AUTHORIZED",
      "สร้างไฟล์ไม่สำเร็จเพราะสิทธิ์ส่งออกของคุณเปลี่ยนระหว่างสร้าง",
    ],
  ] as const)("explains a failed row: %s", async (failureCode, text) => {
    open({ rows: [makeRecord({ status: "failed", failureCode })] });
    await sectionHeading();
    expect(row(0)).toHaveTextContent(`ล้มเหลว · ${text}`);
    expect(
      within(row(0)).getByRole("button", { name: /^ขอใหม่/ }),
    ).toBeInTheDocument();
  });

  it("writes the row's scope into the filters and focuses the filter section from ปรับตัวกรอง", async () => {
    const user = userEvent.setup();
    open({
      rows: [
        makeRecord({
          status: "failed",
          failureCode: "EXPORT_TOO_LARGE",
          filters: {
            ...makeRecord().filters,
            categories: ["member", "monitor"],
            actorUserId: "user-1",
            q: "ada",
          },
        }),
      ],
    });
    await sectionHeading();
    const adjust = within(row(0)).getByRole("button", { name: /^ปรับตัวกรอง/ });
    const retry = within(row(0)).getByRole("button", { name: /^ขอใหม่/ });
    expect(adjust.className).toContain("bg-primary");
    expect(retry.className).not.toContain("bg-primary");
    await user.click(adjust);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `?range=custom&from=2026-09-26&to=2026-10-03&categories=member%2Cmonitor&actor=user-1&q=ada`,
      );
    });
    expect(screen.getByRole("heading", { name: "ตัวกรอง" })).toHaveFocus();
    // The day range covers the row's instants: 2026-09-26 00:00 Bangkok is before 25 17:00Z.
    await waitFor(() => {
      expect(listMock.mock.calls.at(-1)?.[1]).toMatchObject({
        from: "2026-09-25T17:00:00.000Z",
        to: "2026-10-03T16:59:59.999Z",
      });
    });
  });

  it.each([["failed"], ["expired"]] as const)(
    "ขอใหม่ on a %s row posts the row's absolute scope with asOf now and keeps focus on the button",
    async (status) => {
      const user = userEvent.setup();
      const now = new Date("2026-10-03T08:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      const record = makeRecord({
        status,
        failureCode: status === "failed" ? "EXPORT_FAILED" : null,
        format: "json",
        filters: { ...makeRecord().filters, actorUserId: "user-1", q: "ada" },
      });
      open({ rows: [record] });
      await sectionHeading();
      const created = makeRecord({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        requestedAt: now.toISOString(),
      });
      createMock.mockResolvedValue({ export: created });
      exportsMock.mockResolvedValue(exportList([created, record], true));
      const retry = within(row(0)).getByRole("button", { name: /^ขอใหม่/ });
      await user.click(retry);
      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });
      expect(createMock.mock.calls[0]?.[1]).toEqual({
        format: "json",
        timeZone: "Asia/Bangkok",
        filters: {
          from: record.filters.from,
          to: record.filters.to,
          categories: ["member"],
          actorUserId: "user-1",
          q: "ada",
        },
        asOf: now.toISOString(),
      });
      // N-1: no dialog and no second notice; focus stays on the (now aria-disabled) button.
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(/กำลังสร้างไฟล์ เราจะแจ้งใน/)).toBeNull();
      await waitFor(() => {
        expect(retry).toHaveAttribute("aria-disabled", "true");
      });
      expect(retry).toHaveFocus();
      expect(
        screen.getByRole("button", { name: "กำลังสร้างไฟล์…" }),
      ).toBeInTheDocument();
    },
  );

  it.each([
    [
      new ApiError("AUDIT_EXPORT_TOO_LARGE", "x", 422, {
        limit: 50000,
        total: 70000,
      }),
      "ข้อมูลมากเกินไปสำหรับการส่งออกครั้งเดียว ลดช่วงเวลาแล้วลองใหม่ (พบ 70,000 รายการ สูงสุด 50,000)",
    ],
    [
      new ApiError("AUDIT_EXPORT_EMPTY", "x", 422),
      "ไม่มีรายการให้ส่งออกตามตัวกรองนี้",
    ],
    [
      new ApiError("AUDIT_EXPORT_IN_PROGRESS", "x", 409),
      "สร้างไฟล์ส่งออกได้ครั้งละ 1 คำขอ รอให้ไฟล์ปัจจุบันเสร็จก่อน",
    ],
    [
      new ApiError("NETWORK_ERROR", "x", 0),
      "ส่งคำขอส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง",
    ],
  ])(
    "shows a ขอใหม่ error in the row with role=alert (%#)",
    async (error, text) => {
      const user = userEvent.setup();
      open({
        rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
      });
      await sectionHeading();
      createMock.mockRejectedValue(error);
      const retry = within(row(0)).getByRole("button", { name: /^ขอใหม่/ });
      await user.click(retry);
      const alert = await within(row(0)).findByRole("alert");
      expect(alert).toHaveTextContent(text);
      expect(retry).toHaveAttribute("aria-describedby", alert.id);
    },
  );

  it("polls every 5 s, announces a status change once and refreshes the notifications", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const generating = makeRecord();
    const view = open({ rows: [generating] });
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    await sectionHeading();
    const callsBefore = exportsMock.mock.calls.length;
    exportsMock.mockResolvedValue(
      exportList([
        {
          ...generating,
          status: "ready",
          expiresAt: "2026-10-04T07:07:30.000Z",
        },
      ]),
    );
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    const section = document.getElementById("my-exports") as HTMLElement;
    await waitFor(() => {
      expect(within(section).getByRole("status")).toHaveTextContent(
        "ไฟล์ CSV ที่ขอเมื่อ 2026-10-03 14:05:10 Asia/Bangkok พร้อมดาวน์โหลด",
      );
    });
    expect(exportsMock.mock.calls.length).toBe(callsBefore + 1);
    expect(row(0)).toHaveTextContent("พร้อมดาวน์โหลด");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["tenant", "notifications"],
    });
    // Nothing is generating any more, so the polling stops.
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(exportsMock.mock.calls.length).toBe(callsBefore + 1);
  });

  it("keeps the rows and offers ลองใหม่ when a poll fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    open({ rows: [makeRecord()] });
    await sectionHeading();
    exportsMock.mockRejectedValue(new ApiError("NETWORK_ERROR", "x", 0));
    await act(() => vi.advanceTimersByTimeAsync(8_000));
    expect(
      await screen.findByText("ข้อมูลอาจไม่เป็นปัจจุบัน"),
    ).toBeInTheDocument();
    expect(row(0)).toHaveTextContent("กำลังสร้าง");
    exportsMock.mockResolvedValue(
      exportList([
        makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" }),
      ]),
    );
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    await waitFor(() => {
      expect(row(0)).toHaveTextContent("ล้มเหลว");
    });
    expect(screen.queryByText("ข้อมูลอาจไม่เป็นปัจจุบัน")).toBeNull();
  });
});

describe("download (M-7)", () => {
  const ready = makeRecord({
    status: "ready",
    expiresAt: "2026-10-04T07:07:30.000Z",
  });
  let click: MockInstance<() => void>;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });

  it("saves the file under the name from the header and shows กำลังดาวน์โหลด… meanwhile", async () => {
    const user = userEvent.setup();
    open({ rows: [ready] });
    await sectionHeading();
    const pending = Promise.withResolvers<{
      blob: Blob;
      filename: string | null;
    }>();
    downloadMock.mockReturnValue(pending.promise);
    const button = within(row(0)).getByRole("button", { name: /^ดาวน์โหลด/ });
    let download = "";
    click.mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
    });
    await user.click(button);
    expect(button).toHaveTextContent("กำลังดาวน์โหลด…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    pending.resolve({
      blob: new Blob(["a"]),
      filename: "nightwatch-audit-log.csv",
    });
    await waitFor(() => {
      expect(button).toHaveTextContent("ดาวน์โหลด");
    });
    expect(download).toBe("nightwatch-audit-log.csv");
    expect(downloadMock).toHaveBeenCalledWith(
      ORG_A,
      ready.id,
      expect.any(AbortSignal),
    );
  });

  it.each([
    [
      new ApiError("AUDIT_EXPORT_NOT_FOUND", "x", 404),
      "ไม่พบไฟล์นี้ โหลดรายการล่าสุดแล้ว",
      true,
    ],
    [
      new ApiError("AUDIT_EXPORT_NOT_READY", "x", 409),
      "ไฟล์ยังไม่พร้อม โหลดรายการล่าสุดแล้ว",
      true,
    ],
    [
      new ApiError("NETWORK_ERROR", "x", 0),
      "ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง",
      false,
    ],
  ])("reports %# in the row", async (error, text, refetches) => {
    const user = userEvent.setup();
    open({ rows: [ready] });
    await sectionHeading();
    downloadMock.mockRejectedValue(error);
    const before = exportsMock.mock.calls.length;
    await user.click(
      within(row(0)).getByRole("button", { name: /^ดาวน์โหลด/ }),
    );
    expect(await within(row(0)).findByRole("alert")).toHaveTextContent(text);
    if (refetches) {
      await waitFor(() => {
        expect(exportsMock.mock.calls.length).toBeGreaterThan(before);
      });
    } else {
      expect(exportsMock.mock.calls.length).toBe(before);
    }
  });

  it("turns the row into expired with ขอใหม่ on 410", async () => {
    const user = userEvent.setup();
    open({ rows: [ready] });
    await sectionHeading();
    downloadMock.mockRejectedValue(
      new ApiError("AUDIT_EXPORT_EXPIRED", "x", 410),
    );
    await user.click(
      within(row(0)).getByRole("button", { name: /^ดาวน์โหลด/ }),
    );
    await waitFor(() => {
      expect(row(0)).toHaveTextContent("หมดอายุ · ไฟล์หมดอายุแล้ว");
    });
    expect(
      within(row(0)).getByRole("button", { name: /^ขอใหม่/ }),
    ).toBeInTheDocument();
    expect(
      within(row(0)).queryByRole("button", { name: /^ดาวน์โหลด/ }),
    ).toBeNull();
  });
});

describe("403 during export (B-2, AC-06, AC-23)", () => {
  const notice = () =>
    screen.findByText(
      "สิทธิ์ส่งออกของคุณเปลี่ยนแล้ว คุณยังดูบันทึกกิจกรรมได้ แต่ส่งออกและดาวน์โหลดไฟล์ไม่ได้",
    );

  async function expectRevoked(queryClient: QueryClient, exportsCalls: number) {
    const text = await notice();
    const box = text.closest("[data-slot='action-notice']") as HTMLElement;
    expect(box).toHaveFocus();
    expect(text.closest("p")).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("button", { name: /^(ส่งออก|กำลังสร้างไฟล์…)$/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
    ).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The list stays readable and the exports stop being asked.
    expect(
      screen.getByRole("region", { name: "ตารางบันทึกกิจกรรม" }),
    ).toBeInTheDocument();
    expect(
      queryClient.getQueryData(["tenant", "audit-log", "exports", ORG_A]),
    ).toBeUndefined();
    expect(queryClient.getQueryState(ME_CONTEXT_QUERY_KEY)?.isInvalidated).toBe(
      true,
    );
    await act(() => Promise.resolve());
    expect(exportsMock.mock.calls.length).toBe(exportsCalls);
  }
  const seeded = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
      user: { id: "user-1" },
      organizations: [],
      lastActiveTenantId: ORG_A,
    });
    return queryClient;
  };

  it("handles a 403 from the exports list", async () => {
    const queryClient = seeded();
    open({ queryClient, exportsError: denied("PERMISSION_DENIED") });
    await notice();
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("handles a 403 from the POST and closes the dialog", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    const dialog = await openDialog(user);
    createMock.mockRejectedValue(denied("PERMISSION_DENIED"));
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("handles a 403 from ขอใหม่", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    createMock.mockRejectedValue(denied("PERMISSION_DENIED"));
    await user.click(within(row(0)).getByRole("button", { name: /^ขอใหม่/ }));
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("handles a 403 from a download", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [
        makeRecord({ status: "ready", expiresAt: "2026-10-04T07:07:30.000Z" }),
      ],
    });
    await sectionHeading();
    downloadMock.mockRejectedValue(denied("PERMISSION_DENIED"));
    await user.click(
      within(row(0)).getByRole("button", { name: /^ดาวน์โหลด/ }),
    );
    await expectRevoked(queryClient, exportsMock.mock.calls.length);
  });

  it("sends MEMBERSHIP_DENIED to the page's denied card", async () => {
    open({ exportsError: denied("MEMBERSHIP_DENIED") });
    const heading = await screen.findByRole("heading", {
      name: "เข้าถึงบันทึกกิจกรรมไม่ได้",
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByText("คุณไม่ใช่สมาชิกขององค์กรนี้")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ตารางบันทึกกิจกรรม" }),
    ).toBeNull();
  });
});

describe("requests in flight when the scope retires or the page unmounts", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const retireScope = (queryClient: QueryClient) => {
    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim);
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
        user: { id: "user-1" },
        organizations: [],
        lastActiveTenantId: OTHER,
      });
      publishContextPublication(queryClient, claim);
    });
  };
  const seeded = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
      user: { id: "user-1" },
      organizations: [],
      lastActiveTenantId: ORG_A,
    });
    return queryClient;
  };
  // A server that ignores the abort and answers 201 later must still change nothing.
  const lateCreated = () => {
    const late = Promise.withResolvers<{ export: AuditExportRecord }>();
    let signal: AbortSignal | undefined;
    createMock.mockImplementation((_org, _body, given) => {
      signal = given;
      return late.promise;
    });
    return { late, signalOf: () => signal };
  };
  const exportsKey = ["tenant", "audit-log", "exports", ORG_A];

  it("aborts the dialog's POST when the scope retires and shows nothing afterwards", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({ queryClient });
    const dialog = await openDialog(user);
    const { late, signalOf } = lateCreated();
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await waitFor(() => {
      expect(signalOf()).toBeDefined();
    });
    retireScope(queryClient);
    expect(signalOf()?.aborted).toBe(true);
    late.resolve({ export: makeRecord() });
    await act(() => Promise.resolve());
    expect(screen.queryByText(/กำลังสร้างไฟล์ เราจะแจ้งใน/)).toBeNull();
    expect(
      document.querySelector('[data-slot="export-announcement"]')
        ?.textContent ?? "",
    ).toBe("");
    expect(queryClient.getQueryData(exportsKey)).not.toMatchObject({
      inProgress: true,
    });
  });

  it("aborts the POST when the page unmounts", async () => {
    const user = userEvent.setup();
    const view = open();
    const dialog = await openDialog(user);
    const { late, signalOf } = lateCreated();
    await user.click(within(dialog).getByRole("button", { name: "สร้างไฟล์" }));
    await waitFor(() => {
      expect(signalOf()).toBeDefined();
    });
    view.unmount();
    expect(signalOf()?.aborted).toBe(true);
    late.resolve({ export: makeRecord() });
    await act(() => Promise.resolve());
    expect(view.queryClient.getQueryData(exportsKey)).not.toMatchObject({
      inProgress: true,
    });
  });

  it("aborts a ขอใหม่ POST when the scope retires and writes nothing", async () => {
    const user = userEvent.setup();
    const queryClient = seeded();
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    const { late, signalOf } = lateCreated();
    await user.click(within(row(0)).getByRole("button", { name: /^ขอใหม่/ }));
    await waitFor(() => {
      expect(signalOf()).toBeDefined();
    });
    retireScope(queryClient);
    expect(signalOf()?.aborted).toBe(true);
    late.resolve({
      export: makeRecord({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    });
    await act(() => Promise.resolve());
    expect(queryClient.getQueryData(exportsKey)).not.toMatchObject({
      inProgress: true,
    });
  });

  it("aborts a download when the page unmounts and shows no error", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const view = open({
      rows: [
        makeRecord({ status: "ready", expiresAt: "2026-10-04T07:07:30.000Z" }),
      ],
    });
    await sectionHeading();
    let signal: AbortSignal | undefined;
    const late = Promise.withResolvers<{
      blob: Blob;
      filename: string | null;
    }>();
    downloadMock.mockImplementation((_org, _id, given) => {
      signal = given;
      return late.promise;
    });
    await user.click(
      within(row(0)).getByRole("button", { name: /^ดาวน์โหลด/ }),
    );
    await waitFor(() => {
      expect(signal).toBeDefined();
    });
    view.unmount();
    expect(signal?.aborted).toBe(true);
    late.resolve({ blob: new Blob(["a"]), filename: "x.csv" });
    await act(() => Promise.resolve());
    expect(click).not.toHaveBeenCalled();
  });
});

describe("hash and Organization scope (M-10, AC-07)", () => {
  it("focuses the section heading when opened with #my-exports", async () => {
    open({
      hash: "#my-exports",
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    const heading = await sectionHeading();
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it("opens at the top for an auditor, whose section does not render", async () => {
    open({ role: "auditor", hash: "#my-exports" });
    await screen.findByRole("table");
    expect(
      screen.queryByRole("heading", { name: "ไฟล์ส่งออกของฉัน" }),
    ).toBeNull();
    expect(document.body).toHaveFocus();
  });

  it("leaves no export row of A on screen once the active Organization moves to B", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const confirmed = {
      user: { id: "user-1" },
      organizations: [],
      lastActiveTenantId: ORG_A,
    };
    queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, confirmed);
    open({
      queryClient,
      rows: [makeRecord({ status: "failed", failureCode: "EXPORT_FAILED" })],
    });
    await sectionHeading();
    act(() => {
      const claim = createContextPublicationClaim();
      claimContextPublication(queryClient, claim);
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, {
        ...confirmed,
        lastActiveTenantId: "22222222-2222-4222-8222-222222222222",
      });
      publishContextPublication(queryClient, claim);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("table", { name: "ไฟล์ส่งออกของฉัน" }),
      ).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "ส่งออก" })).toBeNull();
  });
});
