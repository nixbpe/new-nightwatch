import { type LoaderFunctionArgs } from "react-router";

import {
  fetchOrganizationAwsConnection,
  organizationAwsConnectionQueryKey,
} from "../../api/aws-connection";
import { ApiError } from "../../api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../api/me";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

// WEB-04: prefetch only for an Owner or Admin of the named Organization; any
// other role gets the page's denied state and sends no request (AC-08).
export async function organizationAwsLoader({
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
  const role = context?.organizations.find(
    (organization) => organization.id === organizationId,
  )?.role;
  if (role !== "owner" && role !== "admin") {
    return null;
  }
  const queryClient = resolveQueryClientForIdentity(sessionOrRedirect.user.id);
  await queryClient
    .query({
      queryKey: organizationAwsConnectionQueryKey(organizationId),
      queryFn: () => fetchOrganizationAwsConnection(organizationId),
      staleTime: "static",
      retry: false,
    })
    .catch((error: unknown) => {
      // The context just said Owner/Admin; a denial means it is out of date.
      // The page counts this cached denial as already handled (AC-08).
      if (
        error instanceof ApiError &&
        (error.code === "PERMISSION_DENIED" ||
          error.code === "MEMBERSHIP_DENIED")
      )
        void queryClient.invalidateQueries({ queryKey: ME_CONTEXT_QUERY_KEY });
    });
  return null;
}
