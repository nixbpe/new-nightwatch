import { randomUUID } from "node:crypto";
import net from "node:net";

import { readinessResponseSchema } from "@nightwatch/api-contract";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import {
  consumeMonitorTestRateLimit,
  createRateLimiter,
  createRedisClient,
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

describe("limiter failure (fail closed)", () => {
  const request = { key: "rl:test:unavailable", limit: 1, windowMs: 60_000 };

  it("throws RATE_LIMIT_UNAVAILABLE when Redis is down", async () => {
    const limiter = createRateLimiter({ redis: client(closedPortUrl) });
    await expect(limiter.consumeRateLimit(request)).rejects.toMatchObject({
      statusCode: 503,
      code: "RATE_LIMIT_UNAVAILABLE",
    });
  });

  it("throws RATE_LIMIT_UNAVAILABLE when Redis answers slower than 2 s", async () => {
    // Delaying proxy: forwards bytes to the real Redis after 2.5 s.
    const target = new URL(redisUrl);
    const sockets: net.Socket[] = [];
    const proxy = net.createServer((inbound) => {
      const upstream = net.connect(Number(target.port), target.hostname);
      sockets.push(inbound, upstream);
      inbound.on("data", (chunk) => {
        setTimeout(() => upstream.write(chunk), 2500);
      });
      upstream.on("data", (chunk) => inbound.write(chunk));
      inbound.on("error", () => undefined);
      upstream.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = proxy.address() as net.AddressInfo;
      const limiter = createRateLimiter({
        redis: client(`redis://127.0.0.1:${port.toString()}`),
      });
      const started = Date.now();
      await expect(limiter.consumeRateLimit(request)).rejects.toMatchObject({
        statusCode: 503,
        code: "RATE_LIMIT_UNAVAILABLE",
      });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(elapsed).toBeLessThan(2500);
    } finally {
      for (const socket of sockets) socket.destroy();
      proxy.close();
    }
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
});
