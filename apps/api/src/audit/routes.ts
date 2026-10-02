import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  auditEventNotFoundErrorResponseSchema,
  auditLogActorsResponseSchema,
  auditLogEventParamsSchema,
  auditLogEventResponseSchema,
  auditLogListQuerySchema,
  auditLogListResponseSchema,
  auditLogOrganizationParamsSchema,
  auditValidationErrorResponseSchema,
  emailNotVerifiedErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  permissionDeniedErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";
import { z } from "zod";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { auditDenials } from "./denials";
import {
  getAuditEvent,
  listAuditActors,
  listAuditEvents,
} from "./read-service";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const readErrors = {
  400: jsonError("Invalid query", auditValidationErrorResponseSchema),
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified, membership is denied or the role may not read the log",
    z.union([
      emailNotVerifiedErrorResponseSchema,
      membershipDeniedErrorResponseSchema,
      permissionDeniedErrorResponseSchema,
    ]),
  ),
} as const;

const base = "/api/organizations/{organizationId}/audit-log";
const tags = ["audit-log"];

export const auditLogReadRouteDeclarations = {
  list: createRoute({
    method: "get",
    path: `${base}/events`,
    tags,
    summary: "List audit events, newest first",
    request: {
      params: auditLogOrganizationParamsSchema,
      query: auditLogListQuerySchema,
    },
    responses: {
      200: {
        description: "One page of events inside the retention window",
        content: {
          "application/json": { schema: auditLogListResponseSchema },
        },
      },
      ...readErrors,
    },
  }),
  detail: createRoute({
    method: "get",
    path: `${base}/events/{eventId}`,
    tags,
    summary: "One audit event with its changes",
    request: { params: auditLogEventParamsSchema },
    responses: {
      200: {
        description: "The event",
        content: {
          "application/json": { schema: auditLogEventResponseSchema },
        },
      },
      ...readErrors,
      404: jsonError(
        "The event does not exist, is malformed, is past retention or belongs to another Organization",
        auditEventNotFoundErrorResponseSchema,
      ),
    },
  }),
  actors: createRoute({
    method: "get",
    path: `${base}/actors`,
    tags,
    summary: "Actors that have at least one retained event",
    request: { params: auditLogOrganizationParamsSchema },
    responses: {
      200: {
        description: "Distinct actors, by name then user id",
        content: {
          "application/json": { schema: auditLogActorsResponseSchema },
        },
      },
      ...readErrors,
    },
  }),
} as const;

export type AuditLogRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
};

export function registerAuditLogReadRoutes(
  app: OpenAPIHono,
  deps: AuditLogRouteDeps,
): void {
  const { auth, database, logger } = deps;
  const routes = auditLogReadRouteDeclarations;

  app.openapi(routes.list, async (c) => {
    const { organizationId } = c.req.valid("param");
    const query = c.req.valid("query");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.list",
      () => listAuditEvents(database, { organizationId, actorUserId }, query),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.detail, async (c) => {
    const { organizationId, eventId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.read",
      () => getAuditEvent(database, { organizationId, actorUserId }, eventId),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.actors, async (c) => {
    const { organizationId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.actors",
      () => listAuditActors(database, { organizationId, actorUserId }),
    );
    return c.json(body, 200);
  });
}
