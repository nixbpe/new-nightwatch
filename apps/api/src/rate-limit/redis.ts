import { Redis } from "ioredis";

export const RATE_LIMIT_TIMEOUT_MS = 2000;

/** Client for the rate limiter and readiness; every command is bounded by the 2 s timeout. */
export function createRedisClient(url: string): Redis {
  const redis = new Redis(url, {
    commandTimeout: RATE_LIMIT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
  });
  // Connection loss surfaces as a failed command (fail closed); without a
  // listener ioredis prints every reconnect error.
  redis.on("error", () => undefined);
  return redis;
}
