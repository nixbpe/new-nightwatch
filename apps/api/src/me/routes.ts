import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  activeOrganizationInputSchema,
  errorResponseSchema,
  meContextResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError, createLogger, type Logger } from "@nightwatch/shared";

import type { Auth } from "../auth";
import {
  getMeContext,
  requireVerifiedSession,
  resolveActiveOrganization,
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

const resolveActiveOrgRoute = createRoute({
  method: "post",
  path: "/api/me/resolve-active-org",
  tags: ["me"],
  summary:
    "Resolve account-global active organization after verified authentication",
  description:
    "No selection input. Credentialed browser and native callers must send the configured trusted Origin.",
  responses: {
    200: {
      description:
        "Resolved context, or account-only admission when no membership exists",
      content: { "application/json": { schema: meContextResponseSchema } },
    },
    401: {
      description: "No final authenticated session",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "Email not verified or missing, null or foreign Origin",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    503: {
      description: "Resolution could not converge, retry required",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

export function registerMeRoutes(
  app: OpenAPIHono,
  deps: {
    auth: Auth;
    database: Database;
    trustedOrigin: string;
    logger?: Logger;
  },
): void {
  const logger = deps.logger ?? createLogger({ level: "silent", name: "me" });

  app.openapi(meContextRoute, async (c) => {
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    return getMeContext(deps.database, session).then((body) =>
      c.json(body, 200),
    );
  });

  app.openapi(resolveActiveOrgRoute, async (c) => {
    if (c.req.header("origin") !== deps.trustedOrigin) {
      throw new AppError(403, "ORIGIN_DENIED", "ไม่อนุญาตคำขอจากแหล่งที่มานี้");
    }
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    return c.json(await resolveActiveOrganization(deps.database, session), 200);
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
