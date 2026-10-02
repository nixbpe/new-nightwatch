import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  organizationRoleSchema,
  type AuditActorOption,
  type AuditCategory,
  type AuditChange,
  type AuditEventDetail,
  type AuditEventSummary,
  type AuditExportScope,
  type AuditLogActorsResponse,
  type AuditLogEventResponse,
  type AuditLogListQuery,
  type AuditLogListResponse,
  type AuditTarget,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { normalizeOrganizationRole } from "../me/service";

export type AuditReadIdentity = {
  organizationId: string;
  actorUserId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Membership, the normalized role and the read share one statement (one
// snapshot). Normalizing in SQL repeats `normalizeOrganizationRole`: the
// highest-priority valid token wins, so "viewer,auditor" is a viewer. The
// result is checked again in TypeScript before any row is returned, and the
// data CTEs return nothing unless the SQL role may read.
const GATE_CTES = `
  me as (
    select role from member where organization_id = $1 and user_id = $2
  ),
  gate as (
    select exists (select 1 from me) as member,
           (
             select token from (
               select btrim(t) as token
               from me, unnest(string_to_array(me.role, ',')) as t
             ) tokens
             where token in ('owner', 'admin', 'viewer', 'auditor')
             order by case token when 'owner' then 0 when 'admin' then 1
                                 when 'viewer' then 2 else 3 end
             limit 1
           ) as role,
           (select role from me) as "rawRole"
  ),
  allowed as (
    select (member and role in ('owner', 'admin', 'auditor')) as ok,
           member, "rawRole"
    from gate
  ),
  bounds as (
    select o.audit_recording_started_at as started,
           greatest(now() - interval '365 days', o.audit_recording_started_at)
             as retained_from,
           now() as db_now
    from organization o where o.id = $1
  )`;

type Gate = { member: boolean; ok: boolean; rawRole: string | null };

function assertAllowed(row: Gate): void {
  if (!row.member || row.rawRole === null) {
    throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
  }
  const role = normalizeOrganizationRole(row.rawRole);
  if (role === null) throw new Error("member has no recognized role");
  if (!row.ok || (role !== "owner" && role !== "admin" && role !== "auditor")) {
    throw new AppError(
      403,
      "PERMISSION_DENIED",
      "คุณไม่มีสิทธิ์ดูบันทึกกิจกรรม",
    );
  }
}

type EventRow = {
  id: string;
  occurredAt: string;
  actorUserId: string;
  actorRole: string;
  category: AuditCategory;
  action: AuditEventSummary["action"];
  targetType: AuditTarget["type"];
  targetId: string | null;
  targetAttributes: Record<string, unknown>;
  changes?: AuditChange[];
  actorName: string | null;
  actorCurrent: boolean;
  targetName: string | null;
  targetCurrent: boolean;
  monitorExists: boolean;
};

// Names are read from the current member rows only (OD-10, OD-16): a former
// member or a removed account yields no name. Email is never selected.
const EVENT_JOINS = `
  left join member am on am.organization_id = $1 and am.user_id = e.actor_user_id
  left join "user" au on au.id = am.user_id
  left join monitors mo on e.target_type = 'monitor'
    and mo.tenant_id = $1 and mo.id::text = e.target_id
  left join member tm on e.target_type = 'member'
    and tm.organization_id = $1 and tm.user_id = e.target_id
  left join "user" tu on tu.id = tm.user_id`;

const EVENT_COLUMNS = `
  e.id, e.occurred_at as "occurredAt", e.actor_user_id as "actorUserId",
  e.actor_role as "actorRole", e.category, e.action,
  e.target_type as "targetType", e.target_id as "targetId",
  e.target_attributes as "targetAttributes",
  au.name as "actorName", (am.user_id is not null) as "actorCurrent",
  coalesce(mo.name, tu.name) as "targetName",
  (tm.user_id is not null) as "targetCurrent",
  (mo.id is not null) as "monitorExists"`;

function actorOf(row: EventRow): AuditEventSummary["actor"] {
  const roleAtTime = organizationRoleSchema.parse(row.actorRole);
  return {
    userId: row.actorUserId,
    displayName: row.actorCurrent ? row.actorName : null,
    roleAtTime,
    membership: row.actorCurrent ? "current" : "former",
  };
}

function targetOf(row: EventRow): AuditTarget {
  const targetId = row.targetId ?? "";
  switch (row.targetType) {
    case "monitor":
      return {
        type: "monitor",
        monitorId: targetId,
        displayName: row.monitorExists ? row.targetName : null,
        deleted: !row.monitorExists,
      };
    case "member":
      return {
        type: "member",
        userId: targetId,
        displayName: row.targetCurrent ? row.targetName : null,
        membership: row.targetCurrent ? "current" : "former",
      };
    case "invitation":
      return {
        type: "invitation",
        publicId: targetId,
        role: organizationRoleSchema.parse(row.targetAttributes.role),
      };
    case "notification_settings":
      return { type: "notification_settings" };
    case "audit_export":
      return {
        type: "audit_export",
        exportId: targetId,
        format: row.targetAttributes.format === "json" ? "json" : "csv",
      };
  }
}

function summaryOf(row: EventRow): AuditEventSummary {
  return {
    id: row.id,
    occurredAt: new Date(row.occurredAt).toISOString(),
    category: row.category,
    action: row.action,
    actor: actorOf(row),
    target: targetOf(row),
  };
}

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

type ListRow = Gate & {
  asOf: string | null;
  retainedFrom: string | null;
  recordingStartedAt: string | null;
  total: number;
  events: EventRow[];
};

export async function listAuditEvents(
  database: Database,
  identity: AuditReadIdentity,
  query: AuditLogListQuery,
): Promise<AuditLogListResponse> {
  const q = query.q;
  const params = [
    identity.organizationId,
    identity.actorUserId,
    query.from ?? null,
    query.to ?? null,
    query.categories ?? null,
    query.actorUserId ?? null,
    q === undefined ? null : `%${escapeLike(q)}%`,
    query.asOf ?? null,
    q === undefined ? null : actionCodesMatching(q),
    q !== undefined && UUID_PATTERN.test(q) ? q.toLowerCase() : null,
    query.limit,
    query.offset,
  ];
  return withTenantContextRaw(
    database,
    identity.organizationId,
    async (client) => {
      const result = await client.query<ListRow>(
        `with ${GATE_CTES},
         win as (
           select b.retained_from, b.started,
                  least(coalesce($8::timestamptz, b.db_now), b.db_now) as as_of
           from bounds b
         ),
         scoped as (
           select ${EVENT_COLUMNS}
           from audit_events e
           ${EVENT_JOINS}
           cross join win w
           cross join allowed a
           where a.ok and e.tenant_id = $1
             and e.occurred_at >= greatest(
               coalesce($3::timestamptz, '-infinity'::timestamptz), w.retained_from)
             and e.occurred_at <= least(
               coalesce($4::timestamptz, 'infinity'::timestamptz), w.as_of)
             and ($5::text[] is null or e.category = any($5::text[]))
             and ($6::text is null or e.actor_user_id = $6::text)
             and ($7::text is null
               or e.action = any($9::text[])
               or au.name ilike $7::text
               or coalesce(mo.name, tu.name) ilike $7::text
               or ($10::uuid is not null
                   and (e.id = $10::uuid
                        or (e.target_type = 'invitation' and e.target_id = $10::uuid::text))))
         ),
         page as (
           select * from scoped order by "occurredAt" desc, id desc
           limit $11 offset $12
         )
         select a.member, a.ok, a."rawRole",
                w.as_of as "asOf", w.retained_from as "retainedFrom",
                w.started as "recordingStartedAt",
                (select count(*)::int from scoped) as total,
                coalesce((
                  select json_agg(to_jsonb(page) order by page."occurredAt" desc, page.id desc)
                  from page
                ), '[]'::json) as events
         from allowed a left join win w on true`,
        params,
      );
      const row = result.rows[0];
      if (!row) throw new Error("audit list query returned no row");
      assertAllowed(row);
      if (!row.asOf || !row.retainedFrom || !row.recordingStartedAt) {
        throw new Error("organization row missing for a member");
      }
      return {
        organizationId: identity.organizationId,
        asOf: new Date(row.asOf).toISOString(),
        retainedFrom: new Date(row.retainedFrom).toISOString(),
        recordingStartedAt: new Date(row.recordingStartedAt).toISOString(),
        events: row.events.map(summaryOf),
        page: { limit: query.limit, offset: query.offset, total: row.total },
      };
    },
  );
}

function eventNotFound(): never {
  throw new AppError(404, "AUDIT_EVENT_NOT_FOUND", "ไม่พบเหตุการณ์นี้");
}

function exportScopeOf(row: EventRow): AuditExportScope {
  const attributes = row.targetAttributes;
  const text = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  return {
    format: attributes.format === "json" ? "json" : "csv",
    from: text(attributes.from),
    to: text(attributes.to),
    categories: Array.isArray(attributes.categories)
      ? (attributes.categories as AuditCategory[])
      : [],
    actorUserId: text(attributes.actorUserId),
    searchApplied: attributes.searchApplied === true,
  };
}

type DetailRow = Gate & { event: EventRow | null };

export async function getAuditEvent(
  database: Database,
  identity: AuditReadIdentity,
  eventId: string,
): Promise<AuditLogEventResponse> {
  // A malformed id never reaches the uuid cast; it finds nothing, after the
  // role check, exactly like a missing id.
  const id = UUID_PATTERN.test(eventId) ? eventId.toLowerCase() : null;
  return withTenantContextRaw(
    database,
    identity.organizationId,
    async (client) => {
      const result = await client.query<DetailRow>(
        `with ${GATE_CTES},
         found as (
           select ${EVENT_COLUMNS}, e.changes
           from audit_events e
           ${EVENT_JOINS}
           cross join bounds b
           cross join allowed a
           where a.ok and e.tenant_id = $1 and $3::text is not null
             and e.id = $3::uuid and e.occurred_at >= b.retained_from
         )
         select a.member, a.ok, a."rawRole",
                (select to_jsonb(found) from found) as event
         from allowed a`,
        [identity.organizationId, identity.actorUserId, id],
      );
      const row = result.rows[0];
      if (!row) throw new Error("audit detail query returned no row");
      assertAllowed(row);
      if (!row.event) eventNotFound();
      const event: AuditEventDetail = {
        ...summaryOf(row.event),
        changes: row.event.changes ?? [],
        ...(row.event.action === "organization.audit-log.export"
          ? { exportScope: exportScopeOf(row.event) }
          : {}),
      };
      return { organizationId: identity.organizationId, event };
    },
  );
}

type ActorsRow = Gate & { actors: AuditActorOption[] };

export async function listAuditActors(
  database: Database,
  identity: AuditReadIdentity,
): Promise<AuditLogActorsResponse> {
  return withTenantContextRaw(
    database,
    identity.organizationId,
    async (client) => {
      const result = await client.query<ActorsRow>(
        `with ${GATE_CTES},
         actors as (
           select e.actor_user_id as "userId",
                  case when am.user_id is not null then au.name end as "displayName",
                  (am.user_id is not null) as is_current
           from audit_events e
           left join member am on am.organization_id = $1 and am.user_id = e.actor_user_id
           left join "user" au on au.id = am.user_id
           cross join bounds b
           cross join allowed a
           where a.ok and e.tenant_id = $1 and e.occurred_at >= b.retained_from
           group by e.actor_user_id, am.user_id, au.name
         )
         select a.member, a.ok, a."rawRole",
                coalesce((
                  select json_agg(json_build_object(
                    'userId', x."userId", 'displayName', x."displayName",
                    'membership', case when x.is_current then 'current' else 'former' end)
                    order by lower(x."displayName") nulls last, x."userId")
                  from actors x
                ), '[]'::json) as actors
         from allowed a`,
        [identity.organizationId, identity.actorUserId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("audit actors query returned no row");
      assertAllowed(row);
      return { actors: row.actors };
    },
  );
}
