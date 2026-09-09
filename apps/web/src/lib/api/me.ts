import {
  activeOrganizationInputSchema,
  meContextResponseSchema,
  type ActiveOrganizationInput,
  type MeContextResponse,
} from "@nightwatch/api-contract";

import { request } from "./client";

export const ME_CONTEXT_QUERY_KEY = ["me", "context"] as const;

export function fetchMeContext(): Promise<MeContextResponse> {
  return request("/api/me/context", meContextResponseSchema);
}

/**
 * Persist the user's active organization. Only a resolved success may
 * publish the new tenant — callers keep the previous selection on failure.
 */
export function updateActiveOrganization(
  input: ActiveOrganizationInput,
): Promise<MeContextResponse> {
  return request("/api/me/active-org", meContextResponseSchema, {
    method: "PATCH",
    body: activeOrganizationInputSchema.parse(input),
  });
}
