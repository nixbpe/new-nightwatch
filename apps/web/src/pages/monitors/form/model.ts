import {
  MONITOR_BODY_MAX_BYTES,
  MONITOR_DEFAULT_EXPECTED_STATUS,
  MONITOR_DEFAULT_INTERVAL_SECONDS,
  MONITOR_DEFAULT_TIMEOUT_SECONDS,
  MONITOR_MAX_ASSERTIONS,
  MONITOR_MAX_HEADERS,
  MONITOR_MAX_QUERY_PARAMS,
  MONITOR_NAME_MAX_LENGTH,
  MONITOR_ROW_NAME_MAX_LENGTH,
  MONITOR_TIMEOUT_MAX_SECONDS,
  MONITOR_TIMEOUT_MIN_SECONDS,
  MONITOR_URL_MAX_LENGTH,
  monitorConfigSchema,
  monitorInvalidErrorResponseSchema,
  monitorIssueReason,
  type MonitorConfigInput,
  type MonitorInvalidReason,
  type MonitorRecord,
} from "@nightwatch/api-contract";
import {
  createEntries,
  editEntries,
  keptSlots,
  placeSecretPath,
  secretFingerprint,
  secretIssues,
  type PlannedEntry,
} from "./secrets";
import type {
  MonitorCreateBody,
  MonitorEditBody,
  MonitorTestCreateBody,
  MonitorTestEditBody,
} from "../../../lib/api/monitors";

// Client validation runs the contract's own schema; the server stays the judge
// and its answer is placed with the same field paths.

export type MonitorMethod = MonitorRecord["method"];
export type MonitorAuth = MonitorRecord["auth"];
export type AssertionKind = MonitorRecord["assertions"][number]["kind"];

/** `key` identifies a row in the UI only; `id` is the payload id and is passed through untouched. */
export type HeaderRow = {
  key: string;
  id?: string;
  name: string;
  value: string;
  secret: boolean;
};
export type QueryRow = { key: string; name: string; value: string };
export type AssertionRow = {
  key: string;
  kind: AssertionKind;
  path: string;
  expected: string;
  text: string;
  ms: string;
};

export type FormValues = {
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutSeconds: string;
  method: MonitorMethod;
  headers: HeaderRow[];
  queryParams: QueryRow[];
  bodyType: "json" | "text";
  bodyContent: string;
  expectedStatus: string;
  assertions: AssertionRow[];
  auth: MonitorAuth;
  /** Stored secret slots whose replacement field is open on Edit; the typed values live in the secret store. */
  replacing: string[];
};

/** What Edit pins when it opens: the version to send and the secret slots to keep. */
export type EditBase = {
  version: number;
  secretSlots: string[];
  origin: string | null;
};

let rowCounter = 0;
export function nextRowKey(): string {
  rowCounter += 1;
  return `row-${String(rowCounter)}`;
}

export function emptyHeader(): HeaderRow {
  return { key: nextRowKey(), name: "", value: "", secret: false };
}
export function emptyQueryParam(): QueryRow {
  return { key: nextRowKey(), name: "", value: "" };
}
export function emptyAssertion(kind: AssertionKind): AssertionRow {
  return { key: nextRowKey(), kind, path: "", expected: "", text: "", ms: "" };
}

export function defaultValues(): FormValues {
  return {
    name: "",
    url: "",
    intervalSeconds: MONITOR_DEFAULT_INTERVAL_SECONDS,
    timeoutSeconds: String(MONITOR_DEFAULT_TIMEOUT_SECONDS),
    method: "GET",
    headers: [],
    queryParams: [],
    bodyType: "json",
    bodyContent: "",
    expectedStatus: MONITOR_DEFAULT_EXPECTED_STATUS,
    assertions: [],
    auth: { type: "none" },
    replacing: [],
  };
}

export function valuesFromRecord(record: MonitorRecord): FormValues {
  return {
    name: record.name,
    url: record.url,
    intervalSeconds: record.intervalSeconds,
    timeoutSeconds: String(record.timeoutSeconds),
    method: record.method,
    headers: record.headers.map((header) => ({
      key: nextRowKey(),
      ...(header.id === undefined ? {} : { id: header.id }),
      name: header.name,
      value: header.value ?? "",
      secret: header.secret,
    })),
    queryParams: record.queryParams.map((param) => ({
      key: nextRowKey(),
      name: param.name,
      value: param.value,
    })),
    bodyType: record.body?.type ?? "json",
    bodyContent: record.body?.content ?? "",
    expectedStatus: record.expectedStatus,
    assertions: record.assertions.map((assertion) => ({
      ...emptyAssertion(assertion.kind),
      ...(assertion.kind === "jsonPathEquals"
        ? { path: assertion.path, expected: assertion.expected }
        : assertion.kind === "bodyContains"
          ? { text: assertion.text }
          : { ms: String(assertion.ms) }),
    })),
    auth: record.auth,
    replacing: [],
  };
}

