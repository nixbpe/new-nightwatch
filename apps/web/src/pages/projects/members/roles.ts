import type { ProjectRole } from "@nightwatch/api-contract";

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: "ผู้ดูแล",
  member: "สมาชิก",
};

// Panel text (AC-11).
export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  admin: "เพิ่มและนำสมาชิกออก เปลี่ยนบทบาท และแก้ไขการตั้งค่าโปรเจกต์",
  member: "ดูและทำงานในโปรเจกต์ จัดการสมาชิกไม่ได้",
};

// Shown under the add dialog's role picker.
export const PROJECT_ROLE_HINTS: Record<ProjectRole, string> = {
  admin:
    "ผู้ดูแลเพิ่มและนำสมาชิกออก เปลี่ยนบทบาท และแก้ไขการตั้งค่าโปรเจกต์ได้",
  member: "สมาชิกดูและทำงานในโปรเจกต์ได้ แต่จัดการสมาชิกไม่ได้",
};
