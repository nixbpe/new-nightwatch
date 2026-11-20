import { describe, expect, it } from "vitest";
import { z } from "zod";

import { auditChangeSchema } from "./audit-log";

const change = (before: unknown, after: unknown) => ({
  field: "name",
  before,
  after,
});

describe("auditChangeSchema wire shape", () => {
  it.each([
    null,
    { kind: "value", value: "text" },
    { kind: "value", value: 3 },
    { kind: "value", value: false },
    { kind: "value", value: null },
    { kind: "masked" },
    { kind: "secret_set" },
    { kind: "changed" },
  ])("accepts %j on either side", (side) => {
    expect(auditChangeSchema.safeParse(change(side, side)).success).toBe(true);
  });

  it.each([
    undefined,
    {},
    { kind: "value" },
    { kind: "value", value: { nested: true } },
    { kind: "unknown" },
    "masked",
  ])("rejects %j", (side) => {
    expect(auditChangeSchema.safeParse(change(side, null)).success).toBe(false);
    expect(auditChangeSchema.safeParse(change(null, side)).success).toBe(false);
  });
});

describe("auditChangeSchema in OpenAPI 3.0", () => {
  const document = z.toJSONSchema(auditChangeSchema, {
    target: "openapi-3.0",
  }) as {
    properties: Record<
      string,
      { nullable?: boolean; oneOf?: unknown[]; anyOf?: unknown[] }
    >;
  };

  it("writes null as nullable beside the members, never as an empty member", () => {
    for (const side of ["before", "after"] as const) {
      const schema = document.properties[side];
      expect(schema?.nullable).toBe(true);
      expect(schema?.oneOf).toHaveLength(4);
      expect(JSON.stringify(schema?.oneOf)).not.toContain('{"nullable":true}');
    }
  });
});
