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
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AppShell } from "../../components/shell/AppShell";
import { fetchMeContext } from "../../lib/api/me";
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
} from "../../lib/queryClient";
import { TenantProvider } from "../../lib/tenant/TenantProvider";
import { guardUnassignedNetwork } from "../../test/guard-network";
import { A, context, detail, MONITOR_ID } from "./detail-test-support";
import { MonitorFormPage } from "./MonitorFormPage";

vi.mock("../../lib/auth-client", () => ({
  authClient: {
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
}));
vi.mock("../../lib/api/monitors", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorList: vi.fn(),
  updateMonitor: vi.fn(),
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
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
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
  focusManager.setFocused(undefined);
  for (const { client, router } of resources.splice(0)) {
    router.dispose();
    await client.cancelQueries();
    client.clear();
  }
});
async function openForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  bindQueryClientIdentity(client, "user-1");
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
            path: "/organizations/:organizationId/monitors/:monitorId/edit",
            element: <MonitorFormPage mode="edit" />,
          },
        ],
      },
    ],
    { initialEntries: [`/organizations/${A}/monitors/${MONITOR_ID}/edit`] },
  );
  resources.push({ client, router });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const name = await screen.findByLabelText("ชื่อมอนิเตอร์");
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
  expect(screen.queryByLabelText("ชื่อมอนิเตอร์")).toBeNull();
  expect(screen.queryByLabelText("URL")).toBeNull();
  expect(screen.queryByDisplayValue("private edited name")).toBeNull();
  expect(screen.queryByText("https://api.acme.example/health")).toBeNull();
}
const headerToggle = () =>
  screen.getByRole("button", { name: /^(ย่อ|ขยาย)เมนู$/ });
const searchButton = () => screen.getByRole("button", { name: "ค้นหาทั้งหมด" });
async function focusShell(
  owner: "header" | "palette",
  user: ReturnType<typeof userEvent.setup>,
) {
  if (owner === "header") {
    const button = headerToggle();
    button.focus();
    return button;
  }
  await user.click(searchButton());
  return screen.findByRole("combobox", { name: "ค้นหาทั้งหมด" });
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
    await screen.findByRole("button", { name: "ลองอีกครั้ง" });
    withdrawn();
    expect(shellFocus).toHaveFocus();
    if (owner === "palette") {
      await user.tab();
      expect(shellFocus).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "ค้นหาทั้งหมด" })).toBeNull();
      expect(searchButton()).toHaveFocus();
    }
    const retry = Promise.withResolvers<MeContextResponse>();
    vi.mocked(fetchMeContext).mockReturnValueOnce(retry.promise);
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    shellFocus = await focusShell(owner, user);
    withdrawn();
    expect(shellFocus).toHaveFocus();
    await act(async () => {
      retry.resolve(context());
      await retry.promise;
    });
    expect(await screen.findByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
      "private edited name",
    );
    expect(shellFocus).toHaveFocus();
    if (owner === "palette") {
      await user.tab();
      expect(shellFocus).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(searchButton()).toHaveFocus();
      expect(screen.queryByRole("dialog", { name: "ค้นหาทั้งหมด" })).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await waitFor(() => {
      expect(getContextPublicationSnapshot(client).admission.kind).toBe(
        "confirming",
      );
    });
    const heading = screen.getByRole("heading", { name: "แก้ไขมอนิเตอร์" });
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
    expect(await screen.findByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
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
  expect(screen.getByRole("heading", { name: "แก้ไขมอนิเตอร์" })).toHaveFocus();
  headerToggle().focus();
  headerToggle().blur();
  expect(document.body).toHaveFocus();
  await act(async () => {
    pending.resolve(context());
    await pending.promise;
  });
  await screen.findByLabelText("ชื่อมอนิเตอร์");
  expect(document.body).toHaveFocus();
});
it("CR88-02 native local field focus recovers after withdrawn failure and keyboard retry", async () => {
  const user = userEvent.setup(),
    client = await openForm(),
    pending = Promise.withResolvers<MeContextResponse>();
  screen.getByLabelText("URL").focus();
  vi.mocked(fetchMeContext).mockReturnValueOnce(pending.promise);
  refreshOnFocus();
  await waitFor(() => {
    expect(getContextPublicationSnapshot(client).admission.kind).toBe(
      "confirming",
    );
  });
  expect(screen.getByRole("heading", { name: "แก้ไขมอนิเตอร์" })).toHaveFocus();
  withdrawn();
  await act(async () => {
    pending.reject(new Error("confirmation unavailable"));
    await pending.promise.catch(() => undefined);
  });
  const retry = await screen.findByRole("button", { name: "ลองอีกครั้ง" });
  retry.focus();
  vi.mocked(fetchMeContext).mockResolvedValueOnce(context());
  await user.keyboard("{Enter}");
  expect(await screen.findByLabelText("URL")).toHaveFocus();
  expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
    "private edited name",
  );
});
