import type {
  VulnerabilityComponent,
  VulnerabilityList,
  VulnerabilityRun,
  VulnerabilitySample,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  advanceVulnerabilityRun,
  drawSample,
  fetchSample,
  fetchVulnerabilities,
  reviewSampleItem,
  startVulnerabilityRun,
} from "../../lib/api/vulnerabilities";
import { VulnerabilitiesPage } from "./VulnerabilitiesPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SYSTEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const RUN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const AT = "2026-11-21T10:00:00.000Z";

vi.mock("../../lib/tenant/useLeaveOnOrganizationSwitch", () => ({
  useLeaveOnOrganizationSwitch: () => false,
}));
vi.mock("../../components/shell/useCurrentProject", () => ({
  useCurrentProject: () => ({ project: { name: "Payments Platform" } }),
}));
vi.mock("../../lib/api/vulnerabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVulnerabilities: vi.fn(),
  startVulnerabilityRun: vi.fn(),
  advanceVulnerabilityRun: vi.fn(),
  fetchSample: vi.fn(),
  drawSample: vi.fn(),
  reviewSampleItem: vi.fn(),
}));

const fetchMock = vi.mocked(fetchVulnerabilities);
const startMock = vi.mocked(startVulnerabilityRun);
const advanceMock = vi.mocked(advanceVulnerabilityRun);
const sampleMock = vi.mocked(fetchSample);
const drawMock = vi.mocked(drawSample);
const reviewMock = vi.mocked(reviewSampleItem);

const run = (overrides: Partial<VulnerabilityRun> = {}): VulnerabilityRun => ({
  id: RUN,
  status: "done",
  createdAt: AT,
  finishedAt: AT,
  totalUnits: 4,
  doneUnits: 4,
  failedUnits: 0,
  feeds: {
    nvd: { ok: true, at: AT },
    osv: { ok: true, at: AT },
    kev: { ok: true, at: AT },
    epss: { ok: false, at: AT },
  },
  ...overrides,
});

const component = (
  overrides: Partial<VulnerabilityComponent>,
): VulnerabilityComponent => ({
  systemId: SYSTEM,
  system: "Billing API",
  vendor: "Redis",
  product: "Redis",
  version: "7.2.4",
  state: "none_found",
  checkedSources: ["nvd"],
  failedSources: [],
  backportPartial: false,
  findings: [],
  ...overrides,
});

