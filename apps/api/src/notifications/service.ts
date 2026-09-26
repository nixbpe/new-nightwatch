import type {
  MarkAllReadResponse,
  MarkReadResponse,
  NotificationDetail,
  NotificationItem,
  NotificationCountResponse,
  NotificationListResponse,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { createNotificationCursor, parseNotificationCursor } from "./cursor";

type ActiveScope = { userId: string; organizationId: string | null };
type InboxRow = {
  id: string;
  scopeKind: "account" | "tenant";
  tenantId: string | null;
  eventType: NotificationItem["eventType"];
  occurredAt: Date | string;
  cursorOccurredAt: string;
  readAt: Date | string | null;
  actorDisplayName: string | null;
};

type InboxServiceDeps = { database: Database; cursorSecret: string };

function toIsoDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toItem(row: InboxRow): NotificationItem {
  const occurredAt = toIsoDate(row.occurredAt);
  const readAt = row.readAt === null ? null : toIsoDate(row.readAt);
  if (row.scopeKind === "account") {
    if (
      row.eventType !== "PASSWORD_CHANGED" &&
      row.eventType !== "MFA_ENABLED" &&
      row.eventType !== "MFA_DISABLED"
    ) {
      throw new Error("invalid account notification event type");
    }
    return {
      id: row.id,
      scope: "account",
      organizationId: null,
      eventType: row.eventType,
      occurredAt,
      readAt,
      actor: null,
      category: null,
    };
  }
  if (!row.tenantId)
    throw new Error("organization notification requires tenant");
  return {
    id: row.id,
    scope: "organization",
    organizationId: row.tenantId,
    eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED",
    occurredAt,
    readAt,
    actor: { displayName: row.actorDisplayName ?? "Unknown actor" },
    category: "notification-settings",
  };
}

async function resolveActiveScopeOnClient(
  client: PoolClient,
  userId: string,
): Promise<ActiveScope | null> {
  const mirror = await client.query<{ organizationId: string | null }>(
    `select last_active_tenant_id as "organizationId"
     from "user" where id = $1`,
    [userId],
  );
  const organizationId = mirror.rows[0]?.organizationId ?? null;
  if (!organizationId) {
    const lockedMirror = await client.query<{
      organizationId: string | null;
    }>(
      `select last_active_tenant_id as "organizationId"
       from "user" where id = $1 for update`,
      [userId],
    );
    if ((lockedMirror.rows[0]?.organizationId ?? null) !== null) return null;
    await client.query(
      `update session set active_organization_id = null
       where user_id = $1 and active_organization_id is not null`,
      [userId],
    );
    return { userId, organizationId: null };
  }

  // Actor-scoped membership lookup before any organization lock (ORG-02):
  // a former member with a stale mirror never contends on that
  // organization's locks. A current member is rechecked under the locks.
  const preMembership = await client.query(
    `select 1 from member where organization_id = $1 and user_id = $2`,
    [organizationId, userId],
  );
  let isMember = false;
  if (preMembership.rows.length > 0) {
    await client.query("select id from organization where id = $1 for share", [
      organizationId,
    ]);
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `notification-membership:${organizationId}`,
    ]);
    const membership = await client.query(
      `select 1 from member
       where organization_id = $1 and user_id = $2 for update`,
      [organizationId, userId],
    );
    isMember = membership.rows.length > 0;
  }
  const lockedMirror = await client.query<{
    organizationId: string | null;
  }>(
    `select last_active_tenant_id as "organizationId"
     from "user" where id = $1 for update`,
    [userId],
  );
  if (lockedMirror.rows[0]?.organizationId !== organizationId) return null;
  if (isMember) return { userId, organizationId };
  await client.query(
    `update "user" set last_active_tenant_id = null, updated_at = now()
     where id = $1 and last_active_tenant_id = $2`,
    [userId, organizationId],
  );
  await client.query(
    `update session set active_organization_id = null
     where user_id = $1 and active_organization_id = $2`,
    [userId, organizationId],
  );
  return { userId, organizationId: null };
}

/**
 * Resolves the active scope and runs `fn` in the SAME transaction. The
 * resolver holds the user row FOR UPDATE, which an organization switch also
 * updates, so a switch cannot commit between scope resolution and the read
 * or mutation: every response reflects one consistent scope.
 */
