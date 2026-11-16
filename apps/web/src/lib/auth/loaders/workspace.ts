import { replace, type LoaderFunctionArgs } from "react-router";
import { fetchLastProject, projectQueryKeys } from "../../api/projects";
import { projectSwitchDestination } from "../../../components/shell/nav-config";
import {
  getLastProjectLandingRevision,
  waitForLastProjectSaves,
} from "../../lastProjectSave";
import {
  peekActiveQueryClientIdentity,
  getContextPublicationSnapshot,
  resolveQueryClientForIdentity,
} from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

export async function workspaceLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const userId = sessionOrRedirect.user.id;
  const queryClient = resolveQueryClientForIdentity(userId);
  const isCurrent = () => {
    const activeIdentity = peekActiveQueryClientIdentity();
    return (
      !request.signal.aborted &&
      getContextPublicationSnapshot(queryClient).admission.kind !== "retired" &&
      (activeIdentity === undefined || activeIdentity === userId)
    );
  };
  if (!isCurrent()) return null;
  const context = await prefetchMeContext(userId);
  if (!isCurrent()) return null;
  const organization = context?.organizations.find(
    (item) => item.id === context.lastActiveTenantId,
  );
  if (organization === undefined) return null;
  for (;;) {
    await waitForLastProjectSaves(queryClient, organization.id, request.signal);
    if (!isCurrent()) return null;
    await queryClient.cancelQueries({
      queryKey: projectQueryKeys.last(organization.id),
      exact: true,
    });
    if (!isCurrent()) return null;
    await waitForLastProjectSaves(queryClient, organization.id, request.signal);
    if (!isCurrent()) return null;
    const revision = getLastProjectLandingRevision(
      queryClient,
      organization.id,
    );
    const last = await queryClient
      .query({
        queryKey: projectQueryKeys.last(organization.id),
        queryFn: ({ signal }) => fetchLastProject(organization.id, signal),
        staleTime: 0,
        retry: false,
      })
      .catch(() => undefined);
    if (!isCurrent() || last === undefined) return null;
    if (
      revision !== getLastProjectLandingRevision(queryClient, organization.id)
    )
      continue;
    const destination =
      last.projectId === null
        ? `/organizations/${organization.id}/projects`
        : projectSwitchDestination(
            "/workspace",
            organization.id,
            last.projectId,
          );
    return destination === null ? null : replace(destination);
  }
}
