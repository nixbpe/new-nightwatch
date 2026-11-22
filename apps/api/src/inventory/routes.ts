import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  INVENTORY_MAX_FILE_BYTES,
  errorResponseSchema,
  inventoryImportListSchema,
  inventoryImportPendingSchema,
  inventoryImportPreviewSchema,
  inventoryImportResultSchema,
  inventoryImportsQuerySchema,
  inventoryRowCreateSchema,
  inventoryRowDeleteQuerySchema,
  inventoryRowListSchema,
  inventoryRowSchema,
  inventoryRowsQuerySchema,
  inventoryRowUpdateSchema,
  inventorySummarySchema,
  inventorySystemCreateSchema,
  inventorySystemDeleteQuerySchema,
  inventorySystemRenameSchema,
  inventorySystemSchema,
} from "@nightwatch/api-contract";
import { AppError, type Logger } from "@nightwatch/shared";
import { bodyLimit } from "hono/body-limit";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import {
  authorizeImport,
  cancelImportPreview,
  confirmImport,
  createImportPreview,
  getImportPreview,
} from "./import";
import { contentDisposition, exportInventory } from "./export";
import { listImports } from "./import-history";
import { createRow, deleteRow, listRows, updateRow } from "./row-edit";
import {
  exportRejectedRows,
  getInventory,
  type InventoryDeps,
  type ProjectIdentity,
} from "./service";
import { createSystem, deleteSystem, renameSystem } from "./system-edit";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Multipart framing adds a little to the file itself.
const BODY_LIMIT_BYTES = INVENTORY_MAX_FILE_BYTES + 64 * 1024;
const tags = ["Inventory"];
const base =
  "/api/organizations/{organizationId}/projects/{projectId}/inventory";
const previews = `${base}/import-previews`;
const params = z.object({
  organizationId: z.uuid(),
  projectId: z.string(),
});
const previewParams = params.extend({ previewId: z.uuid() });
const systemParams = params.extend({ systemId: z.uuid() });
const rowParams = params.extend({ rowId: z.uuid() });
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 429, 503].map((status) => [
    status,
    {
      description: "Request rejected",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  ]),
);
const rateLimited = {
  description: "Import quota exceeded",
  content: { "application/json": { schema: errorResponseSchema } },
};
const uploadBody = z.object({
  file: z.file().openapi({ type: "string", format: "binary" }),
});

