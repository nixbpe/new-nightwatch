import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  healthResponseSchema,
  readinessResponseSchema,
  versionResponseSchema,
  type ErrorResponse,
} from "@nightwatch/api-contract";
import { DB_READINESS_TIMEOUT_MS, type Database } from "@nightwatch/db";
import {
  AppError,
  type AuthEnv,
  type Env,
  type Logger,
} from "@nightwatch/shared";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Redis } from "ioredis";
import type { QueryConfig } from "pg";
import pkg from "../package.json";
import type { Auth } from "./auth";
import type { Mailer } from "./auth/mailer";
import { registerHelloRoutes } from "./hello/routes";
import { registerMeRoutes } from "./me/routes";
import { registerNotificationInboxRoutes } from "./notifications/routes";
import { registerOnboardingRoutes } from "./onboarding/routes";
import {
  createNativeOrganizationMutationGuard,
  registerOrganizationInvitationRoutes,
  registerOrganizationMemberRoutes,
  registerOrganizationNotificationSettingsRoutes,
} from "./organization-notifications/routes";
import { RATE_LIMIT_TIMEOUT_MS } from "./rate-limit";

export type AppDeps = {
  env: Env;
  authEnv: AuthEnv;
  logger: Logger;
  // Optional so tests can build the app without a database.
  auth?: Auth;
  database?: Database;
  mailer?: Mailer;
  // Optional so route tests and OpenAPI emission need no Redis; readiness
  // checks Redis only when a client is injected.
  redis?: Redis;
};

// Invitation IDs, reset tokens, and organization/member IDs must not appear in logs.
const organizationPathBase = "/api/organizations";
const membersSegment = "members";
const invitationsSegment = "invitations";
const notificationSettingsSegment = "notification-settings";
const monitorsSegment = "monitors";
// `test` and `recent-events` are routes, not monitor ids, so they stay static.
const monitorStaticSegments = new Set(["test", "recent-events"]);
const monitorActionSegments = new Set([
  "pause",
  "resume",
  "test",
  "checks",
  "incidents",
  "response-times",
]);

function encodedCharacterLength(
  path: string,
  offset: number,
  expectedCharacter: number,
): number | undefined {
  if (path.charCodeAt(offset) !== 37) return undefined;

  let encodedOffset = offset + 1;
  while (
    path.charCodeAt(encodedOffset) === 50 &&
    path.charCodeAt(encodedOffset + 1) === 53
  ) {
    encodedOffset += 2;
  }

  if (
    encodedOffset + 1 >= path.length ||
    path.charCodeAt(encodedOffset) !== 48 + (expectedCharacter >> 4)
  ) {
    return undefined;
  }

  const expectedLowNibble = expectedCharacter & 15;
  const encodedLowNibble = path.charCodeAt(encodedOffset + 1);
  if (expectedLowNibble < 10) {
    return encodedLowNibble === 48 + expectedLowNibble
      ? encodedOffset + 2 - offset
      : undefined;
  }

  const matchesLowNibble =
    encodedLowNibble === 65 + expectedLowNibble - 10 ||
    encodedLowNibble === 97 + expectedLowNibble - 10;
  return matchesLowNibble ? encodedOffset + 2 - offset : undefined;
}

function organizationPathEnd(path: string): number | undefined {
  let offset = 0;
  for (let index = 0; index < organizationPathBase.length; index += 1) {
    const expectedCharacter = organizationPathBase.charCodeAt(index);
    // Hono preserves the encoded leading slash after its request-path separator.
    if (
      index === 0 &&
      path.charCodeAt(offset) === 47 &&
      path.charCodeAt(offset + 1) === 37
    ) {
      const encodedLength = encodedCharacterLength(
        path,
        offset + 1,
        expectedCharacter,
      );
      if (encodedLength !== undefined) {
        offset += encodedLength + 1;
        continue;
      }
    }
    if (path.charCodeAt(offset) === expectedCharacter) {
      offset += 1;
      continue;
    }
    const encodedLength = encodedCharacterLength(
      path,
      offset,
      expectedCharacter,
    );
    if (encodedLength === undefined) return undefined;
    offset += encodedLength;
  }

  return offset;
}

