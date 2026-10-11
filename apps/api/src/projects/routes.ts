import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { projectRouteDeclarations as routes } from "./contract";
import {
  addProjectMembers,
  listMemberCandidates,
  listProjectMembers,
  removeProjectMember,
  updateProjectMember,
} from "./members";
import {
  createProject,
  deleteProject,
  getProject,
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

  app.openapi(routes.list, async (c) => {
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
  });

  app.openapi(routes.create, async (c) => {
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
  });

  app.openapi(routes.update, async (c) => {
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
  });

  app.openapi(routes.delete, async (c) => {
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
  });

  app.openapi(routes.get, async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const project = await auditDenials(
      logger,
      session.user.id,
      "organization.project.read",
      () =>
        getProject(database, {
          organizationId,
          actorUserId: session.user.id,
          projectId,
        }),
    );
    return c.json(project, 200);
  });

  app.openapi(routes.listMembers, async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const body = await auditDenials(
      logger,
      session.user.id,
      "organization.project.member.list",
      () =>
        listProjectMembers(database, {
          organizationId,
          actorUserId: session.user.id,
          projectId,
        }),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.memberCandidates, async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const { q } = c.req.valid("query");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const body = await auditDenials(
      logger,
      session.user.id,
      "organization.project.member.candidates",
      () =>
        listMemberCandidates(database, {
          organizationId,
          actorUserId: session.user.id,
          projectId,
          q,
        }),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.addMembers, async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const input = c.req.valid("json");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const body = await auditDenials(
      logger,
      session.user.id,
      "organization.project.member.add",
      () =>
        addProjectMembers(database, {
          organizationId,
          actorUserId: session.user.id,
          projectId,
          input,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.updateMember, async (c) => {
    const { organizationId, projectId, userId } = c.req.valid("param");
    const input = c.req.valid("json");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const member = await auditDenials(
      logger,
      session.user.id,
      "organization.project.member.role.update",
      () =>
        updateProjectMember(database, {
          organizationId,
          actorUserId: session.user.id,
          projectId,
          userId,
          input,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(member, 200);
  });

  app.openapi(routes.removeMember, async (c) => {
    const { organizationId, projectId, userId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    await auditDenials(
      logger,
      session.user.id,
      "organization.project.member.remove",
      () =>
        removeProjectMember(database, {
          organizationId,
          actorUserId: session.user.id,
          projectId,
          userId,
          requestId: c.get("requestId"),
        }),
    );
    return c.body(null, 204);
  });
}
