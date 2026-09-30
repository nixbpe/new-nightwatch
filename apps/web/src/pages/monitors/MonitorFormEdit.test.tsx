import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLeafActive } from "../../components/shell/nav-config";
import { ApiError } from "../../lib/api/client";
import { fetchMeContext } from "../../lib/api/me";
import {
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
  newPath,
  record,
  renderForm,
} from "./form-test-support";

vi.mock("../../lib/api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
}));

const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);
const SECRET_ID = "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  vi.mocked(fetchMeContext).mockResolvedValue(context());
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
  updateMock.mockResolvedValue({ monitor: record({ version: 4 }) });
});

afterEach(() => {
  vi.resetAllMocks();
});

const saveEdit = () =>
  screen.getByRole("button", { name: /^(บันทึกการแก้ไข|กำลังบันทึก…)$/ });

describe("Edit opens with the saved configuration", () => {
  it("opens in advanced mode when the monitor has advanced values", async () => {
    detailMock.mockResolvedValue({
      monitor: detail({
        method: "POST",
        timeoutSeconds: 5,
        expectedStatus: "200-299,301",
        queryParams: [{ name: "page", value: "2" }],
        body: { type: "text", content: "ping" },
        assertions: [
          { kind: "jsonPathEquals", path: "$.status", expected: '"ok"' },
          { kind: "responseTimeBelow", ms: 800 },
        ],
      }),
    });
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    expect(screen.getByRole("radio", { name: "ขั้นสูง" })).toBeChecked();
    expect(screen.getByLabelText("Method")).toHaveValue("POST");
    expect(screen.getByLabelText("หมดเวลารอ (วินาที)")).toHaveValue("5");
    expect(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ")).toHaveValue(
      "200-299,301",
    );
    expect(screen.getByLabelText("ชื่อ query param แถวที่ 1")).toHaveValue(
      "page",
    );
    expect(screen.getByLabelText("เนื้อหา")).toHaveValue("ping");
    expect(screen.getByLabelText("JSONPath แถวที่ 1")).toHaveValue("$.status");
    expect(
      screen.getByLabelText("เวลาตอบสนองน้อยกว่าแถวที่ 2 (มิลลิวินาที)"),
    ).toHaveValue("800");
  });

  it("opens in basic mode when nothing advanced is set", async () => {
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    expect(screen.getByRole("radio", { name: "พื้นฐาน" })).toBeChecked();
    expect(screen.queryByText(/มีการตั้งค่าขั้นสูง/)).toBeNull();
  });

  it("shows a loading state, then an error with retry when the load fails", async () => {
    detailMock.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", "x", 500));
    const user = userEvent.setup();
    renderForm(editPath());
    expect(
      await screen.findByText("โหลดการตั้งค่าไม่สำเร็จ"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByDisplayValue("Payments API")).toBeInTheDocument();
  });

  it.each([
    ["a missing id", "99999999-9999-4999-8999-999999999999"],
    ["a malformed id", "not-a-uuid"],
    ["an id of another Organization", "22222222-aaaa-4aaa-8aaa-222222222222"],
  ])("shows the same not-found text for %s", async (_label, id) => {
    // The API answers the three the same way (AC-48), so the page cannot tell them apart.
    detailMock.mockRejectedValue(new ApiError("MONITOR_NOT_FOUND", "nf", 404));
    renderForm(editPath(A, id));
    expect(await screen.findByText("ไม่พบมอนิเตอร์นี้")).toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อมอนิเตอร์")).toBeNull();
  });

  it("keeps the nav leaf active on /new and /edit", () => {
    const leaf = { path: "/organizations/:organizationId/monitors" };
    expect(isLeafActive(leaf, newPath())).toBe(true);
    expect(isLeafActive(leaf, editPath())).toBe(true);
  });
});

describe("Edit secrets pass through", () => {
  const withSecrets = () =>
    detail({
      auth: { type: "bearer" },
      headers: [
        { id: SECRET_ID, name: "X-Api-Key", secret: true },
        { name: "X-Team", value: "core", secret: false },
      ],
      secretSlots: [
        { slot: "auth.token", configured: true },
        { slot: `header.${SECRET_ID}`, configured: true },
      ],
    });

  it("shows auth and secret headers as set, without a value or a way to remove them", async () => {
    detailMock.mockResolvedValue({ monitor: withSecrets() });
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    const auth = screen.getByRole("region", { name: "การยืนยันตัวตน" });
    expect(within(auth).getByText(/Bearer token/)).toBeInTheDocument();
    expect(within(auth).getByText("ตั้งค่าแล้ว")).toBeInTheDocument();
    expect(screen.getByText("ตั้งค่าแล้ว (ค่าลับ)")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ลบ header แถวที่ 1/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "ลบ header แถวที่ 2" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/ค่า header แถวที่ 1/)).toBeNull();
  });

  it("saves with the same auth, the secret header and a keep for every slot", async () => {
    detailMock.mockResolvedValue({ monitor: withSecrets() });
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 3"), "X-New");
    await user.type(screen.getByLabelText("ค่า header แถวที่ 3"), "1");
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        expectedVersion: 1,
        auth: { type: "bearer" },
        headers: [
          { id: SECRET_ID, name: "X-Api-Key", secret: true },
          { name: "X-Team", value: "core", secret: false },
          { name: "X-New", value: "1", secret: false },
        ],
        secrets: [
          { slot: "auth.token", action: "keep" },
          { slot: `header.${SECRET_ID}`, action: "keep" },
        ],
      }),
    );
  });

  it("never offers a secret toggle or an auth type on Create", async () => {
    const user = userEvent.setup();
    renderForm(newPath());
    await screen.findByLabelText("ชื่อมอนิเตอร์");
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("region", { name: "การยืนยันตัวตน" })).toBeNull();
  });
});

