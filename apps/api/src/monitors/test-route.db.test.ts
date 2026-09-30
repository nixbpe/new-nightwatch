import { OpenAPIHono } from "@hono/zod-openapi";
import {
  monitorTestResultSchema,
  monitorWriteResponseSchema,
  type MonitorConfigInput,
  type MonitorTestResult,
} from "@nightwatch/api-contract";
import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import {
  AppError,
  createLogger,
  type AuthEnv,
  type Env,
} from "@nightwatch/shared";
import type { Redis } from "ioredis";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import type { Auth, AuthSession } from "../auth";
import {
  createRateLimiter,
  createRedisClient,
  type RateLimiter,
} from "../rate-limit";
import { API_IDLE_TIMEOUT_SECONDS } from "../server-options";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { createSelfSignedCertificates } from "../testing/self-signed-certificates";
import { registerMonitorTestRoutes } from "./test-route";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for Test route tests");

const TARGET_HOST = "target.nw-test.internal";
const PUBLIC_HOST = "public.nw-test.example";
const PUBLIC_ADDRESS = "93.184.216.34";
const LOOPBACK = "127.0.0.1";
const appUrl = "http://localhost:5173";

type Role = "owner" | "admin" | "viewer" | "auditor";
type Reply = { status: number; json: unknown; headers: Headers };

// ---- Target servers -----------------------------------------------------------

type Listener = {
  port: number;
  /** TCP connections accepted since the last reset. */
  connections: () => number;
  /** Requests whose head arrived since the last reset. */
  requests: () => number;
  reset: () => void;
  /** Sockets of `/hold` requests that were closed by the client. */
  heldClosed: () => number;
  close: () => Promise<void>;
};

type ListenerRedirects = { httpPort?: () => number };

// One handler serves every scenario, chosen by path.
function targetHandler(
  redirects: ListenerRedirects,
  onHeldClose: () => void,
): http.RequestListener {
  return (request, response) => {
    const path = request.url ?? "/";
    const hop = /^\/hop\/(\d+)$/.exec(path);
    if (hop) {
      const next = Number(hop[1]) + 1;
      // 7 hops end in a 200; the executor stops after 5.
      if (next > 7) {
        response.writeHead(200).end("done");
        return;
      }
      response.writeHead(302, { location: `/hop/${String(next)}` }).end();
      return;
    }
    switch (path) {
      case "/ok":
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ status: "ok" }));
        return;
      case "/down":
        response.writeHead(503).end("unavailable");
        return;
      case "/to-metadata":
        response
          .writeHead(302, { location: "http://169.254.169.254/latest" })
          .end();
        return;
      case "/to-http":
        response
          .writeHead(302, {
            location: `http://${TARGET_HOST}:${String(redirects.httpPort?.() ?? 0)}/ok`,
          })
          .end();
        return;
      case "/hold":
        response.socket?.on("close", onHeldClose);
        return;
      default:
        response.writeHead(404).end();
    }
  };
}

