import { type LoaderFunctionArgs } from "react-router";

import { fetchPriority, vulnerabilityKeys } from "../../api/vulnerabilities";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

// Prefetches only for an Organization the user belongs to; a Project the user cannot read
// answers 404 and the page shows its own state.
export async function priorityLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
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
  await resolveQueryClientForIdentity(session.user.id)
    .query({
      queryKey: vulnerabilityKeys.priority(organizationId, projectId),
      queryFn: ({ signal }) => fetchPriority(organizationId, projectId, signal),
      staleTime: 0,
    })
    .catch(() => undefined);
  return null;
}
