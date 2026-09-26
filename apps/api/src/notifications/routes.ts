import { type OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@nightwatch/db";
import type { AuthEnv } from "@nightwatch/shared";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { notificationRouteDeclarations } from "./contract";
import { invalidInputHook } from "./invalid-input";
import {
  countUnreadInbox,
  listInbox,
  markAllInboxRead,
  markInboxItemRead,
  openInboxItem,
} from "./service";

/** Registers only inbox operations; organization settings belong to N3. */
export function registerNotificationInboxRoutes(
  app: OpenAPIHono,
  deps: { auth: Auth; authEnv: AuthEnv; database: Database },
): void {
  const serviceDeps = {
    database: deps.database,
    cursorSecret: deps.authEnv.BETTER_AUTH_SECRET,
  };
  app.openapi(
    notificationRouteDeclarations.list,
    async (c) => {
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const { limit, cursor } = c.req.valid("query");
      return c.json(
        await listInbox(serviceDeps, {
          userId: session.user.id,
          sessionToken: session.session.token,
          limit,
          cursor,
        }),
        200,
      );
    },
    invalidInputHook,
  );
  app.openapi(notificationRouteDeclarations.unreadCount, async (c) => {
    const session = await requireVerifiedSession(deps.auth, c.req.raw.headers);
    return c.json(
      await countUnreadInbox(serviceDeps, {
        userId: session.user.id,
        sessionToken: session.session.token,
      }),
      200,
    );
  });
  app.openapi(
    notificationRouteDeclarations.open,
    async (c) => {
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const { id } = c.req.valid("param");
      return c.json(
        await openInboxItem(serviceDeps, {
          userId: session.user.id,
          sessionToken: session.session.token,
          itemId: id,
        }),
        200,
      );
    },
    invalidInputHook,
  );
  app.openapi(
    notificationRouteDeclarations.markRead,
    async (c) => {
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const { id } = c.req.valid("param");
      return c.json(
        await markInboxItemRead(serviceDeps, {
          userId: session.user.id,
          sessionToken: session.session.token,
          itemId: id,
        }),
        200,
      );
    },
    invalidInputHook,
  );
  app.openapi(
    notificationRouteDeclarations.markAllRead,
    async (c) => {
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const { expectedOrganizationId } = c.req.valid("json");
      return c.json(
        await markAllInboxRead(serviceDeps, {
          userId: session.user.id,
          sessionToken: session.session.token,
          expectedOrganizationId,
        }),
        200,
      );
    },
    invalidInputHook,
  );
}
