import { type LoaderFunctionArgs } from "react-router";
import {
  fetchMonitorDetail,
  fetchMonitorList,
  monitorQueryKeys,
  MONITOR_LIST_PAGE_SIZE,
} from "../../api/monitors";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

// Prefetches the first list page only for an Organization the user belongs to;
// the page renders denied for any other and must not trigger a request for it.
// A Project the user cannot read answers 404, which the page shows as its own state.
export async function monitorsOverviewLoader({
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
  const listParams = { limit: MONITOR_LIST_PAGE_SIZE, offset: 0 };
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: monitorQueryKeys.list(organizationId, projectId, listParams),
      queryFn: () => fetchMonitorList(organizationId, projectId, listParams),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

// Same membership check as the Overview loader; a missing or foreign monitor is
// left to the page, which shows the uniform "not found" state.
export async function monitorDetailLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const { organizationId, projectId, monitorId } = params;
  if (
    organizationId === undefined ||
    projectId === undefined ||
    monitorId === undefined
  ) {
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
      queryKey: monitorQueryKeys.detail(organizationId, projectId, monitorId),
      queryFn: () => fetchMonitorDetail(organizationId, projectId, monitorId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

// The form page gates on role itself (denied state), so this only warms the
// membership context the page reads.
export async function monitorCreateLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  await prefetchMeContext(sessionOrRedirect.user.id);
  return null;
}

// Edit pins the version it loads, so it always starts from a fresh read
// (staleTime 0) rather than a Detail poll that may be 30 s old.
export async function monitorEditLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const { organizationId, projectId, monitorId } = params;
  if (
    organizationId === undefined ||
    projectId === undefined ||
    monitorId === undefined
  ) {
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
      queryKey: monitorQueryKeys.detail(organizationId, projectId, monitorId),
      queryFn: () => fetchMonitorDetail(organizationId, projectId, monitorId),
      staleTime: 0,
      // A missing monitor is the page's own state; a retry would only delay it.
      retry: false,
    })
    .catch(() => undefined);
  return null;
}
