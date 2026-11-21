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
  "organization.project.create",
  "organization.project.update",
  "organization.project.delete",
  "organization.project.member.add",
  "organization.project.member.role.update",
  "organization.project.member.remove",
  "organization.aws_connection.tested",
  "organization.aws_connection.updated",
  "organization.aws_connection.disconnected",
  // Written by #118's AWS connection before 0029; kept so those events read.
  "organization.aws_connection.test",
  "organization.aws_connection.update",
  "organization.aws_connection.delete",
  "organization.project.aws_connection.test",
  "organization.project.aws_connection.update",
  "organization.project.aws_connection.delete",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditCategory =
  | "monitor"
  | "notification_settings"
  | "member"
  | "invitation"
  | "audit_log"
  | "project"
  | "aws_connection";

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
  "organization.project.create": "สร้างโปรเจกต์",
  "organization.project.update": "แก้ไขโปรเจกต์",
  "organization.project.delete": "ลบโปรเจกต์",
  "organization.project.member.add": "เพิ่มสมาชิกในโปรเจกต์",
  "organization.project.member.role.update": "เปลี่ยนบทบาทสมาชิกในโปรเจกต์",
  "organization.project.member.remove": "นำสมาชิกออกจากโปรเจกต์",
  "organization.aws_connection.tested": "ทดสอบการเชื่อมต่อ AWS",
  "organization.aws_connection.updated": "ตั้งค่าการเชื่อมต่อ AWS",
  "organization.aws_connection.disconnected": "ยกเลิกการเชื่อมต่อ AWS",
  "organization.aws_connection.test": "ทดสอบการเชื่อมต่อ AWS ขององค์กร",
  "organization.aws_connection.update": "บันทึกการเชื่อมต่อ AWS ขององค์กร",
  "organization.aws_connection.delete": "ยกเลิกการเชื่อมต่อ AWS ขององค์กร",
  "organization.project.aws_connection.test":
    "ทดสอบการเชื่อมต่อ AWS ของโปรเจกต์",
  "organization.project.aws_connection.update":
    "บันทึกการเชื่อมต่อ AWS ของโปรเจกต์",
  "organization.project.aws_connection.delete":
    "ยกเลิกการเชื่อมต่อ AWS ของโปรเจกต์",
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
    | "description"
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
    | "alertFailureThreshold"
    | "alertDownEnabled"
    | "alertSslEnabled"
    | "alertSslCautionDays"
    | "roleArn";
  key?: string | undefined;
  before: AuditValue | null;
  after: AuditValue | null;
};

export type AuditExportFailureCode =
  "EXPORT_TOO_LARGE" | "EXPORT_FAILED" | "REQUESTER_NOT_AUTHORIZED";

export const AUDIT_EXPORT_MAX_EVENTS = 50_000;
export const AUDIT_EXPORT_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIT_EXPORT_FILE_TTL_HOURS = 24;

export function auditScopeNote(recordingStartedOn: string): string {
  return `บันทึกเฉพาะการกระทำที่สำเร็จในหมวด มอนิเตอร์ ตั้งค่าการแจ้งเตือน สมาชิก คำเชิญ โปรเจกต์ การเชื่อมต่อ AWS ขององค์กร และบันทึกกิจกรรม ตั้งแต่ ${recordingStartedOn} ไม่รวมการกระทำที่ถูกปฏิเสธ การตอบรับคำเชิญ (สมาชิกเข้าร่วม) กิจกรรมระดับบัญชี (เข้าสู่ระบบ รหัสผ่าน MFA) และกิจกรรมของ AWS account ระดับโปรเจกต์, API key และ findings`;
}

export function auditActionCodesMatching(q: string): AuditAction[] {
  const needle = q.toLowerCase();
  return AUDIT_ACTIONS.filter(
    (code) =>
      code.toLowerCase().includes(needle) ||
      AUDIT_ACTION_LABELS[code].toLowerCase().includes(needle),
  );
}
