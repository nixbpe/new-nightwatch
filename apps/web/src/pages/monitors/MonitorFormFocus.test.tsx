import type { MeContextResponse } from "@nightwatch/api-contract";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  RouterProvider,
  type LoaderFunctionArgs,
} from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AppShell } from "../../components/shell/AppShell";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import {
  fetchMonitorDetail,
  fetchMonitorList,
  updateMonitor,
} from "../../lib/api/monitors";
import {
  fetchOrganizationNotificationSettings,
  fetchUnreadCount,
} from "../../lib/api/notifications";
import { ApiError } from "../../lib/api/client";
import {
  bindQueryClientIdentity,
  getContextPublicationSnapshot,
  publishActiveQueryClient,
  resetQueryClientRegistry,
  subscribeToContextPublication,
} from "../../lib/queryClient";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import {
  projectsLoader,
  monitorCreateLoader,
  monitorEditLoader,
} from "../../lib/auth/loaders";
import { guardUnassignedNetwork } from "../../test/guard-network";
import {
  A,
  B,
  context,
  detail,
  MONITOR_ID,
  must,
  P,
  projectDetail,
} from "./detail-test-support";
import { MonitorFormPage } from "./MonitorFormPage";

vi.mock("../../lib/auth-client", () => ({
  authClient: {
    getSession: () =>
      Promise.resolve({
        data: { user: { id: "user-1", emailVerified: true } },
        error: null,
      }),
    useSession: () => ({
      data: {
        user: { id: "user-1", name: "Tester", email: "tester@example.test" },
      },
    }),
  },
}));
vi.mock("../../lib/api/me", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorList: vi.fn(),
  updateMonitor: vi.fn(),
}));
// The shell's Project switcher reads these; no Project is the quietest state.
vi.mock("../../lib/api/projects", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchProjectList: () => Promise.resolve({ projects: [] }),
  fetchLastProject: () => Promise.resolve({ projectId: null }),
  fetchProjectDetail: () => Promise.resolve(projectDetail()),
}));
vi.mock("../../lib/api/notifications", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
  fetchUnreadCount: vi.fn(),
}));
guardUnassignedNetwork();
const resources: {
  client: QueryClient;
  router: ReturnType<typeof createMemoryRouter>;
}[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 20 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  vi.mocked(fetchUnreadCount).mockResolvedValue({
    unreadCount: 0,
    organizationId: A,
  });
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: true,
  });
});
afterEach(async () => {
  cleanup();
  resetQueryClientRegistry();
  focusManager.setFocused(undefined);
  for (const { client, router } of resources.splice(0)) {
    router.dispose();
    await client.cancelQueries();
    client.clear();
  }
});
async function openForm(
  mode: "create" | "edit" = "edit",
  withLoaders = false,
  routeOrg = A,
  beforeOverviewCommit?: (organizationId: string | undefined) => Promise<void>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(client, "user-1");
  publishActiveQueryClient("user-1", client);
  const router = createMemoryRouter(
    [
      {
        element: (
          <TenantProvider>
            <AppShell />
          </TenantProvider>
        ),
        children: [
          {
            path:
              mode === "edit"
                ? "/organizations/:organizationId/projects/:projectId/monitors/:monitorId/edit"
                : "/organizations/:organizationId/projects/:projectId/monitors/new",
            element: <MonitorFormPage mode={mode} />,
            loader: withLoaders
              ? mode === "edit"
                ? monitorEditLoader
                : monitorCreateLoader
              : undefined,
          },
          {
            path: "/organizations/:organizationId/projects",
            loader: withLoaders
              ? async (args: LoaderFunctionArgs) => {
                  const result = await projectsLoader(args);
                  await beforeOverviewCommit?.(args.params.organizationId);
                  return result;
                }
              : undefined,
            element: (
              <h1 data-testid="test-monitor-scope-overview">Scope overview</h1>
            ),
          },
        ],
      },
    ],
    {
      initialEntries: [
        `/organizations/${routeOrg}/projects/${P}/monitors/${mode === "edit" ? `${MONITOR_ID}/edit` : "new"}`,
      ],
    },
  );
  resources.push({ client, router });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const name = await screen.findByTestId("monitor-form-name");
  expect(name).toHaveAccessibleName();
  expect(screen.getByTestId("monitor-form-url")).toHaveAccessibleName();
  fireEvent.change(name, { target: { value: "private edited name" } });
  name.focus();
  return client;
}
function refreshOnFocus() {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
  });
}
function withdrawn() {
  expect(screen.queryByTestId("monitor-form-name")).toBeNull();
  expect(screen.queryByTestId("monitor-form-url")).toBeNull();
  // Disclosure predicate only: never use these controls to locate a component.
  const controls = document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");
  expect(
    Array.from(controls).some(
      (control) => control.value === "private edited name",
    ),
  ).toBe(false);
  expect(document.body.textContent).not.toContain(
    "https://api.acme.example/health",
  );
}
const headerToggle = () => screen.getByTestId("shell-sidebar-toggle");
const searchButton = () => screen.getByTestId("shell-search-open");
async function focusShell(
  owner: "header" | "palette",
  user: ReturnType<typeof userEvent.setup>,
) {
  if (owner === "header") {
    const button = headerToggle();
    expect(button).toHaveRole("button");
    expect(button).toHaveAccessibleName();
    button.focus();
    return button;
  }
  await user.click(searchButton());
  const query = await screen.findByTestId("shell-command-query");
  expect(query).toHaveRole("combobox");
  expect(query).toHaveAccessibleName();
  return query;
}
it.each(["header", "palette"] as const)(
  "CR88-02 native %s retains focus through pending, failure and explicit retry confirmation",
  async (owner) => {
    const user = userEvent.setup(),
      client = await openForm();
    let shellFocus = await focusShell(owner, user);
    const pending = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
    refreshOnFocus();
    await waitFor(() => {
      expect(getContextPublicationSnapshot(client).admission.kind).toBe(
        "confirming",
      );
    });
    withdrawn();
    expect(shellFocus).toHaveFocus();
    await act(async () => {
      pending.reject(new Error("confirmation unavailable"));
      await pending.promise.catch(() => undefined);
    });
    await screen.findByTestId("monitor-form-admission-retry");
    withdrawn();
    expect(shellFocus).toHaveFocus();
    if (owner === "palette") {
      await user.tab();
      expect(shellFocus).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.queryByTestId("shell-command-dialog")).toBeNull();
      expect(searchButton()).toHaveFocus();
    }
    const retry = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(retry.promise);
    await user.click(screen.getByTestId("monitor-form-admission-retry"));
    shellFocus = await focusShell(owner, user);
    withdrawn();
    expect(shellFocus).toHaveFocus();
    await act(async () => {
      retry.resolve(context());
      await retry.promise;
    });
    expect(await screen.findByTestId("monitor-form-name")).toHaveValue(
      "private edited name",
    );
    expect(shellFocus).toHaveFocus();
    if (owner === "palette") {
      await user.tab();
      expect(shellFocus).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(searchButton()).toHaveFocus();
      expect(screen.queryByTestId("shell-command-dialog")).toBeNull();
    }
  },
);
it.each(["header", "palette"] as const)(
  "CR88-02 relinquishes pending local restore after user moves from safe heading to native %s",
  async (owner) => {
    const user = userEvent.setup(),
      client = await openForm();
    const pending = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
    vi.mocked(updateMonitor).mockRejectedValueOnce(
      new ApiError("PERMISSION_DENIED", "Denied", 403),
    );
    await user.click(screen.getByTestId("monitor-form-save"));
    await waitFor(() => {
      expect(getContextPublicationSnapshot(client).admission.kind).toBe(
        "confirming",
      );
    });
    const heading = screen.getByTestId("monitor-form-title");
    expect(heading).toHaveFocus();
    withdrawn();
    const shellFocus = await focusShell(owner, user);
    expect(shellFocus).toHaveFocus();
    if (owner === "palette") {
      await user.tab();
      expect(shellFocus).toHaveFocus();
    }
    await act(async () => {
      pending.resolve(context());
      await pending.promise;
    });
    expect(await screen.findByTestId("monitor-form-name")).toHaveValue(
      "private edited name",
    );
    expect(shellFocus).toHaveFocus();
    if (owner === "palette") {
      await user.keyboard("{Escape}");
      expect(searchButton()).toHaveFocus();
    }
  },
);
it("CR88-02 external focus use cancels stale recovery even after that live header control is blurred", async () => {
  const client = await openForm(),
    pending = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  refreshOnFocus();
  await waitFor(() => {
    expect(getContextPublicationSnapshot(client).admission.kind).toBe(
      "confirming",
    );
  });
  expect(screen.getByTestId("monitor-form-title")).toHaveFocus();
  headerToggle().focus();
  headerToggle().blur();
  expect(document.body).toHaveFocus();
  await act(async () => {
    pending.resolve(context());
    await pending.promise;
  });
  await screen.findByTestId("monitor-form-name");
  expect(document.body).toHaveFocus();
});
it("CR88-02 native local field focus recovers after withdrawn failure and keyboard retry", async () => {
  const user = userEvent.setup(),
    client = await openForm(),
    pending = Promise.withResolvers<MeContextResponse>();
  screen.getByTestId("monitor-form-url").focus();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  refreshOnFocus();
  await waitFor(() => {
    expect(getContextPublicationSnapshot(client).admission.kind).toBe(
      "confirming",
    );
  });
  expect(screen.getByTestId("monitor-form-title")).toHaveFocus();
  withdrawn();
  await act(async () => {
    pending.reject(new Error("confirmation unavailable"));
    await pending.promise.catch(() => undefined);
  });
  const retry = await screen.findByTestId("monitor-form-admission-retry");
  retry.focus();
  vi.mocked(fetchMeContext).mockResolvedValueOnce(context());
  await user.keyboard("{Enter}");
  expect(await screen.findByTestId("monitor-form-url")).toHaveFocus();
  expect(screen.getByTestId("monitor-form-name")).toHaveValue(
    "private edited name",
  );
});

