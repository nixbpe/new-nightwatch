import {
  errorResponseSchema,
  meContextResponseSchema,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError, type Logger } from "@nightwatch/shared";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { Auth, AuthSession } from "../auth";
import { registerMeRoutes } from "./routes";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const ORG_C = "33333333-3333-4333-8333-333333333333";
const ORG_D = "44444444-4444-4444-8444-444444444444";
const ORG_E = "55555555-5555-4555-8555-555555555555";
const ORG_F = "66666666-6666-4666-8666-666666666666";

const session: AuthSession = {
  user: {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  session: { id: "s1", token: "tok-1", expiresAt: new Date("2027-01-01") },
};

type SqlResult = { rows: Record<string, unknown>[] };

// Canned results; tests assert responses and audits, never the recorded SQL.
function stubDatabase(
  queryHandler: (text: string, params: unknown[]) => SqlResult,
  clientHandler?: (text: string, params: unknown[]) => SqlResult,
): Database {
  return {
    db: undefined as unknown as Database["db"],
    sql: {
      query: (text: string, params: unknown[]) =>
        Promise.resolve(queryHandler(text, params)),
      connect: () =>
        Promise.resolve({
          query: (text: string, params: unknown[]) =>
            Promise.resolve(clientHandler?.(text, params) ?? { rows: [] }),
          release: () => {},
        }),
    },
    close: () => Promise.resolve(),
  } as unknown as Database;
}

function stubAuth(current: AuthSession | null): Auth {
  return {
    handler: () => Promise.resolve(new Response()),
    getSession: () => Promise.resolve(current),
  };
}

type LoggerMock = Logger & { warn: Mock; info: Mock };

function stubLogger(): LoggerMock {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(),
  } as unknown as LoggerMock;
}

function makeApp(options: { auth: Auth; database: Database; logger: Logger }) {
  const app = new OpenAPIHono();
  registerMeRoutes(app, { ...options, trustedOrigin: "http://localhost:5173" });
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.statusCode as ContentfulStatusCode,
      );
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
  });
  return app;
}

const twoMemberships: SqlResult = {
  rows: [
    { organizationId: ORG_A, name: "Acme", slug: "acme", role: "owner" },
    { organizationId: ORG_B, name: "Beta", slug: "beta", role: "viewer" },
  ],
};

function contextQueryHandler(lastActiveTenantId: string | null) {
  return (text: string, params: unknown[]): SqlResult => {
    if (text.includes("from member")) {
      expect(params).toEqual(["user-1"]);
      return twoMemberships;
    }
    return { rows: [{ lastActiveTenantId }] };
  };
}

