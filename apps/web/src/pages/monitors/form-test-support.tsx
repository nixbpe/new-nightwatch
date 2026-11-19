import { afterEach, expect, vi } from "vitest";
import { bindQueryClientIdentity } from "../../lib/queryClient";
import type {
  MonitorRecord,
  MonitorTestResult,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { Fragment, StrictMode } from "react";
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useLocation,
} from "react-router";

import { OrgSwitcher } from "../../components/shell/OrgSwitcher";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import {
  A,
  MONITOR_ID,
  P,
  must,
  context,
  projectDetail,
} from "./detail-test-support";
import { fetchMeContext } from "../../lib/api/me";
import { fetchProjectDetail } from "../../lib/api/projects";
import { fetchMonitorList } from "../../lib/api/monitors";
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

export function setFormAccessDefaults() {
  vi.mocked(fetchProjectDetail).mockResolvedValue(projectDetail());
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
}

export function formNotificationSettings() {
  return {
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  };
}

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

export function monitorTestResult(overrides: Partial<MonitorTestResult> = {}): {
  result: MonitorTestResult;
} {
  return {
    result: {
      checkedAt: "2026-09-30T07:30:00.000Z",
      outcome: "pass",
      httpStatus: 200,
      responseTimeMs: 182,
      diagnostics:
        overrides.httpStatus === null
          ? {
              redirects: null,
              dnsMs: null,
              connectMs: null,
              tlsMs: null,
              ttfbMs: null,
              remoteAddress: null,
              reasonPhrase: null,
            }
          : {
              redirects: 0,
              dnsMs: 2,
              connectMs: 3,
              tlsMs: 37,
              ttfbMs: 140,
              remoteAddress: "203.0.113.5",
              reasonPhrase: "OK",
            },
      failureReason: null,
      tlsReason: null,
      assertions: [],
      url: "https://api.acme.example/health",
      evaluatedFromPrefix: false,
      ssl: {
        level: "ok",
        daysRemaining: 128,
        host: "api.acme.example",
        issuer: "Example CA",
        notAfter: "2027-02-05T00:00:00.000Z",
      },
      ...overrides,
    },
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

export async function addFormRow(
  user: UserEvent,
  kind: "header" | "query" | "assertion",
): Promise<string> {
  const rowPattern = new RegExp(`^monitor-form-${kind}-row-`);
  const before = new Set(
    screen
      .queryAllByTestId(rowPattern)
      .map((row) => row.getAttribute("data-testid")),
  );
  await user.click(screen.getByTestId(`monitor-form-add-${kind}`));
  const added = screen
    .getAllByTestId(rowPattern)
    .filter((row) => !before.has(row.getAttribute("data-testid")));
  expect(added).toHaveLength(1);
  return must(must(added.pop()).getAttribute("data-testid") ?? undefined);
}

export function expectSavedFormName(): HTMLElement {
  const field = screen.getByTestId("monitor-form-name");
  expect(field).toHaveValue("Payments API");
  return field;
}

export function expectInvalid(field: HTMLElement) {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription();
  const described = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  const error = described.find((id) => id.endsWith("-error"));
  expect(error).toBeDefined();
  expect(document.getElementById(must(error))).not.toBeEmptyDOMElement();
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