async function withResolvedScope<T>(
  database: Database,
  userId: string,
  fn: (client: PoolClient, scope: ActiveScope) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await database.sql.connect();
    try {
      await client.query("begin");
      const scope = await resolveActiveScopeOnClient(client, userId);
      if (!scope) {
        await client.query("rollback");
        continue;
      }
      await client.query("select set_config('app.user_id', $1, true)", [
        scope.userId,
      ]);
      if (scope.organizationId) {
        await client.query("select set_config('app.tenant_id', $1, true)", [
          scope.organizationId,
        ]);
      }
      const result = await fn(client, scope);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  throw new AppError(
    500,
    "INTERNAL_ERROR",
    "Unable to resolve notification scope",
  );
}

const itemFields = `
  id, scope_kind as "scopeKind", tenant_id as "tenantId", event_type as "eventType",
  occurred_at as "occurredAt",
  to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorOccurredAt",
  read_at as "readAt", actor_display_name as "actorDisplayName"`;

const completedDispatch = `
  and exists (
    select 1 from notification_dispatch_ledger as d
    where d.intent_id = notification_inbox_items.intent_id
      and d.status = 'completed'
  )`;

async function accountRows(
  client: PoolClient,
  userId: string,
  anchor: { occurredAt: string; id: string } | undefined,
  limit: number,
): Promise<InboxRow[]> {
  const values = anchor
    ? [userId, anchor.occurredAt, anchor.id, limit]
    : [userId, limit];
  const keyset = anchor ? "and (occurred_at, id) < ($2, $3)" : "";
  const limitParameter = anchor ? "$4" : "$2";
  const result = await client.query<InboxRow>(
    `select ${itemFields} from notification_inbox_items
     where scope_kind = 'account' and recipient_user_id = $1
       and expires_at > now() ${completedDispatch} ${keyset}
     order by occurred_at desc, id desc limit ${limitParameter}`,
    values,
  );
  return result.rows;
}

async function tenantRows(
  client: PoolClient,
  scope: ActiveScope,
  anchor: { occurredAt: string; id: string } | undefined,
  limit: number,
): Promise<InboxRow[]> {
  if (!scope.organizationId) return [];
  const values = anchor
    ? [scope.organizationId, scope.userId, anchor.occurredAt, anchor.id, limit]
    : [scope.organizationId, scope.userId, limit];
  const keyset = anchor ? "and (occurred_at, id) < ($3, $4)" : "";
  const limitParameter = anchor ? "$5" : "$3";
  const result = await client.query<InboxRow>(
    `select ${itemFields} from notification_inbox_items
     where scope_kind = 'tenant' and tenant_id = $1 and recipient_user_id = $2
       and exists (select 1 from member where organization_id = $1 and user_id = $2)
       and expires_at > now() ${completedDispatch} ${keyset}
     order by occurred_at desc, id desc limit ${limitParameter}`,
    values,
  );
  return result.rows;
}

function compareRows(left: InboxRow, right: InboxRow): number {
  return (
    right.cursorOccurredAt.localeCompare(left.cursorOccurredAt) ||
    right.id.localeCompare(left.id)
  );
}

export async function listInbox(
  deps: InboxServiceDeps,
  input: {
    userId: string;
    sessionToken: string;
    limit: number;
    cursor?: string;
  },
): Promise<NotificationListResponse> {
  return withResolvedScope(
    deps.database,
    input.userId,
    async (client, scope) => {
      let anchor: { occurredAt: string; id: string } | undefined;
      if (input.cursor) {
        try {
          anchor = parseNotificationCursor({
            secret: deps.cursorSecret,
            scope: { ...scope, limit: input.limit },
            cursor: input.cursor,
          });
        } catch {
          throw new AppError(
            400,
            "INVALID_CURSOR",
            "Invalid notification cursor",
          );
        }
      }
      const account = await accountRows(
        client,
        scope.userId,
        anchor,
        input.limit + 1,
      );
      const tenant = await tenantRows(client, scope, anchor, input.limit + 1);
      const unreadCount = await countUnreadInScope(client, scope);
      const visible = [...account, ...tenant]
        .sort(compareRows)
        .slice(0, input.limit + 1);
      const page = visible.slice(0, input.limit);
      const last = page.at(-1);
      return {
        items: page.map(toItem),
        nextCursor:
          visible.length > input.limit && last
            ? createNotificationCursor({
                secret: deps.cursorSecret,
                scope: { ...scope, limit: input.limit },
                anchor: { occurredAt: last.cursorOccurredAt, id: last.id },
              })
            : null,
        unreadCount,
        organizationId: scope.organizationId,
      };
    },
  );
}

async function countUnreadInScope(
  client: PoolClient,
  scope: ActiveScope,
): Promise<number> {
  const count = async (client: PoolClient, values: unknown[]) =>
    client
      .query<{ count: string }>(
        `select count(*)::text as count from notification_inbox_items
         where recipient_user_id = $1 and expires_at > now() ${completedDispatch}
           and read_at is null ${values.length === 2 ? "and scope_kind = 'tenant' and tenant_id = $2 and exists (select 1 from member where organization_id = $2 and user_id = $1)" : "and scope_kind = 'account' and user_id = $1"}`,
        values,
      )
      .then((result) => Number(result.rows[0]?.count ?? 0));
  const account = await count(client, [scope.userId]);
  const tenant = scope.organizationId
    ? await count(client, [scope.userId, scope.organizationId])
    : 0;
  return account + tenant;
}

export async function countUnreadInbox(
  deps: InboxServiceDeps,
  input: { userId: string; sessionToken: string },
): Promise<NotificationCountResponse> {
  return withResolvedScope(
    deps.database,
    input.userId,
    async (client, scope) => ({
      unreadCount: await countUnreadInScope(client, scope),
      organizationId: scope.organizationId,
    }),
  );
}

async function updateVisibleItem(
  client: PoolClient,
  scope: ActiveScope,
  itemId: string,
): Promise<InboxRow | null> {
  const update = (client: PoolClient, values: unknown[]) =>
    client
      .query<InboxRow>(
        `update notification_inbox_items set read_at = coalesce(read_at, now())
         where id = $1 and recipient_user_id = $2
           and expires_at > now() ${completedDispatch} ${values.length === 3 ? "and scope_kind = 'tenant' and tenant_id = $3 and exists (select 1 from member where organization_id = $3 and user_id = $2)" : "and scope_kind = 'account' and user_id = $2"}
         returning ${itemFields}`,
        values,
      )
      .then((result) => result.rows[0] ?? null);
  const account = await update(client, [itemId, scope.userId]);
  if (account || !scope.organizationId) return account;
  return update(client, [itemId, scope.userId, scope.organizationId]);
}

export async function openInboxItem(
  deps: InboxServiceDeps,
  input: { userId: string; sessionToken: string; itemId: string },
): Promise<NotificationDetail> {
  return withResolvedScope(
    deps.database,
    input.userId,
    async (client, scope) => {
      const row = await updateVisibleItem(client, scope, input.itemId);
      if (!row)
        throw new AppError(
          404,
          "NOTIFICATION_NOT_FOUND",
          "Notification not found",
        );
      return toItem(row);
    },
  );
}

export async function markInboxItemRead(
  deps: InboxServiceDeps,
  input: { userId: string; sessionToken: string; itemId: string },
): Promise<MarkReadResponse> {
  const detail = await openInboxItem(deps, input);
  if (!detail.readAt) throw new Error("read transition returned no timestamp");
  return { id: detail.id, readAt: detail.readAt };
}

export async function markAllInboxRead(
  deps: InboxServiceDeps,
  input: {
    userId: string;
    sessionToken: string;
    expectedOrganizationId: string | null;
  },
): Promise<MarkAllReadResponse> {
  return withResolvedScope(
    deps.database,
    input.userId,
    async (client, scope) => {
      // Organization selection is account-global: another session may have
      // switched it since this client loaded. Never mark a scope the caller
      // did not see.
      if (scope.organizationId !== input.expectedOrganizationId) {
        throw new AppError(
          409,
          "INBOX_SCOPE_CHANGED",
          "องค์กรที่ใช้งานถูกเปลี่ยนแล้ว กรุณาโหลดใหม่",
        );
      }
      const result = await client.query(
        `update notification_inbox_items set read_at = now()
       where recipient_user_id = $1 and read_at is null
         and expires_at > now() ${completedDispatch}
         and (
           (scope_kind = 'account' and user_id = $1)
           or (
             $2::uuid is not null
             and scope_kind = 'tenant'
             and tenant_id = $2
             and exists (
               select 1 from member
               where organization_id = $2 and user_id = $1
             )
           )
         )`,
        [scope.userId, scope.organizationId],
      );
      return { markedCount: result.rowCount ?? 0 };
    },
  );
}
