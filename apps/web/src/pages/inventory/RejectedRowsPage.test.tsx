import type { InventoryRejectedRows } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  downloadRejectedRows,
  fetchRejectedRows,
} from "../../lib/api/inventory";
import { RejectedRowsPage } from "./RejectedRowsPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SYSTEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRejectedRows: vi.fn(),
  downloadRejectedRows: vi.fn(),
}));

const fetchMock = vi.mocked(fetchRejectedRows);
const downloadMock = vi.mocked(downloadRejectedRows);

function data(rows: InventoryRejectedRows["rows"]): InventoryRejectedRows {
  return {
    system: {
      id: SYSTEM,
      name: "HR Portal",
      owners: ["ทีม HR"],
      totalRows: 16,
      usableRows: 12,
      lowQuality: true,
      fileName: "inventory-q4.xlsx",
      uploadedAt: "2026-11-20T09:42:00.000Z",
    },
    rows,
  };
}

const ROWS: InventoryRejectedRows["rows"] = [
  {
    line: 12,
    owner: "ทีม Infra",
    vendor: "Canonical",
    product: "Ubuntu",
    version: "22.04",
    layer: "OS",
    environment: "Production",
    exposure: "public",
    issues: [
      { column: "Version", code: "version_not_patch_level" },
      { column: "Exposure", code: "not_in_list" },
    ],
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/inventory/systems/:systemId",
        element: <RejectedRowsPage />,
      },
      { path: "*", element: <p data-testid="elsewhere" /> },
    ],
    {
      initialEntries: [
        `/organizations/${ORG}/projects/${PROJECT}/inventory/systems/${SYSTEM}`,
      ],
    },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  downloadMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RejectedRowsPage", () => {
  it("lists each failed row with the reason per column and the quality against 95%", async () => {
    fetchMock.mockResolvedValue(data(ROWS));
    renderPage();

    expect(
      await screen.findByTestId("inventory-rejected-status"),
    ).toHaveTextContent("ใช้งานได้ 12 จาก 16 แถว (75%, ต่ำกว่า 95%)");
    const row = screen.getByTestId("inventory-rejected-row-12");
    expect(within(row).getByText("ทีม Infra")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("inventory-issue-12-Version")).getByText(
        "ไม่ถึง patch level เช่น 8.0.36 หรือ 22.04.4",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("inventory-issue-12-Exposure")).getByText(
        "ค่าไม่อยู่ในรายการ ใช้ Internet-facing, Internal, Isolated",
      ),
    ).toBeInTheDocument();
  });

  it("downloads the Excel file under the name the server gives", async () => {
    fetchMock.mockResolvedValue(data(ROWS));
    const blob = new Blob(["xlsx"]);
    downloadMock.mockResolvedValue({ blob, filename: "rejected-rows.xlsx" });
    const create = vi.fn(() => "blob:rejected");
    const revoke = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(create);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-download-button"));

    await waitFor(() => {
      expect(click).toHaveBeenCalledTimes(1);
    });
    expect(downloadMock.mock.calls[0]?.slice(0, 3)).toEqual([
      ORG,
      PROJECT,
      SYSTEM,
    ]);
    expect(create).toHaveBeenCalledWith(blob);
    expect(revoke).toHaveBeenCalledWith("blob:rejected");
  });

  it("shows a download failure without losing the rows", async () => {
    fetchMock.mockResolvedValue(data(ROWS));
    downloadMock.mockRejectedValue(new ApiError("X", "x", 503));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-download-button"));

    expect(
      await screen.findByTestId("inventory-download-error"),
    ).toHaveTextContent("บริการ inventory ยังไม่พร้อม");
    expect(screen.getByTestId("inventory-rejected-row-12")).toBeInTheDocument();
  });

  it("offers no download when the System has no failed rows", async () => {
    fetchMock.mockResolvedValue(data([]));
    renderPage();

    expect(await screen.findByText("ไม่มีแถวที่ไม่ผ่าน")).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-download-button")).toBeNull();
  });

  it("says when the System is not found", async () => {
    fetchMock.mockRejectedValue(
      new ApiError("INVENTORY_SYSTEM_NOT_FOUND", "x", 404),
    );
    renderPage();

    expect(
      await screen.findByText("ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้"),
    ).toBeInTheDocument();
  });
});
