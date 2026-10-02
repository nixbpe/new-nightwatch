import type { OrganizationRole } from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { normalizeOrganizationRole } from "../me/service";

export type MonitorPermission = "read" | "write" | "readResponse";

export const MONITOR_PERMISSION_ROLES: Record<
  MonitorPermission,
  readonly OrganizationRole[]
> = {
  read: ["owner", "admin", "viewer", "auditor"],
  write: ["owner", "admin"],
  // Headers and body come from the target and may hold personal data (OD-58-04).
  readResponse: ["owner", "admin"],
};

const DENIED_MESSAGES: Record<MonitorPermission, string> = {
  read: "คุณไม่มีสิทธิ์จัดการมอนิเตอร์ขององค์กรนี้",
  write: "คุณไม่มีสิทธิ์จัดการมอนิเตอร์ขององค์กรนี้",
  readResponse: "คุณไม่มีสิทธิ์ดูการตอบกลับของมอนิเตอร์นี้",
};

export function monitorRoleAllows(
  rawRole: string,
  permission: MonitorPermission,
): boolean {
  const role = normalizeOrganizationRole(rawRole);
  return role !== null && MONITOR_PERMISSION_ROLES[permission].includes(role);
}

// A nonmember and a missing Organization get the same denial, so callers
// cannot probe which Organizations exist.
export function membershipDenied(): never {
  throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
}

export function assertMonitorPermission(
  rawRole: string | undefined,
  permission: MonitorPermission,
): void {
  if (rawRole === undefined) membershipDenied();
  if (!monitorRoleAllows(rawRole, permission)) {
    throw new AppError(403, "PERMISSION_DENIED", DENIED_MESSAGES[permission]);
  }
}

// Runs before tenant context and before any network work. Callers recheck the
// role under their locks, because a role can change in between.
export async function assertMemberPermissionBeforeTenantContext(
  database: Database,
  input: {
    organizationId: string;
    userId: string;
    permission: MonitorPermission;
  },
): Promise<void> {
  const result = await database.sql.query<{ role: string }>(
    "select role from member where organization_id = $1 and user_id = $2",
    [input.organizationId, input.userId],
  );
  assertMonitorPermission(result.rows[0]?.role, input.permission);
}
