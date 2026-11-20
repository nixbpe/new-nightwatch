import {
  organizationAwsConnectionRequestSchema,
  organizationAwsConnectionResponseSchema,
  organizationAwsConnectionTestResponseSchema,
  type OrganizationAwsConnectionRequest,
} from "@nightwatch/api-contract";

import { request } from "./client";

export const organizationAwsConnectionQueryKey = (organizationId: string) =>
  ["tenant", "aws-connection", organizationId] as const;

export function fetchOrganizationAwsConnection(organizationId: string) {
  return request(
    "/api/organizations/{organizationId}/aws-connection",
    organizationAwsConnectionResponseSchema,
    { params: { organizationId } },
  );
}

export function testOrganizationAwsConnection(
  organizationId: string,
  input: OrganizationAwsConnectionRequest,
) {
  return request(
    "/api/organizations/{organizationId}/aws-connection/test",
    organizationAwsConnectionTestResponseSchema,
    {
      method: "POST",
      params: { organizationId },
      body: organizationAwsConnectionRequestSchema.parse(input),
    },
  );
}

export function saveOrganizationAwsConnection(
  organizationId: string,
  input: OrganizationAwsConnectionRequest,
) {
  return request(
    "/api/organizations/{organizationId}/aws-connection",
    organizationAwsConnectionResponseSchema,
    {
      method: "PUT",
      params: { organizationId },
      body: organizationAwsConnectionRequestSchema.parse(input),
    },
  );
}

export function disconnectOrganizationAwsConnection(
  organizationId: string,
  revision: number,
) {
  return request(
    "/api/organizations/{organizationId}/aws-connection",
    organizationAwsConnectionResponseSchema,
    { method: "DELETE", params: { organizationId }, query: { revision } },
  );
}
