import type { OrganizationRole, ProjectRole } from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";

// How a user relates to one Project. `org-admin` (Owner or Admin of the
// Organization) outranks a Project role. `none` is a user who cannot see the
// Project at all.
export type ProjectAccess =
  | { kind: "org-admin" }
  | { kind: "member"; role: ProjectRole }
  | { kind: "none" };

// Only the actions that have a route today; later features add their own.
export type ProjectAction =
  | "project.read"
  | "project.update"
  | "project.delete"
  | "project.members.manage"
  | "monitor.read"
  | "monitor.write"
  | "monitor.readResponse";

// Actions that only read: they check the Organization role under a shared
// lock and answer MEMBERSHIP_DENIED for a role that no longer normalizes.
const READ_ACTIONS: ReadonlySet<ProjectAction> = new Set([
  "project.read",
  "monitor.read",
  "monitor.readResponse",
]);

export function isReadAction(action: ProjectAction): boolean {
  return READ_ACTIONS.has(action);
}

type Grant = "allow" | "deny";

const PROJECT_PERMISSIONS: Record<
  ProjectAction,
  { orgAdmin: Grant; projectAdmin: Grant; projectMember: Grant }
> = {
  "project.read": {
    orgAdmin: "allow",
    projectAdmin: "allow",
    projectMember: "allow",
  },
  "project.update": {
    orgAdmin: "allow",
    projectAdmin: "allow",
    projectMember: "deny",
  },
  "project.delete": {
    orgAdmin: "allow",
    projectAdmin: "deny",
    projectMember: "deny",
  },
  // Also guards member-candidates, which lists Organization member emails.
  "project.members.manage": {
    orgAdmin: "allow",
    projectAdmin: "allow",
    projectMember: "deny",
  },
  // Monitors read by any Project member; changed (create, edit, pause, resume,
  // delete, test) by Project admins and Owner/Admin.
  "monitor.read": {
    orgAdmin: "allow",
    projectAdmin: "allow",
    projectMember: "allow",
  },
  "monitor.write": {
    orgAdmin: "allow",
    projectAdmin: "allow",
    projectMember: "deny",
  },
  // Headers and body come from the target and may hold personal data (OD-58-04).
  "monitor.readResponse": {
    orgAdmin: "allow",
    projectAdmin: "allow",
    projectMember: "deny",
  },
};

const DENIED_MESSAGES: Partial<Record<ProjectAction, string>> = {
  "monitor.readResponse": "คุณไม่มีสิทธิ์ดูการตอบกลับของมอนิเตอร์นี้",
  "monitor.write": "คุณไม่มีสิทธิ์จัดการมอนิเตอร์ของโปรเจกต์นี้",
};

export function projectAccessOf(
  organizationRole: OrganizationRole,
  projectRole: ProjectRole | null,
): ProjectAccess {
  if (organizationRole === "owner" || organizationRole === "admin") {
    return { kind: "org-admin" };
  }
  return projectRole === null
    ? { kind: "none" }
    : { kind: "member", role: projectRole };
}

export function projectNotFound(): never {
  throw new AppError(404, "PROJECT_NOT_FOUND", "ไม่พบโปรเจกต์");
}

// A Project the user cannot see answers 404 like a missing one, so callers
// cannot probe which Projects exist; a visible one they may not change is 403.
export function assertProjectAccess(
  access: ProjectAccess,
  action: ProjectAction,
): void {
  if (access.kind === "none") projectNotFound();
  const grants = PROJECT_PERMISSIONS[action];
  const grant =
    access.kind === "org-admin"
      ? grants.orgAdmin
      : access.role === "admin"
        ? grants.projectAdmin
        : grants.projectMember;
  if (grant === "deny") {
    throw new AppError(
      403,
      "PERMISSION_DENIED",
      DENIED_MESSAGES[action] ?? "คุณไม่มีสิทธิ์จัดการโปรเจกต์นี้",
    );
  }
}