async function listen(
  redirects: ListenerRedirects,
  tls?: { key: string; cert: string },
): Promise<Listener> {
  let connections = 0;
  let requests = 0;
  let heldClosed = 0;
  const handler = targetHandler(redirects, () => {
    heldClosed += 1;
  });
  const counted: http.RequestListener = (request, response) => {
    requests += 1;
    handler(request, response);
  };
  const server = tls
    ? (await import("node:https")).createServer(tls, counted)
    : http.createServer(counted);
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket: net.Socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("secureConnection", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    connections: () => connections,
    requests: () => requests,
    reset: () => {
      connections = 0;
      requests = 0;
      heldClosed = 0;
    },
    heldClosed: () => heldClosed,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

// ---- Redis fault injection -------------------------------------------------------

async function startReplyDelayProxy(ms: number) {
  const target = new URL(redisUrl as string);
  const sockets: net.Socket[] = [];
  const proxy = net.createServer((inbound) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    sockets.push(inbound, upstream);
    inbound.on("data", (chunk) => upstream.write(chunk));
    upstream.on("data", (chunk) => {
      setTimeout(() => inbound.write(chunk), ms);
    });
    inbound.on("error", () => undefined);
    upstream.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => proxy.listen(0, LOOPBACK, resolve));
  const { port } = proxy.address() as net.AddressInfo;
  return {
    url: `redis://${LOOPBACK}:${String(port)}`,
    close() {
      for (const socket of sockets) socket.destroy();
      proxy.close();
    },
  };
}

// ---- Harness ----------------------------------------------------------------------

const run = crypto.randomUUID().slice(0, 8);
const logLines: string[] = [];
const dns = new Map<string, string[]>();
let resolverCalls: string[] = [];
const sessions = new Map<string, AuthSession>();
const userIds: string[] = [];
const organizationIds: string[] = [];
const redisClients: Redis[] = [];

let runtime: Database;
let owner: Database;
let pki: ReturnType<typeof createSelfSignedCertificates>;
let http1: Listener;
let https1: Listener;
let httpsExpired: Listener;
let redis: Redis;
let fullApp: OpenAPIHono;
let noRedisApp: OpenAPIHono;
let clock = 1_000_000_000;
let clockedApp: OpenAPIHono;

const auth: Auth = {
  handler: () => Promise.resolve(new Response(null, { status: 404 })),
  getSession: (headers) =>
    Promise.resolve(sessions.get(headers.get("x-test-user") ?? "") ?? null),
};

function outboundDeps() {
  return {
    resolver: (hostname: string) => {
      resolverCalls.push(hostname);
      const addresses = dns.get(hostname);
      if (!addresses) {
        return Promise.reject(
          Object.assign(new Error("not found"), { code: "ENOTFOUND" }),
        );
      }
      return Promise.resolve(addresses);
    },
    testAllowedHosts: [TARGET_HOST],
    ca: pki.ca,
  };
}

const logger = () =>
  createLogger(
    { level: "info", name: "monitor-test-route" },
    { write: (line: string) => void logLines.push(line) },
  );

function buildFullApp(redisClient: Redis | undefined): OpenAPIHono {
  const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
  const authEnv: AuthEnv = {
    DATABASE_URL: requireIntegrationDatabaseUrls().runtimeUrl,
    BETTER_AUTH_SECRET: `monitor-test-route-${run}-0123456789abcdef`,
    APP_URL: appUrl,
    BETTER_AUTH_URL: "http://localhost:4000",
    CORS_ORIGIN: appUrl,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_FROM: "Monitor tests <monitor@example.test>",
  };
  return createApp({
    env,
    authEnv,
    auth,
    database: runtime,
    mailer: { send: () => Promise.resolve(), verify: () => Promise.resolve() },
    logger: logger(),
    outbound: outboundDeps(),
    ...(redisClient ? { redis: redisClient } : {}),
  });
}

// The full app has no clock seam, so the window-slide tests register the Test
// routes alone with a limiter whose clock the test moves.
function buildClockedApp(limiter: RateLimiter): OpenAPIHono {
  const app = new OpenAPIHono();
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.statusCode as 400,
      );
    }
    return c.json({ error: { code: "INTERNAL_ERROR" } }, 500);
  });
  registerMonitorTestRoutes(app, {
    auth,
    database: runtime,
    logger: logger(),
    outbound: outboundDeps(),
    rateLimiter: limiter,
  });
  return app;
}

function trackedRedis(url: string): Redis {
  const client = createRedisClient(url);
  redisClients.push(client);
  return client;
}

async function createUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await owner.sql.query(
    'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
    [id, label, `${label}-${run}-${id.slice(0, 4)}@example.test`],
  );
  sessions.set(id, {
    user: {
      id,
      email: `${label}@example.test`,
      name: label,
      emailVerified: true,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  userIds.push(id);
  return id;
}

async function createOrganization(
  label: string,
  extraAdmins = 0,
): Promise<{ id: string; users: Record<Role, string>; admins: string[] }> {
  const id = crypto.randomUUID();
  await owner.sql.query(
    "insert into organization (id, name, slug, created_at) values ($1, $2, $3, now())",
    [id, `${label} ${run}`, `${label}-${run}-${id.slice(0, 4)}`],
  );
  organizationIds.push(id);
  const users = {} as Record<Role, string>;
  const admins: string[] = [];
  const roles: { role: Role; label: string }[] = [
    { role: "owner", label: "owner" },
    { role: "admin", label: "admin" },
    { role: "viewer", label: "viewer" },
    { role: "auditor", label: "auditor" },
    ...Array.from({ length: extraAdmins }, (_, index) => ({
      role: "admin" as const,
      label: `admin${String(index + 2)}`,
    })),
  ];
  for (const { role, label: name } of roles) {
    const userId = await createUser(`${label}-${name}`);
    if (name === role) users[role] = userId;
    else admins.push(userId);
    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [crypto.randomUUID(), id, userId, role],
    );
  }
  return { id, users, admins };
}

async function call(
  app: OpenAPIHono,
  userId: string | null,
  path: string,
  body?: unknown,
  method: "GET" | "PATCH" | "POST" = "POST",
  signal?: AbortSignal,
): Promise<Reply> {
  const headers = new Headers({ origin: appUrl });
  if (userId) headers.set("x-test-user", userId);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as unknown) : null,
    headers: response.headers,
  };
}

const testPath = (organizationId: string, monitorId?: string) =>
  `/api/organizations/${organizationId}/monitors/${monitorId ? `${monitorId}/` : ""}test`;

const target = (
  listener: Listener,
  path: string,
  protocol: "http" | "https" = "http",
) => `${protocol}://${TARGET_HOST}:${String(listener.port)}${path}`;

function config(
  url: string,
  overrides: Partial<MonitorConfigInput> = {},
): MonitorConfigInput {
  return { name: "Test target", url, ...overrides };
}

