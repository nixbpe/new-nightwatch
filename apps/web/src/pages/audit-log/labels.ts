import type {
  AuditActor,
  AuditActorOption,
  AuditChange,
  AuditChangeField,
  AuditTarget,
  AuditValue,
} from "@nightwatch/api-contract";

import { ROLE_LABELS } from "../../lib/roles";

// OD-10: a former member's name is never shown.
export const FORMER_MEMBER = "ไม่ใช่สมาชิกแล้ว";

export function personName(person: AuditActor | AuditActorOption): string {
  return person.membership === "former" || person.displayName === null
    ? FORMER_MEMBER
    : person.displayName;
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function actorText(actor: AuditActor): string {
  return `${personName(actor)} (${roleLabel(actor.roleAtTime)})`;
}

export function exportTargetText(format: "csv" | "json"): string {
  return `ไฟล์ส่งออก ${format.toUpperCase()}`;
}

/** The target as plain text; links are added by the detail page. */
export function targetText(target: AuditTarget): string {
  switch (target.type) {
    case "monitor":
      return target.deleted || target.displayName === null
        ? "ถูกลบแล้ว"
        : target.displayName;
    case "member":
      return personName(target);
    case "invitation":
      return `คำเชิญ ${roleLabel(target.role)}`;
    case "notification_settings":
      return "ตั้งค่าการแจ้งเตือน";
    case "audit_export":
      return exportTargetText(target.format);
  }
}

// feature.md and spec.md give no labels for the change fields; these are the web's wording.
export const CHANGE_FIELD_LABELS: Record<AuditChangeField, string> = {
  role: "บทบาท",
  monitorAlertsEnabled: "แจ้งเตือนมอนิเตอร์",
  settingsChangedEnabled: "แจ้งเตือนเมื่อการตั้งค่าเปลี่ยน",
  name: "ชื่อ",
  url: "URL",
  method: "เมธอด",
  intervalSeconds: "ช่วงตรวจสอบ (วินาที)",
  timeoutSeconds: "Timeout (วินาที)",
  header: "Header",
  queryParam: "Query parameter",
  body: "Body",
  authType: "การยืนยันตัวตน",
  apiKeyHeaderName: "ชื่อ header ของ API key",
  expectedStatus: "สถานะที่คาดหวัง",
  assertions: "เงื่อนไขตรวจสอบ",
  secret: "ค่าลับ",
};

export function changeFieldLabel(change: AuditChange): string {
  const label = CHANGE_FIELD_LABELS[change.field];
  return change.key === undefined ? label : `${label} ${change.key}`;
}

const NO_VALUE = "—";

/** `masked`, `secret_set` and `changed` never carry a value; `null` means the side has none. */
export function auditValueText(
  field: AuditChangeField,
  value: AuditValue | null,
): string {
  if (value === null) return NO_VALUE;
  switch (value.kind) {
    case "masked":
      return "•••";
    case "secret_set":
      return "ตั้งค่าแล้ว";
    case "changed":
      return "เปลี่ยนแล้ว";
    case "value": {
      const raw = value.value;
      if (raw === null) return NO_VALUE;
      if (typeof raw === "boolean") {
        return field === "monitorAlertsEnabled" ||
          field === "settingsChangedEnabled"
          ? raw
            ? "เปิด"
            : "ปิด"
          : raw
            ? "ใช่"
            : "ไม่ใช่";
      }
      return field === "role" && typeof raw === "string"
        ? roleLabel(raw)
        : String(raw);
    }
  }
}
