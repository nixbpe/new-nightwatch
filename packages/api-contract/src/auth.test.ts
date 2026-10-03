import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_MEMBER_LIMIT,
  organizationMemberListQuerySchema,
  organizationMemberListResponseSchema,
} from "./auth";

describe("organizationMemberListQuerySchema", () => {
  it("uses defaults only for missing values", () => {
    expect(organizationMemberListQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    });
  });

  it.each(["", " ", "0x32", "1e2", "1.5", "-1", "9007199254740992"])(
    "rejects malformed decimal integer %j",
    (value) => {
      expect(
        organizationMemberListQuerySchema.safeParse({
          limit: value,
          offset: "0",
        }).success,
      ).toBe(false);
    },
  );

  it("accepts the largest safe offset exactly", () => {
    expect(
      organizationMemberListQuerySchema.parse({
        limit: "50",
        offset: "9007199254740991",
      }),
    ).toEqual({ limit: 50, offset: Number.MAX_SAFE_INTEGER });
  });

  it.each(["9007199254740992", "9223372036854775808", "1e2", "1.5"])(
    "rejects unsafe or non-decimal offset %j",
    (offset) => {
      expect(
        organizationMemberListQuerySchema.safeParse({ limit: "50", offset })
          .success,
      ).toBe(false);
    },
  );
});

describe("organizationMemberListResponseSchema", () => {
  const body = {
    organizationId: "6f1c7b0e-2c58-4f3a-9a64-0d0f9a6f1b11",
    members: [],
    page: { limit: 50, offset: 0, total: 0 },
  };

  it("requires memberLimit as a positive integer", () => {
    expect(organizationMemberListResponseSchema.safeParse(body).success).toBe(
      false,
    );
    for (const memberLimit of [0, 1.5, "1000"]) {
      expect(
        organizationMemberListResponseSchema.safeParse({ ...body, memberLimit })
          .success,
      ).toBe(false);
    }
    expect(
      organizationMemberListResponseSchema.parse({
        ...body,
        memberLimit: ORGANIZATION_MEMBER_LIMIT,
      }).memberLimit,
    ).toBe(1000);
  });
});
