import type {
  InventoryRowItem,
  InventoryRowList,
  InventorySummary,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  createRow,
  deleteRow,
  fetchRows,
  updateRow,
} from "../../lib/api/inventory";
import { InventoryRowsSection } from "./InventoryRowsSection";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const HR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ROW_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ROW_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const BASE = `/organizations/${ORG}/projects/${PROJECT}/inventory`;

vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRows: vi.fn(),
  createRow: vi.fn(),
  updateRow: vi.fn(),
  deleteRow: vi.fn(),
}));

const fetchMock = vi.mocked(fetchRows);
const createMock = vi.mocked(createRow);
const updateMock = vi.mocked(updateRow);
const deleteMock = vi.mocked(deleteRow);

function row(overrides: Partial<InventoryRowItem> = {}): InventoryRowItem {
  return {
    id: ROW_A,
    systemId: BILLING,
    systemName: "Billing API",
    owner: "ทีม Payment",
    vendor: "Canonical",
    product: "Ubuntu",
    version: "22.04.4",
    layer: "OS",
    environment: "Production",
    exposure: "Internal",
    usable: true,
    issues: [],
    duplicate: false,
    revision: 3,
    source: {
      kind: "import",
      fileName: "inventory-q4.xlsx",
      changedBy: "สมชาย",
      changedAt: "2026-11-20T09:42:00.000Z",
    },
    ...overrides,
  };
}

function list(
  rows: InventoryRowItem[],
  total = rows.length,
  page = 1,
): InventoryRowList {
  return { rows, total, page, pageSize: 25 };
}

// Like the API: the page asked for is the page answered.
function pagedRows(total: number) {
  return (_org: string, _project: string, query: { page?: number }) =>
    Promise.resolve(list([row()], total, query.page ?? 1));
}

function summary(overrides: Partial<InventorySummary> = {}): InventorySummary {
  return {
    canUpload: true,
    mappings: { pending: 0, confirmed: 0, unmapped: 0 },
    systemCount: 2,
    totalRows: 2,
    usableRows: 2,
    lastUploadAt: "2026-11-20T09:42:00.000Z",
    lastUploadFileName: "inventory-q4.xlsx",
    systems: [
      {
        id: BILLING,
        name: "Billing API",
        owners: ["ทีม Payment"],
        totalRows: 1,
        usableRows: 1,
        lowQuality: false,
        fileName: "inventory-q4.xlsx",
        uploadedAt: "2026-11-20T09:42:00.000Z",
      },
      {
        id: HR,
        name: "HR Portal",
        owners: ["ทีม HR"],
        totalRows: 1,
        usableRows: 0,
        lowQuality: true,
        fileName: "inventory-q4.xlsx",
        uploadedAt: "2026-11-20T09:42:00.000Z",
      },
    ],
    ...overrides,
  };
}