const errorCode = (reply: Reply) =>
  (reply.json as { error?: { code?: string } } | null)?.error?.code;

function resultOf(reply: Reply): MonitorTestResult {
  expect(reply.status).toBe(200);
  const body = (reply.json ?? {}) as { result?: unknown };
  expect(Object.keys(body)).toEqual(["result"]);
  // Strict: an extra field (tls facts, an address) fails the parse.
  return monitorTestResultSchema.strict().parse(body.result);
}

// Counts per parent table: a partition another suite adds or drops while this
// one runs must not change the set of tables or the counts (a partitioned
// parent counts its rows across all partitions).
async function monitorTableCounts(
  organizationId: string,
): Promise<Record<string, number>> {
  const tables = await owner.sql.query<{
    name: string;
    has_tenant: boolean;
  }>(
    `select c.relname as name,
            exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id'
                      and not a.attisdropped) as has_tenant
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not c.relispartition and c.relname like 'monitor%'
     order by c.relname`,
  );
  // A monitor table without tenant_id would escape the per-Organization count.
  expect(tables.rows.filter((row) => !row.has_tenant)).toEqual([]);
  const counts: Record<string, number> = {};
  for (const { name } of tables.rows) {
    const rows = await owner.sql.query<{ total: string }>(
      `select count(*) as total from "${name}" where tenant_id = $1`,
      [organizationId],
    );
    counts[name] = Number(rows.rows[0]?.total ?? 0);
  }
  return counts;
}

async function clearRateLimitKeys(): Promise<void> {
  const keys = organizationIds.flatMap((id) => [`rl:monitor-test:o:${id}`]);
  for (const orgId of organizationIds) {
    keys.push(...(await redis.keys(`rl:monitor-test:u:*:o:${orgId}`)));
  }
  if (keys.length > 0) await redis.del(...keys);
}

let org: Awaited<ReturnType<typeof createOrganization>>;

beforeAll(async () => {
  const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
  runtime = createDatabase(runtimeUrl);
  owner = createDatabase(ownerUrl);
  await runMigrations({
    url: ownerUrl,
    migrationsDir:
      process.env.MIGRATIONS_DIR ??
      fileURLToPath(
        new URL("../../../../packages/db/migrations", import.meta.url),
      ),
  });
  pki = createSelfSignedCertificates(TARGET_HOST);
  const redirects: ListenerRedirects = {};
  http1 = await listen(redirects);
  redirects.httpPort = () => http1.port;
  https1 = await listen(redirects, pki.valid);
  httpsExpired = await listen(redirects, pki.expired);
  dns.set(TARGET_HOST, [LOOPBACK]);
  dns.set(PUBLIC_HOST, [PUBLIC_ADDRESS]);
  redis = trackedRedis(redisUrl);
  fullApp = buildFullApp(redis);
  noRedisApp = buildFullApp(undefined);
  clockedApp = buildClockedApp(createRateLimiter({ redis, now: () => clock }));
  org = await createOrganization("test-route");
}, 120_000);

afterAll(async () => {
  await clearRateLimitKeys();
  for (const client of redisClients) client.disconnect();
  await Promise.all([http1.close(), https1.close(), httpsExpired.close()]);
  pki.dispose();
  await owner.sql.query("delete from organization where id = any($1::uuid[])", [
    organizationIds,
  ]);
  await owner.sql.query('delete from "user" where id = any($1::text[])', [
    userIds,
  ]);
  await owner.close();
  await runtime.close();
});

function resetCounters(): void {
  http1.reset();
  https1.reset();
  httpsExpired.reset();
  resolverCalls = [];
}

const outboundSeen = () =>
  http1.connections() + https1.connections() + httpsExpired.connections();

// ---- Tests ------------------------------------------------------------------------

