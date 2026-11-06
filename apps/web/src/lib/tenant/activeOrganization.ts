import type { MeContextResponse } from "@nightwatch/api-contract";

export function selectActiveOrganization(
  context: MeContextResponse | undefined,
): MeContextResponse["organizations"][number] | null {
  return (
    context?.organizations.find(
      (organization) => organization.id === context.lastActiveTenantId,
    ) ?? null
  );
}
