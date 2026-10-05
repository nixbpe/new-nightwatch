// What the Worker needs to write an audit export file. The Worker may import
// only shared-server and database packages (PKG-01), so these are copies of the
// values in @nightwatch/api-contract; apps/api/src/audit/shared-parity.test.ts
// fails when the two drift apart.

export const AUDIT_ACTIONS = [
  "organization.monitor.create",
  "organization.monitor.update",
  "organization.monitor.pause",
  "organization.monitor.resume",
  "organization.monitor.delete",
  "organization.monitor.secret.set",
  "organization.monitor.secret.replace",
  "organization.notification-settings.monitor-alerts.update",
  "organization.notification-settings.update",
  "organization.member.role.update",
  "organization.member.revoke",
  "organization.member.leave",
  "organization.invitation.create",
  "organization.invitation.resend",
  "organization.invitation.cancel",
  "organization.audit-log.export",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditCategory =
  "monitor" | "notification_settings" | "member" | "invitation" | "audit_log";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "organization.monitor.create": "สร้างมอนิเตอร์",
  "organization.monitor.update": "แก้ไขมอนิเตอร์",
  "organization.monitor.pause": "หยุดมอนิเตอร์ชั่วคราว",
  "organization.monitor.resume": "เริ่มมอนิเตอร์ต่อ",
  "organization.monitor.delete": "ลบมอนิเตอร์",
  "organization.monitor.secret.set": "ตั้งค่าลับของมอนิเตอร์",
  "organization.monitor.secret.replace": "แทนที่ค่าลับของมอนิเตอร์",
  "organization.notification-settings.monitor-alerts.update":
    "เปลี่ยนการแจ้งเตือนมอนิเตอร์",
  "organization.notification-settings.update": "เปลี่ยนการตั้งค่าการแจ้งเตือน",
  "organization.member.role.update": "เปลี่ยนบทบาทสมาชิก",
  "organization.member.revoke": "ถอนสมาชิก",
  "organization.member.leave": "ออกจากองค์กร",
  "organization.invitation.create": "สร้างคำเชิญ",
  "organization.invitation.resend": "ส่งคำเชิญซ้ำ",
  "organization.invitation.cancel": "ยกเลิกคำเชิญ",
  "organization.audit-log.export": "ขอส่งออกบันทึกกิจกรรม",
};

export type AuditValue =
  | { kind: "value"; value: string | number | boolean | null }
  | { kind: "masked" }
  | { kind: "secret_set" }
  | { kind: "changed" };

export type AuditChange = {
  field:
    | "role"
    | "monitorAlertsEnabled"
    | "settingsChangedEnabled"
    | "name"
    | "url"
    | "method"
    | "intervalSeconds"
    | "timeoutSeconds"
    | "header"
    | "queryParam"
    | "body"
    | "authType"
    | "apiKeyHeaderName"
    | "expectedStatus"
    | "assertions"
    | "secret"
    // Issue #60: per-monitor alert settings.
    | "alertFailureThreshold"
    | "alertDownEnabled"
    | "alertSslEnabled"
    | "alertSslCautionDays";
  key?: string | undefined;
  before: AuditValue | null;
  after: AuditValue | null;
};

export type AuditExportFailureCode =
  "EXPORT_TOO_LARGE" | "EXPORT_FAILED" | "REQUESTER_NOT_AUTHORIZED";

export const AUDIT_EXPORT_MAX_EVENTS = 50_000;
export const AUDIT_EXPORT_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIT_EXPORT_FILE_TTL_HOURS = 24;

/** The note in every file and on the page (feature.md, step 3). */
export function auditScopeNote(recordingStartedOn: string): string {
  return `บันทึกเฉพาะการกระทำที่สำเร็จในหมวด มอนิเตอร์ ตั้งค่าการแจ้งเตือน สมาชิก คำเชิญ และบันทึกกิจกรรม ตั้งแต่ ${recordingStartedOn} ไม่รวมการกระทำที่ถูกปฏิเสธ การตอบรับคำเชิญ (สมาชิกเข้าร่วม) กิจกรรมระดับบัญชี (เข้าสู่ระบบ รหัสผ่าน MFA) และกิจกรรมของ AWS account, API key และ findings`;
}

/** Action codes whose code or Thai label contains `q` (the `q` search of the list and the export). */
export function auditActionCodesMatching(q: string): AuditAction[] {
  const needle = q.toLowerCase();
  return AUDIT_ACTIONS.filter(
    (code) =>
      code.toLowerCase().includes(needle) ||
      AUDIT_ACTION_LABELS[code].toLowerCase().includes(needle),
  );
}
