import { describe, expect, it, vi } from "vitest";

import { request } from "./client";
import { fetchOrganizationMembers, memberListQueryKey } from "./members";

vi.mock("./client", () => ({ request: vi.fn() }));

const organizationId = "11111111-1111-4111-8111-111111111111";
const response = {
  organizationId,
  members: [
    {
      id: "member-1",
      userId: "user-1",
      name: "Ada",
      email: "ada@example.test",
      role: "owner" as const,
    },
  ],
  page: { limit: 50, offset: 0, total: 1 },
  memberLimit: 1000,
};

describe("organization members API", () => {
  it("uses an organization and pagination-specific tenant query key", () => {
    expect(memberListQueryKey(organizationId, 50, 0)).toEqual([
      "tenant",
      "members",
      organizationId,
      { limit: 50, offset: 0 },
    ]);
  });

  it("adds q and role to the key and request only when set", async () => {
    expect(
      memberListQueryKey(organizationId, 50, 0, { q: "ann", role: "viewer" }),
    ).toEqual([
      "tenant",
      "members",
      organizationId,
      { limit: 50, offset: 0, q: "ann", role: "viewer" },
    ]);
    expect(memberListQueryKey(organizationId, 50, 0, {})).toEqual(
      memberListQueryKey(organizationId, 50, 0),
    );
    vi.mocked(request).mockResolvedValueOnce(response);

    await fetchOrganizationMembers(organizationId, 50, 50, {
      q: "ann",
      role: "viewer",
    });
    expect(request).toHaveBeenLastCalledWith(
      "/api/organizations/{organizationId}/members",
      expect.anything(),
      {
        params: { organizationId },
        query: { limit: 50, offset: 50, q: "ann", role: "viewer" },
      },
    );
  });

  it("requests and validates the paginated organization member directory", async () => {
    vi.mocked(request).mockResolvedValueOnce(response);

    await expect(
      fetchOrganizationMembers(organizationId, 50, 0),
    ).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(
      "/api/organizations/{organizationId}/members",
      expect.anything(),
      {
        params: { organizationId },
        query: { limit: 50, offset: 0 },
      },
    );
  });
});
