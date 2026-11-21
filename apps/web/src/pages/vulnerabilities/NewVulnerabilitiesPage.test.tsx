import type { NewCveList } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchNewVulnerabilities } from "../../lib/api/vulnerabilities";
import { NewVulnerabilitiesPage } from "./NewVulnerabilitiesPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AT = "2026-11-21T10:00:00.000Z";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/vulnerabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNewVulnerabilities: vi.fn(),
}));

const fetchMock = vi.mocked(fetchNewVulnerabilities);

const list = (overrides: Partial<NewCveList> = {}): NewCveList => ({
  windowDays: 30,
  checkedAt: AT,
  warnings: [],
  items: [],
  ...overrides,
});

const item = (overrides: Partial<NewCveList["items"][number]> = {}) => ({
  cveId: "CVE-2026-1000",
  vendor: "Redis",
  product: "Redis",
  version: "7.2.4",
  firstSeenAt: AT,
  cvssSeverity: "critical" as const,
  kev: true,
  stillFound: true,
  ...overrides,
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/projects/:projectId/vulnerabilities/new",
        element: <NewVulnerabilitiesPage />,
      },
      { path: "*", element: <p /> },
    ],
    {
      initialEntries: [
        `/organizations/${ORG}/projects/${PROJECT}/vulnerabilities/new`,
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

describe("NewVulnerabilitiesPage", () => {
  it("lists a new CVE with its component, severity, KEV and whether it is still found", async () => {
    fetchMock.mockResolvedValue(
      list({
        items: [
          item(),
          item({
            cveId: "CVE-2026-1001",
            cvssSeverity: null,
            kev: null,
            stillFound: false,
          }),
        ],
      }),
    );
    renderPage();
    const first = await screen.findByTestId("new-cve-CVE-2026-1000");
    expect(first).toHaveTextContent("Redis · Redis");
    expect(first).toHaveTextContent("7.2.4");
    expect(first).toHaveTextContent("วิกฤต");
    expect(first).toHaveTextContent("อยู่ใน KEV");
    expect(first).toHaveTextContent("ยังพบในการตรวจล่าสุด");
    const second = screen.getByTestId("new-cve-CVE-2026-1001");
    expect(second).toHaveTextContent("ไม่ทราบ");
    expect(second).toHaveTextContent("ไม่พบแล้วในการตรวจล่าสุด");
    expect(screen.getByTestId("new-cve-checked")).toHaveTextContent(
      "ตรวจล่าสุดเสร็จเมื่อ",
    );
    expect(screen.queryByTestId("new-cve-none")).toBeNull();
  });

  it("says none were found as of the last scan, without calling that safe, only when nothing warns", async () => {
    fetchMock.mockResolvedValue(list());
    renderPage();
    expect(await screen.findByTestId("new-cve-none")).toHaveTextContent(
      "ไม่ได้หมายความว่าปลอดภัย",
    );
  });

  it.each([
    ["no_scan", null],
    ["run_failed", AT],
    ["feed_down", AT],
    ["stale", AT],
  ] as const)(
    "shows the %s warning and never says there is no new CVE",
    async (warning, checkedAt) => {
      fetchMock.mockResolvedValue(list({ warnings: [warning], checkedAt }));
      renderPage();
      expect(
        await screen.findByTestId(`new-cve-warning-${warning}`),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("new-cve-none")).toBeNull();
      expect(screen.getByTestId("new-cve-checked")).toBeInTheDocument();
    },
  );

  it("shows the error and a retry when the list cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new ApiError("INTERNAL", "x", 500));
    renderPage();
    expect(
      await screen.findByRole("button", { name: "ลองใหม่" }),
    ).toBeVisible();
  });
});
