import type { MonitorTestResult } from "@nightwatch/api-contract";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMeContext } from "../../lib/api/me";
import {
  createMonitor,
  fetchMonitorChecks,
  fetchMonitorDetail,
  fetchMonitorIncidents,
  fetchMonitorList,
  fetchMonitorRecentEvents,
  fetchMonitorResponseTimes,
  testMonitorDraft,
  testMonitorEdit,
  updateMonitor,
} from "../../lib/api/monitors";
import { noChecks, noIncidents, noResponseTimes } from "./detail-test-support";
import {
  A,
  context,
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
vi.mock("../../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  fetchMonitorDetail: vi.fn(),
  fetchMonitorChecks: vi.fn(),
  fetchMonitorIncidents: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
  fetchMonitorResponseTimes: vi.fn(),
  fetchMonitorList: vi.fn(),
  testMonitorDraft: vi.fn(),
  testMonitorEdit: vi.fn(),
}));

const createMock = vi.mocked(createMonitor);
const updateMock = vi.mocked(updateMonitor);
const detailMock = vi.mocked(fetchMonitorDetail);
const draftMock = vi.mocked(testMonitorDraft);
const editTestMock = vi.mocked(testMonitorEdit);

const HEADER_ID = "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = "s3cr3t-Value-9f2c";
const OTHER_SECRET = "n3w-Value-77aa";

const testResult: { result: MonitorTestResult } = {
  result: {
    checkedAt: "2026-09-30T07:30:00.000Z",
    outcome: "pass",
    httpStatus: 200,
    responseTimeMs: 182,
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
  },
};

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
  createMock.mockResolvedValue({ monitor: record() });
  updateMock.mockResolvedValue({ monitor: record({ version: 4 }) });
  draftMock.mockResolvedValue(testResult);
  editTestMock.mockResolvedValue(testResult);
});

