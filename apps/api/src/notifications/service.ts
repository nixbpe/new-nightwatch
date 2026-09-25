import type {
  MarkAllReadResponse,
  MarkReadResponse,
  NotificationDetail,
  NotificationItem,
  NotificationListResponse,
} from "@nightwatch/api-contract";
import {
  withAccountContextRaw,
  withTenantContextRaw,
  type Database,
} from "@nightwatch/db";
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
  const lockedMirror = await client.query<{
    organizationId: string | null;
  }>(
    `select last_active_tenant_id as "organizationId"
     from "user" where id = $1 for update`,
    [userId],
  );
  if (lockedMirror.rows[0]?.organizationId !== organizationId) return null;
  if (membership.rows.length > 0) return { userId, organizationId };
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

async function resolveActiveScope(
  database: Database,
  userId: string,
): Promise<ActiveScope> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await database.sql.connect();
    try {
      await client.query("begin");
      const scope = await resolveActiveScopeOnClient(client, userId);
      if (!scope) {
        await client.query("rollback");
        continue;
      }
      await client.query("commit");
      return scope;
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
  database: Database,
  userId: string,
  anchor: { occurredAt: string; id: string } | undefined,
  limit: number,
): Promise<InboxRow[]> {
  const values = anchor
    ? [userId, anchor.occurredAt, anchor.id, limit]
    : [userId, limit];
  const keyset = anchor ? "and (occurred_at, id) < ($2, $3)" : "";
  const limitParameter = anchor ? "$4" : "$2";
  return withAccountContextRaw(database, userId, (client) =>
    client
      .query<InboxRow>(
        `select ${itemFields} from notification_inbox_items
         where scope_kind = 'account' and recipient_user_id = $1
           and expires_at > now() ${completedDispatch} ${keyset}
         order by occurred_at desc, id desc limit ${limitParameter}`,
        values,
      )
      .then((result) => result.rows),
  );
}

async function tenantRows(
  database: Database,
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
  return withTenantContextRaw(database, scope.organizationId, (client) =>
    client
      .query<InboxRow>(
        `select ${itemFields} from notification_inbox_items
         where scope_kind = 'tenant' and tenant_id = $1 and recipient_user_id = $2
           and exists (select 1 from member where organization_id = $1 and user_id = $2)
           and expires_at > now() ${completedDispatch} ${keyset}
         order by occurred_at desc, id desc limit ${limitParameter}`,
        values,
      )
      .then((result) => result.rows),
  );
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
  const scope = await resolveActiveScope(deps.database, input.userId);
  let anchor: { occurredAt: string; id: string } | undefined;
  if (input.cursor) {
    try {
      anchor = parseNotificationCursor({
        secret: deps.cursorSecret,
        scope: { ...scope, limit: input.limit },
        cursor: input.cursor,
      });
    } catch {
      throw new AppError(400, "INVALID_CURSOR", "Invalid notification cursor");
    }
  }
  const [account, tenant, unreadCount] = await Promise.all([
    accountRows(deps.database, scope.userId, anchor, input.limit + 1),
    tenantRows(deps.database, scope, anchor, input.limit + 1),
    countUnreadInScope(deps.database, scope),
  ]);
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
  };
}

async function countUnreadInScope(
  database: Database,
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
  const account = await withAccountContextRaw(
    database,
    scope.userId,
    (client) => count(client, [scope.userId]),
  );
  const tenant = scope.organizationId
    ? await withTenantContextRaw(database, scope.organizationId, (client) =>
        count(client, [scope.userId, scope.organizationId]),
      )
    : 0;
  return account + tenant;
}

export async function countUnreadInbox(
  deps: InboxServiceDeps,
  input: { userId: string; sessionToken: string },
): Promise<number> {
  const scope = await resolveActiveScope(deps.database, input.userId);
  return countUnreadInScope(deps.database, scope);
}

async function updateVisibleItem(
  database: Database,
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
  const account = await withAccountContextRaw(
    database,
    scope.userId,
    (client) => update(client, [itemId, scope.userId]),
  );
  if (account || !scope.organizationId) return account;
  return withTenantContextRaw(database, scope.organizationId, (client) =>
    update(client, [itemId, scope.userId, scope.organizationId]),
  );
}

export async function openInboxItem(
  deps: InboxServiceDeps,
  input: { userId: string; sessionToken: string; itemId: string },
): Promise<NotificationDetail> {
  const scope = await resolveActiveScope(deps.database, input.userId);
  const row = await updateVisibleItem(deps.database, scope, input.itemId);
  if (!row)
    throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  return toItem(row);
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
  input: { userId: string; sessionToken: string },
): Promise<MarkAllReadResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await deps.database.sql.connect();
    try {
      await client.query("begin");
      const scope = await resolveActiveScopeOnClient(client, input.userId);
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
      await client.query("commit");
      return { markedCount: result.rowCount ?? 0 };
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
