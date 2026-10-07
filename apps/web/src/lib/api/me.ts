import {
  activeOrganizationInputSchema,
  meContextResponseSchema,
  type ActiveOrganizationInput,
  type MeContextResponse,
} from "@nightwatch/api-contract";

import { request } from "./client";

export const ME_CONTEXT_QUERY_KEY = ["me", "context"] as const;

// Verified bootstrap: never reuse a read-only context as tenant admission.
export function fetchMeContext(options?: {
  signal?: AbortSignal;
}): Promise<MeContextResponse> {
  return request("/api/me/resolve-active-org", meContextResponseSchema, {
    method: "POST",
    signal: options?.signal,
  });
}

export function updateActiveOrganization(
  input: ActiveOrganizationInput,
): Promise<MeContextResponse> {
  return request("/api/me/active-org", meContextResponseSchema, {
    method: "PATCH",
    body: activeOrganizationInputSchema.parse(input),
  });
}
