import type { InventorySummary } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  fetchInventory,
  fetchRows,
  uploadInventory,
} from "../../lib/api/inventory";
import { InventoryPage } from "./InventoryPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const HR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInventory: vi.fn(),
  fetchRows: vi.fn(),
  uploadInventory: vi.fn(),
}));

const fetchMock = vi.mocked(fetchInventory);
const uploadMock = vi.mocked(uploadInventory);
const rowsMock = vi.mocked(fetchRows);

function summary(overrides: Partial<InventorySummary> = {}): InventorySummary {
  return {
    canUpload: true,
    mappings: { pending: 0, confirmed: 0, unmapped: 0 },
    systemCount: 2,
    totalRows: 40,
    usableRows: 36,
    lastUploadAt: "2026-11-20T09:42:00.000Z",
    lastUploadFileName: "inventory-q4.xlsx",
    systems: [
      {
        id: BILLING,
        name: "Billing API",
        owners: ["ทีม Payment"],
        totalRows: 24,
        usableRows: 24,
        lowQuality: false,
        fileName: "inventory-q4.xlsx",
        uploadedAt: "2026-11-20T09:42:00.000Z",
      },
      {
        id: HR,
        name: "HR Portal",
        owners: ["ทีม HR", "ทีม Infra"],
        totalRows: 16,
        usableRows: 12,
        lowQuality: true,
        fileName: "inventory-q4.xlsx",
        uploadedAt: "2026-11-20T09:42:00.000Z",
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/inventory",
        element: <InventoryPage />,
      },
      { path: "*", element: <p data-testid="elsewhere" /> },
    ],
    {
      initialEntries: [`/organizations/${ORG}/projects/${PROJECT}/inventory`],
    },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  fetchMock.mockReset();
  uploadMock.mockReset();
  rowsMock.mockReset();
  rowsMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
});

