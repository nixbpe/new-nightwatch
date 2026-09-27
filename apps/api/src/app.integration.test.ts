import {
  errorResponseSchema,
  helloResponseSchema,
  invitationResponseSchema,
  readinessResponseSchema,
  versionResponseSchema,
} from "@nightwatch/api-contract";
import { DB_READINESS_TIMEOUT_MS, type Database } from "@nightwatch/db";
import {
  AppError,
  createLogger,
  type AuthEnv,
  type Env,
  type Logger,
} from "@nightwatch/shared";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Auth } from "./auth";

const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: "postgres://runtime:pw@localhost:5432/nightwatch",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret!!",
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "NightWatch Test <no-reply@nightwatch.test>",
};

function makeApp(options?: {
  auth?: Auth;
  database?: Database;
  logger?: Logger;
}) {
  const app = createApp({
    env,
    authEnv,
    logger: createLogger({ level: "silent", name: "test" }),
    ...options,
  });
  // Test-only probes exercising the centralized error handler.
  app.get("/__test/app-error", () => {
    throw new AppError(403, "HELLO_FORBIDDEN", "greeting is not allowed", {
      reason: "test",
    });
  });
  app.get("/__test/boom", () => {
    throw new Error("connection string postgres://user:sekret@db:5432 leaked");
  });
  return app;
}

