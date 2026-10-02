import type { PendingInvitationListResponse } from "@nightwatch/api-contract";

/** Default list stub for page tests that do not exercise the invitation section. */
export function emptyPendingInvitationList(
  organizationId: string,
): PendingInvitationListResponse {
  return {
    organizationId,
    invitations: [],
    activeCount: 0,
    activeLimit: 100,
    page: { limit: 50, offset: 0, total: 0 },
  };
}
