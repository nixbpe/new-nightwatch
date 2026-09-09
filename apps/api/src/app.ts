import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  healthResponseSchema,
  readinessResponseSchema,
  versionResponseSchema,
  type ErrorResponse,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import {
  AppError,
  type AuthEnv,
  type Env,
  type Logger,
} from "@nightwatch/shared";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import pkg from "../package.json";
import type { Auth } from "./auth";
import { registerHelloRoutes } from "./hello/routes";
import { registerMeRoutes } from "./me/routes";
import { registerOnboardingRoutes } from "./onboarding/routes";

export type AppDeps = {
  env: Env;
  authEnv: AuthEnv;
  logger: Logger;
  /**
   * Auth/database are optional so system routes and error-contract tests
   * can build the app without a database. The real server (src/index.ts)
   * always composes and passes both.
   */
  auth?: Auth;
  database?: Database;
};

/**
 * Collapse bearer-capability segments before a path reaches the logs:
 * invitation IDs admit signups, reset tokens set passwords. Logged paths
 * must identify the route, never the secret.
 */
function logSafePath(path: string): string {
  return path
    .replace(/^(\/api\/onboarding\/invitations\/)[^/]+$/, "$1:invitationId")
    .replace(/^(\/api\/auth\/reset-password\/)[^/]+$/, "$1:token");
}

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
  summary: "Readiness probe (database check; no Redis in this phase)",
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
        path: logSafePath(c.req.path),
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request completed",
    );
  });

  if (deps.auth && deps.database) {
    const { auth, database } = deps;
    // Credentialed, explicit CORS: exact frontend origin only, invitation
    // header allow-listed. Must run before the auth handler.
    const authCors = cors({
      origin: deps.authEnv.CORS_ORIGIN,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Invitation-ID"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    });
    app.use("/api/auth/*", authCors);
    app.use("/api/onboarding/*", authCors);
    app.use("/api/me/*", authCors);
    app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
    registerOnboardingRoutes(app, { database });
    registerMeRoutes(app, { auth, database, logger: deps.logger });
  }

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

  app.openapi(readinessRoute, async (c) => {
    const database = deps.database;
    const checks: Record<string, "ok" | "fail"> = {};
    if (database) {
      try {
        await database.sql.query("select 1");
        checks.database = "ok";
      } catch {
        checks.database = "fail";
      }
    } else {
      checks.self = "ok";
    }
    const ready = !Object.values(checks).includes("fail");
    return c.json(
      { status: ready ? "ready" : "not_ready", checks },
      ready ? 200 : 503,
    );
  });

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
