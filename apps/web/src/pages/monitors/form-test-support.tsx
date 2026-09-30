import type { MonitorRecord } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { OrgSwitcher } from "../../components/shell/OrgSwitcher";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { A, MONITOR_ID } from "./detail-test-support";
import { DetailPage } from "./DetailPage";
import { MonitorFormPage } from "./MonitorFormPage";
import { OverviewPage } from "./OverviewPage";

export { A, B, MONITOR_ID, context, detail } from "./detail-test-support";

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
    ...overrides,
  };
}

function Routing() {
  return (
    <>
      <OrgSwitcher collapsed={false} />
      <output data-testid="location">{useLocation().pathname}</output>
      <Routes>
        <Route
          path="/organizations/:organizationId/monitors/new"
          element={<MonitorFormPage mode="create" />}
        />
        <Route
          path="/organizations/:organizationId/monitors/:monitorId/edit"
          element={<MonitorFormPage mode="edit" />}
        />
        <Route
          path="/organizations/:organizationId/monitors/:monitorId"
          element={<DetailPage />}
        />
        <Route
          path="/organizations/:organizationId/monitors"
          element={<OverviewPage />}
        />
      </Routes>
    </>
  );
}

export function renderForm(path: string, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routing />
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    ),
  };
}

export const newPath = (organizationId = A) =>
  `/organizations/${organizationId}/monitors/new`;
export const editPath = (organizationId = A, monitorId = MONITOR_ID) =>
  `/organizations/${organizationId}/monitors/${monitorId}/edit`;

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
