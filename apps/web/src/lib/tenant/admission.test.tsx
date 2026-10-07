import { ORG_ALERTS_OFF_MESSAGE } from "../../pages/monitors/detail/labels";
import {
  fetchOrganizationNotificationSettings,
  organizationNotificationSettingsQueryKey,
} from "../api/notifications";
import { guardUnassignedNetwork } from "../../test/guard-network";
import {
  consumeMonitorFlash,
  useFlashNotice,
} from "../../pages/monitors/flash";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MeContextResponse } from "@nightwatch/api-contract";
import { SessionQueryProvider } from "../auth/SessionQueryProvider";
import { AppShell } from "../../components/shell/AppShell";
import { TenantProvider, useTenant } from "./TenantProvider";
import {
  bindQueryClientIdentity,
  getContextPublicationSnapshot,
  resolveQueryClientForIdentity,
  resetQueryClientRegistry,
} from "../queryClient";
import {
  fetchMeContext,
  ME_CONTEXT_QUERY_KEY,
  updateActiveOrganization,
} from "../api/me";
import { ApiError } from "../api/client";
import {
  createMonitor,
  testMonitorDraft,
  updateMonitor,
  fetchMonitorDetail,
  fetchMonitorChecks,
  fetchMonitorIncidents,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  pauseMonitor,
  deleteMonitor,
  fetchMonitorLastResponse,
  fetchMonitorEvents,
} from "../api/monitors";
import { MonitorFormPage } from "../../pages/monitors/MonitorFormPage";
import { DetailPage } from "../../pages/monitors/DetailPage";
import {
  context,
  must,
  A,
  B,
  MONITOR_ID,
  detail,
  noChecks,
  noIncidents,
  noResponseTimes,
} from "../../pages/monitors/detail-test-support";
const { sessionState } = vi.hoisted<{
  sessionState: { data: { user: { id: string } } | null; isPending: boolean };
}>(() => ({
  sessionState: {
    data: { user: { id: "user-1" } },
    isPending: false,
  },
}));
vi.mock("../auth-client", () => ({
  authClient: { useSession: () => sessionState },
}));
vi.mock("../../components/shell/Header", () => ({ Header: () => null }));
vi.mock("../../components/shell/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../../components/shell/CommandPalette", () => ({
  CommandPalette: () => null,
}));
vi.mock("../api/me", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../api/monitors", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createMonitor: vi.fn(),
  testMonitorDraft: vi.fn(),
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  pauseMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  fetchMonitorLastResponse: vi.fn(),
  fetchMonitorEvents: vi.fn(),
}));
vi.mock("../api/notifications", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(() =>
    Promise.resolve({
      organizationId: A,
      version: 1,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: false,
    }),
  ),
}));
guardUnassignedNetwork();
afterEach(() => {
  resetQueryClientRegistry();
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  vi.mocked(fetchMonitorLastResponse).mockResolvedValue({ response: null });
  vi.mocked(fetchMonitorEvents).mockResolvedValue({
    events: [],
    page: { limit: 20, offset: 0, total: 0 },
  });
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
});
function client() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  bindQueryClientIdentity(c, "user-1");
  return c;
}
function MembershipRefreshProbe() {
  const { refreshMembershipContext } = useTenant();
  return (
    <button onClick={() => void refreshMembershipContext()}>
      refresh membership
    </button>
  );
}
function Boundary() {
  return (
    <TenantProvider>
      <AppShell />
    </TenantProvider>
  );
}
function renderCreateForm(c: QueryClient) {
  const router = createMemoryRouter(
    [
      {
        element: <Boundary />,
        children: [
          {
            path: "/organizations/:organizationId/monitors/new",
            element: <MonitorFormPage mode="create" />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/new`] },
  );
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
function Flash() {
  const { notice, heading } = useFlashNotice();
  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Flash heading
      </h1>
      {notice && <p>created notice</p>}
    </>
  );
}
const consume = consumeMonitorFlash;
it("consumes flash state once without replacing the node or focus and resolves explicit revalidation and fresh bookmarks", async () => {
  const c = client();
  let loads = 0;
  const loader = async () => {
    loads++;
    await c.query({
      ...(await import("./bootstrap")).contextQueryOptions(c),
      staleTime: 0,
    });
    return null;
  };
  const routes = [
    {
      element: <Boundary />,
      children: [{ path: "/flash", loader, element: <Flash /> }],
    },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [
      { pathname: "/flash", state: { notice: "created" as const } },
    ],
  });
  let nullCommits = 0;
  router.subscribe((s) => {
    if (s.navigation.state === "idle" && s.location.state === null)
      nullCommits++;
  });
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const heading = await screen.findByRole("heading", { name: "Flash heading" });
  await waitFor(() => {
    expect(router.state.location.state).toBeNull();
  });
  expect(screen.getByRole("heading")).toBe(heading);
  expect(heading).toHaveFocus();
  expect(screen.getByText("created notice")).toBeVisible();
  expect(loads).toBe(1);
  expect(nullCommits).toBe(1);
  const delayed = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(delayed.promise);
  act(() => {
    void router.revalidate();
  });
  await screen.findByText("กำลังโหลดข้อมูลองค์กร…");
  expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  expect(screen.queryByText("created notice")).toBeNull();
  await act(async () => {
    delayed.resolve(context());
    await delayed.promise;
  });
  await screen.findByRole("heading", { name: "Flash heading" });
  expect(loads).toBe(2);
  router.dispose();
  const fresh = createMemoryRouter(routes, { initialEntries: ["/flash"] });
  await waitFor(() => {
    expect(fresh.state.initialized).toBe(true);
  });
  expect(loads).toBe(3);
  fresh.dispose();
});
it.each(["save", "test"] as const)(
  "keeps the form draft and disables operations during resolution after %s refusal, retaining refusal for viewers",
  async (operation) => {
    const c = client();
    const router = renderCreateForm(c);
    const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
    fireEvent.change(input, { target: { value: "local draft" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://api.acme.example/health" },
    });
    const delayed = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(delayed.promise);
    vi.mocked(createMonitor).mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "Denied", 403),
    );
    vi.mocked(testMonitorDraft).mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "Denied", 403),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: operation === "save" ? "บันทึกมอนิเตอร์" : "ทดสอบการตั้งค่า",
      }),
    );
    await waitFor(() => {
      expect(getContextPublicationSnapshot(c).admission.kind).toBe(
        "confirming",
      );
    });
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
    expect(input).toHaveValue("local draft");
    expect(screen.queryByText("Acme")).toBeNull();
    expect(
      screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }),
    ).toHaveAttribute("aria-disabled", "true");
    const viewer = context("viewer");
    await act(async () => {
      delayed.resolve(viewer);
      await delayed.promise;
    });
    await waitFor(() => {
      expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirmed");
    });
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
    expect(input).toHaveValue("local draft");
    expect(screen.getByRole("alert")).toBeVisible();
    router.dispose();
  },
);
it("keeps form interaction disabled after required resolver failure and offers bootstrap retry", async () => {
  const c = client();
  const router = renderCreateForm(c);
  const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
  fireEvent.change(input, { target: { value: "local draft" } });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://api.acme.example/health" },
  });
  const delayed = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(delayed.promise);
  vi.mocked(createMonitor).mockRejectedValue(
    new ApiError("PERMISSION_DENIED", "Denied", 403),
  );
  fireEvent.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  await act(async () => {
    delayed.reject(new Error("Resolver failed"));
    await delayed.promise.catch(() => undefined);
  });
  expect(getContextPublicationSnapshot(c).admission.kind).toBe("failed");
  expect(input).toHaveValue("local draft");
  expect(
    screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }),
  ).toHaveAttribute("aria-disabled", "true");
  await screen.findByText("ไม่สามารถยืนยันสิทธิ์ของคุณได้");
  expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeVisible();
  const retry = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(retry.promise);
  fireEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  await act(async () => {
    retry.resolve(context("viewer"));
    await retry.promise;
  });
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirmed");
  });
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  expect(input).toHaveValue("local draft");
  router.dispose();
});
it.each(["pause", "dialog"] as const)(
  "withdraws Detail cards and observers after %s refusal and preserves the message after viewer retry",
  async (action) => {
    const c = client();
    const router = createMemoryRouter(
      [
        {
          element: <Boundary />,
          children: [
            {
              path: "/organizations/:organizationId/monitors/:monitorId",
              element: <DetailPage />,
            },
          ],
        },
      ],
      { initialEntries: [`/organizations/${A}/monitors/${MONITOR_ID}`] },
    );
    render(
      <QueryClientProvider client={c}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Payments API" });
    if (action === "dialog") {
      fireEvent.click(screen.getByRole("button", { name: "ลบมอนิเตอร์" }));
      await screen.findByRole("dialog");
    }
    const delayed = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(delayed.promise);
    vi.mocked(pauseMonitor).mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "Denied", 403),
    );
    vi.mocked(deleteMonitor).mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "Denied", 403),
    );
    fireEvent.click(
      action === "pause"
        ? screen.getByRole("button", { name: "หยุดชั่วคราว" })
        : must(screen.getAllByRole("button", { name: "ลบมอนิเตอร์" }).at(-1)),
    );
    await waitFor(() => {
      expect(getContextPublicationSnapshot(c).admission.kind).toBe(
        "confirming",
      );
    });
    expect(screen.queryByRole("heading", { name: "Payments API" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "สิทธิ์ของคุณเปลี่ยนแล้ว",
    );
    expect(screen.queryByText("https://api.acme.example/health")).toBeNull();
    const calls = vi.mocked(fetchMonitorDetail).mock.calls.length;
    await act(async () => {
      await c.invalidateQueries({ queryKey: ["tenant"] });
    });
    expect(vi.mocked(fetchMonitorDetail).mock.calls.length).toBe(calls);
    await act(async () => {
      delayed.reject(new Error("Resolver failed"));
      await delayed.promise.catch(() => undefined);
    });
    await screen.findByText("ไม่สามารถยืนยันสิทธิ์ดูมอนิเตอร์ได้");
    expect(screen.queryByRole("heading", { name: "Payments API" })).toBeNull();
    const retry = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => {
      expect(getContextPublicationSnapshot(c).admission.kind).toBe(
        "confirming",
      );
    });
    expect(vi.mocked(fetchMonitorDetail).mock.calls.length).toBe(calls);
    await act(async () => {
      retry.resolve(context("viewer"));
      await retry.promise;
    });
    await screen.findByRole("heading", { name: "Payments API" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "สิทธิ์ของคุณเปลี่ยนแล้ว",
    );
    expect(screen.queryByRole("button", { name: "หยุดชั่วคราว" })).toBeNull();
    router.dispose();
  },
);
function Operations() {
  const { activeOrg, refreshMembershipContext, switchOrg, mePending, meError } =
    useTenant();
  return (
    <>
      <output data-testid="scope">{activeOrg?.id ?? "none"}</output>
      <output data-testid="pending">{String(mePending)}</output>
      <output data-testid="error">{meError?.message ?? "none"}</output>
      <button onClick={() => void refreshMembershipContext()}>refresh</button>
      <button onClick={() => void switchOrg(B)}>switch</button>
      <button onClick={() => void switchOrg(A)}>switch-a</button>
    </>
  );
}
it.each(["success", "failure"] as const)(
  "preserves required %s selection against late manual refresh and failed PATCH",
  async (outcome) => {
    const c = client();
    render(
      <QueryClientProvider client={c}>
        <TenantProvider>
          <Operations />
        </TenantProvider>
      </QueryClientProvider>,
    );
    await screen.findByText(A);
    vi.mocked(updateActiveOrganization).mockRejectedValueOnce(
      new Error("PATCH failed"),
    );
    fireEvent.click(screen.getByText("switch"));
    await waitFor(() => {
      expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("scope")).toHaveTextContent(A);
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    const manual = Promise.withResolvers<MeContextResponse>(),
      required = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext)
      .mockReturnValueOnce(manual.promise)
      .mockReturnValueOnce(required.promise);
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => {
      expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(2);
    });
    act(() => {
      void c.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
    });
    await waitFor(() => {
      expect(vi.mocked(fetchMeContext)).toHaveBeenCalledTimes(3);
    });
    const fresh = {
      ...context(),
      lastActiveTenantId: B,
    };
    await act(async () => {
      if (outcome === "success") required.resolve(fresh);
      else required.reject(new Error("required B failed"));
      await required.promise.catch(() => undefined);
    });
    await act(async () => {
      manual.resolve(context());
      await manual.promise;
    });
    expect(screen.getByTestId("scope")).toHaveTextContent(
      outcome === "success" ? fresh.lastActiveTenantId : "none",
    );
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent(
      outcome === "failure" ? "required B failed" : "none",
    );
  },
);
it("destroys the local form snapshot when required resolution confirms membership removal", async () => {
  const c = client();
  const router = renderCreateForm(c);
  const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
  fireEvent.change(input, { target: { value: "local draft" } });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://api.acme.example/health" },
  });
  const pending = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  vi.mocked(createMonitor).mockRejectedValue(
    new ApiError("MEMBERSHIP_DENIED", "Denied", 403),
  );
  fireEvent.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  await act(async () => {
    pending.resolve({
      ...context(),
      organizations: [],
      lastActiveTenantId: null,
    });
    await pending.promise;
  });
  await screen.findByText("คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้");
  expect(input.isConnected).toBe(false);
  expect(screen.queryByDisplayValue("local draft")).toBeNull();
  router.dispose();
});
it("supersedes both queued PATCH intents during required refresh and prevents old intents from reopening admission", async () => {
  const c = client();
  render(
    <QueryClientProvider client={c}>
      <TenantProvider>
        <Operations />
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(A);
  const patch1 = Promise.withResolvers<MeContextResponse>(),
    patch2 = Promise.withResolvers<MeContextResponse>(),
    required = Promise.withResolvers<MeContextResponse>();
  vi.mocked(updateActiveOrganization)
    .mockReturnValueOnce(patch1.promise)
    .mockReturnValueOnce(patch2.promise);
  fireEvent.click(screen.getByText("switch"));
  await waitFor(() => {
    expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
  });
  fireEvent.click(screen.getByText("switch"));
  vi.mocked(fetchMeContext).mockReturnValueOnce(required.promise);
  fireEvent.click(screen.getByText("refresh"));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  await act(async () => {
    patch1.resolve({
      ...context(),
      lastActiveTenantId: B,
    });
    await patch1.promise;
  });
  await act(async () => {
    patch2.resolve({
      ...context(),
      lastActiveTenantId: B,
    });
    await patch2.promise;
  });
  expect(screen.getByTestId("scope")).toHaveTextContent("none");
  expect(screen.getByTestId("pending")).toHaveTextContent("true");
  await act(async () => {
    required.resolve(context("viewer"));
    await required.promise;
  });
  await waitFor(() => expect(screen.getByTestId("scope")).toHaveTextContent(A));
  expect(screen.getByTestId("pending")).toHaveTextContent("false");
});
it.each(["success", "failure"] as const)(
  "retires running and queued PATCH during same-organization required %s and permits only new intents after success",
  async (outcome) => {
    const c = client();
    render(
      <QueryClientProvider client={c}>
        <TenantProvider>
          <Operations />
        </TenantProvider>
      </QueryClientProvider>,
    );
    await screen.findByText(A);
    const patch = Promise.withResolvers<MeContextResponse>(),
      required = Promise.withResolvers<MeContextResponse>();
    vi.mocked(updateActiveOrganization).mockReturnValueOnce(patch.promise);
    fireEvent.click(screen.getByText("switch"));
    await waitFor(() => {
      expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText("switch"));
    vi.mocked(fetchMeContext).mockReturnValueOnce(required.promise);
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => {
      expect(getContextPublicationSnapshot(c).admission.kind).toBe(
        "confirming",
      );
    });
    await act(async () => {
      if (outcome === "success") required.resolve(context());
      else required.reject(new Error("required failed"));
      await required.promise.catch(() => undefined);
    });
    await act(async () => {
      patch.resolve({
        ...context(),
        lastActiveTenantId: B,
      });
      await patch.promise;
    });
    expect(screen.getByTestId("scope")).toHaveTextContent(
      outcome === "success" ? A : "none",
    );
    expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
    if (outcome === "success") {
      vi.mocked(updateActiveOrganization).mockResolvedValueOnce({
        ...context(),
        lastActiveTenantId: B,
      });
      fireEvent.click(screen.getByText("switch"));
      await waitFor(() =>
        expect(screen.getByTestId("scope")).toHaveTextContent(B),
      );
    }
  },
);
it("retains the successful selection when the next queued PATCH fails in the same generation", async () => {
  const c = client();
  render(
    <QueryClientProvider client={c}>
      <TenantProvider>
        <Operations />
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(A);
  const first = Promise.withResolvers<MeContextResponse>();
  vi.mocked(updateActiveOrganization)
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error("second PATCH failed"));
  fireEvent.click(screen.getByText("switch"));
  await waitFor(() => {
    expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
  });
  fireEvent.click(screen.getByText("switch"));
  await act(async () => {
    first.resolve({
      ...context(),
      lastActiveTenantId: B,
    });
    await first.promise;
  });
  await waitFor(() => {
    expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(2);
  });
  expect(screen.getByTestId("scope")).toHaveTextContent(B);
  expect(screen.getByTestId("pending")).toHaveTextContent("false");
});
it.each(["user-b", null] as const)(
  "retires publication on session change to %s before late refresh, PATCH and queued completions",
  async (nextIdentity) => {
    sessionState.data = { user: { id: "user-1" } };
    const old = resolveQueryClientForIdentity("user-1");
    const tree = render(
      <SessionQueryProvider>
        <TenantProvider>
          <Operations />
        </TenantProvider>
      </SessionQueryProvider>,
    );
    await screen.findByText(A);
    const patch = Promise.withResolvers<MeContextResponse>(),
      manual = Promise.withResolvers<MeContextResponse>();
    vi.mocked(updateActiveOrganization).mockReturnValueOnce(patch.promise);
    fireEvent.click(screen.getByText("switch"));
    await waitFor(() => {
      expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText("switch"));
    vi.mocked(fetchMeContext).mockReturnValueOnce(manual.promise);
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => {
      expect(getContextPublicationSnapshot(old).admission.kind).toBe(
        "confirming",
      );
    });
    sessionState.data =
      nextIdentity === null ? null : { user: { id: nextIdentity } };
    vi.mocked(fetchMeContext).mockResolvedValue({
      ...context(),
      user: { ...context().user, id: nextIdentity ?? "anonymous-response" },
      lastActiveTenantId: B,
    });
    tree.rerender(
      <SessionQueryProvider>
        <TenantProvider>
          <Operations />
        </TenantProvider>
      </SessionQueryProvider>,
    );
    await waitFor(() => {
      expect(getContextPublicationSnapshot(old).admission.kind).toBe("retired");
    });
    await act(async () => {
      manual.resolve(context());
      patch.resolve(context());
      await Promise.all([manual.promise, patch.promise]);
    });
    await waitFor(() => {
      expect(old.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
    });
    expect(screen.getByTestId("scope")).toHaveTextContent(
      nextIdentity === null ? "none" : B,
    );
    expect(vi.mocked(updateActiveOrganization)).toHaveBeenCalledTimes(1);
  },
);
it("retires the adopted staged client when its identity differs from first resolution without an active registry entry", async () => {
  const old = resolveQueryClientForIdentity("user-1");
  sessionState.data = { user: { id: "user-b" } };
  vi.mocked(fetchMeContext).mockResolvedValue({
    ...context(),
    user: { ...context().user, id: "user-b" },
    lastActiveTenantId: B,
  });
  render(
    <SessionQueryProvider>
      <TenantProvider>
        <Operations />
      </TenantProvider>
    </SessionQueryProvider>,
  );
  await waitFor(() => {
    expect(getContextPublicationSnapshot(old).admission.kind).toBe("retired");
  });
  await screen.findByText(B);
  expect(old.getQueryData(ME_CONTEXT_QUERY_KEY)).toBeUndefined();
});
it("rejects flash consumption during explicit revalidation and consumes once without clearing a newer notice", async () => {
  const c = client();
  let loads = 0;
  const loader = async () => {
    loads++;
    await c.query({
      ...(await import("./bootstrap")).contextQueryOptions(c),
      staleTime: 0,
    });
    return null;
  };
  const router = createMemoryRouter(
    [
      { path: "/flash", loader, element: <p>ready</p> },
      { path: "/newer", loader, element: <p>newer</p> },
    ],
    {
      initialEntries: [
        { pathname: "/flash", state: { notice: "created" as const } },
      ],
    },
  );
  await waitFor(() => {
    expect(router.state.initialized).toBe(true);
  });
  const expected = {
    key: router.state.location.key,
    notice: "created" as const,
  };
  const delayed = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(delayed.promise);
  const revalidation = router.revalidate();
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  expect(await consume(router, c, expected, null)).toBe(false);
  expect(router.state.location.state).toEqual({ notice: "created" as const });
  delayed.resolve(context());
  await revalidation;
  expect(await consume(router, c, expected, null)).toBe(true);
  expect(router.state.location.state).toBeNull();
  expect(await consume(router, c, expected, null)).toBe(false);
  expect(loads).toBe(2);
  await router.navigate("/newer", { state: { notice: "deleted" } });
  expect(await consume(router, c, expected, null)).toBe(false);
  expect(router.state.location.state).toEqual({ notice: "deleted" });
  expect(loads).toBe(3);
  router.dispose();
});
it("keeps INBOX_SCOPE_CHANGED resolution ahead of flash consumption and consumes once after failure and retry", async () => {
  const c = client();
  const router = createMemoryRouter(
    [{ path: "/flash", element: <Operations /> }],
    {
      initialEntries: [
        { pathname: "/flash", state: { notice: "created" as const } },
      ],
    },
  );
  render(
    <QueryClientProvider client={c}>
      <TenantProvider>
        <RouterProvider router={router} />
      </TenantProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(A);
  const expected = {
      key: router.state.location.key,
      notice: "created" as const,
    },
    delayed = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(delayed.promise);
  act(() => {
    void c
      .query({
        queryKey: ["tenant", "notifications", A, "inbox"],
        retry: false,
        queryFn: () =>
          Promise.reject(new ApiError("INBOX_SCOPE_CHANGED", "Changed", 409)),
      })
      .catch(() => undefined);
  });
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  expect(await consume(router, c, expected, null)).toBe(false);
  expect(screen.getByTestId("scope")).toHaveTextContent("none");
  await act(async () => {
    delayed.reject(new Error("required failed"));
    await delayed.promise.catch(() => undefined);
  });
  expect(await consume(router, c, expected, null)).toBe(false);
  expect(router.state.location.state).toEqual({ notice: "created" as const });
  expect(screen.getByTestId("scope")).toHaveTextContent("none");
  vi.mocked(fetchMeContext).mockResolvedValueOnce(context());
  fireEvent.click(screen.getByText("refresh"));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirmed");
  });
  await act(async () => {
    expect(await consume(router, c, expected, null)).toBe(true);
  });
  expect(router.state.location.state).toBeNull();
  expect(await consume(router, c, expected, null)).toBe(false);
  router.dispose();
});
it("scope replacement destroys local form snapshot before old values can reopen", async () => {
  const c = client();
  const router = createMemoryRouter(
    [
      {
        element: <Boundary />,
        children: [
          {
            path: "/organizations/:organizationId/monitors/new",
            element: <MonitorFormPage mode="create" />,
          },
          {
            path: "/organizations/:organizationId/monitors",
            element: <p>new scope overview</p>,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/new`] },
  );
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
  fireEvent.change(input, { target: { value: "local draft" } });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://api.acme.example/health" },
  });
  const pending = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  vi.mocked(createMonitor).mockRejectedValue(
    new ApiError("PERMISSION_DENIED", "Denied", 403),
  );
  fireEvent.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  await act(async () => {
    pending.resolve({
      ...context(),
      lastActiveTenantId: B,
    });
    await pending.promise;
  });
  await screen.findByText("new scope overview");
  expect(input.isConnected).toBe(false);
  expect(screen.queryByDisplayValue("local draft")).toBeNull();
  router.dispose();
});
it("destroys form input and local draft when SessionQueryProvider replaces identity", async () => {
  sessionState.data = { user: { id: "user-1" } };
  const router = createMemoryRouter(
    [
      {
        element: <Boundary />,
        children: [
          {
            path: "/organizations/:organizationId/monitors/new",
            element: <MonitorFormPage mode="create" />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/new`] },
  );
  const tree = render(
    <SessionQueryProvider>
      <RouterProvider router={router} />
    </SessionQueryProvider>,
  );
  const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
  fireEvent.change(input, { target: { value: "local draft identityA" } });
  sessionState.data = { user: { id: "user-b" } };
  vi.mocked(fetchMeContext).mockResolvedValue({
    ...context(),
    user: { ...context().user, id: "user-b" },
    organizations: [],
    lastActiveTenantId: null,
  });
  tree.rerender(
    <SessionQueryProvider>
      <RouterProvider router={router} />
    </SessionQueryProvider>,
  );
  await screen.findByText("คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้");
  expect(input.isConnected).toBe(false);
  expect(screen.queryByDisplayValue("local draft identityA")).toBeNull();
  router.dispose();
});
it("flash consumed state stays one-time on back and a fresh document router", async () => {
  const c = client();
  const loader = async () => {
    await c.query({
      ...(await import("./bootstrap")).contextQueryOptions(c),
      staleTime: 0,
    });
    return null;
  };
  const routes = [
    {
      element: <Boundary />,
      children: [
        { path: "/flash", loader, element: <Flash /> },
        { path: "/other", loader, element: <p>Other</p> },
      ],
    },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [
      { pathname: "/flash", state: { notice: "created" as const } },
    ],
  });
  const tree = render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText("created notice");
  await waitFor(() => {
    expect(router.state.location.state).toBeNull();
  });
  await act(async () => {
    await router.navigate("/other");
  });
  await screen.findByText("Other");
  await act(async () => {
    await router.navigate(-1);
  });
  await screen.findByRole("heading", { name: "Flash heading" });
  expect(screen.queryByText("created notice")).toBeNull();
  const consumed = router.state.location;
  tree.unmount();
  router.dispose();
  const fresh = createMemoryRouter(routes, { initialEntries: [consumed] });
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={fresh} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Flash heading" });
  expect(screen.queryByText("created notice")).toBeNull();
  fresh.dispose();
});
it("consumes concurrent duplicate flash commands once before the router commits null state", async () => {
  const c = client();
  const loader = async () => {
    await c.query({
      ...(await import("./bootstrap")).contextQueryOptions(c),
      staleTime: 0,
    });
    return null;
  };
  const router = createMemoryRouter(
    [{ path: "/flash", loader, element: <p>ready</p> }],
    {
      initialEntries: [
        { pathname: "/flash", state: { notice: "created" as const } },
      ],
    },
  );
  await waitFor(() => {
    expect(router.state.initialized).toBe(true);
  });
  const expected = {
    key: router.state.location.key,
    notice: "created" as const,
  };
  let commits = 0;
  router.subscribe((state) => {
    if (state.location.state === null && state.navigation.state === "idle")
      commits++;
  });
  await Promise.all([
    consume(router, c, expected, null),
    consume(router, c, expected, null),
  ]);
  expect(commits).toBe(1);
  router.dispose();
});
it("keeps only the edit draft and generic heading during resolution delay and failure, restoring metadata after viewer retry", async () => {
  const c = client();
  const router = createMemoryRouter(
    [
      {
        element: <Boundary />,
        children: [
          {
            path: "/organizations/:organizationId/monitors/:monitorId/edit",
            element: <MonitorFormPage mode="edit" />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/${MONITOR_ID}/edit`] },
  );
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "แก้ไข Payments API" });
  const input = screen.getByLabelText("ชื่อมอนิเตอร์");
  fireEvent.change(input, { target: { value: "edited local draft" } });
  const pending = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  vi.mocked(updateMonitor).mockRejectedValue(
    new ApiError("PERMISSION_DENIED", "Denied", 403),
  );
  fireEvent.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  expect(screen.getByRole("heading", { name: "แก้ไขมอนิเตอร์" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "แก้ไข Payments API" }),
  ).toBeNull();
  expect(screen.queryByText("Acme")).toBeNull();
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  expect(input).toHaveValue("edited local draft");
  await act(async () => {
    pending.reject(new Error("Current resolver failed"));
    await pending.promise.catch(() => undefined);
  });
  await screen.findByText("ไม่สามารถยืนยันสิทธิ์ของคุณได้");
  expect(screen.queryByText("Acme")).toBeNull();
  expect(screen.getByRole("heading", { name: "แก้ไขมอนิเตอร์" })).toBeVisible();
  vi.mocked(fetchMeContext).mockResolvedValueOnce(context("viewer"));
  fireEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
  await screen.findByRole("heading", { name: "แก้ไข Payments API" });
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  expect(input).toHaveValue("edited local draft");
  expect(
    screen.getByRole("button", { name: "บันทึกการแก้ไข" }),
  ).toHaveAttribute("aria-disabled", "true");
  router.dispose();
});

