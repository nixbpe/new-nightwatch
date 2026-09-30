import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@nightwatch/db";
import type { CredentialEnv, Logger, OutboundDeps } from "@nightwatch/shared";
import type { Redis } from "ioredis";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { createRateLimiter } from "../rate-limit";
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
import { registerMonitorTestRoutes } from "./test-route";

export type MonitorRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
  /** Resolver and test-only host exemptions for save-time checks. */
  outbound?: OutboundDeps;
  /** Backs the Test rate limit; without it every Test answers 503. */
  redis?: Redis;
  /** Without it, a request that stores or reads a secret answers 503. */
  credentialEnv?: CredentialEnv;
};

// One line per successful mutation that stored or overwrote a slot (AC-61).
function auditSecrets(
  logger: Logger,
  event: {
    actorUserId: string;
    organizationId: string;
    monitorId: string;
    secretsSet?: number;
    secretsReplaced?: number;
  },
): void {
  const { secretsSet, secretsReplaced, ...identity } = event;
  if ((secretsSet ?? 0) > 0) {
    auditMonitorMutation(logger, {
      ...identity,
      action: "organization.monitor.secret.set",
    });
  }
  if ((secretsReplaced ?? 0) > 0) {
    auditMonitorMutation(logger, {
      ...identity,
      action: "organization.monitor.secret.replace",
    });
  }
}

// GET /monitors/recent-events must be registered before GET /monitors/{monitorId}
// (Task 06B): monitorId is a plain string and would capture "recent-events".
// The same holds for POST /monitors/test (Task 07), registered first below.
export function registerMonitorRoutes(
  app: OpenAPIHono,
  deps: MonitorRouteDeps,
): void {
  const { auth, database, logger, outbound, redis, credentialEnv } = deps;

  registerMonitorTestRoutes(app, {
    auth,
    database,
    logger,
    outbound,
    credentialEnv,
    rateLimiter: redis ? createRateLimiter({ redis, logger }) : undefined,
  });

  app.openapi(
    routes.create,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const input = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const actorUserId = session.user.id;
      const { monitor, changed, secretsSet, secretsReplaced } =
        await auditMonitorDenials(
          logger,
          actorUserId,
          "organization.monitor.create",
          () =>
            createMonitor(database, {
              organizationId,
              actorUserId,
              input,
              outbound,
              credentialEnv,
            }),
        );
      if (changed) {
        auditMonitorMutation(logger, {
          actorUserId,
          action: "organization.monitor.create",
          organizationId,
          monitorId: monitor.id,
        });
        auditSecrets(logger, {
          actorUserId,
          organizationId,
          monitorId: monitor.id,
          secretsSet,
          secretsReplaced,
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
            credentialEnv,
          }),
      );
      if (result.changed) {
        auditMonitorMutation(logger, {
          actorUserId,
          action: "organization.monitor.update",
          organizationId,
          monitorId: result.monitor.id,
        });
        auditSecrets(logger, {
          actorUserId,
          organizationId,
          monitorId: result.monitor.id,
          secretsSet: result.secretsSet,
          secretsReplaced: result.secretsReplaced,
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
