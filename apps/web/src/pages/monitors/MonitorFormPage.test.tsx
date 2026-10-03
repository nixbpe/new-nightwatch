import type { MonitorRecord } from "@nightwatch/api-contract";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchMeContext, updateActiveOrganization } from "../../lib/api/me";
import { fetchOrganizationNotificationSettings } from "../../lib/api/notifications";
import {
  createMonitor,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  updateMonitor,
} from "../../lib/api/monitors";
import {
  A,
  B,
  context,
  deferred,
  detail,
  editPath,
  MONITOR_ID,
  newPath,
  record,
  renderForm,
} from "./form-test-support";
import { noChecks, noIncidents, noResponseTimes } from "./detail-test-support";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationNotificationSettings: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const createMock = vi.mocked(createMonitor);
const updateMock = vi.mocked(updateMonitor);
const fetchDetailMock = vi.mocked(fetchMonitorDetail);
const fetchListMock = vi.mocked(fetchMonitorList);

beforeEach(() => {
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  });
  fetchMeContextMock.mockResolvedValue(context());
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  fetchListMock.mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

const written = (overrides: Partial<MonitorRecord> = {}) => ({
  monitor: record(overrides),
});

async function fillBasic(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
  await user.type(
    screen.getByLabelText("URL"),
    "https://api.acme.example/health",
  );
}

async function openCreate() {
  const user = userEvent.setup();
  renderForm(newPath());
  await screen.findByRole("heading", { level: 1, name: "เพิ่มมอนิเตอร์" });
  await screen.findByLabelText("ชื่อมอนิเตอร์");
  return user;
}

describe("Create form defaults", () => {
  it("starts in basic mode with 5 minutes, 200-299 and a 10 second timeout", async () => {
    await openCreate();
    expect(screen.getByRole("radio", { name: "พื้นฐาน" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "5 นาที" })).toBeChecked();
    expect(screen.getByText(/ถือว่าปกติเมื่อได้รหัส 200-299/)).toBeVisible();
    expect(screen.getByText("หมดเวลารอ 10 วินาที")).toBeVisible();
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue("");
  });

  it("moves the interval with the arrow keys", async () => {
    const user = await openCreate();
    screen.getByRole("radio", { name: "5 นาที" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "15 นาที" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "15 นาที" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "1 นาที" })).toBeChecked();
  });
});

