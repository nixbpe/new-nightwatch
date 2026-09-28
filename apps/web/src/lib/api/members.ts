import {
  organizationMemberListResponseSchema,
  organizationRoleSchema,
  type OrganizationMemberListResponse,
  type OrganizationRole,
} from "@nightwatch/api-contract";
import { z } from "zod";

import { request } from "./client";
const roleUpdateResponseSchema = z.object({
  member: z.object({
    id: z.string().min(1),
    userId: z.string().min(1),
    organizationId: z.uuid(),
    role: organizationRoleSchema,
  }),
});

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

export async function updateOrganizationMemberRole(
  organizationId: string,
  memberId: string,
  role: OrganizationRole,
) {
  const result = await request(
    "/api/organizations/{organizationId}/members/{memberId}/role",
    roleUpdateResponseSchema,
    { method: "PATCH", params: { organizationId, memberId }, body: { role } },
  );
  return roleUpdateResponseSchema.parse(result);
}