afterEach(() => {
  vi.resetAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

const authRegion = () => screen.getByRole("region", { name: "การยืนยันตัวตน" });
const saveCreate = () =>
  screen.getByRole("button", { name: "บันทึกมอนิเตอร์" });
const saveEdit = () => screen.getByRole("button", { name: "บันทึกการแก้ไข" });
const testButton = () =>
  screen.getByRole("button", { name: /^(ทดสอบการตั้งค่า|กำลังทดสอบ…)$/ });

async function openCreate(): Promise<User> {
  const user = userEvent.setup();
  renderForm(newPath());
  await screen.findByLabelText("ชื่อมอนิเตอร์");
  await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
  await user.type(
    screen.getByLabelText("URL"),
    "https://api.acme.example/health",
  );
  await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
  return user;
}

async function chooseAuth(user: User, type: string) {
  await user.selectOptions(within(authRegion()).getByLabelText("ชนิด"), type);
}

const storedBearer = () =>
  detail({
    auth: { type: "bearer" },
    secretSlots: [{ slot: "auth.token", configured: true }],
  });

async function openEdit(monitor = storedBearer()): Promise<User> {
  detailMock.mockResolvedValue({ monitor });
  const user = userEvent.setup();
  renderForm(editPath());
  await screen.findByDisplayValue("Payments API");
  return user;
}

const passwordInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  );

describe("Create: auth section and secret entries", () => {
  it("offers the four auth types and sends none by default", async () => {
    const user = await openCreate();
    const select = within(authRegion()).getByLabelText("ชนิด");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["ไม่ใช้", "Bearer token", "Basic", "API key header"]);
    expect(passwordInputs()).toHaveLength(0);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      auth: { type: "none" },
      secrets: [],
    });
  });

  it("sends a Bearer token as one secret entry in a write-only password field", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    const token = screen.getByLabelText("Token");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "new-password");
    expect(
      within(authRegion()).getByText(/จะไม่แสดงอีกหลังบันทึก/),
    ).toBeVisible();
    await user.type(token, SECRET);
    // Nothing of the value reaches an attribute or the markup.
    expect(token).toHaveValue(SECRET);
    expect(token).not.toHaveAttribute("value");
    expect(document.body.innerHTML).not.toContain(SECRET);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const body = createMock.mock.calls[0]?.[1];
    expect(body).toMatchObject({
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: SECRET }],
    });
    expect(body).not.toHaveProperty("headers.0.value");
  });

  it("sends Basic as a username and a password entry", async () => {
    const user = await openCreate();
    await chooseAuth(user, "basic");
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "svc");
    await user.type(screen.getByLabelText("รหัสผ่าน"), SECRET);
    expect(screen.getByLabelText("ชื่อผู้ใช้")).toHaveAttribute(
      "type",
      "password",
    );
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      auth: { type: "basic" },
      secrets: [
        { slot: "auth.username", value: "svc" },
        { slot: "auth.password", value: SECRET },
      ],
    });
  });

  it("sends an API key with its non-secret header name and warns about a header with the same name", async () => {
    const user = await openCreate();
    await chooseAuth(user, "apiKey");
    await user.type(screen.getByLabelText("ชื่อ header ของ API key"), "X-Key");
    await user.type(screen.getByLabelText("ค่า API key"), SECRET);
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 1"), "x-key");
    expect(within(authRegion()).getByText(/ชนกับการยืนยันตัวตน/)).toBeVisible();
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText("ชื่อนี้ชนกับ header ของการยืนยันตัวตน"),
    ).toBeVisible();
    await user.clear(screen.getByLabelText("ชื่อ header แถวที่ 1"));
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 1"), "X-Team");
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), "core");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      auth: { type: "apiKey", headerName: "X-Key" },
      secrets: [{ slot: "auth.apiKey", value: SECRET }],
    });
  });

  it("validates the API key header name as an HTTP token", async () => {
    const user = await openCreate();
    await chooseAuth(user, "apiKey");
    await user.type(
      screen.getByLabelText("ชื่อ header ของ API key"),
      "bad name",
    );
    await user.type(screen.getByLabelText("ค่า API key"), SECRET);
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("ชื่อ header ของ API key")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("blocks Save with an empty required secret and keeps the request unsent", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    const token = screen.getByLabelText("Token");
    expect(token).toHaveAttribute("aria-invalid", "true");
    expect(token).toHaveAccessibleDescription(/กรอกค่าลับ/);
    expect(token).toHaveFocus();
    await user.type(token, SECRET);
    expect(token).not.toHaveAttribute("aria-invalid");
  });

  it("drops the typed value when the auth type changes", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    await chooseAuth(user, "basic");
    await chooseAuth(user, "bearer");
    expect(screen.getByLabelText("Token")).toHaveValue("");
  });

  it("keeps the typed secret when the mode is switched to basic and back", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    await user.click(screen.getByRole("radio", { name: "พื้นฐาน" }));
    expect(passwordInputs()).toHaveLength(0);
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    expect(screen.getByLabelText("Token")).toHaveValue(SECRET);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      secrets: [{ slot: "auth.token", value: SECRET }],
    });
  });
});

