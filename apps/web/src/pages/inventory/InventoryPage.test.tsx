import type { InventorySummary } from "@nightwatch/api-contract";
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
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  createSystem,
  downloadInventory,
  fetchInventory,
  fetchRows,
  inventoryKeys,
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
  downloadInventory: vi.fn(),
}));

const fetchMock = vi.mocked(fetchInventory);
const rowsMock = vi.mocked(fetchRows);
const createMock = vi.mocked(createSystem);
const exportMock = vi.mocked(downloadInventory);

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
  return Object.assign(router, { unmount: view.unmount, client });
}

beforeEach(() => {
  fetchMock.mockReset();
  rowsMock.mockReset();
  createMock.mockReset();
  exportMock.mockReset();
  rowsMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
});

describe("InventoryPage", () => {
  it("withdraws cached summary actions when rows are refused and keeps viewer permissions after retry", async () => {
    fetchMock.mockResolvedValue(summary());
    rowsMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "refused", 403),
    );
    renderPage();
    await screen.findByRole("button", { name: "ลองใหม่" });
    await waitFor(() => {
      expect(screen.queryByTestId("inventory-add-system")).toBeNull();
      expect(screen.queryByTestId("inventory-import-link")).toBeNull();
      expect(screen.queryByTestId("inventory-export")).toBeNull();
    });
    expect(screen.queryByTestId("inventory-rows-table")).toBeNull();
    fetchMock.mockResolvedValue(summary({ canUpload: false }));
    rowsMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ลองใหม่" }));
    await screen.findByTestId("inventory-rows-empty");
    expect(screen.queryByTestId("inventory-row-add")).toBeNull();
    expect(screen.queryByTestId("inventory-add-system")).toBeNull();
  });

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
    const details = screen.getByTestId("inventory-quality-details");
    expect(details).not.toHaveAttribute("open");
    await userEvent
      .setup()
      .click(within(details).getByText(/คุณภาพข้อมูลราย System ·/));
    expect(details).toHaveAttribute("open");
    const billing = screen.getByTestId(`inventory-system-${BILLING}`);
    expect(within(billing).getByText("24 · 100%")).toBeInTheDocument();
    expect(
      within(billing).getByTestId(`inventory-quality-${BILLING}`),
    ).toHaveAttribute("data-low-quality", "false");
    expect(
      within(billing).queryByTestId(`inventory-rejected-link-${BILLING}`),
    ).toBeNull();
    const hr = screen.getByTestId(`inventory-system-${HR}`);
    expect(within(hr).getByText("12 · 75%")).toBeInTheDocument();
    expect(within(hr).getByTestId(`inventory-quality-${HR}`)).toHaveAttribute(
      "data-low-quality",
      "true",
    );
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

  it("shows the denied state with no retry when the read is refused", async () => {
    fetchMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "x", 403));
    renderPage();

    expect(await screen.findByTestId("inventory-denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).toBeNull();
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

    it.each([
      new ApiError("SERVICE_UNAVAILABLE", "unavailable", 503),
      new TypeError("Failed to fetch"),
    ])(
      "preserves the System draft but blocks submission through summary failure and retry: %s",
      async (error) => {
        fetchMock.mockResolvedValue(summary());
        createMock.mockResolvedValue({ ...BASE_SYSTEM, name: "Cache" });
        const user = userEvent.setup();
        const { client } = renderPage();
        await user.click(await screen.findByTestId("inventory-add-system"));
        const name = screen.getByTestId("inventory-row-name");
        await user.type(name, "Cache");
        await fillRow(user);
        const form = screen.getByTestId("inventory-row-save").closest("form");
        if (form === null) throw new Error("missing row form");
        let fail!: (error: unknown) => void;
        fetchMock.mockReturnValue(
          new Promise((_, reject) => {
            fail = reject;
          }),
        );
        let refresh!: Promise<void>;
        act(() => {
          refresh = client.invalidateQueries({
            queryKey: inventoryKeys.summary(ORG, PROJECT),
          });
        });
        await waitFor(() =>
          expect(screen.getByTestId("inventory-row-save")).toBeDisabled(),
        );
        fireEvent.submit(form);
        expect(createMock).not.toHaveBeenCalled();
        await act(async () => {
          fail(error);
          await refresh;
        });
        await waitFor(() => {
          expect(screen.queryByTestId("inventory-import-link")).toBeNull();
        });
        expect(screen.getByTestId("inventory-row-name")).toBe(name);
        expect(name).toHaveValue("Cache");
        for (const [key, value] of Object.entries(first)) {
          expect(screen.getByTestId(`inventory-row-${key}`)).toHaveValue(value);
        }
        expect(screen.getByTestId("inventory-row-save")).toBeDisabled();
        await user.click(screen.getByTestId("inventory-row-save"));
        await user.click(name);
        await user.keyboard("{Enter}");
        fireEvent.submit(form);
        expect(createMock).not.toHaveBeenCalled();

        let recover!: (value: InventorySummary) => void;
        fetchMock.mockReturnValue(
          new Promise((resolve) => {
            recover = resolve;
          }),
        );
        // Retry must be reachable inside the modal's Tab trap.
        await user.click(name);
        await user.tab({ shift: true });
        expect(
          screen.getByTestId("inventory-row-permissions-retry"),
        ).toHaveFocus();
        await user.keyboard("{Enter}");
        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledTimes(3);
        });
        expect(screen.getByTestId("inventory-row-save")).toBeDisabled();
        expect(
          screen.getByTestId("inventory-row-permissions-retry"),
        ).toBeDisabled();
        expect(name).toHaveValue("Cache");
        fireEvent.submit(form);
        expect(createMock).not.toHaveBeenCalled();
        act(() => {
          recover(summary());
        });
        await waitFor(() =>
          expect(screen.getByTestId("inventory-row-save")).toBeEnabled(),
        );
        await user.click(screen.getByTestId("inventory-row-save"));
        await waitFor(() => {
          expect(createMock).toHaveBeenCalledWith(ORG, PROJECT, {
            name: "Cache",
            ...first,
          });
        });
        expect(
          await screen.findByTestId("inventory-success"),
        ).toBeInTheDocument();
      },
    );

    it("allows Cancel to discard the retained draft while summary retry is pending", async () => {
      fetchMock.mockResolvedValue(summary());
      const user = userEvent.setup();
      const { client } = renderPage();
      await user.click(await screen.findByTestId("inventory-add-system"));
      await user.type(screen.getByTestId("inventory-row-name"), "Unsaved");
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await act(async () => {
        await client.invalidateQueries({
          queryKey: inventoryKeys.summary(ORG, PROJECT),
        });
      });
      await screen.findByTestId("inventory-row-permissions-retry");
      let recover!: (value: InventorySummary) => void;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          recover = resolve;
        }),
      );
      await user.click(screen.getByTestId("inventory-row-permissions-retry"));
      await waitFor(() =>
        expect(
          screen.getByTestId("inventory-row-permissions-retry"),
        ).toBeDisabled(),
      );
      expect(screen.getByTestId("inventory-row-cancel")).toBeEnabled();
      await user.click(screen.getByTestId("inventory-row-cancel"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
      act(() => {
        recover(summary());
      });
      await user.click(await screen.findByTestId("inventory-add-system"));
      expect(screen.getByTestId("inventory-row-name")).toHaveValue("");
    });

    it.each([401, 403, 404, "viewer", "rows"] as const)(
      "withdraws an open private draft on authoritative refusal: %s",
      async (refusal) => {
        fetchMock.mockResolvedValue(summary());
        const user = userEvent.setup();
        const { client } = renderPage();
        await user.click(await screen.findByTestId("inventory-add-system"));
        await user.type(
          screen.getByTestId("inventory-row-name"),
          "Private draft",
        );
        if (refusal === "viewer")
          fetchMock.mockResolvedValue(summary({ canUpload: false }));
        else if (refusal === "rows")
          rowsMock.mockRejectedValue(
            new ApiError("MEMBERSHIP_DENIED", "refused", 403),
          );
        else
          fetchMock.mockRejectedValue(
            new ApiError(`HTTP_${String(refusal)}`, "refused", refusal),
          );
        await act(async () => {
          await client.invalidateQueries({
            queryKey:
              refusal === "rows"
                ? inventoryKeys.all(ORG, PROJECT)
                : inventoryKeys.summary(ORG, PROJECT),
          });
        });
        await waitFor(() => {
          expect(screen.queryByTestId("inventory-row-dialog")).toBeNull();
        });
        expect(screen.queryByTestId("inventory-add-system")).toBeNull();
        expect(screen.queryByTestId("inventory-import-link")).toBeNull();
        expect(screen.queryByTestId("inventory-row-add")).toBeNull();
        expect(createMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue(summary());
        rowsMock.mockResolvedValue({
          rows: [],
          total: 0,
          page: 1,
          pageSize: 25,
        });
        await act(async () => {
          await client.invalidateQueries({
            queryKey: inventoryKeys.all(ORG, PROJECT),
          });
        });
        await user.click(await screen.findByTestId("inventory-add-system"));
        expect(screen.getByTestId("inventory-row-name")).toHaveValue("");
      },
    );

    it("shows the add button to a maintainer only, and opens a dialog whose first field is the name", async () => {
      fetchMock.mockResolvedValue(summary());
      const user = userEvent.setup();
      renderPage();

      const add = await screen.findByTestId("inventory-add-system");
      expect(add).toHaveTextContent("เพิ่มระบบใน Inventory");
      await user.click(add);
      const dialog = await screen.findByRole("dialog", {
        name: "เพิ่มระบบใน Inventory",
      });
      expect(dialog).toHaveAttribute(
        "aria-describedby",
        within(dialog).getByTestId("inventory-system-description").id,
      );
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
        "เพิ่มระบบใน Inventory แล้ว",
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

describe("InventoryPage export", () => {
  it("offers Export Excel to a member who cannot change the inventory, as an icon button whose tooltip is its label", async () => {
    fetchMock.mockResolvedValue(summary({ canUpload: false }));
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole("button", { name: "Export Excel" });
    expect(button).toHaveAttribute("aria-label", "Export Excel");
    expect(button).toHaveTextContent("");
    expect(screen.queryByTestId("inventory-import-link")).toBeNull();
    expect(screen.queryByTestId("inventory-add-system")).toBeNull();
    await user.hover(button);
    expect(screen.getByTestId("tooltip")).toHaveTextContent(
      button.getAttribute("aria-label") ?? "",
    );
  });

  it("keeps Import and the System button beside it for a maintainer", async () => {
    fetchMock.mockResolvedValue(summary());
    renderPage();

    expect(await screen.findByTestId("inventory-import-link")).toBeVisible();
    expect(screen.getByTestId("inventory-add-system")).toBeVisible();
    expect(screen.getByTestId("inventory-export")).toBeVisible();
  });

  it("offers the file of a Project without inventory", async () => {
    fetchMock.mockResolvedValue(
      summary({ systemCount: 0, totalRows: 0, usableRows: 0, systems: [] }),
    );
    renderPage();

    expect(await screen.findByTestId("inventory-export")).toBeEnabled();
  });

  it("downloads the Project's file under the name the server gives, and blocks a second click while it is built", async () => {
    fetchMock.mockResolvedValue(summary());
    let finish: (file: { blob: Blob; filename: string }) => void = () => {
      throw new Error("the download has not started");
    };
    exportMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const blob = new Blob(["xlsx"]);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:inventory");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchors: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push(this.download);
    });
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByTestId("inventory-export");
    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(exportMock).toHaveBeenCalledTimes(1);
    expect(exportMock.mock.calls[0]?.slice(0, 3)).toEqual([
      ORG,
      PROJECT,
      undefined,
    ]);

    finish({ blob, filename: "inventory-payments-2026-11-22.xlsx" });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    expect(anchors).toEqual(["inventory-payments-2026-11-22.xlsx"]);
  });

  it("shows why the file could not be made as an alert and lets the member try again", async () => {
    fetchMock.mockResolvedValue(summary());
    exportMock.mockRejectedValueOnce(
      new ApiError(
        "INVENTORY_EXPORT_TOO_LARGE",
        "inventory ของ Project ใหญ่เกินกว่าจะ export",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-export"));

    expect(
      await screen.findByTestId("inventory-export-error"),
    ).toHaveTextContent("ใหญ่เกินกว่าจะ export");
    expect(screen.getByTestId("inventory-export")).toBeEnabled();
    expect(screen.getByTestId("inventory-tile-total")).toBeInTheDocument();
  });

  it("shows the stale-rows message of a refused export as an alert", async () => {
    fetchMock.mockResolvedValue(summary());
    exportMock.mockRejectedValueOnce(
      new ApiError(
        "INVENTORY_EXPORT_STALE_ROWS",
        "2 แถวยังมีข้อผิดพลาดของช่อง System จากก่อนเปลี่ยนชื่อ System",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("inventory-export"));

    expect(
      await screen.findByTestId("inventory-export-error"),
    ).toHaveTextContent("2 แถวยังมีข้อผิดพลาดของช่อง System");
    expect(screen.getByTestId("inventory-export")).toBeEnabled();
    expect(screen.getByTestId("inventory-tile-total")).toBeInTheDocument();
  });
});
