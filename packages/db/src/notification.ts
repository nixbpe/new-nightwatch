import type { ExtractTablesWithRelations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import type { Database } from "./client";
import type { schema } from "./schema";

export type NotificationTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type AccountNotificationEventType =
  "PASSWORD_CHANGED" | "MFA_ENABLED" | "MFA_DISABLED";

type AccountNotificationIntentInput = {
  id: string;
  dispatchId: string;
  userId: string;
  origin: string;
  eventType: AccountNotificationEventType;
  occurredAt: Date;
};

type AccountMfaTransitionInput = Omit<
  AccountNotificationIntentInput,
  "eventType"
> & {
  transition: "enabled" | "disabled";
};

type AccountMfaStateInitializationInput = {
  userId: string;
};

export type NotificationDispatchClaim = {
  id: string;
  intentId: string;
  scopeKind: "tenant" | "account";
  tenantId: string | null;
  userId: string | null;
};

export type NotificationDispatchFailureReason =
  | "QUEUE_ADD_FAILED"
  | "QUEUE_ACK_FAILED"
  | "INVALID_SCOPE"
  | "MATERIALIZATION_EXHAUSTED";

/** Sets account RLS scope on an existing transaction; it never opens a pool
 * transaction and must receive the transaction that owns the auth mutation. */
export async function setAccountContext(
  tx: NotificationTransaction,
  userId: string,
): Promise<void> {
  assertNonEmpty(userId, "userId");
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
}

/**
 * Opens one account-scoped transaction and clears its context automatically on
 * commit/rollback. Every account-domain statement must use the supplied tx.
 */
export async function withAccountContext<T>(
  database: Database,
  userId: string,
  fn: (tx: NotificationTransaction) => Promise<T>,
): Promise<T> {
  assertNonEmpty(userId, "userId");
  return database.db.transaction(async (tx) => {
    await setAccountContext(tx, userId);
    return fn(tx);
  });
}

/** Account-scoped raw SQL on one pooled transaction. */
export async function withAccountContextRaw<T>(
  database: Database,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertNonEmpty(userId, "userId");
  const client = await database.sql.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Creates an idempotent ledger row on the caller's existing scoped transaction. */
export async function createNotificationDispatch(
  tx: NotificationTransaction,
  input: { id: string; intentId: string },
): Promise<void> {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.intentId, "intentId");
  await tx.execute(
    sql`select create_notification_dispatch(${input.id}, ${input.intentId})`,
  );
}
/**
 * Writes account intent, recipient snapshot, and dispatch ledger on the
 * caller's existing transaction. `origin` must be a stable business identity;
 * SQL uniqueness makes replay a no-op without touching a visible item's
 * read_at state.
 */
export async function insertAccountNotificationIntent(
  tx: NotificationTransaction,
  input: AccountNotificationIntentInput,
): Promise<string> {
  assertIntentInput(input);
  await setAccountContext(tx, input.userId);
  const intent = await tx.execute<{ id: string }>(sql`
    with inserted as (
      insert into notification_intents
        (id, scope_kind, user_id, origin, event_type, occurred_at)
      values
        (${input.id}, 'account', ${input.userId}, ${input.origin}, ${input.eventType}, ${input.occurredAt})
      on conflict (origin) do nothing
      returning id
    )
    select id from inserted
    union all
    select id from notification_intents where origin = ${input.origin}
    limit 1
  `);
  const intentId = intent.rows[0]?.id;
  if (!intentId) throw new Error("notification intent insert returned no id");

  await tx.execute(sql`
    insert into notification_intent_recipients
      (intent_id, origin, recipient_user_id, scope_kind, user_id)
    values
      (${intentId}, ${input.origin}, ${input.userId}, 'account', ${input.userId})
    on conflict (origin, recipient_user_id) do nothing
  `);
  await createNotificationDispatch(tx, {
    id: input.dispatchId,
    intentId,
  });
  return intentId;
}

/**
 * Serializes a native MFA source mutation with the applied backfill migration.
 * It locks user, then twoFactor, then the shared advisory key before recording
 * the pre-mutation effective state without emitting a historical intent.
 */
export async function initializeAccountMfaState(
  tx: NotificationTransaction,
  input: AccountMfaStateInitializationInput,
): Promise<{ verifiedEnabled: boolean }> {
  assertNonEmpty(input.userId, "userId");
  await setAccountContext(tx, input.userId);
  const user = await tx.execute<{ two_factor_enabled: boolean | null }>(sql`
    select two_factor_enabled
    from "user"
    where id = ${input.userId}
    for update
  `);
  const twoFactor = await tx.execute<{ verified: boolean }>(sql`
    select verified
    from "twoFactor"
    where user_id = ${input.userId}
    for update
  `);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`notification-mfa:${input.userId}`})::bigint)`,
  );
  const verifiedEnabled =
    user.rows[0]?.two_factor_enabled === true &&
    twoFactor.rows[0]?.verified === true;
  await tx.execute(sql`
    insert into notification_account_mfa_state (user_id, verified_enabled)
    values (${input.userId}, ${verifiedEnabled})
    on conflict (user_id) do nothing
  `);
  return { verifiedEnabled };
}
/**
 * Records an effective verified-MFA transition after Better Auth's qualifying
 * twoFactor write/delete. A transaction-scoped per-user advisory lock makes
 * projection initialization and re-enrollment deterministic.
 */
export async function recordAccountMfaTransition(
  tx: NotificationTransaction,
  input: AccountMfaTransitionInput,
): Promise<{ transitioned: boolean }> {
  assertIntentInput({ ...input, eventType: "MFA_ENABLED" });
  await setAccountContext(tx, input.userId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`notification-mfa:${input.userId}`})::bigint)`,
  );
  const state = await tx.execute<{ verified_enabled: boolean }>(sql`
    select verified_enabled
    from notification_account_mfa_state
    where user_id = ${input.userId}
    for update
  `);
  const previous = state.rows[0]?.verified_enabled ?? false;
  const verifiedEnabled = input.transition === "enabled";
  if (state.rows[0]) {
    await tx.execute(sql`
      update notification_account_mfa_state
      set verified_enabled = ${verifiedEnabled}, updated_at = now()
      where user_id = ${input.userId}
    `);
  } else {
    await tx.execute(sql`
      insert into notification_account_mfa_state (user_id, verified_enabled)
      values (${input.userId}, ${verifiedEnabled})
    `);
  }
  if (previous === verifiedEnabled) return { transitioned: false };

  await insertAccountNotificationIntent(tx, {
    ...input,
    eventType: verifiedEnabled ? "MFA_ENABLED" : "MFA_DISABLED",
  });
  return { transitioned: true };
}

