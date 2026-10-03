import {
  organizationMemberListResponseSchema,
  organizationMemberRoleUpdateResponseSchema,
  type OrganizationMemberListResponse,
  type OrganizationMemberRoleUpdateResponse,
  type OrganizationRole,
} from "@nightwatch/api-contract";

import { request } from "./client";

export const MEMBER_LIST_QUERY_PREFIX = ["tenant", "members"] as const;

export const memberListQueryKey = (
  organizationId: string,
  limit: number,
  offset: number,
) => [...MEMBER_LIST_QUERY_PREFIX, organizationId, { limit, offset }] as const;

export function fetchOrganizationMembers(
  organizationId: string,
  limit: number,
  offset: number,
): Promise<OrganizationMemberListResponse> {
  return request(
    "/api/organizations/{organizationId}/members",
    organizationMemberListResponseSchema,
    {
      params: { organizationId },
      query: { limit, offset },
    },
  ).then((response) => organizationMemberListResponseSchema.parse(response));
}

export function updateOrganizationMemberRole(
  organizationId: string,
  memberId: string,
  role: OrganizationRole,
): Promise<OrganizationMemberRoleUpdateResponse> {
  return request(
    "/api/organizations/{organizationId}/members/{memberId}/role",
    organizationMemberRoleUpdateResponseSchema,
    { method: "PATCH", params: { organizationId, memberId }, body: { role } },
  );
}

const organizationMemberRevokeResponseSchema =
  organizationMemberRoleUpdateResponseSchema;

export function revokeOrganizationMember(
  organizationId: string,
  memberId: string,
): Promise<OrganizationMemberRoleUpdateResponse> {
  return request(
    "/api/organizations/{organizationId}/members/{memberId}",
    organizationMemberRevokeResponseSchema,
    { method: "DELETE", params: { organizationId, memberId } },
  );
}

export function leaveOrganization(
  organizationId: string,
): Promise<OrganizationMemberRoleUpdateResponse> {
  return request(
    "/api/organizations/{organizationId}/members/me",
    organizationMemberRevokeResponseSchema,
    { method: "DELETE", params: { organizationId } },
  );
}
