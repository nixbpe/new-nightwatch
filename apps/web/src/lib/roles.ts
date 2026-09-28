export const ROLE_LABELS: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "ผู้ดูแล",
  viewer: "ผู้ชม",
  auditor: "ผู้ตรวจสอบ",
};

export const ADMIN_INVITABLE_ROLES = ["admin", "viewer", "auditor"] as const;
export const INVITABLE_ROLES = ["owner", ...ADMIN_INVITABLE_ROLES] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];