describe("Edit save", () => {
  it("sends one update for a repeated press", async () => {
    const pending = deferred<{ monitor: ReturnType<typeof record> }>();
    updateMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(saveEdit());
    await user.click(saveEdit());
    await user.keyboard("{Enter}");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveEdit()).toHaveFocus();
    pending.resolve({ monitor: record({ version: 4 }) });
    await screen.findByTestId("location");
  });

  it("places a server refusal beside its field on Edit", async () => {
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "queryParams.0.value", reason: "too_long" }],
      }),
    );
    detailMock.mockResolvedValue({
      monitor: detail({ queryParams: [{ name: "q", value: "x" }] }),
    });
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(saveEdit());
    await waitFor(() => {
      expect(
        screen.getByLabelText("ค่า query param แถวที่ 1"),
      ).toHaveAccessibleDescription("ค่ายาวได้ไม่เกิน 4 KiB");
    });
    expect(screen.getByLabelText("ค่า query param แถวที่ 1")).toHaveFocus();
  });

  it("keeps the edited values and blocks actions when the role drops", async () => {
    updateMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "d", 403));
    const user = userEvent.setup();
    renderForm(editPath());
    const name = await screen.findByDisplayValue("Payments API");
    await user.type(name, " mine");
    vi.mocked(fetchMeContext).mockResolvedValue(context("auditor"));
    await user.click(saveEdit());
    expect(
      (await screen.findAllByText("สิทธิ์ของคุณเปลี่ยนแล้ว")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("ชื่อมอนิเตอร์")).toHaveValue(
      "Payments API mine",
    );
    await waitFor(() => {
      expect(saveEdit()).toHaveAttribute("aria-disabled", "true");
    });
    expect(saveEdit()).toHaveFocus();
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("shows denied with no data when the user was removed from the Organization", async () => {
    updateMock.mockRejectedValue(new ApiError("MEMBERSHIP_DENIED", "d", 403));
    const user = userEvent.setup();
    renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    vi.mocked(fetchMeContext).mockResolvedValue(
      context("owner", [{ id: B, name: "Beta", slug: "beta", role: "owner" }]),
    );
    await user.click(saveEdit());
    expect(
      await screen.findByText(
        "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Payments API")).toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it.each(["viewer", "auditor"] as const)(
    "shows denied to a %s who opens /edit directly, without loading the monitor",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      renderForm(editPath());
      expect(
        await screen.findByText(
          "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้",
        ),
      ).toBeInTheDocument();
      expect(detailMock).not.toHaveBeenCalled();
    },
  );
});
