import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  emailNotVerifiedErrorResponseSchema,
  invalidInputErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  monitorListQuerySchema,
  monitorListResponseSchema,
  monitorOrganizationParamsSchema,
  monitorRecentEventsQuerySchema,
  monitorRecentEventsResponseSchema,
  permissionDeniedErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";
import { z } from "zod";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { auditMonitorDenials } from "./audit";
import { monitorInvalidInputHook } from "./invalid-input";
import { listMonitors, listRecentEvents } from "./read-service";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const readErrors = {
  400: jsonError("Invalid query", invalidInputErrorResponseSchema),
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified or membership is denied",
    z.union([
      emailNotVerifiedErrorResponseSchema,
      membershipDeniedErrorResponseSchema,
      permissionDeniedErrorResponseSchema,
    ]),
  ),
} as const;

const monitorBase = "/api/organizations/{organizationId}/monitors";
const tags = ["monitors"];

export const monitorReadRouteDeclarations = {
  list: createRoute({
    method: "get",
    path: monitorBase,
    tags,
    summary: "List monitors with health, SSL level and uptime",
    request: {
      params: monitorOrganizationParamsSchema,
      query: monitorListQuerySchema,
    },
    responses: {
      200: {
        description: "One page of monitors and the Organization summary",
        content: { "application/json": { schema: monitorListResponseSchema } },
      },
      ...readErrors,
    },
  }),
  recentEvents: createRoute({
    method: "get",
    path: `${monitorBase}/recent-events`,
    tags,
    summary: "Recent incidents and SSL levels across the Organization",
    request: {
      params: monitorOrganizationParamsSchema,
      query: monitorRecentEventsQuerySchema,
    },
    responses: {
      200: {
        description: "Events of the last 30 days, newest first",
        content: {
          "application/json": { schema: monitorRecentEventsResponseSchema },
        },
      },
      ...readErrors,
    },
  }),
} as const;

export type MonitorReadRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
};

// GET /monitors/recent-events is registered before every GET /monitors/{monitorId}
// route: monitorId is a plain string and would capture "recent-events".
export function registerMonitorReadRoutes(
  app: OpenAPIHono,
  deps: MonitorReadRouteDeps,
): void {
  const { auth, database, logger } = deps;
  const routes = monitorReadRouteDeclarations;

  app.openapi(
    routes.recentEvents,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const { limit } = c.req.valid("query");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const body = await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.list",
        () =>
          listRecentEvents(database, { organizationId, actorUserId }, limit),
      );
      return c.json(body, 200);
    },
    monitorInvalidInputHook,
  );

  app.openapi(
    routes.list,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const query = c.req.valid("query");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const body = await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.list",
        () => listMonitors(database, { organizationId, actorUserId }, query),
      );
      return c.json(body, 200);
    },
    monitorInvalidInputHook,
  );
}
