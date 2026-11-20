import { type LoaderFunctionArgs } from "react-router";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  monitorQueryKeys,
  MONITOR_LIST_PAGE_SIZE,
} from "../../api/monitors";
import {
  fetchProjectDetail,
  fetchProjectList,
  fetchProjectMembers,
  projectQueryKeys,
} from "../../api/projects";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

export async function projectOverviewLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const session = await gateVerifiedSession(request);
  if (session instanceof Response) return session;
  const { organizationId, projectId } = params;
  if (organizationId === undefined || projectId === undefined) return null;
  const context = await prefetchMeContext(session.user.id);
  if (
    context?.organizations.some(
      (organization) => organization.id === organizationId,
    ) !== true
  )
    return null;
  const queryClient = resolveQueryClientForIdentity(session.user.id);
  const listParams = { limit: MONITOR_LIST_PAGE_SIZE, offset: 0 };
  await Promise.all([
    queryClient
      .query({
        queryKey: monitorQueryKeys.list(organizationId, projectId, listParams),
        queryFn: () => fetchMonitorList(organizationId, projectId, listParams),
        staleTime: "static",
      })
      .catch(() => undefined),
    queryClient
      .query({
        queryKey: monitorQueryKeys.recentEvents(organizationId, projectId),
        queryFn: () => fetchMonitorRecentEvents(organizationId, projectId),
        staleTime: "static",
      })
      .catch(() => undefined),
  ]);
  return null;
}

export async function projectsLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const organizationId = params.organizationId;
  if (organizationId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (
    context?.organizations.some(
      (organization) => organization.id === organizationId,
    ) !== true
  ) {
    return null;
  }
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: projectQueryKeys.list(organizationId),
      queryFn: () => fetchProjectList(organizationId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

// Same membership check as projectsLoader; a missing or inaccessible Project is
// left to the page, which shows the uniform "not found" state.
export async function projectMembersLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const { organizationId, projectId } = params;
  if (organizationId === undefined || projectId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (
    context?.organizations.some(
      (organization) => organization.id === organizationId,
    ) !== true
  ) {
    return null;
  }
  const queryClient = resolveQueryClientForIdentity(sessionOrRedirect.user.id);
  await Promise.all([
    queryClient.query({
      queryKey: projectQueryKeys.detail(organizationId, projectId),
      queryFn: () => fetchProjectDetail(organizationId, projectId),
      staleTime: "static",
    }),
    queryClient.query({
      queryKey: projectQueryKeys.members(organizationId, projectId),
      queryFn: () => fetchProjectMembers(organizationId, projectId),
      staleTime: "static",
    }),
  ]).catch(() => undefined);
  return null;
}
