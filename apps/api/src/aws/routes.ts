import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  awsOrganizationInputSchema,
  awsOrganizationSchema,
  awsProjectInputSchema,
  awsProjectSchema,
  awsTestResultSchema,
  errorResponseSchema,
} from "@nightwatch/api-contract";
import type { Logger } from "@nightwatch/shared";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import {
  checkOrganizationAws,
  disconnectOrganizationAws,
  getOrganizationAws,
  type AwsDeps,
  type OrganizationIdentity,
} from "./organization";
import {
  checkProjectAws,
  disconnectProjectAws,
  getProjectAws,
} from "./project";

const path = "/api/organizations/{organizationId}/aws-connection";
const params = z.object({ organizationId: z.uuid() });
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 503].map((status) => [
    status,
    {
      description: "Request rejected",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  ]),
);
const rateLimited = {
  description: "AWS request quota exceeded",
  content: { "application/json": { schema: errorResponseSchema } },
};
const testResponse = {
  description: "AWS identity verification result",
  content: { "application/json": { schema: awsTestResultSchema } },
};
const testRequest = {
  params,
  body: {
    required: true,
    content: { "application/json": { schema: awsOrganizationInputSchema } },
  },
};
const tags = ["AWS connections"];
const projectPath =
  "/api/organizations/{organizationId}/projects/{projectId}/aws-connection";
const projectParams = params.extend({ projectId: z.string() });

export function registerAwsRoutes(
  app: OpenAPIHono,
  deps: AwsDeps & { auth: Auth; logger: Logger },
) {
  const run = async <T>(
    headers: Headers,
    organizationId: string,
    action: string,
    operation: (input: OrganizationIdentity) => Promise<T>,
    requestId: string,
  ) => {
    const session = await requireVerifiedSession(deps.auth, headers);
    return auditDenials(deps.logger, session.user.id, action, () =>
      operation({ organizationId, actorUserId: session.user.id, requestId }),
    );
  };
  app.openapi(
    createRoute({
      method: "get",
      path,
      tags,
      request: { params },
      responses: {
        ...errors,
        200: {
          description: "Organization AWS settings",
          content: { "application/json": { schema: awsOrganizationSchema } },
        },
      },
    }),
    async (c) =>
      c.json(
        await run(
          c.req.raw.headers,
          c.req.valid("param").organizationId,
          "organization.aws_connection.read",
          (input) => getOrganizationAws(deps, input),
          c.get("requestId"),
        ),
        200,
      ),
  );
  for (const method of ["post", "put"] as const) {
    const route = createRoute({
      method,
      path: method === "post" ? `${path}/test` : path,
      tags,
      request: testRequest,
      responses: { ...errors, 200: testResponse, 429: rateLimited },
    });
    app.openapi(route, async (c) => {
      const result = await run(
        c.req.raw.headers,
        c.req.valid("param").organizationId,
        method === "post"
          ? "organization.aws_connection.test"
          : "organization.aws_connection.update",
        (input) =>
          checkOrganizationAws(
            deps,
            input,
            c.req.valid("json").roleArn,
            method === "put",
          ),
        c.get("requestId"),
      );
      if ("retryAfterSeconds" in result)
        return c.json(
          {
            error: {
              code: "AWS_RATE_LIMITED",
              message: "ทดสอบบ่อยเกินไป โปรดลองใหม่ภายหลัง",
            },
          },
          429,
          { "Retry-After": String(result.retryAfterSeconds) },
        );
      return c.json(result, 200);
    });
  }
  app.openapi(
    createRoute({
      method: "delete",
      path,
      tags,
      request: { params },
      responses: { ...errors, 204: { description: "Disconnected" } },
    }),
    async (c) => {
      await run(
        c.req.raw.headers,
        c.req.valid("param").organizationId,
        "organization.aws_connection.delete",
        (input) => disconnectOrganizationAws(deps, input),
        c.get("requestId"),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: projectPath,
      tags,
      request: { params: projectParams },
      responses: {
        ...errors,
        200: {
          description: "Project AWS connection",
          content: { "application/json": { schema: awsProjectSchema } },
        },
      },
    }),
    async (c) => {
      const { organizationId, projectId } = c.req.valid("param");
      return c.json(
        await run(
          c.req.raw.headers,
          organizationId,
          "organization.project.aws_connection.read",
          (input) => getProjectAws(deps, { ...input, projectId }),
          c.get("requestId"),
        ),
        200,
      );
    },
  );
  for (const method of ["post", "put"] as const) {
    app.openapi(
      createRoute({
        method,
        path: method === "post" ? `${projectPath}/test` : projectPath,
        tags,
        request: {
          params: projectParams,
          body: {
            required: true,
            content: {
              "application/json": { schema: awsProjectInputSchema },
            },
          },
        },
        responses: { ...errors, 200: testResponse, 429: rateLimited },
      }),
      async (c) => {
        const { organizationId, projectId } = c.req.valid("param");
        const result = await run(
          c.req.raw.headers,
          organizationId,
          method === "post"
            ? "organization.project.aws_connection.test"
            : "organization.project.aws_connection.update",
          (input) =>
            checkProjectAws(
              deps,
              { ...input, projectId },
              c.req.valid("json"),
              method === "put",
            ),
          c.get("requestId"),
        );
        if ("retryAfterSeconds" in result)
          return c.json(
            {
              error: {
                code: "AWS_RATE_LIMITED",
                message: "ทดสอบบ่อยเกินไป โปรดลองใหม่ภายหลัง",
              },
            },
            429,
            { "Retry-After": String(result.retryAfterSeconds) },
          );
        return c.json(result, 200);
      },
    );
  }
  app.openapi(
    createRoute({
      method: "delete",
      path: projectPath,
      tags,
      request: { params: projectParams },
      responses: { ...errors, 204: { description: "Disconnected" } },
    }),
    async (c) => {
      const { organizationId, projectId } = c.req.valid("param");
      await run(
        c.req.raw.headers,
        organizationId,
        "organization.project.aws_connection.delete",
        (input) => disconnectProjectAws(deps, { ...input, projectId }),
        c.get("requestId"),
      );
      return c.body(null, 204);
    },
  );
}
