import type {
  InventoryImportList,
  InventoryImportRecord,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchImports } from "../../lib/api/inventory";
import { PREFERENCES_KEY } from "../../lib/preferences";
import { ImportHistory } from "./ImportHistory";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchImports: vi.fn(),
}));

const fetchMock = vi.mocked(fetchImports);

const id = (n: number) =>
  `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;
const record = (
  n: number,
  overrides: Partial<InventoryImportRecord> = {},
): InventoryImportRecord => ({
  id: id(n),
  fileName: "inventory-q4.csv",
  importedAt: "2026-11-21T20:30:00.000Z",
  importedBy: "สมชาย",
  added: 2,
  updated: 1,
  unchanged: 3,
  skipped: 4,
  failed: 5,
  ...overrides,
});
const list = (
  imports: InventoryImportRecord[],
  total = imports.length,
  page = 1,
): InventoryImportList => ({ imports, total, page, pageSize: 20 });

function renderHistory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ImportHistory organizationId={ORG} projectId={PROJECT} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({
      language: "th",
      timeZone: "Pacific/Auckland",
      hourCycle: "h23",
      weekStart: "monday",
    }),
  );
});
afterEach(() => {
  localStorage.removeItem(PREFERENCES_KEY);
});

describe("ImportHistory", () => {
  it("lists time in the viewer's time zone, importer, file name and the five counts as a table", async () => {
    fetchMock.mockResolvedValue(
      list([
        record(1),
        record(2, {
          fileName: "q3.xlsx",
          importedBy: null,
          importedAt: "2026-11-20T01:00:00.000Z",
          added: 0,
          updated: 0,
          unchanged: 9,
          skipped: 0,
          failed: 0,
        }),
      ]),
    );
    renderHistory();

    const table = await screen.findByRole("table");
    expect(
      screen.getByRole("region", { name: "รายการ import" }),
    ).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "เวลา",
      "ผู้ import",
      "ไฟล์",
      "เพิ่ม",
      "อัปเดต",
      "ไม่เปลี่ยน",
      "ข้าม",
      "ไม่ผ่าน",
    ]);
    const [first, second] = screen.getAllByTestId(/^inventory-import-record-/);
    // 2026-11-21T20:30Z is already 22 November in Auckland (UTC+13).
    expect(
      within(first as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "2026-11-22 09:30",
      "สมชาย",
      "inventory-q4.csv",
      "2",
      "1",
      "3",
      "4",
      "5",
    ]);
    expect(
      within(second as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "2026-11-20 14:00",
      "ไม่ทราบผู้ทำรายการ",
      "q3.xlsx",
      "0",
      "0",
      "9",
      "0",
      "0",
    ]);
    expect(fetchMock.mock.calls[0]?.slice(0, 3)).toEqual([
      ORG,
      PROJECT,
      { page: 1 },
    ]);
    // Nothing here changes by itself, so nothing is announced.
    expect(
      screen.getByTestId("inventory-import-history").closest("[aria-live]"),
    ).toBeNull();
    expect(screen.queryByTestId("inventory-import-history-nav")).toBeNull();
  });

  it("truncates a long file name and keeps the whole name in the title and the text", async () => {
    const long = `${"inventory-".repeat(30)}q4.csv`;
    fetchMock.mockResolvedValue(list([record(1, { fileName: long })]));
    renderHistory();

    const name = await screen.findByTitle(long);
    expect(name).toHaveTextContent(long);
    expect(name).toHaveClass("truncate");
  });

  it("says there is no history yet", async () => {
    fetchMock.mockResolvedValue(list([]));
    renderHistory();

    expect(
      await screen.findByTestId("inventory-import-history-empty"),
    ).toHaveTextContent("ยังไม่มีประวัติ import");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows loading under the page, then a retryable error", async () => {
    let fail: (error: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    renderHistory();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "กำลังโหลดประวัติ import",
    );

    fail(new ApiError("PROJECT_NOT_FOUND", "x", 404));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ไม่พบข้อมูลที่ขอ",
    );
    fetchMock.mockResolvedValueOnce(list([record(1)]));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("pages with icon buttons that carry their label, and announces the page it moved to", async () => {
    const first = Array.from({ length: 20 }, (_, n) => record(n + 1));
    const second = Array.from({ length: 5 }, (_, n) => record(n + 21));
    fetchMock.mockImplementation((_org, _project, query) =>
      Promise.resolve(
        query.page === 2 ? list(second, 25, 2) : list(first, 25, 1),
      ),
    );
    const user = userEvent.setup();
    renderHistory();

    const nav = await screen.findByRole("navigation", {
      name: "เปลี่ยนหน้าประวัติ import",
    });
    const previous = within(nav).getByRole("button", { name: "หน้าก่อนหน้า" });
    const next = within(nav).getByRole("button", { name: "หน้าถัดไป" });
    expect(previous).toBeDisabled();
    expect(
      screen.getByTestId("inventory-import-history-page"),
    ).toHaveTextContent("1-20 จาก 25 · หน้า 1/2");
    await user.click(next);

    await waitFor(() => {
      expect(
        screen.getByTestId("inventory-import-history-page"),
      ).toHaveTextContent("21-25 จาก 25 · หน้า 2/2");
    });
    expect(screen.getAllByTestId(/^inventory-import-record-/)).toHaveLength(5);
    expect(fetchMock.mock.calls.map((call) => call[2])).toContainEqual({
      page: 2,
    });
    expect(
      screen
        .getByTestId("inventory-import-history-page")
        .closest("[aria-live='polite']"),
    ).not.toBeNull();
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
  });
});
