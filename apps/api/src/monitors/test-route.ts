import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  emailNotVerifiedErrorResponseSchema,
  invalidInputErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  monitorConfigSchema,
  monitorInvalidErrorResponseSchema,
  monitorNotFoundErrorResponseSchema,
  monitorOrganizationParamsSchema,
  monitorParamsSchema,
  monitorTestRateLimitedErrorResponseSchema,
  monitorTestResponseSchema,
  normalizeMonitorConfig,
  permissionDeniedErrorResponseSchema,
  rateLimitUnavailableErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
  unsupportedMediaTypeErrorResponseSchema,
  type MonitorConfig,
  type MonitorTestResult,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import {
  AppError,
  buildCheckUrl,
  runCheck,
  type Logger,
  type NormalizedMonitorConfig,
  type OutboundDeps,
} from "@nightwatch/shared";
import { z } from "zod";

import type { Auth } from "../auth";
import { requireVerifiedSession } from "../me/service";
import { consumeMonitorTestRateLimit, type RateLimiter } from "../rate-limit";
import { auditMonitorDenials } from "./audit";
import { monitorInvalidInputHook } from "./invalid-input";
import { assertMemberPermissionBeforeTenantContext } from "./permissions";
import { assertMonitorExists, parseMonitorId, URL_REASONS } from "./service";

const jsonError = (description: string, schema: z.ZodType) =>
  ({ description, content: { "application/json": { schema } } }) as const;

const monitorBase = "/api/organizations/{organizationId}/monitors";
const tags = ["monitors"];

const testResponses = {
  200: {
    description:
      "The result of one check of the target, not recorded. Target problems (DNS, TLS, timeout, blocked address, redirects) are results, not errors",
    content: { "application/json": { schema: monitorTestResponseSchema } },
  },
  400: jsonError(
    "Invalid monitor input",
    z.union([
      monitorInvalidErrorResponseSchema,
      invalidInputErrorResponseSchema,
    ]),
  ),
  401: jsonError("No valid session", unauthenticatedErrorResponseSchema),
  403: jsonError(
    "Email is unverified, membership is denied, or permission is denied",
    z.union([
      emailNotVerifiedErrorResponseSchema,
      membershipDeniedErrorResponseSchema,
      permissionDeniedErrorResponseSchema,
    ]),
  ),
  415: jsonError(
    "The request body is not JSON",
    unsupportedMediaTypeErrorResponseSchema,
  ),
  429: jsonError(
    "Test rate limit reached; Retry-After carries the wait in seconds",
    monitorTestRateLimitedErrorResponseSchema,
  ),
  503: jsonError(
    "The rate limiter is unavailable; no request was sent",
    rateLimitUnavailableErrorResponseSchema,
  ),
} as const;

const configBody = {
  content: { "application/json": { schema: monitorConfigSchema } },
  required: true,
} as const;

export const monitorTestRouteDeclarations = {
  test: createRoute({
    method: "post",
    path: `${monitorBase}/test`,
    tags,
    summary: "Test a monitor configuration before it is created",
    request: { params: monitorOrganizationParamsSchema, body: configBody },
    responses: testResponses,
  }),
  testExisting: createRoute({
    method: "post",
    path: `${monitorBase}/{monitorId}/test`,
    tags,
    summary: "Test a configuration in the edit form of an existing monitor",
    request: { params: monitorParamsSchema, body: configBody },
    responses: {
      200: testResponses[200],
      400: testResponses[400],
      401: testResponses[401],
      403: testResponses[403],
      404: jsonError(
        "The monitor does not exist, is malformed or belongs to another Organization",
        monitorNotFoundErrorResponseSchema,
      ),
      415: testResponses[415],
      429: testResponses[429],
      503: testResponses[503],
    },
  }),
} as const;

export type MonitorTestRouteDeps = {
  auth: Auth;
  database: Database;
  logger: Logger;
  /** Resolver, test-only host exemptions and CA store for the outbound request. */
  outbound?: OutboundDeps;
  /** Absent when the API has no Redis: every Test then answers 503. */
  rateLimiter?: RateLimiter;
};

// The URL a check requests must be well formed before quota is spent. A forbidden
// address is not rejected here: Test reports it as a result (AC-62).
function assertRequestableUrl(config: MonitorConfig): void {
  const built = buildCheckUrl(config.url, config.queryParams);
  if (!built.ok && built.reason !== "blocked_address") {
    throw new AppError(400, "MONITOR_INVALID", "Invalid monitor input", {
      fields: [{ field: "url", reason: URL_REASONS[built.reason] }],
    });
  }
}