describe("Create: secret headers", () => {
  async function addHeader(user: User, row: number, name: string) {
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    await user.type(
      screen.getByLabelText(`ชื่อ header แถวที่ ${String(row)}`),
      name,
    );
  }

  it("turns the value into a password field when the row is marked secret", async () => {
    const user = await openCreate();
    await addHeader(user, 1, "X-Api-Key");
    const value = screen.getByLabelText("ค่า header แถวที่ 1");
    expect(value).not.toHaveAttribute("type", "password");
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    const secret = screen.getByLabelText("ค่า header แถวที่ 1");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveAttribute("autocomplete", "new-password");
  });

  it("sends a client UUID id per secret row, the same across edits, and never the value in the header", async () => {
    const user = await openCreate();
    await addHeader(user, 1, "X-One");
    await addHeader(user, 2, "X-Two");
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 2"));
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), SECRET);
    await user.type(screen.getByLabelText("ค่า header แถวที่ 2"), OTHER_SECRET);
    // Renaming a row must not change its id.
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 1"), "-Key");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const body = createMock.mock.calls[0]?.[1];
    const headers = body?.headers ?? [];
    expect(headers).toHaveLength(2);
    const [first, second] = headers;
    expect(first).toMatchObject({ name: "X-One-Key", secret: true });
    expect(first?.id).toMatch(UUID);
    expect(second?.id).toMatch(UUID);
    expect(first?.id).not.toBe(second?.id);
    expect(first).not.toHaveProperty("value");
    expect(body?.secrets).toEqual([
      { slot: `header.${first?.id ?? ""}`, value: SECRET },
      { slot: `header.${second?.id ?? ""}`, value: OTHER_SECRET },
    ]);
  });

  it("blocks Save with an empty secret header value beside that row", async () => {
    const user = await openCreate();
    await addHeader(user, 1, "X-Api-Key");
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    await user.click(saveCreate());
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("ค่า header แถวที่ 1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("clears the typed value when a secret row is made plain again", async () => {
    const user = await openCreate();
    await addHeader(user, 1, "X-Api-Key");
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), SECRET);
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    expect(screen.getByLabelText("ค่า header แถวที่ 1")).toHaveValue("");
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), "plain");
    await user.click(saveCreate());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const body = createMock.mock.calls[0]?.[1];
    expect(body?.secrets).toEqual([]);
    expect(body?.headers?.[0]).toMatchObject({ value: "plain", secret: false });
  });

  it("sends one create for a repeated press with secrets", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    let release: (value: { monitor: ReturnType<typeof record> }) => void = () =>
      undefined;
    createMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const button = () =>
      screen.getByRole("button", { name: /^(บันทึกมอนิเตอร์|กำลังบันทึก…)$/ });
    await user.click(button());
    await user.click(button());
    await user.keyboard("{Enter}");
    expect(createMock).toHaveBeenCalledTimes(1);
    release({ monitor: record() });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(MONITOR_ID);
    });
  });
});

