import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  emailNotVerifiedErrorResponseSchema,
  invalidInputErrorResponseSchema,
  membershipDeniedErrorResponseSchema,
  canonicalSecretSlot,
  credentialsUnavailableErrorResponseSchema,
  monitorInvalidErrorResponseSchema,
  monitorNotFoundErrorResponseSchema,
  monitorOrganizationParamsSchema,
  monitorParamsSchema,
  monitorSecretOriginChangedErrorResponseSchema,
  monitorTestCreateSchema,
  monitorTestEditSchema,
  monitorTestRateLimitedErrorResponseSchema,
  monitorTestResponseSchema,
  normalizeMonitorConfig,
  permissionDeniedErrorResponseSchema,
  rateLimitUnavailableErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
  unsupportedMediaTypeErrorResponseSchema,
  type MonitorConfig,
  type MonitorSecretEditEntry,
  type MonitorTestResult,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import {
  AppError,
  buildCheckUrl,
  decryptSecret,
  runCheck,
  type CredentialEnv,
  type Logger,
  type MonitorSecrets,
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
import {
  MONITOR_COLUMNS,
  assignHeaderIds,
  storedFromRow,
  toStoredConfig,
  type MonitorRow,
  type StoredConfig,
} from "./record";
import {
  assertSameOrigin,
  planSecrets,
  requiredSlots,
  type SecretPlan,
} from "./secrets";
import {
  assertMonitorExists,
  parseMonitorId,
  requireCredentials,
  URL_REASONS,
} from "./service";

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
    "The rate limiter is unavailable, or credential encryption is not configured for a kept secret; no request was sent",
    z.union([
      rateLimitUnavailableErrorResponseSchema,
      credentialsUnavailableErrorResponseSchema,
    ]),
  ),
} as const;

const createBody = {
  content: { "application/json": { schema: monitorTestCreateSchema } },
  required: true,
} as const;
const editBody = {
  content: { "application/json": { schema: monitorTestEditSchema } },
  required: true,
} as const;

