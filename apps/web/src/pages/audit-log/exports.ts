import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_EXPORT_MAX_EVENTS,
  type AuditActorOption,
  type AuditExportFailureCode,
  type AuditExportRecord,
  type AuditExportRequest,
} from "@nightwatch/api-contract";

import { createAuditExport } from "../../lib/api/audit-log";
import { ApiError } from "../../lib/api/client";
import {
  formatAuditDate,
  formatAuditTimestamp,
  type Preferences,
} from "../../lib/preferences";
import { isAuditDenied, type DeniedCode } from "./access";
import { personName } from "./labels";

export const EXPORT_TIMEOUT_MS = 15_000;
export const MY_EXPORTS_ID = "my-exports";

export const IN_PROGRESS_REASON =
  "สร้างไฟล์ส่งออกได้ครั้งละ 1 คำขอ รอให้ไฟล์ปัจจุบันเสร็จก่อน คำขอที่ยังไม่เสร็จภายใน 60 นาทีจะถือว่าล้มเหลว";
export const EMPTY_REASON = "ไม่มีรายการให้ส่งออกตามตัวกรองนี้";
export const REQUEST_FAILED_IN_DIALOG =
  "ส่งคำขอส่งออกไม่สำเร็จ ตัวเลือกของคุณยังอยู่ ลองใหม่อีกครั้ง";
export const PERMISSION_CHANGED =
  "สิทธิ์ส่งออกของคุณเปลี่ยนแล้ว คุณยังดูบันทึกกิจกรรมได้ แต่ส่งออกและดาวน์โหลดไฟล์ไม่ได้";

export function tooLargeText(total: number): string {
  return `ข้อมูลมากเกินไปสำหรับการส่งออกครั้งเดียว ลดช่วงเวลาแล้วลองใหม่ (พบ ${total.toLocaleString("en-US")} รายการ สูงสุด ${AUDIT_EXPORT_MAX_EVENTS.toLocaleString("en-US")})`;
}

export type ExportOutcome =
  | { kind: "created"; record: AuditExportRecord }
  | { kind: "too-large"; total: number }
  | { kind: "empty" }
  | { kind: "in-progress" }
  | { kind: "denied"; error: ApiError & { code: DeniedCode } }
  | { kind: "failed" };

/** POST with the 15 s timeout (N-4); every failure is sorted into what the UI shows. */
export async function submitExport(
  organizationId: string,
  body: AuditExportRequest,
): Promise<ExportOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, EXPORT_TIMEOUT_MS);
  try {
    const response = await createAuditExport(
      organizationId,
      body,
      controller.signal,
    );
    return { kind: "created", record: response.export };
  } catch (error) {
    if (isAuditDenied(error)) return { kind: "denied", error };
    if (error instanceof ApiError) {
      if (error.code === "AUDIT_EXPORT_IN_PROGRESS") {
        return { kind: "in-progress" };
      }
      if (error.code === "AUDIT_EXPORT_EMPTY") return { kind: "empty" };
      if (error.code === "AUDIT_EXPORT_TOO_LARGE") {
        const total = (error.details as { total?: unknown } | undefined)?.total;
        return {
          kind: "too-large",
          total: typeof total === "number" ? total : AUDIT_EXPORT_MAX_EVENTS,
        };
      }
    }
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** `ขอใหม่` reuses the row's absolute scope; only `asOf` is now (M-9). */
export function requestFromRecord(
  record: AuditExportRecord,
  now: Date,
): AuditExportRequest {
  const { filters } = record;
  return {
    format: record.format,
    timeZone: record.timeZone,
    filters: {
      from: filters.from,
      to: filters.to,
      ...(filters.categories.length > 0
        ? { categories: filters.categories }
        : {}),
      ...(filters.actorUserId === null
        ? {}
        : { actorUserId: filters.actorUserId }),
      ...(filters.q === null ? {} : { q: filters.q }),
    },
    asOf: now.toISOString(),
  };
}

export function rowRetryErrorText(outcome: ExportOutcome): string | null {
  switch (outcome.kind) {
    case "too-large":
      return tooLargeText(outcome.total);
    case "empty":
      return EMPTY_REASON;
    case "in-progress":
      return "สร้างไฟล์ส่งออกได้ครั้งละ 1 คำขอ รอให้ไฟล์ปัจจุบันเสร็จก่อน";
    case "failed":
      return "ส่งคำขอส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง";
    default:
      return null;
  }
}

export const FAILURE_TEXT: Record<AuditExportFailureCode, string> = {
  EXPORT_TOO_LARGE:
    "ไฟล์ใหญ่เกิน 25 MiB ขอใหม่ด้วยขอบเขตเดิมจะล้มเหลวอีก ลดช่วงเวลาหรือเพิ่มตัวกรองก่อน",
  EXPORT_FAILED: "สร้างไฟล์ไม่สำเร็จเพราะระบบขัดข้อง ขอใหม่ได้ด้วยขอบเขตเดิม",
  REQUESTER_NOT_AUTHORIZED:
    "สร้างไฟล์ไม่สำเร็จเพราะสิทธิ์ส่งออกของคุณเปลี่ยนระหว่างสร้าง",
};

/** Any other code reads as a system failure. */
export function failureText(code: AuditExportFailureCode | null): string {
  return FAILURE_TEXT[code ?? "EXPORT_FAILED"];
}

export const FORMAT_LABEL = { csv: "CSV", json: "JSON" } as const;

/** Name suffix of a row's buttons: format and request time to the minute (M-8). */
export function rowButtonSuffix(
  record: AuditExportRecord,
  preferences: Preferences,
): string {
  return `${FORMAT_LABEL[record.format]} ที่ขอเมื่อ ${formatAuditTimestamp(new Date(record.requestedAt), preferences).slice(0, 16)}`;
}

/** The scope of a row as text: range with zone, categories, actor and whether a search applied (never the text). */
export function scopeText(
  record: AuditExportRecord,
  preferences: Preferences,
  actors: readonly AuditActorOption[] | undefined,
): string {
  const { filters } = record;
  const parts = [
    `${formatAuditTimestamp(new Date(filters.from), preferences)} – ${formatAuditTimestamp(new Date(filters.to), preferences)} (${preferences.timeZone})`,
  ];
  if (filters.categories.length > 0) {
    parts.push(
      `หมวด ${filters.categories.map((category) => AUDIT_CATEGORY_LABELS[category]).join(", ")}`,
    );
  }
  if (filters.actorUserId !== null) {
    const actor = actors?.find((item) => item.userId === filters.actorUserId);
    parts.push(
      `ผู้ดำเนินการ ${actors === undefined ? "…" : actor === undefined ? "ไม่ใช่สมาชิกแล้ว" : personName(actor)}`,
    );
  }
  if (filters.q !== null) parts.push("มีการค้นหาข้อความ");
  return parts.join(" · ");
}

/** The list filters that `ปรับตัวกรอง` writes: whole days in the preference zone (N-3). */
export function adjustFilterSearch(
  record: AuditExportRecord,
  preferences: Preferences,
): URLSearchParams {
  const { filters } = record;
  const params = new URLSearchParams({
    range: "custom",
    from: formatAuditDate(new Date(filters.from), preferences),
    to: formatAuditDate(new Date(filters.to), preferences),
  });
  if (filters.categories.length > 0) {
    params.set("categories", filters.categories.join(","));
  }
  if (filters.actorUserId !== null) params.set("actor", filters.actorUserId);
  if (filters.q !== null) params.set("q", filters.q);
  return params;
}
