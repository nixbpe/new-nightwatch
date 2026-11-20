import type { LoaderFunctionArgs } from "react-router";

import { awsKeys, fetchOrganizationAws, fetchProjectAws } from "../../api/aws";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

export async function awsLoader({ params, request }: LoaderFunctionArgs) {
  const session = await gateVerifiedSession(request);
  if (session instanceof Response) return session;
  const { organizationId, projectId } = params;
  if (!organizationId) return null;
  const context = await prefetchMeContext(session.user.id);
  const role = context?.organizations.find(
    (org) => org.id === organizationId,
  )?.role;
  if (!role || request.signal.aborted) return null;
  const client = resolveQueryClientForIdentity(session.user.id);
  if (projectId) {
    await client
      .query({
        queryKey: awsKeys.project(organizationId, projectId),
        queryFn: ({ signal }) =>
          fetchProjectAws(organizationId, projectId, signal),
        staleTime: 0,
      })
      .catch(() => undefined);
  } else if (role === "owner" || role === "admin") {
    await client
      .query({
        queryKey: awsKeys.organization(organizationId),
        queryFn: ({ signal }) => fetchOrganizationAws(organizationId, signal),
        staleTime: 0,
      })
      .catch(() => undefined);
  }
  return null;
}
