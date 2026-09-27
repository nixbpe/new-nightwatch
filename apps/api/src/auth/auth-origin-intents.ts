import { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter, DBTransactionAdapter } from "better-auth/types";

export type AuthOriginTransaction = object;

export type PasswordChangedInput = {
  id: string;
  dispatchId: string;
  origin: string;
  occurredAt: Date;
  userId: string;
};

export type MfaTransitionInput = {
  id: string;
  dispatchId: string;
  origin: string;
  occurredAt: Date;
  transition: "enabled" | "disabled";
  userId: string;
};

// Each method runs in the auth mutation's transaction; never open another.
export type AccountNotificationOriginWriter<Tx extends AuthOriginTransaction> =
  {
    insertPasswordChanged: (
      tx: Tx,
      input: PasswordChangedInput,
    ) => Promise<void>;
    initializeMfaState: (
      tx: Tx,
      input: { userId: string },
    ) => Promise<{ verifiedEnabled: boolean } | undefined>;
    recordMfaTransition: (
      tx: Tx,
      input: MfaTransitionInput,
    ) => Promise<{ transitioned: boolean }>;
  };
type AdapterFactory = (options: BetterAuthOptions) => Adapter;
type Adapter = DBAdapter;
type TransactionAdapter = DBTransactionAdapter;
type OriginAdapter = Adapter | TransactionAdapter;

type AdapterWrite = {
  model: string;
  data?: object;
  update?: object;
  where?: object[];
};

type MfaRequestScope = {
  deferredSessionDeletes: AdapterWrite[];
  deferredTwoFactorDelete: AdapterWrite | null;
  deferredUserFlag: AdapterWrite | null;
};

type OriginDependencies<Tx extends AuthOriginTransaction> = {
  writer: AccountNotificationOriginWriter<Tx>;
  transaction: <T>(callback: (tx: Tx) => Promise<T>) => Promise<T>;
  transactionAdapter: (tx: Tx, options: BetterAuthOptions) => OriginAdapter;
  onMfaRequestReady?: (
    runInMfaRequest: <T>(callback: () => Promise<T>) => Promise<T>,
  ) => void;
};

const resetCredentialWrites = new WeakSet<object>();

// The hook sees the same object the adapter later gets, so a WeakSet tags reset
// writes without adding an unknown column to the insert payload.
export function markResetCredentialWrite(data: object): void {
  resetCredentialWrites.add(data);
}

function adapterWrite(value: unknown): value is AdapterWrite {
  if (
    value === null ||
    typeof value !== "object" ||
    !("model" in value) ||
    typeof value.model !== "string"
  )
    return false;
  const data = "data" in value ? value.data : undefined;
  const update = "update" in value ? value.update : undefined;
  const where = "where" in value ? value.where : undefined;
  return (
    (data === undefined || (data !== null && typeof data === "object")) &&
    (update === undefined || (update !== null && typeof update === "object")) &&
    (where === undefined ||
      (Array.isArray(where) &&
        where.every(
          (clause): clause is object =>
            clause !== null && typeof clause === "object",
        )))
  );
}

function hasPassword(values: object | undefined): boolean {
  return (
    values !== undefined &&
    "password" in values &&
    typeof values.password === "string"
  );
}

function twoFactorUserId(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("userId" in value))
    return null;
  return typeof value.userId === "string" ? value.userId : null;
}

function whereValue(write: AdapterWrite, field: string): string | null {
  const clause = write.where?.find(
    (candidate) =>
      "field" in candidate && candidate.field === field && "value" in candidate,
  );
  const value = clause && "value" in clause ? clause.value : undefined;
  return typeof value === "string" ? value : null;
}

function credentialPassword(
  row: unknown,
): { userId: string; password: string | null } | null {
  if (
    row === null ||
    typeof row !== "object" ||
    !("providerId" in row) ||
    row.providerId !== "credential" ||
    !("userId" in row) ||
    typeof row.userId !== "string" ||
    !("password" in row) ||
    (row.password !== null && typeof row.password !== "string")
  ) {
    return null;
  }
  return { userId: row.userId, password: row.password };
}

function changedCredentialUserId(
  before: unknown,
  updated: unknown,
): string | null {
  const credential = credentialPassword(before);
  if (
    credential === null ||
    updated === null ||
    typeof updated !== "object" ||
    !("password" in updated) ||
    typeof updated.password !== "string" ||
    updated.password === credential.password
  ) {
    return null;
  }
  return credential.userId;
}

