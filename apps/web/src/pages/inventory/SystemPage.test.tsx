import type { InventorySummary } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  deleteSystem,
  downloadInventory,
  downloadRejectedRows,
  fetchInventory,
  renameSystem,
} from "../../lib/api/inventory";
import { SystemPage } from "./SystemPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const HR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const BASE = `/organizations/${ORG}/projects/${PROJECT}/inventory`;

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInventory: vi.fn(),
  renameSystem: vi.fn(),
  deleteSystem: vi.fn(),
  downloadRejectedRows: vi.fn(),
  downloadInventory: vi.fn(),
}));

const fetchMock = vi.mocked(fetchInventory);
const renameMock = vi.mocked(renameSystem);
const deleteMock = vi.mocked(deleteSystem);
const downloadMock = vi.mocked(downloadRejectedRows);
const exportMock = vi.mocked(downloadInventory);

function system(overrides: Partial<InventorySummary["systems"][number]> = {}) {
  return {
    id: HR,
    name: "HR Portal",
    owners: ["ทีม HR", "ทีม Infra"],
    totalRows: 42,
    usableRows: 30,
    lowQuality: true,
    fileName: "inventory-q4.xlsx",
    uploadedAt: "2026-11-20T09:42:00.000Z",
    revision: 4,
    ...overrides,
  };
}

function summary(
  target = system(),
  overrides: Partial<InventorySummary> = {},
): InventorySummary {
  return {
    canUpload: true,
    mappings: { pending: 0, confirmed: 0, unmapped: 0 },
    systemCount: 2,
    totalRows: 43,
    usableRows: 31,
    lastUploadAt: "2026-11-20T09:42:00.000Z",
    lastUploadFileName: "inventory-q4.xlsx",
    systems: [
      system({
        id: BILLING,
        name: "Billing API",
        totalRows: 1,
        usableRows: 1,
        lowQuality: false,
      }),
      target,
    ],
    ...overrides,
  };
}

// Stands for the overview: it shows what the System page carried in the navigation.
function Overview() {
  const location = useLocation();
  return (
    <p data-testid="overview">
      {(location.state as { notice?: string } | null)?.notice ?? ""}
    </p>
  );
}

