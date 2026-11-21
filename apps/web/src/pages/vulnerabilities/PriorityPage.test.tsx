import type { PriorityItem, PriorityList } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchPriority } from "../../lib/api/vulnerabilities";
import { PriorityPage } from "./PriorityPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SYSTEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const AT = "2026-11-21T10:00:00.000Z";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/vulnerabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPriority: vi.fn(),
}));

const fetchMock = vi.mocked(fetchPriority);

const MAPPING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

const item = (overrides: Partial<PriorityItem>): PriorityItem => ({
  rank: 1,
  mappingId: MAPPING,
  triage: null,
  systemId: SYSTEM,
  system: "Billing API",
  vendor: "Redis",
  product: "Redis",
  version: "7.2.4",
  exposure: "Internet-facing",
  cveId: "CVE-2026-1000",
  cvssScore: 9.8,
  cvssSeverity: "critical",
  epss: 0.42,
  kev: true,
  reasons: ["kev", "exposure", "epss", "cvss"],
  provisional: [],
  ...overrides,
});

const list = (overrides: Partial<PriorityList> = {}): PriorityList => ({
  canManage: false,
  checkedAt: AT,
  items: [],
  notAffected: [],
  ...overrides,
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/vulnerabilities/priority",
        element: <PriorityPage />,
      },
      { path: "*", element: <p /> },
    ],
    {
      initialEntries: [
        `/organizations/${ORG}/projects/${PROJECT}/vulnerabilities/priority`,
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
});

describe("PriorityPage", () => {
  it("shows each item with its rank and the facts that placed it, in order", async () => {
    fetchMock.mockResolvedValue(
      list({
        items: [
          item({}),
          item({
            rank: 2,
            cveId: "CVE-2026-1001",
            product: "Nginx",
            exposure: "Internal",
            kev: false,
            epss: 0.1,
            cvssScore: 5,
            cvssSeverity: "medium",
            reasons: ["exposure", "epss", "cvss"],
          }),
        ],
      }),
    );
    renderPage();
    const first = await screen.findByTestId("priority-item-1");
    expect(within(first).getByText("CVE-2026-1000")).toBeVisible();
    expect(screen.getByTestId("priority-reason-1")).toHaveTextContent(
      "อยู่ใน KEV · เปิดสู่อินเทอร์เน็ต · EPSS 42% · CVSS 9.8",
    );
    expect(screen.getByTestId("priority-reason-2")).toHaveTextContent(
      "ภายใน · EPSS 10% · CVSS 5.0",
    );
    expect(screen.queryByTestId("priority-provisional-1")).toBeNull();
    expect(screen.getByTestId("priority-checked")).toHaveTextContent(
      "จากการตรวจที่เสร็จเมื่อ",
    );
  });

  it("marks an item missing EPSS, CVSS or KEV as provisional and says which", async () => {
    fetchMock.mockResolvedValue(
      list({
        items: [
          item({
            cveId: "CVE-2026-2000",
            kev: null,
            epss: null,
            cvssScore: null,
            cvssSeverity: null,
            reasons: ["exposure"],
            provisional: ["kev", "epss", "cvss"],
          }),
        ],
      }),
    );
    renderPage();
    expect(
      await screen.findByTestId("priority-provisional-1"),
    ).toHaveTextContent("ชั่วคราว: ยังไม่ทราบ KEV, EPSS, CVSS");
    expect(screen.getByTestId("priority-reason-1")).toHaveTextContent(
      "เปิดสู่อินเทอร์เน็ต",
    );
    expect(screen.getByTestId("priority-reason-1")).not.toHaveTextContent(
      "EPSS 0",
    );
  });

  it("lists a not-affected CVE apart from the ordering with its reason, and gives an admin the control", async () => {
    fetchMock.mockResolvedValue(
      list({
        canManage: true,
        items: [item({})],
        notAffected: [
          {
            mappingId: MAPPING,
            triage: {
              status: "not_affected",
              reason: "ไม่ได้เปิดใช้ module นี้",
              changedBy: "Somchai",
              changedAt: AT,
            },
            systemId: SYSTEM,
            system: "Billing API",
            vendor: "Redis",
            product: "Redis",
            version: "7.2.4",
            exposure: "Internal",
            cveId: "CVE-2026-9000",
            cvssScore: 7,
            cvssSeverity: "high",
            epss: 0.1,
            kev: false,
          },
        ],
      }),
    );
    renderPage();
    const section = await screen.findByTestId("priority-not-affected");
    expect(section).toHaveTextContent("1 รายการ");
    expect(
      screen.getByTestId("priority-not-affected-CVE-2026-9000"),
    ).toHaveTextContent("ไม่ได้รับผลกระทบ: ไม่ได้เปิดใช้ module นี้");
    // It is not one of the ranked items.
    expect(screen.getByTestId("priority-item-1")).not.toHaveTextContent(
      "CVE-2026-9000",
    );
    expect(
      screen.getAllByTestId(/^triage-affected-/).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("gives a member the status and no control", async () => {
    fetchMock.mockResolvedValue(
      list({
        canManage: false,
        items: [
          item({
            triage: {
              status: "affected",
              reason: null,
              changedBy: "Somchai",
              changedAt: AT,
            },
          }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByTestId("priority-item-1")).toHaveTextContent(
      "ได้รับผลกระทบ",
    );
    expect(screen.queryByTestId(/^triage-affected-/)).toBeNull();
  });

  it("says there is nothing yet before the first scan, and that none found is not safe after it", async () => {
    fetchMock.mockResolvedValueOnce(list({ checkedAt: null }));
    renderPage();
    expect(await screen.findByTestId("priority-none")).toHaveTextContent(
      "ตรวจ CVE ที่หน้าช่องโหว่ก่อน",
    );
  });

  it("does not call an empty list safe", async () => {
    fetchMock.mockResolvedValue(list());
    renderPage();
    expect(await screen.findByTestId("priority-none")).toHaveTextContent(
      "ไม่ได้หมายความว่าปลอดภัย",
    );
  });

  it("shows the error and a retry when the list cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new ApiError("INTERNAL", "x", 500));
    renderPage();
    expect(
      await screen.findByRole("button", { name: "ลองใหม่" }),
    ).toBeVisible();
  });
});