function logSafeOrganizationPath(path: string): string {
  const namespaceEnd = organizationPathEnd(path);
  if (namespaceEnd === undefined) return path;
  if (path.length === namespaceEnd) return organizationPathBase;
  if (path[namespaceEnd] !== "/") {
    return `${organizationPathBase}/:ambiguous`;
  }

  let state:
    | "organization"
    | "organization-route"
    | "member"
    | "member-route"
    | "monitors"
    | "monitor-route"
    | "other" = "organization";
  const safeSegments = path
    .slice(namespaceEnd)
    .split("/")
    .map((segment) => {
      if (segment === "") return segment;

      if (state === "organization") {
        state = "organization-route";
        return ":organizationId";
      }
      if (state === "organization-route" && segment === membersSegment) {
        state = "member";
        return membersSegment;
      }
      if (
        state === "organization-route" &&
        segment === notificationSettingsSegment
      ) {
        state = "other";
        return notificationSettingsSegment;
      }
      if (state === "organization-route" && segment === invitationsSegment) {
        state = "other";
        return invitationsSegment;
      }
      if (state === "organization-route" && segment === monitorsSegment) {
        state = "monitors";
        return monitorsSegment;
      }
      if (state === "monitors") {
        if (monitorStaticSegments.has(segment)) {
          state = "other";
          return segment;
        }
        state = "monitor-route";
        return ":monitorId";
      }
      if (state === "monitor-route" && monitorActionSegments.has(segment)) {
        state = "other";
        return segment;
      }
      if (state === "member") {
        state = "member-route";
        return ":memberId";
      }
      if (state === "member-route" && segment === "role") {
        state = "other";
        return "role";
      }

      state = "other";
      return ":segment";
    });

  return `${organizationPathBase}${safeSegments.join("/")}`;
}

function logSafePath(path: string): string {
  return logSafeOrganizationPath(path)
    .replace(
      /^(\/api\/onboarding\/invitations\/)[^/]+(?=\/|$)/,
      "$1:invitationId",
    )
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
  summary: "Readiness probe (database and Redis checks when configured)",
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

type ReadinessQueryConfig = QueryConfig & { query_timeout: number };

const databaseReadinessQuery: ReadinessQueryConfig = {
  text: "select 1",
  query_timeout: DB_READINESS_TIMEOUT_MS,
};

async function checkRedisReadiness(redis: Redis): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          reject(new Error("redis readiness check timed out"));
        }, RATE_LIMIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

async function checkDatabaseReadiness(database: Database): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error("database readiness check timed out"));
    }, DB_READINESS_TIMEOUT_MS);

    void Promise.resolve()
      .then(() => database.sql.query(databaseReadinessQuery))
      .then(
        () => {
          clearTimeout(deadline);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(deadline);
          reject(
            error instanceof Error
              ? error
              : new Error("database readiness query failed"),
          );
        },
      );
  });
}

export function createApp(deps: AppDeps): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) return;
      const body: ErrorResponse = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
        },
      };
      return c.json(body, 400);
    },
  });

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
    if (!deps.mailer) throw new Error("mailer required for invitation routes");
    const { auth, database } = deps;
    // Must run before the auth handler.
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
    app.use("/api/notifications/*", authCors);
    app.use("/api/organizations/*", authCors);
    app.use(
      "/api/auth/*",
      createNativeOrganizationMutationGuard({ auth, logger: deps.logger }),
    );
    app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
    registerOnboardingRoutes(app, { database, auth });
    registerMeRoutes(app, { auth, database, logger: deps.logger });
    registerNotificationInboxRoutes(app, {
      auth,
      authEnv: deps.authEnv,
      database,
    });
    registerOrganizationNotificationSettingsRoutes(app, {
      auth,
      authEnv: deps.authEnv,
      database,
      logger: deps.logger,
    });
    registerOrganizationMemberRoutes(app, {
      auth,
      database,
      logger: deps.logger,
    });
    registerOrganizationInvitationRoutes(app, {
      auth,
      authEnv: deps.authEnv,
      database,
      logger: deps.logger,
      mailer: deps.mailer,
    });
  }

  app.notFound((c) => {
    const body: ErrorResponse = {
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${logSafePath(c.req.path)} not found`,
      },
    };
    return c.json(body, 404);
  });

  app.onError((err, c) => {
    const redactedErrorPath =
      c.req.path.startsWith("/api/organizations/") ||
      c.req.path.startsWith("/api/onboarding/invitations/");
    if (err instanceof AppError) {
      deps.logger.warn(
        {
          requestId: c.get("requestId"),
          code: err.code,
          err: redactedErrorPath ? undefined : err,
        },
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
    deps.logger.error(
      {
        requestId: c.get("requestId"),
        err: redactedErrorPath ? undefined : err,
      },
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
    // Run in parallel so /ready stays bounded by the slowest single deadline.
    const asCheck = (check: Promise<void>): Promise<"ok" | "fail"> =>
      check.then(
        () => "ok",
        () => "fail",
      );
    await Promise.all([
      database
        ? asCheck(checkDatabaseReadiness(database)).then((result) => {
            checks.database = result;
          })
        : undefined,
      deps.redis
        ? asCheck(checkRedisReadiness(deps.redis)).then((result) => {
            checks.redis = result;
          })
        : undefined,
    ]);
    if (!database && !deps.redis) {
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
