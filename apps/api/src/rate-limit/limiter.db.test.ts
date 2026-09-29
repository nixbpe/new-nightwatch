import { randomUUID } from "node:crypto";
import net from "node:net";

import { readinessResponseSchema } from "@nightwatch/api-contract";
import { DB_READINESS_TIMEOUT_MS, type Database } from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import {
  consumeMonitorTestRateLimit,
  createRateLimiter,
  createRedisClient,
  RATE_LIMIT_TIMEOUT_MS,
} from "./index";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for rate limiter tests");

// Nothing listens here, so the client sees a refused connection (Redis down).
const closedPortUrl = "redis://127.0.0.1:1";

const clients: Redis[] = [];
function client(url: string): Redis {
  const redis = createRedisClient(url);
  clients.push(redis);
  return redis;
}

afterAll(() => {
  for (const redis of clients) redis.disconnect();
});

describe("consumeRateLimit", () => {
  const redis = client(redisUrl);
  const windowMs = 60_000;
  const keys: string[] = [];
  function freshKey(): string {
    const key = `rl:test:${randomUUID()}`;
    keys.push(key);
    return key;
  }

  afterAll(async () => {
    if (keys.length > 0) await redis.del(...keys);
  });

  it("allows up to the limit and denies the next request with a retry hint", async () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const key = freshKey();
    for (let i = 0; i < 3; i += 1) {
      clock += 1000;
      expect(
        await limiter.consumeRateLimit({ key, limit: 3, windowMs }),
      ).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    clock += 1000;
    // Oldest entry is 3 s old, so 57 s remain.
    expect(await limiter.consumeRateLimit({ key, limit: 3, windowMs })).toEqual(
      { allowed: false, retryAfterSeconds: 57 },
    );
  });

  it("does not count denied requests against the window", async () => {
    let clock = 5_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const key = freshKey();
    await limiter.consumeRateLimit({ key, limit: 1, windowMs });
    for (let i = 0; i < 5; i += 1) {
      clock += 1000;
      await limiter.consumeRateLimit({ key, limit: 1, windowMs });
    }
    clock += windowMs - 5000;
    expect(
      (await limiter.consumeRateLimit({ key, limit: 1, windowMs })).allowed,
    ).toBe(true);
  });

  it("frees a slot as the window slides", async () => {
    let clock = 9_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const key = freshKey();
    await limiter.consumeRateLimit({ key, limit: 2, windowMs });
    clock += 30_000;
    await limiter.consumeRateLimit({ key, limit: 2, windowMs });
    clock += 29_000;
    expect(
      (await limiter.consumeRateLimit({ key, limit: 2, windowMs })).allowed,
    ).toBe(false);
    clock += 1001;
    expect(await limiter.consumeRateLimit({ key, limit: 2, windowMs })).toEqual(
      { allowed: true, retryAfterSeconds: 0 },
    );
    clock += 1000;
    // Entries at +30 s and +60 s remain; the first is 30 s away from expiry.
    expect(await limiter.consumeRateLimit({ key, limit: 2, windowMs })).toEqual(
      { allowed: false, retryAfterSeconds: 29 },
    );
  });

  it("keeps per-user and per-org budgets independent", async () => {
    let clock = 20_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const org = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    keys.push(
      `rl:monitor-test:u:${userA}:o:${org}`,
      `rl:monitor-test:u:${userB}:o:${org}`,
      `rl:monitor-test:o:${org}`,
    );
    for (let i = 0; i < 10; i += 1) {
      clock += 10;
      expect(
        (
          await consumeMonitorTestRateLimit(limiter, {
            userId: userA,
            organizationId: org,
          })
        ).allowed,
      ).toBe(true);
    }
    // User A is at 10 per user; user B in the same org is unaffected.
    expect(
      (
        await consumeMonitorTestRateLimit(limiter, {
          userId: userA,
          organizationId: org,
        })
      ).allowed,
    ).toBe(false);
    expect(
      (
        await consumeMonitorTestRateLimit(limiter, {
          userId: userB,
          organizationId: org,
        })
      ).allowed,
    ).toBe(true);
  });

  it("denies at 30 per org and leaves the per-user budget unconsumed", async () => {
    let clock = 30_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const org = randomUUID();
    const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    keys.push(
      `rl:monitor-test:o:${org}`,
      ...users.map((u) => `rl:monitor-test:u:${u}:o:${org}`),
    );
    // Three users at 10 each fill the org budget of 30.
    for (const userId of users.slice(0, 3)) {
      for (let i = 0; i < 10; i += 1) {
        clock += 10;
        expect(
          (
            await consumeMonitorTestRateLimit(limiter, {
              userId,
              organizationId: org,
            })
          ).allowed,
        ).toBe(true);
      }
    }
    const fourth = users[3] as string;
    clock += 10;
    const denied = await consumeMonitorTestRateLimit(limiter, {
      userId: fourth,
      organizationId: org,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(await redis.zcard(`rl:monitor-test:u:${fourth}:o:${org}`)).toBe(0);
  });

  it("admits exactly the limit when requests race in parallel", async () => {
    const limiter = createRateLimiter({ redis, now: () => 40_000_000 });
    const key = freshKey();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        limiter.consumeRateLimit({ key, limit: 7, windowMs }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(7);
    expect(await redis.zcard(key)).toBe(7);
  });

  it("leaves the org key unconsumed when the per-user key denies", async () => {
    const limiter = createRateLimiter({ redis, now: () => 50_000_000 });
    const [userId, org] = [randomUUID(), randomUUID()];
    const orgKey = `rl:monitor-test:o:${org}`;
    keys.push(orgKey, `rl:monitor-test:u:${userId}:o:${org}`);
    for (let i = 0; i < 10; i += 1) {
      await consumeMonitorTestRateLimit(limiter, {
        userId,
        organizationId: org,
      });
    }
    const denied = await consumeMonitorTestRateLimit(limiter, {
      userId,
      organizationId: org,
    });
    expect(denied.allowed).toBe(false);
    expect(await redis.zcard(orgKey)).toBe(10);
  });

  it("reports the longest wait among denying keys", async () => {
    let clock = 60_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const [keyA, keyB] = [freshKey(), freshKey()];
    await limiter.consumeRateLimit({ key: keyA, limit: 1, windowMs });
    clock += 20_000;
    await limiter.consumeRateLimit({ key: keyB, limit: 1, windowMs });
    clock += 10_000;
    // A frees in 30 s, B in 50 s.
    expect(
      await limiter.consumeRateLimits({
        windowMs,
        limits: [
          { key: keyA, limit: 1 },
          { key: keyB, limit: 1 },
        ],
      }),
    ).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it("rejects per-key windows at compile time", () => {
    const limiter = createRateLimiter({ redis });
    // A group has one window; a window on a single limit is a type error.
    const mixed = () =>
      limiter.consumeRateLimits({
        windowMs,
        // @ts-expect-error windowMs belongs to the group, not to each limit
        limits: [{ key: "a", limit: 1, windowMs: 1000 }],
      });
    expect(mixed).toBeTypeOf("function");
  });

  it("uses the documented Redis keys", async () => {
    const limiter = createRateLimiter({ redis });
    const [userId, org] = [randomUUID(), randomUUID()];
    await consumeMonitorTestRateLimit(limiter, { userId, organizationId: org });
    const userKey = `rl:monitor-test:u:${userId}:o:${org}`;
    const orgKey = `rl:monitor-test:o:${org}`;
    keys.push(userKey, orgKey);
    expect(await redis.zcard(userKey)).toBe(1);
    expect(await redis.zcard(orgKey)).toBe(1);
    expect(await redis.pttl(userKey)).toBeGreaterThan(0);
  });
});

type DelayProxy = {
  url: string;
  /** Delays bytes travelling client to Redis (request) or Redis to client (reply). */
  setDelay(direction: "request" | "reply" | "none", ms?: number): void;
  close(): void;
};

async function startDelayProxy(port = 0): Promise<DelayProxy> {
  const target = new URL(redisUrl as string);
  const sockets: net.Socket[] = [];
  let direction: "request" | "reply" | "none" = "none";
  let delayMs = 0;
  const proxy = net.createServer((inbound) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    sockets.push(inbound, upstream);
    inbound.on("data", (chunk) => {
      if (direction === "request") {
        setTimeout(() => upstream.write(chunk), delayMs);
      } else {
        upstream.write(chunk);
      }
    });
    upstream.on("data", (chunk) => {
      if (direction === "reply") {
        setTimeout(() => inbound.write(chunk), delayMs);
      } else {
        inbound.write(chunk);
      }
    });
    inbound.on("error", () => undefined);
    upstream.on("error", () => undefined);
  });
  await new Promise<void>((resolve) =>
    proxy.listen(port, "127.0.0.1", resolve),
  );
  const { port: boundPort } = proxy.address() as net.AddressInfo;
  return {
    url: `redis://127.0.0.1:${boundPort.toString()}`,
    setDelay(next, ms = 0) {
      direction = next;
      delayMs = ms;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      proxy.close();
    },
  };
}

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(
    { level: "info", name: "test" },
    {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as Record<string, unknown>);
      },
    },
  );
  return { logger, lines };
}

describe("limiter failure (fail closed)", () => {
  function request() {
    return {
      key: `rl:test:unavailable:${randomUUID()}`,
      limit: 1,
      windowMs: 60_000,
    };
  }
  const unavailable = { statusCode: 503, code: "RATE_LIMIT_UNAVAILABLE" };

  it("throws RATE_LIMIT_UNAVAILABLE and logs redis_error when Redis is down", async () => {
    const { logger, lines } = captureLogger();
    const limiter = createRateLimiter({ redis: client(closedPortUrl), logger });
    const error = await limiter
      .consumeRateLimit(request())
      .catch((e: unknown) => e);
    expect(error).toMatchObject(unavailable);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(lines.map((line) => line.reason)).toEqual(["redis_error"]);
  });

  it("logs timeout when Redis never answers a queued command within 2 s", async () => {
    const proxy = await startDelayProxy();
    proxy.setDelay("request", 2500);
    try {
      const { logger, lines } = captureLogger();
      const limiter = createRateLimiter({ redis: client(proxy.url), logger });
      const started = Date.now();
      const error = await limiter
        .consumeRateLimit(request())
        .catch((e: unknown) => e);
      const elapsed = Date.now() - started;
      expect(error).toMatchObject(unavailable);
      expect((error as Error).cause).toMatchObject({ message: "timeout" });
      expect(lines.map((line) => line.reason)).toEqual(["timeout"]);
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(elapsed).toBeLessThan(2500);
    } finally {
      proxy.close();
    }
  });

  it("times out when a connected Redis takes the command but replies after 2 s", async () => {
    const proxy = await startDelayProxy();
    try {
      const { logger, lines } = captureLogger();
      const redis = client(proxy.url);
      await redis.ping();
      proxy.setDelay("reply", 2500);
      const limiter = createRateLimiter({ redis, logger });
      const input = request();
      const error = await limiter
        .consumeRateLimit(input)
        .catch((e: unknown) => e);
      expect(error).toMatchObject(unavailable);
      expect(lines.map((line) => line.reason)).toEqual(["timeout"]);
      // The EVAL reached Redis and may have written the key.
      proxy.setDelay("none");
      await redis.del(input.key);
    } finally {
      proxy.close();
    }
  });

  it("logs one line per reason across repeated failures within 10 s", async () => {
    const { logger, lines } = captureLogger();
    const limiter = createRateLimiter({ redis: client(closedPortUrl), logger });
    await limiter.consumeRateLimit(request()).catch(() => undefined);
    await limiter.consumeRateLimit(request()).catch(() => undefined);
    expect(lines.map((line) => line.reason)).toEqual(["redis_error"]);
  });

  it("logs a connection error once across reconnects and logs recovery on ready", async () => {
    // Reserve a free port, release it, and let the client fail against it.
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as net.AddressInfo;
    await new Promise<void>((resolve) =>
      probe.close(() => {
        resolve();
      }),
    );

    const { logger, lines } = captureLogger();
    const redis = createRedisClient(
      `redis://127.0.0.1:${port.toString()}`,
      logger,
    );
    clients.push(redis);
    // Default retry backoff is 50 ms steps, so this spans several attempts.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const errorLines = () =>
      lines.filter((line) => line.msg === "redis connection error");
    expect(errorLines()).toHaveLength(1);
    expect(
      lines.some((line) => line.msg === "redis connection recovered"),
    ).toBe(false);

    const proxy = await startDelayProxy(port);
    try {
      await redis.ping();
      expect(errorLines()).toHaveLength(1);
      expect(
        lines.filter((line) => line.msg === "redis connection recovered"),
      ).toHaveLength(1);
    } finally {
      proxy.close();
    }
  });

  it("throws RATE_LIMIT_UNAVAILABLE on a malformed script reply", async () => {
    const { logger, lines } = captureLogger();
    const redis = { eval: () => Promise.resolve("nope") } as unknown as Redis;
    const limiter = createRateLimiter({ redis, logger });
    await expect(limiter.consumeRateLimit(request())).rejects.toMatchObject(
      unavailable,
    );
    expect(lines.map((line) => line.reason)).toEqual(["bad_reply"]);
  });

  it("does not put the key or identifiers in the error cause", async () => {
    const limiter = createRateLimiter({ redis: client(closedPortUrl) });
    const input = request();
    const error = await limiter
      .consumeRateLimit(input)
      .catch((e: unknown) => e);
    expect(String((error as Error).cause)).not.toContain(input.key);
  });
});

describe("GET /ready with Redis", () => {
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
  function appWith(redis: Redis) {
    return createApp({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "test" }),
      redis,
    });
  }
  let up: Redis;
  beforeAll(() => {
    up = client(redisUrl);
  });

  it("reports ready with redis ok when Redis answers", async () => {
    const res = await appWith(up).request("/ready");
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(await res.json())).toEqual({
      status: "ready",
      checks: { redis: "ok" },
    });
  });

  it("reports not_ready with redis fail when Redis is down", async () => {
    const res = await appWith(client(closedPortUrl)).request("/ready");
    expect(res.status).toBe(503);
    expect(readinessResponseSchema.parse(await res.json())).toEqual({
      status: "not_ready",
      checks: { redis: "fail" },
    });
  });

  it("bounds /ready by one deadline when the database and Redis both hang", async () => {
    const proxy = await startDelayProxy();
    try {
      const hung = client(proxy.url);
      await hung.ping();
      proxy.setDelay("reply", 10_000);
      const database = {
        db: undefined,
        sql: { query: () => new Promise(() => undefined) },
        close: () => Promise.resolve(),
      } as unknown as Database;
      const app = createApp({
        env,
        authEnv,
        logger: createLogger({ level: "silent", name: "test" }),
        database,
        redis: hung,
      });
      const started = Date.now();
      const res = await app.request("/ready");
      const elapsed = Date.now() - started;
      expect(res.status).toBe(503);
      expect(readinessResponseSchema.parse(await res.json())).toEqual({
        status: "not_ready",
        checks: { database: "fail", redis: "fail" },
      });
      // Sequential checks would take the sum of both deadlines.
      expect(elapsed).toBeLessThan(
        Math.max(DB_READINESS_TIMEOUT_MS, RATE_LIMIT_TIMEOUT_MS) + 500,
      );
    } finally {
      proxy.close();
    }
  });
});
