import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOrganizationMembers, memberListQueryKey, updateOrganizationMemberRole } from "./members";

afterEach(() => vi.unstubAllGlobals());

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
    ));

    await expect(fetchOrganizationMembers(organizationId, 50, 0)).resolves.toEqual(response);
    const [input] = vi.mocked(fetch).mock.calls[0] as [Request];
    expect(input.url).toContain(`/api/organizations/${organizationId}/members?limit=50&offset=0`);
  });
  it("rejects a malformed role update response with the client contract error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        member: { id: "member-1", userId: "user-1", organizationId, role: "root" },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    ));
    await expect(
      updateOrganizationMemberRole(organizationId, "member-1", "admin"),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH", status: 200 });
  });
});