describe("Edit: replace, keep and delete", () => {
  it("shows 'ตั้งค่าแล้ว' with a replace button and sends keep when it is not pressed", async () => {
    const user = await openEdit();
    expect(within(authRegion()).getByText("ตั้งค่าแล้ว")).toBeVisible();
    expect(passwordInputs()).toHaveLength(0);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", action: "keep" }],
    });
  });

  it("opens an empty password field on replace and sends the new value", async () => {
    const user = await openEdit();
    await user.click(screen.getByRole("button", { name: "แทนที่Token" }));
    const token = screen.getByLabelText("Token");
    expect(token).toHaveValue("");
    expect(token).toHaveFocus();
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "new-password");
    await user.type(token, SECRET);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      secrets: [{ slot: "auth.token", action: "replace", value: SECRET }],
    });
  });

  it("blocks an empty replacement with the message and cancelling it goes back to keep", async () => {
    const user = await openEdit();
    await user.click(screen.getByRole("button", { name: "แทนที่Token" }));
    await user.click(saveEdit());
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Token")).toHaveAccessibleDescription(
      /กรอกค่าใหม่ หรือกดยกเลิกการแทนที่/,
    );
    await user.click(
      screen.getByRole("button", { name: "ยกเลิกการแทนที่Token" }),
    );
    expect(within(authRegion()).getByText("ตั้งค่าแล้ว")).toBeVisible();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      secrets: [{ slot: "auth.token", action: "keep" }],
    });
  });

  it("forgets a typed replacement that was cancelled", async () => {
    const user = await openEdit();
    await user.click(screen.getByRole("button", { name: "แทนที่Token" }));
    await user.type(screen.getByLabelText("Token"), SECRET);
    await user.click(
      screen.getByRole("button", { name: "ยกเลิกการแทนที่Token" }),
    );
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.stringify(updateMock.mock.calls[0]?.[2])).not.toContain(SECRET);
  });

  it("warns that the old secrets are deleted when the type changes and asks for the new type's fields", async () => {
    const user = await openEdit();
    expect(
      within(authRegion()).queryByText("ค่าลับของชนิดเดิมจะถูกลบ"),
    ).toBeNull();
    await chooseAuth(user, "basic");
    expect(
      within(authRegion()).getByText("ค่าลับของชนิดเดิมจะถูกลบ"),
    ).toBeVisible();
    await user.click(saveEdit());
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("ชื่อผู้ใช้")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "svc");
    await user.type(screen.getByLabelText("รหัสผ่าน"), SECRET);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "basic" },
      secrets: [
        { slot: "auth.username", action: "replace", value: "svc" },
        { slot: "auth.password", action: "replace", value: SECRET },
        { slot: "auth.token", action: "delete" },
      ],
    });
  });

  it("removes the auth secrets with the delete button and sends a delete", async () => {
    const user = await openEdit();
    await user.click(
      screen.getByRole("button", { name: "เลิกใช้และลบค่าลับ" }),
    );
    expect(within(authRegion()).getByLabelText("ชนิด")).toHaveValue("none");
    expect(
      within(authRegion()).getByText("ค่าลับของชนิดเดิมจะถูกลบ"),
    ).toBeVisible();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "none" },
      secrets: [{ slot: "auth.token", action: "delete" }],
    });
  });

  describe("secret headers", () => {
    const withHeader = () =>
      detail({
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        secretSlots: [{ slot: `header.${HEADER_ID}`, configured: true }],
      });

    it("shows a stored secret header as set and replaces it with a new value", async () => {
      const user = await openEdit(withHeader());
      expect(screen.getByLabelText("ค่าลับ header แถวที่ 1")).toBeChecked();
      await user.click(
        screen.getByRole("button", { name: "แทนที่ค่า header แถวที่ 1" }),
      );
      await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), SECRET);
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      const body = updateMock.mock.calls[0]?.[2];
      expect(body?.headers).toEqual([
        { id: HEADER_ID, name: "X-Api-Key", secret: true },
      ]);
      expect(body?.secrets).toEqual([
        { slot: `header.${HEADER_ID}`, action: "replace", value: SECRET },
      ]);
    });

    it("warns 'ค่าลับเดิมจะถูกลบ' when a stored secret header becomes plain, and deletes its slot", async () => {
      const user = await openEdit(withHeader());
      await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
      expect(screen.getByText("ค่าลับเดิมจะถูกลบ")).toBeVisible();
      await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), "plain");
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      const body = updateMock.mock.calls[0]?.[2];
      expect(body?.headers?.[0]).toMatchObject({
        value: "plain",
        secret: false,
      });
      expect(body?.secrets).toEqual([
        { slot: `header.${HEADER_ID}`, action: "delete" },
      ]);
    });

    it("deletes the slot of a removed secret header and keeps its id for a row that stays", async () => {
      const user = await openEdit(withHeader());
      await user.click(
        screen.getByRole("button", { name: "ลบ header แถวที่ 1" }),
      );
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
        headers: [],
        secrets: [{ slot: `header.${HEADER_ID}`, action: "delete" }],
      });
    });

    it("gives a plain stored header that becomes secret a client id and needs its value", async () => {
      const user = await openEdit(
        detail({ headers: [{ name: "X-Team", value: "core", secret: false }] }),
      );
      await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
      await user.click(saveEdit());
      expect(updateMock).not.toHaveBeenCalled();
      await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), SECRET);
      await user.click(saveEdit());
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledTimes(1);
      });
      const body = updateMock.mock.calls[0]?.[2];
      const id = body?.headers?.[0]?.id ?? "";
      expect(id).toMatch(UUID);
      expect(body?.secrets).toEqual([
        { slot: `header.${id}`, action: "replace", value: SECRET },
      ]);
    });
  });
});

