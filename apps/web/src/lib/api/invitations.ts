import {
  invitationResponseSchema,
  type InvitationResponse,
} from "@nightwatch/api-contract";

import { request } from "./client";

export const invitationQueryKey = (invitationId: string) =>
  ["onboarding", "invitation", invitationId] as const;

export function fetchInvitation(
  invitationId: string,
): Promise<InvitationResponse> {
  return request(
    "/api/onboarding/invitations/{invitationId}",
    invitationResponseSchema,
    { params: { invitationId } },
  );
}