describe("role x operation", () => {
  const table: string[] = [];
  afterAll(() => {
    console.info(`Test role x operation (status)\n${table.join("\n")}\n`);
  });

  it.each(["owner", "admin", "viewer", "auditor"] as const)(
    "%s",
    async (role) => {
      const monitor = await createMonitor(org.id, org.users.owner);
      resetCounters();
      const before = await monitorTableCounts(org.id);
      const create = await call(
        fullApp,
        org.users[role],
        testPath(org.id),
        config(target(http1, "/ok")),
      );
      const edit = await call(
        fullApp,
        org.users[role],
        testPath(org.id, monitor),
        config(target(http1, "/ok")),
      );
      const allowed = role === "owner" || role === "admin";
      table.push(
        `${role.padEnd(8)} create=${String(create.status)} edit=${String(edit.status)} requests=${String(http1.requests())}`,
      );
      if (allowed) {
        expect([create.status, edit.status]).toEqual([200, 200]);
        expect(http1.requests()).toBe(2);
      } else {
        expect([create.status, edit.status]).toEqual([403, 403]);
        expect(errorCode(create)).toBe("PERMISSION_DENIED");
        expect(errorCode(edit)).toBe("PERMISSION_DENIED");
        expect(outboundSeen()).toBe(0);
        expect(resolverCalls).toEqual([]);
      }
      expect(await monitorTableCounts(org.id)).toEqual(before);
    },
  );

  it("denies a nonmember and a missing session before any outbound request", async () => {
    const outsider = await createUser("test-route-outsider");
    resetCounters();
    const foreign = await call(
      fullApp,
      outsider,
      testPath(org.id),
      config(target(http1, "/ok")),
    );
    const anonymous = await call(
      fullApp,
      null,
      testPath(org.id),
      config(target(http1, "/ok")),
    );
    expect([foreign.status, errorCode(foreign)]).toEqual([
      403,
      "MEMBERSHIP_DENIED",
    ]);
    expect(anonymous.status).toBe(401);
    expect(outboundSeen()).toBe(0);
  });

  it.each(["auditor", "viewer"] as const)(
    "writes one denial line for a %s on each variant, without ids or the URL",
    async (role) => {
      const monitorId = crypto.randomUUID();
      for (const path of [testPath(org.id), testPath(org.id, monitorId)]) {
        const start = logLines.length;
        const reply = await call(
          fullApp,
          org.users[role],
          path,
          config(target(http1, "/ok")),
        );
        expect(errorCode(reply)).toBe("PERMISSION_DENIED");
        const lines = logLines
          .slice(start)
          .filter((line) => line.includes("organization.monitor.test"));
        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0] as string) as Record<
          string,
          unknown
        >;
        expect(record).toMatchObject({
          level: 40,
          action: "organization.monitor.test",
          code: "PERMISSION_DENIED",
        });
        for (const secret of [org.id, monitorId, TARGET_HOST]) {
          expect(lines[0]).not.toContain(secret);
        }
      }
    },
  );

  it("answers a viewer 403 before it looks the monitor up", async () => {
    resetCounters();
    const reply = await call(
      fullApp,
      org.users.viewer,
      testPath(org.id, crypto.randomUUID()),
      config(target(http1, "/ok")),
    );
    expect(errorCode(reply)).toBe("PERMISSION_DENIED");
    expect(outboundSeen()).toBe(0);
  });
});

async function createMonitor(
  organizationId: string,
  userId: string,
  overrides: Partial<MonitorConfigInput> = {},
): Promise<string> {
  const reply = await call(
    fullApp,
    userId,
    `/api/organizations/${organizationId}/monitors`,
    {
      ...config(overrides.url ?? target(http1, "/ok")),
      ...overrides,
      clientRequestId: crypto.randomUUID(),
    },
  );
  expect(reply.status).toBe(201);
  return monitorWriteResponseSchema.parse(reply.json).monitor.id;
}

describe("monitor id (AC-48)", () => {
  it("answers a malformed, unknown and foreign id with the same 404", async () => {
    const other = await createOrganization("test-route-other");
    const foreign = await createMonitor(other.id, other.users.owner);
    resetCounters();
    const replies = await Promise.all(
      ["not-a-uuid", crypto.randomUUID(), foreign].map((id) =>
        call(
          fullApp,
          org.users.owner,
          testPath(org.id, id),
          config(target(http1, "/ok")),
        ),
      ),
    );
    for (const reply of replies) expect(reply.status).toBe(404);
    expect(
      new Set(replies.map((reply) => JSON.stringify(reply.json))).size,
    ).toBe(1);
    expect(errorCode(replies[0] as Reply)).toBe("MONITOR_NOT_FOUND");
    expect(outboundSeen()).toBe(0);
  });
});

