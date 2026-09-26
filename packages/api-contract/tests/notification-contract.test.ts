import { describe, expect, it } from "vitest";

import {
  notificationItemSchema,
  notificationListQuerySchema,
  notificationSettingsUpdateSchema,
  notificationStatusErrorResponseSchemas,
} from "../src/index";

const accountItem = {
  id: "d08d72bd-e1cf-4e01-8c4b-6c3b9b5d9e6e",
  scope: "account",
  organizationId: null,
  eventType: "PASSWORD_CHANGED",
  occurredAt: "2026-09-25T12:00:00.000Z",
  readAt: null,
  actor: null,
  category: null,
};

describe("notificationItemSchema", () => {
  it("accepts the account and organization discriminants", () => {
    expect(notificationItemSchema.safeParse(accountItem).success).toBe(true);
    expect(
      notificationItemSchema.safeParse({
        ...accountItem,
        scope: "organization",
        organizationId: "80ce22d4-8472-468f-a6ee-2dd4f752fd6c",
        eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED",
        actor: { displayName: "Avery" },
        category: "notification-settings",
      }).success,
    ).toBe(true);
  });

  it("rejects cross-scope event and presentation discriminants", () => {
    expect(
      notificationItemSchema.safeParse({
        ...accountItem,
        scope: "organization",
        organizationId: "80ce22d4-8472-468f-a6ee-2dd4f752fd6c",
      }).success,
    ).toBe(false);
    expect(
      notificationItemSchema.safeParse({
        ...accountItem,
        actor: { displayName: "Avery" },
      }).success,
    ).toBe(false);
  });

  it("rejects non-ISO timestamps", () => {
    expect(
      notificationItemSchema.safeParse({ ...accountItem, occurredAt: "today" })
        .success,
    ).toBe(false);
  });
});

describe("notification request schemas", () => {
  it("enforces list and settings bounds", () => {
    expect(notificationListQuerySchema.parse({}).limit).toBe(20);
    expect(notificationListQuerySchema.safeParse({ limit: "51" }).success).toBe(
      false,
    );
    expect(
      notificationSettingsUpdateSchema.safeParse({
        settingsChangedEnabled: true,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
  });
});

describe("notification status error schemas", () => {
  it("accepts only the contract error code for each status", () => {
    for (const [status, code] of [
      [400, "INVALID_CURSOR"],
      [401, "UNAUTHENTICATED"],
      [403, "MEMBERSHIP_DENIED"],
      [404, "NOTIFICATION_NOT_FOUND"],
      [409, "SETTINGS_VERSION_CONFLICT"],
    ] as const) {
      expect(
        notificationStatusErrorResponseSchemas[status].safeParse({
          error: { code, message: "Contract error" },
        }).success,
      ).toBe(true);
    }
    expect(
      notificationStatusErrorResponseSchemas[409].safeParse({
        error: { code: "INVALID_INPUT", message: "Invalid input" },
      }).success,
    ).toBe(false);
  });
});
