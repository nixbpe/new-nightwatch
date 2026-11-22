import type {
  InventoryImportPreview,
  InventoryImportResult,
  InventorySummary,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  cancelImportPreview,
  confirmImport,
  createImportPreview,
  fetchImportPreview,
  fetchImports,
  fetchInventory,
  inventoryKeys,
} from "../../lib/api/inventory";
import { ImportPage } from "./ImportPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PREVIEW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BILLING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const BATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInventory: vi.fn(),
  fetchImportPreview: vi.fn(),
  fetchImports: vi.fn(),
  createImportPreview: vi.fn(),
  confirmImport: vi.fn(),
  cancelImportPreview: vi.fn(),
}));

const summaryMock = vi.mocked(fetchInventory);
const pendingMock = vi.mocked(fetchImportPreview);
const historyMock = vi.mocked(fetchImports);
const createMock = vi.mocked(createImportPreview);
const confirmMock = vi.mocked(confirmImport);
const cancelMock = vi.mocked(cancelImportPreview);

const summary = (canUpload = true) =>
  ({
    canUpload,
    mappings: { pending: 0, confirmed: 0, unmapped: 0 },
    systemCount: 0,
    totalRows: 0,
    usableRows: 0,
    lastUploadAt: null,
    lastUploadFileName: null,
    systems: [],
  }) satisfies InventorySummary;

const counts = { added: 2, updated: 1, unchanged: 3, skipped: 1, failed: 1 };
const preview = (): InventoryImportPreview => ({
  id: PREVIEW_ID,
  fileName: "inventory-q4.csv",
  createdAt: "2026-11-22T10:00:00.000Z",
  expiresAt: "2026-11-22T10:30:00.000Z",
  totals: counts,
  systems: [
    { key: "billing api", name: "Billing API", created: false, ...counts },
    {
      key: "batch jobs",
      name: "Batch Jobs",
      created: true,
      added: 1,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    },
  ],
  rows: [
    {
      line: 6,
      system: "Billing API",
      vendor: "Canonical",
      product: "Ubuntu",
      version: "22.04",
      outcome: "skipped",
      reason: { code: "duplicate_in_file", line: 5 },
    },
    {
      line: 7,
      system: "HR Portal",
      vendor: "Canonical",
      product: "Ubuntu",
      version: "latest",
      outcome: "failed",
      reason: {
        code: "issues",
        issues: [{ column: "Version", code: "version_not_a_number" }],
      },
    },
  ],
  warnings: [
    {
      system: "Billing API",
      vendor: "Canonical",
      product: "Ubuntu",
      newVersions: ["24.04.1"],
      existingVersions: ["22.04.4"],
    },
  ],
});
const result = (): InventoryImportResult => ({
  fileName: "inventory-q4.csv",
  importedAt: "2026-11-22T10:05:00.000Z",
  totals: counts,
  systems: [
    { id: BILLING, name: "Billing API", created: false, ...counts },
    {
      id: BATCH,
      name: "Batch Jobs",
      created: true,
      added: 0,
      updated: 0,
      unchanged: 4,
      skipped: 0,
      failed: 0,
    },
  ],
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/inventory/import",
        element: <ImportPage />,
      },
      { path: "*", element: <p data-testid="elsewhere" /> },
    ],
    {
      initialEntries: [
        `/organizations/${ORG}/projects/${PROJECT}/inventory/import`,
      ],
    },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const csv = new File(["System,Owner"], "inventory-q4.csv", {
  type: "text/csv",
});

