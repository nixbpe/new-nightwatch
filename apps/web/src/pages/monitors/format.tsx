import type {
  CHECK_FAILURE_REASONS,
  MonitorHealthReason,
} from "@nightwatch/api-contract";

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const timeFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const timeWithSecondsFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dateTimeFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatTimeWithSeconds(iso: string): string {
  return timeWithSecondsFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** Time of day for today, date and time otherwise, so yesterday never reads as today. */
export function formatTimeOrDate(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString()
    ? timeFormat.format(at)
    : dateTimeFormat.format(at);
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** A `<time>` element; the column header or status line names the timezone. */
export function Time({
  iso,
  format = formatTime,
}: {
  iso: string;
  format?: (iso: string) => string;
}) {
  return <time dateTime={iso}>{format(iso)}</time>;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return "ไม่ถึง 1 นาที";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0
      ? `${String(hours)} ชั่วโมง`
      : `${String(hours)} ชั่วโมง ${String(rest)} นาที`;
  }
  return `${String(Math.floor(hours / 24))} วัน`;
}

export const HEALTH_REASON_LABELS: Record<
  Exclude<MonitorHealthReason, null>,
  string
> = {
  never_checked: "รอตรวจครั้งแรก",
  stale: "ไม่มีผลใหม่",
  awaiting_new_config: "รอตรวจตามค่าใหม่",
  check_error: "ตรวจไม่ได้ (ปัญหาฝั่งระบบ)",
};

// Incident start reasons are check failure codes; end reasons are `recovered` or `paused_by_user`.
const INCIDENT_REASON_LABELS: Record<
  (typeof CHECK_FAILURE_REASONS)[number] | "recovered" | "paused_by_user",
  string
> = {
  http_status: "รหัสสถานะ HTTP ไม่ตรงเงื่อนไข",
  assertion_failed: "Assertion ไม่ผ่าน",
  timeout: "หมดเวลารอ",
  dns_not_found: "ไม่พบชื่อโดเมน",
  connect_refused: "ปฏิเสธการเชื่อมต่อ",
  connect_failed: "เชื่อมต่อไม่สำเร็จ",
  tls_invalid: "ใบรับรองไม่ถูกต้อง",
  blocked_address: "ที่อยู่ไม่อนุญาตให้ตรวจสอบ",
  redirect_blocked: "redirect ไปที่อยู่ต้องห้าม",
  redirect_limit: "redirect เกินกำหนด",
  body_read_failed: "อ่านเนื้อหาตอบกลับไม่สำเร็จ",
  secret_decrypt_failed: "ตรวจไม่ได้ (ปัญหาฝั่งระบบ)",
  internal_egress_failed: "ตรวจไม่ได้ (ปัญหาฝั่งระบบ)",
  resolver_unavailable: "ตรวจไม่ได้ (ปัญหาฝั่งระบบ)",
  executor_error: "ตรวจไม่ได้ (ปัญหาฝั่งระบบ)",
  recovered: "กลับมาปกติ",
  paused_by_user: "หยุดชั่วคราวโดยผู้ใช้",
};

export function incidentReasonLabel(reason: string): string {
  // `reason` is a free string on the wire; an unknown code gets the generic label.
  return (
    Object.entries(INCIDENT_REASON_LABELS).find(
      ([code]) => code === reason,
    )?.[1] ?? "ตรวจไม่ผ่าน"
  );
}
