import { describe, expect, it } from "vitest";

import {
  activeOrganizationInputSchema,
  invitationResponseSchema,
  meContextResponseSchema,
  organizationRoleSchema,
} from "../src/index";

describe("organizationRoleSchema", () => {
  it("accepts the four custom roles", () => {
    for (const role of ["owner", "admin", "viewer", "auditor"]) {
      expect(organizationRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects built-in roles we do not use", () => {
    expect(organizationRoleSchema.safeParse("member").success).toBe(false);
  });
});

describe("invitationResponseSchema", () => {
  const valid = {
    invitation: {
      id: "inv_abc123",
      email: "user@example.com",
      organizationName: "Acme Corp",
      role: "viewer",
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
  };

  it("accepts a pending invitation preview", () => {
    expect(invitationResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown roles and malformed ISO timestamps", () => {
    expect(
      invitationResponseSchema.safeParse({
        ...valid,
        invitation: { ...valid.invitation, role: "superuser" },
      }).success,
    ).toBe(false);
    expect(
      invitationResponseSchema.safeParse({
        ...valid,
        invitation: { ...valid.invitation, expiresAt: "tomorrow" },
      }).success,
    ).toBe(false);
  });
});

describe("meContextResponseSchema", () => {
  const valid = {
    user: {
      id: "usr_1",
      name: "Anan",
      email: "anan@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations: [
      {
        id: "8b3f2d1a-9c4e-4f6a-b2d7-1e5a9c3f7b21",
        name: "Acme Corp",
        slug: "acme-corp",
        role: "owner",
      },
    ],
    lastActiveTenantId: null,
  };

  it("accepts a context with memberships and a null last tenant", () => {
    expect(meContextResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a context with no memberships (access-needed state)", () => {
    expect(
      meContextResponseSchema.safeParse({ ...valid, organizations: [] })
        .success,
    ).toBe(true);
  });

  it("rejects non-UUID organization ids and lastActiveTenantId", () => {
    expect(
      meContextResponseSchema.safeParse({
        ...valid,
        organizations: [{ ...valid.organizations[0], id: "not-a-uuid" }],
      }).success,
    ).toBe(false);
    expect(
      meContextResponseSchema.safeParse({
        ...valid,
        lastActiveTenantId: "org_123",
      }).success,
    ).toBe(false);
  });
});

describe("activeOrganizationInputSchema", () => {
  it("requires a UUID organizationId", () => {
    expect(
      activeOrganizationInputSchema.safeParse({
        organizationId: "8b3f2d1a-9c4e-4f6a-b2d7-1e5a9c3f7b21",
      }).success,
    ).toBe(true);
    expect(
      activeOrganizationInputSchema.safeParse({ organizationId: "acme" })
        .success,
    ).toBe(false);
  });
});
