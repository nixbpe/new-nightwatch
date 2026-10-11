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
export type ProjectAction = "project.update" | "project.delete";

type Grant = "allow" | "deny";

const PROJECT_PERMISSIONS: Record<
  ProjectAction,
  { orgAdmin: Grant; projectAdmin: Grant; projectMember: Grant }
> = {
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
      "คุณไม่มีสิทธิ์จัดการโปรเจกต์นี้",
    );
  }
}