it.each(["create", "edit"] as const)(
  "cold %s bootstrap retry preserves current cause/error without snapshot and opens form only after confirmed success",
  async (mode) => {
    const c = client();
    vi.mocked(fetchMeContext).mockRejectedValueOnce(
      new Error("Initial bootstrap refused"),
    );
    const path =
      mode === "create"
        ? `/organizations/${A}/monitors/new`
        : `/organizations/${A}/monitors/${MONITOR_ID}/edit`;
    const router = createMemoryRouter(
      [
        {
          element: <Boundary />,
          children: [
            {
              path: "/organizations/:organizationId/monitors/new",
              element: <MonitorFormPage mode="create" />,
            },
            {
              path: "/organizations/:organizationId/monitors/:monitorId/edit",
              element: <MonitorFormPage mode="edit" />,
            },
          ],
        },
      ],
      { initialEntries: [path] },
    );
    render(
      <QueryClientProvider client={c}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByText("โหลดข้อมูลองค์กรไม่สำเร็จ กรุณาลองใหม่");
    const pending = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    await waitFor(() => {
      expect(getContextPublicationSnapshot(c).admission.kind).toBe(
        "confirming",
      );
    });
    expect(screen.queryByLabelText("ชื่อมอนิเตอร์")).toBeNull();
    expect(fetchMonitorDetail).not.toHaveBeenCalled();
    expect(fetchOrganizationNotificationSettings).not.toHaveBeenCalled();
    await act(async () => {
      pending.reject(new Error("Retry still refused"));
      await pending.promise.catch(() => undefined);
    });
    await screen.findByText("โหลดข้อมูลองค์กรไม่สำเร็จ กรุณาลองใหม่");
    expect(screen.queryByText("กำลังโหลดองค์กร")).toBeNull();
    expect(fetchMonitorDetail).not.toHaveBeenCalled();
    expect(fetchOrganizationNotificationSettings).not.toHaveBeenCalled();
    vi.mocked(fetchMeContext).mockResolvedValueOnce(context());
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    await screen.findByLabelText("ชื่อมอนิเตอร์");
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirmed");
    router.dispose();
    await c.cancelQueries();
    c.clear();
  },
);
it("blocks conflict reload, settings invalidation and focus during resolver delay or failure until role-authorized confirmation", async () => {
  const c = client();
  const router = createMemoryRouter(
    [
      {
        element: (
          <TenantProvider>
            <MembershipRefreshProbe />
            <AppShell />
          </TenantProvider>
        ),
        children: [
          {
            path: "/organizations/:organizationId/monitors/:monitorId/edit",
            element: <MonitorFormPage mode="edit" />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/${MONITOR_ID}/edit`] },
  );
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
  fireEvent.change(input, { target: { value: "conflict draft" } });
  vi.mocked(updateMonitor).mockRejectedValueOnce(
    new ApiError("MONITOR_VERSION_CONFLICT", "Conflict", 409),
  );
  fireEvent.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  await screen.findByRole("button", { name: "โหลดค่าล่าสุด" });
  await screen.findByText(ORG_ALERTS_OFF_MESSAGE);
  vi.mocked(fetchOrganizationNotificationSettings).mockClear();
  vi.mocked(fetchMonitorDetail).mockClear();
  const pending = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "refresh membership" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  await waitFor(() => {
    expect(fetchMeContext).toHaveBeenCalledTimes(2);
  });
  expect(screen.queryByText(ORG_ALERTS_OFF_MESSAGE)).toBeNull();
  await act(async () => {
    await c.invalidateQueries({
      queryKey: organizationNotificationSettingsQueryKey(A),
    });
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  expect(fetchOrganizationNotificationSettings).not.toHaveBeenCalled();
  expect(fetchMeContext).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "โหลดค่าล่าสุด" }));
  expect(fetchMonitorDetail).not.toHaveBeenCalled();
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  expect(input).toHaveValue("conflict draft");
  await act(async () => {
    pending.reject(new Error("Membership unresolved"));
    await pending.promise.catch(() => undefined);
  });
  await screen.findByText("ไม่สามารถยืนยันสิทธิ์ของคุณได้");
  await act(async () => {
    await c.invalidateQueries({
      queryKey: organizationNotificationSettingsQueryKey(A),
    });
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  expect(fetchMeContext).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(ORG_ALERTS_OFF_MESSAGE)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "โหลดค่าล่าสุด" }));
  expect(fetchOrganizationNotificationSettings).not.toHaveBeenCalled();
  expect(fetchMonitorDetail).not.toHaveBeenCalled();
  vi.mocked(fetchMeContext).mockResolvedValueOnce(context());
  fireEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirmed");
  });
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  await waitFor(() => {
    expect(fetchMonitorDetail).toHaveBeenCalledTimes(1);
  });
  vi.mocked(fetchMonitorDetail).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "โหลดค่าล่าสุด" }));
  await waitFor(() => {
    expect(fetchMonitorDetail).toHaveBeenCalledTimes(1);
  });
  router.dispose();
  await c.cancelQueries();
  c.clear();
});

it("confirmed focus and reconnect resolve afresh; pending admission cannot be displaced by another automatic event", async () => {
  const c = client();
  const router = createMemoryRouter(
    [
      {
        element: <Boundary />,
        children: [
          { path: "/ready", element: <p>Current admitted content</p> },
        ],
      },
    ],
    { initialEntries: ["/ready"] },
  );
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText("Current admitted content");
  const fresh = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(fresh.promise);
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
  });
  await waitFor(() => {
    expect(fetchMeContext).toHaveBeenCalledTimes(2);
  });
  expect(screen.queryByText("Current admitted content")).toBeNull();
  const claim = getContextPublicationSnapshot(c).claim;
  act(() => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  expect(getContextPublicationSnapshot(c).claim).toBe(claim);
  expect(fetchMeContext).toHaveBeenCalledTimes(2);
  await act(async () => {
    fresh.resolve(context());
    await fresh.promise;
  });
  await screen.findByText("Current admitted content");
  const reconnect = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(reconnect.promise);
  act(() => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await waitFor(() => {
    expect(fetchMeContext).toHaveBeenCalledTimes(3);
  });
  expect(screen.queryByText("Current admitted content")).toBeNull();
  await act(async () => {
    reconnect.resolve(context());
    await reconnect.promise;
  });
  await screen.findByText("Current admitted content");
  router.dispose();
  await c.cancelQueries();
  c.clear();
});
it("viewer confirmation preserves disabled edit draft/refusal and never restores administrator settings metadata or requests", async () => {
  const c = client();
  const router = createMemoryRouter(
    [
      {
        element: (
          <TenantProvider>
            <MembershipRefreshProbe />
            <AppShell />
          </TenantProvider>
        ),
        children: [
          {
            path: "/organizations/:organizationId/monitors/:monitorId/edit",
            element: <MonitorFormPage mode="edit" />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/${MONITOR_ID}/edit`] },
  );
  render(
    <QueryClientProvider client={c}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("ชื่อมอนิเตอร์");
  await screen.findByText(ORG_ALERTS_OFF_MESSAGE);
  fireEvent.change(input, { target: { value: "viewer keeps local draft" } });
  const pending = Promise.withResolvers<MeContextResponse>();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  vi.mocked(fetchOrganizationNotificationSettings).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "refresh membership" }));
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirming");
  });
  expect(screen.queryByText(ORG_ALERTS_OFF_MESSAGE)).toBeNull();
  expect(fetchOrganizationNotificationSettings).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(context("viewer"));
    await pending.promise;
  });
  await waitFor(() => {
    expect(getContextPublicationSnapshot(c).admission.kind).toBe("confirmed");
  });
  await act(async () => {
    await c.invalidateQueries({
      queryKey: organizationNotificationSettingsQueryKey(A),
    });
  });
  expect(fetchOrganizationNotificationSettings).not.toHaveBeenCalled();
  expect(screen.queryByText(ORG_ALERTS_OFF_MESSAGE)).toBeNull();
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toBe(input);
  expect(input).toHaveValue("viewer keeps local draft");
  expect(
    screen.getByRole("button", { name: "บันทึกการแก้ไข" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "สิทธิ์ของคุณเปลี่ยนแล้ว",
  );
  router.dispose();
  await c.cancelQueries();
  c.clear();
});