describe("Edit: origin change (AC-44)", () => {
  const changeUrl = (value: string) => {
    fireEvent.change(screen.getByLabelText("URL"), { target: { value } });
  };

  it("names the origin wording, turns Save and Test off, and lifts it by replacing the secret", async () => {
    const user = await openEdit();
    changeUrl("https://other.example/health");
    expect(screen.getByLabelText("URL")).toHaveAccessibleDescription(
      "เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม",
    );
    expect(saveEdit()).toBeDisabled();
    expect(testButton()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "แทนที่Token" }));
    // An open replacement is not a kept value: Save is on, and it asks for the new value.
    await user.click(saveEdit());
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Token")).toHaveAccessibleDescription(
      /กรอกค่าใหม่ หรือกดยกเลิกการแทนที่/,
    );
    await user.type(screen.getByLabelText("Token"), SECRET);
    expect(saveEdit()).toBeEnabled();
    expect(testButton()).toBeEnabled();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      url: "https://other.example/health",
      secrets: [{ slot: "auth.token", action: "replace", value: SECRET }],
    });
  });

  it("lifts it by deleting every kept secret", async () => {
    const user = await openEdit(
      detail({
        auth: { type: "bearer" },
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        secretSlots: [
          { slot: "auth.token", configured: true },
          { slot: `header.${HEADER_ID}`, configured: true },
        ],
      }),
    );
    changeUrl("http://api.acme.example/health");
    expect(saveEdit()).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "เลิกใช้และลบค่าลับ" }),
    );
    // The secret header is still kept.
    expect(saveEdit()).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "ลบ header แถวที่ 1" }),
    );
    expect(saveEdit()).toBeEnabled();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock.mock.calls[0]?.[2]).toMatchObject({
      auth: { type: "none" },
      headers: [],
    });
  });

  it("does not block a path change or a monitor without secrets", async () => {
    const user = await openEdit(detail());
    changeUrl("https://other.example/health");
    expect(saveEdit()).toBeEnabled();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Test panel with secrets", () => {
  it("tests a draft with the values typed so far and does not store them", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(draftMock.mock.calls[0]?.[1]).toMatchObject({
      auth: { type: "bearer" },
      secrets: [{ slot: "auth.token", value: SECRET }],
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not send a test with an empty required secret", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.click(testButton());
    expect(draftMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Token")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("tests in Edit with keep for an untouched slot and replace for a replaced one", async () => {
    const user = await openEdit(
      detail({
        auth: { type: "bearer" },
        headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
        secretSlots: [
          { slot: "auth.token", configured: true },
          { slot: `header.${HEADER_ID}`, configured: true },
        ],
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "แทนที่ค่า header แถวที่ 1" }),
    );
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), SECRET);
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    const [, monitorId, body] = editTestMock.mock.calls[0] ?? [];
    expect(monitorId).toBe(MONITOR_ID);
    expect(body?.secrets).toEqual([
      { slot: "auth.token", action: "keep" },
      { slot: `header.${HEADER_ID}`, action: "replace", value: SECRET },
    ]);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not send a Test in Edit whose replacement is empty", async () => {
    const user = await openEdit();
    await user.click(screen.getByRole("button", { name: "แทนที่Token" }));
    await user.click(testButton());
    expect(editTestMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Token")).toHaveAccessibleDescription(
      /กรอกค่าใหม่ หรือกดยกเลิกการแทนที่/,
    );
  });

  it("marks a result stale when a secret is changed after the test, without keeping the value", async () => {
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    expect(screen.queryByText("ผลนี้ไม่ตรงกับค่าปัจจุบัน")).toBeNull();
    await user.type(screen.getByLabelText("Token"), "x");
    expect(screen.getByText("ผลนี้ไม่ตรงกับค่าปัจจุบัน")).toBeVisible();
  });
});

describe("Server refusals of secret entries", () => {
  it("places a required refusal of an auth slot beside the token field", async () => {
    const { ApiError } = await import("../../lib/api/client");
    const user = await openCreate();
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [{ field: "secrets.0.value", reason: "too_long" }],
      }),
    );
    await user.click(saveCreate());
    expect(await screen.findByText("ค่าลับยาวได้ไม่เกิน 4 KiB")).toBeVisible();
    expect(screen.getByLabelText("Token")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // The typed value is still there for a retry.
    expect(screen.getByLabelText("Token")).toHaveValue(SECRET);
  });

  it("shows the origin wording beside the URL on a 422 with a replaced secret", async () => {
    const { ApiError } = await import("../../lib/api/client");
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_SECRET_ORIGIN_CHANGED", "x", 422),
    );
    const user = await openEdit();
    await user.click(saveEdit());
    await waitFor(() => {
      expect(screen.getByLabelText("URL")).toHaveAccessibleDescription(
        "เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม",
      );
    });
  });
});

