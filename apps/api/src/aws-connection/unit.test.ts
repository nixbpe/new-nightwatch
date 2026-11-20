import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { createApp } from "../app";
import {
  consumeAwsTestRateLimit,
  type RateLimitGroup,
  type RateLimiter,
} from "../rate-limit";
import { newOrganizationExternalId } from "./service";

describe("Organization External ID (AC-01)", () => {
  it("is nw-org-<slug>-<26 base32 characters> inside the AWS ExternalId charset", () => {
    const id = newOrganizationExternalId("acme");
    expect(id).toMatch(/^nw-org-acme-[a-z2-7]{26}$/);
    expect(id).toMatch(/^[\w+=,.@:/-]{2,1224}$/);
  });

  it("folds a slug outside [a-z0-9-] and caps it at 40 characters", () => {
    expect(newOrganizationExternalId("Acme Co_ไทย")).toMatch(
      /^nw-org-acme-co--[a-z2-7]{26}$/,
    );
    const long = newOrganizationExternalId("a".repeat(100));
    expect(long).toMatch(new RegExp(`^nw-org-${"a".repeat(40)}-[a-z2-7]{26}$`));
  });

  it("differs on every call", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => newOrganizationExternalId("acme")),
    );
    expect(ids.size).toBe(50);
  });
});

describe("request log path templates for the AWS connection", () => {
  const organizationId = crypto.randomUUID();

  it.each([
    ["GET", "", "/api/organizations/:organizationId/aws-connection"],
    ["POST", "/test", "/api/organizations/:organizationId/aws-connection/test"],
    [
      "DELETE",
      "?revision=1",
      "/api/organizations/:organizationId/aws-connection",
    ],
  ])("%s %s", async (method, suffix, expected) => {
    const lines: string[] = [];
    const app = createApp({
      env: { PORT: 4000, LOG_LEVEL: "info", NODE_ENV: "test" } satisfies Env,
      authEnv: {} as AuthEnv,
      logger: createLogger(
        { level: "info", name: "aws-path-logging-test" },
        { write: (line: string) => void lines.push(line) },
      ),
    });
    await app.request(
      `/api/organizations/${organizationId}/aws-connection${suffix}`,
      { method },
    );
    const entry = lines
      .map((line) => JSON.parse(line) as { msg: string; path?: string })
      .find((line) => line.msg === "request completed");
    expect(entry?.path).toBe(expected);
    expect(lines.join("\n")).not.toContain(organizationId);
  });
});

describe("AWS test quota (REQ-04)", () => {
  it("uses its own keys: 10 per user per org and 30 per org in 60 s", async () => {
    const groups: RateLimitGroup[] = [];
    const limiter: RateLimiter = {
      consumeRateLimit: () => Promise.reject(new Error("unused")),
      consumeRateLimits: (group) => {
        groups.push(group);
        return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
      },
    };
    await consumeAwsTestRateLimit(limiter, {
      userId: "u1",
      organizationId: "o1",
    });
    expect(groups).toEqual([
      {
        windowMs: 60_000,
        limits: [
          { key: "rl:aws-test:u:u1:o:o1", limit: 10 },
          { key: "rl:aws-test:o:o1", limit: 30 },
        ],
      },
    ]);
  });
});
