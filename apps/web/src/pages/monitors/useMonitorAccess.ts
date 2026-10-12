import type { ProjectDetail } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../../lib/api/client";
import { fetchProjectDetail, projectQueryKeys } from "../../lib/api/projects";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { PROJECT_ROLE_LABELS } from "../projects/members/roles";

/** A missing monitor and a Project the caller cannot read answer alike (404). */
export function isMonitorNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MONITOR_NOT_FOUND" || error.code === "PROJECT_NOT_FOUND")
  );
}

export type MonitorAccess = {
  organization: { id: string; name: string; role: string } | undefined;
  project: ProjectDetail | undefined;
  /** The Project is unknown or no longer readable by the caller. */
  projectGone: boolean;
  /** Write, test and read-the-last-response: Project admin, or Organization Owner or Admin. */
  canWrite: boolean;
  /** The caller's Project role is still unknown, and without it write access is undecided. */
  pending: boolean;
  /** Header chip: the Project role, or the Organization role for an Owner or Admin who is not a member. */
  roleTag: string | undefined;
  /** Re-reads the Project so a changed Project role shows without a reload. */
  refresh: () => Promise<void>;
};

/**
 * What the caller may do with the monitors of one Project. The Organization role
 * decides first; otherwise the caller's Project role from the Project query.
 */
export function useMonitorAccess(
  organizationId: string,
  projectId: string,
  enabled = true,
): MonitorAccess {
  const { me } = useTenant();
  const queryClient = useQueryClient();
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const organizationWriter =
    organization?.role === "owner" || organization?.role === "admin";
  const query = useQuery({
    queryKey: projectQueryKeys.detail(organizationId, projectId),
    queryFn: () => fetchProjectDetail(organizationId, projectId),
    enabled: enabled && organization !== undefined,
  });
  const project = query.data;
  const myRole = project?.myRole ?? null;
  const canWrite = organizationWriter || myRole === "admin";
  let roleTag: string | undefined;
  if (myRole !== null) {
    roleTag = `โปรเจกต์ · ${PROJECT_ROLE_LABELS[myRole]}`;
  } else if (organization !== undefined && project !== undefined) {
    roleTag = `องค์กร · ${ROLE_LABELS[organization.role] ?? organization.role}`;
  }
  return {
    organization,
    project,
    projectGone:
      query.error instanceof ApiError &&
      query.error.code === "PROJECT_NOT_FOUND",
    canWrite,
    pending:
      organization !== undefined &&
      !organizationWriter &&
      project === undefined &&
      !query.isError,
    roleTag,
    refresh: () =>
      queryClient.invalidateQueries({
        queryKey: projectQueryKeys.detail(organizationId, projectId),
      }),
  };
}
