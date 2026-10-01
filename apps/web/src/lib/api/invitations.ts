import {
  invitationAcceptResponseSchema,
  invitationCreateInputSchema,
  invitationCreateResponseSchema,
  invitationResponseSchema,
  pendingInvitationListResponseSchema,
  type InvitationAcceptResponse,
  type InvitationCreateInput,
  type InvitationCreateResponse,
  type InvitationResponse,
  type PendingInvitationListResponse,
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

// Under the tenant prefix so an Organization switch cancels and removes it.
export const pendingInvitationListQueryPrefix = (organizationId: string) =>
  ["tenant", "invitations", organizationId] as const;

export const pendingInvitationListQueryKey = (
  organizationId: string,
  limit: number,
  offset: number,
) =>
  [
    ...pendingInvitationListQueryPrefix(organizationId),
    { limit, offset },
  ] as const;

export function fetchPendingInvitations(
  organizationId: string,
  limit: number,
  offset: number,
): Promise<PendingInvitationListResponse> {
  return request(
    "/api/organizations/{organizationId}/invitations",
    pendingInvitationListResponseSchema,
    { params: { organizationId }, query: { limit, offset } },
  );
}