beforeEach(() => {
  for (const mock of [
    summaryMock,
    pendingMock,
    historyMock,
    createMock,
    confirmMock,
    cancelMock,
  ]) {
    mock.mockReset();
  }
  summaryMock.mockResolvedValue(summary());
  pendingMock.mockResolvedValue({ preview: null });
  historyMock.mockResolvedValue({
    imports: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
});

describe("ImportPage choose step", () => {
  it("offers a labelled file input and the template, and previews the chosen file for the current Project", async () => {
    createMock.mockResolvedValue(preview());
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("ไฟล์ inventory");
    expect(screen.getByTestId("inventory-template-link")).toHaveAttribute(
      "download",
      "inventory-template.xlsx",
    );
    await user.upload(input, csv);

    expect(createMock.mock.calls[0]?.slice(0, 3)).toEqual([ORG, PROJECT, csv]);
    expect(await screen.findByTestId("inventory-import-preview")).toBeVisible();
    expect(confirmMock).not.toHaveBeenCalled();
    // The file chooser went away with its step, so focus is on the page title, not the body.
    expect(screen.getByTestId("page-title")).toHaveFocus();
  });

  it("shows the reason a file was rejected, with no preview", async () => {
    createMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_FILE_REJECTED",
        "ไฟล์ draft.xlsx ถูกปฏิเสธ ไม่มีข้อมูลใดถูกนำเข้า: ขาดคอลัมน์ Exposure",
        400,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.upload(
      await screen.findByLabelText("ไฟล์ inventory"),
      new File(["x"], "draft.xlsx"),
    );

    expect(
      await screen.findByTestId("inventory-import-error"),
    ).toHaveTextContent("ขาดคอลัมน์ Exposure");
    expect(screen.queryByTestId("inventory-import-preview")).toBeNull();
    expect(screen.getByLabelText("ไฟล์ inventory")).toBeInTheDocument();
  });

  it("disables choosing while the file is read, so it cannot be submitted twice", async () => {
    let finish: (value: InventoryImportPreview) => void = () => undefined;
    createMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.upload(await screen.findByLabelText("ไฟล์ inventory"), csv);

    expect(await screen.findByTestId("inventory-import-reading")).toBeVisible();
    expect(screen.getByTestId("inventory-choose-button")).toBeDisabled();
    finish(preview());
    await screen.findByTestId("inventory-import-preview");
  });
});

describe("ImportPage restricted state", () => {
  it("tells a member that only maintainers import, shows no file chooser and never asks for a preview", async () => {
    summaryMock.mockResolvedValue(summary(false));
    renderPage();

    expect(
      await screen.findByTestId("inventory-import-restricted"),
    ).toHaveTextContent("เฉพาะผู้ดูแล Project import ได้");
    expect(screen.queryByLabelText("ไฟล์ inventory")).toBeNull();
    expect(screen.queryByTestId("inventory-choose-button")).toBeNull();
    expect(screen.getByTestId("inventory-template-link")).toBeVisible();
    expect(pendingMock).not.toHaveBeenCalled();
  });

  it("shows a retryable error when the Project cannot be read", async () => {
    summaryMock.mockRejectedValueOnce(
      new ApiError("PROJECT_NOT_FOUND", "x", 404),
    );
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText("ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByLabelText("ไฟล์ inventory")).toBeInTheDocument();
  });
});

describe("ImportPage preview step", () => {
  it("shows the pending preview with counts per System, the warning, and the skipped and failed rows with reasons", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    renderPage();

    const totals = await screen.findByTestId("inventory-import-totals");
    for (const [key, value] of Object.entries(counts)) {
      expect(
        within(screen.getByTestId(`inventory-import-total-${key}`)).getByText(
          String(value),
        ),
      ).toBeInTheDocument();
    }
    expect(totals).toBeVisible();
    const billing = screen.getByTestId("inventory-import-system-billing api");
    expect(
      within(billing)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Billing API", "2", "1", "3", "1", "1"]);
    expect(
      within(
        screen.getByTestId("inventory-import-system-batch jobs"),
      ).getByText("ใหม่"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inventory-import-warning")).toHaveTextContent(
      "เวอร์ชันเดิม 22.04.4 ยังอยู่",
    );
    expect(screen.getByTestId("inventory-import-row-6")).toHaveTextContent(
      "ซ้ำกับแถวที่ 5 ในไฟล์",
    );
    expect(screen.getByTestId("inventory-import-row-7")).toHaveTextContent(
      "Version: ต้องเป็นเลขเวอร์ชัน",
    );
    // The result is announced in a polite live region, and nothing changed yet.
    const live = screen.getByTestId("inventory-import-previewed");
    expect(live.closest("[aria-live=polite]")).not.toBeNull();
    expect(live).toHaveTextContent(
      "เพิ่ม 2 · อัปเดต 1 · ไม่เปลี่ยน 3 · ข้าม 1 · ไม่ผ่าน 1",
    );
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("lists two Systems whose names were cut to the same text as two rows", async () => {
    const name = "A".repeat(200);
    const base = preview();
    const system = base.systems[0];
    if (!system) throw new Error("fixture has no System");
    pendingMock.mockResolvedValue({
      preview: {
        ...base,
        systems: [
          { ...system, key: "\u0001sha256:one", name },
          { ...system, key: "\u0001sha256:two", name },
        ],
      },
    });
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPage();

    const table = await screen.findByRole("region", { name: "ผลต่อ System" });
    // Two rows with one React key would be reported here and could drop a System.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByText(name)).toHaveLength(2);
  });

  it("confirms, shows the counts of the preview and links the changed Systems only", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    confirmMock.mockResolvedValue(result());
    const user = userEvent.setup();
    const { invalidate } = renderPage();

    await user.click(await screen.findByTestId("inventory-import-confirm"));

    expect(confirmMock.mock.calls[0]).toEqual([ORG, PROJECT, PREVIEW_ID]);
    expect(
      await screen.findByTestId("inventory-import-success"),
    ).toHaveTextContent(
      "import ไฟล์ inventory-q4.csv แล้ว เพิ่ม 2 · อัปเดต 1 · ไม่เปลี่ยน 3 · ข้าม 1 · ไม่ผ่าน 1",
    );
    expect(
      screen.getByTestId(`inventory-import-system-link-${BILLING}`),
    ).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/systems/${BILLING}`,
    );
    expect(
      screen.queryByTestId(`inventory-import-system-link-${BATCH}`),
    ).toBeNull();
    expect(screen.queryByTestId("inventory-import-preview")).toBeNull();
    // The rows and the summary behind the overview are what the import changed.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: inventoryKeys.all(ORG, PROJECT),
    });
  });

  it("disables every action while the confirmation runs", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    confirmMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-import-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("inventory-import-confirm")).toBeDisabled();
    });
    expect(screen.getByTestId("inventory-import-cancel")).toBeDisabled();
    expect(screen.getByTestId("inventory-import-replace")).toBeDisabled();
    await user.click(screen.getByTestId("inventory-import-confirm"));
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the preview and says to make a new one when the inventory changed meanwhile", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    confirmMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_PREVIEW_STALE",
        "inventory ของ System ในไฟล์นี้เปลี่ยนไป",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-import-confirm"));

    expect(
      await screen.findByTestId("inventory-import-failure"),
    ).toHaveTextContent("inventory ของ System ในไฟล์นี้เปลี่ยนไป");
    expect(screen.getByTestId("inventory-import-preview")).toBeVisible();
    expect(screen.getByTestId("inventory-import-confirm")).toBeEnabled();
  });

  it("drops an expired preview, says to choose a new file and shows the file chooser", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    confirmMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_PREVIEW_EXPIRED",
        "preview หมดอายุแล้ว เลือกไฟล์ใหม่",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-import-confirm"));

    expect(
      await screen.findByTestId("inventory-import-failure"),
    ).toHaveTextContent("เลือกไฟล์ใหม่");
    expect(screen.queryByTestId("inventory-import-preview")).toBeNull();
    expect(screen.getByLabelText("ไฟล์ inventory")).toBeInTheDocument();
    expect(screen.getByTestId("page-title")).toHaveFocus();
  });

  it("cancels the preview and returns to the file chooser", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    cancelMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-import-cancel"));

    expect(cancelMock.mock.calls[0]).toEqual([ORG, PROJECT, PREVIEW_ID]);
    expect(await screen.findByLabelText("ไฟล์ inventory")).toBeInTheDocument();
    expect(screen.getByTestId("page-title")).toHaveFocus();
    expect(screen.queryByTestId("inventory-import-preview")).toBeNull();
  });

  it("replaces the preview when another file is chosen", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    createMock.mockResolvedValue({ ...preview(), fileName: "second.csv" });
    const user = userEvent.setup();
    renderPage();

    await user.upload(
      await screen.findByLabelText("เลือกไฟล์ใหม่แทน preview"),
      new File(["x"], "second.csv"),
    );

    expect(await screen.findByText("Preview ของ second.csv")).toBeVisible();
  });
});

describe("ImportPage history", () => {
  const history = (importedBy: string | null = "สมชาย") => ({
    imports: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        fileName: "inventory-q3.csv",
        importedAt: "2026-11-20T10:00:00.000Z",
        importedBy,
        added: 4,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 1,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });

  it("lists the history below the file chooser", async () => {
    historyMock.mockResolvedValue(history());
    renderPage();

    const chooser = await screen.findByLabelText("ไฟล์ inventory");
    const section = await screen.findByTestId("inventory-import-history");
    expect(
      chooser.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(await within(section).findByText("inventory-q3.csv")).toBeVisible();
    expect(historyMock.mock.calls[0]?.slice(0, 3)).toEqual([
      ORG,
      PROJECT,
      { page: 1 },
    ]);
  });

  it("shows the history to a member in the restricted state, with no file chooser", async () => {
    summaryMock.mockResolvedValue(summary(false));
    historyMock.mockResolvedValue(history(null));
    renderPage();

    const section = await screen.findByTestId("inventory-import-history");
    expect(await within(section).findByText("inventory-q3.csv")).toBeVisible();
    expect(within(section).getByText("ไม่ทราบผู้ทำรายการ")).toBeVisible();
    expect(screen.getByTestId("inventory-import-restricted")).toBeVisible();
    expect(screen.queryByLabelText("ไฟล์ inventory")).toBeNull();
  });

  it("keeps the history below a pending preview and reads it again after a confirmation", async () => {
    pendingMock.mockResolvedValue({ preview: preview() });
    confirmMock.mockResolvedValue(result());
    const user = userEvent.setup();
    renderPage();

    const shown = await screen.findByTestId("inventory-import-preview");
    const section = await screen.findByTestId("inventory-import-history");
    expect(
      shown.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(historyMock).toHaveBeenCalledTimes(1);
    historyMock.mockResolvedValue(history());
    await user.click(screen.getByTestId("inventory-import-confirm"));

    await screen.findByTestId("inventory-import-result");
    expect(await screen.findByText("inventory-q3.csv")).toBeVisible();
    expect(historyMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not ask for the history when the Project cannot be read", async () => {
    summaryMock.mockRejectedValue(new ApiError("PROJECT_NOT_FOUND", "x", 404));
    renderPage();

    await screen.findByText("ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้");
    expect(screen.queryByTestId("inventory-import-history")).toBeNull();
    expect(historyMock).not.toHaveBeenCalled();
  });
});