function originOf(url: string): string | null {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

export function editBaseFromRecord(record: MonitorRecord): EditBase {
  return {
    version: record.version,
    secretSlots: record.secretSlots.map((item) => item.slot),
    origin: originOf(record.url),
  };
}

/** A kept secret is sent to the stored origin only (AC-44); the server answers 422 otherwise. */
export function secretOriginChanged(
  base: EditBase | null,
  values: FormValues,
): boolean {
  if (base === null || base.origin === null) return false;
  if (keptSlots(values, base).length === 0) return false;
  const next = originOf(values.url);
  return next !== null && next !== base.origin;
}

/** Settings of the advanced mode that are not at their default, so hiding them never hides an effect. */
export function advancedCount(values: FormValues): number {
  return (
    (values.method === "GET" ? 0 : 1) +
    (values.timeoutSeconds.trim() === String(MONITOR_DEFAULT_TIMEOUT_SECONDS)
      ? 0
      : 1) +
    values.headers.length +
    values.queryParams.length +
    (values.bodyContent === "" ? 0 : 1) +
    (values.expectedStatus.trim() === MONITOR_DEFAULT_EXPECTED_STATUS ? 0 : 1) +
    values.assertions.length +
    (values.auth.type === "none" ? 0 : 1)
  );
}

function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

export function configInput(values: FormValues): MonitorConfigInput {
  return {
    name: values.name,
    url: values.url,
    intervalSeconds: values.intervalSeconds,
    timeoutSeconds: numberOf(values.timeoutSeconds),
    method: values.method,
    headers: values.headers.map((header) => ({
      ...(header.id === undefined ? {} : { id: header.id }),
      name: header.name,
      // A secret header never carries a value from here: its slot is kept server-side.
      ...(header.secret ? {} : { value: header.value }),
      secret: header.secret,
    })),
    queryParams: values.queryParams.map((param) => ({
      name: param.name,
      value: param.value,
    })),
    body:
      values.bodyContent === ""
        ? null
        : { type: values.bodyType, content: values.bodyContent },
    expectedStatus: values.expectedStatus,
    assertions: values.assertions.map((assertion) =>
      assertion.kind === "jsonPathEquals"
        ? {
            kind: assertion.kind,
            path: assertion.path,
            expected: assertion.expected,
          }
        : assertion.kind === "bodyContains"
          ? { kind: assertion.kind, text: assertion.text }
          : { kind: assertion.kind, ms: numberOf(assertion.ms) },
    ),
    auth: values.auth,
  };
}

export function createPayload(
  values: FormValues,
  clientRequestId: string,
  entries: PlannedEntry[],
): MonitorCreateBody {
  return {
    ...configInput(values),
    clientRequestId,
    secrets: createEntries(entries),
  };
}

export function editPayload(
  values: FormValues,
  base: EditBase,
  entries: PlannedEntry[],
): MonitorEditBody {
  return {
    ...configInput(values),
    expectedVersion: base.version,
    secrets: editEntries(entries),
  };
}

export function testCreatePayload(
  values: FormValues,
  entries: PlannedEntry[],
): MonitorTestCreateBody {
  return { ...configInput(values), secrets: createEntries(entries) };
}

export function testEditPayload(
  values: FormValues,
  entries: PlannedEntry[],
): MonitorTestEditBody {
  return { ...configInput(values), secrets: editEntries(entries) };
}

/** The Test panel's copy of what was sent: the configuration and a value-free stamp of the secrets. */
export type TestSnapshot = MonitorConfigInput & { secretStamp: string };

export function testSnapshot(
  values: FormValues,
  entries: PlannedEntry[],
  revision: (slot: string) => number,
): TestSnapshot {
  return {
    ...configInput(values),
    secretStamp: secretFingerprint(entries, revision),
  };
}

// ---- Errors -------------------------------------------------------------------

/** Field path (`headers.2.name`) to the message shown beside that field. */
export type FieldErrors = Record<string, string>;

const number = (value: number) => value.toLocaleString("en-US");

export const URL_BLOCKED_MESSAGE =
  "ที่อยู่นี้ไม่อนุญาตให้ตรวจสอบ (เช่น localhost หรือที่อยู่ภายในเครือข่าย) ใช้ที่อยู่สาธารณะแทน";
export const SECRET_ORIGIN_MESSAGE =
  "เปลี่ยนที่อยู่ปลายทาง ต้องกรอกค่าลับใหม่หรือลบค่าลับเดิม";

const GENERIC: Record<MonitorInvalidReason, string> = {
  required: "กรอกข้อมูลช่องนี้",
  too_long: "ยาวเกินกำหนด",
  invalid_format: "รูปแบบไม่ถูกต้อง",
  blocked_scheme: "ใช้ได้เฉพาะ http หรือ https",
  embedded_credentials: "ห้ามมีชื่อผู้ใช้หรือรหัสผ่านฝังอยู่",
  blocked_port: "พอร์ตนี้ไม่อนุญาต",
  blocked_header: "ชื่อ header นี้ไม่อนุญาตให้ตั้ง",
  duplicate: "ซ้ำกับรายการอื่น",
  crlf: "ห้ามมีการขึ้นบรรทัดใหม่",
  auth_header_conflict: "ชื่อนี้ชนกับ header ของการยืนยันตัวตน",
  invalid_json: "JSON ไม่ถูกต้อง",
  invalid_jsonpath: "JSONPath ไม่ถูกต้อง",
  body_assertion_with_head: "เงื่อนไขนี้ต้องใช้เนื้อหา ใช้กับ HEAD ไม่ได้",
  out_of_range: "ค่าอยู่นอกช่วงที่กำหนด",
  too_many: "จำนวนแถวเกินกำหนด",
};

const timeoutMessage = `กรอกจำนวนเต็ม ${String(MONITOR_TIMEOUT_MIN_SECONDS)} ถึง ${String(MONITOR_TIMEOUT_MAX_SECONDS)} วินาที`;
const jsonPathMessages: Partial<Record<MonitorInvalidReason, string>> = {
  required: "กรอก JSONPath เช่น $.status",
  invalid_jsonpath:
    "รองรับเฉพาะ $, .name, ['name'] และ [index] (ไม่รองรับ filter, wildcard และ recursive descent)",
  too_many: "JSONPath ยาวเกินกำหนด",
  too_long: "JSONPath ยาวเกินกำหนด",
};

// Keyed by the field path with row indices replaced by `#`.
const FIELD_MESSAGES: Record<
  string,
  Partial<Record<MonitorInvalidReason, string>>
> = {
  name: {
    required: "กรอกชื่อมอนิเตอร์",
    too_long: `ชื่อยาวได้ไม่เกิน ${String(MONITOR_NAME_MAX_LENGTH)} ตัวอักษร`,
  },
  url: {
    required: "กรอก URL",
    too_long: `URL ยาวได้ไม่เกิน ${number(MONITOR_URL_MAX_LENGTH)} ตัวอักษร`,
    invalid_format: "URL ไม่ถูกต้อง ตัวอย่าง https://example.com/health",
    blocked_scheme: "ใช้ได้เฉพาะ http หรือ https",
    embedded_credentials:
      "URL ห้ามมีชื่อผู้ใช้หรือรหัสผ่านฝังอยู่ ใช้ header ยืนยันตัวตนแทน",
    blocked_port: "ใช้ได้เฉพาะพอร์ต 80, 443 และ 1024-65535",
  },
  intervalSeconds: { out_of_range: "เลือกรอบตรวจ 1, 5 หรือ 15 นาที" },
  timeoutSeconds: {
    required: timeoutMessage,
    invalid_format: timeoutMessage,
    out_of_range: timeoutMessage,
  },
  method: { invalid_format: "เลือก method ที่มีในรายการ" },
  expectedStatus: {
    required: "กรอกรหัสสถานะ เช่น 200-299,301",
    invalid_format:
      "รูปแบบเป็น 200-299,301 (รหัสเดี่ยวหรือช่วง คั่นด้วยจุลภาค)",
    out_of_range:
      "รหัสสถานะต้องอยู่ระหว่าง 100 ถึง 599 และช่วงต้องเรียงจากน้อยไปมาก",
    too_many: "ระบุได้ไม่เกิน 10 ช่วงหรือรหัส",
    too_long: "ยาวเกินกำหนด",
  },
  "headers.#.name": {
    required: "กรอกชื่อ header",
    too_long: `ชื่อยาวได้ไม่เกิน ${String(MONITOR_ROW_NAME_MAX_LENGTH)} ตัวอักษร`,
    invalid_format: "ชื่อ header ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และ - _ .",
    blocked_header: "ชื่อ header นี้ระบบตั้งเอง ตั้งเองไม่ได้",
    duplicate: "ชื่อ header ซ้ำกับแถวอื่น",
    auth_header_conflict: "ชื่อนี้ชนกับ header ของการยืนยันตัวตน",
  },
  "headers.#.value": {
    required: "กรอกค่า header",
    too_long: "ค่ายาวได้ไม่เกิน 4 KiB",
    crlf: "ค่า header ห้ามมีการขึ้นบรรทัดใหม่",
    invalid_format: "ค่ามีอักขระที่ใช้ไม่ได้",
  },
  headers: {
    too_many: `เพิ่ม header ได้ไม่เกิน ${String(MONITOR_MAX_HEADERS)} แถว`,
  },
  "queryParams.#.name": {
    required: "กรอกชื่อ query param",
    too_long: `ชื่อยาวได้ไม่เกิน ${String(MONITOR_ROW_NAME_MAX_LENGTH)} ตัวอักษร`,
    invalid_format: "ชื่อมีอักขระที่ใช้ไม่ได้",
  },
  "queryParams.#.value": {
    too_long: "ค่ายาวได้ไม่เกิน 4 KiB",
    invalid_format: "ค่ามีอักขระที่ใช้ไม่ได้",
  },
  queryParams: {
    too_many: `เพิ่ม query param ได้ไม่เกิน ${String(MONITOR_MAX_QUERY_PARAMS)} แถว`,
  },
  "body.content": {
    too_long: `Body ใหญ่ได้ไม่เกิน ${String(MONITOR_BODY_MAX_BYTES / 1024)} KiB`,
    invalid_json: "JSON ไม่ถูกต้อง ตรวจวงเล็บ เครื่องหมายคำพูด และจุลภาค",
    invalid_format: "Body มีอักขระที่ใช้ไม่ได้",
  },
  "assertions.#.kind": {
    body_assertion_with_head:
      "เงื่อนไขนี้ต้องใช้เนื้อหาตอบกลับ ใช้กับ method HEAD ไม่ได้",
  },
  "assertions.#.path": jsonPathMessages,
  "assertions.#.expected": {
    required: "กรอกค่าที่คาดหวัง",
    too_long: "ค่ายาวได้ไม่เกิน 4 KiB",
    invalid_format: "ค่ามีอักขระที่ใช้ไม่ได้",
  },
  "assertions.#.text": {
    required: "กรอกข้อความที่ต้องมีในเนื้อหา",
    too_long: "ข้อความยาวได้ไม่เกิน 4 KiB",
    invalid_format: "ข้อความมีอักขระที่ใช้ไม่ได้",
  },
  "assertions.#.ms": {
    required: "กรอกเวลาเป็นมิลลิวินาที",
    invalid_format: "กรอกจำนวนเต็มมิลลิวินาที",
    out_of_range: "ต้องอยู่ระหว่าง 1 ms ถึงเวลารอสูงสุด (timeout)",
  },
  auth: { required: "กรอกค่าลับของการยืนยันตัวตนให้ครบ" },
  "auth.headerName": {
    required: "กรอกชื่อ header ของ API key",
    invalid_format: "ชื่อ header ไม่ถูกต้อง",
    blocked_header: "ชื่อ header นี้ระบบตั้งเอง ตั้งเองไม่ได้",
  },
  "secrets.#": { required: "ไม่พบค่าลับที่เก็บไว้ของรายการนี้" },
  "secrets.#.slot": {
    invalid_format: "ค่าลับนี้ไม่ตรงกับการตั้งค่าปัจจุบัน",
    duplicate: "ค่าลับนี้ถูกระบุซ้ำ",
    required: "ค่าลับนี้ยังจำเป็นต้องใช้ ลบไม่ได้",
  },
  "secrets.#.value": {
    required: "ยังไม่ได้กรอกค่าลับ",
    too_long: "ค่าลับยาวได้ไม่เกิน 4 KiB",
    crlf: "ค่าลับห้ามมีการขึ้นบรรทัดใหม่",
    invalid_format: "ค่าลับมีอักขระที่ใช้ไม่ได้",
  },
  assertions: {
    too_many: `เพิ่มเงื่อนไขได้ไม่เกิน ${String(MONITOR_MAX_ASSERTIONS)} ข้อ`,
  },
};

export function fieldMessage(
  field: string,
  reason: MonitorInvalidReason,
): string {
  const kind = field.replace(/\.\d+(?=\.|$)/g, ".#").replace(/\.#$/, "");
  return FIELD_MESSAGES[kind]?.[reason] ?? GENERIC[reason];
}

function issuesToErrors(
  reasons: { field: string; reason: MonitorInvalidReason }[],
  /** The array of secret entries the request carried, to place `secrets.N` at its slot's input. */
  sent: readonly { slot: string; path: string }[] = [],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const { field, reason } of reasons) {
    errors[placeSecretPath(field, sent)] ??= fieldMessage(field, reason);
  }
  return errors;
}

/** What the secret checks read: the stored slots and the values typed so far. */
export type SecretContext = {
  base: EditBase | null;
  get: (slot: string) => string;
};

/** Client validation with the contract schema: same paths and reasons the server reports. */
export function validateValues(
  values: FormValues,
  secrets: SecretContext,
): FieldErrors {
  const config = configInput(values);
  const errors: FieldErrors = {};
  const parsed = monitorConfigSchema.safeParse(config);
  if (!parsed.success) {
    Object.assign(
      errors,
      issuesToErrors(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          reason: monitorIssueReason(issue),
        })),
      ),
    );
  }
  for (const issue of secretIssues(values, secrets.base, secrets.get, config)) {
    errors[issue.path] ??=
      issue.message ?? fieldMessage(issue.entryPath, issue.reason);
  }
  return errors;
}

