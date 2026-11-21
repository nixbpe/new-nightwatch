import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  INVENTORY_MAX_FILE_BYTES,
  errorResponseSchema,
  inventoryRejectedRowsSchema,
  inventorySummarySchema,
} from "@nightwatch/api-contract";
import { AppError, type Logger } from "@nightwatch/shared";
import { bodyLimit } from "hono/body-limit";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import {
  authorizeUpload,
  exportRejectedRows,
  getInventory,
  getRejectedRows,
  uploadInventory,
  type InventoryDeps,
  type ProjectIdentity,
} from "./service";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Multipart framing adds a little to the file itself.
const BODY_LIMIT_BYTES = INVENTORY_MAX_FILE_BYTES + 64 * 1024;
const tags = ["Inventory"];
const base =
  "/api/organizations/{organizationId}/projects/{projectId}/inventory";
const params = z.object({
  organizationId: z.uuid(),
  projectId: z.string(),
});
const systemParams = params.extend({ systemId: z.uuid() });
const errors = Object.fromEntries(
  [400, 401, 403, 404, 413, 429, 503].map((status) => [
    status,
    {
      description: "Request rejected",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  ]),
);
const rateLimited = {
  description: "Upload quota exceeded",
  content: { "application/json": { schema: errorResponseSchema } },
};
const uploadBody = z.object({
  file: z.file().openapi({ type: "string", format: "binary" }),
});

export function registerInventoryRoutes(
  app: OpenAPIHono,
  deps: InventoryDeps & { auth: Auth; logger: Logger },
) {
  const run = async <T>(
    headers: Headers,
    ids: { organizationId: string; projectId: string },
    requestId: string,
    action: string,
    operation: (input: ProjectIdentity) => Promise<T>,
  ) => {
    const session = await requireVerifiedSession(deps.auth, headers);
    return auditDenials(deps.logger, session.user.id, action, () =>
      operation({ ...ids, actorUserId: session.user.id, requestId }),
    );
  };

  app.openapi(
    createRoute({
      method: "get",
      path: base,
      tags,
      request: { params },
      responses: {
        ...errors,
        200: {
          description: "Inventory summary of the Project",
          content: { "application/json": { schema: inventorySummarySchema } },
        },
      },
    }),
    async (c) =>
      c.json(
        await run(
          c.req.raw.headers,
          c.req.valid("param"),
          c.get("requestId"),
          "inventory.read",
          (input) => getInventory(deps, input),
        ),
        200,
      ),
  );

  app.post(
    base.replaceAll(/\{(\w+)\}/g, ":$1"),
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: () => {
        throw new AppError(
          413,
          "INVENTORY_FILE_REJECTED",
          "ไฟล์ใหญ่เกิน 2 MB ไม่มีข้อมูลใดถูกนำเข้า",
          { reason: "file_too_large" },
        );
      },
    }),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: base,
      tags,
      request: {
        params,
        body: {
          required: true,
          content: { "multipart/form-data": { schema: uploadBody } },
        },
      },
      responses: {
        ...errors,
        200: {
          description: "Inventory after the upload replaced its Systems",
          content: { "application/json": { schema: inventorySummarySchema } },
        },
        429: rateLimited,
      },
    }),
    async (c) => {
      const { file } = c.req.valid("form");
      const result = await run(
        c.req.raw.headers,
        c.req.valid("param"),
        c.get("requestId"),
        "inventory.write",
        async (input) => {
          await authorizeUpload(deps, input);
          return uploadInventory(deps, input, {
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
        },
      );
      if ("retryAfterSeconds" in result) {
        return c.json(
          {
            error: {
              code: "INVENTORY_RATE_LIMITED",
              message: "upload บ่อยเกินไป โปรดลองใหม่ภายหลัง",
            },
          },
          429,
          { "Retry-After": String(result.retryAfterSeconds) },
        );
      }
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/systems/{systemId}/rejected-rows`,
      tags,
      request: { params: systemParams },
      responses: {
        ...errors,
        200: {
          description: "Rows of one System that failed the template rules",
          content: {
            "application/json": { schema: inventoryRejectedRowsSchema },
          },
        },
      },
    }),
    async (c) => {
      const { systemId, ...ids } = c.req.valid("param");
      return c.json(
        await run(
          c.req.raw.headers,
          ids,
          c.get("requestId"),
          "inventory.read",
          (input) => getRejectedRows(deps, { ...input, systemId }),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/systems/{systemId}/rejected-rows/export`,
      tags,
      request: { params: systemParams },
      responses: {
        ...errors,
        200: {
          description: "Rejected rows as Excel, one sheet per Owner",
          content: {
            [XLSX_TYPE]: {
              schema: z.string().openapi({ type: "string", format: "binary" }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { systemId, ...ids } = c.req.valid("param");
      const bytes = await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.read",
        (input) => exportRejectedRows(deps, { ...input, systemId }),
      );
      return c.body(bytes, 200, {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": 'attachment; filename="rejected-rows.xlsx"',
        "Cache-Control": "no-store",
      });
    },
  );
}
