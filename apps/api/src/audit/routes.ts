import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  auditEventNotFoundErrorResponseSchema,
  auditExportCreateResponseSchema,
  auditExportEmptyErrorResponseSchema,
  auditExportExpiredErrorResponseSchema,
  auditExportInProgressErrorResponseSchema,
  auditExportListResponseSchema,
  auditExportNotFoundErrorResponseSchema,
  auditExportNotReadyErrorResponseSchema,
  auditExportParamsSchema,
  auditExportRequestSchema,
  auditExportTooLargeErrorResponseSchema,
  auditLogActorsResponseSchema,
  auditLogEventParamsSchema,
  auditLogEventResponseSchema,
  auditLogListQuerySchema,
  auditLogListResponseSchema,
  auditLogOrganizationParamsSchema,
  auditValidationErrorResponseSchema,
  emailNotVerifiedErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  permissionDeniedErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";
import { z } from "zod";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { auditDenials } from "./denials";
import {
  createAuditExport,
  getAuditExportFile,
  listAuditExports,
} from "./export-service";
import {
  getAuditEvent,
  listAuditActors,
  listAuditEvents,
} from "./read-service";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const readErrors = {
  400: jsonError("Invalid query", auditValidationErrorResponseSchema),
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified, membership is denied or the role may not read the log",
    z.union([
      emailNotVerifiedErrorResponseSchema,
      membershipDeniedErrorResponseSchema,
      permissionDeniedErrorResponseSchema,
    ]),
  ),
} as const;

const base = "/api/organizations/{organizationId}/audit-log";
const tags = ["audit-log"];

export const auditLogReadRouteDeclarations = {
  list: createRoute({
    method: "get",
    path: `${base}/events`,
    tags,
    summary: "List audit events, newest first",
    request: {
      params: auditLogOrganizationParamsSchema,
      query: auditLogListQuerySchema,
    },
    responses: {
      200: {
        description: "One page of events inside the retention window",
        content: {
          "application/json": { schema: auditLogListResponseSchema },
        },
      },
      ...readErrors,
    },
  }),
  detail: createRoute({
    method: "get",
    path: `${base}/events/{eventId}`,
    tags,
    summary: "One audit event with its changes",
    request: { params: auditLogEventParamsSchema },
    responses: {
      200: {
        description: "The event",
        content: {
          "application/json": { schema: auditLogEventResponseSchema },
        },
      },
      ...readErrors,
      404: jsonError(
        "The event does not exist, is malformed, is past retention or belongs to another Organization",
        auditEventNotFoundErrorResponseSchema,
      ),
    },
  }),
  actors: createRoute({
    method: "get",
    path: `${base}/actors`,
    tags,
    summary: "Actors that have at least one retained event",
    request: { params: auditLogOrganizationParamsSchema },
    responses: {
      200: {
        description: "Distinct actors, by name then user id",
        content: {
          "application/json": { schema: auditLogActorsResponseSchema },
        },
      },
      ...readErrors,
    },
  }),
  createExport: createRoute({
    method: "post",
    path: `${base}/exports`,
    tags,
    summary: "Request an export of the audit log",
    request: {
      params: auditLogOrganizationParamsSchema,
      body: {
        content: { "application/json": { schema: auditExportRequestSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The request was stored and queued",
        content: {
          "application/json": { schema: auditExportCreateResponseSchema },
        },
      },
      ...readErrors,
      409: jsonError(
        "The caller already has an export being built in this Organization",
        auditExportInProgressErrorResponseSchema,
      ),
      422: jsonError(
        "Nothing to export, or more than the limit (owner and admin only)",
        z.union([
          auditExportEmptyErrorResponseSchema,
          auditExportTooLargeErrorResponseSchema,
        ]),
      ),
    },
  }),
  listExports: createRoute({
    method: "get",
    path: `${base}/exports`,
    tags,
    summary: "The caller's export requests of the last 7 days",
    request: { params: auditLogOrganizationParamsSchema },
    responses: {
      200: {
        description: "Up to 20 requests, newest first",
        content: {
          "application/json": { schema: auditExportListResponseSchema },
        },
      },
      ...readErrors,
    },
  }),
  downloadExport: createRoute({
    method: "get",
    path: `${base}/exports/{exportId}/download`,
    tags,
    summary: "Download an export file of the caller",
    request: { params: auditExportParamsSchema },
    responses: {
      200: {
        description: "The file",
        content: {
          "text/csv": {
            schema: z.string().openapi({ type: "string", format: "binary" }),
          },
          "application/json": {
            schema: z.string().openapi({ type: "string", format: "binary" }),
          },
        },
      },
      ...readErrors,
      404: jsonError(
        "No such export of the caller in this Organization",
        auditExportNotFoundErrorResponseSchema,
      ),
      409: jsonError(
        "The file is still being built or failed",
        auditExportNotReadyErrorResponseSchema,
      ),
      410: jsonError(
        "The file is past its 24 hours",
        auditExportExpiredErrorResponseSchema,
      ),
    },
  }),
} as const;

export type AuditLogRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
};

export function registerAuditLogReadRoutes(
  app: OpenAPIHono,
  deps: AuditLogRouteDeps,
): void {
  const { auth, database, logger } = deps;
  const routes = auditLogReadRouteDeclarations;

  app.openapi(routes.list, async (c) => {
    const { organizationId } = c.req.valid("param");
    const query = c.req.valid("query");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.list",
      () => listAuditEvents(database, { organizationId, actorUserId }, query),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.detail, async (c) => {
    const { organizationId, eventId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.read",
      () => getAuditEvent(database, { organizationId, actorUserId }, eventId),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.actors, async (c) => {
    const { organizationId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.actors",
      () => listAuditActors(database, { organizationId, actorUserId }),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.createExport, async (c) => {
    const { organizationId } = c.req.valid("param");
    const request = c.req.valid("json");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.export",
      () =>
        createAuditExport(
          database,
          { organizationId, actorUserId, requestId: c.get("requestId") },
          request,
        ),
    );
    return c.json(body, 201);
  });

  app.openapi(routes.listExports, async (c) => {
    const { organizationId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const body = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.exports",
      () => listAuditExports(database, { organizationId, actorUserId }),
    );
    return c.json(body, 200);
  });

  app.openapi(routes.downloadExport, async (c) => {
    const { organizationId, exportId } = c.req.valid("param");
    const session = await requireVerifiedSession(auth, c.req.raw.headers);
    const actorUserId = session.user.id;
    const file = await auditDenials(
      logger,
      actorUserId,
      "organization.audit-log.download",
      () =>
        getAuditExportFile(database, { organizationId, actorUserId }, exportId),
    );
    const stamp = file.snapshotAt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    return new Response(new Uint8Array(file.content), {
      status: 200,
      headers: {
        "Content-Type":
          file.format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="nightwatch-audit-log-${stamp}.${file.format}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
