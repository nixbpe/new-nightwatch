import { guardUnassignedNetwork } from "../../test/guard-network";
guardUnassignedNetwork();
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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
import { noChecks, noIncidents, noResponseTimes } from "./detail-test-support";
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
  fetchMonitorLastResponse: vi.fn(() => Promise.resolve({ response: null })),
  fetchMonitorEvents: vi.fn(() =>
    Promise.resolve({ events: [], page: { limit: 20, offset: 0, total: 0 } }),
  ),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
}));

const createMock = vi.mocked(createMonitor);
const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);
const meMock = vi.mocked(fetchMeContext);
const C = "33333333-3333-4333-8333-333333333333";
function threeOrgs(active: string) {
  return {
    ...context("owner", [
      { id: A, name: "Acme", slug: "acme", role: "owner" },
      { id: B, name: "Beta", slug: "beta", role: "owner" },
      { id: C, name: "Gamma", slug: "gamma", role: "owner" },
    ]),
    lastActiveTenantId: active,
  };
}
const SECRET_ID = "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  vi.mocked(fetchOrganizationNotificationSettings).mockResolvedValue({
    organizationId: A,
    version: 1,
    settingsChangedEnabled: true,
    monitorAlertsEnabled: false,
  });
  meMock.mockResolvedValue(context());
  vi.mocked(fetchMonitorChecks).mockResolvedValue(noChecks);
  vi.mocked(fetchMonitorIncidents).mockResolvedValue(noIncidents);
  vi.mocked(fetchMonitorRecentEvents).mockResolvedValue({ events: [] });
  vi.mocked(fetchMonitorResponseTimes).mockResolvedValue(noResponseTimes);
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  detailMock.mockResolvedValue({ monitor: detail() });
  createMock.mockResolvedValue({ monitor: record() });
  updateMock.mockResolvedValue({ monitor: record({ version: 4 }) });
});

