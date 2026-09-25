import { describe, expect, it } from "vitest";

import {
  markResetCredentialWrite,
  type AccountNotificationOriginWriter,
  type AuthOriginTransaction,
  withAccountNotificationOrigins,
} from "./auth-origin-intents";
type Write = {
  model: string;
  data?: Record<string, unknown>;
  update?: Record<string, unknown>;
  where?: Array<{ field: string; value: unknown }>;
};

type FakeAdapter = {
  create: (write: Write) => Promise<Record<string, unknown>>;
  update: (write: Write) => Promise<Record<string, unknown>>;
  updateMany: (write: Write) => Promise<number>;
  deleteMany: (write: Write) => Promise<number>;
  findOne: (write: Write) => Promise<Record<string, unknown> | null>;
  delete: (write: Write) => Promise<unknown>;
  transaction: <T>(
    callback: (adapter: FakeAdapter) => Promise<T>,
  ) => Promise<T>;
};

type FakeTransaction = AuthOriginTransaction & { id: string };

function adapter(userId = "user-1"): FakeAdapter {
  return {
    create: ({ data }) => Promise.resolve({ id: "account-1", ...data }),
    update: ({ update }) =>
      Promise.resolve({ id: "account-1", userId, ...update }),
    updateMany: () => Promise.resolve(1),
    deleteMany: () => Promise.resolve(1),
    findOne: ({ model }) =>
      Promise.resolve(
        model === "account"
          ? {
              id: "account-1",
              userId,
              providerId: "credential",
              password: "old-hash",
            }
          : { id: "two-factor-1", userId, verified: false },
      ),
    delete: () => Promise.resolve(undefined),
    transaction: (callback) => callback(adapter(userId)),
  };
}

function setup(options?: { failIntent?: boolean }) {
  const calls: string[] = [];
  let transactionCalls = 0;
  let runInMfaRequest:
    (<T>(callback: () => Promise<T>) => Promise<T>) | undefined;
  const writer: AccountNotificationOriginWriter<FakeTransaction> = {
    insertPasswordChanged: (_tx, input) => {
      calls.push(`password:${input.userId}`);
      if (options?.failIntent)
        return Promise.reject(new Error("intent write failed"));
      return Promise.resolve();
    },
    initializeMfaState: (_tx, input) => {
      calls.push(`baseline:${input.userId}`);
      return Promise.resolve(undefined);
    },
    recordMfaTransition: (_tx, input) => {
      calls.push(`mfa:${input.userId}:${input.transition}`);
      return Promise.resolve({ transitioned: true });
    },
  };
  const tx = { id: "tx-1" } as FakeTransaction;
  const wrapped = withAccountNotificationOrigins((() => adapter()) as never, {
    writer,
    transaction: (callback) => {
      transactionCalls += 1;
      return callback(tx);
    },
    transactionAdapter: () => adapter() as never,
    onMfaRequestReady: (runner) => {
      runInMfaRequest = runner;
    },
  })({}) as unknown as FakeAdapter;
  return {
    calls,
    transactionCalls: () => transactionCalls,
    runInMfaRequest: <T>(callback: () => Promise<T>) => {
      if (!runInMfaRequest) {
        throw new Error("MFA request runner was not initialized");
      }
      return runInMfaRequest(callback);
    },
    wrapped,
  };
}

