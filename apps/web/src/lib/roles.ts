/** Thai role labels shared by invitation preview, workspace, and invites. */
export const ROLE_LABELS: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "ผู้ดูแล",
  viewer: "ผู้ชม",
  auditor: "ผู้ตรวจสอบ",
};

/** Roles an owner or admin may grant through an invitation (never "owner"). */
export const INVITABLE_ROLES = ["admin", "viewer", "auditor"] as const;

/** Invitation-grantable role, assignable to the typed client invite call. */
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
