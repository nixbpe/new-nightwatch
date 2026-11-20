import { randomUUID } from "node:crypto";
import net from "node:net";

import { createLogger } from "@nightwatch/shared";
import type { Redis } from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  consumeMonitorTestRateLimit,
  createRateLimiter,
  createRedisClient,
} from "./index";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for rate limiter tests");

const closedPortUrl = "redis://127.0.0.1:1";

const namespace = `rl:test:${randomUUID()}`;
const cleanup = createRedisClient(redisUrl);
const clients: Redis[] = [cleanup];

function client(url: string, prefix = namespace): Redis {
  const redis = createRedisClient(url, undefined, prefix);
  clients.push(redis);
  return redis;
}

afterAll(async () => {
  try {
    const keys = await cleanup.keys(`${namespace}:*`);
    if (keys.length > 0) await cleanup.del(...keys);
  } finally {
    for (const redis of clients) redis.disconnect();
  }
});

describe("consumeRateLimit", () => {
  const redis = client(redisUrl);
  const windowMs = 60_000;

  it("isolates identical rate-limit keys by Redis namespace", async () => {
    const a = client(redisUrl, `${namespace}:a`);
    const b = client(redisUrl, `${namespace}:b`);
    const key = randomUUID();
    const request = { key, limit: 1, windowMs };
    const first = createRateLimiter({ redis: a });
    const second = createRateLimiter({ redis: b });
    expect((await first.consumeRateLimit(request)).allowed).toBe(true);
    expect((await first.consumeRateLimit(request)).allowed).toBe(false);
    expect((await second.consumeRateLimit(request)).allowed).toBe(true);
    expect((await second.consumeRateLimit(request)).allowed).toBe(false);
    expect(await cleanup.exists(key)).toBe(0);
  });
  it("allows up to the limit and denies the next request with a retry hint", async () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const key = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      clock += 1000;
      expect(
        await limiter.consumeRateLimit({ key, limit: 3, windowMs }),
      ).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    clock += 1000;
    expect(await limiter.consumeRateLimit({ key, limit: 3, windowMs })).toEqual(
      { allowed: false, retryAfterSeconds: 57 },
    );
  });

  it("does not count denied requests against the window", async () => {
    let clock = 5_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const key = randomUUID();
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
    const key = randomUUID();
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
    expect(await limiter.consumeRateLimit({ key, limit: 2, windowMs })).toEqual(
      { allowed: false, retryAfterSeconds: 29 },
    );
  });

  it("keeps users' budgets independent within one organization", async () => {
    let clock = 20_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const org = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
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
    const lastAcceptedAt = clock;
    const fourth = users[3] as string;
    clock += 1000;
    const denied = await consumeMonitorTestRateLimit(limiter, {
      userId: fourth,
      organizationId: org,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);

    clock = lastAcceptedAt + windowMs;
    for (let i = 0; i < 10; i += 1) {
      expect(
        (
          await consumeMonitorTestRateLimit(limiter, {
            userId: fourth,
            organizationId: org,
          })
        ).allowed,
      ).toBe(true);
    }
    expect(
      (
        await consumeMonitorTestRateLimit(limiter, {
          userId: fourth,
          organizationId: org,
        })
      ).allowed,
    ).toBe(false);
  });
  it("admits exactly the limit when requests race in parallel", async () => {
    const limiter = createRateLimiter({ redis, now: () => 40_000_000 });
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        limiter.consumeRateLimit({ key, limit: 7, windowMs }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(7);
  });

  it("leaves the org key unconsumed when the per-user key denies", async () => {
    const limiter = createRateLimiter({ redis, now: () => 50_000_000 });
    const [userId, org] = [randomUUID(), randomUUID()];
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
    for (const otherUserId of [randomUUID(), randomUUID()]) {
      for (let i = 0; i < 10; i += 1) {
        expect(
          (
            await consumeMonitorTestRateLimit(limiter, {
              userId: otherUserId,
              organizationId: org,
            })
          ).allowed,
        ).toBe(true);
      }
    }
  });

  it("reports the longest wait among denying keys", async () => {
    let clock = 60_000_000;
    const limiter = createRateLimiter({ redis, now: () => clock });
    const [keyA, keyB] = [randomUUID(), randomUUID()];
    await limiter.consumeRateLimit({ key: keyA, limit: 1, windowMs });
    clock += 20_000;
    await limiter.consumeRateLimit({ key: keyB, limit: 1, windowMs });
    clock += 10_000;
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

  it("expires inactive rate-limit state within its window", async () => {
    const limiter = createRateLimiter({ redis });
    const key = randomUUID();
    await limiter.consumeRateLimit({ key, limit: 1, windowMs });
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(windowMs);
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
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let direction: "request" | "reply" | "none" = "none";
  let delayMs = 0;
  function forward(
    socket: net.Socket,
    chunk: Buffer | string,
    delayed: boolean,
  ) {
    if (!delayed) {
      socket.write(chunk);
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      socket.write(chunk);
    }, delayMs);
    timers.add(timer);
  }

  const proxy = net.createServer((inbound) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    sockets.push(inbound, upstream);
    inbound.on("data", (chunk) => {
      forward(upstream, chunk, direction === "request");
    });
    upstream.on("data", (chunk) => {
      forward(inbound, chunk, direction === "reply");
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
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
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
    const redis = client(proxy.url);
    try {
      const { logger, lines } = captureLogger();
      const limiter = createRateLimiter({ redis, logger });
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
      redis.disconnect();
      proxy.close();
    }
  });

  it("times out when a connected Redis takes the command but replies after 2 s", async () => {
    const proxy = await startDelayProxy();
    const redis = client(proxy.url);
    try {
      const { logger, lines } = captureLogger();
      await redis.ping();
      proxy.setDelay("reply", 2500);
      const limiter = createRateLimiter({ redis, logger });
      const input = request();
      const error = await limiter
        .consumeRateLimit(input)
        .catch((e: unknown) => e);
      expect(error).toMatchObject(unavailable);
      expect(lines.map((line) => line.reason)).toEqual(["timeout"]);
    } finally {
      redis.disconnect();
      proxy.close();
    }
  });

  it("logs a connection error once across reconnects and logs recovery on ready", async () => {
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
      namespace,
    );
    clients.push(redis);
    let reconnects = 0;
    redis.on("reconnecting", () => {
      reconnects += 1;
    });
    await vi.waitFor(() => {
      expect(reconnects).toBeGreaterThanOrEqual(2);
    });
    const errorLines = () => lines.filter((line) => line.level === 40);
    expect(errorLines()).toHaveLength(1);
    expect(lines.some((line) => line.level === 30)).toBe(false);

    const proxy = await startDelayProxy(port);
    try {
      await redis.ping();
      expect(errorLines()).toHaveLength(1);
      expect(lines.filter((line) => line.level === 30)).toHaveLength(1);
    } finally {
      redis.disconnect();
      proxy.close();
    }
  });
});