function toNormalizedConfig(config: MonitorConfig): NormalizedMonitorConfig {
  const { expectedStatusRanges, assertions } = normalizeMonitorConfig(config);
  return {
    url: config.url,
    method: config.method,
    timeoutSeconds: config.timeoutSeconds,
    headers: config.headers,
    queryParams: config.queryParams,
    body: config.body,
    expectedStatus: expectedStatusRanges,
    assertions,
    auth: config.auth,
  };
}

async function runTest(
  deps: MonitorTestRouteDeps,
  input: {
    organizationId: string;
    actorUserId: string;
    monitorId?: string;
    config: MonitorConfig;
    signal: AbortSignal;
  },
): Promise<{ result: MonitorTestResult } | { retryAfterSeconds: number }> {
  const { database, logger, outbound, rateLimiter } = deps;
  await auditMonitorDenials(
    logger,
    input.actorUserId,
    "organization.monitor.test",
    async () => {
      await assertMemberPermissionBeforeTenantContext(database, {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        permission: "write",
      });
      if (input.monitorId !== undefined) {
        // The connection goes back to the pool before the outbound request starts.
        await assertMonitorExists(
          database,
          input,
          parseMonitorId(input.monitorId),
        );
      }
    },
  );
  assertRequestableUrl(input.config);

  // Nothing above touched the network, and validation failures took no quota.
  if (!rateLimiter) {
    throw new AppError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "rate limiter is unavailable",
    );
  }
  const limit = await consumeMonitorTestRateLimit(rateLimiter, {
    userId: input.actorUserId,
    organizationId: input.organizationId,
  });
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };

  // Task 13 replaces the empty secrets with the stored ones for `keep` slots.
  const checked = await runCheck(
    toNormalizedConfig(input.config),
    {},
    { ...outbound, signal: input.signal },
  );
  return {
    result: {
      checkedAt: checked.checkedAt.toISOString(),
      outcome: checked.outcome,
      httpStatus: checked.httpStatus,
      responseTimeMs: checked.responseTimeMs,
      failureReason: checked.failureReason,
      tlsReason: checked.tlsReason,
      assertions: checked.assertions.map((assertion) => ({
        kind: assertion.kind,
        expected: assertion.expected,
        actual: assertion.actual,
        actualType: assertion.actualType,
        actualTruncated: assertion.actualTruncated,
        status: assertion.status,
        reason: assertion.reason,
      })),
      url: checked.url,
      evaluatedFromPrefix: checked.evaluatedFromPrefix,
    },
  };
}

function rateLimitedBody(retryAfterSeconds: number) {
  return {
    error: {
      code: "MONITOR_TEST_RATE_LIMITED" as const,
      message: "Too many tests, try again later",
      details: { retryAfterSeconds },
    },
  };
}

// Register before the `{monitorId}` routes: `test` is a static segment. A client
// disconnect aborts `c.req.raw.signal`, which tears down the outbound request.
export function registerMonitorTestRoutes(
  app: OpenAPIHono,
  deps: MonitorTestRouteDeps,
): void {
  const routes = monitorTestRouteDeclarations;

  app.openapi(
    routes.test,
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const outcome = await runTest(deps, {
        organizationId,
        actorUserId: session.user.id,
        config: c.req.valid("json"),
        signal: c.req.raw.signal,
      });
      if ("retryAfterSeconds" in outcome) {
        return c.json(rateLimitedBody(outcome.retryAfterSeconds), 429, {
          "Retry-After": String(outcome.retryAfterSeconds),
        });
      }
      return c.json(outcome, 200);
    },
    monitorInvalidInputHook,
  );

  app.openapi(
    routes.testExisting,
    async (c) => {
      const { organizationId, monitorId } = c.req.valid("param");
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const outcome = await runTest(deps, {
        organizationId,
        actorUserId: session.user.id,
        monitorId,
        config: c.req.valid("json"),
        signal: c.req.raw.signal,
      });
      if ("retryAfterSeconds" in outcome) {
        return c.json(rateLimitedBody(outcome.retryAfterSeconds), 429, {
          "Retry-After": String(outcome.retryAfterSeconds),
        });
      }
      return c.json(outcome, 200);
    },
    monitorInvalidInputHook,
  );
}
