import { createRoute } from "@hono/zod-openapi";
import {
  awsConnectionRevisionConflictErrorResponseSchema,
  awsConnectionTestFailedErrorResponseSchema,
  awsRoleArnInvalidErrorResponseSchema,
  awsTestRateLimitedErrorResponseSchema,
  emailNotVerifiedErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  organizationAwsConnectionDeleteQuerySchema,
  organizationAwsConnectionParamsSchema,
  organizationAwsConnectionRequestSchema,
  organizationAwsConnectionResponseSchema,
  organizationAwsConnectionTestResponseSchema,
  permissionDeniedErrorResponseSchema,
  projectValidationErrorResponseSchema,
  rateLimitUnavailableErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
  unsupportedMediaTypeErrorResponseSchema,
} from "@nightwatch/api-contract";
import type { z } from "zod";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const path = "/api/organizations/{organizationId}/aws-connection";
const tags = ["organizations"];

const connectionResponse = {
  description:
    "The External ID, the saved connection and the assume-role Projects that use it",
  content: {
    "application/json": { schema: organizationAwsConnectionResponseSchema },
  },
} as const;
const authResponses = {
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified, membership is denied, or the user is not an Organization Owner or Admin; no settings data",
    emailNotVerifiedErrorResponseSchema
      .or(membershipDeniedErrorResponseSchema)
      .or(permissionDeniedErrorResponseSchema),
  ),
} as const;
const invalidResponse = jsonError(
  "The Role ARN is malformed (field error), or the request fails its schema",
  awsRoleArnInvalidErrorResponseSchema.or(projectValidationErrorResponseSchema),
);
const mediaTypeResponse = jsonError(
  "The request body is not JSON",
  unsupportedMediaTypeErrorResponseSchema,
);
const conflictResponse = jsonError(
  "The connection changed since the given revision; reload",
  awsConnectionRevisionConflictErrorResponseSchema,
);
const rateLimitedResponse = jsonError(
  "AWS test quota reached; Retry-After carries the wait in seconds. STS was not called",
  awsTestRateLimitedErrorResponseSchema,
);
const limiterUnavailableResponse = jsonError(
  "The rate limiter is unavailable; STS was not called",
  rateLimitUnavailableErrorResponseSchema,
);
const requestBody = {
  content: {
    "application/json": { schema: organizationAwsConnectionRequestSchema },
  },
  required: true,
} as const;

export const awsConnectionRouteDeclarations = {
  get: createRoute({
    method: "get",
    path,
    tags,
    summary:
      "Read the Organization AWS connection; creates the External ID on first read",
    request: { params: organizationAwsConnectionParamsSchema },
    responses: {
      200: connectionResponse,
      400: invalidResponse,
      ...authResponses,
    },
  }),
  test: createRoute({
    method: "post",
    path: `${path}/test`,
    tags,
    summary:
      "Test a Role ARN with STS AssumeRole and GetCallerIdentity; saves nothing",
    request: {
      params: organizationAwsConnectionParamsSchema,
      body: requestBody,
    },
    responses: {
      200: {
        description:
          "The test result; a failure carries a fixed code, never AWS text",
        content: {
          "application/json": {
            schema: organizationAwsConnectionTestResponseSchema,
          },
        },
      },
      400: invalidResponse,
      ...authResponses,
      409: conflictResponse,
      415: mediaTypeResponse,
      429: rateLimitedResponse,
      503: limiterUnavailableResponse,
    },
  }),
  put: createRoute({
    method: "put",
    path,
    tags,
    summary:
      "Save a Role ARN after the server tests it again; a failed test keeps the saved value",
    request: {
      params: organizationAwsConnectionParamsSchema,
      body: requestBody,
    },
    responses: {
      200: connectionResponse,
      400: invalidResponse,
      ...authResponses,
      409: conflictResponse,
      415: mediaTypeResponse,
      422: jsonError(
        "The server's test failed; nothing was saved",
        awsConnectionTestFailedErrorResponseSchema,
      ),
      429: rateLimitedResponse,
      503: limiterUnavailableResponse,
    },
  }),
  delete: createRoute({
    method: "delete",
    path,
    tags,
    summary:
      "Disconnect the Organization account; the External ID and Project settings stay",
    request: {
      params: organizationAwsConnectionParamsSchema,
      query: organizationAwsConnectionDeleteQuerySchema,
    },
    responses: {
      200: connectionResponse,
      400: invalidResponse,
      ...authResponses,
      409: conflictResponse,
    },
  }),
} as const;
