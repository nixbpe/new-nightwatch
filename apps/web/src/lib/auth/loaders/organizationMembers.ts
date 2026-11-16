import type { MeContextResponse } from "@nightwatch/api-contract";
import { type LoaderFunctionArgs } from "react-router";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../../api/me";
import { assertContextIdentity } from "../../tenant/bootstrap";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../../api/members";
import {
  claimContextPublication,
  failContextPublication,
  createContextPublicationClaim,
  hasContextPublicationClaim,
  publishContextPublication,
  resolveQueryClientForIdentity,
} from "../../queryClient";
import { gateVerifiedSession } from "./session";

function hasSameMembershipScope(
  previous: MeContextResponse | undefined,
  fresh: MeContextResponse,
): boolean {
  if (
    previous === undefined ||
    previous.lastActiveTenantId !== fresh.lastActiveTenantId ||
    previous.organizations.length !== fresh.organizations.length
  ) {
    return false;
  }
  return previous.organizations.every((previousOrganization) =>
    fresh.organizations.some(
      (freshOrganization) =>
        freshOrganization.id === previousOrganization.id &&
        freshOrganization.role === previousOrganization.role,
    ),
  );
}

// AbortSignal changes across awaits; keep each check as a fresh read.
function isNavigationAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function organizationMembersLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const claim = createContextPublicationClaim();
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  if (isNavigationAborted(request.signal)) return null;
  const organizationId = params.organizationId;
  if (organizationId === undefined) return null;
  const queryClient = resolveQueryClientForIdentity(sessionOrRedirect.user.id);
  if (
    isNavigationAborted(request.signal) ||
    !claimContextPublication(queryClient, claim, "bootstrap")
  ) {
    return null;
  }
  const previousContext =
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY);
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  await queryClient.cancelQueries({
    queryKey: ME_CONTEXT_QUERY_KEY,
    exact: true,
  });
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  await queryClient.cancelQueries({ queryKey: ["tenant"] });
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  const context = await fetchMeContext()
    .then((fresh) => {
      assertContextIdentity(queryClient, fresh);
      return fresh;
    })
    .catch(() => undefined);
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  if (context === undefined) {
    failContextPublication(
      queryClient,
      claim,
      new Error("Context resolution failed"),
    );
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ME_CONTEXT_QUERY_KEY, exact: true });
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ["tenant"] });
    return null;
  }
  if (!hasSameMembershipScope(previousContext, context)) {
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    await queryClient.cancelQueries({ queryKey: ["tenant"] });
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    queryClient.removeQueries({ queryKey: ["tenant"] });
  }
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  publishContextPublication(queryClient, claim, context);
  const membership = context.organizations.find(
    (organization) => organization.id === organizationId,
  );
  if (
    membership === undefined ||
    (membership.role !== "owner" && membership.role !== "admin")
  ) {
    return null;
  }
  if (
    isNavigationAborted(request.signal) ||
    !hasContextPublicationClaim(queryClient, claim)
  ) {
    return null;
  }
  const memberKey: readonly unknown[] = memberListQueryKey(
    organizationId,
    50,
    0,
  );
  const memberQuery = queryClient.getQueryCache().find({
    queryKey: memberKey,
    exact: true,
  });
  const staleTime = queryClient.defaultQueryOptions({
    queryKey: memberKey,
  }).staleTime;
  if (
    memberQuery === undefined ||
    memberQuery.isStaleByTime(
      typeof staleTime === "function" ? staleTime(memberQuery) : staleTime,
    )
  ) {
    const members = await fetchOrganizationMembers(organizationId, 50, 0).catch(
      () => undefined,
    );
    if (
      isNavigationAborted(request.signal) ||
      !hasContextPublicationClaim(queryClient, claim)
    ) {
      return null;
    }
    if (members !== undefined) {
      queryClient.setQueryData(memberKey, members);
    }
  }
  return null;
}
