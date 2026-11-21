import type {
  InventoryMapping,
  InventoryMappingList,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  decideMapping,
  fetchMappings,
  searchCpe,
  suggestMapping,
} from "../../lib/api/inventory";
import { MappingQueuePage } from "./MappingQueuePage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F5 = "cpe:2.3:a:f5:big-ip_local_traffic_manager:*:*:*:*:*:*:*:*";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMappings: vi.fn(),
  decideMapping: vi.fn(),
  suggestMapping: vi.fn(),
  searchCpe: vi.fn(),
}));

const fetchMock = vi.mocked(fetchMappings);
const decideMock = vi.mocked(decideMapping);
const suggestMock = vi.mocked(suggestMapping);
const searchMock = vi.mocked(searchCpe);

function mapping(
  id: string,
  overrides: Partial<InventoryMapping> = {},
): InventoryMapping {
  return {
    id,
    vendor: "F5",
    product: "BIG-IP LTM",
    status: "pending",
    cpe: null,
    purl: null,
    confidence: null,
    source: null,
    confirmedAt: null,
    rows: 2,
    systems: ["HR Portal"],
    ...overrides,
  };
}

const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const D = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";

function list(canManage = true): InventoryMappingList {
  const items = [
    mapping(A, {
      vendor: "Redis",
      product: "Redis",
      cpe: "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*",
      confidence: 1,
      source: "nvd",
    }),
    mapping(B),
    mapping(C, {
      status: "confirmed",
      cpe: F5,
      source: "central",
      confirmedAt: "2026-11-21T10:00:00.000Z",
      product: "Done",
    }),
    mapping(D, {
      status: "unmapped",
      confirmedAt: "2026-11-21T10:00:00.000Z",
      product: "Internal agent",
    }),
  ];
  return {
    canManage,
    counts: { pending: 2, confirmed: 1, unmapped: 1 },
    items,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/inventory/mappings",
        element: <MappingQueuePage />,
      },
      { path: "*", element: <p /> },
    ],
    {
      initialEntries: [
        `/organizations/${ORG}/projects/${PROJECT}/inventory/mappings`,
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
  for (const mock of [fetchMock, decideMock, suggestMock, searchMock])
    mock.mockReset();
});