describe("Create validation and save", () => {
  it("puts errors beside name and url, focuses the first and sends nothing", async () => {
    const user = await openCreate();
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    const name = screen.getByLabelText("ชื่อมอนิเตอร์");
    const url = screen.getByLabelText("URL");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("กรอกชื่อมอนิเตอร์");
    expect(url).toHaveAccessibleDescription(
      expect.stringContaining("กรอก URL"),
    );
    expect(name).toHaveFocus();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("saves with a client request id and opens Detail waiting for the first check", async () => {
    createMock.mockResolvedValue(written());
    fetchDetailMock.mockResolvedValue({
      monitor: detail({
        health: "unknown",
        healthReason: "never_checked",
        lastCheckAt: null,
        lastResult: null,
        version: 1,
      }),
    });
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    expect(
      (await screen.findAllByText("รอตรวจครั้งแรก")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("สร้างมอนิเตอร์แล้ว")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors/${MONITOR_ID}`,
    );
    const [organizationId, body] = createMock.mock.calls[0] ?? [];
    expect(organizationId).toBe(A);
    expect(body).toMatchObject({
      name: "Payments API",
      url: "https://api.acme.example/health",
      intervalSeconds: 300,
      timeoutSeconds: 10,
      method: "GET",
      expectedStatus: "200-299",
      secrets: [],
    });
    expect(body?.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends one request when Save is pressed twice while pending", async () => {
    const pending = deferred<ReturnType<typeof written>>();
    createMock.mockReturnValue(pending.promise);
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = await openCreate();
    await fillBasic(user);
    const save = screen.getByRole("button", { name: "บันทึกมอนิเตอร์" });
    await user.click(save);
    await user.click(screen.getByRole("button", { name: "กำลังบันทึก…" }));
    await user.keyboard("{Enter}");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "กำลังบันทึก…" })).toHaveFocus();
    pending.resolve(written());
    await screen.findByTestId("location");
  });

  it("shows a blocked address beside the URL, without an address, and keeps the values", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_TARGET_BLOCKED", "10.0.0.5 is private", 422, {
        field: "url",
      }),
    );
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    const url = await screen.findByLabelText("URL");
    await waitFor(() => {
      expect(url).toHaveAccessibleDescription(/ที่อยู่นี้ไม่อนุญาตให้ตรวจสอบ/);
    });
    expect(url).toHaveFocus();
    expect(url).toHaveValue("https://api.acme.example/health");
    expect(document.body.textContent).not.toMatch(/10\.0\.0\.5/);
  });

  it("maps a server field and reason beside the field and clears it when edited", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "name", reason: "too_long" }],
      }),
    );
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    const name = await screen.findByLabelText("ชื่อมอนิเตอร์");
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(/ชื่อยาวได้ไม่เกิน 100/);
    });
    expect(name).toHaveFocus();
    await user.type(name, "x");
    expect(name).not.toHaveAttribute("aria-invalid");
  });

  it("shows the limit message when the Organization is full", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_LIMIT_REACHED", "limit", 409),
    );
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    expect(
      await screen.findByText(/มีมอนิเตอร์ครบตามจำนวนสูงสุด/),
    ).toBeVisible();
    expect(screen.getByLabelText("URL")).toHaveValue(
      "https://api.acme.example/health",
    );
  });
});

describe("StrictMode", () => {
  it("still opens Detail after a save, as the dev build runs the effects twice", async () => {
    createMock.mockResolvedValue(written());
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    const user = userEvent.setup();
    renderForm(newPath(), undefined, true);
    await screen.findByLabelText("ชื่อมอนิเตอร์");
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/monitors/${MONITOR_ID}`,
      );
    });
  });
});

describe("Access", () => {
  it.each(["viewer", "auditor"] as const)(
    "shows denied to a %s who opens the form directly",
    async (role) => {
      fetchMeContextMock.mockResolvedValue(context(role));
      renderForm(newPath());
      expect(
        await screen.findByText(
          "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("ชื่อมอนิเตอร์")).toBeNull();
    },
  );

  it("shows denied to a non-member without the Organization's name", async () => {
    renderForm(newPath("33333333-3333-4333-8333-333333333333"));
    expect(
      await screen.findByText(
        "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อมอนิเตอร์")).toBeNull();
  });
});

describe("Organization switch", () => {
  const overviewOfB = `/organizations/${B}/monitors`;

  async function switchToB(user: ReturnType<typeof userEvent.setup>) {
    updateActiveOrganizationMock.mockResolvedValue({
      ...context(),
      lastActiveTenantId: B,
    });
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Beta/ }));
  }

  it("sends /monitors/new to the new Organization's Overview without the typed values", async () => {
    const user = await openCreate();
    await fillBasic(user);
    await switchToB(user);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(overviewOfB);
    });
    expect(screen.queryByDisplayValue("Payments API")).toBeNull();
  });

  it("sends an Edit page to the new Organization's Overview", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await switchToB(user);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(overviewOfB);
    });
    expect(screen.queryByDisplayValue("Payments API")).toBeNull();
  });

  it("does not navigate back to the old Organization when a save lands after the switch", async () => {
    const pending = deferred<ReturnType<typeof written>>();
    createMock.mockReturnValue(pending.promise);
    const user = await openCreate();
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "บันทึกมอนิเตอร์" }));
    await switchToB(user);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(overviewOfB);
    });
    pending.resolve(written());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("location")).toHaveTextContent(overviewOfB);
  });
});

describe("Edit", () => {
  it("opens with the saved values and saves against the version it loaded", async () => {
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ name: "Payments API", version: 3 }),
    });
    updateMock.mockResolvedValue(written({ version: 4 }));
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    expect(screen.getByLabelText("URL")).toHaveValue(
      "https://api.acme.example/health",
    );
    expect(screen.getByRole("radio", { name: "5 นาที" })).toBeChecked();
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ name: "Payments API 2", version: 4 }),
    });
    await user.type(name, " 2");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(await screen.findByText("บันทึกการแก้ไขแล้ว")).toBeInTheDocument();
    // Detail's first paint already holds the saved monitor, never the pre-edit one.
    expect(
      screen.getByRole("heading", { level: 1, name: "Payments API 2" }),
    ).toBeInTheDocument();
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      name: "Payments API 2",
      expectedVersion: 3,
      secrets: [],
    });
  });

  it("shows the conflict message and keeps the typed values on a version conflict", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_VERSION_CONFLICT", "conflict", 409, {
        currentVersion: 5,
      }),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    await user.type(name, " mine");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(
      await screen.findByText(
        "มอนิเตอร์นี้ถูกแก้โดยผู้อื่น โหลดใหม่เพื่อดูค่าล่าสุด",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
      "Payments API mine",
    );
  });

  it("reloads the latest values on request after a conflict", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_VERSION_CONFLICT", "conflict", 409, {
        currentVersion: 5,
      }),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    await user.type(name, " mine");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await screen.findByText(/ถูกแก้โดยผู้อื่น/);
    fetchDetailMock.mockResolvedValue({
      monitor: detail({ name: "Theirs", version: 5 }),
    });
    await user.click(screen.getByRole("button", { name: "โหลดค่าล่าสุด" }));
    expect(await screen.findByDisplayValue("Theirs")).toBeInTheDocument();
    updateMock.mockResolvedValue(written({ version: 6 }));
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(2);
    });
    expect(updateMock.mock.calls[1]?.[2].expectedVersion).toBe(5);
  });

  it("shows not-found when the monitor is deleted before the save", async () => {
    fetchDetailMock.mockResolvedValue({ monitor: detail() });
    updateMock.mockRejectedValue(new ApiError("MONITOR_NOT_FOUND", "nf", 404));
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
  });
});
