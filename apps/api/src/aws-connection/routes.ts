import type { OpenAPIHono } from "@hono/zod-openapi";
import { AppError, type Logger } from "@nightwatch/shared";
import type { ZodError } from "zod";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { awsConnectionRouteDeclarations as routes } from "./contract";
import {
  disconnectOrganizationAwsConnection,
  getOrganizationAwsConnection,
  testOrganizationAwsConnection,
  updateOrganizationAwsConnection,
  type AwsConnectionDeps,
} from "./service";

export type AwsConnectionRouteDeps = AwsConnectionDeps & {
  auth: Auth;
  logger: Logger;
};

// A malformed Role ARN is a field error the form binds to its input (AC-05);
// anything else is the app-wide validation error. No input is echoed (REQ-05).
const invalidInputHook = (
  result:
    { success: true } | { success: false; error: ZodError; target: string },
): undefined => {
  if (result.success) return undefined;
  if (
    result.target === "json" &&
    result.error.issues.some((issue) => issue.path[0] === "roleArn")
  ) {
    throw new AppError(
      400,
      "AWS_ROLE_ARN_INVALID",
      "รูปแบบ Role ARN ไม่ถูกต้อง",
      {
        field: "roleArn",
      },
    );
  }
  throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");
};

function rateLimitedBody(retryAfterSeconds: number) {
  return {
    error: {
      code: "AWS_TEST_RATE_LIMITED" as const,
      message: "ทดสอบการเชื่อมต่อ AWS บ่อยเกินไป ลองใหม่ภายหลัง",
      details: { retryAfterSeconds },
    },
  };
}

export function registerAwsConnectionRoutes(
  app: OpenAPIHono,
  deps: AwsConnectionRouteDeps,
): void {
  const { auth, logger } = deps;

  app.openapi(
    routes.get,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const body = await auditDenials(
        logger,
        session.user.id,
        "organization.aws_connection.read",
        () =>
          getOrganizationAwsConnection(deps, {
            organizationId,
            actorUserId: session.user.id,
          }),
      );
      return c.json(body, 200);
    },
    invalidInputHook,
  );

  app.openapi(
    routes.test,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const request = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const outcome = await auditDenials(
        logger,
        session.user.id,
        "organization.aws_connection.tested",
        () =>
          testOrganizationAwsConnection(
            deps,
            {
              organizationId,
              actorUserId: session.user.id,
              requestId: c.get("requestId"),
            },
            request,
          ),
      );
      if ("retryAfterSeconds" in outcome) {
        return c.json(rateLimitedBody(outcome.retryAfterSeconds), 429, {
          "Retry-After": String(outcome.retryAfterSeconds),
        });
      }
      return c.json(outcome.result, 200);
    },
    invalidInputHook,
  );

  app.openapi(
    routes.put,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const request = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const outcome = await auditDenials(
        logger,
        session.user.id,
        "organization.aws_connection.updated",
        () =>
          updateOrganizationAwsConnection(
            deps,
            {
              organizationId,
              actorUserId: session.user.id,
              requestId: c.get("requestId"),
            },
            request,
          ),
      );
      if ("retryAfterSeconds" in outcome) {
        return c.json(rateLimitedBody(outcome.retryAfterSeconds), 429, {
          "Retry-After": String(outcome.retryAfterSeconds),
        });
      }
      return c.json(outcome.body, 200);
    },
    invalidInputHook,
  );

  app.openapi(
    routes.delete,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const { revision } = c.req.valid("query");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const body = await auditDenials(
        logger,
        session.user.id,
        "organization.aws_connection.disconnected",
        () =>
          disconnectOrganizationAwsConnection(
            deps,
            {
              organizationId,
              actorUserId: session.user.id,
              requestId: c.get("requestId"),
            },
            revision,
          ),
      );
      return c.json(body, 200);
    },
    invalidInputHook,
  );
}
