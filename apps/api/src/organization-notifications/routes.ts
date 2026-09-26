import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Database } from "@nightwatch/db";
import { AppError, type AuthEnv, type Logger } from "@nightwatch/shared";
import { z } from "zod";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { notificationRouteDeclarations } from "../notifications/contract";
import { invalidInputHook } from "../notifications/invalid-input";
import {
  leaveOrganization,
  revokeOrganizationMember,
  updateOrganizationMemberRole,
} from "./members";
import {
  getOrganizationNotificationSettings,
  updateOrganizationNotificationSettings,
} from "./service";

/** App-owned guard installed before Better Auth's native organization routes. */
export type NativeOrganizationMutationGuard = MiddlewareHandler;

export function createNativeOrganizationMutationGuard(): NativeOrganizationMutationGuard {
  return async (c, next) => {
    if (
      c.req.method === "POST" &&
      [
        "/api/auth/organization/update-member-role",
        "/api/auth/organization/remove-member",
        "/api/auth/organization/leave",
      ].includes(c.req.path)
    ) {
      return c.json(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: "ใช้เส้นทางจัดการสมาชิกใหม่",
          },
        },
        403,
      );
    }
    await next();
  };
}

const DENIAL_CODES = new Set(["MEMBERSHIP_DENIED", "PERMISSION_DENIED"]);

/**
 * Audits organization authorization denials (REQ-05/ORG-05) with the actor
 * and action only — never the target organization or member data.
 */
async function auditDenials<T>(
  logger: Logger,
  actorUserId: string,
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError && DENIAL_CODES.has(error.code)) {
      logger.warn(
        { actorUserId, action, code: error.code },
        "organization access denied",
      );
    }
    throw error;
  }
}

const memberParamsSchema = z.object({
  organizationId: z.uuid(),
  memberId: z.uuid(),
});
const memberResponseSchema = z.object({
  member: z.object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.uuid(),
    role: z.enum(["owner", "admin", "viewer", "auditor"]),
  }),
});
const memberRoleUpdateRoute = createRoute({
  method: "patch",
  path: "/api/organizations/{organizationId}/members/{memberId}/role",
  tags: ["organizations"],
  request: {
    params: memberParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            role: z.enum(["owner", "admin", "viewer", "auditor"]),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated member",
      content: { "application/json": { schema: memberResponseSchema } },
    },
  },
});
const memberRevokeRoute = createRoute({
  method: "delete",
  path: "/api/organizations/{organizationId}/members/{memberId}",
  tags: ["organizations"],
  request: { params: memberParamsSchema },
  responses: {
    200: {
      description: "Revoked member",
      content: { "application/json": { schema: memberResponseSchema } },
    },
  },
});

const memberSelfLeaveRoute = createRoute({
  method: "delete",
  path: "/api/organizations/{organizationId}/members/me",
  tags: ["organizations"],
  request: { params: z.object({ organizationId: z.uuid() }) },
  responses: {
    200: {
      description: "Left organization",
      content: { "application/json": { schema: memberResponseSchema } },
    },
  },
});

/**
 * Registers only first-party organization notification-settings endpoints.
 * The app composer owns mounting beside Better Auth and supplies its existing
 * CORS policy.
 */
export function registerOrganizationNotificationSettingsRoutes(
  app: OpenAPIHono,
  deps: { auth: Auth; authEnv: AuthEnv; database: Database; logger: Logger },
): void {
  app.openapi(
    notificationRouteDeclarations.getSettings,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const body = await auditDenials(
        deps.logger,
        session.user.id,
        "organization.notification-settings.read",
        () =>
          getOrganizationNotificationSettings(deps.database, {
            organizationId,
            userId: session.user.id,
          }),
      );
      return c.json(body, 200);
    },
    invalidInputHook,
  );

  app.openapi(
    notificationRouteDeclarations.updateSettings,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const update = c.req.valid("json");
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const body = await auditDenials(
        deps.logger,
        session.user.id,
        "organization.notification-settings.update",
        () =>
          updateOrganizationNotificationSettings(deps.database, {
            organizationId,
            userId: session.user.id,
            actorDisplayName: session.user.name,
            update,
          }),
      );
      return c.json(body, 200);
    },
    invalidInputHook,
  );
}

export function registerOrganizationMemberRoutes(
  app: OpenAPIHono,
  deps: { auth: Auth; database: Database; logger: Logger },
): void {
  app.openapi(memberRoleUpdateRoute, async (c) => {
    const { organizationId, memberId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    const member = await auditDenials(
      deps.logger,
      session.user.id,
      "organization.member.role.update",
      () =>
        updateOrganizationMemberRole(deps.database, {
          organizationId,
          actorUserId: session.user.id,
          memberId,
          role,
        }),
    );
    return c.json({ member }, 200);
  });

  app.openapi(memberSelfLeaveRoute, async (c) => {
    const { organizationId } = c.req.valid("param");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    const member = await auditDenials(
      deps.logger,
      session.user.id,
      "organization.member.leave",
      () =>
        leaveOrganization(deps.database, {
          organizationId,
          actorUserId: session.user.id,
        }),
    );
    return c.json({ member }, 200);
  });

  app.openapi(memberRevokeRoute, async (c) => {
    const { organizationId, memberId } = c.req.valid("param");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    const member = await auditDenials(
      deps.logger,
      session.user.id,
      "organization.member.revoke",
      () =>
        revokeOrganizationMember(deps.database, {
          organizationId,
          actorUserId: session.user.id,
          memberId,
        }),
    );
    return c.json({ member }, 200);
  });
}
