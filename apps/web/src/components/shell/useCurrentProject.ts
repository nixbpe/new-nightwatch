import type { ProjectSummary } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";

import {
  fetchLastProject,
  fetchProjectList,
  projectQueryKeys,
} from "../../lib/api/projects";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { getProjectRoute } from "./nav-config";

export type CurrentProject = {
  /** The Organization the Project scope belongs to: the URL's on a Project route, else the active one. */
  organizationId: string | null;
  /** The user's role in `organizationId`. */
  role: string | null;
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
  const { activeOrg, me } = useTenant();
  // A bookmarked Project of another Organization the user belongs to is acted on in that Organization, as the
  // breadcrumb roots at the URL's. Outside Project routes, and for an Organization the user is not in, the active one.
  const projectRoute = getProjectRoute(pathname);
  const routeOrg =
    projectRoute === null
      ? undefined
      : me?.organizations.find((org) => org.id === projectRoute.organizationId);
  // A Project URL naming an Organization the user is not in selects nothing: no Project, list or last-Project
  // request for any Organization. The switcher keeps the active one so its link to the projects page stays.
  const denied = projectRoute !== null && routeOrg === undefined;
  const scopeOrg = routeOrg ?? activeOrg;
  const organizationId = scopeOrg?.id ?? null;
  const routeProjectId =
    routeOrg === undefined ? null : (projectRoute?.projectId ?? null);

  const list = useQuery({
    queryKey: projectQueryKeys.list(organizationId ?? ""),
    queryFn: () => fetchProjectList(organizationId ?? ""),
    enabled: organizationId !== null && !denied,
  });
  const last = useQuery({
    queryKey: projectQueryKeys.last(organizationId ?? ""),
    queryFn: () => fetchLastProject(organizationId ?? ""),
    enabled: organizationId !== null && !denied && routeProjectId === null,
  });
  const projects = denied ? [] : list.data?.projects;

  const candidate = routeProjectId ?? last.data?.projectId ?? null;
  const project =
    candidate === null
      ? null
      : (projects?.find((item) => item.id === candidate) ?? null);
  // While the list loads a Project route keeps its own id, so nav links do not flicker away.
  const projectId =
    project?.id ??
    (routeProjectId !== null && projects === undefined ? routeProjectId : null);

  const resolving = denied
    ? "ready"
    : projects === undefined
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
    role: scopeOrg?.role ?? null,
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