/** `MONITOR_INVALID` details of an API error, placed like client errors. */
export function serverFieldErrors(
  details: unknown,
  sent?: readonly { slot: string; path: string }[],
): FieldErrors | null {
  const parsed =
    monitorInvalidErrorResponseSchema.shape.error.shape.details.safeParse(
      details,
    );
  return parsed.success ? issuesToErrors(parsed.data.fields, sent) : null;
}

export const ADVANCED_ONLY_PATH =
  /^(timeoutSeconds|method|expectedStatus|body|auth|headers|queryParams|assertions)(\.|$)/;

const PLACEABLE_PATH =
  /^(name|url|intervalSeconds|timeoutSeconds|method|expectedStatus|body\.content|headers|queryParams|assertions|auth|auth\.(headerName|token|username|password|apiKey)|headers\.\d+\.(name|value)|queryParams\.\d+\.(name|value)|assertions\.\d+\.(kind|path|expected|text|ms))$/;

/** What a message with no control of its own is about, so the summary points at it. */
function unplacedMessage(
  path: string,
  message: string,
  values: FormValues,
): string {
  if (path === "request") return "ค่าที่กรอกไม่ถูกต้อง ตรวจสอบและลองอีกครั้ง";
  const row = /^headers\.(\d+)(?:\.|$)/.exec(path);
  if (row?.[1] !== undefined) {
    const index = Number(row[1]);
    const name = values.headers[index]?.name ?? "";
    return `header ${name} (แถวที่ ${String(index + 1)}): ${message}`;
  }
  if (path === "auth" || path.startsWith("auth.")) {
    return `การยืนยันตัวตน: ${message}`;
  }
  if (path.startsWith("secrets")) return `ค่าลับ: ${message}`;
  return message;
}

/** Splits errors into those that have a control to sit beside and the rest (listed above the buttons). */
export function placeErrors(
  errors: FieldErrors,
  values: FormValues,
): { placed: FieldErrors; unplaced: string[] } {
  const placed: FieldErrors = {};
  const unplaced: string[] = [];
  for (const [path, message] of Object.entries(errors)) {
    if (PLACEABLE_PATH.test(path)) placed[path] = message;
    else unplaced.push(unplacedMessage(path, message, values));
  }
  return { placed, unplaced };
}

export function errorId(path: string): string {
  return `monitor-form-${path.replaceAll(".", "-")}-error`;
}
export function fieldId(path: string): string {
  return `monitor-form-${path.replaceAll(".", "-")}`;
}
