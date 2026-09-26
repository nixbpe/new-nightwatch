import { describe, expect, it, vi } from "vitest";

vi.mock("@nightwatch/db", () => ({
  withTenantContextRaw: async (
    database: { sql: { connect: () => Promise<unknown> } },
    _tenantId: string,
    fn: (client: unknown) => Promise<unknown>,
  ) => fn(await database.sql.connect()),
}));

import {
  getOrganizationNotificationSettings,
  updateOrganizationNotificationSettings,
} from "./service";

const ORGANIZATION_ID = crypto.randomUUID();
const USER_ID = "user-owner";

describe("getOrganizationNotificationSettings", () => {
  it("resolves membership pre-tenant, then locks organization and membership before authorizing the settings read", async () => {
    const queries: string[] = [];
    const database = {
      sql: {
        connect: () =>
          Promise.resolve({
            query: (text: string) => {
              queries.push(text);
              if (text.includes("from organization"))
                return Promise.resolve({ rows: [{ id: ORGANIZATION_ID }] });
              if (text.includes("pg_advisory_xact_lock"))
                return Promise.resolve({ rows: [] });
              if (text.includes("from member"))
                return Promise.resolve({ rows: [{ role: "owner" }] });
              if (text.includes("notification_org_settings"))
                return Promise.resolve({ rows: [] });
              throw new Error(`unexpected query: ${text}`);
            },
            release: () => undefined,
          }),
      },
    };

    await expect(
      getOrganizationNotificationSettings(database as never, {
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
      }),
    ).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      settingsChangedEnabled: true,
      version: 0,
    });
    expect(queries.map((query) => query.trim())).toMatchObject([
      expect.stringContaining("from member"),
      expect.stringContaining("from organization"),
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("from member"),
      expect.stringContaining("notification_org_settings"),
    ]);
  });
});

describe("updateOrganizationNotificationSettings", () => {
  it("returns a no-op only after matching the persisted version", async () => {
    const queries: string[] = [];
    const database = {
      sql: {
        connect: () =>
          Promise.resolve({
            query: (text: string) => {
              queries.push(text);
              if (text.includes("from organization"))
                return Promise.resolve({ rows: [{ id: ORGANIZATION_ID }] });
              if (text.includes("pg_advisory_xact_lock"))
                return Promise.resolve({ rows: [] });
              if (text.includes("from member"))
                return Promise.resolve({ rows: [{ role: "admin" }] });
              if (text.includes("notification_org_settings")) {
                return Promise.resolve({
                  rows: [{ settingsChangedEnabled: true, version: 2 }],
                });
              }
              throw new Error(`unexpected query: ${text}`);
            },
            release: () => undefined,
          }),
      },
    };

    await expect(
      updateOrganizationNotificationSettings(database as never, {
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        actorDisplayName: "Owner",
        update: { expectedVersion: 2, settingsChangedEnabled: true },
      }),
    ).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      settingsChangedEnabled: true,
      version: 2,
    });
    expect(
      queries.some((query) =>
        query.includes("insert into notification_org_settings"),
      ),
    ).toBe(false);
  });

  it("rejects a stale version before a no-op can hide it", async () => {
    const database = {
      sql: {
        connect: () =>
          Promise.resolve({
            query: (text: string) => {
              if (text.includes("from organization"))
                return Promise.resolve({ rows: [{ id: ORGANIZATION_ID }] });
              if (text.includes("pg_advisory_xact_lock"))
                return Promise.resolve({ rows: [] });
              if (text.includes("from member"))
                return Promise.resolve({ rows: [{ role: "owner" }] });
              if (text.includes("notification_org_settings")) {
                return Promise.resolve({
                  rows: [{ settingsChangedEnabled: true, version: 2 }],
                });
              }
              throw new Error(`unexpected query: ${text}`);
            },
            release: () => undefined,
          }),
      },
    };

    await expect(
      updateOrganizationNotificationSettings(database as never, {
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        actorDisplayName: "Owner",
        update: { expectedVersion: 1, settingsChangedEnabled: true },
      }),
    ).rejects.toMatchObject({
      code: "SETTINGS_VERSION_CONFLICT",
      statusCode: 409,
    });
  });
});
