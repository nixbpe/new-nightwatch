import type { Logger } from "@nightwatch/shared";
import { Redis } from "ioredis";

export const RATE_LIMIT_TIMEOUT_MS = 2000;

/**
 * Client for the rate limiter and readiness; every command is bounded by the
 * 2 s timeout. Connection errors are logged when the error kind changes and
 * again after the connection recovers, not on every reconnect attempt.
 */
export function createRedisClient(url: string, logger?: Logger): Redis {
  const redis = new Redis(url, {
    commandTimeout: RATE_LIMIT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
  });
  let lastError: string | undefined;
  // A listener is required or ioredis prints every reconnect error.
  redis.on("error", (error: Error & { code?: string }) => {
    const kind = error.code ?? error.name;
    if (kind === lastError) return;
    lastError = kind;
    logger?.warn({ kind }, "redis connection error");
  });
  redis.on("ready", () => {
    if (lastError === undefined) return;
    lastError = undefined;
    logger?.info("redis connection recovered");
  });
  return redis;
}