afterEach(() => {
  vi.resetAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

/** Lets every pending promise continuation and effect run inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openCreate(user: User) {
  renderForm(newPath());
  await screen.findByLabelText("ชื่อมอนิเตอร์");
  await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
  await user.type(
    screen.getByLabelText("URL"),
    "https://api.acme.example/health",
  );
}
const saveCreate = () =>
  screen.getByRole("button", { name: /^(บันทึกมอนิเตอร์|กำลังบันทึก…)$/ });

describe("a route Organization that is not the server-active one", () => {
  beforeEach(() => {
    meMock.mockResolvedValue({ ...context(), lastActiveTenantId: B });
  });

  it("navigates to Detail after a Create save", async () => {
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/monitors/${MONITOR_ID}`,
      );
    });
  });

  it("navigates to Detail after an Edit save, with the first paint already the saved monitor", async () => {
    detailMock.mockResolvedValue({ monitor: detail({ version: 3 }) });
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    detailMock.mockResolvedValue({
      monitor: detail({ name: "Payments API 2", version: 4 }),
    });
    await user.type(name, " 2");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(await screen.findByText("บันทึกการแก้ไขแล้ว")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Payments API 2" }),
    ).toBeInTheDocument();
  });

  it("keeps an Edit form's values when the user picks the Organization the URL names", async () => {
    detailMock.mockResolvedValue({
      monitor: detail({
        auth: { type: "bearer" },
        headers: [{ id: SECRET_ID, name: "X-Key", secret: true }],
        secretSlots: [{ slot: "auth.token", configured: true }],
      }),
    });
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: A,
    });
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    await user.type(name, " typed");
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Acme/ }));
    // The switcher shows Acme once the switch has settled.
    await screen.findByRole("button", { name: /Acme/ });
    await flush();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors/${MONITOR_ID}/edit`,
    );
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
      "Payments API typed",
    );
    // The stored secret is still shown as set.
    expect(screen.getAllByText(/ตั้งค่าแล้ว/).length).toBeGreaterThan(0);
  });

  it("does not bounce a Detail page off its own Organization", async () => {
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: A,
    });
    const user = userEvent.setup();
    renderForm(`/organizations/${A}/monitors/${MONITOR_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Payments API" });
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Acme/ }));
    await screen.findByRole("button", { name: /Acme/ });
    await flush();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${A}/monitors/${MONITOR_ID}`,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Payments API" }),
    ).toBeInTheDocument();
  });

  it("still leaves for another Organization than the one the URL names", async () => {
    meMock.mockResolvedValue(threeOrgs(B));
    vi.mocked(updateActiveOrganization).mockResolvedValue(threeOrgs(C));
    const user = userEvent.setup();
    renderForm(newPath());
    await user.type(await screen.findByLabelText("ชื่อมอนิเตอร์"), "typed");
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Gamma/ }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${C}/monitors`,
      );
    });
    expect(screen.queryByDisplayValue("typed")).toBeNull();
  });

  it("leaves after the URL's Organization was picked and the first active one is picked again", async () => {
    vi.mocked(updateActiveOrganization)
      .mockResolvedValueOnce({ ...context(), lastActiveTenantId: A })
      .mockResolvedValueOnce({ ...context(), lastActiveTenantId: B });
    const user = userEvent.setup();
    renderForm(newPath());
    await user.type(await screen.findByLabelText("ชื่อมอนิเตอร์"), "typed");
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Acme/ }));
    await screen.findByRole("button", { name: /Acme/ });
    await flush();
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue("typed");
    await user.click(screen.getByRole("button", { name: /Acme/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Beta/ }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${B}/monitors`,
      );
    });
    expect(screen.queryByDisplayValue("typed")).toBeNull();
  });

  it("saves after the URL's Organization was picked", async () => {
    vi.mocked(updateActiveOrganization).mockResolvedValue({
      ...context(),
      lastActiveTenantId: A,
    });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Acme/ }));
    await screen.findByRole("button", { name: /Acme/ });
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${A}/monitors/${MONITOR_ID}`,
      );
    });
  });

  it("does not read Organization A's detail after the user switched away before the save landed", async () => {
    meMock.mockResolvedValue(threeOrgs(B));
    vi.mocked(updateActiveOrganization).mockResolvedValue(threeOrgs(C));
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    updateMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Gamma/ }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/organizations/${C}/monitors`,
      );
    });
    await flush();
    const readsBefore = detailMock.mock.calls.length;
    pending.resolve({ monitor: record({ version: 4 }) });
    await flush();
    expect(detailMock.mock.calls).toHaveLength(readsBefore);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/organizations/${C}/monitors`,
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent(MONITOR_ID);
  });
});

describe("refusals with no control of their own", () => {
  const secretDetail = () =>
    detail({
      auth: { type: "bearer" },
      headers: [
        { id: SECRET_ID, name: "X-Key", secret: true },
        { name: "X-Team", value: "core", secret: false },
      ],
      secretSlots: [
        { slot: "auth.token", configured: true },
        { slot: `header.${SECRET_ID}`, configured: true },
      ],
    });

  it("places refusals of the secret fields beside their inputs, by the slot each entry named", async () => {
    detailMock.mockResolvedValue({ monitor: secretDetail() });
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [
          { field: "headers.0.name", reason: "duplicate" },
          { field: "auth", reason: "required" },
          { field: "secrets.1.slot", reason: "invalid_format" },
        ],
      }),
    );
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(await screen.findByText("ชื่อ header ซ้ำกับแถวอื่น")).toBeVisible();
    expect(screen.getByLabelText("ชื่อ header แถวที่ 1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("กรอกค่าลับของการยืนยันตัวตนให้ครบ")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "แทนที่ Token" }),
    ).toHaveAccessibleDescription("กรอกค่าลับของการยืนยันตัวตนให้ครบ");
    expect(
      screen.getByText("ค่าลับนี้ไม่ตรงกับการตั้งค่าปัจจุบัน"),
    ).toBeVisible();
  });
});

describe("inputs keep the focus while the form is busy or locked", () => {
  it("keeps the focus in the field on Enter, while pending and after a 403", async () => {
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    createMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    await openCreate(user);
    const url = screen.getByLabelText("URL");
    url.focus();
    await user.keyboard("{Enter}");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(url).toHaveFocus();
    expect(url).toHaveAttribute("readonly");
    expect(url).not.toBeDisabled();
    meMock.mockResolvedValue(context("viewer"));
    pending.reject(new ApiError("PERMISSION_DENIED", "d", 403));
    await waitFor(() => {
      expect(saveCreate()).toHaveAttribute("aria-disabled", "true");
    });
    expect(url).toHaveFocus();
    expect(url).toHaveValue("https://api.acme.example/health");
  });

  it("ignores the interval control while pending without moving the focus", async () => {
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    createMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    const five = screen.getByRole("radio", { name: "5 นาที" });
    five.focus();
    await user.keyboard("{ArrowRight}");
    expect(five).toHaveAttribute("aria-checked", "true");
    expect(five).toHaveFocus();
    pending.reject(new ApiError("INTERNAL_ERROR", "x", 500));
  });
});

describe("after MEMBERSHIP_DENIED", () => {
  it("keeps actions off while the refresh fails", async () => {
    createMock.mockRejectedValue(new ApiError("MEMBERSHIP_DENIED", "d", 403));
    const user = userEvent.setup();
    await openCreate(user);
    meMock.mockRejectedValue(new Error("offline"));
    await user.click(saveCreate());
    await waitFor(() => {
      expect(saveCreate()).toHaveAttribute("aria-disabled", "true");
    });
    await user.click(saveCreate());
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue("Payments API");
  });

  it("turns actions back on once the refresh shows the membership is intact", async () => {
    createMock
      .mockRejectedValueOnce(new ApiError("MEMBERSHIP_DENIED", "d", 403))
      .mockResolvedValueOnce({ monitor: record() });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(saveCreate()).toHaveAttribute("aria-disabled", "false");
    });
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("the client request id", () => {
  const ids = () =>
    createMock.mock.calls.map((call) => call[1].clientRequestId);

  it("stays the same when unchanged values are retried after a refusal", async () => {
    createMock
      .mockRejectedValueOnce(
        new ApiError("MONITOR_INVALID", "i", 400, {
          fields: [{ field: "name", reason: "too_long" }],
        }),
      )
      .mockResolvedValueOnce({ monitor: record() });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await screen.findByText(/ชื่อยาวได้ไม่เกิน/);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
    expect(ids()[0]).toBe(ids()[1]);
  });

  it("is new once a value changes after a definitive refusal", async () => {
    createMock
      .mockRejectedValueOnce(new ApiError("MONITOR_LIMIT_REACHED", "l", 409))
      .mockResolvedValueOnce({ monitor: record() });
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(saveCreate());
    await screen.findByText(/ครบตามจำนวนสูงสุด/);
    await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), " 2");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
    expect(ids()[0]).not.toBe(ids()[1]);
  });

  it.each([
    ["a network error", new ApiError("NETWORK_ERROR", "n", 0)],
    ["a 5xx", new ApiError("INTERNAL_ERROR", "s", 503)],
  ])(
    "stays the same after %s even when a value changes",
    async (_label, error) => {
      createMock
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ monitor: record() });
      const user = userEvent.setup();
      await openCreate(user);
      await user.click(saveCreate());
      await screen.findByText("บันทึกไม่สำเร็จ ลองอีกครั้ง");
      await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), " 2");
      await user.click(saveCreate());
      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(2);
      });
      expect(ids()[0]).toBe(ids()[1]);
    },
  );
});

describe("a stale server error on a threshold", () => {
  it("clears when the timeout changes", async () => {
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "i", 400, {
        fields: [{ field: "assertions.0.ms", reason: "out_of_range" }],
      }),
    );
    const user = userEvent.setup();
    await openCreate(user);
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.selectOptions(
      screen.getByLabelText("ชนิดเงื่อนไขแถวที่ 1"),
      "responseTimeBelow",
    );
    await user.type(
      screen.getByLabelText("เวลาตอบสนองน้อยกว่าแถวที่ 1 (มิลลิวินาที)"),
      "500",
    );
    await user.click(saveCreate());
    const ms = screen.getByLabelText(
      "เวลาตอบสนองน้อยกว่าแถวที่ 1 (มิลลิวินาที)",
    );
    await waitFor(() => {
      expect(ms).toHaveAttribute("aria-invalid", "true");
    });
    fireEvent.change(screen.getByLabelText("หมดเวลารอ (วินาที)"), {
      target: { value: "20" },
    });
    expect(ms).not.toHaveAttribute("aria-invalid");
  });
});
