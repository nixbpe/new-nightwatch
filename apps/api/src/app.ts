import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  healthResponseSchema,
  readinessResponseSchema,
  versionResponseSchema,
  type ErrorResponse,
} from "@nightwatch/api-contract";
import { AppError, type Env, type Logger } from "@nightwatch/shared";
import { requestId } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import pkg from "../package.json";
import { registerHelloRoutes } from "./hello/routes";

export type AppDeps = {
  env: Env;
  logger: Logger;
};

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Liveness probe",
  responses: {
    200: {
      description: "Process is alive",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});

const readinessRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["system"],
  summary: "Readiness probe (self-checks only in this phase)",
  responses: {
    200: {
      description: "Service is ready",
      content: { "application/json": { schema: readinessResponseSchema } },
    },
    503: {
      description: "Service is not ready",
      content: { "application/json": { schema: readinessResponseSchema } },
    },
  },
});

const versionRoute = createRoute({
  method: "get",
  path: "/version",
  tags: ["system"],
  summary: "Service identity",
  responses: {
    200: {
      description: "Name and version from package.json",
      content: { "application/json": { schema: versionResponseSchema } },
    },
  },
});

export function createApp(deps: AppDeps): OpenAPIHono {
  const app = new OpenAPIHono();

  app.use("*", requestId());

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    deps.logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request completed",
    );
  });

  app.notFound((c) => {
    const body: ErrorResponse = {
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    };
    return c.json(body, 404);
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      deps.logger.warn(
        { requestId: c.get("requestId"), code: err.code, err },
        "request failed",
      );
      const body: ErrorResponse = {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      };
      return c.json(body, err.statusCode as ContentfulStatusCode);
    }
    // Never leak internals: unknown errors become a generic 500.
    deps.logger.error(
      { requestId: c.get("requestId"), err },
      "unhandled error",
    );
    const body: ErrorResponse = {
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    };
    return c.json(body, 500);
  });

  app.openapi(healthRoute, (c) => c.json({ status: "ok" }, 200));

  app.openapi(readinessRoute, (c) =>
    c.json({ status: "ready", checks: { self: "ok" } }, 200),
  );

  app.openapi(versionRoute, (c) =>
    c.json({ name: pkg.name, version: pkg.version }, 200),
  );

  registerHelloRoutes(app);

  app.doc("/api/v1/openapi.json", {
    openapi: "3.0.0",
    info: { title: "NightWatch API", version: pkg.version },
  });
  return app;
}