function notificationIds(
  event: string,
): Pick<PasswordChangedInput, "id" | "dispatchId" | "origin"> {
  const id = crypto.randomUUID();
  return {
    id,
    dispatchId: crypto.randomUUID(),
    origin: `${event}:${id}`,
  };
}

function isVerifiedTwoFactor(
  row: unknown,
): row is { userId: string; verified: true } {
  return (
    row !== null &&
    typeof row === "object" &&
    "verified" in row &&
    row.verified === true &&
    "userId" in row &&
    typeof row.userId === "string"
  );
}

// The notification write commits with the auth write; inside an outer Better
// Auth transaction the transaction-bound adapter is reused, never the pool
// adapter.
export function withAccountNotificationOrigins<
  Tx extends AuthOriginTransaction,
>(
  factory: AdapterFactory,
  dependencies: OriginDependencies<Tx>,
): AdapterFactory {
  const requestAdapter = new AsyncLocalStorage<OriginAdapter>();
  const mfaRequest = new AsyncLocalStorage<MfaRequestScope>();
  return (options) => {
    const wrap = (adapter: OriginAdapter, tx: Tx | null): Adapter => {
      const runInTransaction = <T>(
        run: (transactionAdapter: OriginAdapter, transaction: Tx) => Promise<T>,
      ): Promise<T> => {
        if (tx) return run(adapter, tx);
        return dependencies.transaction((transaction) =>
          run(
            dependencies.transactionAdapter(transaction, options),
            transaction,
          ),
        );
      };
      const create = (async (write) => {
        const active = tx ? null : requestAdapter.getStore();
        if (active) return active.create(write);
        if (!adapterWrite(write)) return adapter.create(write);
        const candidate = write;
        const mfaScope = mfaRequest.getStore();
        const deferredTwoFactorDelete = mfaScope?.deferredTwoFactorDelete;
        const twoFactorUserId =
          candidate.model === "twoFactor" &&
          "userId" in candidate.data &&
          typeof candidate.data.userId === "string"
            ? candidate.data.userId
            : null;
        if (twoFactorUserId && mfaScope && deferredTwoFactorDelete) {
          if (
            whereValue(deferredTwoFactorDelete, "userId") !== twoFactorUserId
          ) {
            throw new Error(
              "MFA two-factor deletion did not match replacement user",
            );
          }
          return runInTransaction(async (transactionAdapter, transaction) => {
            await dependencies.writer.initializeMfaState(transaction, {
              userId: twoFactorUserId,
            });
            const before = await transactionAdapter.findOne(
              deferredTwoFactorDelete as Parameters<Adapter["findOne"]>[0],
            );
            const deferred = mfaScope.deferredUserFlag;
            if (deferred) {
              if (whereValue(deferred, "id") !== twoFactorUserId) {
                throw new Error(
                  "MFA user update did not match two-factor user",
                );
              }
              mfaScope.deferredUserFlag = null;
              await transactionAdapter.update(
                deferred as Parameters<Adapter["update"]>[0],
              );
            }
            for (const sessionDelete of mfaScope.deferredSessionDeletes) {
              await transactionAdapter.delete(
                sessionDelete as Parameters<Adapter["delete"]>[0],
              );
            }
            await transactionAdapter.deleteMany(
              deferredTwoFactorDelete as Parameters<Adapter["deleteMany"]>[0],
            );
            const created = await transactionAdapter.create(write);
            mfaScope.deferredTwoFactorDelete = null;
            if (
              "verified" in candidate.data &&
              candidate.data.verified === true &&
              !isVerifiedTwoFactor(before)
            ) {
              await dependencies.writer.recordMfaTransition(transaction, {
                ...notificationIds("mfa-enable"),
                occurredAt: new Date(),
                transition: "enabled",
                userId: twoFactorUserId,
              });
            }
            return created;
          });
        }
        if (twoFactorUserId) {
          return runInTransaction(async (transactionAdapter, transaction) => {
            await dependencies.writer.initializeMfaState(transaction, {
              userId: twoFactorUserId,
            });
            const scope = mfaRequest.getStore();
            const deferred = scope?.deferredUserFlag;
            if (deferred) {
              if (whereValue(deferred, "id") !== twoFactorUserId) {
                throw new Error(
                  "MFA user update did not match two-factor user",
                );
              }
              scope.deferredUserFlag = null;
              await transactionAdapter.update(
                deferred as Parameters<Adapter["update"]>[0],
              );
            }
            for (const sessionDelete of scope?.deferredSessionDeletes ?? []) {
              await transactionAdapter.delete(
                sessionDelete as Parameters<Adapter["delete"]>[0],
              );
            }
            const created = await transactionAdapter.create(write);
            if (
              "verified" in candidate.data &&
              candidate.data.verified === true
            ) {
              await dependencies.writer.recordMfaTransition(transaction, {
                ...notificationIds("mfa-enable"),
                occurredAt: new Date(),
                transition: "enabled",
                userId: twoFactorUserId,
              });
            }
            return created;
          });
        }
        if (
          candidate.model !== "account" ||
          !("providerId" in candidate.data) ||
          candidate.data.providerId !== "credential" ||
          !hasPassword(candidate.data) ||
          !resetCredentialWrites.has(candidate.data)
        ) {
          return adapter.create(write);
        }
        const userId =
          "userId" in candidate.data ? candidate.data.userId : undefined;
        if (typeof userId !== "string") return adapter.create(write);
        return runInTransaction(async (transactionAdapter, transaction) => {
          const created = await transactionAdapter.create(write);
          await dependencies.writer.insertPasswordChanged(transaction, {
            ...notificationIds("password-reset"),
            occurredAt: new Date(),
            userId,
          });
          return created;
        });
      }) as Adapter["create"];
      const update = (async (write) => {
        const active = tx ? null : requestAdapter.getStore();
        if (active) return active.update(write);
        if (!adapterWrite(write)) return adapter.update(write);
        const candidate = write;
        if (
          candidate.model === "user" &&
          "twoFactorEnabled" in candidate.update &&
          typeof candidate.update.twoFactorEnabled === "boolean" &&
          whereValue(candidate, "id") !== null
        ) {
          const scope = mfaRequest.getStore();
          if (!scope) return adapter.update(write);
          scope.deferredUserFlag = candidate;
          const current = await adapter.findOne({
            model: "user",
            where: write.where,
          });
          if (current === null || typeof current !== "object") return null;
          return { ...current, ...candidate.update };
        }
        if (candidate.model === "account" && hasPassword(candidate.update)) {
          return runInTransaction(async (transactionAdapter, transaction) => {
            const before = await transactionAdapter.findOne({
              model: "account",
              where: write.where,
            });
            const updated = await transactionAdapter.update(write);
            const userId = changedCredentialUserId(before, updated);
            if (!userId) return updated;
            await dependencies.writer.insertPasswordChanged(transaction, {
              ...notificationIds("password-change"),
              occurredAt: new Date(),
              userId,
            });
            return updated;
          });
        }
        if (
          candidate.model === "twoFactor" &&
          "verified" in candidate.update &&
          candidate.update.verified === true
        ) {
          return runInTransaction(async (transactionAdapter, transaction) => {
            const before = await transactionAdapter.findOne({
              model: "twoFactor",
              where: write.where,
            });
            const beforeUserId = twoFactorUserId(before);
            if (beforeUserId) {
              await dependencies.writer.initializeMfaState(transaction, {
                userId: beforeUserId,
              });
            }
            const scope = mfaRequest.getStore();
            const deferred = scope?.deferredUserFlag;
            if (deferred && beforeUserId) {
              if (whereValue(deferred, "id") !== beforeUserId) {
                throw new Error(
                  "MFA user update did not match two-factor user",
                );
              }
              scope.deferredUserFlag = null;
              await transactionAdapter.update(
                deferred as Parameters<Adapter["update"]>[0],
              );
            }
            for (const sessionDelete of scope?.deferredSessionDeletes ?? []) {
              await transactionAdapter.delete(
                sessionDelete as Parameters<Adapter["delete"]>[0],
              );
            }
            const updated = await transactionAdapter.update(write);
            if (!beforeUserId) return updated;
            await dependencies.writer.recordMfaTransition(transaction, {
              ...notificationIds("mfa-enable"),
              occurredAt: new Date(),
              transition: "enabled",
              userId: beforeUserId,
            });
            return updated;
          });
        }
        return adapter.update(write);
      }) as Adapter["update"];
      const updateMany = (async (write) => {
        const active = tx ? null : requestAdapter.getStore();
        if (active) return active.updateMany(write);
        if (!adapterWrite(write)) return adapter.updateMany(write);
        const candidate = write;
        if (candidate.model !== "account" || !hasPassword(candidate.update)) {
          return adapter.updateMany(write);
        }
        const userId = whereValue(candidate, "userId");
        const providerId = whereValue(candidate, "providerId");
        if (!userId || providerId !== "credential") {
          return adapter.updateMany(write);
        }
        return runInTransaction(async (transactionAdapter, transaction) => {
          const before = await transactionAdapter.findOne({
            model: "account",
            where: write.where,
          });
          const updated = await transactionAdapter.updateMany(write);
          if (updated === 0) return updated;
          const credential = credentialPassword(before);
          if (
            credential === null ||
            credential.password === candidate.update.password
          ) {
            return updated;
          }
          await dependencies.writer.insertPasswordChanged(transaction, {
            ...notificationIds("password-reset"),
            occurredAt: new Date(),
            userId: credential.userId,
          });
          return updated;
        });
      }) as Adapter["updateMany"];
      const remove = (async (write) => {
        const active = tx ? null : requestAdapter.getStore();
        if (active) return active.delete(write);
        if (!adapterWrite(write)) return adapter.delete(write);
        const candidate = write;
        const scope = mfaRequest.getStore();
        if (
          candidate.model === "session" &&
          scope?.deferredUserFlag !== null &&
          scope !== undefined
        ) {
          scope.deferredSessionDeletes.push(candidate);
          return undefined;
        }
        if (candidate.model !== "twoFactor") return adapter.delete(write);
        return runInTransaction(async (transactionAdapter, transaction) => {
          const before = await transactionAdapter.findOne({
            model: "twoFactor",
            where: write.where,
          });
          const beforeUserId = twoFactorUserId(before);
          if (beforeUserId) {
            await dependencies.writer.initializeMfaState(transaction, {
              userId: beforeUserId,
            });
          }
          const scope = mfaRequest.getStore();
          const deferred = scope?.deferredUserFlag;
          if (deferred && beforeUserId) {
            if (whereValue(deferred, "id") !== beforeUserId) {
              throw new Error("MFA user update did not match two-factor user");
            }
            scope.deferredUserFlag = null;
            await transactionAdapter.update(
              deferred as Parameters<Adapter["update"]>[0],
            );
          }
          for (const sessionDelete of scope?.deferredSessionDeletes ?? []) {
            await transactionAdapter.delete(
              sessionDelete as Parameters<Adapter["delete"]>[0],
            );
          }
          await transactionAdapter.delete(write);
          if (!beforeUserId) return;
          await dependencies.writer.recordMfaTransition(transaction, {
            ...notificationIds("mfa-disable"),
            occurredAt: new Date(),
            transition: "disabled",
            userId: beforeUserId,
          });
        });
      }) as Adapter["delete"];
      const deleteMany = (async (write) => {
        const active = tx ? null : requestAdapter.getStore();
        if (active) return active.deleteMany(write);
        if (!adapterWrite(write)) return adapter.deleteMany(write);
        const candidate = write;
        const scope = mfaRequest.getStore();
        if (candidate.model !== "twoFactor" || !scope) {
          return adapter.deleteMany(write);
        }
        if (scope.deferredTwoFactorDelete !== null) {
          throw new Error(
            "MFA request attempted multiple two-factor deletions",
          );
        }
        if (whereValue(candidate, "userId") === null) {
          throw new Error("MFA two-factor deletion required user id");
        }
        scope.deferredTwoFactorDelete = candidate;
        return 0;
      }) as Adapter["deleteMany"];
      const findOne = (async (write) => {
        const active = tx ? null : requestAdapter.getStore();
        if (active) return active.findOne(write);
        return adapter.findOne(write);
      }) as Adapter["findOne"];
      const wrapped: OriginAdapter = {
        ...adapter,
        create,
        update,
        updateMany,
        delete: remove,
        deleteMany,
        findOne,
      };
      if (tx === null && "transaction" in wrapped) {
        wrapped.transaction = <T>(
          callback: (transactionAdapter: TransactionAdapter) => Promise<T>,
        ) =>
          dependencies.transaction((transaction) => {
            const transactionAdapter = wrap(
              dependencies.transactionAdapter(transaction, options),
              transaction,
            ) as TransactionAdapter;
            return requestAdapter.run(transactionAdapter, () =>
              callback(transactionAdapter),
            );
          });
      }
      return wrapped as Adapter;
    };
    const root = wrap(factory(options), null);
    dependencies.onMfaRequestReady?.((callback) => {
      const scope: MfaRequestScope = {
        deferredSessionDeletes: [],
        deferredTwoFactorDelete: null,
        deferredUserFlag: null,
      };
      return mfaRequest.run(scope, async () => {
        const result = await callback();
        if (scope.deferredTwoFactorDelete !== null) {
          throw new Error("MFA two-factor deletion had no replacement");
        }
        return result;
      });
    });
    return root;
  };
}
