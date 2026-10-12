import type { ProjectSummary } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";

import {
  fetchLastProject,
  fetchProjectList,
  projectQueryKeys,
} from "../../lib/api/projects";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { getRouteProjectId } from "./nav-config";

export type CurrentProject = {
  organizationId: string | null;
  /** Every Project the user can read, in the list's order; undefined until loaded. */
  projects: ProjectSummary[] | undefined;
  status: "loading" | "error" | "ready";
  /** The Project a Project route names, whether or not it is in the list. */
  routeProjectId: string | null;
  /** The Project in the URL, else the server's last or first readable one; null when there is none. */
  projectId: string | null;
  project: ProjectSummary | null;
  refetch: () => void;
};

/**
 * The Project the sidebar acts on. A Project route names it; elsewhere the
 * server resolves it (last used while still readable, else the first readable
 * one). A URL naming a Project that is not in the loaded list gives none, so
 * the page's own not-found state is not dressed up as a selection.
 */
export function useCurrentProject(): CurrentProject {
  const { pathname } = useLocation();
  const { activeOrg } = useTenant();
  const organizationId = activeOrg?.id ?? null;
  const routeProjectId = getRouteProjectId(pathname, organizationId);

  const list = useQuery({
    queryKey: projectQueryKeys.list(organizationId ?? ""),
    queryFn: () => fetchProjectList(organizationId ?? ""),
    enabled: organizationId !== null,
  });
  const last = useQuery({
    queryKey: projectQueryKeys.last(organizationId ?? ""),
    queryFn: () => fetchLastProject(organizationId ?? ""),
    enabled: organizationId !== null && routeProjectId === null,
  });
  const projects = list.data?.projects;

  const candidate = routeProjectId ?? last.data?.projectId ?? null;
  const project =
    candidate === null
      ? null
      : (projects?.find((item) => item.id === candidate) ?? null);
  // While the list loads a Project route keeps its own id, so nav links do not flicker away.
  const projectId =
    project?.id ??
    (routeProjectId !== null && projects === undefined ? routeProjectId : null);

  const resolving =
    projects === undefined
      ? list.isError
        ? "error"
        : "loading"
      : routeProjectId === null && last.isError
        ? "error"
        : routeProjectId === null && last.isPending
          ? "loading"
          : "ready";

  return {
    organizationId,
    projects,
    routeProjectId,
    status: resolving,
    projectId,
    project,
    refetch: () => {
      void list.refetch();
      if (routeProjectId === null) void last.refetch();
    },
  };
}