describe("withAccountNotificationOrigins", () => {
  it("inserts the password intent in the transaction that performs a qualified update", async () => {
    const { calls, wrapped } = setup();

    await wrapped.update({
      model: "account",
      update: { password: "hash" },
      where: [{ field: "id", value: "account-1" }],
    });

    expect(calls).toEqual(["password:user-1"]);
  });

  it("does not emit when a credential update persists the same hash", async () => {
    const { calls, wrapped } = setup();

    await wrapped.update({
      model: "account",
      update: { password: "old-hash" },
      where: [{ field: "id", value: "account-1" }],
    });

    expect(calls).toEqual([]);
  });

  it("does not emit when a credential updateMany persists the same hash", async () => {
    const { calls, wrapped } = setup();

    await wrapped.updateMany({
      model: "account",
      update: { password: "old-hash" },
      where: [
        { field: "userId", value: "user-1" },
        { field: "providerId", value: "credential" },
      ],
    });

    expect(calls).toEqual([]);
  });
  it("rolls back the credential write when the qualified intent insert fails", async () => {
    const { wrapped } = setup({ failIntent: true });

    await expect(
      wrapped.update({
        model: "account",
        update: { password: "hash" },
        where: [{ field: "id", value: "account-1" }],
      }),
    ).rejects.toThrow("intent write failed");
  });

  it("does not turn ordinary credential account creation into a password event", async () => {
    const { calls, wrapped } = setup();

    await wrapped.create({
      model: "account",
      data: {
        userId: "user-1",
        providerId: "credential",
        password: "hash",
      },
    });

    expect(calls).toEqual([]);
  });

  it("initializes the MFA baseline before a verified two-factor row mutation", async () => {
    const { calls, wrapped } = setup();

    await wrapped.update({
      model: "twoFactor",
      update: { verified: true },
      where: [{ field: "id", value: "two-factor-1" }],
    });

    expect(calls).toEqual(["baseline:user-1", "mfa:user-1:enabled"]);
  });

  it("keeps a qualified write inside the adapter's outer transaction", async () => {
    const { calls, transactionCalls, wrapped } = setup();

    await wrapped.transaction((transactionAdapter) =>
      transactionAdapter.update({
        model: "account",
        update: { password: "hash" },
        where: [{ field: "id", value: "account-1" }],
      }),
    );

    expect(calls).toEqual(["password:user-1"]);
    expect(transactionCalls()).toBe(1);
  });

  it("initializes a verified two-factor creation in its origin transaction", async () => {
    const { calls, wrapped } = setup();

    await wrapped.create({
      model: "twoFactor",
      data: { userId: "user-1", verified: true },
    });

    expect(calls).toEqual(["baseline:user-1", "mfa:user-1:enabled"]);
  });

  it("defers the native MFA flag until the verified-row mutation transaction", async () => {
    const { calls, runInMfaRequest, transactionCalls, wrapped } = setup();

    await runInMfaRequest(async () => {
      await wrapped.update({
        model: "user",
        update: { twoFactorEnabled: true },
        where: [{ field: "id", value: "user-1" }],
      });
      await wrapped.update({
        model: "twoFactor",
        update: { verified: true },
        where: [{ field: "id", value: "two-factor-1" }],
      });
    });

    expect(transactionCalls()).toBe(1);
    expect(calls).toEqual(["baseline:user-1", "mfa:user-1:enabled"]);
  });

  it("rolls back deferred native MFA state when its intent insert fails", async () => {
    const state = {
      twoFactorEnabled: false,
      verified: false,
    };
    let runInMfaRequest:
      (<T>(callback: () => Promise<T>) => Promise<T>) | undefined;
    const fakeAdapter = (): FakeAdapter => ({
      create: ({ data }) => Promise.resolve({ id: "account-1", ...data }),
      update: ({ model, update }) => {
        if (model === "user")
          state.twoFactorEnabled = Boolean(update?.twoFactorEnabled);
        if (model === "twoFactor") state.verified = Boolean(update?.verified);
        return Promise.resolve({
          id: model === "user" ? "user-1" : "two-factor-1",
          userId: "user-1",
          ...state,
        });
      },
      updateMany: () => Promise.resolve(1),
      deleteMany: ({ model }) => {
        if (model === "twoFactor") state.verified = false;
        return Promise.resolve(1);
      },
      findOne: ({ model }) =>
        Promise.resolve(
          model === "user"
            ? { id: "user-1", twoFactorEnabled: state.twoFactorEnabled }
            : {
                id: "two-factor-1",
                userId: "user-1",
                verified: state.verified,
              },
        ),
      delete: () => Promise.resolve(undefined),
      transaction: (callback) => callback(fakeAdapter()),
    });
    const wrapped = withAccountNotificationOrigins(
      (() => fakeAdapter()) as never,
      {
        writer: {
          insertPasswordChanged: () => Promise.resolve(),
          initializeMfaState: () => Promise.resolve(undefined),
          recordMfaTransition: () =>
            Promise.reject(new Error("intent write failed")),
        },
        transaction: async (callback) => {
          const before = { ...state };
          try {
            return await callback({ id: "tx-1" });
          } catch (error) {
            state.twoFactorEnabled = before.twoFactorEnabled;
            state.verified = before.verified;
            throw error;
          }
        },
        transactionAdapter: () => fakeAdapter() as never,
        onMfaRequestReady: (runner) => {
          runInMfaRequest = runner;
        },
      },
    )({}) as unknown as FakeAdapter;

    if (!runInMfaRequest)
      throw new Error("MFA request runner was not initialized");
    await expect(
      runInMfaRequest(async () => {
        await wrapped.update({
          model: "user",
          update: { twoFactorEnabled: true },
          where: [{ field: "id", value: "user-1" }],
        });
        await wrapped.update({
          model: "twoFactor",
          update: { verified: true },
          where: [{ field: "id", value: "two-factor-1" }],
        });
      }),
    ).rejects.toThrow("intent write failed");

    expect(state).toEqual({ twoFactorEnabled: false, verified: false });
  });

  it("rolls back a deferred verified MFA replacement when creation fails", async () => {
    const state: {
      twoFactor: Record<string, unknown> | null;
    } = {
      twoFactor: {
        id: "two-factor-old",
        userId: "user-1",
        verified: true,
        secret: "old-secret",
      },
    };
    let runInMfaRequest:
      (<T>(callback: () => Promise<T>) => Promise<T>) | undefined;
    const fakeAdapter = (): FakeAdapter => ({
      create: ({ model, data }) => {
        if (model === "twoFactor")
          return Promise.reject(new Error("replacement failed"));
        return Promise.resolve({ id: "account-1", ...data });
      },
      update: ({ update }) => Promise.resolve({ id: "user-1", ...update }),
      updateMany: () => Promise.resolve(1),
      deleteMany: ({ model }) => {
        if (model === "twoFactor") state.twoFactor = null;
        return Promise.resolve(1);
      },
      findOne: ({ model }) =>
        Promise.resolve(model === "twoFactor" ? state.twoFactor : null),
      delete: () => Promise.resolve(undefined),
      transaction: (callback) => callback(fakeAdapter()),
    });
    const wrapped = withAccountNotificationOrigins(
      (() => fakeAdapter()) as never,
      {
        writer: {
          insertPasswordChanged: () => Promise.resolve(),
          initializeMfaState: () => Promise.resolve(undefined),
          recordMfaTransition: () => Promise.resolve({ transitioned: true }),
        },
        transaction: async (callback) => {
          const before = state.twoFactor;
          try {
            return await callback({ id: "tx-1" });
          } catch (error) {
            state.twoFactor = before;
            throw error;
          }
        },
        transactionAdapter: () => fakeAdapter() as never,
        onMfaRequestReady: (runner) => {
          runInMfaRequest = runner;
        },
      },
    )({}) as unknown as FakeAdapter;

    if (!runInMfaRequest)
      throw new Error("MFA request runner was not initialized");
    await expect(
      runInMfaRequest(async () => {
        await wrapped.deleteMany({
          model: "twoFactor",
          where: [{ field: "userId", value: "user-1" }],
        });
        await wrapped.create({
          model: "twoFactor",
          data: { userId: "user-1", verified: true },
        });
      }),
    ).rejects.toThrow("replacement failed");

    expect(state.twoFactor).toEqual({
      id: "two-factor-old",
      userId: "user-1",
      verified: true,
      secret: "old-secret",
    });
  });

  it("does not emit an enabled transition for a verified MFA re-enrollment", async () => {
    const calls: string[] = [];
    let twoFactor: Record<string, unknown> | null = {
      id: "two-factor-old",
      userId: "user-1",
      verified: true,
    };
    let runInMfaRequest:
      (<T>(callback: () => Promise<T>) => Promise<T>) | undefined;
    const fakeAdapter = (): FakeAdapter => ({
      create: ({ data }) => {
        twoFactor = { id: "two-factor-new", ...data };
        return Promise.resolve(twoFactor);
      },
      update: ({ update }) => Promise.resolve({ id: "user-1", ...update }),
      updateMany: () => Promise.resolve(1),
      deleteMany: () => {
        twoFactor = null;
        return Promise.resolve(1);
      },
      findOne: () => Promise.resolve(twoFactor),
      delete: () => Promise.resolve(undefined),
      transaction: (callback) => callback(fakeAdapter()),
    });
    const wrapped = withAccountNotificationOrigins(
      (() => fakeAdapter()) as never,
      {
        writer: {
          insertPasswordChanged: () => Promise.resolve(),
          initializeMfaState: (_tx, input) => {
            calls.push(`baseline:${input.userId}`);
            return Promise.resolve(undefined);
          },
          recordMfaTransition: (_tx, input) => {
            calls.push(input.transition);
            return Promise.resolve({ transitioned: true });
          },
        },
        transaction: (callback) => callback({ id: "tx-1" }),
        transactionAdapter: () => fakeAdapter() as never,
        onMfaRequestReady: (runner) => {
          runInMfaRequest = runner;
        },
      },
    )({}) as unknown as FakeAdapter;

    if (!runInMfaRequest)
      throw new Error("MFA request runner was not initialized");
    await runInMfaRequest(async () => {
      await wrapped.deleteMany({
        model: "twoFactor",
        where: [{ field: "userId", value: "user-1" }],
      });
      await wrapped.create({
        model: "twoFactor",
        data: { userId: "user-1", verified: true },
      });
    });

    expect(twoFactor).toMatchObject({ id: "two-factor-new", verified: true });
    expect(calls).toEqual(["baseline:user-1"]);
  });

  it("rejects a deferred MFA deletion for a different replacement user", async () => {
    const { runInMfaRequest, wrapped } = setup();

    await expect(
      runInMfaRequest(async () => {
        await wrapped.deleteMany({
          model: "twoFactor",
          where: [{ field: "userId", value: "user-1" }],
        });
        await wrapped.create({
          model: "twoFactor",
          data: { userId: "user-2", verified: true },
        });
      }),
    ).rejects.toThrow("MFA two-factor deletion did not match replacement user");
  });

  it("emits for only a hook-marked first reset credential", async () => {
    const { calls, wrapped } = setup();
    const data = {
      userId: "user-1",
      providerId: "credential",
      password: "hash",
    };
    markResetCredentialWrite(data);

    await wrapped.create({ model: "account", data });

    expect(calls).toEqual(["password:user-1"]);
  });
});
