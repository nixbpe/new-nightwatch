import { createRoute } from "@hono/zod-openapi";
import {
  addProjectMembersRequestSchema,
  addProjectMembersResponseSchema,
  createProjectRequestSchema,
  lastProjectAdminErrorResponseSchema,
  projectDetailSchema,
  projectMemberCandidatesQuerySchema,
  projectMemberCandidatesResponseSchema,
  projectMemberListResponseSchema,
  projectMemberNotFoundErrorResponseSchema,
  projectMemberNotInOrganizationErrorResponseSchema,
  projectMemberParamsSchema,
  projectMemberSchema,
  updateProjectMemberRequestSchema,
  emailNotVerifiedErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  permissionDeniedErrorResponseSchema,
  projectLimitReachedErrorResponseSchema,
  projectListResponseSchema,
  projectNotFoundErrorResponseSchema,
  projectOrganizationParamsSchema,
  projectParamsSchema,
  projectSlugTakenErrorResponseSchema,
  projectSummarySchema,
  projectValidationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
  unsupportedMediaTypeErrorResponseSchema,
  updateProjectRequestSchema,
} from "@nightwatch/api-contract";
import type { z } from "zod";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const invalidResponse = jsonError(
  "Invalid project input",
  projectValidationErrorResponseSchema,
);
const mediaTypeResponse = jsonError(
  "The request body is not JSON",
  unsupportedMediaTypeErrorResponseSchema,
);
const authResponses = {
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified, membership is denied, or permission is denied",
    // Typed as a union through the shared helper's schemas.
    emailNotVerifiedErrorResponseSchema
      .or(membershipDeniedErrorResponseSchema)
      .or(permissionDeniedErrorResponseSchema),
  ),
} as const;
const notFoundResponse = jsonError(
  "The Project does not exist, is in another Organization, or is not visible to the user",
  projectNotFoundErrorResponseSchema,
);

const projectsBase = "/api/organizations/{organizationId}/projects";
const tags = ["projects"];

export const projectRouteDeclarations = {
  list: createRoute({
    method: "get",
    path: projectsBase,
    tags,
    summary: "List the Projects the user can see",
    request: { params: projectOrganizationParamsSchema },
    responses: {
      200: {
        description: "Projects, ordered by name",
        content: { "application/json": { schema: projectListResponseSchema } },
      },
      400: invalidResponse,
      ...authResponses,
    },
  }),
  create: createRoute({
    method: "post",
    path: projectsBase,
    tags,
    summary: "Create a Project; the creator becomes its administrator",
    request: {
      params: projectOrganizationParamsSchema,
      body: {
        content: { "application/json": { schema: createProjectRequestSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "Created Project",
        content: { "application/json": { schema: projectSummarySchema } },
      },
      400: invalidResponse,
      415: mediaTypeResponse,
      ...authResponses,
      409: jsonError(
        "The slug is taken in the Organization, or the Organization is at its Project limit",
        projectSlugTakenErrorResponseSchema.or(
          projectLimitReachedErrorResponseSchema,
        ),
      ),
    },
  }),
  update: createRoute({
    method: "patch",
    path: `${projectsBase}/{projectId}`,
    tags,
    summary: "Change the name or description of a Project (idempotent)",
    request: {
      params: projectParamsSchema,
      body: {
        content: { "application/json": { schema: updateProjectRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The Project, changed or as it was",
        content: { "application/json": { schema: projectSummarySchema } },
      },
      400: invalidResponse,
      415: mediaTypeResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  delete: createRoute({
    method: "delete",
    path: `${projectsBase}/{projectId}`,
    tags,
    summary: "Delete a Project and everything that belongs to it",
    request: { params: projectParamsSchema },
    responses: {
      204: { description: "Deleted" },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  get: createRoute({
    method: "get",
    path: `${projectsBase}/{projectId}`,
    tags,
    summary: "Read one Project the user can see, with its administrator count",
    request: { params: projectParamsSchema },
    responses: {
      200: {
        description: "The Project",
        content: { "application/json": { schema: projectDetailSchema } },
      },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  listMembers: createRoute({
    method: "get",
    path: `${projectsBase}/{projectId}/members`,
    tags,
    summary: "List the members of a Project, administrators first",
    request: { params: projectParamsSchema },
    responses: {
      200: {
        description: "Members, administrators first, then by name",
        content: {
          "application/json": { schema: projectMemberListResponseSchema },
        },
      },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  memberCandidates: createRoute({
    method: "get",
    path: `${projectsBase}/{projectId}/member-candidates`,
    tags,
    summary:
      "Search Organization members to add; projectRole is null for one who is not in the Project",
    request: {
      params: projectParamsSchema,
      query: projectMemberCandidatesQuerySchema,
    },
    responses: {
      200: {
        description: "At most 50 Organization members, sorted by name",
        content: {
          "application/json": {
            schema: projectMemberCandidatesResponseSchema,
          },
        },
      },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  addMembers: createRoute({
    method: "post",
    path: `${projectsBase}/{projectId}/members`,
    tags,
    summary:
      "Add Organization members to a Project (idempotent: existing members keep their role)",
    request: {
      params: projectParamsSchema,
      body: {
        content: {
          "application/json": { schema: addProjectMembersRequestSchema },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description:
          "All members of the Project after the change, and the users this request added",
        content: {
          "application/json": { schema: addProjectMembersResponseSchema },
        },
      },
      400: invalidResponse,
      415: mediaTypeResponse,
      ...authResponses,
      404: notFoundResponse,
      422: jsonError(
        "A user is not a member of the Organization; nothing was added",
        projectMemberNotInOrganizationErrorResponseSchema,
      ),
    },
  }),
  updateMember: createRoute({
    method: "patch",
    path: `${projectsBase}/{projectId}/members/{userId}`,
    tags,
    summary: "Change a member's Project role (idempotent)",
    request: {
      params: projectMemberParamsSchema,
      body: {
        content: {
          "application/json": { schema: updateProjectMemberRequestSchema },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The member, changed or as it was",
        content: { "application/json": { schema: projectMemberSchema } },
      },
      400: invalidResponse,
      415: mediaTypeResponse,
      ...authResponses,
      404: jsonError(
        "The Project is not visible to the user, or the user is not in the Project",
        projectNotFoundErrorResponseSchema.or(
          projectMemberNotFoundErrorResponseSchema,
        ),
      ),
      409: jsonError(
        "The change would leave the Project without an administrator",
        lastProjectAdminErrorResponseSchema,
      ),
    },
  }),
  removeMember: createRoute({
    method: "delete",
    path: `${projectsBase}/{projectId}/members/{userId}`,
    tags,
    summary: "Remove a member from a Project",
    request: { params: projectMemberParamsSchema },
    responses: {
      204: { description: "Removed" },
      400: invalidResponse,
      ...authResponses,
      404: jsonError(
        "The Project is not visible to the user, or the user is not in the Project",
        projectNotFoundErrorResponseSchema.or(
          projectMemberNotFoundErrorResponseSchema,
        ),
      ),
      409: jsonError(
        "The removal would leave the Project without an administrator",
        lastProjectAdminErrorResponseSchema,
      ),
    },
  }),
};