export function registerInventoryRoutes(
  app: OpenAPIHono,
  deps: InventoryDeps & {
    auth: Auth;
    logger: Logger;
    trustedOrigin: string;
  },
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

  // multipart/form-data is a content type a cross-site form can send without a
  // preflight, so the Origin is checked, then the session and the role, before any
  // of the body is parsed.
  app.post(
    previews.replaceAll(/\{(\w+)\}/g, ":$1"),
    async (c, next) => {
      if (c.req.header("origin") !== deps.trustedOrigin) {
        throw new AppError(
          403,
          "ORIGIN_DENIED",
          "ไม่อนุญาตคำขอจากแหล่งที่มานี้",
        );
      }
      const ids = params.safeParse({
        organizationId: c.req.param("organizationId"),
        projectId: c.req.param("projectId"),
      });
      if (!ids.success) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
        );
      }
      await run(
        c.req.raw.headers,
        ids.data,
        c.get("requestId"),
        "inventory.write",
        (input) => authorizeImport(deps, input),
      );
      await next();
    },
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
      path: previews,
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
        201: {
          description:
            "The preview of the file; no inventory changed. It replaces the caller's pending preview",
          content: {
            "application/json": { schema: inventoryImportPreviewSchema },
          },
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
        async (input) =>
          createImportPreview(deps, input, {
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          }),
      );
      if ("retryAfterSeconds" in result) {
        return c.json(
          {
            error: {
              code: "INVENTORY_RATE_LIMITED",
              message: "เลือกไฟล์บ่อยเกินไป โปรดลองใหม่ภายหลัง",
            },
          },
          429,
          { "Retry-After": String(result.retryAfterSeconds) },
        );
      }
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${previews}/current`,
      tags,
      request: { params },
      responses: {
        ...errors,
        200: {
          description:
            "The caller's own pending preview, or null; another person's is never returned",
          content: {
            "application/json": { schema: inventoryImportPendingSchema },
          },
        },
      },
    }),
    async (c) =>
      c.json(
        await run(
          c.req.raw.headers,
          c.req.valid("param"),
          c.get("requestId"),
          "inventory.write",
          (input) => getImportPreview(deps, input),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${previews}/{previewId}/confirm`,
      tags,
      request: { params: previewParams },
      responses: {
        ...errors,
        200: {
          description: "The preview was merged into the Project's inventory",
          content: {
            "application/json": { schema: inventoryImportResultSchema },
          },
        },
      },
    }),
    async (c) => {
      const { previewId, ...ids } = c.req.valid("param");
      return c.json(
        await run(
          c.req.raw.headers,
          ids,
          c.get("requestId"),
          "inventory.write",
          (input) => confirmImport(deps, { ...input, previewId }),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: `${previews}/{previewId}`,
      tags,
      request: { params: previewParams },
      responses: {
        ...errors,
        204: { description: "The preview was deleted" },
      },
    }),
    async (c) => {
      const { previewId, ...ids } = c.req.valid("param");
      await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.write",
        (input) => cancelImportPreview(deps, { ...input, previewId }),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/imports`,
      tags,
      request: { params, query: inventoryImportsQuerySchema },
      responses: {
        ...errors,
        200: {
          description:
            "One page of the Project's confirmed imports, newest first; counts and file names only",
          content: {
            "application/json": { schema: inventoryImportListSchema },
          },
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
          (input) => listImports(deps, input, c.req.valid("query")),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/rows`,
      tags,
      request: { params, query: inventoryRowsQuerySchema },
      responses: {
        ...errors,
        200: {
          description: "One page of the Project's rows, filtered",
          content: { "application/json": { schema: inventoryRowListSchema } },
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
          (input) => listRows(deps, input, c.req.valid("query")),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${base}/rows`,
      tags,
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: inventoryRowCreateSchema } },
        },
      },
      responses: {
        ...errors,
        201: {
          description: "The row that was added",
          content: { "application/json": { schema: inventoryRowSchema } },
        },
      },
    }),
    async (c) =>
      c.json(
        await run(
          c.req.raw.headers,
          c.req.valid("param"),
          c.get("requestId"),
          "inventory.write",
          (input) => createRow(deps, input, c.req.valid("json")),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: `${base}/rows/{rowId}`,
      tags,
      request: {
        params: rowParams,
        body: {
          required: true,
          content: { "application/json": { schema: inventoryRowUpdateSchema } },
        },
      },
      responses: {
        ...errors,
        200: {
          description: "The row after the change",
          content: { "application/json": { schema: inventoryRowSchema } },
        },
      },
    }),
    async (c) => {
      const { rowId, ...ids } = c.req.valid("param");
      return c.json(
        await run(
          c.req.raw.headers,
          ids,
          c.get("requestId"),
          "inventory.write",
          (input) => updateRow(deps, { ...input, rowId }, c.req.valid("json")),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: `${base}/rows/{rowId}`,
      tags,
      request: { params: rowParams, query: inventoryRowDeleteQuerySchema },
      responses: {
        ...errors,
        204: { description: "The row was deleted" },
      },
    }),
    async (c) => {
      const { rowId, ...ids } = c.req.valid("param");
      await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.write",
        (input) =>
          deleteRow(deps, { ...input, rowId }, c.req.valid("query").revision),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${base}/systems`,
      tags,
      request: {
        params,
        body: {
          required: true,
          content: {
            "application/json": { schema: inventorySystemCreateSchema },
          },
        },
      },
      responses: {
        ...errors,
        201: {
          description: "The System that was created with its first row",
          content: { "application/json": { schema: inventorySystemSchema } },
        },
      },
    }),
    async (c) =>
      c.json(
        await run(
          c.req.raw.headers,
          c.req.valid("param"),
          c.get("requestId"),
          "inventory.write",
          (input) => createSystem(deps, input, c.req.valid("json")),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: `${base}/systems/{systemId}`,
      tags,
      request: {
        params: systemParams,
        body: {
          required: true,
          content: {
            "application/json": { schema: inventorySystemRenameSchema },
          },
        },
      },
      responses: {
        ...errors,
        200: {
          description: "The System after the rename",
          content: { "application/json": { schema: inventorySystemSchema } },
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
          "inventory.write",
          (input) =>
            renameSystem(deps, { ...input, systemId }, c.req.valid("json")),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: `${base}/systems/{systemId}`,
      tags,
      request: {
        params: systemParams,
        query: inventorySystemDeleteQuerySchema,
      },
      responses: {
        ...errors,
        204: { description: "The System and its rows were deleted" },
      },
    }),
    async (c) => {
      const { systemId, ...ids } = c.req.valid("param");
      await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.write",
        (input) =>
          deleteSystem(deps, { ...input, systemId }, c.req.valid("query")),
      );
      return c.body(null, 204);
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

  const exportResponse = {
    ...errors,
    200: {
      description:
        "The current inventory as Excel, usable and failed rows, in the import template's columns",
      content: {
        [XLSX_TYPE]: {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
  };
  const exportHeaders = (names: { utf8: string; ascii: string }) => ({
    "Content-Type": XLSX_TYPE,
    "Content-Disposition": contentDisposition(names),
    "Cache-Control": "no-store",
  });

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/export`,
      tags,
      request: { params },
      responses: exportResponse,
    }),
    async (c) => {
      const file = await run(
        c.req.raw.headers,
        c.req.valid("param"),
        c.get("requestId"),
        "inventory.read",
        (input) => exportInventory(deps, input),
      );
      return c.body(file.bytes, 200, exportHeaders(file.names));
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/systems/{systemId}/export`,
      tags,
      request: { params: systemParams },
      responses: exportResponse,
    }),
    async (c) => {
      const { systemId, ...ids } = c.req.valid("param");
      const file = await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.read",
        (input) => exportInventory(deps, { ...input, systemId }),
      );
      return c.body(file.bytes, 200, exportHeaders(file.names));
    },
  );
}
