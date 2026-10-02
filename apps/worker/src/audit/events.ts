import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditCategory,
  type AuditChange,
} from "@nightwatch/api-contract";
import type { withTenantUserContextRaw } from "@nightwatch/db";

import { FORMER_MEMBER_LABEL, type ExportEvent } from "./file";

/** The connection a tenant transaction hands to its callback. */
export type TenantClient = Parameters<
  Parameters<typeof withTenantUserContextRaw>[3]
>[0];

export type ExportFilters = {
  from: string;
  to: string;
  categories?: AuditCategory[];
  actorUserId?: string | null;
  q?: string | null;
};

export const EXPORT_BATCH_SIZE = 1000;

const SEARCH_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function actionCodesMatching(q: string): string[] {
  const needle = q.toLowerCase();
  return AUDIT_ACTIONS.filter(
    (code) =>
      code.toLowerCase().includes(needle) ||
      AUDIT_ACTION_LABELS[code].toLowerCase().includes(needle),
  );
}

export type BatchCursor = { occurredAt: string; id: string };

type BatchRow = {
  id: string;
  occurredAtUtc: string;
  cursorAt: string;
  actorRole: string;
  category: AuditCategory;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  targetAttributes: Record<string, unknown>;
  changes: AuditChange[];
  actorName: string | null;
  actorCurrent: boolean;
  targetName: string | null;
  targetCurrent: boolean;
  monitorExists: boolean;
};

function targetLabel(row: BatchRow): string {
  switch (row.targetType) {
    case "monitor":
      return row.monitorExists && row.targetName ? row.targetName : "ถูกลบแล้ว";
    case "member":
      return row.targetCurrent && row.targetName
        ? row.targetName
        : FORMER_MEMBER_LABEL;
    case "invitation": {
      const role =
        typeof row.targetAttributes.role === "string"
          ? row.targetAttributes.role
          : "";
      return `คำเชิญ role ${role} (${row.targetId ?? ""})`;
    }
    case "audit_export":
      return row.targetAttributes.format === "json"
        ? "ไฟล์ส่งออก JSON"
        : "ไฟล์ส่งออก CSV";
    default:
      return "การตั้งค่าการแจ้งเตือน";
  }
}

function toExportEvent(row: BatchRow): ExportEvent {
  return {
    id: row.id,
    occurredAt: row.occurredAtUtc,
    actor: {
      displayName: row.actorCurrent ? row.actorName : null,
      roleAtTime: row.actorRole,
      membership: row.actorCurrent ? "current" : "former",
    },
    action: row.action,
    category: row.category,
    target: targetLabel(row),
    changes: row.changes,
  };
}

/**
 * The next batch of events for one export, newest first. The predicate is the
 * list API's: the window is the later of `from`, 365 days before this
 * statement and the recording start, up to the earlier of `to` and the
 * snapshot; names are those of current members only, and email is never read.
 */
export async function readEventBatch(
  client: TenantClient,
  input: {
    tenantId: string;
    filters: ExportFilters;
    snapshotAt: Date;
    cursor: BatchCursor | null;
    limit?: number;
  },
): Promise<{ events: ExportEvent[]; next: BatchCursor | null }> {
  const { filters } = input;
  const q = filters.q ?? null;
  const limit = input.limit ?? EXPORT_BATCH_SIZE;
  const result = await client.query<BatchRow>(
    `select e.id,
            to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              as "occurredAtUtc",
            e.occurred_at::text as "cursorAt",
            e.actor_role as "actorRole", e.category, e.action,
            e.target_type as "targetType", e.target_id as "targetId",
            e.target_attributes as "targetAttributes", e.changes,
            au.name as "actorName", (am.user_id is not null) as "actorCurrent",
            coalesce(mo.name, tu.name) as "targetName",
            (tm.user_id is not null) as "targetCurrent",
            (mo.id is not null) as "monitorExists"
     from audit_events e
     join organization o on o.id = e.tenant_id
     left join member am on am.organization_id = $1 and am.user_id = e.actor_user_id
     left join "user" au on au.id = am.user_id
     left join monitors mo on e.target_type = 'monitor'
       and mo.tenant_id = $1 and mo.id::text = e.target_id
     left join member tm on e.target_type = 'member'
       and tm.organization_id = $1 and tm.user_id = e.target_id
     left join "user" tu on tu.id = tm.user_id
     where e.tenant_id = $1
       and e.occurred_at >= greatest(
         $2::timestamptz, now() - interval '365 days', o.audit_recording_started_at)
       and e.occurred_at <= least($3::timestamptz, $4::timestamptz)
       and (cardinality($5::text[]) = 0 or e.category = any($5::text[]))
       and ($6::text is null or e.actor_user_id = $6::text)
       and ($7::text is null
         or e.action = any($8::text[])
         or au.name ilike $7::text
         or coalesce(mo.name, tu.name) ilike $7::text
         or ($9::uuid is not null
             and (e.id = $9::uuid
                  or (e.target_type = 'invitation' and e.target_id = $9::uuid::text))))
       and ($10::timestamptz is null
         or (e.occurred_at, e.id) < ($10::timestamptz, $11::uuid))
     order by e.occurred_at desc, e.id desc
     limit $12`,
    [
      input.tenantId,
      filters.from,
      filters.to,
      input.snapshotAt,
      filters.categories ?? [],
      filters.actorUserId ?? null,
      q === null ? null : `%${escapeLike(q)}%`,
      q === null ? null : actionCodesMatching(q),
      q !== null && SEARCH_UUID.test(q) ? q.toLowerCase() : null,
      input.cursor?.occurredAt ?? null,
      input.cursor?.id ?? null,
      limit,
    ],
  );
  const last = result.rows.at(-1);
  return {
    events: result.rows.map(toExportEvent),
    next:
      result.rows.length === limit && last
        ? { occurredAt: last.cursorAt, id: last.id }
        : null,
  };
}