it.each(["create", "edit"] as const)(
  "CR88-R3 %s switch issues one navigation across the real destination-loader confirmation and retires the old draft",
  async (mode) => {
    const user = userEvent.setup(),
      client = await openForm(mode, true);
    const { router } = must(resources.at(-1));
    const navigate = vi.spyOn(router, "navigate");
    const timeline: {
      location: string;
      navigation: string;
      destination: string | null;
      admission: string;
    }[] = [];
    const observe = () =>
      timeline.push({
        location: router.state.location.pathname,
        navigation: router.state.navigation.state,
        destination: router.state.navigation.location?.pathname ?? null,
        admission: getContextPublicationSnapshot(client).admission.kind,
      });
    const stopRouter = router.subscribe(observe),
      stopPublication = subscribeToContextPublication(client, observe);
    const pending = Promise.withResolvers<MeContextResponse>();
    const switchedContext = { ...context(), lastActiveTenantId: B };
    vi.mocked(updateActiveOrganization).mockResolvedValueOnce(switchedContext);
    // The second resolver stays pending: a duplicate navigate cannot accidentally pass by committing a later loader.
    vi.mocked(fetchMeContext)
      .mockReturnValueOnce(pending.promise)
      .mockReturnValue(new Promise<MeContextResponse>(() => {}));
    try {
      await user.click(screen.getByTestId("shell-organization-switch"));
      await user.click(screen.getByTestId(`shell-organization-${B}`));
      await waitFor(() => {
        expect(getContextPublicationSnapshot(client).admission.kind).toBe(
          "confirming",
        );
      });
      expect(navigate).toHaveBeenCalledTimes(1);
      withdrawn();
      await act(async () => {
        pending.resolve(switchedContext);
        await pending.promise;
      });
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByTestId("test-monitor-scope-overview"),
      ).toHaveTextContent(/^Scope overview$/);
      expect(router.state.location.pathname).toBe(
        `/organizations/${B}/projects`,
      );
      expect(fetchMeContext).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId("monitor-form-name")).toBeNull();
    } finally {
      stopRouter();
      stopPublication();
      console.log(
        "CR88-R3 navigation metadata",
        mode,
        JSON.stringify(timeline),
      );
    }
  },
);

