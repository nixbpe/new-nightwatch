import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createNotificationCursor, parseNotificationCursor } from "./cursor";

const secret = "cursor-test-secret";
const scope = {
  userId: "user-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  limit: 20,
  status: "all" as const,
  category: null,
};
const anchor = {
  occurredAt: "2026-09-25T00:00:00.000Z",
  id: "22222222-2222-4222-8222-222222222222",
};

describe("notification cursors", () => {
  it("rejects status/category mismatches and signed legacy payloads without filters", () => {
    const cursor = createNotificationCursor({ secret, scope, anchor, now: 0 });
    for (const update of [
      { status: "unread" as const },
      { category: "monitor" as const },
    ]) {
      expect(() =>
        parseNotificationCursor({
          secret,
          scope: { ...scope, ...update },
          cursor,
          now: 1,
        }),
      ).toThrow("INVALID_CURSOR");
    }
    const payload = Buffer.from(
      JSON.stringify({
        userId: scope.userId,
        organizationId: scope.organizationId,
        limit: scope.limit,
        ...anchor,
        issuedAt: 0,
      }),
    ).toString("base64url");
    const legacy = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
    expect(() =>
      parseNotificationCursor({ secret, scope, cursor: legacy, now: 1 }),
    ).toThrow("INVALID_CURSOR");
  });

  it("round-trips a signed scope-bound keyset anchor", () => {
    const cursor = createNotificationCursor({ secret, scope, anchor, now: 0 });

    expect(
      parseNotificationCursor({ secret, scope, cursor, now: 86_399_999 }),
    ).toEqual(anchor);
  });

  it("retains a microsecond anchor without changing its signed scope binding", () => {
    const microsecondAnchor = {
      ...anchor,
      occurredAt: "2026-09-25T00:00:00.000900Z",
    };
    const cursor = createNotificationCursor({
      secret,
      scope,
      anchor: microsecondAnchor,
      now: 0,
    });

    expect(parseNotificationCursor({ secret, scope, cursor, now: 1 })).toEqual(
      microsecondAnchor,
    );
  });

  it("rejects tampering, expired cursors, and a different active organization", () => {
    const cursor = createNotificationCursor({ secret, scope, anchor, now: 0 });
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;

    expect(() =>
      parseNotificationCursor({ secret, scope, cursor: tampered, now: 1 }),
    ).toThrow("INVALID_CURSOR");
    expect(() =>
      parseNotificationCursor({ secret, scope, cursor, now: 86_400_000 }),
    ).toThrow("INVALID_CURSOR");
    expect(() =>
      parseNotificationCursor({
        secret,
        scope: { ...scope, organizationId: null },
        cursor,
        now: 1,
      }),
    ).toThrow("INVALID_CURSOR");
  });
});
