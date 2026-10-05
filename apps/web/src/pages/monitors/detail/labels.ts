import type {
  CheckAssertionResult,
  CheckResultView,
  Monitor,
  MonitorConfigChange,
  MonitorEventActor,
} from "@nightwatch/api-contract";

import { incidentReasonLabel } from "../format";

export const ORG_ALERTS_OFF_MESSAGE =
  "ปิด การแจ้งเตือนของมอนิเตอร์นี้จะไม่ทำงานจนกว่าจะเปิด ส่วนสถานะล่มและการนับเกณฑ์ล้มเหลวยังทำงานตามปกติ";

export function intervalText(seconds: number): string {
  return seconds % 60 === 0
    ? `ทุก ${String(seconds / 60)} นาที`
    : `ทุก ${String(seconds)} วินาที`;
}

const TLS_REASON_LABELS: Record<string, string> = {
  expired: "หมดอายุ",
  hostname_mismatch: "ชื่อไม่ตรง",
  untrusted: "ไม่น่าเชื่อถือ",
  self_signed: "ใบรับรองลงนามเอง",
  handshake_failed: "เชื่อมต่อแบบปลอดภัยไม่สำเร็จ",
};

/** `reason` is a free string on the wire; an unknown code yields no detail rather than raw text. */
export function tlsReasonLabel(reason: string | null): string | null {
  return reason === null ? null : (TLS_REASON_LABELS[reason] ?? null);
}

/** The cause line of a `tls_invalid` result: a handshake failure is not an invalid certificate. */
export function tlsFailureText(reason: string | null): string {
  if (reason === "handshake_failed") return "เชื่อมต่อแบบปลอดภัยไม่สำเร็จ";
  const label = tlsReasonLabel(reason);
  return label === null ? "ใบรับรองไม่ถูกต้อง" : `ใบรับรองไม่ถูกต้อง: ${label}`;
}

/** A truncated body was evaluated from its start (AC-33). */
export const EVALUATED_FROM_PREFIX_TEXT = "ประเมินจากส่วนต้นของ response";

const ASSERTION_REASON_LABELS: Record<
  NonNullable<CheckAssertionResult["reason"]>,
  string
> = {
  not_json: "เนื้อหาไม่ใช่ JSON",
  path_not_found: "ไม่พบ path",
  multiple_matches: "พบหลายค่า",
  type_mismatch: "ชนิดข้อมูลไม่ตรง",
  no_body: "ไม่มีเนื้อหาตอบกลับ",
  undecodable: "ถอดรหัสเนื้อหาไม่ได้",
  value_mismatch: "ค่าไม่ตรง",
  text_not_found: "ไม่พบข้อความ",
  too_slow: "ช้ากว่าที่กำหนด",
  no_response: "ไม่มี response",
  prefix_ended: "ประเมินไม่ได้: เนื้อหาถูกตัดก่อนถึงค่านี้",
};

export function assertionReasonLabel(
  reason: CheckAssertionResult["reason"],
  actualType: string | null = null,
): string | null {
  if (reason === null) return null;
  // A wrong type is only useful with the type that came back (AC-33).
  return reason === "type_mismatch" && actualType !== null
    ? `${ASSERTION_REASON_LABELS[reason]} (ค่าจริงเป็น ${actualType})`
    : ASSERTION_REASON_LABELS[reason];
}

export const ASSERTION_STATUS_LABELS: Record<
  CheckAssertionResult["status"],
  string
> = {
  pass: "ผ่าน",
  fail: "ไม่ผ่าน",
  not_evaluated: "ไม่ได้ประเมิน",
};

export const ASSERTION_KIND_LABELS: Record<
  CheckAssertionResult["kind"],
  string
> = {
  jsonPathEquals: "JSONPath เท่ากับ",
  bodyContains: "เนื้อหามีข้อความ",
  responseTimeBelow: "เวลาตอบสนองน้อยกว่า",
};

export const OUTCOME_LABELS: Record<CheckResultView["outcome"], string> = {
  pass: "ผ่าน",
  fail: "ล้มเหลว",
  check_error: "ตรวจไม่ได้",
};

/** Row wording for a whole check: "ไม่ผ่าน 1/3", "ไม่ได้ประเมิน 3/3" or "ผ่าน 3/3". */
export function assertionSummary(
  assertions: readonly CheckAssertionResult[],
): string | null {
  if (assertions.length === 0) return null;
  const count = (status: CheckAssertionResult["status"]) =>
    assertions.filter((item) => item.status === status).length;
  const total = String(assertions.length);
  const failed = count("fail");
  if (failed > 0) return `ไม่ผ่าน ${String(failed)}/${total}`;
  const skipped = count("not_evaluated");
  if (skipped > 0) return `ไม่ได้ประเมิน ${String(skipped)}/${total}`;
  return `ผ่าน ${total}/${total}`;
}

