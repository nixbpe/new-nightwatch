import type { MeContextResponse } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import { selectActiveOrganization } from "./activeOrganization";

const context: MeContextResponse = {
  user: {
    id: "user-1",
    name: "Ada",
    email: "ada@example.test",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [
    { id: "org-a", name: "Alpha", slug: "alpha", role: "owner" },
    { id: "org-b", name: "Beta", slug: "beta", role: "viewer" },
  ],
  lastActiveTenantId: "org-b",
};

describe("selectActiveOrganization", () => {
  it("returns the confirmed membership, preserving its identity and role", () => {
    expect(selectActiveOrganization(context)).toBe(context.organizations[1]);
    expect(selectActiveOrganization(context)).toEqual({
      id: "org-b",
      name: "Beta",
      slug: "beta",
      role: "viewer",
    });
  });

  it.each([null, "missing", "ORG-B"])(
    "does not fall back to the first membership for active ID %s",
    (lastActiveTenantId) => {
      expect(
        selectActiveOrganization({ ...context, lastActiveTenantId }),
      ).toBeNull();
    },
  );

  it("returns null before context admission and with no memberships", () => {
    expect(selectActiveOrganization(undefined)).toBeNull();
    expect(
      selectActiveOrganization({ ...context, organizations: [] }),
    ).toBeNull();
  });
});
