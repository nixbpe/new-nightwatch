import { describe, expect, it } from "vitest";

import {
  errorResponseSchema,
  helloResponseSchema,
  readinessResponseSchema,
  versionResponseSchema,
} from "../src/index";

describe("helloResponseSchema", () => {
  it("rejects a payload without a valid ISO timestamp", () => {
    expect(
      helloResponseSchema.safeParse({ message: "hi", timestamp: "yesterday" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(
      helloResponseSchema.safeParse({
        message: "",
        timestamp: "2026-09-06T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("errorResponseSchema", () => {
  it("rejects a bare error message without the envelope", () => {
    expect(errorResponseSchema.safeParse({ message: "boom" }).success).toBe(
      false,
    );
  });
});

describe("readinessResponseSchema", () => {
  it("accepts ready and not_ready states with named checks", () => {
    expect(
      readinessResponseSchema.safeParse({
        status: "ready",
        checks: { self: "ok" },
      }).success,
    ).toBe(true);
    expect(
      readinessResponseSchema.safeParse({
        status: "not_ready",
        checks: { self: "fail" },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown readiness states", () => {
    expect(
      readinessResponseSchema.safeParse({ status: "degraded", checks: {} })
        .success,
    ).toBe(false);
  });
});

describe("versionResponseSchema", () => {
  it("rejects an empty name", () => {
    expect(
      versionResponseSchema.safeParse({ name: "", version: "0.0.1" }).success,
    ).toBe(false);
  });
});
