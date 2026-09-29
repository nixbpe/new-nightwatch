import type {
  CheckAssertionResult,
  CheckResultView,
  Monitor,
} from "@nightwatch/api-contract";

/** The API opens an incident after this many consecutive failures (feature.md, Health model). */
export const DOWN_AFTER_FAILURES = 2;

export function intervalText(seconds: number): string {
  return seconds % 60 === 0
    ? `ทุก ${String(seconds / 60)} นาที`
    : `ทุก ${String(seconds)} วินาที`;
}

const TLS_REASON_LABELS: Record<string, string> = {
  expired: "หมดอายุ",
  hostname_mismatch: "ชื่อไม่ตรง",
  untrusted: "ไม่น่าเชื่อถือ",
  self_signed: "self-signed",
  handshake_failed: "เชื่อมต่อแบบปลอดภัยไม่สำเร็จ",
};

/** `reason` is a free string on the wire; an unknown code yields no detail rather than raw text. */
export function tlsReasonLabel(reason: string | null): string | null {
  return reason === null ? null : (TLS_REASON_LABELS[reason] ?? null);
}

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
};

export function assertionReasonLabel(
  reason: CheckAssertionResult["reason"],
): string | null {
  return reason === null ? null : ASSERTION_REASON_LABELS[reason];
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