describe("validation takes no quota and sends nothing (AC-28, AC-29)", () => {
  const long = `http://${TARGET_HOST}/${"a".repeat(2100)}`;
  const invalid: [string, Partial<MonitorConfigInput>, string, string][] = [
    ["empty url", { url: "" }, "url", "required"],
    ["not a url", { url: "not a url" }, "url", "invalid_format"],
    ["ftp scheme", { url: "ftp://x.example/" }, "url", "blocked_scheme"],
    [
      "userinfo",
      { url: `http://user:pw@${TARGET_HOST}/` },
      "url",
      "embedded_credentials",
    ],
    ["port 22", { url: `http://${TARGET_HOST}:22/` }, "url", "blocked_port"],
    ["too long", { url: long }, "url", "too_long"],
    [
      "too long once query params are added",
      {
        url: `http://${TARGET_HOST}/${"a".repeat(2000)}`,
        queryParams: [{ name: "k", value: "v".repeat(100) }],
      },
      "url",
      "too_long",
    ],
    [
      "Host header",
      { headers: [{ name: "Host", value: "x", secret: false }] },
      "headers.0.name",
      "blocked_header",
    ],
    [
      "CRLF in a header value",
      { headers: [{ name: "X-A", value: "a\r\nb: c", secret: false }] },
      "headers.0.value",
      "crlf",
    ],
    [
      "duplicate header names",
      {
        headers: [
          { name: "X-A", value: "1", secret: false },
          { name: "x-a", value: "2", secret: false },
        ],
      },
      "headers.1.name",
      "duplicate",
    ],
    [
      "Authorization header with bearer auth",
      {
        auth: { type: "bearer" },
        headers: [{ name: "Authorization", value: "x", secret: false }],
      },
      "headers.0.name",
      "auth_header_conflict",
    ],
  ];

  it.each(invalid)("%s", async (_label, overrides, field, reason) => {
    resetCounters();
    const user = org.admins[0] ?? org.users.admin;
    const reply = await call(
      fullApp,
      user,
      testPath(org.id),
      config(overrides.url ?? target(http1, "/ok"), overrides),
    );
    expect(reply.status).toBe(400);
    expect(errorCode(reply)).toBe("MONITOR_INVALID");
    expect(
      (
        reply.json as {
          error: { details: { fields: { field: string; reason: string }[] } };
        }
      ).error.details.fields,
    ).toContainEqual({ field, reason });
    expect(outboundSeen()).toBe(0);
    expect(resolverCalls).toEqual([]);
  });

  it("consumes no quota: no key exists after every invalid form", async () => {
    const user = await createUser("test-route-quota");
    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'admin', now(), now())`,
      [crypto.randomUUID(), org.id, user],
    );
    for (const [, overrides] of invalid) {
      await call(
        fullApp,
        user,
        testPath(org.id),
        config(overrides.url ?? target(http1, "/ok"), overrides),
      );
    }
    // A missing monitor is a lookup failure before the limiter as well.
    await call(
      fullApp,
      user,
      testPath(org.id, crypto.randomUUID()),
      config(target(http1, "/ok")),
    );
    expect(await redis.exists(`rl:monitor-test:u:${user}:o:${org.id}`)).toBe(0);
    const ok = await call(
      fullApp,
      user,
      testPath(org.id),
      config(target(http1, "/ok")),
    );
    expect(ok.status).toBe(200);
    expect(await redis.exists(`rl:monitor-test:u:${user}:o:${org.id}`)).toBe(1);
  });
});

describe("rate limit (AC-11)", () => {
  it("passes 10 per user, then answers 429 with retryAfterSeconds and Retry-After", async () => {
    const rlOrg = await createOrganization("test-route-user-limit");
    const user = rlOrg.users.admin;
    clock += 10_000_000;
    const path = testPath(rlOrg.id);
    const body = config(target(http1, "/ok"));
    resetCounters();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      clock += 1000;
      statuses.push((await call(clockedApp, user, path, body)).status);
    }
    expect(statuses).toEqual(Array(10).fill(200));
    const seenBefore = http1.requests();
    clock += 1000;
    const limited = await call(clockedApp, user, path, body);
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({
      error: {
        code: "MONITOR_TEST_RATE_LIMITED",
        message: expect.any(String) as string,
        details: { retryAfterSeconds: 50 },
      },
    });
    expect(limited.headers.get("retry-after")).toBe("50");
    expect(http1.requests()).toBe(seenBefore);

    // The oldest entry leaves the window 50 s later: one slot frees.
    clock += 50_000;
    expect((await call(clockedApp, user, path, body)).status).toBe(200);
    expect((await call(clockedApp, user, path, body)).status).toBe(429);
  });

  it("caps an Organization at 30 across users and frees it as the window slides", async () => {
    const rlOrg = await createOrganization("test-route-org-limit", 2);
    const writers = [rlOrg.users.owner, rlOrg.users.admin, ...rlOrg.admins];
    expect(writers).toHaveLength(4);
    clock += 10_000_000;
    const path = testPath(rlOrg.id);
    const body = config(target(http1, "/ok"));
    resetCounters();
    for (const user of writers.slice(0, 3)) {
      for (let i = 0; i < 10; i += 1) {
        clock += 100;
        expect((await call(clockedApp, user, path, body)).status).toBe(200);
      }
    }
    const seen = http1.requests();
    expect(seen).toBe(30);
    // The 31st request, from a fourth user with an untouched personal budget.
    clock += 100;
    const denied = await call(clockedApp, writers[3] as string, path, body);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).not.toBeNull();
    expect(http1.requests()).toBe(seen);

    clock += 61_000;
    expect(
      (await call(clockedApp, writers[3] as string, path, body)).status,
    ).toBe(200);
    expect(
      (await call(clockedApp, writers[0] as string, path, body)).status,
    ).toBe(200);
  });

  it("does not spend the Organization budget on a user who is already over their own", async () => {
    const rlOrg = await createOrganization("test-route-atomic", 1);
    clock += 10_000_000;
    const path = testPath(rlOrg.id);
    const body = config(target(http1, "/ok"));
    for (let i = 0; i < 10; i += 1) {
      clock += 100;
      await call(clockedApp, rlOrg.users.admin, path, body);
    }
    for (let i = 0; i < 5; i += 1) {
      clock += 100;
      expect(
        (await call(clockedApp, rlOrg.users.admin, path, body)).status,
      ).toBe(429);
    }
    // 10 of 30 are spent, so the second admin still has 10 more requests.
    for (let i = 0; i < 10; i += 1) {
      clock += 100;
      expect(
        (await call(clockedApp, rlOrg.admins[0] as string, path, body)).status,
      ).toBe(200);
    }
  });

  it("answers 503 and sends nothing when the API has no Redis", async () => {
    resetCounters();
    const reply = await call(
      noRedisApp,
      org.users.owner,
      testPath(org.id),
      config(target(http1, "/ok")),
    );
    expect([reply.status, errorCode(reply)]).toEqual([
      503,
      "RATE_LIMIT_UNAVAILABLE",
    ]);
    expect(outboundSeen()).toBe(0);
    expect(resolverCalls).toEqual([]);
  });

  it("answers 503 and sends nothing when Redis is down", async () => {
    // Nothing listens on port 1.
    const app = buildClockedApp(
      createRateLimiter({ redis: trackedRedis("redis://127.0.0.1:1") }),
    );
    resetCounters();
    const reply = await call(
      app,
      org.users.owner,
      testPath(org.id),
      config(target(http1, "/ok")),
    );
    expect([reply.status, errorCode(reply)]).toEqual([
      503,
      "RATE_LIMIT_UNAVAILABLE",
    ]);
    expect(outboundSeen()).toBe(0);
    expect(resolverCalls).toEqual([]);
  });

  it("answers 503 within about 2 s and sends nothing when Redis replies slowly", async () => {
    const proxy = await startReplyDelayProxy(2600);
    try {
      const app = buildClockedApp(
        createRateLimiter({ redis: trackedRedis(proxy.url) }),
      );
      resetCounters();
      const started = Date.now();
      const reply = await call(
        app,
        org.users.owner,
        testPath(org.id),
        config(target(http1, "/ok")),
      );
      const elapsed = Date.now() - started;
      expect([reply.status, errorCode(reply)]).toEqual([
        503,
        "RATE_LIMIT_UNAVAILABLE",
      ]);
      expect(elapsed).toBeLessThan(2600);
      expect(outboundSeen()).toBe(0);
      expect(resolverCalls).toEqual([]);
    } finally {
      proxy.close();
    }
  });
});

describe("target outcomes are results (AC-10, AC-32, AC-34)", () => {
  // Assertions that have nothing to judge when there is no response.
  const assertions: MonitorConfigInput["assertions"] = [
    { kind: "bodyContains", text: "ok" },
    { kind: "jsonPathEquals", path: "$.status", expected: "ok" },
    { kind: "responseTimeBelow", ms: 900 },
  ];
  const user = () => org.users.admin;

  async function outcome(
    overrides: Partial<MonitorConfigInput> & { url: string },
  ): Promise<MonitorTestResult> {
    // A fresh window per case; only the two-user limit matters here.
    await clearRateLimitKeys();
    const reply = await call(
      fullApp,
      user(),
      testPath(org.id),
      config(overrides.url, { assertions, ...overrides }),
    );
    const result = resultOf(reply);
    expect(JSON.stringify(reply.json)).not.toContain(LOOPBACK);
    return result;
  }

  function expectNoResponse(result: MonitorTestResult) {
    expect(result.httpStatus).toBeNull();
    expect(result.responseTimeMs).toBeNull();
    expect(result.assertions).toHaveLength(3);
    for (const assertion of result.assertions) {
      expect([assertion.status, assertion.reason]).toEqual([
        "not_evaluated",
        "no_response",
      ]);
    }
  }

  it("200 pass", async () => {
    resetCounters();
    const result = await outcome({ url: target(http1, "/ok") });
    expect(result).toMatchObject({
      outcome: "pass",
      httpStatus: 200,
      failureReason: null,
      tlsReason: null,
      url: `http://${TARGET_HOST}:${String(http1.port)}/ok`,
    });
    expect(result.assertions.map((assertion) => assertion.status)).toEqual([
      "pass",
      "pass",
      "pass",
    ]);
    expect(http1.requests()).toBe(1);
  });

  it("reports the certificate facts of an https target", async () => {
    const result = await outcome({ url: target(https1, "/ok", "https") });
    expect(result).toMatchObject({ outcome: "pass", tlsReason: null });
    expect(result.ssl).toMatchObject({ level: "ok", host: TARGET_HOST });
    expect(result.ssl.daysRemaining).toBeGreaterThanOrEqual(89);
    expect(result.ssl.issuer).toContain(TARGET_HOST);
    expect(new Date(result.ssl.notAfter as string).getTime()).toBeGreaterThan(
      Date.now() + 89 * 86_400_000,
    );
  });

  it("reports not_https for an http target and no_data when no TLS happened", async () => {
    expect((await outcome({ url: target(http1, "/ok") })).ssl.level).toBe(
      "not_https",
    );
    const dnsFailure = await outcome({
      url: `https://missing.nw-test.example:${String(https1.port)}/`,
    });
    expect(dnsFailure.ssl).toEqual({
      level: "no_data",
      daysRemaining: null,
      host: null,
      issuer: null,
      notAfter: null,
    });
  });

  it("503 is a failed check with the status", async () => {
    const result = await outcome({ url: target(http1, "/down") });
    expect(result).toMatchObject({
      outcome: "fail",
      httpStatus: 503,
      failureReason: "http_status",
    });
  });

  it.each([1, 10])(
    "times out at a %i s setting",
    async (seconds) => {
      http1.reset();
      const started = Date.now();
      const result = await outcome({
        url: target(http1, "/hold"),
        timeoutSeconds: seconds,
      });
      const elapsed = Date.now() - started;
      expect(result).toMatchObject({
        outcome: "fail",
        failureReason: "timeout",
      });
      expectNoResponse(result);
      expect(elapsed).toBeGreaterThanOrEqual(seconds * 1000 - 100);
      expect(elapsed).toBeLessThan(seconds * 1000 + 3000);
    },
    30_000,
  );

  it("DNS not found", async () => {
    const result = await outcome({
      url: `http://missing.nw-test.example:${String(http1.port)}/`,
    });
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "dns_not_found",
    });
    expectNoResponse(result);
  });

  it("expired TLS certificate", async () => {
    httpsExpired.reset();
    const result = await outcome({
      url: target(httpsExpired, "/ok", "https"),
    });
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "tls_invalid",
      tlsReason: "expired",
    });
    expect(result.ssl).toEqual({
      level: "expired",
      daysRemaining: null,
      host: TARGET_HOST,
      issuer: null,
      notAfter: null,
    });
    expectNoResponse(result);
    // The handshake fails before any request byte is sent.
    expect(httpsExpired.requests()).toBe(0);
  });

  it("redirect_limit after 6 hops", async () => {
    http1.reset();
    const result = await outcome({ url: target(http1, "/hop/0") });
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "redirect_limit",
    });
    expectNoResponse(result);
    // The original request plus 5 followed hops.
    expect(http1.requests()).toBe(6);
  });

  it("redirect_blocked on https to http", async () => {
    http1.reset();
    https1.reset();
    const result = await outcome({
      url: target(https1, "/to-http", "https"),
    });
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "redirect_blocked",
    });
    expectNoResponse(result);
    expect(https1.requests()).toBe(1);
    expect(http1.requests()).toBe(0);
  });

  it("redirect_blocked on a redirect to a forbidden address", async () => {
    http1.reset();
    const result = await outcome({ url: target(http1, "/to-metadata") });
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "redirect_blocked",
    });
    expectNoResponse(result);
    expect(http1.requests()).toBe(1);
  });

  it("reports a literal forbidden address as blocked_address, not 422", async () => {
    http1.reset();
    await clearRateLimitKeys();
    const reply = await call(
      fullApp,
      user(),
      testPath(org.id),
      config(`http://${LOOPBACK}:${String(http1.port)}/ok`, { assertions }),
    );
    const result = resultOf(reply);
    expect(result).toMatchObject({
      outcome: "fail",
      failureReason: "blocked_address",
    });
    expectNoResponse(result);
    expect(http1.connections()).toBe(0);
  });

  it("masks query values in the result and in every log line", async () => {
    await clearRateLimitKeys();
    const start = logLines.length;
    const reply = await call(
      fullApp,
      user(),
      testPath(org.id),
      config(target(http1, "/ok?apikey=s3cr3t-in-url"), {
        queryParams: [{ name: "token", value: "s3cr3t-param" }],
      }),
    );
    const result = resultOf(reply);
    expect(result.url).toContain("•••");
    const text = JSON.stringify(reply.json) + logLines.slice(start).join("\n");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain(LOOPBACK);
  });

  it("uses the request-level auth of the body: bearer without a stored secret is a check error", async () => {
    // Task 13 supplies stored secrets; until then a secret-bearing config cannot run.
    const result = await outcome({
      url: target(http1, "/ok"),
      auth: { type: "bearer" },
    });
    expect(result).toMatchObject({
      outcome: "check_error",
      failureReason: "executor_error",
    });
  });
});