it.each(["create", "edit"] as const)(
  "CR88-R3 %s retires through B → A → C before URL commit, rejects obsolete redirects and requires fresh bookmark admission",
  async (mode) => {
    const C = "33333333-3333-4333-8333-333333333333";
    let active = A;
    const current = () => ({
      ...context("owner", [
        ...context().organizations,
        { id: C, name: "Gamma", slug: "gamma", role: "owner" as const },
      ]),
      lastActiveTenantId: active,
    });
    vi.mocked(fetchMeContext).mockImplementation(() =>
      Promise.resolve(current()),
    );
    vi.mocked(updateActiveOrganization).mockImplementation(
      ({ organizationId }) => {
        active = organizationId;
        return Promise.resolve(current());
      },
    );
    const a = Promise.withResolvers<undefined>(),
      b = Promise.withResolvers<undefined>(),
      c = Promise.withResolvers<undefined>();
    const user = userEvent.setup();
    await openForm(mode, true, A, (id) =>
      id === A ? a.promise : id === B ? b.promise : c.promise,
    );
    const { router } = must(resources.at(-1));
    const navigate = vi.spyOn(router, "navigate");
    const switchTo = async (targetId: string, expectedName: string) => {
      await user.click(screen.getByTestId("shell-organization-switch"));
      await user.click(screen.getByTestId(`shell-organization-${targetId}`));
      await waitFor(() =>
        expect(screen.getByTestId("shell-organization-name")).toHaveTextContent(
          expectedName,
        ),
      );
    };
    await switchTo(B, "Beta");
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(
        `/organizations/${B}/projects`,
      );
    });
    withdrawn();
    await switchTo(A, "Acme");
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(
        `/organizations/${A}/projects`,
      );
    });
    withdrawn();
    expect(navigate).toHaveBeenCalledTimes(2);
    await act(async () => {
      b.resolve(undefined);
      await b.promise;
    });
    expect(router.state.navigation.location?.pathname).toBe(
      `/organizations/${A}/projects`,
    );
    await switchTo(C, "Gamma");
    await waitFor(() => {
      expect(router.state.navigation.location?.pathname).toBe(
        `/organizations/${C}/projects`,
      );
    });
    withdrawn();
    expect(navigate).toHaveBeenCalledTimes(3);
    await act(async () => {
      a.resolve(undefined);
      await a.promise;
    });
    expect(router.state.navigation.location?.pathname).toBe(
      `/organizations/${C}/projects`,
    );
    await act(async () => {
      c.resolve(undefined);
      await c.promise;
    });
    expect(
      await screen.findByTestId("test-monitor-scope-overview"),
    ).toHaveTextContent(/^Scope overview$/);
    expect(router.state.location.pathname).toBe(`/organizations/${C}/projects`);
    await act(async () => {
      await router.navigate(
        `/organizations/${A}/projects/${P}/monitors/${mode === "edit" ? `${MONITOR_ID}/edit` : "new"}`,
      );
    });
    expect(await screen.findByTestId("monitor-form-name")).toHaveValue(
      mode === "create" ? "" : "Payments API",
    );
    expect(screen.getByTestId("monitor-form-name")).not.toHaveValue(
      "private edited name",
    );
    expect(active).toBe(C);
  },
);

