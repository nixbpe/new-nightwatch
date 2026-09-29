import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@nightwatch/db";
import type { Logger, OutboundDeps } from "@nightwatch/shared";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { auditMonitorDenials, auditMonitorMutation } from "./audit";
import { monitorWriteRouteDeclarations as routes } from "./contract";
import { monitorInvalidInputHook } from "./invalid-input";
import {
  createMonitor,
  deleteMonitor,
  editMonitor,
  pauseMonitor,
  resumeMonitor,
} from "./service";

export type MonitorRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
  /** Resolver and test-only host exemptions for save-time checks. */
  outbound?: OutboundDeps;
};

// GET /monitors/recent-events must be registered before GET /monitors/{monitorId}
// (Task 06B): monitorId is a plain string and would capture "recent-events".
export function registerMonitorRoutes(
  app: OpenAPIHono,
  deps: MonitorRouteDeps,
): void {
  const { auth, database, logger, outbound } = deps;

  app.openapi(
    routes.create,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const input = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const { monitor, changed } = await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.create",
        () =>
          createMonitor(database, {
            organizationId,
            actorUserId,
            input,
            outbound,
          }),
      );
      if (changed) {
        auditMonitorMutation(logger, {
          actorUserId,
          action: "organization.monitor.create",
          organizationId,
          monitorId: monitor.id,
        });
      }
      return c.json({ monitor }, 201);
    },
    monitorInvalidInputHook,
  );

  app.openapi(
    routes.edit,
    async (c) => {
      const { organizationId, monitorId } = c.req.valid("param");
      const input = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const result = await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.update",
        () =>
          editMonitor(database, {
            organizationId,
            actorUserId,
            monitorId,
            input,
            outbound,
          }),
      );
      if (result.changed) {
        auditMonitorMutation(logger, {
          actorUserId,
          action: "organization.monitor.update",
          organizationId,
          monitorId: result.monitor.id,
        });
      }
      return c.json({ monitor: result.monitor }, 200);
    },
    monitorInvalidInputHook,
  );

  app.openapi(
    routes.pause,
    async (c) => {
      const { organizationId, monitorId } = c.req.valid("param");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const result = await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.pause",
        () =>
          pauseMonitor(database, { organizationId, actorUserId, monitorId }),
      );
      if (result.changed) {
        auditMonitorMutation(logger, {
          actorUserId,
          action: "organization.monitor.pause",
          organizationId,
          monitorId: result.monitor.id,
        });
      }
      return c.json({ monitor: result.monitor }, 200);
    },
    monitorInvalidInputHook,
  );

  app.openapi(
    routes.resume,
    async (c) => {
      const { organizationId, monitorId } = c.req.valid("param");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const result = await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.resume",
        () =>
          resumeMonitor(database, { organizationId, actorUserId, monitorId }),
      );
      if (result.changed) {
        auditMonitorMutation(logger, {
          actorUserId,
          action: "organization.monitor.resume",
          organizationId,
          monitorId: result.monitor.id,
        });
      }
      return c.json({ monitor: result.monitor }, 200);
    },
    monitorInvalidInputHook,
  );

  app.openapi(
    routes.delete,
    async (c) => {
      const { organizationId, monitorId } = c.req.valid("param");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      await auditMonitorDenials(
        logger,
        actorUserId,
        "organization.monitor.delete",
        () =>
          deleteMonitor(database, { organizationId, actorUserId, monitorId }),
      );
      auditMonitorMutation(logger, {
        actorUserId,
        action: "organization.monitor.delete",
        organizationId,
        monitorId,
      });
      return c.body(null, 204);
    },
    monitorInvalidInputHook,
  );
}
