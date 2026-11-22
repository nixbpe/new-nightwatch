import { type RateLimiter, type RateLimitResult } from "@nightwatch/shared";

export {
  createRateLimiter,
  NVD_GLOBAL_LIMIT,
  rateLimitUnavailable,
  type RateLimitFailureReason,
  type RateLimitGroup,
  type RateLimiter,
  type RateLimiterOptions,
  type RateLimitRequest,
  type RateLimitResult,
} from "@nightwatch/shared";

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

/**
 * AWS connection test quota (REQ-04), shared by Test and PUT of the
 * Organization and Project connections: 10 per 60 s per user per org, 30 per
 * 60 s per org. Its own namespace, apart from monitor tests and login.
 */
export function consumeAwsTestRateLimit(
  limiter: RateLimiter,
  scope: { userId: string; organizationId: string },
): Promise<RateLimitResult> {
  return limiter.consumeRateLimits({
    windowMs: 60_000,
    limits: [
      {
        key: `rl:aws-test:u:${scope.userId}:o:${scope.organizationId}`,
        limit: 10,
      },
      { key: `rl:aws-test:o:${scope.organizationId}`, limit: 30 },
    ],
  });
}
