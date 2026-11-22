import { type LoaderFunctionArgs } from "react-router";

import {
  fetchInventory,
  fetchMappings,
  fetchRejectedRows,
  fetchRows,
  inventoryKeys,
} from "../../api/inventory";
import { readFilters, toQuery } from "../../api/inventoryRowFilters";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

// Prefetches only for an Organization the user belongs to; a Project the user cannot read
// answers 404 and the page shows its own state.
async function prefetch(
  { params, request }: LoaderFunctionArgs,
  load: (
    client: ReturnType<typeof resolveQueryClientForIdentity>,
    ids: { organizationId: string; projectId: string; systemId?: string },
  ) => Promise<unknown>,
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
  await load(resolveQueryClientForIdentity(session.user.id), {
    organizationId,
    projectId,
    systemId: params.systemId?.toLowerCase(),
  }).catch(() => undefined);
  return null;
}

export function inventoryLoader(args: LoaderFunctionArgs) {
  // The table's page and filters are in the address, so the loader asks for the same rows.
  const query = toQuery(readFilters(new URL(args.request.url).searchParams));
  return prefetch(args, (client, { organizationId, projectId }) =>
    Promise.all([
      client.query({
        queryKey: inventoryKeys.summary(organizationId, projectId),
        queryFn: ({ signal }) =>
          fetchInventory(organizationId, projectId, signal),
        staleTime: 0,
      }),
      client.query({
        queryKey: inventoryKeys.rows(organizationId, projectId, query),
        queryFn: ({ signal }) =>
          fetchRows(organizationId, projectId, query, signal),
        staleTime: 0,
      }),
    ]),
  );
}

export function inventoryRejectedRowsLoader(args: LoaderFunctionArgs) {
  return prefetch(args, (client, { organizationId, projectId, systemId }) => {
    if (systemId === undefined) return Promise.resolve();
    return client.query({
      queryKey: inventoryKeys.rejected(organizationId, projectId, systemId),
      queryFn: ({ signal }) =>
        fetchRejectedRows(organizationId, projectId, systemId, signal),
      staleTime: 0,
    });
  });
}

export function inventoryMappingsLoader(args: LoaderFunctionArgs) {
  return prefetch(args, (client, { organizationId, projectId }) =>
    client.query({
      queryKey: inventoryKeys.mappings(organizationId, projectId),
      queryFn: ({ signal }) => fetchMappings(organizationId, projectId, signal),
      staleTime: 0,
    }),
  );
}