function list(overrides: Partial<VulnerabilityList> = {}): VulnerabilityList {
  return {
    canManage: true,
    run: run(),
    results: run(),
    summary: {
      components: 5,
      cves: 2,
      kev: 1,
      backport: 1,
      notCovered: 1,
      checkFailed: 1,
    },
    components: [
      component({
        product: "Redis",
        state: "findings",
        findings: [
          {
            cveId: "CVE-2024-0001",
            sources: ["nvd", "osv"],
            cvssScore: 9.8,
            cvssSeverity: "critical",
            epss: 0.42,
            epssPercentile: 0.97,
            kev: true,
            backport: false,
            advisoryId: null,
            backportReason: null,
          },
          {
            cveId: "CVE-2024-0002",
            sources: ["osv"],
            cvssScore: null,
            cvssSeverity: null,
            epss: null,
            epssPercentile: null,
            kev: null,
            backport: false,
            advisoryId: null,
            backportReason: null,
          },
          {
            cveId: "CVE-2024-0003",
            sources: ["nvd"],
            cvssScore: 7.5,
            cvssSeverity: "high",
            epss: 0.01,
            epssPercentile: 0.5,
            kev: false,
            backport: true,
            advisoryId: "UBUNTU-CVE-2024-0003",
            backportReason:
              "distro advisory: fixed in openssl 3.0.2-0ubuntu1.12",
          },
        ],
      }),
      component({ product: "Quiet" }),
      component({
        product: "Widget",
        state: "check_failed",
        checkedSources: [],
        failedSources: ["nvd"],
      }),
      component({ product: "agent", state: "not_covered", checkedSources: [] }),
      component({ product: "Later", state: "pending", checkedSources: [] }),
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
        path: "/organizations/:organizationId/projects/:projectId/vulnerabilities",
        element: <VulnerabilitiesPage />,
      },
      { path: "*", element: <p /> },
    ],
    {
      initialEntries: [
        `/organizations/${ORG}/projects/${PROJECT}/vulnerabilities`,
      ],
    },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const sample = (
  overrides: Partial<VulnerabilitySample> = {},
): VulnerabilitySample => ({
  id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  createdAt: AT,
  size: 2,
  reviewed: 0,
  falsePositives: 0,
  falsePositiveRate: null,
  items: [
    {
      position: 1,
      cveId: "CVE-2024-0001",
      component: "Redis Redis 7.2.4",
      verdict: null,
      reviewedAt: null,
    },
    {
      position: 2,
      cveId: "CVE-2024-0002",
      component: "Redis Redis 7.2.4",
      verdict: null,
      reviewedAt: null,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  for (const mock of [
    fetchMock,
    startMock,
    advanceMock,
    sampleMock,
    drawMock,
    reviewMock,
  ]) {
    mock.mockReset();
  }
  sampleMock.mockResolvedValue({ sample: null });
});

describe("VulnerabilitiesPage findings", () => {
  it("shows unknown scores as unknown, a backport with its advisory, and the tiles", async () => {
    fetchMock.mockResolvedValue(list());
    renderPage();

    const redis = await screen.findByTestId(
      `vuln-component-${SYSTEM}-Redis-7.2.4`,
    );
    const critical = within(redis).getByTestId("vuln-finding-CVE-2024-0001");
    expect(critical).toHaveTextContent("9.8");
    expect(critical).toHaveTextContent("วิกฤต");
    expect(critical).toHaveTextContent("42%");
    expect(critical).toHaveTextContent("อยู่ใน KEV");
    expect(critical).toHaveTextContent("NVD, OSV");
    const unknown = within(redis).getByTestId("vuln-finding-CVE-2024-0002");
    expect(unknown.textContent.match(/ไม่ทราบ/g)).toHaveLength(3);
    const backport = within(redis).getByTestId("vuln-backport-CVE-2024-0003");
    expect(backport).toHaveTextContent("UBUNTU-CVE-2024-0003");
    expect(backport).toHaveTextContent("fixed in openssl 3.0.2-0ubuntu1.12");
    expect(screen.getByTestId("vuln-tile-cves")).toHaveTextContent("2");
    expect(screen.getByTestId("vuln-tile-kev")).toHaveTextContent("1");
    expect(screen.getByTestId("vuln-tile-backport")).toHaveTextContent("1");
    expect(screen.getByTestId("vuln-tile-uncovered")).toHaveTextContent(
      "ตรวจไม่สำเร็จ 1",
    );
  });

  it("says none found as of the feed time without calling it safe, and never for a failed or uncovered component", async () => {
    fetchMock.mockResolvedValue(list());
    renderPage();

    const quiet = await screen.findByTestId(
      `vuln-component-${SYSTEM}-Quiet-7.2.4`,
    );
    expect(within(quiet).getByTestId("vuln-none-found")).toHaveTextContent(
      /ไม่พบ CVE ณ feed เวลา .+ \(ตรวจ NVD\) ไม่ได้หมายความว่าปลอดภัย/,
    );
    const failed = screen.getByTestId(`vuln-component-${SYSTEM}-Widget-7.2.4`);
    expect(within(failed).getByTestId("vuln-check-failed")).toHaveTextContent(
      "NVD ใช้ไม่ได้",
    );
    expect(within(failed).queryByTestId("vuln-none-found")).toBeNull();
    const uncovered = screen.getByTestId(
      `vuln-component-${SYSTEM}-agent-7.2.4`,
    );
    expect(within(uncovered).getByTestId("vuln-not-covered")).toHaveTextContent(
      "ยังไม่ครอบคลุม",
    );
    expect(
      within(uncovered).getByRole("link", { name: "ไปที่คิวยืนยัน" }),
    ).toHaveAttribute(
      "href",
      `/organizations/${ORG}/projects/${PROJECT}/inventory/mappings`,
    );
    expect(
      within(
        screen.getByTestId(`vuln-component-${SYSTEM}-Later-7.2.4`),
      ).getByText("รอตรวจ"),
    ).toBeInTheDocument();
  });

  it("shows when each feed answered and which one did not", async () => {
    fetchMock.mockResolvedValue(
      list({
        results: run({
          feeds: { nvd: { ok: true, at: AT }, epss: { ok: false, at: AT } },
        }),
      }),
    );
    renderPage();

    const feeds = await screen.findByTestId("vuln-feeds");
    expect(feeds).toHaveTextContent("NVD");
    expect(feeds).toHaveTextContent("OSV ไม่ได้ใช้");
    expect(feeds).toHaveTextContent("EPSS");
    expect(feeds).toHaveTextContent("(ใช้ไม่ได้บางส่วน)");
  });

  it("says there are no results yet, and lets only an admin start a run", async () => {
    fetchMock.mockResolvedValue(
      list({
        run: null,
        results: null,
        components: [],
        summary: {
          components: 0,
          cves: 0,
          kev: 0,
          backport: 0,
          notCovered: 0,
          checkFailed: 0,
        },
      }),
    );
    renderPage();
    expect(await screen.findByTestId("vuln-no-results")).toBeInTheDocument();
    expect(screen.getByTestId("vuln-run")).toBeEnabled();
  });

  it("gives a member the findings without the run button", async () => {
    fetchMock.mockResolvedValue(list({ canManage: false }));
    renderPage();
    await screen.findByTestId("vuln-feeds");
    expect(screen.queryByTestId("vuln-run")).toBeNull();
  });
});

describe("running a check", () => {
  it("starts a run on request", async () => {
    fetchMock.mockResolvedValueOnce(list());
    fetchMock.mockResolvedValue(
      list({ run: run({ status: "running", finishedAt: null, doneUnits: 0 }) }),
    );
    startMock.mockResolvedValue(
      run({ status: "running", finishedAt: null, doneUnits: 0 }),
    );
    advanceMock.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("vuln-run"));

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith(ORG, PROJECT);
    });
    expect(await screen.findByTestId("vuln-progress")).toHaveTextContent(
      "กำลังตรวจ 0 จาก 4",
    );
  });

  it("steps a running run until it is done, then reloads the findings", async () => {
    const running = run({ status: "running", finishedAt: null, doneUnits: 0 });
    fetchMock.mockResolvedValueOnce(list({ run: running }));
    fetchMock.mockResolvedValue(list());
    advanceMock.mockResolvedValueOnce({
      run: run({ status: "running", finishedAt: null, doneUnits: 2 }),
      retryAfterSeconds: null,
    });
    advanceMock.mockResolvedValueOnce({ run: run(), retryAfterSeconds: null });
    renderPage();

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledTimes(2);
    });
    expect(advanceMock.mock.calls[0]?.slice(0, 3)).toEqual([ORG, PROJECT, RUN]);
    await waitFor(() => {
      expect(screen.queryByTestId("vuln-progress")).toBeNull();
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("stops and says why when a step fails", async () => {
    fetchMock.mockResolvedValue(
      list({ run: run({ status: "running", finishedAt: null, doneUnits: 0 }) }),
    );
    advanceMock.mockRejectedValue(new ApiError("FEEDS_UNAVAILABLE", "x", 503));
    renderPage();

    expect(await screen.findByTestId("vuln-error")).toHaveTextContent(
      "บริการตรวจ CVE ยังไม่พร้อม",
    );
    expect(advanceMock).toHaveBeenCalledTimes(1);
  });

  it("does not step a run on behalf of a member", async () => {
    fetchMock.mockResolvedValue(
      list({
        canManage: false,
        run: run({ status: "running", finishedAt: null, doneUnits: 1 }),
      }),
    );
    renderPage();

    expect(await screen.findByTestId("vuln-progress")).toHaveTextContent(
      "กำลังตรวจ 1 จาก 4",
    );
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("warns when a finished run left products unchecked", async () => {
    fetchMock.mockResolvedValue(list({ run: run({ failedUnits: 2 }) }));
    renderPage();
    expect(await screen.findByTestId("vuln-failed-units")).toHaveTextContent(
      "ตรวจไม่สำเร็จ 2 product",
    );
  });
});

describe("review sample", () => {
  it("draws a sample, records a verdict and shows the false-positive rate", async () => {
    fetchMock.mockResolvedValue(list());
    drawMock.mockResolvedValue({ sample: sample() });
    reviewMock.mockResolvedValue({
      sample: sample({
        reviewed: 2,
        falsePositives: 1,
        falsePositiveRate: 0.5,
        items: [
          {
            position: 1,
            cveId: "CVE-2024-0001",
            component: "Redis Redis 7.2.4",
            verdict: "true_positive",
            reviewedAt: AT,
          },
          {
            position: 2,
            cveId: "CVE-2024-0002",
            component: "Redis Redis 7.2.4",
            verdict: "false_positive",
            reviewedAt: AT,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("vuln-sample-draw"));
    expect(await screen.findByTestId("vuln-sample-item-1")).toBeInTheDocument();
    expect(screen.getByTestId("vuln-sample-rate")).toHaveTextContent(
      "false positive ไม่ทราบ",
    );
    await user.click(screen.getByTestId("vuln-sample-false_positive-2"));

    await waitFor(() => {
      expect(reviewMock).toHaveBeenCalledTimes(1);
    });
    expect(reviewMock.mock.calls[0]?.slice(0, 5)).toEqual([
      ORG,
      PROJECT,
      sample().id,
      2,
      "false_positive",
    ]);
    expect(await screen.findByTestId("vuln-sample-rate")).toHaveTextContent(
      "1 (50%)",
    );
    expect(screen.getByTestId("vuln-sample-true_positive-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows a member the sample without the review buttons", async () => {
    fetchMock.mockResolvedValue(list({ canManage: false }));
    sampleMock.mockResolvedValue({ sample: sample() });
    renderPage();

    expect(await screen.findByTestId("vuln-sample-item-1")).toHaveTextContent(
      "ยังไม่ตรวจ",
    );
    expect(screen.queryByTestId("vuln-sample-draw")).toBeNull();
    expect(screen.queryByTestId("vuln-sample-true_positive-1")).toBeNull();
  });

  it("says when there is nothing to draw from", async () => {
    fetchMock.mockResolvedValue(list());
    drawMock.mockRejectedValue(
      new ApiError(
        "VULNERABILITY_SAMPLE_EMPTY",
        "ยังไม่มีผล match ให้สุ่มตรวจ",
        409,
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("vuln-sample-draw"));
    expect(await screen.findByTestId("vuln-sample-error")).toHaveTextContent(
      "ยังไม่มีผล match ให้สุ่มตรวจ",
    );
  });
});
