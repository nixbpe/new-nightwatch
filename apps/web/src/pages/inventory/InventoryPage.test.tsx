import type { InventorySummary } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  createSystem,
  fetchInventory,
  fetchRows,
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
  createSystem: vi.fn(),
}));

const fetchMock = vi.mocked(fetchInventory);
const rowsMock = vi.mocked(fetchRows);
const createMock = vi.mocked(createSystem);

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
        revision: 1,
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
        revision: 1,
      },
    ],
    ...overrides,
  };
}

const BASE_SYSTEM =
  summary().systems[0] ??
  (() => {
    throw new Error("no system");
  })();

function renderPage(state?: unknown) {
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
      initialEntries: [
        {
          pathname: `/organizations/${ORG}/projects/${PROJECT}/inventory`,
          state,
        },
      ],
    },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return Object.assign(router, { unmount: view.unmount });
}

beforeEach(() => {
  fetchMock.mockReset();
  rowsMock.mockReset();
  createMock.mockReset();
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

  it("offers Import as the first header action to a maintainer, and nothing to import to a member", async () => {
    fetchMock.mockResolvedValue(summary());
    const maintainer = renderPage();

    const link = await screen.findByTestId("inventory-import-link");
    expect(link).toHaveTextContent("Import");
    expect(link).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/import`,
    );
    expect(screen.queryByTestId("inventory-file-input")).toBeNull();
    maintainer.unmount();

    fetchMock.mockResolvedValue(summary({ canUpload: false }));
    renderPage();
    await screen.findByTestId("inventory-tile-total");
    expect(screen.queryByTestId("inventory-import-link")).toBeNull();
    expect(screen.queryByTestId("inventory-template-link")).toBeNull();
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
    expect(screen.getByTestId("inventory-empty-import-link")).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/import`,
    );
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

  describe("managing Systems", () => {
    const first = {
      owner: "ทีม Cache",
      vendor: "Redis Ltd",
      product: "Redis",
      version: "7.2.4",
      layer: "Middleware",
      environment: "Production",
      exposure: "Internal",
    };

    async function fillRow(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByTestId("inventory-row-owner"), first.owner);
      await user.type(screen.getByTestId("inventory-row-vendor"), first.vendor);
      await user.type(
        screen.getByTestId("inventory-row-product"),
        first.product,
      );
      await user.type(
        screen.getByTestId("inventory-row-version"),
        first.version,
      );
      await user.selectOptions(
        screen.getByTestId("inventory-row-layer"),
        first.layer,
      );
      await user.selectOptions(
        screen.getByTestId("inventory-row-environment"),
        first.environment,
      );
      await user.selectOptions(
        screen.getByTestId("inventory-row-exposure"),
        first.exposure,
      );
    }

    it("shows the add button to a maintainer only, and opens a dialog whose first field is the name", async () => {
      fetchMock.mockResolvedValue(summary());
      const user = userEvent.setup();
      renderPage();

      const add = await screen.findByTestId("inventory-add-system");
      expect(add).toHaveTextContent("เพิ่ม System");
      await user.click(add);
      const dialog = await screen.findByRole("dialog", {
        name: "เพิ่ม System",
      });
      expect(within(dialog).getByLabelText("ชื่อ System")).toHaveFocus();
      expect(within(dialog).queryByTestId("inventory-row-system")).toBeNull();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(add).toHaveFocus();
    });

    it("offers no add button to a member", async () => {
      fetchMock.mockResolvedValue(summary({ canUpload: false }));
      renderPage();

      await screen.findByTestId("inventory-tile-total");
      expect(screen.queryByTestId("inventory-add-system")).toBeNull();
    });

    it("sends the name with the seven columns of the first row, then reloads and says so", async () => {
      fetchMock.mockResolvedValue(summary());
      createMock.mockResolvedValue({
        ...BASE_SYSTEM,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        name: "Cache",
      });
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByTestId("inventory-add-system"));
      await user.type(screen.getByTestId("inventory-row-name"), "Cache");
      await fillRow(user);
      await user.click(screen.getByTestId("inventory-row-save"));

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledWith(ORG, PROJECT, {
          name: "Cache",
          ...first,
        });
      });
      expect(await screen.findByTestId("inventory-success")).toHaveTextContent(
        "เพิ่ม System แล้ว",
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
    });

    it("puts a name another System has under the name field and keeps every typed value", async () => {
      fetchMock.mockResolvedValue(summary());
      createMock.mockRejectedValue(
        new ApiError(
          "INVENTORY_SYSTEM_NAME_TAKEN",
          "มี System ชื่อ billing api ใน Project นี้แล้ว",
          409,
        ),
      );
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByTestId("inventory-add-system"));
      await user.type(screen.getByTestId("inventory-row-name"), "billing api");
      await fillRow(user);
      await user.click(screen.getByTestId("inventory-row-save"));

      const error = await screen.findByTestId("inventory-row-name-error");
      expect(error).toHaveTextContent("มี System ชื่อ billing api");
      const name = screen.getByTestId("inventory-row-name");
      expect(name).toHaveValue("billing api");
      expect(name).toHaveAttribute("aria-invalid", "true");
      expect(name).toHaveAttribute("aria-describedby", error.id);
      expect(name).toHaveFocus();
      expect(screen.getByTestId("inventory-row-owner")).toHaveValue(
        first.owner,
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByTestId("inventory-success")).toBeNull();
    });

    it("puts the reason of the name and of a failing column each under its own field", async () => {
      fetchMock.mockResolvedValue(summary());
      createMock.mockRejectedValue(
        new ApiError("INVENTORY_ROW_INVALID", "x", 400, {
          issues: [
            { column: "System", code: "required" },
            { column: "Version", code: "version_not_patch_level" },
          ],
        }),
      );
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByTestId("inventory-add-system"));
      await user.click(screen.getByTestId("inventory-row-save"));

      expect(
        await screen.findByTestId("inventory-row-name-error"),
      ).toHaveTextContent("ว่าง ต้องกรอก");
      expect(
        screen.getByTestId("inventory-row-version-error"),
      ).toHaveTextContent("ไม่ถึง patch level");
      expect(screen.queryByTestId("inventory-row-error")).toBeNull();
    });

    it("disables saving while the System is created", async () => {
      fetchMock.mockResolvedValue(summary());
      createMock.mockReturnValue(new Promise(() => undefined));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByTestId("inventory-add-system"));
      await user.click(screen.getByTestId("inventory-row-save"));

      expect(await screen.findByTestId("inventory-row-save")).toBeDisabled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it("shows what the System page carried after a delete in the live region", async () => {
      fetchMock.mockResolvedValue(summary());
      renderPage({ notice: "ลบ System HR Portal และ 42 แถวแล้ว" });

      expect(await screen.findByTestId("inventory-success")).toHaveTextContent(
        "ลบ System HR Portal และ 42 แถวแล้ว",
      );
      expect(
        screen.getByTestId("inventory-success").closest("[aria-live]"),
      ).not.toBeNull();
    });

    it("links every System name to its page and lists an empty System as having no rows", async () => {
      const empty = {
        ...BASE_SYSTEM,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
        name: "Retired",
        owners: [],
        totalRows: 0,
        usableRows: 0,
        lowQuality: false,
      };
      fetchMock.mockResolvedValue(
        summary({
          systems: [...summary().systems, empty],
          systemCount: 3,
        }),
      );
      renderPage();

      const link = await screen.findByTestId(
        `inventory-open-system-${empty.id}`,
      );
      expect(link).toHaveAttribute(
        "href",
        `/organizations/${ORG}/projects/${PROJECT}/inventory/systems/${empty.id}`,
      );
      const row = screen.getByTestId(`inventory-system-${empty.id}`);
      expect(within(row).getByText("ไม่มีแถว")).toBeInTheDocument();
      expect(within(row).queryByText("ผ่าน")).toBeNull();
      expect(
        screen.getByTestId(`inventory-open-system-${BILLING}`),
      ).toBeInTheDocument();
    });
  });
});
