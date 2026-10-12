import { afterEach } from "vitest";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type { MonitorRecord } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { Fragment, StrictMode } from "react";
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from "react-router";

import { OrgSwitcher } from "../../components/shell/OrgSwitcher";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { A, MONITOR_ID, P } from "./detail-test-support";
import { DetailPage } from "./DetailPage";
import { MonitorFormPage } from "./MonitorFormPage";
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

export {
  A,
  B,
  MONITOR_ID,
  P,
  PROJECT_NAME,
  context,
  detail,
  projectDetail,
} from "./detail-test-support";

/** The record a write returns: the Detail fixture without its computed state. */
export function record(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
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
    version: 3,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    alerts: {
      failureThreshold: 2,
      downEnabled: true,
      sslEnabled: true,
      sslCautionDays: 30,
    },
    ...overrides,
  };
}

function Routing() {
  return (
    <>
      <OrgSwitcher collapsed={false} />
      <output data-testid="location">{useLocation().pathname}</output>
      <Outlet />
    </>
  );
}

export function renderForm(path: string, client?: QueryClient, strict = false) {
  const Wrapper = strict ? StrictMode : Fragment;
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  bindQueryClientIdentity(queryClient, "user-1");
  const router = createMemoryRouter(
    [
      {
        element: <Routing />,
        children: [
          {
            path: "/organizations/:organizationId/projects/:projectId/monitors/new",
            element: <MonitorFormPage mode="create" />,
          },
          {
            path: "/organizations/:organizationId/projects/:projectId/monitors/:monitorId/edit",
            element: <MonitorFormPage mode="edit" />,
          },
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
    { initialEntries: [path] },
  );
  resources.push({ router, queryClient });
  return {
    queryClient,
    router,
    ...render(
      <Wrapper>
        <QueryClientProvider client={queryClient}>
          <TenantProvider>
            <RouterProvider router={router} />
          </TenantProvider>
        </QueryClientProvider>
      </Wrapper>,
    ),
  };
}

export const newPath = (organizationId = A) =>
  `/organizations/${organizationId}/projects/${P}/monitors/new`;
export const editPath = (organizationId = A, monitorId = MONITOR_ID) =>
  `/organizations/${organizationId}/projects/${P}/monitors/${monitorId}/edit`;

/** A promise the test settles later, to hold a request open. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