describe("saved monitor whose host now resolves to a forbidden address (AC-62)", () => {
  it("reports blocked_address with no address in the body and no connection", async () => {
    dns.set(PUBLIC_HOST, [PUBLIC_ADDRESS]);
    const monitorId = await createMonitor(org.id, org.users.owner, {
      url: `http://${PUBLIC_HOST}:${String(http1.port)}/ok`,
    });
    dns.set(PUBLIC_HOST, [LOOPBACK]);
    try {
      await clearRateLimitKeys();
      resetCounters();
      const reply = await call(
        fullApp,
        org.users.owner,
        testPath(org.id, monitorId),
        config(`http://${PUBLIC_HOST}:${String(http1.port)}/ok`),
      );
      const result = resultOf(reply);
      expect(result).toMatchObject({
        outcome: "fail",
        failureReason: "blocked_address",
      });
      expect(JSON.stringify(reply.json)).not.toContain(LOOPBACK);
      expect(JSON.stringify(reply.json)).not.toContain(PUBLIC_ADDRESS);
      expect(http1.connections()).toBe(0);
      expect(resolverCalls).toContain(PUBLIC_HOST);
    } finally {
      dns.set(PUBLIC_HOST, [PUBLIC_ADDRESS]);
    }
  });
});

describe("no database write", () => {
  it("leaves every monitor table of the Organization unchanged", async () => {
    const monitorId = await createMonitor(org.id, org.users.owner);
    await clearRateLimitKeys();
    const before = await monitorTableCounts(org.id);
    const versions = await owner.sql.query(
      "select id, version, updated_at, last_check_at from monitors where tenant_id = $1 order by id",
      [org.id],
    );
    const cases: [string, unknown][] = [
      [testPath(org.id), config(target(http1, "/ok"))],
      [testPath(org.id, monitorId), config(target(http1, "/down"))],
      [testPath(org.id), config(target(http1, "/hold"), { timeoutSeconds: 1 })],
      [testPath(org.id), config("ftp://x.example/")],
    ];
    for (const [path, body] of cases) {
      await call(fullApp, org.users.owner, path, body);
    }
    expect(await monitorTableCounts(org.id)).toEqual(before);
    expect(
      (
        await owner.sql.query(
          "select id, version, updated_at, last_check_at from monitors where tenant_id = $1 order by id",
          [org.id],
        )
      ).rows,
    ).toEqual(versions.rows);
  });

  it("writes no audit line for a successful Test", async () => {
    await clearRateLimitKeys();
    const start = logLines.length;
    await call(
      fullApp,
      org.users.owner,
      testPath(org.id),
      config(target(http1, "/ok")),
    );
    expect(
      logLines.slice(start).filter((line) => line.includes("monitor mutation")),
    ).toEqual([]);
  });
});

