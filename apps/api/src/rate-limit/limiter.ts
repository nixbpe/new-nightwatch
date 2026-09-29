import { randomUUID } from "node:crypto";

import { AppError } from "@nightwatch/shared";
import type { Redis } from "ioredis";

import { RATE_LIMIT_TIMEOUT_MS } from "./redis";

export type RateLimitRequest = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  /** Consumes one slot of one key. Throws RATE_LIMIT_UNAVAILABLE when Redis fails. */
  consumeRateLimit(request: RateLimitRequest): Promise<RateLimitResult>;
  /** Consumes one slot of every key atomically: no key is consumed when any key denies. */
  consumeRateLimits(
    requests: readonly RateLimitRequest[],
  ): Promise<RateLimitResult>;
};

export type RateLimiterOptions = {
  redis: Redis;
  now?: () => number;
  timeoutMs?: number;
};

export function rateLimitUnavailable(): AppError {
  return new AppError(
    503,
    "RATE_LIMIT_UNAVAILABLE",
    "rate limiter is unavailable",
  );
}

// KEYS: one sorted set per limit. ARGV: now, window ms, member, then one limit
// per key. Checks every key before writing so a denial consumes nothing.
const slidingWindowScript = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
local retryMs = 0
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= tonumber(ARGV[3 + i]) then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local wait = tonumber(oldest[2]) + window - now
    if wait > retryMs then retryMs = wait end
  end
end
if retryMs > 0 then return {0, retryMs} end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
end
return {1, 0}
`;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { redis } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS;

  async function consumeRateLimits(
    requests: readonly RateLimitRequest[],
  ): Promise<RateLimitResult> {
    const [first] = requests;
    if (!first) throw new Error("at least one rate limit is required");
    // A single window applies to the whole call; the callers share one.
    const { windowMs } = first;
    const args = [
      now(),
      windowMs,
      randomUUID(),
      ...requests.map((request) => request.limit),
    ];

    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        redis.eval(
          slidingWindowScript,
          requests.length,
          ...requests.map((request) => request.key),
          ...args,
        ),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            reject(new Error("rate limiter timed out"));
          }, timeoutMs);
        }),
      ]);
      if (
        !Array.isArray(reply) ||
        typeof reply[0] !== "number" ||
        typeof reply[1] !== "number"
      ) {
        throw new Error("unexpected rate limiter reply");
      }
      const allowed = reply[0] === 1;
      return {
        allowed,
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil(reply[1] / 1000)),
      };
    } catch {
      throw rateLimitUnavailable();
    } finally {
      clearTimeout(deadline);
    }
  }

  return {
    consumeRateLimit: (request) => consumeRateLimits([request]),
    consumeRateLimits,
  };
}

/** Test rate limit (REQ-04): 10 per 60 s per user per org, 30 per 60 s per org. */
export function consumeMonitorTestRateLimit(
  limiter: RateLimiter,
  scope: { userId: string; organizationId: string },
): Promise<RateLimitResult> {
  const windowMs = 60_000;
  return limiter.consumeRateLimits([
    {
      key: `rl:monitor-test:u:${scope.userId}:o:${scope.organizationId}`,
      limit: 10,
      windowMs,
    },
    {
      key: `rl:monitor-test:o:${scope.organizationId}`,
      limit: 30,
      windowMs,
    },
  ]);
}