describe("MappingQueuePage", () => {
  it("separates pending from decided and shows unmapped as not covered", async () => {
    fetchMock.mockResolvedValue(list());
    renderPage();

    const redis = await screen.findByTestId(`mapping-row-${A}`);
    expect(within(redis).getByText("100%")).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`mapping-row-${B}`)).getByText(
        "ยังไม่มีข้อเสนอ",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`mapping-row-${C}`)).getByText("จากตารางกลาง"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`mapping-row-${D}`)).getByText(
        "ไม่มี CPE/purl · ยังไม่ครอบคลุม",
      ),
    ).toBeInTheDocument();
  });

  it("gives a member the table without any action", async () => {
    fetchMock.mockResolvedValue(list(false));
    renderPage();

    await screen.findByTestId(`mapping-row-${A}`);
    expect(screen.queryByTestId(`mapping-confirm-${A}`)).toBeNull();
    expect(screen.queryByTestId(`mapping-edit-${A}`)).toBeNull();
    expect(screen.queryByTestId(`mapping-none-${A}`)).toBeNull();
  });

  it("confirms the stored suggestion and moves the row to decided", async () => {
    fetchMock.mockResolvedValue(list());
    decideMock.mockResolvedValue(
      mapping(A, {
        vendor: "Redis",
        product: "Redis",
        status: "confirmed",
        cpe: "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*",
        source: "nvd",
        confirmedAt: "2026-11-21T11:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-confirm-${A}`));

    await waitFor(() => {
      expect(decideMock).toHaveBeenCalledTimes(1);
    });
    // The identifier on screen goes with the confirmation, so a replaced suggestion is not confirmed unseen.
    expect(decideMock.mock.calls[0]?.slice(0, 4)).toEqual([
      ORG,
      PROJECT,
      A,
      { action: "confirm", cpe: "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*" },
    ]);
    expect(await screen.findByTestId("mapping-notice")).toHaveTextContent(
      "ยืนยัน CPE/purl ของ Redis แล้ว",
    );
    expect(
      screen.getByRole("heading", { name: /รอยืนยัน 1/ }),
    ).toBeInTheDocument();
  });

  it("records no CPE or purl for a product", async () => {
    fetchMock.mockResolvedValue(list());
    decideMock.mockResolvedValue(
      mapping(B, {
        status: "unmapped",
        confirmedAt: "2026-11-21T11:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-none-${B}`));

    await waitFor(() => {
      expect(decideMock.mock.calls[0]?.[3]).toEqual({ action: "unmapped" });
    });
    expect(await screen.findByTestId("mapping-notice")).toHaveTextContent(
      "ไม่มี CPE/purl แล้ว",
    );
  });

  it("asks for a suggestion and shows it as pending with its confidence", async () => {
    fetchMock.mockResolvedValue(list());
    suggestMock.mockResolvedValueOnce({
      item: mapping(B, { cpe: F5, confidence: 0.82, source: "nvd" }),
      candidates: [{ cpe: F5, title: null, confidence: 0.82 }],
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-suggest-${B}`));
    expect(await screen.findByTestId("mapping-notice")).toHaveTextContent(
      "พบข้อเสนอของ BIG-IP LTM รอการยืนยัน",
    );
    expect(
      within(screen.getByTestId(`mapping-row-${B}`)).getByText("82%"),
    ).toBeInTheDocument();

    expect(suggestMock).toHaveBeenCalledTimes(1);
  });

  it("shows the wait message when a suggestion is limited", async () => {
    fetchMock.mockResolvedValue(list());
    suggestMock.mockRejectedValue(new ApiError("X", "x", 429));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-suggest-${B}`));

    expect(await screen.findByTestId("mapping-error")).toHaveTextContent(
      "ทำรายการบ่อยเกินไป โปรดลองใหม่ภายหลัง",
    );
  });
});

describe("messages", () => {
  it("does not call a refused decision an upload problem", async () => {
    fetchMock.mockResolvedValue(list());
    decideMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "x", 403));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-none-${B}`));

    expect(await screen.findByTestId("mapping-error")).toHaveTextContent(
      "เฉพาะผู้ดูแลโปรเจกต์ทำรายการนี้ได้",
    );
    expect(screen.getByTestId("mapping-error")).not.toHaveTextContent("upload");
  });

  it("drops an earlier failure when the next action succeeds", async () => {
    fetchMock.mockResolvedValue(list());
    suggestMock.mockRejectedValue(new ApiError("X", "x", 429));
    decideMock.mockResolvedValue(
      mapping(B, {
        status: "unmapped",
        confirmedAt: "2026-11-21T11:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-suggest-${B}`));
    expect(await screen.findByTestId("mapping-error")).toBeInTheDocument();
    await user.click(screen.getByTestId(`mapping-none-${B}`));

    await waitFor(() => {
      expect(screen.queryByTestId("mapping-error")).toBeNull();
    });
  });
});

