import { createRoute } from "@hono/zod-openapi";
import {
  credentialsUnavailableErrorResponseSchema,
  emailNotVerifiedErrorResponseSchema,
  invalidInputErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  monitorCreateSchema,
  monitorEditSchema,
  monitorInvalidErrorResponseSchema,
  monitorLimitReachedErrorResponseSchema,
  monitorNotFoundErrorResponseSchema,
  monitorOrganizationParamsSchema,
  monitorParamsSchema,
  monitorSecretOriginChangedErrorResponseSchema,
  monitorTargetBlockedErrorResponseSchema,
  monitorVersionConflictErrorResponseSchema,
  monitorWriteResponseSchema,
  permissionDeniedErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
  unsupportedMediaTypeErrorResponseSchema,
} from "@nightwatch/api-contract";
import { z } from "zod";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const invalidResponse = jsonError(
  "Invalid monitor input",
  z.union([monitorInvalidErrorResponseSchema, invalidInputErrorResponseSchema]),
);
const mediaTypeResponse = jsonError(
  "The request body is not JSON",
  unsupportedMediaTypeErrorResponseSchema,
);
const authResponses = {
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified, membership is denied, or permission is denied",
    z.union([
      emailNotVerifiedErrorResponseSchema,
      membershipDeniedErrorResponseSchema,
      permissionDeniedErrorResponseSchema,
    ]),
  ),
} as const;
const notFoundResponse = jsonError(
  "The monitor does not exist, is malformed or belongs to another Organization",
  monitorNotFoundErrorResponseSchema,
);

const credentialsResponse = jsonError(
  "Credential encryption is not configured, so secret values cannot be stored or read",
  credentialsUnavailableErrorResponseSchema,
);

const monitorBase = "/api/organizations/{organizationId}/monitors";
const tags = ["monitors"];

export const monitorWriteRouteDeclarations = {
  create: createRoute({
    method: "post",
    path: monitorBase,
    tags,
    summary: "Create a monitor",
    request: {
      params: monitorOrganizationParamsSchema,
      body: {
        content: { "application/json": { schema: monitorCreateSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "Created, or the original monitor of a replayed request",
        content: { "application/json": { schema: monitorWriteResponseSchema } },
      },
      400: invalidResponse,
      415: mediaTypeResponse,
      ...authResponses,
      409: jsonError(
        "The Organization is at its monitor limit",
        monitorLimitReachedErrorResponseSchema,
      ),
      422: jsonError(
        "The host is or resolves to a forbidden address",
        monitorTargetBlockedErrorResponseSchema,
      ),
      503: credentialsResponse,
    },
  }),
  edit: createRoute({
    method: "patch",
    path: `${monitorBase}/{monitorId}`,
    tags,
    summary: "Replace the configuration of a monitor",
    request: {
      params: monitorParamsSchema,
      body: {
        content: { "application/json": { schema: monitorEditSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Updated monitor",
        content: { "application/json": { schema: monitorWriteResponseSchema } },
      },
      400: invalidResponse,
      415: mediaTypeResponse,
      ...authResponses,
      404: notFoundResponse,
      409: jsonError(
        "The expected version is stale",
        monitorVersionConflictErrorResponseSchema,
      ),
      422: jsonError(
        "The host is or resolves to a forbidden address, or the scheme, host or port changed while a secret is kept",
        z.union([
          monitorTargetBlockedErrorResponseSchema,
          monitorSecretOriginChangedErrorResponseSchema,
        ]),
      ),
      503: credentialsResponse,
    },
  }),
  pause: createRoute({
    method: "post",
    path: `${monitorBase}/{monitorId}/pause`,
    tags,
    summary: "Pause a monitor (idempotent)",
    request: { params: monitorParamsSchema },
    responses: {
      200: {
        description: "The monitor, paused",
        content: { "application/json": { schema: monitorWriteResponseSchema } },
      },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  resume: createRoute({
    method: "post",
    path: `${monitorBase}/{monitorId}/resume`,
    tags,
    summary: "Resume a monitor (idempotent)",
    request: { params: monitorParamsSchema },
    responses: {
      200: {
        description: "The monitor, active",
        content: { "application/json": { schema: monitorWriteResponseSchema } },
      },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
  delete: createRoute({
    method: "delete",
    path: `${monitorBase}/{monitorId}`,
    tags,
    summary: "Delete a monitor and its history",
    request: { params: monitorParamsSchema },
    responses: {
      204: { description: "Deleted" },
      400: invalidResponse,
      ...authResponses,
      404: notFoundResponse,
    },
  }),
} as const;
