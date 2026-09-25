import { createHmac, timingSafeEqual } from "node:crypto";

const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

type CursorScope = {
  userId: string;
  organizationId: string | null;
  limit: number;
};

type CursorAnchor = { occurredAt: string; id: string };

type CursorPayload = CursorScope & CursorAnchor & { issuedAt: number };

type CreateCursorInput = {
  secret: string;
  scope: CursorScope;
  anchor: CursorAnchor;
  now?: number;
};

type ParseCursorInput = {
  secret: string;
  scope: CursorScope;
  cursor: string;
  now?: number;
};

function signature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function invalidCursor(): never {
  throw new Error("INVALID_CURSOR");
}

function isCursorPayload(payload: unknown): payload is CursorPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as Record<string, unknown>;
  return (
    typeof value.userId === "string" &&
    (typeof value.organizationId === "string" ||
      value.organizationId === null) &&
    Number.isInteger(value.limit) &&
    typeof value.occurredAt === "string" &&
    typeof value.id === "string" &&
    Number.isFinite(value.issuedAt)
  );
}

export function createNotificationCursor({
  secret,
  scope,
  anchor,
  now = Date.now(),
}: CreateCursorInput): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...scope,
      ...anchor,
      issuedAt: now,
    } satisfies CursorPayload),
  ).toString("base64url");
  return `${payload}.${signature(secret, payload)}`;
}

export function parseNotificationCursor({
  secret,
  scope,
  cursor,
  now = Date.now(),
}: ParseCursorInput): CursorAnchor {
  const [encodedPayload, encodedSignature, ...rest] = cursor.split(".");
  if (!encodedPayload || !encodedSignature || rest.length !== 0)
    invalidCursor();

  const expectedSignature = signature(secret, encodedPayload);
  const actual = Buffer.from(encodedSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    invalidCursor();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    invalidCursor();
  }
  if (
    !isCursorPayload(payload) ||
    payload.issuedAt + CURSOR_TTL_MS <= now ||
    payload.userId !== scope.userId ||
    payload.organizationId !== scope.organizationId ||
    payload.limit !== scope.limit
  ) {
    invalidCursor();
  }
  return { occurredAt: payload.occurredAt, id: payload.id };
}