export type MonitorNotificationEventType =
  | "MONITOR_DOWN"
  | "MONITOR_RECOVERED"
  | "MONITOR_SSL_CAUTION"
  | "MONITOR_SSL_DANGER"
  | "MONITOR_SSL_EXPIRED";

export type MonitorNotificationInput = {
  tenantId: string;
  monitorId: string;
  monitorName: string;
  eventType: MonitorNotificationEventType;
  /** Stable business identity; a replay with the same origin is a no-op. */
  origin: string;
  occurredAt: Date;
  reason: string | null;
  sslNotAfter: Date | null;
};

/**
 * Writes a monitor intent, its recipient snapshot (current owners and admins,
 * there is no actor to exclude) and the dispatch ledger row on the caller's
 * open tenant transaction, so the notification commits or rolls back with the
 * check result. Returns false when the origin already existed.
 */
export async function insertMonitorNotificationIntent(
  client: { query: PoolClient["query"] },
  input: MonitorNotificationInput,
): Promise<boolean> {
  assertNonEmpty(input.tenantId, "tenantId");
  assertNonEmpty(input.origin, "origin");
  const intentId = crypto.randomUUID();
  const inserted = await client.query(
    `insert into notification_intents
       (id, scope_kind, tenant_id, origin, event_type, occurred_at,
        subject_monitor_id, subject_monitor_name, monitor_reason, ssl_not_after)
     values ($1, 'tenant', $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (origin) do nothing
     returning id`,
    [
      intentId,
      input.tenantId,
      input.origin,
      input.eventType,
      input.occurredAt,
      input.monitorId,
      input.monitorName,
      input.reason,
      input.sslNotAfter,
    ],
  );
  if (inserted.rowCount === 0) return false;
  await client.query(
    `insert into notification_intent_recipients
       (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
     select $1, $2, member.user_id, 'tenant', $3
     from member
     where member.organization_id = $3
       and exists (
         select 1
         from unnest(string_to_array(member.role, ',')) as role_token(value)
         where btrim(role_token.value) in ('owner', 'admin')
       )
     on conflict (origin, recipient_user_id) do nothing`,
    [intentId, input.origin, input.tenantId],
  );
  await client.query("select create_notification_dispatch($1, $2)", [
    crypto.randomUUID(),
    intentId,
  ]);
  return true;
}

/**
 * Writes the one notification an audit export raises, on the caller's open
 * tenant transaction (so it commits or rolls back with the state change that
 * caused it). The only recipient is the requester, and only while they are
 * still a member: a requester who lost owner/admin still hears that the file
 * failed (P-07), one who left the Organization does not. The origin is unique
 * per export and outcome, so a repeated call writes nothing and returns false.
 */
