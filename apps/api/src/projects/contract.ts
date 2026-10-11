import { createRoute } from "@hono/zod-openapi";
import {
  createProjectRequestSchema,
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
};
