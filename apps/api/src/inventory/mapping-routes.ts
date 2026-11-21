import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  cpeSearchQuerySchema,
  cpeSearchResultSchema,
  errorResponseSchema,
  inventoryMappingListQuerySchema,
  inventoryMappingListSchema,
  inventoryMappingSchema,
  inventoryMappingSuggestionSchema,
  inventoryMappingUpdateSchema,
} from "@nightwatch/api-contract";
import type { Logger } from "@nightwatch/shared";

import { auditDenials } from "../audit/denials";
import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import {
  listMappings,
  searchCpe,
  suggestMapping,
  updateMapping,
} from "./mappings";
import type { InventoryDeps, ProjectIdentity } from "./service";

const tags = ["Inventory"];
const base =
  "/api/organizations/{organizationId}/projects/{projectId}/inventory/mappings";
const params = z.object({
  organizationId: z.uuid(),
  projectId: z.string(),
});
const itemParams = params.extend({ mappingId: z.uuid() });
const errors = Object.fromEntries(
  [400, 401, 403, 404, 502, 503].map((status) => [
    status,
    {
      description: "Request rejected",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  ]),
);
const rateLimited = {
  description: "Dictionary lookup quota exceeded",
  content: { "application/json": { schema: errorResponseSchema } },
};
const limitedBody = (retryAfterSeconds: number) => ({
  body: {
    error: {
      code: "CPE_LOOKUP_RATE_LIMITED",
      message: "ค้น CPE dictionary บ่อยเกินไป โปรดลองใหม่ภายหลัง",
    },
  },
  headers: { "Retry-After": String(retryAfterSeconds) },
});

export function registerInventoryMappingRoutes(
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
      request: { params, query: inventoryMappingListQuerySchema },
      responses: {
        ...errors,
        200: {
          description: "Identifier mappings of the Project",
          content: {
            "application/json": { schema: inventoryMappingListSchema },
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
          (input) => listMappings(deps, input, c.req.valid("query").status),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: `${base}/{mappingId}`,
      tags,
      request: {
        params: itemParams,
        body: {
          required: true,
          content: {
            "application/json": { schema: inventoryMappingUpdateSchema },
          },
        },
      },
      responses: {
        ...errors,
        200: {
          description: "The mapping after the decision",
          content: { "application/json": { schema: inventoryMappingSchema } },
        },
      },
    }),
    async (c) => {
      const { mappingId, ...ids } = c.req.valid("param");
      return c.json(
        await run(
          c.req.raw.headers,
          ids,
          c.get("requestId"),
          "inventory.write",
          (input) =>
            updateMapping(deps, { ...input, mappingId }, c.req.valid("json")),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${base}/{mappingId}/suggest`,
      tags,
      request: { params: itemParams },
      responses: {
        ...errors,
        200: {
          description:
            "The mapping with the best dictionary match stored as suggestion",
          content: {
            "application/json": { schema: inventoryMappingSuggestionSchema },
          },
        },
        429: rateLimited,
      },
    }),
    async (c) => {
      const { mappingId, ...ids } = c.req.valid("param");
      const result = await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.write",
        (input) => suggestMapping(deps, { ...input, mappingId }),
      );
      if ("retryAfterSeconds" in result) {
        const limited = limitedBody(result.retryAfterSeconds);
        return c.json(limited.body, 429, limited.headers);
      }
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${base}/{mappingId}/cpe-search`,
      tags,
      request: { params: itemParams, query: cpeSearchQuerySchema },
      responses: {
        ...errors,
        200: {
          description: "NVD CPE dictionary matches for the review dialog",
          content: { "application/json": { schema: cpeSearchResultSchema } },
        },
        429: rateLimited,
      },
    }),
    async (c) => {
      const { mappingId, ...ids } = c.req.valid("param");
      const result = await run(
        c.req.raw.headers,
        ids,
        c.get("requestId"),
        "inventory.write",
        (input) =>
          searchCpe(deps, { ...input, mappingId }, c.req.valid("query").q),
      );
      if ("retryAfterSeconds" in result) {
        const limited = limitedBody(result.retryAfterSeconds);
        return c.json(limited.body, 429, limited.headers);
      }
      return c.json(result, 200);
    },
  );
}
