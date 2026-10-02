import type {
  AuditEventDetail,
  AuditExportRecord,
  AuditEventSummary,
  AuditLogListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { vi } from "vitest";

import { PREFERENCES_KEY } from "../../lib/preferences";

export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

export type TestRole = "owner" | "admin" | "auditor" | "viewer";

export const tenantState: {
  organizations: { id: string; name: string; slug: string; role: TestRole }[];
} = { organizations: [] };

export function setTenant(roleA: TestRole = "owner", roleB?: TestRole) {
  tenantState.organizations = [
    { id: ORG_A, name: "Acme", slug: "acme", role: roleA },
    ...(roleB === undefined
      ? []
      : [{ id: ORG_B, name: "Beta", slug: "beta", role: roleB }]),
  ];
}

// The pages read the confirmed context through useTenant; the shell provider is not under test here.
export const tenantMock = () => ({
  useTenant: () => ({
    me: { user: { id: "user-1" }, organizations: tenantState.organizations },
    mePending: false,
    meError: null,
    retryMe: vi.fn(),
  }),
});

export function setTimeZone(timeZone: string) {
  localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({
      language: "th",
      timeZone,
      hourCycle: "h23",
      weekStart: "monday",
    }),
  );
}

export function makeEvent(
  index: number,
  overrides: Partial<AuditEventSummary> = {},
): AuditEventSummary {
  return {
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    occurredAt: new Date(
      Date.UTC(2026, 9, 2, 7, 1, 55) - index * 60_000,
    ).toISOString(),
    category: "monitor",
    action: "organization.monitor.pause",
    actor: {
      userId: "user-1",
      displayName: "สมชาย ก.",
      roleAtTime: "admin",
      membership: "current",
    },
    target: {
      type: "monitor",
      monitorId: "99999999-9999-4999-8999-999999999999",
      displayName: "api-prod",
      deleted: false,
    },
    ...overrides,
  };
}

export function makeList(
  events: AuditEventSummary[],
  total = events.length,
  overrides: Partial<AuditLogListResponse> = {},
  offset = 0,
): AuditLogListResponse {
  return {
    organizationId: ORG_A,
    asOf: "2026-10-03T07:02:11.000Z",
    retainedFrom: "2025-10-03T07:02:11.000Z",
    recordingStartedAt: "2025-06-01T00:00:00.000Z",
    events,
    page: { limit: 50, offset, total },
    ...overrides,
  };
}

export function makeDetail(
  overrides: Partial<AuditEventDetail> = {},
): AuditEventDetail {
  return { ...makeEvent(1), changes: [], ...overrides };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

export function renderRoute(
  element: ReactNode,
  options: {
    path: string;
    entry: string;
    state?: unknown;
    queryClient?: QueryClient;
    extraRoutes?: ReactNode;
  },
) {
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: options.entry.split(/[?#]/)[0] ?? "",
              search: /\?[^#]*/.exec(options.entry)?.[0] ?? "",
              hash: /#.*/.exec(options.entry)?.[0] ?? "",
              state: options.state,
            },
          ]}
        >
          <LocationProbe />
          <Routes>
            <Route path={options.path} element={element} />
            {options.extraRoutes}
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

export function makeRecord(
  overrides: Partial<AuditExportRecord> = {},
): AuditExportRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    format: "csv",
    status: "generating",
    filters: {
      from: "2026-09-25T17:00:00.000Z",
      to: "2026-10-03T07:02:00.000Z",
      categories: ["member"],
      actorUserId: null,
      q: null,
    },
    timeZone: "Asia/Bangkok",
    requestedAt: "2026-10-03T07:05:10.000Z",
    completedAt: null,
    expiresAt: null,
    rowCount: null,
    failureCode: null,
    ...overrides,
  };
}
