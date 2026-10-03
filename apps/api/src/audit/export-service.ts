import {
  AUDIT_EXPORT_LIST_MAX,
  AUDIT_EXPORT_MAX_EVENTS,
  type AuditExportCreateResponse,
  type AuditExportListResponse,
  type AuditExportRecord,
  type AuditExportRequest,
} from "@nightwatch/api-contract";
import {
  failStaleAuditExports,
  withTenantUserContextRaw,
  type Database,
} from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "../organization-notifications/service";
import { recordAuditEvent } from "./record";
import { countAuditEventsForExport } from "./read-service";

export type ExportIdentity = {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function membershipDenied(): never {
  throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
}

function exportDenied(): never {
  throw new AppError(
    403,
    "PERMISSION_DENIED",
    "คุณไม่มีสิทธิ์ส่งออกบันทึกกิจกรรม",
  );
}

/**
 * The actor's role inside the open transaction, owner or admin, else a denial.
 * The organization and the member row are locked FOR SHARE, in the order every
 * membership change uses, and stay locked until commit: a demotion or removal
 * either commits before this check or waits until the request is done.
 */
async function requireExporter(
  client: PoolClient,
  identity: ExportIdentity,
): Promise<"owner" | "admin"> {
  const organization = await client.query(
    "select id from organization where id = $1 for share",
    [identity.organizationId],
  );
  if (organization.rows.length === 0) membershipDenied();
  const member = await client.query<{ role: string }>(
    "select role from member where organization_id = $1 and user_id = $2 for share",
    [identity.organizationId, identity.actorUserId],
  );
  const raw = member.rows[0]?.role;
  if (raw === undefined) membershipDenied();
  const role = normalizeOrganizationRole(raw);
  if (role === null) throw new Error("member has no recognized role");
  if (role !== "owner" && role !== "admin") exportDenied();
  return role;
}

type ExportRow = {
  id: string;
  format: "csv" | "json";
  filters: {
    from: string;
    to: string;
    categories?: string[];
    actorUserId?: string | null;
    q?: string | null;
  };
  timeZone: string;
  createdAt: Date;
  completedAt: Date | null;
  fileExpiresAt: Date | null;
  rowCount: number | null;
  failureCode: AuditExportRecord["failureCode"];
  state: "queued" | "running" | "ready" | "failed";
  expired: boolean;
};

const EXPORT_COLUMNS = `
  e.id, e.format, e.filters, e.time_zone as "timeZone",
  e.created_at as "createdAt", e.completed_at as "completedAt",
  e.file_expires_at as "fileExpiresAt", e.row_count as "rowCount",
  e.failure_code as "failureCode", j.state,
  (j.state = 'ready' and e.file_expires_at <= now()) as expired`;

function recordOf(row: ExportRow): AuditExportRecord {
  const status =
    row.state === "failed"
      ? "failed"
      : row.state === "ready"
        ? row.expired
          ? "expired"
          : "ready"
        : "generating";
  return {
    id: row.id,
    format: row.format,
    status,
    filters: {
      from: row.filters.from,
      to: row.filters.to,
      categories: (row.filters.categories ??
        []) as AuditExportRecord["filters"]["categories"],
      actorUserId: row.filters.actorUserId ?? null,
      q: row.filters.q ?? null,
    },
    timeZone: row.timeZone,
    requestedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.fileExpiresAt?.toISOString() ?? null,
    rowCount: row.rowCount,
    failureCode: row.failureCode,
  };
}

// The client left (the page moved to another organization): nothing is written.
function requestCancelled(): never {
  throw new AppError(499, "REQUEST_CANCELLED", "คำขอถูกยกเลิก");
}

/**
 * `signal` is the HTTP request's. It is checked again just before the first
 * write, so a request the client already abandoned rolls back instead of
 * creating an export for an organization the user has left. That narrows the
 * window but cannot close it: once the commit has started the export stays
 * valid, because the user asked for it while in that organization.
 */
export async function createAuditExport(
  database: Database,
  identity: ExportIdentity,
  request: AuditExportRequest,
  signal?: AbortSignal,
): Promise<AuditExportCreateResponse> {
  await assertMemberBeforeTenantContext(
    database,
    identity.organizationId,
    identity.actorUserId,
  );
  const filters = request.filters;
  // One statement checks membership, the role and counts, so a caller that may
  // not export never sees a number (B-01).
  const total = await countAuditEventsForExport(database, identity, {
    from: filters.from,
    to: filters.to,
    categories: filters.categories,
    actorUserId: filters.actorUserId,
    q: filters.q,
    asOf: request.asOf,
  });
  if (total === 0) {
    throw new AppError(
      422,
      "AUDIT_EXPORT_EMPTY",
      "ไม่มีรายการให้ส่งออกตามตัวกรองนี้",
    );
  }
  if (total > AUDIT_EXPORT_MAX_EVENTS) {
    throw new AppError(
      422,
      "AUDIT_EXPORT_TOO_LARGE",
      "ข้อมูลมากเกินไปสำหรับการส่งออกครั้งเดียว",
      { limit: AUDIT_EXPORT_MAX_EVENTS, total },
    );
  }

  return withTenantUserContextRaw(
    database,
    identity.organizationId,
    identity.actorUserId,
    async (client) => {
      const role = await requireExporter(client, identity);
      // A request that outlived its lifetime must not block this one.
      await failStaleAuditExports(client, {
        tenantId: identity.organizationId,
        requestedBy: identity.actorUserId,
      });
      if (signal?.aborted) requestCancelled();
      const stored = {
        from: filters.from,
        to: filters.to,
        categories: filters.categories ?? [],
        actorUserId: filters.actorUserId ?? null,
        q: filters.q ?? null,
      };
      const inserted = await client.query<{ id: string; createdAt: Date }>(
        `insert into audit_exports
           (tenant_id, requested_by, format, filters, time_zone, snapshot_at)
         values ($1, $2, $3, $4::jsonb, $5, least($6::timestamptz, now()))
         returning id, created_at as "createdAt"`,
        [
          identity.organizationId,
          identity.actorUserId,
          request.format,
          JSON.stringify(stored),
          request.timeZone,
          request.asOf,
        ],
      );
      const created = inserted.rows[0];
      if (!created) throw new Error("audit export insert returned no row");
      try {
        await client.query(
          `insert into audit_export_jobs
             (export_id, tenant_id, requested_by, state, created_at)
           values ($1, $2, $3, 'queued', $4)`,
          [
            created.id,
            identity.organizationId,
            identity.actorUserId,
            created.createdAt,
          ],
        );
      } catch (error) {
        if (
          (error as { code?: string }).code === "23505" &&
          (error as { constraint?: string }).constraint ===
            "audit_export_jobs_one_in_flight"
        ) {
          throw new AppError(
            409,
            "AUDIT_EXPORT_IN_PROGRESS",
            "สร้างไฟล์ส่งออกได้ครั้งละ 1 คำขอ รอให้ไฟล์ปัจจุบันเสร็จก่อน",
          );
        }
        throw error;
      }
      // The search text itself is never stored in the event, only that one was used.
      await recordAuditEvent(client, {
        organizationId: identity.organizationId,
        actorUserId: identity.actorUserId,
        actorRole: role,
        action: "organization.audit-log.export",
        target: {
          type: "audit_export",
          id: created.id,
          attributes: {
            format: request.format,
            from: filters.from,
            to: filters.to,
            categories: filters.categories ?? [],
            actorUserId: filters.actorUserId ?? null,
            searchApplied: filters.q !== undefined,
          },
        },
        changes: [],
        requestId: identity.requestId,
      });
      const row = await client.query<ExportRow>(
        `select ${EXPORT_COLUMNS}
         from audit_exports e join audit_export_jobs j on j.export_id = e.id
         where e.id = $1`,
        [created.id],
      );
      const exportRow = row.rows[0];
      if (!exportRow) throw new Error("audit export vanished after insert");
      return { export: recordOf(exportRow) };
    },
  );
}

export async function listAuditExports(
  database: Database,
  identity: ExportIdentity,
): Promise<AuditExportListResponse> {
  await assertMemberBeforeTenantContext(
    database,
    identity.organizationId,
    identity.actorUserId,
  );
  return withTenantUserContextRaw(
    database,
    identity.organizationId,
    identity.actorUserId,
    async (client) => {
      // Membership, then role, both locked through the stale transition and the
      // read: a denial writes nothing.
      await requireExporter(client, identity);
      await failStaleAuditExports(client, {
        tenantId: identity.organizationId,
        requestedBy: identity.actorUserId,
      });
      const rows = await client.query<ExportRow>(
        `select ${EXPORT_COLUMNS}
         from audit_exports e join audit_export_jobs j on j.export_id = e.id
         where e.tenant_id = $1 and e.requested_by = $2
           and e.created_at > now() - interval '7 days'
         order by e.created_at desc, e.id desc
         limit ${String(AUDIT_EXPORT_LIST_MAX)}`,
        [identity.organizationId, identity.actorUserId],
      );
      const exports = rows.rows.map(recordOf);
      return {
        exports,
        inProgress: exports.some((item) => item.status === "generating"),
      };
    },
  );
}

export type AuditExportFile = {
  content: Buffer;
  format: "csv" | "json";
  snapshotAt: Date;
};

type FileRow = {
  member: boolean;
  rawRole: string | null;
  found: boolean;
  state: "queued" | "running" | "ready" | "failed" | null;
  available: boolean;
  format: "csv" | "json" | null;
  snapshotAt: Date | null;
  content: Buffer | null;
};

export async function getAuditExportFile(
  database: Database,
  identity: ExportIdentity,
  exportId: string,
): Promise<AuditExportFile> {
  // A malformed id finds nothing, after the role check, like a missing one.
  const id = UUID_PATTERN.test(exportId) ? exportId.toLowerCase() : null;
  await assertMemberBeforeTenantContext(
    database,
    identity.organizationId,
    identity.actorUserId,
  );
  return withTenantUserContextRaw(
    database,
    identity.organizationId,
    identity.actorUserId,
    async (client) => {
      // One statement: membership, the role as it is now, the owner of the
      // file, its state and its expiry.
      const result = await client.query<FileRow>(
        `with me as (
           select role from member where organization_id = $1 and user_id = $2
         ),
         gate as (
           select exists (select 1 from me) as member,
                  (select role from me) as "rawRole",
                  exists (
                    select 1 from me, unnest(string_to_array(me.role, ',')) as t
                    where btrim(t) in ('owner', 'admin')
                  ) as maybe_exporter
         ),
         found as (
           select e.format, e.snapshot_at, j.state,
                  (j.state = 'ready' and e.content is not null
                    and e.file_expires_at > now()) as available,
                  case when j.state = 'ready' and e.content is not null
                         and e.file_expires_at > now()
                       then e.content end as content
           from audit_exports e join audit_export_jobs j on j.export_id = e.id
           cross join gate g
           where g.maybe_exporter and e.id = $3::uuid
             and e.tenant_id = $1 and e.requested_by = $2
         )
         select g.member, g."rawRole", (select count(*) from found) = 1 as found,
                (select state from found) as state,
                coalesce((select available from found), false) as available,
                (select format from found) as format,
                (select snapshot_at from found) as "snapshotAt",
                (select content from found) as content
         from gate g`,
        [identity.organizationId, identity.actorUserId, id],
      );
      const row = result.rows[0];
      if (!row) throw new Error("audit export download query returned no row");
      if (!row.member || row.rawRole === null) membershipDenied();
      // Same rule as normalizeOrganizationRole: the SQL above keeps the file out
      // of the row unless some token is owner or admin, and the highest
      // priority token decides here.
      const role = normalizeOrganizationRole(row.rawRole);
      if (role !== "owner" && role !== "admin") {
        throw new AppError(
          403,
          "PERMISSION_DENIED",
          "คุณไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้",
        );
      }
      if (!row.found || !row.format || !row.snapshotAt) {
        throw new AppError(404, "AUDIT_EXPORT_NOT_FOUND", "ไม่พบไฟล์ส่งออกนี้");
      }
      if (row.state !== "ready") {
        throw new AppError(
          409,
          "AUDIT_EXPORT_NOT_READY",
          "ไฟล์ส่งออกยังไม่พร้อมดาวน์โหลด",
        );
      }
      if (!row.available || !row.content) {
        throw new AppError(
          410,
          "AUDIT_EXPORT_EXPIRED",
          "ไฟล์ส่งออกหมดอายุแล้ว",
        );
      }
      return {
        content: row.content,
        format: row.format,
        snapshotAt: row.snapshotAt,
      };
    },
  );
}
