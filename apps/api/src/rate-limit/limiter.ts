import { randomUUID } from "node:crypto";

import { AppError, type Logger } from "@nightwatch/shared";
import type { Redis } from "ioredis";

import { RATE_LIMIT_TIMEOUT_MS } from "./redis";

export type RateLimitRequest = {
  key: string;
  limit: number;
  windowMs: number;
};

/** One window for every key, so mixed windows cannot be expressed. */
export type RateLimitGroup = {
  windowMs: number;
  limits: readonly { key: string; limit: number }[];
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RateLimitFailureReason = "timeout" | "redis_error" | "bad_reply";

export type RateLimiter = {
  /**
   * Consumes one slot of one key. Throws RATE_LIMIT_UNAVAILABLE when Redis
   * fails; a timed-out EVAL may still have consumed a slot (fail closed).
   */
  consumeRateLimit(request: RateLimitRequest): Promise<RateLimitResult>;
  /** Consumes one slot of every key atomically: no key is consumed when any key denies. */
  consumeRateLimits(group: RateLimitGroup): Promise<RateLimitResult>;
};

export type RateLimiterOptions = {
  redis: Redis;
  logger?: Logger;
  now?: () => number;
  timeoutMs?: number;
};

const FAILURE_LOG_INTERVAL_MS = 10_000;

/** The cause carries the failure kind only, never keys or identifiers. */
export function rateLimitUnavailable(
  reason: RateLimitFailureReason,
  source?: unknown,
): AppError {
  const code =
    source instanceof Error && "code" in source
      ? String((source as { code: unknown }).code)
      : undefined;
  const error = new AppError(
    503,
    "RATE_LIMIT_UNAVAILABLE",
    "rate limiter is unavailable",
  );
  error.cause = new Error(code ? `${reason}: ${code}` : reason);
  return error;
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
  const { redis, logger } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS;
  const lastLoggedAt = new Map<RateLimitFailureReason, number>();

  // An outage fails every request; log each reason at most once per interval.
  function logFailure(reason: RateLimitFailureReason): void {
    if (!logger) return;
    const at = Date.now();
    const previous = lastLoggedAt.get(reason);
    if (previous !== undefined && at - previous < FAILURE_LOG_INTERVAL_MS) {
      return;
    }
    lastLoggedAt.set(reason, at);
    logger.warn({ reason }, "rate limiter unavailable");
  }

  async function consumeRateLimits(
    group: RateLimitGroup,
  ): Promise<RateLimitResult> {
    if (group.limits.length === 0) {
      throw new Error("at least one rate limit is required");
    }
    const args = [
      now(),
      group.windowMs,
      randomUUID(),
      ...group.limits.map((entry) => entry.limit),
    ];

    let deadline: ReturnType<typeof setTimeout> | undefined;
    let reason: RateLimitFailureReason = "redis_error";
    try {
      const reply = await Promise.race([
        redis.eval(
          slidingWindowScript,
          group.limits.length,
          ...group.limits.map((entry) => entry.key),
          ...args,
        ),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            reason = "timeout";
            reject(new Error("rate limiter timed out"));
          }, timeoutMs);
        }),
      ]);
      if (
        !Array.isArray(reply) ||
        typeof reply[0] !== "number" ||
        typeof reply[1] !== "number"
      ) {
        reason = "bad_reply";
        throw new Error("unexpected rate limiter reply");
      }
      const allowed = reply[0] === 1;
      return {
        allowed,
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil(reply[1] / 1000)),
      };
    } catch (error) {
      // ioredis reports its own command timeout as an error; classify it too.
      if (
        reason === "redis_error" &&
        error instanceof Error &&
        error.message.includes("timed out")
      ) {
        reason = "timeout";
      }
      logFailure(reason);
      throw rateLimitUnavailable(reason, error);
    } finally {
      clearTimeout(deadline);
    }
  }

  return {
    consumeRateLimit: ({ key, limit, windowMs }) =>
      consumeRateLimits({ windowMs, limits: [{ key, limit }] }),
    consumeRateLimits,
  };
}

/** Test rate limit (REQ-04): 10 per 60 s per user per org, 30 per 60 s per org. */
export function consumeMonitorTestRateLimit(
  limiter: RateLimiter,
  scope: { userId: string; organizationId: string },
): Promise<RateLimitResult> {
  return limiter.consumeRateLimits({
    windowMs: 60_000,
    limits: [
      {
        key: `rl:monitor-test:u:${scope.userId}:o:${scope.organizationId}`,
        limit: 10,
      },
      { key: `rl:monitor-test:o:${scope.organizationId}`, limit: 30 },
    ],
  });
}
