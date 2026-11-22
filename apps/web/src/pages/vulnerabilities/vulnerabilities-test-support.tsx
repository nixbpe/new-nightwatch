import type {
  NewCveItem,
  NewCveList,
  PriorityItem,
  PriorityList,
  VulnerabilityComponent,
  VulnerabilityFinding,
  VulnerabilityList,
  VulnerabilityRun,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { SamplePage } from "./SamplePage";
import { VulnerabilitiesPage } from "./VulnerabilitiesPage";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SYSTEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const SYSTEM_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const RUN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const MAPPING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
export const AT = "2026-11-21T10:00:00.000Z";
const ROUTE =
  "/organizations/:organizationId/projects/:projectId/vulnerabilities";
export const BASE = `/organizations/${ORG}/projects/${PROJECT}/vulnerabilities`;

export const run = (
  overrides: Partial<VulnerabilityRun> = {},
): VulnerabilityRun => ({
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
    epss: { ok: true, at: AT },
  },
  ...overrides,
});

export const finding = (
  cveId: string,
  overrides: Partial<VulnerabilityFinding> = {},
): VulnerabilityFinding => ({
  cveId,
  sources: ["nvd"],
  cvssScore: 7.5,
  cvssSeverity: "high",
  epss: 0.01,
  epssPercentile: 0.5,
  kev: false,
  backport: false,
  advisoryId: null,
  backportReason: null,
  triage: null,
  ...overrides,
});

export const component = (
  overrides: Partial<VulnerabilityComponent> = {},
): VulnerabilityComponent => ({
  systemId: SYSTEM,
  system: "Billing API",
  vendor: "Redis",
  product: "Redis",
  version: "7.2.4",
  mappingId: MAPPING,
  exposure: "Internal",
  state: "none_found",
  checkedSources: ["nvd"],
  failedSources: [],
  backportPartial: false,
  findings: [],
  ...overrides,
});

/** Redis (two active CVEs and one backport), plus one component of each other state. */
export function list(
  overrides: Partial<VulnerabilityList> = {},
): VulnerabilityList {
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
    falsePositive: null,
    components: [
      component({
        state: "findings",
        findings: [
          finding("CVE-2024-0001", {
            sources: ["nvd", "osv"],
            cvssScore: 9.8,
            cvssSeverity: "critical",
            epss: 0.42,
            kev: true,
          }),
          finding("CVE-2024-0002", {
            sources: ["osv"],
            cvssScore: null,
            cvssSeverity: null,
            epss: null,
            kev: null,
          }),
          finding("CVE-2024-0003", {
            backport: true,
            advisoryId: "UBUNTU-CVE-2024-0003",
            backportReason:
              "distro advisory: fixed in openssl 3.0.2-0ubuntu1.12",
          }),
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

const redisItem = (
  rank: number,
  cveId: string,
  overrides: Partial<PriorityItem> = {},
): PriorityItem => ({
  rank,
  mappingId: MAPPING,
  triage: null,
  systemId: SYSTEM,
  system: "Billing API",
  vendor: "Redis",
  product: "Redis",
  version: "7.2.4",
  exposure: "Internal",
  cveId,
  cvssScore: 7.5,
  cvssSeverity: "high",
  epss: 0.01,
  kev: false,
  reasons: ["exposure", "epss", "cvss"],
  provisional: [],
  ...overrides,
});

export function priority(overrides: Partial<PriorityList> = {}): PriorityList {
  return {
    canManage: true,
    checkedAt: AT,
    items: [
      redisItem(1, "CVE-2024-0001", {
        cvssScore: 9.8,
        cvssSeverity: "critical",
        epss: 0.42,
        kev: true,
        reasons: ["kev", "exposure", "epss", "cvss"],
      }),
      redisItem(2, "CVE-2024-0002", {
        cvssScore: null,
        cvssSeverity: null,
        epss: null,
        reasons: ["exposure"],
        provisional: ["kev", "epss", "cvss"],
      }),
    ],
    notAffected: [],
    ...overrides,
  };
}

export const newItem = (
  cveId: string,
  overrides: Partial<NewCveItem> = {},
): NewCveItem => ({
  cveId,
  mappingId: MAPPING,
  vendor: "Redis",
  product: "Redis",
  version: "7.2.4",
  firstSeenAt: "2026-11-20T08:00:00.000Z",
  cvssSeverity: "high",
  kev: false,
  stillFound: true,
  ...overrides,
});

export function fresh(overrides: Partial<NewCveList> = {}): NewCveList {
  return {
    windowDays: 30,
    checkedAt: AT,
    warnings: [],
    items: [],
    truncated: false,
    ...overrides,
  };
}

/** The page at `entry` with the real router, so the URL it writes can be read back. */
export function renderAt(entry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: ROUTE, element: <VulnerabilitiesPage /> },
      { path: `${ROUTE}/sample`, element: <SamplePage /> },
      { path: "*", element: <p>elsewhere</p> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Document codes must never reach the screen: Q-xx, P1, P2, F-xxx. */
export const DOCUMENT_CODE = /\b(?:Q-\d{2}|P[1-4]|F-\d{3})\b/;