describe("GET /api/v1/hello", () => {
  it("responds 200 with the contract shape and a request id", async () => {
    const res = await makeApp().request("/api/v1/hello");
    expect(res.status).toBe(200);
    expect(helloResponseSchema.parse(await res.json())).toEqual({
      message: "Hello from NightWatch",
      timestamp: expect.any(String) as string,
    });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("system endpoints", () => {
  it("GET /health reports liveness", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready reports readiness with named checks", async () => {
    const res = await makeApp().request("/ready");
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(await res.json())).toEqual({
      status: "ready",
      checks: { self: "ok" },
    });
  });

  it("GET /version reports package identity", async () => {
    const res = await makeApp().request("/version");
    expect(res.status).toBe(200);
    expect(versionResponseSchema.parse(await res.json())).toEqual({
      name: "@nightwatch/api",
      version: "0.0.1",
    });
  });
});

describe("error contract", () => {
  it("maps AppError to its code, message, details and status", async () => {
    const res = await makeApp().request("/__test/app-error");
    expect(res.status).toBe(403);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "HELLO_FORBIDDEN",
        message: "greeting is not allowed",
        details: { reason: "test" },
      },
    });
  });

  it("maps unknown errors to a generic 500 without leaking internals", async () => {
    const res = await makeApp().request("/__test/boom");
    expect(res.status).toBe(500);
    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("returns the error envelope for unknown routes", async () => {
    const res = await makeApp().request("/no-such-route");
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("request completion logging", () => {
  it("redacts organization namespace audit inputs in actual completion logs", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const memberId = "22222222-2222-4222-8222-222222222222";
    const logLines: string[] = [];
    const app = makeApp({
      logger: createLogger(
        { level: "info", name: "request-completion-test" },
        { write: (line: string) => void logLines.push(line) },
      ),
    });
    const paths = [
      {
        input: `/api/organizations/${organizationId}/members`,
        expected: "/api/organizations/:organizationId/members",
      },
      {
        input: `/api/organizations/${organizationId}/members/`,
        expected: "/api/organizations/:organizationId/members/",
      },
      {
        input: `/api/organizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/organizations/${organizationId}/members/${memberId}/role`,
        expected: "/api/organizations/:organizationId/members/:memberId/role",
      },
      {
        input: `/api/organizations/${organizationId}/members/${memberId}/role/extra`,
        expected:
          "/api/organizations/:organizationId/members/:memberId/role/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/notification-settings`,
        expected: "/api/organizations/:organizationId/notification-settings",
      },
      {
        input: `/api/organizations/${organizationId}//members//${memberId}/role`,
        expected: "/api/organizations/:organizationId//members//:memberId/role",
      },
      {
        input: `/api/organizations//members//${memberId}/role`,
        expected: "/api/organizations//:organizationId//:segment/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members%2F${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members%2f${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations/${organizationId}%2Fmembers/${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations/${organizationId}%2fmembers/${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations%2F${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:ambiguous",
      },
      {
        input: `/api/organizations%2f${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:ambiguous",
      },
      {
        input: `/api/organizations/${organizationId}/members%5C${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members%5c${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations%5C${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:ambiguous",
      },
      {
        input: `/api/organizations/${organizationId}/members%252F${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members;v=1/${memberId}`,
        expected: "/api/organizations/:organizationId/:segment/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members%3Bv=1/${memberId}`,
        expected: "/api/organizations/:organizationId/:segment/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members%3F${memberId}`,
        expected: "/api/organizations/:organizationId/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/members/${memberId}?limit=50`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/organizations/${organizationId}/members%ZZ/${memberId}`,
        expected: "/api/organizations/:organizationId/:segment/:segment",
      },
      {
        input: `/api/organizations/${organizationId}/unknown/${memberId}`,
        expected: "/api/organizations/:organizationId/:segment/:segment",
      },
      {
        input: "/api/organizations/",
        expected: "/api/organizations/",
      },
      {
        input: "/api/organizations",
        expected: "/api/organizations",
      },
      {
        input: `/api/%6frganizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/org%61nizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/organization%73/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/%6Frg%61nization%73/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/organizatio%256Es/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/organizatio%25256Es/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/organizatio%252525256Es/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api/%256Frg%252561nization%252573/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/%61pi/organizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api%2Forganizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `%2Fapi%2Forganizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/%2561pi%252Forganizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/%2561p%69%252Forganiz%2561tions/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `%252Fapi%252Forganizations/${organizationId}/members/${memberId}`,
        expected: "/api/organizations/:organizationId/members/:memberId",
      },
      {
        input: `/api%2Gorganizations/${organizationId}/members/${memberId}`,
        expected: `/api%2Gorganizations/${organizationId}/members/${memberId}`,
      },
      {
        input: `/api/org%6bnizations/${organizationId}/members/${memberId}`,
        expected: `/api/orgknizations/${organizationId}/members/${memberId}`,
      },
      {
        input: `/api/organizat%6Gions/${organizationId}/members/${memberId}`,
        expected: `/api/organizat%6Gions/${organizationId}/members/${memberId}`,
      },
      {
        input: `/api/projects/${organizationId}/members/${memberId}`,
        expected: `/api/projects/${organizationId}/members/${memberId}`,
      },
    ];

    const responses: Response[] = [];
    for (const { input } of paths) {
      responses.push(await app.request(input));
    }

    expect(responses.map((response) => response.status)).toEqual(
      paths.map(() => 404),
    );

    const completions = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "request completed");
    expect(completions.map((entry) => entry.path)).toEqual(
      paths.map(({ expected }) => expected),
    );
    for (const [index, completion] of completions.entries()) {
      if (!paths[index]?.expected.includes(":")) continue;
      expect(JSON.stringify(completion)).not.toContain(organizationId);
      expect(JSON.stringify(completion)).not.toContain(memberId);
    }
  });
});

describe("OpenAPI", () => {
  it("serves the spec containing the hello route", async () => {
    const res = await makeApp().request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths).toHaveProperty("/api/v1/hello");
    expect(spec.paths).toHaveProperty("/health");
    expect(spec.paths).toHaveProperty("/ready");
    expect(spec.paths).toHaveProperty("/version");
  });
});

describe("auth boundary wiring", () => {
  const stubAuth: Auth = {
    handler: () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    getSession: () => Promise.resolve(null),
  };

  function stubDatabase(
    query: (queryConfig: unknown, params?: unknown[]) => unknown,
  ) {
    return {
      db: undefined as unknown as Database["db"],
      sql: {
        query: (queryConfig: unknown, params?: unknown[]) =>
          Promise.resolve(query(queryConfig, params)),
        connect: () => {
          throw new Error("not used in tests");
        },
      } as unknown as Database["sql"],
      close: () => Promise.resolve(),
    } satisfies Database;
  }

  it("returns the canonical 400 envelope for request-validation failures without leaking input", async () => {
    const submittedOrganizationId = "submitted-invalid-organization-id";
    const app = makeApp({
      auth: stubAuth,
      database: stubDatabase(() => ({ rows: [] })),
    });
    const res = await app.request("/api/me/active-org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: submittedOrganizationId }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(errorResponseSchema.parse(body)).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
      },
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain("success");
    expect(serializedBody).not.toContain("ZodError");
    expect(serializedBody).not.toContain(submittedOrganizationId);
  });

  it("routes /api/auth/* through the composed auth handler", async () => {
    const app = makeApp({
      auth: stubAuth,
      database: stubDatabase(() => ({ rows: [] })),
    });
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "x", name: "A" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers credentialed CORS preflight with the invitation header allow-listed", async () => {
    const app = makeApp({
      auth: stubAuth,
      database: stubDatabase(() => ({ rows: [] })),
    });
    const res = await app.request("/api/auth/sign-up/email", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-invitation-id",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const allowHeaders =
      res.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    expect(allowHeaders).toContain("x-invitation-id");
  });

  it("rejects cross-origin preflights from untrusted origins", async () => {
    const app = makeApp({
      auth: stubAuth,
      database: stubDatabase(() => ({ rows: [] })),
    });
    const res = await app.request("/api/auth/sign-up/email", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("checks database readiness with a query deadline and reports rejection as not_ready", async () => {
    let issuedQuery: unknown;
    const healthy = makeApp({
      auth: stubAuth,
      database: stubDatabase((queryConfig) => {
        issuedQuery = queryConfig;
        return { rows: [] };
      }),
    });
    const res = await healthy.request("/ready");
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(await res.json())).toEqual({
      status: "ready",
      checks: { database: "ok" },
    });
    expect(issuedQuery).toEqual({
      text: "select 1",
      query_timeout: DB_READINESS_TIMEOUT_MS,
    });

    const unhealthy = makeApp({
      auth: stubAuth,
      database: stubDatabase(() => {
        throw new Error("connection refused");
      }),
    });
    const res503 = await unhealthy.request("/ready");
    expect(res503.status).toBe(503);
    expect(readinessResponseSchema.parse(await res503.json())).toEqual({
      status: "not_ready",
      checks: { database: "fail" },
    });
  });

  it("returns canonical not_ready within the application deadline when the database query remains pending", async () => {
    vi.useFakeTimers();
    let resolveQueryIssued!: () => void;
    const queryIssued = new Promise<void>((resolve) => {
      resolveQueryIssued = resolve;
    });

    try {
      const app = makeApp({
        auth: stubAuth,
        database: stubDatabase(() => {
          resolveQueryIssued();
          return new Promise<never>(() => {});
        }),
      });
      let completed = false;
      const responsePromise = Promise.resolve(app.request("/ready")).then(
        (response) => {
          completed = true;
          return response;
        },
      );
      await queryIssued;

      await vi.advanceTimersByTimeAsync(DB_READINESS_TIMEOUT_MS - 1);
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const response = await responsePromise;
      expect(response.status).toBe(503);
      expect(readinessResponseSchema.parse(await response.json())).toEqual({
        status: "not_ready",
        checks: { database: "fail" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the invitation preview for a pending invitation", async () => {
    const database = stubDatabase(() => ({
      rows: [
        {
          id: "inv_1",
          email: "user@example.com",
          role: "viewer",
          expiresAt: new Date("2026-10-08T00:00:00.000Z"),
          organizationName: "Acme Corp",
        },
      ],
    }));
    const app = makeApp({ auth: stubAuth, database });
    const res = await app.request("/api/onboarding/invitations/inv_1");
    expect(res.status).toBe(200);
    expect(invitationResponseSchema.parse(await res.json())).toEqual({
      invitation: {
        id: "inv_1",
        email: "user@example.com",
        organizationName: "Acme Corp",
        role: "viewer",
        expiresAt: "2026-10-08T00:00:00.000Z",
      },
    });
  });

  it("returns the safe error envelope for missing invitations", async () => {
    const app = makeApp({
      auth: stubAuth,
      database: stubDatabase(() => ({ rows: [] })),
    });
    const res = await app.request("/api/onboarding/invitations/nope");
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "INVITATION_NOT_FOUND",
    );
  });
});
