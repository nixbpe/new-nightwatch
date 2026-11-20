import {
  awsOrganizationSchema,
  awsTestResultSchema,
} from "@nightwatch/api-contract";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request } from "./client";

const org = "/api/organizations/{organizationId}/aws-connection";
export const awsKeys = {
  all: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "aws", organizationId] as const,
  organization: (organizationId: string) =>
    [...awsKeys.all(organizationId), "organization"] as const,
};
export function fetchOrganizationAws(
  organizationId: string,
  signal?: AbortSignal,
) {
  return request(org, awsOrganizationSchema, {
    params: { organizationId },
    signal,
  });
}
export function checkOrganizationAws(
  organizationId: string,
  roleArn: string,
  save: boolean,
  signal: AbortSignal,
) {
  const params = { organizationId };
  const body = { roleArn };
  return save
    ? request(org, awsTestResultSchema, { method: "PUT", params, body, signal })
    : request(`${org}/test`, awsTestResultSchema, {
        method: "POST",
        params,
        body,
        signal,
      });
}
export function disconnectOrganizationAws(
  organizationId: string,
  signal: AbortSignal,
) {
  return request(org, undefined, {
    method: "DELETE",
    params: { organizationId },
    signal,
  });
}