describe("client disconnect", () => {
  it("aborts the outbound request when the request signal fires", async () => {
    await clearRateLimitKeys();
    http1.reset();
    const controller = new AbortController();
    const pending = call(
      fullApp,
      org.users.owner,
      testPath(org.id),
      config(target(http1, "/hold"), { timeoutSeconds: 30 }),
      "POST",
      controller.signal,
    ).catch((error: unknown) => error);
    const deadline = Date.now() + 5000;
    while (http1.requests() === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(http1.requests()).toBe(1);
    controller.abort();
    await pending;
    const closeDeadline = Date.now() + 3000;
    while (http1.heldClosed() === 0 && Date.now() < closeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // The target sees its socket closed long before the 30 s timeout.
    expect(http1.heldClosed()).toBe(1);
  }, 20_000);
});

// Bun closes an idle HTTP connection after 10 s by default; app.fetch on Node
// cannot show that, so these cases run on a real Bun.serve (`bun run test:bun`).
describe.runIf(typeof Bun !== "undefined")("on a real Bun listener", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: LOOPBACK,
      idleTimeout: API_IDLE_TIMEOUT_SECONDS,
      fetch: fullApp.fetch,
    });
  });
  afterAll(async () => {
    await server.stop(true);
  });

  const send = (body: unknown, signal?: AbortSignal) =>
    fetch(`http://${LOOPBACK}:${String(server.port)}${testPath(org.id)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appUrl,
        "x-test-user": org.users.admin,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

  it("returns the timeout result of a Test that waits past Bun's 10 s default", async () => {
    await clearRateLimitKeys();
    http1.reset();
    const started = Date.now();
    const response = await send(
      config(target(http1, "/hold"), { timeoutSeconds: 15 }),
    );
    const elapsed = Date.now() - started;
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: unknown };
    expect(monitorTestResultSchema.strict().parse(result)).toMatchObject({
      outcome: "fail",
      failureReason: "timeout",
    });
    expect(elapsed).toBeGreaterThanOrEqual(14_000);
  }, 40_000);

  it("aborts the outbound request when the client closes its connection", async () => {
    await clearRateLimitKeys();
    http1.reset();
    const controller = new AbortController();
    const pending = send(
      config(target(http1, "/hold"), { timeoutSeconds: 30 }),
      controller.signal,
    ).catch((error: unknown) => error);
    const deadline = Date.now() + 5000;
    while (http1.requests() === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(http1.requests()).toBe(1);
    controller.abort();
    await pending;
    const closeDeadline = Date.now() + 3000;
    while (http1.heldClosed() === 0 && Date.now() < closeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(http1.heldClosed()).toBe(1);
  }, 20_000);
});
