import { APIError } from "better-auth/api";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DBAdapter, DBTransactionAdapter } from "better-auth/types";

/**
 * Concurrent invitation acceptance (SEC-005/QA-9, SEC-C4-001/QA-C4-01).
 *
 * Drizzle 1.6.23's incrementOne selects an id in a subquery, which can
 * become stale while waiting on a concurrent acceptance. For status-only
 * invitation mutations bounded by one id, update keeps the entire guard
 * on the target row so losers cannot roll an accepted invitation back.
 *
 * The separate member-uniqueness fallback translates only SQLSTATE 23505
 * for member_organization_user_key, including DrizzleQueryError causes,
 * into the native denial. Every unrelated database error stays visible.
 */

/** SQL unique constraint making one-membership-per-(organization,user). */
export const MEMBER_UNIQUENESS_CONSTRAINT = "member_organization_user_key";

/** Native denial every non-winning acceptance already receives. */
const MEMBER_RACE_DENIAL_MESSAGE = "Invitation not found";

/** Cause chains from driver wrappers are shallow; bound the walk. */
const CAUSE_CHAIN_LIMIT = 8;

/** First object in the cause chain carrying a database error `code`. */
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

/**
 * Rethrow `error`: the proven member-uniqueness race becomes the native
 * Better Auth denial (which Better Call renders as a 400 response);
 * everything else is rethrown unchanged. Never returns.
 */
export function translateMemberUniquenessRace(error: unknown): never {
  if (isMemberUniquenessRace(error)) {
    throw new APIError("BAD_REQUEST", {
      message: MEMBER_RACE_DENIAL_MESSAGE,
    });
  }
  throw error;
}

type AdapterFactory = ReturnType<typeof drizzleAdapter>;
/** Core adapter contract produced by the factory wrapper. */
type Adapter = DBAdapter;
/** Transaction-scoped adapter the core hands to `transaction` callbacks. */
type TransactionAdapter = DBTransactionAdapter;

function wrapAdapter(adapter: Adapter | TransactionAdapter): Adapter {
  const create = ((data: never) =>
    adapter
      .create(data)
      .catch((error: unknown) =>
        translateMemberUniquenessRace(error),
      )) as unknown as Adapter["create"];
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
  // Inside Better Auth transactions the core adapter hands out a
  // transaction-scoped adapter; wrap it too so claim prevention and
  // member-uniqueness translation hold on every transaction path.
  // Factory adapters always carry `transaction` (real or run-as-is);
  // presence is a narrowing concern, not a truthiness one.
  if ("transaction" in wrapped) {
    const transaction = wrapped.transaction;
    wrapped.transaction = <R>(
      callback: (trx: TransactionAdapter) => Promise<R>,
    ): Promise<R> => transaction((trx) => callback(wrapAdapter(trx)));
  }
  return wrapped as Adapter;
}

/**
 * Wrap a Better Auth adapter factory (e.g. drizzleAdapter(...)) to prevent
 * stale invitation claims and translate the proven member-insert race.
 * Other mutations, including all numeric increments, pass through.
 */
export function withMemberRaceTranslation(
  factory: AdapterFactory,
): AdapterFactory {
  return (options) => wrapAdapter(factory(options));
}