describe("MappingDialog", () => {
  it("searches the dictionary and confirms the chosen CPE", async () => {
    fetchMock.mockResolvedValue(list());
    searchMock.mockResolvedValue({
      candidates: [
        { cpe: F5, title: "F5 BIG-IP LTM", confidence: 0.9 },
        {
          cpe: "cpe:2.3:o:f5:big-ip:*:*:*:*:*:*:*:*",
          title: null,
          confidence: 0.5,
        },
      ],
    });
    decideMock.mockResolvedValue(
      mapping(B, {
        status: "confirmed",
        cpe: F5,
        source: "manual",
        confirmedAt: "2026-11-21T11:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-edit-${B}`));
    expect(screen.getByTestId("mapping-query")).toHaveFocus();
    await user.click(screen.getByTestId("mapping-search"));
    const options = await screen.findAllByTestId("mapping-candidate");
    expect(options).toHaveLength(2);
    expect(options[0]).toBeChecked();
    await user.click(options[1] as HTMLElement);
    await user.click(screen.getByTestId("mapping-save"));

    await waitFor(() => {
      expect(decideMock).toHaveBeenCalledTimes(1);
    });
    expect(decideMock.mock.calls[0]?.slice(0, 4)).toEqual([
      ORG,
      PROJECT,
      B,
      { action: "confirm", cpe: "cpe:2.3:o:f5:big-ip:*:*:*:*:*:*:*:*" },
    ]);
    await waitFor(() => {
      expect(screen.queryByTestId("mapping-dialog")).toBeNull();
    });
    expect(searchMock.mock.calls[0]?.slice(0, 4)).toEqual([
      ORG,
      PROJECT,
      B,
      "F5 BIG-IP LTM",
    ]);
  });

  it("does not carry the old purl into a new choice", async () => {
    const withPurl = list();
    withPurl.items = withPurl.items.map((item) =>
      item.id === C
        ? {
            ...item,
            cpe: null,
            purl: "pkg:deb/ubuntu/openssl",
            status: "confirmed" as const,
          }
        : item,
    );
    fetchMock.mockResolvedValue(withPurl);
    searchMock.mockResolvedValue({
      candidates: [{ cpe: F5, title: null, confidence: 0.9 }],
    });
    decideMock.mockResolvedValue(
      mapping(C, {
        status: "confirmed",
        cpe: F5,
        source: "manual",
        confirmedAt: "2026-11-21T11:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-edit-${C}`));
    expect(screen.getByTestId("mapping-purl")).toHaveValue("");
    await user.click(screen.getByTestId("mapping-search"));
    await screen.findAllByTestId("mapping-candidate");
    await user.click(screen.getByTestId("mapping-save"));

    await waitFor(() => {
      expect(decideMock.mock.calls[0]?.[3]).toEqual({
        action: "confirm",
        cpe: F5,
      });
    });
  });

  it("checks the format before saving and sends a typed purl on its own", async () => {
    fetchMock.mockResolvedValue(list());
    decideMock.mockResolvedValue(
      mapping(B, {
        status: "confirmed",
        purl: "pkg:deb/ubuntu/openssl@3.0.2",
        source: "manual",
        confirmedAt: "2026-11-21T11:00:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-edit-${B}`));
    await user.type(screen.getByTestId("mapping-purl"), "deb/ubuntu/openssl");
    await user.type(screen.getByTestId("mapping-cpe"), "cpe:/a:f5:big-ip");
    await user.click(screen.getByTestId("mapping-save"));
    expect(screen.getByTestId("mapping-purl-error")).toBeInTheDocument();
    expect(screen.getByTestId("mapping-cpe-error")).toBeInTheDocument();
    expect(decideMock).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId("mapping-cpe"));
    await user.clear(screen.getByTestId("mapping-purl"));
    await user.type(
      screen.getByTestId("mapping-purl"),
      "pkg:deb/ubuntu/openssl@3.0.2",
    );
    await user.click(screen.getByTestId("mapping-save"));

    await waitFor(() => {
      expect(decideMock).toHaveBeenCalledTimes(1);
    });
    expect(decideMock.mock.calls[0]?.[3]).toEqual({
      action: "confirm",
      purl: "pkg:deb/ubuntu/openssl@3.0.2",
    });
  });

  it("asks for a choice when nothing was picked or typed, and keeps the dialog on a failed save", async () => {
    fetchMock.mockResolvedValue(list());
    decideMock.mockRejectedValue(new ApiError("X", "x", 503));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-edit-${B}`));
    await user.click(screen.getByTestId("mapping-save"));
    expect(screen.getByTestId("mapping-cpe-error")).toHaveTextContent(
      "เลือกผลการค้น หรือกรอก CPE หรือ purl",
    );

    await user.type(screen.getByTestId("mapping-cpe"), F5);
    await user.click(screen.getByTestId("mapping-save"));
    expect(await screen.findByTestId("mapping-save-error")).toHaveTextContent(
      "บริการ inventory ยังไม่พร้อม",
    );
    expect(screen.getByTestId("mapping-dialog")).toBeInTheDocument();
  });

  it("shows why a dictionary search failed and closes on Escape", async () => {
    fetchMock.mockResolvedValue(list());
    searchMock.mockRejectedValue(
      new ApiError(
        "CPE_DICTIONARY_UNAVAILABLE",
        "ค้น NVD CPE dictionary ไม่ได้ในตอนนี้",
        502,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId(`mapping-edit-${B}`));
    await user.click(screen.getByTestId("mapping-search"));
    expect(await screen.findByTestId("mapping-search-error")).toHaveTextContent(
      "ค้น NVD CPE dictionary ไม่ได้ในตอนนี้",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("mapping-dialog")).toBeNull();
    expect(screen.getByTestId(`mapping-edit-${B}`)).toHaveFocus();
  });
});