export async function insertAuditExportNotificationIntent(
  client: { query: PoolClient["query"] },
  input: {
    tenantId: string;
    exportId: string;
    requesterUserId: string;
    outcome: "ready" | "failed";
  },
): Promise<boolean> {
  assertNonEmpty(input.tenantId, "tenantId");
  assertNonEmpty(input.requesterUserId, "requesterUserId");
  const stillMember = await client.query(
    "select 1 from member where organization_id = $1 and user_id = $2",
    [input.tenantId, input.requesterUserId],
  );
  if (stillMember.rowCount === 0) return false;
  const intentId = crypto.randomUUID();
  const origin = `audit-export:${input.exportId}:${input.outcome}`;
  const inserted = await client.query(
    `insert into notification_intents
       (id, scope_kind, tenant_id, origin, event_type, occurred_at,
        subject_audit_export_id)
     values ($1, 'tenant', $2, $3, $4, now(), $5)
     on conflict (origin) do nothing
     returning id`,
    [
      intentId,
      input.tenantId,
      origin,
      input.outcome === "ready" ? "AUDIT_EXPORT_READY" : "AUDIT_EXPORT_FAILED",
      input.exportId,
    ],
  );
  if (inserted.rowCount === 0) return false;
  await client.query(
    `insert into notification_intent_recipients
       (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
     values ($1, $2, $3, 'tenant', $4)`,
    [intentId, origin, input.requesterUserId, input.tenantId],
  );
  await client.query("select create_notification_dispatch($1, $2)", [
    crypto.randomUUID(),
    intentId,
  ]);
  return true;
}

/** Claims at most 100 ledger rows without granting account-domain discovery. */
export async function claimNotificationDispatches(
  database: Database,
  input: { claimToken: string; limit: number },
): Promise<NotificationDispatchClaim[]> {
  assertNonEmpty(input.claimToken, "claimToken");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("claim limit must be an integer between 1 and 100");
  }
  const result = await database.sql.query<{
    id: string;
    intent_id: string;
    scope_kind: "tenant" | "account";
    tenant_id: string | null;
    user_id: string | null;
  }>("select * from claim_notification_dispatches($1, $2)", [
    input.claimToken,
    input.limit,
  ]);
  return result.rows.map((row) => ({
    id: row.id,
    intentId: row.intent_id,
    scopeKind: row.scope_kind,
    tenantId: row.tenant_id,
    userId: row.user_id,
  }));
}

export async function requeueStaleNotificationDispatches(
  database: Database,
  input: { claimedBefore: Date; limit: number },
): Promise<string[]> {
  assertClaimLimit(input.limit);
  const result = await database.sql.query<{ id: string }>(
    "select * from requeue_stale_notification_dispatches($1, $2)",
    [input.claimedBefore, input.limit],
  );
  return result.rows.map((row) => row.id);
}

export async function markNotificationDispatchEnqueued(
  database: Database,
  input: { id: string; claimToken: string },
): Promise<boolean> {
  return updateDispatchStatus(
    database,
    "mark_notification_dispatch_enqueued",
    input,
  );
}

export async function failNotificationDispatch(
  database: Database,
  input: {
    id: string;
    claimToken: string;
    reason: NotificationDispatchFailureReason;
  },
): Promise<boolean> {
  assertDispatchToken(input);
  const result = await database.sql.query<{ updated: boolean }>(
    "select fail_notification_dispatch($1, $2, $3) as updated",
    [input.id, input.claimToken, input.reason],
  );
  return result.rows[0]?.updated === true;
}

export async function resolveNotificationDispatchClaim(
  database: Database,
  input: { id: string; claimToken: string },
): Promise<Omit<NotificationDispatchClaim, "id"> | null> {
  assertDispatchToken(input);
  const result = await database.sql.query<{
    intent_id: string;
    scope_kind: "tenant" | "account";
    tenant_id: string | null;
    user_id: string | null;
  }>("select * from resolve_notification_dispatch_claim($1, $2)", [
    input.id,
    input.claimToken,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    intentId: row.intent_id,
    scopeKind: row.scope_kind,
    tenantId: row.tenant_id,
    userId: row.user_id,
  };
}

export async function completeNotificationDispatch(
  database: Database,
  input: { id: string; claimToken: string },
): Promise<boolean> {
  return updateDispatchStatus(
    database,
    "complete_notification_dispatch",
    input,
  );
}

/** Deletes only already-expired inbox rows in a bounded worker batch. */
export async function purgeExpiredNotificationInboxItems(
  database: Database,
  input: { limit: number },
): Promise<string[]> {
  assertClaimLimit(input.limit);
  const result = await database.sql.query<{ id: string }>(
    "select * from purge_expired_notification_inbox_items($1)",
    [input.limit],
  );
  return result.rows.map((row) => row.id);
}

async function updateDispatchStatus(
  database: Database,
  functionName:
    | "mark_notification_dispatch_enqueued"
    | "fail_notification_dispatch"
    | "complete_notification_dispatch",
  input: { id: string; claimToken: string },
): Promise<boolean> {
  assertDispatchToken(input);
  const result = await database.sql.query<{ updated: boolean }>(
    `select ${functionName}($1, $2) as updated`,
    [input.id, input.claimToken],
  );
  return result.rows[0]?.updated === true;
}

function assertClaimLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("claim limit must be an integer between 1 and 100");
  }
}

function assertDispatchToken(input: { id: string; claimToken: string }): void {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.claimToken, "claimToken");
}

function assertIntentInput(input: AccountNotificationIntentInput): void {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.dispatchId, "dispatchId");
  assertNonEmpty(input.userId, "userId");
  assertNonEmpty(input.origin, "origin");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value) throw new Error(`${name} must not be empty`);
}