const AUTH_LABELS = {
  none: "ไม่ใช้",
  bearer: "Bearer token",
  basic: "Basic",
  apiKey: "API key header",
} as const;

export function authText(auth: Monitor["auth"]): string {
  return auth.type === "apiKey"
    ? `${AUTH_LABELS.apiKey} ${auth.headerName}`
    : AUTH_LABELS[auth.type];
}

/** Cause line of a failed check or an incident start; null when the reason is unknown. */
export function failureCauseText(
  reason: string | null,
  tlsReason: string | null = null,
): string | null {
  if (reason === null) return null;
  return reason === "tls_invalid"
    ? tlsFailureText(tlsReason)
    : incidentReasonLabel(reason);
}

/** Actor wording of a feed row; `unrecorded` (an event before #58) names nobody. */
export function eventActorText(actor: MonitorEventActor): string | null {
  switch (actor.kind) {
    case "member":
      return actor.displayName;
    case "member_hidden":
      return "สมาชิก";
    case "former_member":
      return "อดีตสมาชิก";
    case "deleted":
      return "ผู้ใช้ที่ถูกลบ";
    case "unrecorded":
      return null;
  }
}

export const SECRET_ACTION_LABELS: Record<
  Extract<MonitorConfigChange, { kind: "secret" }>["action"],
  string
> = {
  set: "ตั้งค่าแล้ว",
  replaced: "แทนที่ค่าใหม่",
  deleted: "ลบค่าแล้ว",
};

const CONFIG_FIELD_LABELS: Record<string, string> = {
  name: "ชื่อ",
  method: "เมธอด",
  url: "URL",
  expectedStatus: "รหัสสถานะที่ยอมรับ",
  intervalSeconds: "รอบการตรวจ (วินาที)",
  timeoutSeconds: "เวลารอสูงสุด (วินาที)",
  "auth.type": "ชนิดการยืนยันตัวตน",
  "auth.headerName": "ชื่อ API key header",
  "auth.token": "Bearer token",
  "auth.username": "ชื่อผู้ใช้ Basic",
  "auth.password": "รหัสผ่าน Basic",
  "auth.apiKey": "ค่า API key",
  body: "เนื้อหาคำขอ",
  assertions: "Assertions",
  "alerts.failureThreshold": "แจ้งเมื่อล้มเหลวติดกัน",
  "alerts.downEnabled": "แจ้งเมื่อล่มและกลับมาปกติ",
  "alerts.sslEnabled": "แจ้งเมื่อ SSL ใกล้หมดอายุ",
  "alerts.sslCautionDays": "แจ้งล่วงหน้าก่อน SSL หมดอายุ (วัน)",
};

const ENABLED_VALUE_FIELDS: ReadonlySet<string> = new Set([
  "alerts.downEnabled",
  "alerts.sslEnabled",
]);

export function configChangeValueText(
  field: string,
  value: string | number | null,
): string | number | null {
  if (!ENABLED_VALUE_FIELDS.has(field)) return value;
  if (value === "enabled") return "เปิด";
  if (value === "disabled") return "ปิด";
  return value;
}

/**
 * Label of a changed field. `headers.<name>` and `queryParams.<name>` carry the
 * name after the dot; `header.<id>` is a secret header slot, named from the
 * current config when it still exists (a deleted header has no name left).
 */
export function configFieldLabel(
  field: string,
  headerNameById: ReadonlyMap<string, string> = new Map(),
): string {
  const known = CONFIG_FIELD_LABELS[field];
  if (known !== undefined) return known;
  if (field.startsWith("headers.")) return `Header ${field.slice(8)}`;
  if (field.startsWith("queryParams.")) return `Query ${field.slice(12)}`;
  if (field.startsWith("header.")) {
    const name = headerNameById.get(field.slice(7));
    return name === undefined ? "ค่า header ลับ" : `ค่า header ลับ ${name}`;
  }
  return field;
}

export const EVENT_KIND_LABELS = {
  check_failed: "ตรวจล้มเหลว",
  incident_opened: "เริ่มล่ม",
  incident_closed_recovered: "กลับมาปกติ",
  incident_closed_paused: "สิ้นสุดเหตุการณ์ล่ม",
  paused: "หยุดชั่วคราว",
  resumed: "เริ่มตรวจต่อ",
  config_changed: "แก้ไขการตั้งค่า",
} as const;