export const monitorTestRouteDeclarations = {
  test: createRoute({
    method: "post",
    path: `${monitorBase}/test`,
    tags,
    summary: "Test a monitor configuration before it is created",
    request: { params: monitorOrganizationParamsSchema, body: createBody },
    responses: testResponses,
  }),
  testExisting: createRoute({
    method: "post",
    path: `${monitorBase}/{monitorId}/test`,
    tags,
    summary: "Test a configuration in the edit form of an existing monitor",
    request: { params: monitorParamsSchema, body: editBody },
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
      422: jsonError(
        "The scheme, host or port changed while a stored secret is kept; nothing was sent",
        monitorSecretOriginChangedErrorResponseSchema,
      ),
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
  /** Decrypts kept secrets; absent, a Test that keeps one answers 503. */
  credentialEnv?: CredentialEnv;
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

function toNormalizedConfig(
  config: MonitorConfig,
  headers: StoredConfig["headers"],
): NormalizedMonitorConfig {
  const { expectedStatusRanges, assertions } = normalizeMonitorConfig(config);
  return {
    url: config.url,
    method: config.method,
    timeoutSeconds: config.timeoutSeconds,
    headers,
    queryParams: config.queryParams,
    body: config.body,
    expectedStatus: expectedStatusRanges,
    assertions,
    auth: config.auth,
  };
}

type SecretRow = {
  slot: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: string;
};

type TestSecrets = {
  headers: StoredConfig["headers"];
  /** Values typed in the form, for this request only. */
  provided: Record<string, string>;
  /** Stored rows of the `keep` slots, decrypted after the connection is released. */
  kept: SecretRow[];
};

// Reads the stored monitor and only the ciphertext of `keep` slots, in one
// short transaction; the outbound request starts after the connection is back
// in the pool. A destination change with a kept slot ends here, before any
// quota is spent or request sent (AC-44).
async function prepareEditSecrets(
  database: Database,
  input: {
    organizationId: string;
    monitorId: string;
    config: MonitorConfig;
    entries: MonitorSecretEditEntry[];
    credentialEnv: CredentialEnv | undefined;
  },
): Promise<TestSecrets> {
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const found = await client.query<MonitorRow>(
        `select ${MONITOR_COLUMNS} from monitors
         where id = $1 and tenant_id = $2`,
        [input.monitorId, input.organizationId],
      );
      const row = found.rows[0];
      if (!row) {
        throw new AppError(404, "MONITOR_NOT_FOUND", "ไม่พบมอนิเตอร์นี้");
      }
      const previous = storedFromRow(row);
      const next = toStoredConfig(input.config);
      next.headers = assignHeaderIds(next.headers, previous.headers);
      const slots = await client.query<{ slot: string }>(
        "select slot from monitor_secrets where monitor_id = $1",
        [input.monitorId],
      );
      const plan = planSecrets({
        required: requiredSlots(next),
        entries: input.entries,
        stored: new Set(slots.rows.map((entry) => entry.slot)),
        mode: "test",
      });
      if (plan.keeps.length > 0) {
        assertSameOrigin(previous, next);
        requireCredentials(input.credentialEnv);
      }
      const kept =
        plan.keeps.length === 0
          ? []
          : (
              await client.query<SecretRow>(
                `select slot, ciphertext, iv, auth_tag, key_version
                 from monitor_secrets
                 where monitor_id = $1 and slot = any($2::text[])`,
                [input.monitorId, plan.keeps],
              )
            ).rows;
      return { headers: next.headers, provided: valuesOf(plan), kept };
    },
  );
}

function valuesOf(plan: SecretPlan): Record<string, string> {
  return Object.fromEntries(plan.writes.map((w) => [w.slot, w.value]));
}

function prepareCreateSecrets(
  config: MonitorConfig & {
    secrets: { slot: string; value: string }[];
  },
): TestSecrets {
  const stored = toStoredConfig(config);
  const plan = planSecrets({
    required: requiredSlots(stored),
    entries: config.secrets.map((entry) => ({
      ...entry,
      action: "replace" as const,
    })),
    stored: new Set(),
    mode: "test",
  });
  return { headers: stored.headers, provided: valuesOf(plan), kept: [] };
}

// A row that cannot be decrypted is left out; the executor then reports the
// missing slot as a check error, as the scheduled check does.
function decryptKept(
  input: { organizationId: string; monitorId: string },
  secrets: TestSecrets,
  env: CredentialEnv | undefined,
): { values: MonitorSecrets; undecryptable: boolean } {
  const values: Record<string, string> = { ...secrets.provided };
  let undecryptable = false;
  for (const row of secrets.kept) {
    try {
      values[row.slot] = decryptSecret(
        {
          tenantId: input.organizationId,
          monitorId: input.monitorId,
          slot: canonicalSecretSlot(row.slot),
          keyVersion: row.key_version,
          iv: row.iv,
          authTag: row.auth_tag,
          ciphertext: row.ciphertext,
        },
        requireCredentials(env),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      undecryptable = true;
    }
  }
  return { values, undecryptable };
}

async function runTest(
  deps: MonitorTestRouteDeps,
  input: {
    organizationId: string;
    actorUserId: string;
    monitorId?: string;
    config: MonitorConfig;
    /** Create-style entries (test before create) or Edit-style entries. */
    entries: {
      slot: string;
      action?: MonitorSecretEditEntry["action"];
      value?: string;
    }[];
    signal: AbortSignal;
  },
): Promise<{ result: MonitorTestResult } | { retryAfterSeconds: number }> {
  const { database, logger, outbound, rateLimiter } = deps;
  let monitorId: string | undefined;
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
        monitorId = parseMonitorId(input.monitorId);
        await assertMonitorExists(database, input, monitorId);
      }
    },
  );
  assertRequestableUrl(input.config);

  const secrets =
    monitorId === undefined
      ? prepareCreateSecrets({
          ...input.config,
          secrets: input.entries.map((entry) => ({
            slot: entry.slot,
            value: entry.value ?? "",
          })),
        })
      : await prepareEditSecrets(database, {
          organizationId: input.organizationId,
          monitorId,
          config: input.config,
          entries: input.entries.map((entry) => ({
            slot: entry.slot,
            action: entry.action ?? "replace",
            ...(entry.value === undefined ? {} : { value: entry.value }),
          })),
          credentialEnv: deps.credentialEnv,
        });

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

  const opened =
    monitorId === undefined
      ? { values: secrets.provided, undecryptable: false }
      : decryptKept(
          { organizationId: input.organizationId, monitorId },
          secrets,
          deps.credentialEnv,
        );
  const ran = await runCheck(
    toNormalizedConfig(input.config, secrets.headers),
    opened.values,
    { ...outbound, signal: input.signal },
  );
  // The scheduled check reports the same condition under the same reason.
  const checked =
    opened.undecryptable && ran.failureReason === "executor_error"
      ? { ...ran, failureReason: "secret_decrypt_failed" as const }
      : ran;
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
      const body = c.req.valid("json");
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const outcome = await runTest(deps, {
        organizationId,
        actorUserId: session.user.id,
        config: body,
        entries: body.secrets,
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
      const body = c.req.valid("json");
      const session = await requireVerifiedSession(
        deps.auth,
        c.req.raw.headers,
      );
      const outcome = await runTest(deps, {
        organizationId,
        actorUserId: session.user.id,
        monitorId,
        config: body,
        entries: body.secrets,
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
