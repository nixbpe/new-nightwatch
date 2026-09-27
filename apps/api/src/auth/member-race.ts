import { APIError } from "better-auth/api";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DBAdapter, DBTransactionAdapter } from "better-auth/types";

export const MEMBER_UNIQUENESS_CONSTRAINT = "member_organization_user_key";

// The same native denial every losing concurrent acceptance receives.
const MEMBER_RACE_DENIAL_MESSAGE = "Invitation not found";

const CAUSE_CHAIN_LIMIT = 8;

function findDatabaseError(
  error: unknown,
): { code?: unknown; constraint?: unknown } | null {
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_CHAIN_LIMIT; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return null;
}

export function isMemberUniquenessRace(error: unknown): boolean {
  const violation = findDatabaseError(error);
  return (
    violation !== null &&
    violation.code === "23505" &&
    violation.constraint === MEMBER_UNIQUENESS_CONSTRAINT
  );
}

// Only the member-uniqueness race becomes the 400 denial; others stay visible.
export function translateMemberUniquenessRace(error: unknown): never {
  if (isMemberUniquenessRace(error)) {
    throw new APIError("BAD_REQUEST", {
      message: MEMBER_RACE_DENIAL_MESSAGE,
    });
  }
  throw error;
}

type AdapterFactory = ReturnType<typeof drizzleAdapter>;
type Adapter = DBAdapter;
type TransactionAdapter = DBTransactionAdapter;

function wrapAdapter(adapter: Adapter | TransactionAdapter): Adapter {
  const create = ((data: never) =>
    adapter
      .create(data)
      .catch((error: unknown) =>
        translateMemberUniquenessRace(error),
      )) as unknown as Adapter["create"];
  // Better Auth 1.6.23's drizzle incrementOne selects the id in a subquery that
  // can go stale behind a concurrent accept; a single-id status update keeps
  // the guard on the row itself.
  const incrementOne: Adapter["incrementOne"] = <T>(
    data: Parameters<Adapter["incrementOne"]>[0],
  ): Promise<T | null> => {
    if (
      data.model === "invitation" &&
      Object.keys(data.increment).length === 0 &&
      data.set !== undefined &&
      Object.keys(data.set).length === 1 &&
      Object.hasOwn(data.set, "status") &&
      typeof data.set.status === "string" &&
      data.where.every(
        (clause) =>
          clause.connector === undefined || clause.connector === "AND",
      ) &&
      data.where.some(
        (clause) =>
          clause.field === "id" &&
          (clause.operator === undefined || clause.operator === "eq") &&
          (clause.mode === undefined || clause.mode === "sensitive") &&
          (typeof clause.value === "string" ||
            typeof clause.value === "number"),
      )
    ) {
      return adapter.update<T>({
        model: data.model,
        where: data.where,
        update: data.set,
      });
    }
    return adapter.incrementOne<T>(data);
  };
  const wrapped: Adapter | TransactionAdapter = {
    ...adapter,
    create,
    incrementOne,
  };
  // Wrap transaction-scoped adapters too so the guards hold on every path.
  if ("transaction" in wrapped) {
    const transaction = wrapped.transaction;
    wrapped.transaction = <R>(
      callback: (trx: TransactionAdapter) => Promise<R>,
    ): Promise<R> => transaction((trx) => callback(wrapAdapter(trx)));
  }
  return wrapped as Adapter;
}

export function withMemberRaceTranslation(
  factory: AdapterFactory,
): AdapterFactory {
  return (options) => wrapAdapter(factory(options));
}