function renderPage(systemId = HR) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/inventory/systems/:systemId",
        element: <SystemPage />,
      },
      { path: BASE, element: <Overview /> },
    ],
    { initialEntries: [`${BASE}/systems/${systemId}`] },
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
  renameMock.mockReset();
  deleteMock.mockReset();
  downloadMock.mockReset();
  exportMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemPage", () => {
  it("shows the name, Owners, row count, usable share and quality label of the current rows", async () => {
    fetchMock.mockResolvedValue(summary());
    renderPage();

    expect(
      await screen.findByTestId("inventory-system-owners"),
    ).toHaveTextContent("ทีม HR, ทีม Infra");
    expect(screen.getByTestId("page-title")).toHaveTextContent("HR Portal");
    expect(screen.getByTestId("inventory-system-owners")).toHaveTextContent(
      "ทีม HR, ทีม Infra",
    );
    expect(screen.getByTestId("inventory-system-rows")).toHaveTextContent("42");
    expect(screen.getByTestId("inventory-system-usable")).toHaveTextContent(
      "30 · 71%",
    );
    expect(screen.getByTestId("inventory-system-quality")).toHaveTextContent(
      "คุณภาพต่ำ",
    );
    expect(screen.getByTestId("inventory-system-rows-link")).toHaveAttribute(
      "href",
      `${BASE}?system=${HR}`,
    );
    expect(screen.getByTestId("inventory-download-button")).toHaveTextContent(
      "ดาวน์โหลดแถวที่ไม่ผ่านตาม Owner",
    );
    expect(
      screen.getByRole("button", { name: "Export Excel" }),
    ).toHaveAttribute("aria-label", "Export Excel");
  });

  it("shows an empty System as having no rows rather than as passing, and still lets it be renamed or deleted", async () => {
    fetchMock.mockResolvedValue(
      summary(
        system({
          totalRows: 0,
          usableRows: 0,
          lowQuality: false,
          owners: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByTestId("inventory-system-quality"),
    ).toHaveTextContent("ไม่มีแถว");
    expect(screen.getByTestId("inventory-system-usable")).toHaveTextContent(
      "—",
    );
    expect(screen.queryByTestId("inventory-download-button")).toBeNull();
    expect(screen.getByTestId("inventory-system-name")).toBeEnabled();
    await user.click(screen.getByTestId("inventory-system-delete"));
    expect(
      await screen.findByTestId("inventory-system-delete-confirm"),
    ).toHaveTextContent("ลบ System และ 0 แถว");
  });

  it("offers a member neither the rename form nor the delete button", async () => {
    fetchMock.mockResolvedValue(summary(system(), { canUpload: false }));
    renderPage();

    expect(
      await screen.findByTestId("inventory-system-restricted"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-system-name")).toBeNull();
    expect(screen.queryByTestId("inventory-system-rename")).toBeNull();
    expect(screen.queryByTestId("inventory-system-delete")).toBeNull();
    expect(screen.getByTestId("inventory-download-button")).toBeEnabled();
  });

  it("renames in a form of the page with the revision it read and says so", async () => {
    fetchMock.mockResolvedValue(summary());
    renameMock.mockResolvedValue(
      system({ name: "People Portal", revision: 5 }),
    );
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("ชื่อ System");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.clear(input);
    await user.type(input, "People Portal");
    await user.click(screen.getByTestId("inventory-system-rename"));

    await waitFor(() => {
      expect(renameMock).toHaveBeenCalledWith(ORG, PROJECT, HR, {
        name: "People Portal",
        revision: 4,
      });
    });
    expect(
      await screen.findByTestId("inventory-system-success"),
    ).toHaveTextContent("เปลี่ยนชื่อ System แล้ว");
  });

  it("puts a name another System has under the name field and keeps what was typed", async () => {
    fetchMock.mockResolvedValue(summary());
    renameMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_SYSTEM_NAME_TAKEN",
        "มี System ชื่อ billing api ใน Project นี้แล้ว",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("ชื่อ System");
    await user.clear(input);
    await user.type(input, "billing api");
    await user.click(screen.getByTestId("inventory-system-rename"));

    expect(
      await screen.findByTestId("inventory-system-name-error"),
    ).toHaveTextContent("มี System ชื่อ billing api");
    expect(input).toHaveValue("billing api");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("inventory-system-success")).toBeNull();
  });

  it("puts the reason of an empty name under the name field", async () => {
    fetchMock.mockResolvedValue(summary());
    renameMock.mockRejectedValue(
      new ApiError("INVENTORY_ROW_INVALID", "x", 400, {
        issues: [{ column: "System", code: "required" }],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.clear(await screen.findByLabelText("ชื่อ System"));
    await user.click(screen.getByTestId("inventory-system-rename"));

    expect(
      await screen.findByTestId("inventory-system-name-error"),
    ).toHaveTextContent("ว่าง ต้องกรอก");
  });

  it("shows the reload message when someone else renamed or deleted the System, and reads it again", async () => {
    fetchMock.mockResolvedValue(summary());
    renameMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_SYSTEM_STALE",
        "โหลดหน้าใหม่แล้วทำรายการอีกครั้ง",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("ชื่อ System"), " 2");
    await user.click(screen.getByTestId("inventory-system-rename"));

    expect(
      await screen.findByTestId("inventory-system-error"),
    ).toHaveTextContent("โหลดหน้าใหม่");
    expect(screen.queryByTestId("inventory-system-success")).toBeNull();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("disables the rename button while it saves so it cannot be sent twice", async () => {
    fetchMock.mockResolvedValue(summary());
    let finish: (value: ReturnType<typeof system>) => void = () => undefined;
    renameMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("ชื่อ System"), "2");
    await user.click(screen.getByTestId("inventory-system-rename"));

    expect(await screen.findByTestId("inventory-system-rename")).toBeDisabled();
    finish(system({ name: "HR Portal2", revision: 5 }));
    await waitFor(() => {
      expect(screen.getByTestId("inventory-system-rename")).toBeEnabled();
    });
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it("asks before deleting, names the System and its row count, then returns to the overview with a notice", async () => {
    fetchMock.mockResolvedValue(summary());
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const router = renderPage();

    const opener = await screen.findByTestId("inventory-system-delete");
    // The destructive button sits below the rename form, apart from the header actions.
    expect(opener.closest("header")).toBeNull();
    expect(
      screen
        .getByTestId("inventory-system-rename")
        .compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(opener);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("HR Portal");
    expect(dialog).toHaveTextContent("42 แถว");
    expect(
      within(dialog).getByTestId("inventory-system-delete-confirm"),
    ).toHaveTextContent("ลบ System และ 42 แถว");
    expect(within(dialog).getByTestId("confirmation-cancel")).toHaveFocus();
    await user.click(screen.getByTestId("inventory-system-delete-confirm"));

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(ORG, PROJECT, {
        id: HR,
        revision: 4,
        totalRows: 42,
        name: "HR Portal",
        owners: ["ทีม HR", "ทีม Infra"],
        usableRows: 30,
        lowQuality: true,
        fileName: "inventory-q4.xlsx",
        uploadedAt: "2026-11-20T09:42:00.000Z",
      });
    });
    expect(await screen.findByTestId("overview")).toHaveTextContent(
      "ลบ System HR Portal และ 42 แถวแล้ว",
    );
    expect(router.state.location.pathname).toBe(BASE);
  });

  it("closes the dialog and returns focus to the delete button on cancel without deleting", async () => {
    fetchMock.mockResolvedValue(summary());
    const user = userEvent.setup();
    renderPage();

    const opener = await screen.findByTestId("inventory-system-delete");
    await user.click(opener);
    await user.click(await screen.findByTestId("confirmation-cancel"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("closes the delete dialog with the reload message when the System changed meanwhile", async () => {
    fetchMock.mockResolvedValue(summary());
    deleteMock.mockRejectedValue(
      new ApiError(
        "INVENTORY_SYSTEM_STALE",
        "โหลดหน้าใหม่แล้วทำรายการอีกครั้ง",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-system-delete"));
    await user.click(
      await screen.findByTestId("inventory-system-delete-confirm"),
    );

    expect(
      await screen.findByTestId("inventory-system-error"),
    ).toHaveTextContent("โหลดหน้าใหม่");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps the dialog open with the reason when a delete fails for another cause", async () => {
    fetchMock.mockResolvedValue(summary());
    deleteMock.mockRejectedValue(new ApiError("X", "x", 503));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-system-delete"));
    await user.click(
      await screen.findByTestId("inventory-system-delete-confirm"),
    );

    expect(
      await screen.findByTestId("inventory-system-delete-error"),
    ).toHaveTextContent("บริการ inventory ยังไม่พร้อม");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("downloads the rows that failed, by Owner, under the name the server gives", async () => {
    fetchMock.mockResolvedValue(summary());
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
    expect(downloadMock.mock.calls[0]?.slice(0, 3)).toEqual([ORG, PROJECT, HR]);
    expect(create).toHaveBeenCalledWith(blob);
    expect(revoke).toHaveBeenCalledWith("blob:rejected");
  });

  it("exports this System's rows from an icon button whose tooltip is its label, also for a member who cannot edit", async () => {
    fetchMock.mockResolvedValue(summary(system(), { canUpload: false }));
    const blob = new Blob(["xlsx"]);
    exportMock.mockResolvedValue({
      blob,
      filename: "inventory-payments-HR-Portal-2026-11-22.xlsx",
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:inventory");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole("button", { name: "Export Excel" });
    expect(button).toHaveTextContent("");
    await user.hover(button);
    expect(screen.getByTestId("tooltip")).toHaveTextContent("Export Excel");
    await user.click(button);

    await waitFor(() => {
      expect(names).toEqual(["inventory-payments-HR-Portal-2026-11-22.xlsx"]);
    });
    expect(exportMock.mock.calls[0]?.slice(0, 3)).toEqual([ORG, PROJECT, HR]);
  });

  it("disables the export while the file is built and shows a failure as an alert", async () => {
    fetchMock.mockResolvedValue(summary());
    let fail: (error: Error) => void = () => {
      throw new Error("the export has not started");
    };
    exportMock.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByTestId("inventory-export");
    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(exportMock).toHaveBeenCalledTimes(1);

    fail(new ApiError("X", "x", 503));
    expect(
      await screen.findByTestId("inventory-export-error"),
    ).toHaveTextContent("บริการ inventory ยังไม่พร้อม");
    expect(button).toBeEnabled();
    expect(screen.getByTestId("page-title")).toHaveTextContent("HR Portal");
  });

  it("shows a download failure without losing the page", async () => {
    fetchMock.mockResolvedValue(summary());
    downloadMock.mockRejectedValue(new ApiError("X", "x", 503));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-download-button"));

    expect(
      await screen.findByTestId("inventory-download-error"),
    ).toHaveTextContent("บริการ inventory ยังไม่พร้อม");
    expect(screen.getByTestId("page-title")).toHaveTextContent("HR Portal");
  });

  it("offers no download when every row of the System passed", async () => {
    fetchMock.mockResolvedValue(
      summary(system({ usableRows: 42, lowQuality: false })),
    );
    renderPage();

    expect(
      await screen.findByTestId("inventory-system-quality"),
    ).toHaveTextContent("ผ่าน");
    expect(screen.queryByTestId("inventory-download-button")).toBeNull();
  });

  it("says when the System is not in the Project any more", async () => {
    fetchMock.mockResolvedValue(summary());
    renderPage("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9");

    expect(
      await screen.findByTestId("inventory-system-missing"),
    ).toHaveTextContent("ไม่พบ System นี้");
    expect(screen.queryByTestId("inventory-system-delete")).toBeNull();
  });

  it("shows the denied state with no retry when the read is refused", async () => {
    fetchMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "x", 403));
    renderPage();

    expect(
      await screen.findByTestId("inventory-system-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).toBeNull();
  });

  it("shows a retryable error under the header when the inventory cannot be read", async () => {
    fetchMock.mockRejectedValue(new ApiError("X", "x", 404));
    renderPage();

    expect(
      await screen.findByText("ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("page-title")).toBeInTheDocument();
  });
});
