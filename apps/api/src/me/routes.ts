import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  activeOrganizationInputSchema,
  errorResponseSchema,
  meContextResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { createLogger, type Logger } from "@nightwatch/shared";

import type { Auth } from "../auth";
import {
  getMeContext,
  requireVerifiedSession,
  setActiveOrganization,
} from "./service";

const meContextRoute = createRoute({
  method: "get",
  path: "/api/me/context",
  tags: ["me"],
  summary: "Authenticated context for tenant selection",
  responses: {
    200: {
      description: "Verified session, memberships and active selection",
      content: { "application/json": { schema: meContextResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "Email not verified",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

const activeOrgRoute = createRoute({
  method: "patch",
  path: "/api/me/active-org",
  tags: ["me"],
  summary: "Switch the active organization (membership-verified)",
  request: {
    body: {
      content: {
        "application/json": { schema: activeOrganizationInputSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated context with the new active selection",
      content: { "application/json": { schema: meContextResponseSchema } },
    },
    400: {
      description: "Invalid input",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    401: {
      description: "No valid session",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "Email not verified or not an organization member",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

/**
 * HTTP translation for the organization access boundary. Mounts at
 * /api/me/*; credentialed CORS for these paths is applied by the app
 * composer alongside the other auth-adjacent routes.
 */
export function registerMeRoutes(
  app: OpenAPIHono,
  deps: { auth: Auth; database: Database; logger?: Logger },
): void {
  const logger = deps.logger ?? createLogger({ level: "silent", name: "me" });

  app.openapi(meContextRoute, async (c) => {
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    return getMeContext(deps.database, session).then((body) =>
      c.json(body, 200),
    );
  });

  app.openapi(activeOrgRoute, async (c) => {
    const { organizationId } = c.req.valid("json");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    return setActiveOrganization(
      deps.database,
      logger,
      session,
      organizationId,
    ).then((body) => c.json(body, 200));
  });
}
