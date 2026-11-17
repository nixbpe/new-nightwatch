import { createLogger } from "@nightwatch/shared";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("limiter failure", () => {
  const input = { key: "budget", limit: 1, windowMs: 60_000 };
  const unavailable = { statusCode: 503, code: "RATE_LIMIT_UNAVAILABLE" };

  it("does not repeat failure logs for consecutive failures", async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Redis;
    const logger = createLogger({ level: "silent", name: "test" });
    const warn = vi.spyOn(logger, "warn");
    const limiter = createRateLimiter({ redis, logger });

    await expect(limiter.consumeRateLimit(input)).rejects.toMatchObject(
      unavailable,
    );
    await expect(limiter.consumeRateLimit(input)).rejects.toMatchObject(
      unavailable,
    );
    expect(warn.mock.calls.map(([fields]) => fields)).toEqual([
      { reason: "redis_error" },
    ]);
  });

  it("throws RATE_LIMIT_UNAVAILABLE on a malformed script reply", async () => {
    const redis = {
      eval: vi.fn().mockResolvedValue("nope"),
    } as unknown as Redis;
    const logger = createLogger({ level: "silent", name: "test" });
    const warn = vi.spyOn(logger, "warn");
    const limiter = createRateLimiter({ redis, logger });

    await expect(limiter.consumeRateLimit(input)).rejects.toMatchObject(
      unavailable,
    );
    expect(warn.mock.calls.map(([fields]) => fields)).toEqual([
      { reason: "bad_reply" },
    ]);
  });

  it("does not expose keys or identifiers in error causes or logs", async () => {
    const userId = "private-user";
    const organizationId = "private-organization";
    const key = `budget:${userId}:${organizationId}`;
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error(`Redis failed for ${key}`)),
    } as unknown as Redis;
    const lines: string[] = [];
    const logger = createLogger(
      { level: "warn", name: "test" },
      { write: (line: string) => void lines.push(line) },
    );
    const limiter = createRateLimiter({ redis, logger });
    const error = await limiter
      .consumeRateLimit({ ...input, key })
      .catch((error: unknown) => error);

    expect(error).toMatchObject(unavailable);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(lines).toHaveLength(1);
    const output = [String((error as Error).cause), ...lines].join("\n");
    for (const value of [key, userId, organizationId]) {
      expect(output).not.toContain(value);
    }
  });
});
