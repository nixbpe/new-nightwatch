import {
  awsOrganizationSchema,
  awsProjectSchema,
  awsTestResultSchema,
} from "@nightwatch/api-contract";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request } from "./client";

const org = "/api/organizations/{organizationId}/aws-connection";
const project =
  "/api/organizations/{organizationId}/projects/{projectId}/aws-connection";
export const awsKeys = {
  all: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "aws", organizationId] as const,
  organization: (organizationId: string) =>
    [...awsKeys.all(organizationId), "organization"] as const,
  project: (organizationId: string, projectId: string) =>
    [...awsKeys.all(organizationId), "project", projectId] as const,
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
export function fetchProjectAws(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(project, awsProjectSchema, {
    params: { organizationId, projectId },
    signal,
  });
}
export function checkProjectAws(
  organizationId: string,
  projectId: string,
  roleArn: string,
  save: boolean,
  signal: AbortSignal,
) {
  const params = { organizationId, projectId };
  const body = { method: "assume_role" as const, roleArn };
  return save
    ? request(project, awsTestResultSchema, {
        method: "PUT",
        params,
        body,
        signal,
      })
    : request(`${project}/test`, awsTestResultSchema, {
        method: "POST",
        params,
        body,
        signal,
      });
}
export function disconnectProjectAws(
  organizationId: string,
  projectId: string,
  signal: AbortSignal,
) {
  return request(project, undefined, {
    method: "DELETE",
    params: { organizationId, projectId },
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