describe("GET /api/me/context", () => {
  it("answers 401 UNAUTHENTICATED without a session", async () => {
    const app = makeApp({
      auth: stubAuth(null),
      database: stubDatabase(() => ({ rows: [] })),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/context");
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("answers 403 EMAIL_NOT_VERIFIED for an unverified session", async () => {
    const unverified: AuthSession = {
      ...session,
      user: { ...session.user, emailVerified: false },
    };
    const app = makeApp({
      auth: stubAuth(unverified),
      database: stubDatabase(() => ({ rows: [] })),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/context");
    expect(res.status).toBe(403);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "EMAIL_NOT_VERIFIED",
    );
  });

  it("returns only the user's memberships, deterministically ordered, with a valid active selection", async () => {
    const app = makeApp({
      auth: stubAuth(session),
      database: stubDatabase(contextQueryHandler(ORG_B)),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/context");
    expect(res.status).toBe(200);
    expect(meContextResponseSchema.parse(await res.json())).toEqual({
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        twoFactorEnabled: false,
      },
      organizations: [
        { id: ORG_A, name: "Acme", slug: "acme", role: "owner" },
        { id: ORG_B, name: "Beta", slug: "beta", role: "viewer" },
      ],
      lastActiveTenantId: ORG_B,
    });
  });

  it("normalizes exact composite role tokens by UI priority without promoting unknown roles", async () => {
    const memberships: SqlResult = {
      rows: [
        {
          organizationId: ORG_A,
          name: "Acme",
          slug: "acme",
          role: "auditor, viewer",
        },
        {
          organizationId: ORG_B,
          name: "Beta",
          slug: "beta",
          role: "viewer, admin",
        },
        {
          organizationId: ORG_C,
          name: "Core",
          slug: "core",
          role: "auditor, owner, admin",
        },
        {
          organizationId: ORG_D,
          name: "Dormant",
          slug: "dormant",
          role: "homeowner, administrator",
        },
        {
          organizationId: ORG_E,
          name: "Evidence",
          slug: "evidence",
          role: "homeowner, viewer",
        },
        {
          organizationId: ORG_F,
          name: "Forensics",
          slug: "forensics",
          role: "auditor",
        },
      ],
    };
    const app = makeApp({
      auth: stubAuth(session),
      database: stubDatabase((text) =>
        text.includes("from member")
          ? memberships
          : { rows: [{ lastActiveTenantId: ORG_B }] },
      ),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/context");
    expect(res.status).toBe(200);
    const body = meContextResponseSchema.parse(await res.json());
    expect(body.organizations).toEqual([
      { id: ORG_A, name: "Acme", slug: "acme", role: "viewer" },
      { id: ORG_B, name: "Beta", slug: "beta", role: "admin" },
      { id: ORG_C, name: "Core", slug: "core", role: "owner" },
      { id: ORG_E, name: "Evidence", slug: "evidence", role: "viewer" },
      { id: ORG_F, name: "Forensics", slug: "forensics", role: "auditor" },
    ]);
    expect(body.lastActiveTenantId).toBe(ORG_B);
  });

  it("never exposes a stale lastActiveTenantId after membership loss", async () => {
    const revokedOrg = "99999999-9999-4999-8999-999999999999";
    const app = makeApp({
      auth: stubAuth(session),
      database: stubDatabase(contextQueryHandler(revokedOrg)),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/context");
    expect(res.status).toBe(200);
    expect(
      meContextResponseSchema.parse(await res.json()).lastActiveTenantId,
    ).toBeNull();
  });
});

describe("PATCH /api/me/active-org", () => {
  it("answers 401 without a session", async () => {
    const app = makeApp({
      auth: stubAuth(null),
      database: stubDatabase(() => ({ rows: [] })),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/active-org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: ORG_A }),
    });
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("rejects a non-member organization with 403 MEMBERSHIP_DENIED and an audit log without secrets", async () => {
    const logger = stubLogger();
    const app = makeApp({
      auth: stubAuth(session),
      database: stubDatabase(
        () => ({ rows: [] }),
        () => ({ rows: [] }),
      ),
      logger,
    });
    const res = await app.request("/api/me/active-org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: ORG_B }),
    });
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("MEMBERSHIP_DENIED");
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { code: "MEMBERSHIP_DENIED", reason: "NOT_MEMBER" },
      "active organization change denied: not a member",
    );
    const denyEvent = logger.warn.mock.calls[0];
    expect(denyEvent?.[0]).not.toHaveProperty("userId");
    expect(denyEvent?.[0]).not.toHaveProperty("organizationId");
    expect(JSON.stringify(denyEvent)).not.toContain(session.user.id);
    expect(JSON.stringify(denyEvent)).not.toContain(ORG_B);
  });

  it("switches the active organization and returns the fresh context", async () => {
    const clientHandler = (text: string): SqlResult =>
      text.includes("join organization")
        ? twoMemberships
        : { rows: [{ organizationId: ORG_A, role: "owner" }] };
    const app = makeApp({
      auth: stubAuth(session),
      database: stubDatabase(contextQueryHandler(ORG_A), clientHandler),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/active-org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: ORG_A }),
    });
    expect(res.status).toBe(200);
    expect(meContextResponseSchema.parse(await res.json())).toMatchObject({
      lastActiveTenantId: ORG_A,
    });
  });

  it("answers 500 without partially switching when the write fails mid-transaction", async () => {
    let calls = 0;
    const clientHandler = (): SqlResult => {
      calls += 1;
      if (calls === 2) throw new Error("connection lost");
      return { rows: [{ organizationId: ORG_A }] };
    };
    const app = makeApp({
      auth: stubAuth(session),
      database: stubDatabase(() => ({ rows: [] }), clientHandler),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/active-org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: ORG_A }),
    });
    expect(res.status).toBe(500);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "INTERNAL_ERROR",
    );
  });
});

describe("POST /api/me/resolve-active-org origin and final-session boundary", () => {
  it.each([undefined, "https://foreign.example", "null"])(
    "rejects Origin %s before any auth or SQL access",
    async (origin) => {
      const auth = stubAuth(session);
      const getSession = vi.spyOn(auth, "getSession");
      const query = vi.fn(() => ({ rows: [] }));
      const app = makeApp({
        auth,
        database: stubDatabase(query),
        logger: stubLogger(),
      });
      const res = await app.request("/api/me/resolve-active-org", {
        method: "POST",
        headers: origin ? { origin } : {},
      });
      expect(res.status).toBe(403);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
        "ORIGIN_DENIED",
      );
      expect(getSession).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { ...session, user: { ...session.user, emailVerified: false } },
  ])("rejects a non-final or unverified session", async (current) => {
    const query = vi.fn(() => ({ rows: [] }));
    const app = makeApp({
      auth: stubAuth(current),
      database: stubDatabase(query),
      logger: stubLogger(),
    });
    const res = await app.request("/api/me/resolve-active-org", {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(current === null ? 401 : 403);
    expect(query).not.toHaveBeenCalled();
  });
});