describe("InventoryPage", () => {
  it("shows totals and the quality of each System with a link only where rows failed", async () => {
    fetchMock.mockResolvedValue(summary());
    renderPage();

    expect(await screen.findByTestId("inventory-tile-total")).toHaveTextContent(
      "40",
    );
    expect(screen.getByTestId("inventory-tile-usable")).toHaveTextContent("36");
    expect(screen.getByTestId("inventory-tile-usable")).toHaveTextContent(
      "ไม่ผ่าน 4 แถว",
    );
    const billing = screen.getByTestId(`inventory-system-${BILLING}`);
    expect(within(billing).getByText("24 · 100%")).toBeInTheDocument();
    expect(within(billing).getByText("ผ่าน")).toBeInTheDocument();
    expect(
      within(billing).queryByTestId(`inventory-rejected-link-${BILLING}`),
    ).toBeNull();
    const hr = screen.getByTestId(`inventory-system-${HR}`);
    expect(within(hr).getByText("12 · 75%")).toBeInTheDocument();
    expect(within(hr).getByText("คุณภาพต่ำ")).toBeInTheDocument();
    expect(within(hr).getByText("ทีม HR, ทีม Infra")).toBeInTheDocument();
    expect(
      within(hr).getByTestId(`inventory-rejected-link-${HR}`),
    ).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory?system=${HR}&status=rejected`,
    );
  });

  it("opens the table of rows filtered by that System and the failed status from the link", async () => {
    fetchMock.mockResolvedValue(summary());
    const user = userEvent.setup();
    const router = renderPage();

    await user.click(
      await screen.findByTestId(`inventory-rejected-link-${HR}`),
    );

    await waitFor(() => {
      expect(rowsMock.mock.calls.at(-1)?.[2]).toMatchObject({
        system: HR,
        status: "rejected",
      });
    });
    expect(router.state.location.search).toBe(`?system=${HR}&status=rejected`);
    expect(await screen.findByTestId("inventory-rows-heading")).toHaveFocus();
  });

  it("keeps the rows table out of a Project with no System yet", async () => {
    fetchMock.mockResolvedValue(
      summary({ systems: [], systemCount: 0, totalRows: 0, usableRows: 0 }),
    );
    renderPage();

    await screen.findByText(/ยังไม่มี inventory ใน Project นี้/);
    expect(screen.queryByTestId("inventory-rows")).toBeNull();
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it("links the pending CPE/purl count to the review queue", async () => {
    fetchMock.mockResolvedValue(
      summary({ mappings: { pending: 5, confirmed: 3, unmapped: 1 } }),
    );
    renderPage();

    const tile = await screen.findByTestId("inventory-tile-mappings");
    expect(tile).toHaveTextContent("5");
    expect(within(tile).getByTestId("inventory-mappings-link")).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/mappings`,
    );
  });

  it("uploads the chosen file for the current Project and shows the new totals", async () => {
    fetchMock.mockResolvedValue(
      summary({
        totalRows: 0,
        usableRows: 0,
        systems: [],
        systemCount: 0,
        lastUploadAt: null,
        lastUploadFileName: null,
      }),
    );
    uploadMock.mockResolvedValue(summary());
    const user = userEvent.setup();
    renderPage();

    const file = new File(["System,Owner"], "inventory-q4.csv", {
      type: "text/csv",
    });
    await user.upload(await screen.findByTestId("inventory-file-input"), file);

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledTimes(1);
    });
    expect(uploadMock.mock.calls[0]?.slice(0, 3)).toEqual([ORG, PROJECT, file]);
    expect(
      await screen.findByTestId("inventory-upload-success"),
    ).toHaveTextContent(
      "นำเข้าไฟล์ inventory-q4.csv แล้ว: 40 แถว ใช้งานได้ 36 แถว",
    );
    expect(screen.getByTestId("inventory-tile-total")).toHaveTextContent("40");
  });

  it("reloads the rows table after an upload replaced the rows it was showing", async () => {
    const before = {
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
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
      revision: 1,
      source: {
        kind: "import" as const,
        fileName: "old.csv",
        changedBy: "สมชาย",
        changedAt: "2026-11-20T09:42:00.000Z",
      },
    };
    const after = {
      ...before,
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
      source: { ...before.source, fileName: "new.csv" },
    };
    fetchMock.mockResolvedValue(summary());
    rowsMock.mockResolvedValueOnce({
      rows: [before],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    rowsMock.mockResolvedValue({
      rows: [after],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    uploadMock.mockResolvedValue(summary());
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByTestId(`inventory-row-source-${before.id}`),
    ).toHaveTextContent("old.csv");

    await user.upload(
      await screen.findByTestId("inventory-file-input"),
      new File(["x"], "new.csv"),
    );

    expect(
      await screen.findByTestId(`inventory-row-source-${after.id}`),
    ).toHaveTextContent("new.csv");
    expect(
      screen.queryByTestId(`inventory-row-source-${before.id}`),
    ).toBeNull();
  });

  it("shows the reason a file was rejected and preserves earlier inventory totals", async () => {
    fetchMock.mockResolvedValue(summary());
    uploadMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_FILE_REJECTED",
        "ไฟล์ draft.xlsx ถูกปฏิเสธ ไม่มีข้อมูลใดถูกนำเข้า: ขาดคอลัมน์ Exposure",
        400,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.upload(
      await screen.findByTestId("inventory-file-input"),
      new File(["x"], "draft.xlsx"),
    );

    expect(
      await screen.findByTestId("inventory-upload-error"),
    ).toHaveTextContent(
      "ไฟล์ draft.xlsx ถูกปฏิเสธ ไม่มีข้อมูลใดถูกนำเข้า: ขาดคอลัมน์ Exposure",
    );
    expect(screen.getByTestId("inventory-tile-total")).toHaveTextContent("40");
  });

  it("offers no upload to a member who cannot manage the Project but keeps the template", async () => {
    fetchMock.mockResolvedValue(summary({ canUpload: false }));
    renderPage();

    expect(await screen.findByTestId("inventory-template-link")).toBeVisible();
    expect(screen.queryByTestId("inventory-file-input")).toBeNull();
    expect(screen.queryByTestId("inventory-upload-button")).toBeNull();
    expect(
      screen.getByText("เฉพาะผู้ดูแล Project upload ได้"),
    ).toBeInTheDocument();
  });

  it("says there is no inventory yet instead of showing zero Systems as healthy", async () => {
    fetchMock.mockResolvedValue(
      summary({
        systems: [],
        systemCount: 0,
        totalRows: 0,
        usableRows: 0,
        lastUploadAt: null,
        lastUploadFileName: null,
      }),
    );
    renderPage();

    expect(
      await screen.findByText(/ยังไม่มี inventory ใน Project นี้/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inventory-tile-upload")).toHaveTextContent(
      "ยังไม่มี",
    );
  });

  it("shows a retryable error when the inventory cannot be read", async () => {
    fetchMock.mockRejectedValueOnce(
      new ApiError("PROJECT_NOT_FOUND", "x", 404),
    );
    fetchMock.mockResolvedValue(summary());
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText("ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(
      await screen.findByTestId("inventory-tile-total"),
    ).toBeInTheDocument();
  });
});
