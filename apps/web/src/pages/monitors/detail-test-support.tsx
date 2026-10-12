import { afterEach } from "vitest";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type {
  CheckResultView,
  MeContextResponse,
  Monitor,
  MonitorChecksResponse,
  MonitorIncidentsResponse,
  MonitorResponseTimesResponse,
  ProjectDetail,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";

import { TenantProvider, useTenant } from "../../lib/tenant/TenantProvider";
import { DetailPage } from "./DetailPage";
import { OverviewPage } from "./OverviewPage";

const resources: {
  router: ReturnType<typeof createMemoryRouter>;
  queryClient: QueryClient;
}[] = [];
afterEach(async () => {
  cleanup();
  for (const { router, queryClient } of resources.splice(0)) {
    router.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
  }
});

export const A = "11111111-1111-4111-8111-111111111111";
export const B = "22222222-2222-4222-8222-222222222222";
export const P = "33333333-3333-4333-8333-333333333333";
export const PROJECT_NAME = "Payments Platform";
export const MONITOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const DATA_AS_OF = "2026-09-30T07:32:05.000Z";
export const NOW = new Date("2026-09-30T08:00:00.000Z");

/** The Project the pages open in; a Project member by default, so an Organization viewer reads only. */
export function projectDetail(
  overrides: Partial<ProjectDetail> = {},
): ProjectDetail {
  return {
    id: P,
    name: PROJECT_NAME,
    slug: "payments",
    description: null,
    memberCount: 3,
    adminCount: 1,
    myRole: "member",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function context(
  role: "owner" | "admin" | "viewer" | "auditor" = "owner",
  organizations: MeContextResponse["organizations"] = [
    { id: A, name: "Acme", slug: "acme", role },
    { id: B, name: "Beta", slug: "beta", role: "owner" },
  ],
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "Tester",
      email: "tester@example.test",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId: A,
  };
}

export const baseResult: CheckResultView = {
  scheduledFor: "2026-09-30T07:30:00.000Z",
  checkedAt: "2026-09-30T07:30:00.000Z",
  outcome: "pass",
  httpStatus: 200,
  responseTimeMs: 182,
  failureReason: null,
  tlsReason: null,
  assertions: [],
  url: "https://api.acme.example/health",
  configVersion: 1,
  evaluatedFromPrefix: false,
};

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value in the test");
  }
  return value;
}

export const noResponseTimes: Extract<
  MonitorResponseTimesResponse,
  { range: "24h" }
> = {
  range: "24h",
  dataAsOf: DATA_AS_OF,
  window: {
    from: new Date(Date.parse(DATA_AS_OF) - 86400_000).toISOString(),
    to: DATA_AS_OF,
  },
  unit: "ms",
  points: [],
  gaps: [],
  pauses: [],
  configChanges: [],
};

/** A healthy, checked, https monitor; tests override only what they exercise. */
export function detail(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: MONITOR_ID,
    name: "Payments API",
    url: "https://api.acme.example/health",
    method: "GET",
    intervalSeconds: 300,
    timeoutSeconds: 10,
    headers: [],
    queryParams: [],
    body: null,
    expectedStatus: "200-299",
    assertions: [],
    auth: { type: "none" },
    secretSlots: [],
    status: "active",
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    health: "up",
    healthReason: null,
    lastKnownDown: false,
    consecutiveFailures: 0,
    lastCheckAt: "2026-09-30T07:30:00.000Z",
    openIncident: null,
    lastResult: baseResult,
    ssl: {
      state: "ok",
      host: "api.acme.example",
      issuer: "Example CA",
      notAfter: "2027-02-05T00:00:00.000Z",
      daysRemaining: 128,
      reason: null,
    },
    uptime: {
      h24: { percent: 100, checks: 288, coveragePercent: 100 },
      d7: { percent: 99.5, checks: 2016, coveragePercent: 100 },
      d30: { percent: 99.2, checks: 8640, coveragePercent: 100 },
    },
    dataAsOf: DATA_AS_OF,
    alerts: {
      failureThreshold: 2,
      downEnabled: true,
      sslEnabled: true,
      sslCautionDays: 30,
    },
    ...overrides,
  };
}

export const noChecks: MonitorChecksResponse = {
  checks: [],
  page: { limit: 20, offset: 0, total: 0 },
  urlChanges: [],
};
export const noIncidents: MonitorIncidentsResponse = {
  incidents: [],
  page: { limit: 20, offset: 0, total: 0 },
};

function Harness() {
  const { switchOrg } = useTenant();
  const navigate = useNavigate();
  return (
    <>
      <button
        data-testid="detail-harness-switch"
        type="button"
        onClick={() => {
          void switchOrg(B);
        }}
      >
        switch to B
      </button>
      <output data-testid="location">{useLocation().pathname}</output>
      <button
        data-testid="detail-harness-open"
        type="button"
        onClick={() => {
          void navigate(
            `/organizations/${A}/projects/${P}/monitors/${MONITOR_ID}`,
          );
        }}
      >
        open detail
      </button>
      <Outlet />
    </>
  );
}

export function renderDetail(
  organizationId = A,
  monitorId = MONITOR_ID,
  client?: QueryClient,
) {
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  bindQueryClientIdentity(queryClient, "user-1");
  const router = createMemoryRouter(
    [
      {
        element: <Harness />,
        children: [
          {
            path: "/organizations/:organizationId/projects/:projectId/monitors/:monitorId",
            element: <DetailPage />,
          },
          {
            path: "/organizations/:organizationId/projects/:projectId/monitors",
            element: <OverviewPage />,
          },
          {
            path: "/organizations/:organizationId/projects",
            element: <p data-testid="projects-page">projects</p>,
          },
        ],
      },
    ],
    {
      initialEntries: [
        `/organizations/${organizationId}/projects/${P}/monitors/${monitorId}`,
      ],
    },
  );
  resources.push({ router, queryClient });
  return {
    queryClient,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <RouterProvider router={router} />
        </TenantProvider>
      </QueryClientProvider>,
    ),
  };
}