function renderSection(
  props: { summary?: InventorySummary; search?: string } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: BASE,
        element: (
          <InventoryRowsSection
            summary={props.summary ?? summary()}
            scope={{ organizationId: ORG, projectId: PROJECT }}
          />
        ),
      },
    ],
    { initialEntries: [`${BASE}${props.search ?? ""}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const filled = {
  owner: "ทีม Payment",
  vendor: "Canonical",
  product: "Ubuntu",
  version: "22.04.4",
  layer: "OS",
  environment: "Production",
  exposure: "Internal",
};

beforeEach(() => {
  fetchMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
});

describe("InventoryRowsSection table", () => {
  it("lists each row with its reasons per column and where its last change came from", async () => {
    fetchMock.mockResolvedValue(
      list([
        row(),
        row({
          id: ROW_B,
          systemId: HR,
          systemName: "HR Portal",
          version: "22.04",
          usable: false,
          issues: [{ column: "Version", code: "version_not_patch_level" }],
          duplicate: true,
          source: {
            kind: "manual",
            fileName: null,
            changedBy: "สมหญิง",
            changedAt: "2026-11-21T01:00:00.000Z",
          },
        }),
      ]),
    );
    renderSection();

    const first = await screen.findByTestId(`inventory-row-${ROW_A}`);
    expect(within(first).getByText("ใช้งานได้")).toBeInTheDocument();
    expect(
      within(first).getByRole("link", { name: "Billing API" }),
    ).toHaveAttribute("href", `${BASE}/systems/${BILLING}`);
    expect(
      screen.getByTestId(`inventory-row-source-${ROW_A}`),
    ).toHaveTextContent("import จาก inventory-q4.xlsx");
    expect(
      screen.getByTestId(`inventory-row-source-${ROW_A}`),
    ).toHaveTextContent("สมชาย");
    const second = screen.getByTestId(`inventory-row-${ROW_B}`);
    expect(within(second).getByText("ไม่ผ่าน")).toBeInTheDocument();
    expect(within(second).getByText("key ซ้ำ")).toBeInTheDocument();
    expect(second).toHaveTextContent("ไม่ถึง patch level");
    expect(
      screen.getByTestId(`inventory-row-source-${ROW_B}`),
    ).toHaveTextContent("แก้ในระบบ");
    expect(screen.getByTestId("inventory-rows-summary")).toHaveTextContent(
      "2 แถว",
    );
    expect(
      screen.getByTestId("inventory-rows-summary").closest("[aria-live]"),
    ).not.toBeNull();
  });

  it("reads its filters and page from the address and asks the API for exactly them", async () => {
    fetchMock.mockResolvedValue(list([row()], 60, 2));
    renderSection({
      search: `?system=${HR}&layer=DB&status=rejected&q=redis&page=2`,
    });

    await screen.findByTestId(`inventory-row-${ROW_A}`);
    expect(fetchMock.mock.calls[0]?.[2]).toEqual({
      system: HR,
      layer: "DB",
      status: "rejected",
      q: "redis",
      page: 2,
    });
    expect(screen.getByTestId("inventory-rows-system")).toHaveValue(HR);
    expect(screen.getByTestId("inventory-rows-layer")).toHaveValue("DB");
    expect(screen.getByTestId("inventory-rows-search")).toHaveValue("redis");
    expect(
      screen.getByTestId("inventory-rows-status-rejected"),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("puts a changed filter in the address and returns to the first page", async () => {
    fetchMock.mockImplementation(pagedRows(60));
    const user = userEvent.setup();
    const router = renderSection({ search: "?page=2" });
    await screen.findByTestId(`inventory-row-${ROW_A}`);

    await user.selectOptions(screen.getByTestId("inventory-rows-layer"), "DB");
    await waitFor(() => {
      expect(router.state.location.search).toBe("?layer=DB");
    });
    await user.click(screen.getByTestId("inventory-rows-status-duplicate"));
    await waitFor(() => {
      expect(router.state.location.search).toBe("?layer=DB&status=duplicate");
    });
    await user.type(
      screen.getByTestId("inventory-rows-search"),
      " Redis {Enter}",
    );
    await waitFor(() => {
      expect(router.state.location.search).toBe(
        "?layer=DB&status=duplicate&q=Redis",
      );
    });
    expect(fetchMock.mock.calls.at(-1)?.[2]).toEqual({
      layer: "DB",
      status: "duplicate",
      q: "Redis",
      page: 1,
    });
  });

  it("changes page with icon buttons whose tooltip is their label", async () => {
    fetchMock.mockImplementation(pagedRows(60));
    const user = userEvent.setup();
    const router = renderSection({ search: "?page=2" });
    await screen.findByTestId(`inventory-row-${ROW_A}`);

    const next = screen.getByRole("button", { name: "หน้าถัดไป" });
    const previous = screen.getByRole("button", { name: "หน้าก่อนหน้า" });
    expect(screen.getByTestId("inventory-rows-page")).toHaveTextContent(
      "26-50 จาก 60 · หน้า 2/3",
    );
    await user.hover(previous);
    expect(screen.getByTestId("tooltip")).toHaveTextContent("หน้าก่อนหน้า");
    await user.click(next);
    await waitFor(() => {
      expect(router.state.location.search).toBe("?page=3");
    });
    await user.click(previous);
    await waitFor(() => {
      expect(router.state.location.search).toBe("?page=2");
    });
  });

  it("says no row matches the filter, apart from an empty inventory, and clears the filters", async () => {
    fetchMock.mockImplementation((_org, _project, query) =>
      Promise.resolve(query.status === "rejected" ? list([]) : list([row()])),
    );
    const user = userEvent.setup();
    const router = renderSection({ search: "?status=rejected&layer=DB" });

    expect(await screen.findByText("ไม่มีแถวตามตัวกรอง")).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-rows-empty")).toBeNull();
    await user.click(screen.getByTestId("inventory-rows-clear"));
    expect(
      await screen.findByTestId(`inventory-row-${ROW_A}`),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
  });

  it("shows an empty inventory without the filter message when nothing is filtered", async () => {
    fetchMock.mockResolvedValue(list([]));
    renderSection();

    expect(
      await screen.findByTestId("inventory-rows-empty"),
    ).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีแถวตามตัวกรอง")).toBeNull();
  });

  it("shows a retryable error under the header when the rows cannot be read", async () => {
    fetchMock.mockRejectedValueOnce(new ApiError("X", "x", 503));
    fetchMock.mockResolvedValue(list([row()]));
    const user = userEvent.setup();
    renderSection();

    expect(
      await screen.findByText("บริการ inventory ยังไม่พร้อม"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(
      await screen.findByTestId(`inventory-row-${ROW_A}`),
    ).toBeInTheDocument();
  });

  it("offers no add, edit or delete control to a member who cannot manage the Project", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    renderSection({ summary: summary({ canUpload: false }) });

    await screen.findByTestId(`inventory-row-${ROW_A}`);
    expect(screen.queryByTestId("inventory-row-add")).toBeNull();
    expect(screen.queryByTestId(`inventory-row-edit-${ROW_A}`)).toBeNull();
    expect(screen.queryByTestId(`inventory-row-delete-${ROW_A}`)).toBeNull();
    expect(screen.queryByRole("button", { name: /แก้แถว|ลบแถว/ })).toBeNull();
  });
});

describe("InventoryRowsSection editing", () => {
  it("labels the row actions for each row and shows the text as a tooltip on keyboard focus", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    const user = userEvent.setup();
    renderSection();
    const edit = await screen.findByRole("button", {
      name: "แก้แถว Ubuntu 22.04.4",
    });
    expect(
      screen.getByRole("button", { name: "ลบแถว Ubuntu 22.04.4" }),
    ).toBeInTheDocument();

    edit.focus();
    expect(await screen.findByTestId("tooltip")).toHaveTextContent(
      "แก้แถว Ubuntu 22.04.4",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("adds a row with every column, keeps what was typed when a rule fails, then saves", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    createMock.mockRejectedValueOnce(
      new ApiError("INVENTORY_ROW_INVALID", "x", 400, {
        issues: [
          { column: "Version", code: "version_not_patch_level" },
          { column: "Layer", code: "required" },
        ],
      }),
    );
    createMock.mockResolvedValueOnce(row({ id: ROW_B }));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId("inventory-row-add"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("inventory-row-owner")).toHaveFocus();
    await user.selectOptions(
      within(dialog).getByTestId("inventory-row-system"),
      HR,
    );
    await user.type(
      within(dialog).getByTestId("inventory-row-owner"),
      "ทีม HR",
    );
    await user.type(
      within(dialog).getByTestId("inventory-row-vendor"),
      "Canonical",
    );
    await user.type(
      within(dialog).getByTestId("inventory-row-product"),
      "Ubuntu",
    );
    await user.type(
      within(dialog).getByTestId("inventory-row-version"),
      "22.04",
    );
    await user.selectOptions(
      within(dialog).getByTestId("inventory-row-environment"),
      "Production",
    );
    await user.selectOptions(
      within(dialog).getByTestId("inventory-row-exposure"),
      "Internal",
    );
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    expect(
      await within(dialog).findByTestId("inventory-row-version-error"),
    ).toHaveTextContent("ไม่ถึง patch level");
    expect(
      within(dialog).getByTestId("inventory-row-layer-error"),
    ).toHaveTextContent("ว่าง ต้องเลือก");
    expect(within(dialog).getByTestId("inventory-row-version")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // What was typed is still there.
    expect(within(dialog).getByTestId("inventory-row-owner")).toHaveValue(
      "ทีม HR",
    );
    expect(within(dialog).getByTestId("inventory-row-version")).toHaveValue(
      "22.04",
    );
    expect(within(dialog).getByTestId("inventory-row-system")).toHaveValue(HR);

    await user.clear(within(dialog).getByTestId("inventory-row-version"));
    await user.type(
      within(dialog).getByTestId("inventory-row-version"),
      "22.04.4",
    );
    await user.selectOptions(
      within(dialog).getByTestId("inventory-row-layer"),
      "OS",
    );
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(createMock.mock.calls[1]).toEqual([
      ORG,
      PROJECT,
      { systemId: HR, ...filled, owner: "ทีม HR" },
    ]);
    expect(
      await screen.findByTestId("inventory-rows-success"),
    ).toHaveTextContent("เพิ่มแถวแล้ว");
    expect(screen.getByTestId("inventory-row-add")).toHaveFocus();
  });

  it("puts a duplicate key under the Version field and names the other row", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    createMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_ROW_DUPLICATE",
        "ซ้ำกับแถวที่มีอยู่ใน System Billing API: Canonical Ubuntu 22.04.4 (Owner ทีม Payment, import จาก inventory-q4.xlsx)",
        409,
      ),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId("inventory-row-add"));
    const dialog = await screen.findByRole("dialog");
    for (const [key, value] of Object.entries(filled)) {
      const field = within(dialog).getByTestId(`inventory-row-${key}`);
      if (field.tagName === "SELECT") await user.selectOptions(field, value);
      else await user.type(field, value);
    }
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    const error = await within(dialog).findByTestId(
      "inventory-row-version-error",
    );
    expect(error).toHaveTextContent("Canonical Ubuntu 22.04.4");
    expect(error).toHaveTextContent("inventory-q4.xlsx");
    for (const key of ["vendor", "product", "version"]) {
      expect(
        within(dialog).getByTestId(`inventory-row-${key}`),
      ).toHaveAttribute("aria-invalid", "true");
    }
    expect(within(dialog).getByTestId("inventory-row-product")).toHaveValue(
      "Ubuntu",
    );
  });

  it("edits a row from the revision it opened with and shows its source in the footer", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    updateMock.mockResolvedValue(row({ owner: "ทีมใหม่", revision: 4 }));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId(`inventory-row-edit-${ROW_A}`));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByTestId("inventory-row-system-name"),
    ).toHaveTextContent("Billing API");
    expect(
      within(dialog).getByTestId("inventory-row-source"),
    ).toHaveTextContent("import จาก inventory-q4.xlsx");
    expect(
      within(dialog).getByTestId("inventory-row-source"),
    ).toHaveTextContent("สมชาย");
    expect(within(dialog).getByTestId("inventory-row-owner")).toHaveValue(
      "ทีม Payment",
    );
    await user.clear(within(dialog).getByTestId("inventory-row-owner"));
    await user.type(
      within(dialog).getByTestId("inventory-row-owner"),
      "ทีมใหม่",
    );
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(ORG, PROJECT, ROW_A, {
        ...filled,
        owner: "ทีมใหม่",
        revision: 3,
      });
    });
    expect(
      await screen.findByTestId("inventory-rows-success"),
    ).toHaveTextContent("บันทึกแถวแล้ว");
    expect(screen.getByTestId(`inventory-row-edit-${ROW_A}`)).toHaveFocus();
  });

  it("keeps the dialog and the typed values when the row changed meanwhile, and does not save again", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    updateMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_ROW_STALE",
        "แถวนี้ถูกแก้หรือลบโดยคนอื่นหลังจากที่คุณเปิดหน้าต่างนี้ ไม่มีอะไรถูกบันทึก โหลดตารางใหม่แล้วทำรายการอีกครั้ง",
        409,
      ),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId(`inventory-row-edit-${ROW_A}`));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByTestId("inventory-row-owner"));
    await user.type(
      within(dialog).getByTestId("inventory-row-owner"),
      "ของฉัน",
    );
    const callsBefore = fetchMock.mock.calls.length;
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    expect(
      await within(dialog).findByTestId("inventory-row-error"),
    ).toHaveTextContent("โหลดตารางใหม่");
    expect(within(dialog).getByTestId("inventory-row-owner")).toHaveValue(
      "ของฉัน",
    );
    expect(within(dialog).getByTestId("inventory-row-save")).toBeDisabled();
    // The table behind the dialog reloads to show the other person's change.
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    // The disabled Save button does not strand the keyboard outside the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus to the first field with a reason after a refused save", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    updateMock.mockRejectedValue(
      new ApiError("INVENTORY_ROW_INVALID", "x", 400, {
        issues: [{ column: "Version", code: "version_not_patch_level" }],
      }),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId(`inventory-row-edit-${ROW_A}`));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    await within(dialog).findByTestId("inventory-row-version-error");
    await waitFor(() => {
      expect(within(dialog).getByTestId("inventory-row-version")).toHaveFocus();
    });
  });

  it("disables saving while a save is pending so it cannot be sent twice", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    let finish: (value: InventoryRowItem) => void = () => undefined;
    updateMock.mockReturnValue(
      new Promise<InventoryRowItem>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId(`inventory-row-edit-${ROW_A}`));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    await waitFor(() => {
      expect(within(dialog).getByTestId("inventory-row-save")).toBeDisabled();
    });
    expect(within(dialog).getByTestId("inventory-row-cancel")).toBeDisabled();
    expect(within(dialog).getByTestId("inventory-row-save")).toHaveTextContent(
      "กำลังบันทึก",
    );
    finish(row());
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("traps focus in the dialog and closes it on Escape", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId(`inventory-row-edit-${ROW_A}`));
    const dialog = await screen.findByRole("dialog");

    for (let i = 0; i < 12; i += 1) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId(`inventory-row-edit-${ROW_A}`)).toHaveFocus();
  });

  it("asks before deleting, names the Product and Version and the effect on CVE results", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();
    await user.click(
      await screen.findByTestId(`inventory-row-delete-${ROW_A}`),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ubuntu 22.04.4");
    expect(dialog).toHaveTextContent(
      "ผล CVE ของ component นี้จะหายในรอบตรวจถัดไป",
    );
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("inventory-row-delete-confirm"));

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(ORG, PROJECT, ROW_A, 3);
    });
    expect(
      await screen.findByTestId("inventory-rows-success"),
    ).toHaveTextContent("ลบแถวแล้ว");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("InventoryRowsSection repairs", () => {
  it("closes the delete dialog with the reload message after a stale delete, so the old revision is not retried", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    deleteMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_ROW_STALE",
        "แถวนี้ถูกแก้หรือลบโดยคนอื่น โหลดตารางใหม่",
        409,
      ),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(
      await screen.findByTestId(`inventory-row-delete-${ROW_A}`),
    );
    await user.click(await screen.findByTestId("inventory-row-delete-confirm"));

    expect(await screen.findByTestId("inventory-rows-error")).toHaveTextContent(
      "โหลดตารางใหม่",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("moves the page in the address to the last page when the one asked for is past the end", async () => {
    fetchMock.mockResolvedValue(list([row()], 30, 2));
    const router = renderSection({ search: "?page=9" });

    await screen.findByTestId(`inventory-row-${ROW_A}`);
    await waitFor(() => {
      expect(router.state.location.search).toBe("?page=2");
    });
  });

  it("keeps a Layer outside the list selected and shows the reason when a failing row opens", async () => {
    fetchMock.mockResolvedValue(
      list([
        row({
          layer: "Kernel",
          usable: false,
          issues: [{ column: "Layer", code: "not_in_list" }],
        }),
      ]),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId(`inventory-row-edit-${ROW_A}`));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("inventory-row-layer")).toHaveValue(
      "Kernel",
    );
    expect(
      within(dialog).getByTestId("inventory-row-layer-error"),
    ).toHaveTextContent("ค่าไม่อยู่ในรายการ");
  });

  it("offers no System without a name for a new row, and no add button when none is left", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    const [named, other] = summary().systems;
    if (!named || !other) throw new Error("systems missing");
    const user = userEvent.setup();
    renderSection({
      summary: summary({ systems: [named, { ...other, name: "" }] }),
    });
    await user.click(await screen.findByTestId("inventory-row-add"));
    const select = await screen.findByTestId("inventory-row-system");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Billing API"]);
  });

  it("shows no add button when every System is unnamed, but still lists their rows", async () => {
    fetchMock.mockResolvedValue(list([row({ systemName: "" })]));
    const [named] = summary().systems;
    if (!named) throw new Error("system missing");
    renderSection({
      summary: summary({ systems: [{ ...named, name: "" }] }),
    });

    expect(
      await screen.findByTestId(`inventory-row-${ROW_A}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-row-add")).toBeNull();
  });

  it("stops saving when the System a new row was meant for was replaced by an upload", async () => {
    fetchMock.mockResolvedValue(list([row()]));
    createMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_SYSTEM_NOT_FOUND",
        "ไม่พบ System นี้ อาจถูกแทนที่ด้วยการ upload",
        404,
      ),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId("inventory-row-add"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByTestId("inventory-row-save"));

    expect(
      await within(dialog).findByTestId("inventory-row-error"),
    ).toHaveTextContent("ไม่พบ System นี้");
    expect(within(dialog).getByTestId("inventory-row-save")).toBeDisabled();
  });
});
