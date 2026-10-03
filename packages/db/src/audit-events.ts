import type { PoolClient } from "pg";

// The one definition of "which audit events does this filter select". The list
// API and the export read the events through it, so a file always holds the rows
// the page shows for the same filters. Callers own the window (`retainedFrom`
// and `asOf` expressions) and the gate that decides who may read.

export type AuditEventFilter = {
  from?: string | null | undefined;
  to?: string | null | undefined;
  categories?: readonly string[] | null | undefined;
  actorUserId?: string | null | undefined;
  q?: string | null | undefined;
};

const SEARCH_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Names come from current members only (a removed member or account has none)
 * and email is never selected. `$1` is the organization id.
 */
export const AUDIT_EVENT_JOINS = `
  left join member am on am.organization_id = $1 and am.user_id = e.actor_user_id
  left join "user" au on au.id = am.user_id
  left join monitors mo on e.target_type = 'monitor'
    and mo.tenant_id = $1 and mo.id::text = e.target_id
  left join member tm on e.target_type = 'member'
    and tm.organization_id = $1 and tm.user_id = e.target_id
  left join "user" tu on tu.id = tm.user_id`;

export const AUDIT_EVENT_COLUMNS = `
  e.id, e.occurred_at as "occurredAt", e.actor_user_id as "actorUserId",
  e.actor_role as "actorRole", e.category, e.action,
  e.target_type as "targetType", e.target_id as "targetId",
  e.target_attributes as "targetAttributes",
  au.name as "actorName", (am.user_id is not null) as "actorCurrent",
  coalesce(mo.name, tu.name) as "targetName",
  (tm.user_id is not null) as "targetCurrent",
  (mo.id is not null) as "monitorExists"`;

/**
 * The seven values of `auditEventFilterWhere`, in order. `actionCodes` are the
 * action codes whose code or label contains `q` (the caller knows the labels).
 */
export function auditEventFilterParams(
  filter: AuditEventFilter,
  actionCodes: readonly string[],
): unknown[] {
  const q = filter.q ?? null;
  return [
    filter.from ?? null,
    filter.to ?? null,
    filter.categories && filter.categories.length > 0
      ? filter.categories
      : null,
    filter.actorUserId ?? null,
    q === null ? null : `%${escapeLike(q)}%`,
    q === null ? null : actionCodes,
    q !== null && SEARCH_UUID.test(q) ? q.toLowerCase() : null,
  ];
}

/**
 * The WHERE conditions (without `where`/`and`) for events `e` joined with
 * AUDIT_EVENT_JOINS. The seven filter values start at parameter `first`.
 * `retainedFrom` and `asOf` are SQL expressions for the window's ends.
 */
export function auditEventFilterWhere(
  first: number,
  bounds: { retainedFrom: string; asOf: string },
): string {
  const at = (offset: number) => `$${String(first + offset)}`;
  const [from, to, categories, actor, pattern, codes, uuid] = [
    at(0),
    at(1),
    at(2),
    at(3),
    at(4),
    at(5),
    at(6),
  ];
  return `
    e.occurred_at >= greatest(
      coalesce(${from}::timestamptz, '-infinity'::timestamptz), ${bounds.retainedFrom})
    and e.occurred_at <= least(
      coalesce(${to}::timestamptz, 'infinity'::timestamptz), ${bounds.asOf})
    and (${categories}::text[] is null or e.category = any(${categories}::text[]))
    and (${actor}::text is null or e.actor_user_id = ${actor}::text)
    and (${pattern}::text is null
      or e.action = any(${codes}::text[])
      or au.name ilike ${pattern}::text
      or coalesce(mo.name, tu.name) ilike ${pattern}::text
      or (${uuid}::uuid is not null
          and (e.id = ${uuid}::uuid
               or (e.target_type = 'invitation' and e.target_id = ${uuid}::uuid::text))))`;
}

export type AuditEventBatchCursor = { occurredAt: string; id: string };

export type AuditEventBatchRow = {
  id: string;
  occurredAtUtc: string;
  cursorAt: string;
  actorUserId: string;
  actorRole: string;
  category: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetAttributes: Record<string, unknown>;
  changes: unknown[];
  actorName: string | null;
  actorCurrent: boolean;
  targetName: string | null;
  targetCurrent: boolean;
  monitorExists: boolean;
};

/**
 * The next batch of one export, newest first, keyset-paged. The window runs
 * from the later of `from` and `retainedFrom` up to the earlier of `to` and
 * `snapshotAt`. The caller computes `retainedFrom` (365 days back, or the
 * recording start if later) once when generation starts and passes the same
 * value to every batch, so a row near the boundary cannot be in one batch's
 * window and out of the next. Call it inside a transaction whose tenant
 * context matches `tenantId`.
 */
export async function readAuditEventBatch(
  client: Pick<PoolClient, "query">,
  input: {
    tenantId: string;
    filter: AuditEventFilter;
    actionCodes: readonly string[];
    /** The lower end of the window, fixed once per export (see below). */
    retainedFrom: Date;
    snapshotAt: Date;
    cursor: AuditEventBatchCursor | null;
    limit: number;
  },
): Promise<{ rows: AuditEventBatchRow[]; next: AuditEventBatchCursor | null }> {
  const filterWhere = auditEventFilterWhere(2, {
    retainedFrom: "$13::timestamptz",
    asOf: "$9::timestamptz",
  });
  const result = await client.query<AuditEventBatchRow>(
    `select ${AUDIT_EVENT_COLUMNS}, e.changes,
            to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              as "occurredAtUtc",
            e.occurred_at::text as "cursorAt"
     from audit_events e
     ${AUDIT_EVENT_JOINS}
     where e.tenant_id = $1
       and ${filterWhere}
       and ($10::timestamptz is null
         or (e.occurred_at, e.id) < ($10::timestamptz, $11::uuid))
     order by e.occurred_at desc, e.id desc
     limit $12`,
    [
      input.tenantId,
      ...auditEventFilterParams(input.filter, input.actionCodes),
      input.snapshotAt,
      input.cursor?.occurredAt ?? null,
      input.cursor?.id ?? null,
      input.limit,
      input.retainedFrom,
    ],
  );
  const last = result.rows.at(-1);
  return {
    rows: result.rows,
    next:
      result.rows.length === input.limit && last
        ? { occurredAt: last.cursorAt, id: last.id }
        : null,
  };
}