describe("Server refusals of secret entries are placed beside the slot's field", () => {
  const reasons = [
    ["required", "กรอกค่าลับ"],
    ["too_long", "ค่าลับยาวได้ไม่เกิน 4 KiB"],
    ["invalid_format", "ค่าลับมีอักขระที่ใช้ไม่ได้"],
    ["crlf", "ค่าลับห้ามมีการขึ้นบรรทัดใหม่"],
  ] as const;

  async function refuse(fields: { field: string; reason: string }[]) {
    const { ApiError } = await import("../../lib/api/client");
    createMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, { fields }),
    );
  }

  async function openWithAuthAndHeader() {
    const user = await openCreate();
    await chooseAuth(user, "basic");
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "svc");
    await user.type(screen.getByLabelText("รหัสผ่าน"), SECRET);
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 1"), "X-Key");
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), OTHER_SECRET);
    return user;
  }

  it.each(reasons)(
    "places secrets.N.value %s at the auth field and at the header row",
    async (reason, message) => {
      const user = await openWithAuthAndHeader();
      // Entries: 0 auth.username, 1 auth.password, 2 the header slot.
      await refuse([
        { field: "secrets.1.value", reason },
        { field: "secrets.2.value", reason },
      ]);
      await user.click(saveCreate());
      await waitFor(() => {
        expect(screen.getByLabelText("รหัสผ่าน")).toHaveAttribute(
          "aria-invalid",
          "true",
        );
      });
      for (const label of ["รหัสผ่าน", "ค่า header แถวที่ 1"]) {
        const field = screen.getByLabelText(label);
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(field).toHaveAccessibleDescription(
          expect.stringContaining(message),
        );
      }
      expect(screen.getByLabelText("ชื่อผู้ใช้")).not.toHaveAttribute(
        "aria-invalid",
      );
      // Nothing falls back to the summary line.
      expect(screen.queryByText(/^ค่าลับ: /)).toBeNull();
    },
  );

  it("places a keep with no stored value and a slot the config does not use at their fields", async () => {
    const { ApiError } = await import("../../lib/api/client");
    updateMock.mockRejectedValue(
      new ApiError("MONITOR_INVALID", "invalid", 400, {
        fields: [
          { field: "secrets.0", reason: "required" },
          { field: "auth", reason: "required" },
        ],
      }),
    );
    const user = await openEdit();
    await user.click(saveEdit());
    const replace = await screen.findByRole("button", { name: "แทนที่Token" });
    expect(replace).toHaveAttribute("aria-invalid", "true");
    expect(replace).toHaveAccessibleDescription(
      /ไม่พบค่าลับที่เก็บไว้ของรายการนี้/,
    );
    expect(screen.queryByText(/^ค่าลับ: /)).toBeNull();
  });

  it("lists an entry no field matches in the summary line", async () => {
    const user = await openWithAuthAndHeader();
    await refuse([{ field: "secrets.9.value", reason: "too_long" }]);
    await user.click(saveCreate());
    expect(await screen.findByText(/^ค่าลับ: /)).toBeVisible();
  });
});

describe("Detail shows secrets as set only", () => {
  it.each(["viewer", "auditor"] as const)(
    "shows %s the auth type and 'ตั้งค่าแล้ว' with no field, button or value",
    async (role) => {
      vi.mocked(fetchMeContext).mockResolvedValue(context(role));
      detailMock.mockResolvedValue({
        monitor: detail({
          auth: { type: "bearer" },
          headers: [{ id: HEADER_ID, name: "X-Api-Key", secret: true }],
          secretSlots: [
            { slot: "auth.token", configured: true },
            { slot: `header.${HEADER_ID}`, configured: true },
          ],
        }),
      });
      renderForm(`/organizations/${A}/monitors/${MONITOR_ID}`);
      const card = (
        await screen.findByRole("heading", { name: "การตั้งค่า" })
      ).closest("section");
      expect(card).not.toBeNull();
      expect(card).toHaveTextContent("Bearer token (ตั้งค่าแล้ว)");
      expect(card).toHaveTextContent("ตั้งค่าแล้ว (ค่าลับ)");
      expect(passwordInputs()).toHaveLength(0);
      expect(screen.queryByRole("button", { name: /แทนที่/ })).toBeNull();
    },
  );
});

