import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/client";
import { withAccountContextRaw } from "../src/notification";
import {
  withTenantContextRaw,
  withTenantUserContextRaw,
} from "../src/tenant-context";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";
type Work = (client: PoolClient) => Promise<unknown>;
const tenantScope = [
  "select set_config('app.tenant_id', $1, true)",
  [tenantId],
];
const userScope = ["select set_config('app.user_id', $1, true)", [userId]];
const wrappers = [
  {
    name: "withTenantContextRaw",
    run: (database: Database, work: Work) =>
      withTenantContextRaw(database, tenantId, work),
    scopes: [tenantScope],
  },
  {
    name: "withTenantUserContextRaw",
    run: (database: Database, work: Work) =>
      withTenantUserContextRaw(database, tenantId, userId, work),
    scopes: [tenantScope, userScope],
  },
  {
    name: "withAccountContextRaw",
    run: (database: Database, work: Work) =>
      withAccountContextRaw(database, userId, work),
    scopes: [userScope],
  },
];

function fixture(failAt?: string, rollbackError?: Error) {
  const events: unknown[] = [];
  const failure = new Error("original failure");
  const query = vi.fn((text: string, values?: unknown[]) => {
    events.push(values ? [text, values] : text);
    if (text === "rollback" && rollbackError)
      return Promise.reject(rollbackError);
    if (text === failAt) return Promise.reject(failure);
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const release = vi.fn(() => {
    events.push("release");
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(() => {
    events.push("connect");
    if (failAt === "connect") return Promise.reject(failure);
    return Promise.resolve(client);
  });
  const database = { sql: { connect } } as unknown as Database;
  return { database, client, events, failure, query, release, connect };
}

for (const wrapper of wrappers) {
  describe(wrapper.name, () => {
    it("uses one connection, awaits the callback and commit, and returns its value", async () => {
      const f = fixture();
      const callbackGate = Promise.withResolvers<undefined>();
      const callbackStarted = Promise.withResolvers<undefined>();
      const commitGate = Promise.withResolvers<undefined>();
      const commitStarted = Promise.withResolvers<undefined>();
      f.query.mockImplementation(async (text: string, values?: unknown[]) => {
        f.events.push(values ? [text, values] : text);
        if (text === "commit") {
          commitStarted.resolve(undefined);
          await commitGate.promise;
        }
        return { rows: [], rowCount: 0 };
      });
      const value = { answer: 42 };
      let settled = false;
      const result = wrapper.run(f.database, async (client) => {
        expect(client).toBe(f.client);
        f.events.push("callback");
        callbackStarted.resolve(undefined);
        await callbackGate.promise;
        await client.query("select 42");
        return value;
      });
      void result.then(() => {
        settled = true;
      });
      await callbackStarted.promise;
      expect(f.events).toEqual([
        "connect",
        "begin",
        ...wrapper.scopes,
        "callback",
      ]);
      expect(f.release).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      callbackGate.resolve(undefined);
      await commitStarted.promise;
      expect(f.release).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      commitGate.resolve(undefined);
      await expect(result).resolves.toBe(value);
      expect(f.events).toEqual([
        "connect",
        "begin",
        ...wrapper.scopes,
        "callback",
        "select 42",
        "commit",
        "release",
      ]);
      expect(f.connect).toHaveBeenCalledOnce();
      expect(f.release).toHaveBeenCalledOnce();
    });

    it("does not roll back or release when acquisition fails", async () => {
      const f = fixture("connect");
      const callback = vi.fn();
      await expect(wrapper.run(f.database, callback)).rejects.toBe(f.failure);
      expect(f.events).toEqual(["connect"]);
      expect(callback).not.toHaveBeenCalled();
      expect(f.release).not.toHaveBeenCalled();
    });

    const phases = [
      "begin",
      ...wrapper.scopes.map((scope) => scope[0] as string),
      "callback",
      "commit",
    ];
    for (const phase of phases) {
      it.each([false, true])(
        `rolls back and releases once after ${phase} fails (rollback fails: %s)`,
        async (rollbackFails) => {
          const rollbackError = new Error("rollback failure");
          const f = fixture(phase, rollbackFails ? rollbackError : undefined);
          const callback = vi.fn((client: PoolClient) => {
            expect(client).toBe(f.client);
            f.events.push("callback");
            if (phase === "callback") return Promise.reject(f.failure);
            return Promise.resolve(42);
          });
          await expect(wrapper.run(f.database, callback)).rejects.toBe(
            rollbackFails ? rollbackError : f.failure,
          );
          const successfulPath: unknown[] = [
            "connect",
            "begin",
            ...wrapper.scopes,
            "callback",
            "commit",
          ];
          const failedIndex =
            phase === "begin"
              ? 1
              : phase === "callback"
                ? successfulPath.length - 2
                : phase === "commit"
                  ? successfulPath.length - 1
                  : 2 + wrapper.scopes.findIndex((scope) => scope[0] === phase);
          expect(f.events).toEqual([
            ...successfulPath.slice(0, failedIndex + 1),
            "rollback",
            "release",
          ]);
          expect(callback).toHaveBeenCalledTimes(
            phase === "callback" || phase === "commit" ? 1 : 0,
          );
          expect(f.connect).toHaveBeenCalledOnce();
          expect(f.release).toHaveBeenCalledOnce();
        },
      );
    }
  });
}

describe("raw context validation before acquisition", () => {
  it.each([
    [
      "tenant",
      (db: Database, work: Work) => withTenantContextRaw(db, "invalid", work),
      "tenantId must be a UUID",
    ],
    [
      "tenant/user tenant",
      (db: Database, work: Work) =>
        withTenantUserContextRaw(db, "invalid", userId, work),
      "tenantId must be a UUID",
    ],
    [
      "tenant/user user",
      (db: Database, work: Work) =>
        withTenantUserContextRaw(db, tenantId, "", work),
      "userId must not be empty",
    ],
    [
      "account",
      (db: Database, work: Work) => withAccountContextRaw(db, "", work),
      "userId must not be empty",
    ],
  ] as const)("rejects invalid %s", async (_name, run, message) => {
    const f = fixture();
    const callback = vi.fn();
    await expect(run(f.database, callback)).rejects.toThrow(message);
    expect(f.connect).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });
});
