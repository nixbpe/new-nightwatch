import {
  type ShouldRevalidateFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import {
  fetchImportPreview,
  fetchInventory,
  fetchMappings,
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
    ids: { organizationId: string; projectId: string },
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

// The System page reads its System from the summary, which also says what the caller may do.
export function inventorySystemLoader(args: LoaderFunctionArgs) {
  return prefetch(args, (client, { organizationId, projectId }) =>
    client.query({
      queryKey: inventoryKeys.summary(organizationId, projectId),
      queryFn: ({ signal }) =>
        fetchInventory(organizationId, projectId, signal),
      staleTime: 0,
    }),
  );
}

// The Import page reads the summary, which says what the caller may do, and, for a maintainer,
// the caller's own pending preview.
export function inventoryImportLoader(args: LoaderFunctionArgs) {
  return prefetch(args, async (client, { organizationId, projectId }) => {
    const summary = await client.query({
      queryKey: inventoryKeys.summary(organizationId, projectId),
      queryFn: ({ signal }) =>
        fetchInventory(organizationId, projectId, signal),
      staleTime: 0,
    });
    // A member who may not import never asks for a preview, so no refused call is audited.
    if (!summary.canUpload) return;
    await client.query({
      queryKey: inventoryKeys.importPreview(organizationId, projectId),
      queryFn: ({ signal }) =>
        fetchImportPreview(organizationId, projectId, signal),
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

// Table-only navigation fetches rows and permissions in the mounted page without
// withdrawing admission and unmounting the active keyboard input.
export function inventoryShouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  const { currentUrl, nextUrl, defaultShouldRevalidate } = args;
  if (
    args.formMethod !== undefined ||
    args.actionStatus !== undefined ||
    args.actionResult !== undefined ||
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search === nextUrl.search
  )
    return defaultShouldRevalidate;
  const filters = new Set([
    "system",
    "layer",
    "environment",
    "exposure",
    "owner",
    "status",
    "q",
    "page",
  ]);
  const keys = new Set([
    ...currentUrl.searchParams.keys(),
    ...nextUrl.searchParams.keys(),
  ]);
  for (const key of keys) {
    if (
      !filters.has(key) &&
      JSON.stringify(currentUrl.searchParams.getAll(key)) !==
        JSON.stringify(nextUrl.searchParams.getAll(key))
    )
      return defaultShouldRevalidate;
  }
  return false;
}