it("CR88-R3 an existing member bookmark stays at its original URL until a genuine departure from its promoted route anchor", async () => {
  const user = userEvent.setup();
  await openForm("create", true, B);
  const { router } = must(resources.at(-1));
  const navigate = vi.spyOn(router, "navigate");
  expect(router.state.location.pathname).toBe(
    `/organizations/${B}/projects/${P}/monitors/new`,
  );
  expect(navigate).not.toHaveBeenCalled();
  vi.mocked(updateActiveOrganization).mockResolvedValueOnce({
    ...context(),
    lastActiveTenantId: B,
  });
  await user.click(screen.getByTestId("shell-organization-switch"));
  await user.click(screen.getByTestId(`shell-organization-${B}`));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByTestId("monitor-form-name")).toHaveValue(
    "private edited name",
  );
  vi.mocked(updateActiveOrganization).mockResolvedValueOnce(context());
  await user.click(screen.getByTestId("shell-organization-switch"));
  await user.click(screen.getByTestId(`shell-organization-${A}`));
  expect(
    await screen.findByTestId("test-monitor-scope-overview"),
  ).toHaveTextContent(/^Scope overview$/);
  expect(router.state.location.pathname).toBe(`/organizations/${A}/projects`);
  expect(navigate).toHaveBeenCalledTimes(1);
});
