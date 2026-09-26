import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchNotifications,
  fetchUnreadCount,
  InboxScopeChangedError,
  markAllNotificationsRead,
} from "./notifications";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function stubFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inbox scope checks", () => {
  it("rejects a list resolved for a different organization", async () => {
    stubFetch({
      items: [],
      nextCursor: null,
      unreadCount: 0,
      organizationId: ORG_B,
    });
    await expect(fetchNotifications(ORG_A)).rejects.toBeInstanceOf(
      InboxScopeChangedError,
    );
  });

  it("returns a list resolved for the expected organization", async () => {
    stubFetch({
      items: [],
      nextCursor: null,
      unreadCount: 0,
      organizationId: ORG_A,
    });
    await expect(fetchNotifications(ORG_A)).resolves.toMatchObject({
      organizationId: ORG_A,
    });
  });

  it("rejects an unread count resolved for a different scope", async () => {
    stubFetch({ unreadCount: 3, organizationId: null });
    await expect(fetchUnreadCount(ORG_A)).rejects.toBeInstanceOf(
      InboxScopeChangedError,
    );
  });

  it("sends the expected scope with mark-all", async () => {
    const fetchMock = stubFetch({ markedCount: 2 });
    await expect(markAllNotificationsRead(ORG_A)).resolves.toEqual({
      markedCount: 2,
    });
    const [input] = fetchMock.mock.calls[0] as [Request];
    await expect(input.json()).resolves.toEqual({
      expectedOrganizationId: ORG_A,
    });
  });
});
