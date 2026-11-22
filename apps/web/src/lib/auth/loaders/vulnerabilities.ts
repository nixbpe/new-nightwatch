import { replace, type LoaderFunctionArgs } from "react-router";

import {
  fetchNewVulnerabilities,
  fetchPriority,
  fetchVulnerabilities,
  vulnerabilityKeys,
} from "../../api/vulnerabilities";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

// Prefetches only for an Organization the user belongs to; a Project the user cannot read
// answers 404 and the page shows its own state.
async function prefetch(
  { params, request }: LoaderFunctionArgs,
  fetches: (
    organizationId: string,
    projectId: string,
    queryClient: ReturnType<typeof resolveQueryClientForIdentity>,
  ) => Promise<unknown>[],
): Promise<null | Response> {
  const session = await gateVerifiedSession(request);
  if (session instanceof Response) return session;
  const organizationId = params.organizationId?.toLowerCase();
  const projectId = params.projectId?.toLowerCase();
  if (organizationId === undefined || projectId === undefined) return null;
  const context = await prefetchMeContext(session.user.id);
  if (
    context?.organizations.some((org) => org.id === organizationId) !== true ||
    request.signal.aborted
  ) {
    return null;
  }
  await Promise.all(
    fetches(
      organizationId,
      projectId,
      resolveQueryClientForIdentity(session.user.id),
    ).map((pending) => pending.catch(() => undefined)),
  );
  return null;
}

/** Prefetches what the active view reads: the list for both, the ranking and the new-CVE list for "ต้องแก้" only. */
export function vulnerabilitiesLoader(args: LoaderFunctionArgs) {
  const systems =
    new URL(args.request.url).searchParams.get("view") === "systems";
  return prefetch(args, (organizationId, projectId, queryClient) => [
    queryClient.query({
      queryKey: vulnerabilityKeys.list(organizationId, projectId),
      queryFn: ({ signal }) =>
        fetchVulnerabilities(organizationId, projectId, signal),
      staleTime: 0,
    }),
    ...(systems
      ? []
      : [
          queryClient.query({
            queryKey: vulnerabilityKeys.priority(organizationId, projectId),
            queryFn: ({ signal }) =>
              fetchPriority(organizationId, projectId, signal),
            staleTime: 0,
          }),
          queryClient.query({
            queryKey: vulnerabilityKeys.newCves(organizationId, projectId),
            queryFn: ({ signal }) =>
              fetchNewVulnerabilities(organizationId, projectId, signal),
            staleTime: 0,
          }),
        ]),
  ]);
}

/** The sample page reads the list for who may review and for the limit verdict. */
export function vulnerabilitySampleLoader(args: LoaderFunctionArgs) {
  return prefetch(args, (organizationId, projectId, queryClient) => [
    queryClient.query({
      queryKey: vulnerabilityKeys.list(organizationId, projectId),
      queryFn: ({ signal }) =>
        fetchVulnerabilities(organizationId, projectId, signal),
      staleTime: 0,
    }),
  ]);
}

/**
 * The old pages' URLs keep working (links in sent notifications and Emails): the path moves to
 * the findings page and the query string stays. The findings page's own loader then gates the
 * session and returns to this target after sign-in.
 */
function legacyRedirect(filterNew: boolean) {
  return ({ params, request }: LoaderFunctionArgs): Response => {
    const search = new URLSearchParams(new URL(request.url).search);
    if (filterNew) search.set("new", "1");
    const query = search.toString();
    return replace(
      `/organizations/${encodeURIComponent(params.organizationId ?? "")}/projects/${encodeURIComponent(params.projectId ?? "")}/vulnerabilities${query === "" ? "" : `?${query}`}`,
    );
  };
}

export const vulnerabilitiesNewRedirect = legacyRedirect(true);
export const vulnerabilitiesPriorityRedirect = legacyRedirect(false);
