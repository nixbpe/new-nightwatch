import { describe, expect, it } from "vitest";

import {
  createProjectRequestSchema,
  projectSummarySchema,
  updateProjectRequestSchema,
} from "./project";

const create = (overrides: Record<string, unknown>) =>
  createProjectRequestSchema.safeParse({
    name: "Payments",
    slug: "payments",
    ...overrides,
  });

describe("create project name", () => {
  it.each([
    [0, false],
    [1, true],
    [80, true],
    [81, false],
  ])("length %i accepted=%s", (length, accepted) => {
    expect(create({ name: "n".repeat(length) }).success).toBe(accepted);
  });

  it("counts after trim and by code point (Thai and emoji)", () => {
    expect(create({ name: `  ${"ก".repeat(80)}  ` }).success).toBe(true);
    expect(create({ name: "😀".repeat(80) }).success).toBe(true);
    expect(create({ name: "😀".repeat(81) }).success).toBe(false);
    expect(create({ name: "   " }).success).toBe(false);
  });
});

describe("create project slug", () => {
  it.each([
    [2, false],
    [3, true],
    [40, true],
    [41, false],
  ])("length %i accepted=%s", (length, accepted) => {
    expect(create({ slug: "a".repeat(length) }).success).toBe(accepted);
  });

  it.each(["Abc", "ab_c", "ab c", "abç", "ab.c", "ab/c"])(
    "rejects %j outside [a-z0-9-]",
    (slug) => {
      expect(create({ slug }).success).toBe(false);
    },
  );

  it("accepts a leading, trailing or doubled hyphen (OD-02)", () => {
    expect(create({ slug: "-ab-" }).success).toBe(true);
    expect(create({ slug: "a--b" }).success).toBe(true);
  });
});

describe("project description", () => {
  it.each([
    [500, true],
    [501, false],
  ])("length %i accepted=%s", (length, accepted) => {
    expect(create({ description: "d".repeat(length) }).success).toBe(accepted);
  });

  it("stores a blank description as null and allows omitting it", () => {
    expect(create({ description: "   " }).data?.description).toBeNull();
    expect(create({}).data?.description).toBeUndefined();
    expect(create({ description: null }).data?.description).toBeNull();
  });

  it("rejects unknown keys on create", () => {
    expect(create({ tenantId: crypto.randomUUID() }).success).toBe(false);
  });
});

describe("update project request", () => {
  it("accepts name, description or both", () => {
    expect(updateProjectRequestSchema.safeParse({ name: "New" }).success).toBe(
      true,
    );
    expect(
      updateProjectRequestSchema.safeParse({ description: null }).success,
    ).toBe(true);
    expect(
      updateProjectRequestSchema.safeParse({ name: "New", description: "d" })
        .success,
    ).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(updateProjectRequestSchema.safeParse({}).success).toBe(false);
  });

  it.each(["organizationId", "tenantId", "slug", "id"])(
    "rejects %s (AC-10)",
    (key) => {
      const body = { name: "New", [key]: "x".repeat(8) };
      expect(updateProjectRequestSchema.safeParse(body).success).toBe(false);
      expect(
        updateProjectRequestSchema.safeParse({ [key]: "x".repeat(8) }).success,
      ).toBe(false);
    },
  );
});

describe("project summary", () => {
  const summary = {
    id: crypto.randomUUID(),
    name: "Payments",
    slug: "payments",
    description: null,
    memberCount: 0,
    myRole: null,
    updatedAt: new Date().toISOString(),
  };

  it("allows myRole null and rejects an unknown role", () => {
    expect(projectSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      projectSummarySchema.safeParse({ ...summary, myRole: "owner" }).success,
    ).toBe(false);
  });
});
