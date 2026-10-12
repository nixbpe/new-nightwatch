import {
  addProjectMembersResponseSchema,
  lastProjectResponseSchema,
  rememberedProjectResponseSchema,
  projectDetailSchema,
  projectListResponseSchema,
  projectMemberCandidatesResponseSchema,
  projectMemberListResponseSchema,
  projectMemberSchema,
  projectSummarySchema,
  type AddProjectMembersResponse,
  type addProjectMembersRequestSchema,
  type createProjectRequestSchema,
  type LastProjectResponse,
  type RememberedProjectResponse,
  type ProjectDetail,
  type ProjectListResponse,
  type ProjectMember,
  type ProjectMemberCandidatesResponse,
  type ProjectMemberListResponse,
  type ProjectRole,
  type ProjectSummary,
  type updateProjectRequestSchema,
} from "@nightwatch/api-contract";
import type { z } from "zod";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import { request } from "./client";

// Requests are typed by the schema input: the server trims and normalizes.
export type ProjectCreateBody = z.input<typeof createProjectRequestSchema>;
export type ProjectUpdateBody = z.input<typeof updateProjectRequestSchema>;
export type AddProjectMembersBody = z.input<
  typeof addProjectMembersRequestSchema
>;

// Filters and search stay out of the keys: they are applied in the browser.
export const projectQueryKeys = {
  all: (organizationId: string) =>
    [...TENANT_QUERY_PREFIX, "projects", organizationId] as const,
  list: (organizationId: string) =>
    [...projectQueryKeys.all(organizationId), "list"] as const,
  // The Project to open when the URL names none; changes with a Project switch.
  last: (organizationId: string) =>
    [...projectQueryKeys.all(organizationId), "last"] as const,
  // Detail, members and candidates of one Project; removing it forgets them all.
  project: (organizationId: string, projectId: string) =>
    [...projectQueryKeys.all(organizationId), projectId] as const,
  // Every key below shares `all`, so one invalidation of it also refreshes the list.
  detail: (organizationId: string, projectId: string) =>
    [...projectQueryKeys.all(organizationId), projectId, "detail"] as const,
  members: (organizationId: string, projectId: string) =>
    [...projectQueryKeys.all(organizationId), projectId, "members"] as const,
  candidatesAll: (organizationId: string, projectId: string) =>
    [...projectQueryKeys.all(organizationId), projectId, "candidates"] as const,
  candidates: (organizationId: string, projectId: string, q: string) =>
    [...projectQueryKeys.candidatesAll(organizationId, projectId), q] as const,
};

export function fetchProjectList(
  organizationId: string,
): Promise<ProjectListResponse> {
  return request(
    "/api/organizations/{organizationId}/projects",
    projectListResponseSchema,
    { params: { organizationId } },
  );
}

export function createProject(
  organizationId: string,
  body: ProjectCreateBody,
): Promise<ProjectSummary> {
  return request(
    "/api/organizations/{organizationId}/projects",
    projectSummarySchema,
    { method: "POST", params: { organizationId }, body },
  );
}

export function updateProject(
  organizationId: string,
  projectId: string,
  body: ProjectUpdateBody,
): Promise<ProjectSummary> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}",
    projectSummarySchema,
    { method: "PATCH", params: { organizationId, projectId }, body },
  );
}

export function deleteProject(
  organizationId: string,
  projectId: string,
): Promise<undefined> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}",
    undefined,
    { method: "DELETE", params: { organizationId, projectId } },
  );
}

export function fetchProjectDetail(
  organizationId: string,
  projectId: string,
): Promise<ProjectDetail> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}",
    projectDetailSchema,
    { params: { organizationId, projectId } },
  );
}

export function fetchProjectMembers(
  organizationId: string,
  projectId: string,
): Promise<ProjectMemberListResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/members",
    projectMemberListResponseSchema,
    { params: { organizationId, projectId } },
  );
}

export function fetchProjectMemberCandidates(
  organizationId: string,
  projectId: string,
  q: string,
): Promise<ProjectMemberCandidatesResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/member-candidates",
    projectMemberCandidatesResponseSchema,
    {
      params: { organizationId, projectId },
      query: q === "" ? undefined : { q },
    },
  );
}

export function addProjectMembers(
  organizationId: string,
  projectId: string,
  body: AddProjectMembersBody,
): Promise<AddProjectMembersResponse> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/members",
    addProjectMembersResponseSchema,
    { method: "POST", params: { organizationId, projectId }, body },
  );
}

export function updateProjectMemberRole(
  organizationId: string,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<ProjectMember> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/members/{userId}",
    projectMemberSchema,
    {
      method: "PATCH",
      params: { organizationId, projectId, userId },
      body: { role },
    },
  );
}

export function removeProjectMember(
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<undefined> {
  return request(
    "/api/organizations/{organizationId}/projects/{projectId}/members/{userId}",
    undefined,
    { method: "DELETE", params: { organizationId, projectId, userId } },
  );
}

export function fetchLastProject(
  organizationId: string,
): Promise<LastProjectResponse> {
  return request("/api/me/last-project", lastProjectResponseSchema, {
    query: { organizationId },
  });
}

export function rememberLastProject(
  organizationId: string,
  projectId: string,
): Promise<RememberedProjectResponse> {
  return request("/api/me/last-project", rememberedProjectResponseSchema, {
    method: "PUT",
    body: { organizationId, projectId },
  });
}
