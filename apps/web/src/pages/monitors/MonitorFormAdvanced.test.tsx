import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMeContext } from "../../lib/api/me";
import {
  createMonitor,
  fetchMonitorDetail,
  fetchMonitorList,
} from "../../lib/api/monitors";
import {
  context,
  detail,
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
  fetchMonitorDetail: vi.fn(),
  fetchMonitorList: vi.fn(),
}));

const createMock = vi.mocked(createMonitor);

beforeEach(() => {
  vi.mocked(fetchMeContext).mockResolvedValue(context());
  vi.mocked(fetchMonitorList).mockResolvedValue({
    summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
    monitors: [],
    page: { limit: 25, offset: 0, total: 0 },
    dataAsOf: "2026-09-30T07:32:05.000Z",
  });
  vi.mocked(fetchMonitorDetail).mockResolvedValue({ monitor: detail() });
  createMock.mockResolvedValue({ monitor: record() });
});

afterEach(() => {
  vi.resetAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

async function openAdvanced() {
  const user = userEvent.setup();
  renderForm(newPath());
  await screen.findByLabelText("ชื่อมอนิเตอร์");
  await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
  return user;
}

async function fillBasic(user: User) {
  await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "Payments API");
  await user.type(
    screen.getByLabelText("URL"),
    "https://api.acme.example/health",
  );
}

const save = () => screen.getByRole("button", { name: "บันทึกมอนิเตอร์" });
const setValue = (element: HTMLElement, value: string) => {
  fireEvent.change(element, { target: { value } });
};

describe("Advanced mode defaults and mode switch", () => {
  it("offers method, timeout and expected status with the defaults", async () => {
    await openAdvanced();
    expect(screen.getByLabelText("Method")).toHaveValue("GET");
    expect(screen.getByLabelText("หมดเวลารอ (วินาที)")).toHaveValue("10");
    expect(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ")).toHaveValue(
      "200-299",
    );
  });

  it("keeps advanced values when switching to basic and counts what is still in use", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    await user.selectOptions(screen.getByLabelText("Method"), "POST");
    await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 1"), "X-Team");
    await user.type(screen.getByLabelText("ค่า header แถวที่ 1"), "core");
    await user.click(screen.getByRole("button", { name: "เพิ่ม query param" }));
    await user.click(screen.getByRole("radio", { name: "พื้นฐาน" }));
    expect(
      screen.getByText("มีการตั้งค่าขั้นสูง 3 รายการที่ยังใช้งานอยู่"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Method")).toBeNull();
    await user.click(screen.getByRole("button", { name: "ดูในโหมดขั้นสูง" }));
    expect(screen.getByLabelText("Method")).toHaveValue("POST");
    expect(screen.getByLabelText("ชื่อ header แถวที่ 1")).toHaveValue("X-Team");
    // The values still apply while the mode is basic.
    await user.click(screen.getByRole("radio", { name: "พื้นฐาน" }));
    await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), " 2");
    await user.click(screen.getByRole("radio", { name: "ขั้นสูง" }));
    await user.click(
      screen.getByRole("button", { name: "ลบ query param แถวที่ 1" }),
    );
    await user.click(save());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      name: "Payments API 2",
      method: "POST",
      headers: [{ name: "X-Team", value: "core", secret: false }],
      queryParams: [],
    });
  });

  it("sends each advanced field of the config", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByLabelText("หมดเวลารอ (วินาที)"), "5");
    setValue(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ"), "200-299,301");
    await user.selectOptions(screen.getByLabelText("Method"), "POST");
    await user.click(screen.getByRole("button", { name: "เพิ่ม query param" }));
    await user.type(screen.getByLabelText("ชื่อ query param แถวที่ 1"), "page");
    await user.type(screen.getByLabelText("ค่า query param แถวที่ 1"), "2");
    setValue(screen.getByLabelText("เนื้อหา"), '{"a":1}');
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.type(screen.getByLabelText("JSONPath แถวที่ 1"), "$.status");
    await user.type(screen.getByLabelText("ค่าที่คาดหวังแถวที่ 1"), '"ok"');
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.selectOptions(
      screen.getByLabelText("ชนิดเงื่อนไขแถวที่ 2"),
      "bodyContains",
    );
    await user.type(screen.getByLabelText("ข้อความที่ต้องมีแถวที่ 2"), "ready");
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.selectOptions(
      screen.getByLabelText("ชนิดเงื่อนไขแถวที่ 3"),
      "responseTimeBelow",
    );
    await user.type(
      screen.getByLabelText("เวลาตอบสนองน้อยกว่าแถวที่ 3 (มิลลิวินาที)"),
      "800",
    );
    await user.click(save());
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({
      timeoutSeconds: 5,
      method: "POST",
      expectedStatus: "200-299,301",
      queryParams: [{ name: "page", value: "2" }],
      body: { type: "json", content: '{"a":1}' },
      assertions: [
        { kind: "jsonPathEquals", path: "$.status", expected: '"ok"' },
        { kind: "bodyContains", text: "ready" },
        { kind: "responseTimeBelow", ms: 800 },
      ],
    });
  });
});

