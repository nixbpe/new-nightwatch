import {
  invitationAcceptResponseSchema,
  invitationCreateInputSchema,
  invitationCreateResponseSchema,
  invitationResponseSchema,
  type InvitationAcceptResponse,
  type InvitationCreateInput,
  type InvitationCreateResponse,
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

export function createInvitation(
  organizationId: string,
  input: InvitationCreateInput,
): Promise<InvitationCreateResponse> {
  return request(
    "/api/organizations/{organizationId}/invitations",
    invitationCreateResponseSchema,
    {
      method: "POST",
      params: { organizationId },
      body: invitationCreateInputSchema.parse(input),
    },
  );
}

export function acceptInvitation(
  invitationId: string,
): Promise<InvitationAcceptResponse> {
  return request(
    "/api/onboarding/invitations/{invitationId}/accept",
    invitationAcceptResponseSchema,
    { method: "POST", params: { invitationId } },
  );
}
