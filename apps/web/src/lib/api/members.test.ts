import { describe, expect, it, vi } from "vitest";

import { request } from "./client";
import { fetchOrganizationMembers, memberListQueryKey, updateOrganizationMemberRole } from "./members";

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
  it("rejects a malformed role update response rather than reporting success", async () => {
    vi.mocked(request).mockResolvedValueOnce({
      member: { id: "member-1", userId: "user-1", organizationId, role: "root" },
    });
    await expect(
      updateOrganizationMemberRole(organizationId, "member-1", "admin"),
    ).rejects.toThrow();
  });
});
