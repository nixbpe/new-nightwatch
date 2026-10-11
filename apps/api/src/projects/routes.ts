import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { invalidInputHook } from "../notifications/invalid-input";
import { projectRouteDeclarations as routes } from "./contract";
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from "./service";

export type ProjectRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
};

export function registerProjectRoutes(
  app: OpenAPIHono,
  deps: ProjectRouteDeps,
): void {
  const { auth, database, logger } = deps;

  app.openapi(
    routes.list,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const body = await auditDenials(
        logger,
        session.user.id,
        "organization.project.list",
        () =>
          listProjects(database, {
            organizationId,
            actorUserId: session.user.id,
          }),
      );
      return c.json(body, 200);
    },
    invalidInputHook,
  );

  app.openapi(
    routes.create,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const input = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const project = await auditDenials(
        logger,
        session.user.id,
        "organization.project.create",
        () =>
          createProject(database, {
            organizationId,
            actorUserId: session.user.id,
            input,
            requestId: c.get("requestId"),
          }),
      );
      return c.json(project, 201);
    },
    invalidInputHook,
  );

  app.openapi(
    routes.update,
    async (c) => {
      const { organizationId, projectId } = c.req.valid("param");
      const input = c.req.valid("json");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      const project = await auditDenials(
        logger,
        session.user.id,
        "organization.project.update",
        () =>
          updateProject(database, {
            organizationId,
            actorUserId: session.user.id,
            projectId,
            input,
            requestId: c.get("requestId"),
          }),
      );
      return c.json(project, 200);
    },
    invalidInputHook,
  );

  app.openapi(
    routes.delete,
    async (c) => {
      const { organizationId, projectId } = c.req.valid("param");
      const session = await requireVerifiedSession(auth, c.req.raw.headers);
      await auditDenials(
        logger,
        session.user.id,
        "organization.project.delete",
        () =>
          deleteProject(database, {
            organizationId,
            actorUserId: session.user.id,
            projectId,
            requestId: c.get("requestId"),
          }),
      );
      return c.body(null, 204);
    },
    invalidInputHook,
  );
}