describe("Advanced validation beside the field", () => {
  async function submitInvalid(user: User) {
    await user.click(save());
    expect(createMock).not.toHaveBeenCalled();
  }

  it.each([
    ["ftp://example.com", "ใช้ได้เฉพาะ http หรือ https"],
    ["https://user:pw@example.com", /ห้ามมีชื่อผู้ใช้หรือรหัสผ่าน/],
    ["https://example.com:22", /พอร์ต 80, 443 และ 1024-65535/],
    ["not a url", /URL ไม่ถูกต้อง/],
    [`https://example.com/${"a".repeat(2100)}`, /ยาวได้ไม่เกิน 2,048/],
  ])("explains URL %#", async (url, message) => {
    const user = await openAdvanced();
    await user.type(screen.getByLabelText("ชื่อมอนิเตอร์"), "x");
    setValue(screen.getByLabelText("URL"), url);
    await submitInvalid(user);
    const field = screen.getByLabelText("URL");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      message instanceof RegExp ? message : expect.stringContaining(message),
    );
    expect(field).toHaveFocus();
  });

  it("rejects a forbidden header name, a duplicate and a bad name beside their rows", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByRole("button", { name: "เพิ่ม header" }));
    }
    setValue(screen.getByLabelText("ชื่อ header แถวที่ 1"), "Host");
    setValue(screen.getByLabelText("ค่า header แถวที่ 1"), "x");
    setValue(screen.getByLabelText("ชื่อ header แถวที่ 2"), "X-A");
    setValue(screen.getByLabelText("ค่า header แถวที่ 2"), "x");
    setValue(screen.getByLabelText("ชื่อ header แถวที่ 3"), "x-a");
    setValue(screen.getByLabelText("ค่า header แถวที่ 3"), "x");
    await submitInvalid(user);
    expect(
      screen.getByLabelText("ชื่อ header แถวที่ 1"),
    ).toHaveAccessibleDescription(/ระบบตั้งเอง/);
    expect(
      screen.getByLabelText("ชื่อ header แถวที่ 3"),
    ).toHaveAccessibleDescription("ชื่อ header ซ้ำกับแถวอื่น");
    expect(screen.getByLabelText("ชื่อ header แถวที่ 1")).toHaveFocus();
    setValue(screen.getByLabelText("ชื่อ header แถวที่ 2"), "bad name");
    await user.click(save());
    expect(
      screen.getByLabelText("ชื่อ header แถวที่ 2"),
    ).toHaveAccessibleDescription(/ตัวอักษรอังกฤษ/);
  });

  it("rejects invalid JSON, an oversized body and a body assertion with HEAD", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByLabelText("เนื้อหา"), "{not json");
    await submitInvalid(user);
    expect(screen.getByLabelText("เนื้อหา")).toHaveAccessibleDescription(
      /JSON ไม่ถูกต้อง/,
    );
    setValue(screen.getByLabelText("เนื้อหา"), "a".repeat(64 * 1024 + 1));
    await user.selectOptions(
      screen.getByLabelText("ชนิด", { selector: "#monitor-form-bodyType" }),
      "text",
    );
    await user.click(save());
    expect(screen.getByLabelText("เนื้อหา")).toHaveAccessibleDescription(
      "Body ใหญ่ได้ไม่เกิน 64 KiB",
    );
    setValue(screen.getByLabelText("เนื้อหา"), "");
    await user.selectOptions(screen.getByLabelText("Method"), "HEAD");
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.selectOptions(
      screen.getByLabelText("ชนิดเงื่อนไขแถวที่ 1"),
      "bodyContains",
    );
    await user.type(screen.getByLabelText("ข้อความที่ต้องมีแถวที่ 1"), "ok");
    await user.click(save());
    expect(
      screen.getByLabelText("ชนิดเงื่อนไขแถวที่ 1"),
    ).toHaveAccessibleDescription(/ใช้กับ method HEAD ไม่ได้/);
  });

  it("rejects a JSONPath with a filter, wildcard or recursive descent", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.type(screen.getByLabelText("ค่าที่คาดหวังแถวที่ 1"), "1");
    for (const path of [
      "$.items[?(@.id==1)]",
      "$.items[*]",
      "$..id",
      "status",
    ]) {
      setValue(screen.getByLabelText("JSONPath แถวที่ 1"), path);
      await user.click(save());
      expect(
        screen.getByLabelText("JSONPath แถวที่ 1"),
      ).toHaveAccessibleDescription(/รองรับเฉพาะ \$, \.name/);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an expected status, timeout and threshold outside their limits", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ"), "700");
    setValue(screen.getByLabelText("หมดเวลารอ (วินาที)"), "31");
    await user.click(screen.getByRole("button", { name: "เพิ่มเงื่อนไข" }));
    await user.selectOptions(
      screen.getByLabelText("ชนิดเงื่อนไขแถวที่ 1"),
      "responseTimeBelow",
    );
    setValue(
      screen.getByLabelText("เวลาตอบสนองน้อยกว่าแถวที่ 1 (มิลลิวินาที)"),
      "40000",
    );
    await submitInvalid(user);
    expect(
      screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ"),
    ).toHaveAccessibleDescription(/ระหว่าง 100 ถึง 599/);
    expect(
      screen.getByLabelText("หมดเวลารอ (วินาที)"),
    ).toHaveAccessibleDescription(/1 ถึง 30 วินาที/);
    expect(
      screen.getByLabelText("เวลาตอบสนองน้อยกว่าแถวที่ 1 (มิลลิวินาที)"),
    ).toHaveAccessibleDescription(/ระหว่าง 1 ms/);
    // The first invalid field in page order takes focus (the timeout sits above the status).
    expect(screen.getByLabelText("หมดเวลารอ (วินาที)")).toHaveFocus();
  });

  it("opens advanced mode to focus an invalid advanced field while the form is in basic mode", async () => {
    const user = await openAdvanced();
    await fillBasic(user);
    setValue(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ"), "9");
    await user.click(screen.getByRole("radio", { name: "พื้นฐาน" }));
    await user.click(save());
    expect(screen.getByRole("radio", { name: "ขั้นสูง" })).toBeChecked();
    expect(screen.getByLabelText("รหัสสถานะที่ถือว่าปกติ")).toHaveFocus();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("Rows", () => {
  it("names each row, focuses the new row and moves focus after a removal", async () => {
    const user = await openAdvanced();
    const add = screen.getByRole("button", { name: "เพิ่ม header" });
    await user.click(add);
    expect(screen.getByLabelText("ชื่อ header แถวที่ 1")).toHaveFocus();
    await user.click(add);
    await user.click(add);
    expect(screen.getByLabelText("ชื่อ header แถวที่ 3")).toHaveFocus();
    await user.type(screen.getByLabelText("ชื่อ header แถวที่ 3"), "X-Third");
    await user.click(
      screen.getByRole("button", { name: "ลบ header แถวที่ 2" }),
    );
    // The former row 3 is now row 2 and takes the focus.
    expect(screen.getByLabelText("ชื่อ header แถวที่ 2")).toHaveValue(
      "X-Third",
    );
    expect(screen.getByLabelText("ชื่อ header แถวที่ 2")).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "ลบ header แถวที่ 2" }),
    );
    expect(add).toHaveFocus();
  });

  it("limits headers to 20, query params to 20 and assertions to 10 with a message beside the button", async () => {
    const user = await openAdvanced();
    const addHeader = screen.getByRole("button", { name: "เพิ่ม header" });
    for (let i = 0; i < 21; i += 1) await user.click(addHeader);
    expect(
      screen.getAllByRole("group", { name: /^Header แถวที่/ }),
    ).toHaveLength(20);
    expect(addHeader).toHaveAccessibleDescription(
      "เพิ่ม header ได้ไม่เกิน 20 แถว",
    );
    const addParam = screen.getByRole("button", { name: "เพิ่ม query param" });
    for (let i = 0; i < 21; i += 1) await user.click(addParam);
    expect(
      screen.getAllByRole("group", { name: /^Query param แถวที่/ }),
    ).toHaveLength(20);
    expect(addParam).toHaveAccessibleDescription(
      "เพิ่ม query param ได้ไม่เกิน 20 แถว",
    );
    const addAssertion = screen.getByRole("button", { name: "เพิ่มเงื่อนไข" });
    for (let i = 0; i < 11; i += 1) await user.click(addAssertion);
    expect(
      screen.getAllByRole("group", { name: /^เงื่อนไขแถวที่/ }),
    ).toHaveLength(10);
    expect(addAssertion).toHaveAccessibleDescription(
      "เพิ่มเงื่อนไขได้ไม่เกิน 10 ข้อ",
    );
  });
});

describe("Permanent warnings and notes", () => {
  it("keeps the visibility warning under query params and body", async () => {
    await openAdvanced();
    expect(
      screen.getAllByText(
        "ผู้ที่ดูมอนิเตอร์เห็นค่านี้ได้ ห้ามใส่ความลับ ใช้ header ลับแทน",
      ),
    ).toHaveLength(2);
  });

  it("notes that GET and HEAD send no body", async () => {
    const user = await openAdvanced();
    expect(screen.getByText("method GET ไม่ส่ง body")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Method"), "POST");
    expect(screen.queryByText(/ไม่ส่ง body/)).toBeNull();
    await user.selectOptions(screen.getByLabelText("Method"), "HEAD");
    expect(screen.getByText("method HEAD ไม่ส่ง body")).toBeInTheDocument();
  });
});
