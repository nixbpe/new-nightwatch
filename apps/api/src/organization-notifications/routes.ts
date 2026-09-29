import {
  invitationCreateInputSchema,
  invitationCreateResponseSchema,
  organizationMemberListQuerySchema,
  organizationMemberListResponseSchema,
} from "@nightwatch/api-contract";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Database } from "@nightwatch/db";
import { AppError, type AuthEnv, type Logger } from "@nightwatch/shared";
import { z } from "zod";

import type { Auth } from "../auth";
import { buildInvitationEmail } from "../auth/emails";
import type { Mailer } from "../auth/mailer";
import { requireVerifiedSession } from "../me/service";
import { notificationRouteDeclarations } from "../notifications/contract";
import { invalidInputHook } from "../notifications/invalid-input";
import { createOrganizationInvitation } from "./invitations";
import {
  leaveOrganization,
  listOrganizationMembers,
  revokeOrganizationMember,
  updateOrganizationMemberRole,
} from "./members";
import {
  getOrganizationNotificationSettings,
  updateOrganizationNotificationSettings,
} from "./service";

// Must be installed before Better Auth's native organization routes.
export type NativeOrganizationMutationGuard = MiddlewareHandler;

export function createNativeOrganizationMutationGuard(deps: {
  auth: Auth;
  logger: Logger;
}): NativeOrganizationMutationGuard {
  return async (c, next) => {
    if (
      c.req.method === "POST" &&
      [
        "/api/auth/organization/update-member-role",
        "/api/auth/organization/remove-member",
        "/api/auth/organization/leave",
        "/api/auth/organization/invite-member",
        "/api/auth/organization/accept-invitation",
      ].includes(c.req.path)
    ) {
      const session = await deps.auth.getSession(c.req.raw.headers);
      deps.logger.warn(
        {
          actorUserId: session?.user.id ?? null,
          action: `legacy:${c.req.path}`,
          code: "PERMISSION_DENIED",
        },
        "organization access denied",
      );
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

// Logs actor and action only, never the target organization or member data.
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
// Member IDs are opaque text (column type `text`); only Organization IDs are UUIDs.
const memberRoleParamsSchema = memberParamsSchema.extend({
  memberId: z.string().min(1),
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
    params: memberRoleParamsSchema,
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

const memberListRoute = createRoute({
  method: "get",
  path: "/api/organizations/{organizationId}/members",
  tags: ["organizations"],
  request: {
    params: z.object({ organizationId: z.uuid() }),
    query: organizationMemberListQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated organization members",
      content: {
        "application/json": { schema: organizationMemberListResponseSchema },
      },
    },
  },
});

const invitationCreateRoute = createRoute({
  method: "post",
  path: "/api/organizations/{organizationId}/invitations",
  tags: ["organizations"],
  request: {
    params: z.object({ organizationId: z.uuid() }),
    body: {
      content: { "application/json": { schema: invitationCreateInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Invitation persisted; SMTP transport result",
      content: {
        "application/json": { schema: invitationCreateResponseSchema },
      },
    },
  },
});

export function registerOrganizationInvitationRoutes(
  app: OpenAPIHono,
  deps: {
    auth: Auth;
    authEnv: AuthEnv;
    database: Database;
    logger: Logger;
    mailer: Mailer;
  },
): void {
  app.openapi(invitationCreateRoute, async (c) => {
    const { organizationId } = c.req.valid("param");
    const { email, role } = c.req.valid("json");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    const invitation = await auditDenials(
      deps.logger,
      session.user.id,
      "organization.invitation.create",
      () =>
        createOrganizationInvitation(deps.database, {
          organizationId,
          actorUserId: session.user.id,
          email,
          role,
        }),
    );
    const message = buildInvitationEmail(deps.authEnv, {
      organizationName: invitation.organizationName,
      invitationId: invitation.id,
      inviterName: session.user.name,
      role,
    });
    try {
      await deps.mailer.send({ ...message, to: invitation.email });
      return c.json({ created: true, emailDispatch: "accepted" as const }, 201);
    } catch {
      deps.logger.warn(
        { action: "organization.invitation.send", code: "SMTP_FAILED" },
        "invitation mail failed",
      );
      return c.json({ created: true, emailDispatch: "failed" as const }, 201);
    }
  });
}

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
  app.openapi(memberListRoute, async (c) => {
    const { organizationId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    const body = await auditDenials(
      deps.logger,
      session.user.id,
      "organization.member.list",
      () =>
        listOrganizationMembers(deps.database, {
          organizationId,
          actorUserId: session.user.id,
          limit,
          offset,
        }),
    );
    return c.json(body, 200);
  });
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
