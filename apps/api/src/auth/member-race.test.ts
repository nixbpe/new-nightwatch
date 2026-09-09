import { describe, expect, it } from "vitest";

import {
  isMemberUniquenessRace,
  translateMemberUniquenessRace,
  withMemberRaceTranslation,
} from "./member-race";

const RACE_ERROR = {
  code: "23505",
  constraint: "member_organization_user_key",
  message:
    'duplicate key value violates unique constraint "member_organization_user_key"',
};

/** How drizzle-orm 0.45.2 surfaces every query failure to callers. */
function drizzleWrapped(cause: unknown): Error & { cause: unknown } {
  const wrapped = new Error(
    `Failed query: insert into "member" (...)`,
  ) as Error & {
    cause: unknown;
  };
  wrapped.cause = cause;
  return wrapped;
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("isMemberUniquenessRace", () => {
  it("matches only the proven member-uniqueness 23505 conflict", () => {
    expect(isMemberUniquenessRace(RACE_ERROR)).toBe(true);
    // drizzle wraps query failures; the pg error sits in the cause chain.
    expect(isMemberUniquenessRace(drizzleWrapped(RACE_ERROR))).toBe(true);
    expect(
      isMemberUniquenessRace(drizzleWrapped(drizzleWrapped(RACE_ERROR))),
    ).toBe(true);
    // Same SQLSTATE on a different constraint must NOT be treated as the
    // acceptance race (e.g. concurrent signups on user_email_lower_key).
    expect(
      isMemberUniquenessRace({
        ...RACE_ERROR,
        constraint: "user_email_lower_key",
      }),
    ).toBe(false);
    expect(
      isMemberUniquenessRace(
        drizzleWrapped({ ...RACE_ERROR, constraint: "user_email_lower_key" }),
      ),
    ).toBe(false);
    // A member-row failure that is not a uniqueness conflict stays visible.
    expect(isMemberUniquenessRace({ ...RACE_ERROR, code: "23503" })).toBe(
      false,
    );
    expect(isMemberUniquenessRace(new Error("connection refused"))).toBe(false);
    expect(isMemberUniquenessRace(null)).toBe(false);
    expect(isMemberUniquenessRace("23505")).toBe(false);
  });
});

describe("translateMemberUniquenessRace", () => {
  it("remaps the proven race to the native 400 denial", () => {
    const caught = captureThrow(() =>
      translateMemberUniquenessRace(drizzleWrapped(RACE_ERROR)),
    );
    expect(caught).toMatchObject({
      name: "APIError",
      statusCode: 400,
      body: { message: "Invitation not found" },
    });
  });

  it("rethrows every other error unchanged, including other 23505s", () => {
    const otherConstraint = {
      ...RACE_ERROR,
      constraint: "user_email_lower_key",
    };
    const wrappedOther = drizzleWrapped(otherConstraint);
    expect(
      captureThrow(() => translateMemberUniquenessRace(wrappedOther)),
    ).toBe(wrappedOther);
    const plain = new Error("connection refused");
    expect(captureThrow(() => translateMemberUniquenessRace(plain))).toBe(
      plain,
    );
  });
});

describe("withMemberRaceTranslation", () => {
  type Factory = Parameters<typeof withMemberRaceTranslation>[0];

  function fakeAdapter(overrides?: {
    create?: () => Promise<unknown>;
  }): Record<string, unknown> {
    return {
      create: overrides?.create ?? (() => Promise.resolve({ id: "member-1" })),
      update: () => Promise.resolve(null),
    };
  }

  function wrapWith(adapter: Record<string, unknown>): {
    create: () => Promise<unknown>;
    update: unknown;
  } {
    const factory = (() => adapter) as unknown as Factory;
    const wrapped = withMemberRaceTranslation(factory)({});
    return {
      create: wrapped.create as unknown as () => Promise<unknown>,
      update: wrapped.update,
    };
  }

  it("translates the drizzle-wrapped race on create", async () => {
    const wrapped = wrapWith(
      fakeAdapter({ create: () => Promise.reject(drizzleWrapped(RACE_ERROR)) }),
    );
    await expect(wrapped.create()).rejects.toMatchObject({
      name: "APIError",
      statusCode: 400,
      body: { message: "Invitation not found" },
    });
  });

  it("keeps unrelated create failures untouched", async () => {
    const failure = new Error("connection refused");
    const wrapped = wrapWith(
      fakeAdapter({ create: () => Promise.reject(failure) }),
    );
    await expect(wrapped.create()).rejects.toBe(failure);
  });

  it("translates the race on transaction-scoped adapters too", async () => {
    // Better Auth runs acceptance in runWithTransaction; the core adapter
    // hands the callback a transaction-scoped adapter whose create must be
    // wrapped as well.
    const trxAdapter = fakeAdapter({
      create: () => Promise.reject(drizzleWrapped(RACE_ERROR)),
    });
    const rootAdapter = {
      ...fakeAdapter(),
      transaction: (
        callback: (trx: Record<string, unknown>) => Promise<unknown>,
      ) => callback(trxAdapter),
    };
    const factory = (() => rootAdapter) as unknown as Factory;
    const wrapped = withMemberRaceTranslation(factory)({});
    const transaction = wrapped.transaction as unknown as (
      callback: (trx: { create: () => Promise<unknown> }) => Promise<unknown>,
    ) => Promise<unknown>;
    await expect(
      transaction(async (trx) => trx.create()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