describe("Secret hygiene (AC-25)", () => {
  type Rendered = ReturnType<typeof renderForm>;

  /** Every place a value could linger: markup, caches, storage and the console. */
  function findSecrets(rendered: Rendered, values: string[]): string[] {
    const consoleCalls = [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.debug).mock.calls,
    ];
    const places: Record<string, string> = {
      markup: document.documentElement.outerHTML,
      queryCache: JSON.stringify(
        rendered.queryClient
          .getQueryCache()
          .getAll()
          .map((query) => [query.queryKey, query.state.data]),
      ),
      mutationCache: JSON.stringify(
        rendered.queryClient
          .getMutationCache()
          .getAll()
          .map((mutation) => [mutation.state.variables, mutation.state.data]),
      ),
      localStorage: JSON.stringify(Object.entries(localStorage)),
      sessionStorage: JSON.stringify(Object.entries(sessionStorage)),
      console: JSON.stringify(consoleCalls),
    };
    return values.flatMap((value) =>
      Object.entries(places)
        .filter(([, text]) => text.includes(value))
        .map(([place]) => `${value} in ${place}`),
    );
  }

  beforeEach(() => {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("leaves no secret in the page, the caches, storage or the console after a Create", async () => {
    const user = userEvent.setup();
    const rendered = renderForm(newPath());
    await screen.findByLabelText("ชื่อมอนิเตอร์");
    await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
    await user.type(
      screen.getByLabelText("URL"),
      "https://api.acme.example/health",
    );
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    await chooseAuth(user, "basic");
    await user.type(screen.getByLabelText("ชื่อผู้ใช้"), "svc-user-1");
    await user.type(screen.getByLabelText("รหัสผ่าน"), SECRET);
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 1"), "X-Key");
    await user.click(screen.getByLabelText("ค่าลับ header แถวที่ 1"));
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), OTHER_SECRET);
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    const values = [SECRET, OTHER_SECRET, "svc-user-1"];
    expect(findSecrets(rendered, values)).toEqual([]);
    await user.click(saveCreate());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(MONITOR_ID);
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(findSecrets(rendered, values)).toEqual([]);
    expect(passwordInputs()).toHaveLength(0);
  });

  it("leaves no secret behind after an Edit that replaced one", async () => {
    detailMock.mockResolvedValue({ monitor: storedBearer() });
    const user = userEvent.setup();
    const rendered = renderForm(editPath());
    await screen.findByDisplayValue("Payments API");
    await user.click(screen.getByRole("button", { name: "แทนที่Token" }));
    await user.type(screen.getByLabelText("Token"), SECRET);
    await user.click(testButton());
    await screen.findByText("การทดสอบผ่าน");
    expect(findSecrets(rendered, [SECRET])).toEqual([]);
    await user.click(saveEdit());
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(MONITOR_ID);
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(findSecrets(rendered, [SECRET])).toEqual([]);
  });

  it("keeps the typed value out of the markup after a refused save, so a retry needs no retyping", async () => {
    const { ApiError } = await import("../../lib/api/client");
    createMock.mockRejectedValue(new ApiError("INTERNAL_ERROR", "x", 500));
    const user = userEvent.setup();
    const rendered = renderForm(newPath());
    await screen.findByLabelText("ชื่อมอนิเตอร์");
    await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
    await user.type(
      screen.getByLabelText("URL"),
      "https://api.acme.example/health",
    );
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    await chooseAuth(user, "bearer");
    await user.type(screen.getByLabelText("Token"), SECRET);
    await user.click(saveCreate());
    await screen.findByText("บันทึกไม่สำเร็จ ลองอีกครั้ง");
    expect(screen.getByLabelText("Token")).toHaveValue(SECRET);
    expect(findSecrets(rendered, [SECRET])).toEqual([]);
    // Positive control: the scan does see a controlled field's value attribute.
    expect(findSecrets(rendered, ["Payments API"])).toContain(
      "Payments API in markup",
    );
  });
});
