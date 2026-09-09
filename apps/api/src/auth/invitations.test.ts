import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import {
  assertInvitationAdmitsSignup,
  findInvitationPreview,
} from "./invitations";

function stubDatabase(rows: unknown[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const database = {
    db: undefined as unknown as Database["db"],
    sql: {
      query: (text: string, params: unknown[]) => {
        calls.push({ text, params });
        return Promise.resolve({ rows });
      },
    } as unknown as Database["sql"],
    close: () => Promise.resolve(),
  } satisfies Database;
  return { database, calls };
}

const VALID_ROW = {
  id: "inv_1",
  email: "user@example.com",
  role: "viewer",
  expiresAt: new Date("2026-10-08T00:00:00.000Z"),
  organizationName: "Acme Corp",
};

describe("assertInvitationAdmitsSignup", () => {
  it("admits a signup matching a pending invitation case-insensitively", async () => {
    const { database, calls } = stubDatabase([VALID_ROW]);
    await assertInvitationAdmitsSignup(database, {
      invitationId: "inv_1",
      email: "USER@example.com",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual(["inv_1", "USER@example.com"]);
    expect(calls[0]?.text).toContain("lower(i.email) = lower($2)");
  });

  it("refuses signup without the invitation header", async () => {
    const { database } = stubDatabase([VALID_ROW]);
    const failure = assertInvitationAdmitsSignup(database, {
      invitationId: null,
      email: "user@example.com",
    });
    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses a replayed, cancelled or unknown invitation identically", async () => {
    for (const scenario of [
      { invitationId: "inv_unknown", rows: [] },
      { invitationId: "inv_cancelled", rows: [] },
      { invitationId: "inv_expired", rows: [] },
    ]) {
      const { database } = stubDatabase(scenario.rows);
      const failure = assertInvitationAdmitsSignup(database, {
        invitationId: scenario.invitationId,
        email: "user@example.com",
      });
      await expect(failure).rejects.toMatchObject({
        statusCode: 403,
        code: "INVITATION_REQUIRED",
      });
    }
  });

  it("refuses an invitation that belongs to a different email", async () => {
    // The lookup joins on lower(email): a row only comes back when the
    // invitation matches the signup email.
    const { database } = stubDatabase([]);
    await expect(
      assertInvitationAdmitsSignup(database, {
        invitationId: "inv_1",
        email: "attacker@example.com",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("findInvitationPreview", () => {
  it("returns the pending invitation without requiring an email", async () => {
    const { database, calls } = stubDatabase([VALID_ROW]);
    const record = await findInvitationPreview(database, "inv_1");
    expect(record).toEqual(VALID_ROW);
    expect(calls[0]?.text).not.toContain("lower(i.email)");
  });

  it("returns null for exhausted invitations", async () => {
    const { database } = stubDatabase([]);
    expect(await findInvitationPreview(database, "inv_expired")).toBeNull();
  });
});
