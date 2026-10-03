import {
  auditActionCodesMatching,
  AUDIT_ACTION_LABELS,
  type AuditAction,
  type AuditCategory,
  type AuditChange,
} from "@nightwatch/shared";
import {
  readAuditEventBatch,
  type AuditEventBatchRow,
  type withTenantUserContextRaw,
} from "@nightwatch/db";

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

export type BatchCursor = { occurredAt: string; id: string };

function targetLabel(row: AuditEventBatchRow): string {
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

// The CHECK constraints of audit_events keep both columns inside their lists.
function knownAction(action: string): AuditAction {
  if (!(action in AUDIT_ACTION_LABELS)) {
    throw new Error("audit event has an unknown action");
  }
  return action as AuditAction;
}

function toExportEvent(row: AuditEventBatchRow): ExportEvent {
  return {
    id: row.id,
    occurredAt: row.occurredAtUtc,
    actor: {
      displayName: row.actorCurrent ? row.actorName : null,
      roleAtTime: row.actorRole,
      membership: row.actorCurrent ? "current" : "former",
    },
    action: knownAction(row.action),
    category: row.category as AuditCategory,
    target: targetLabel(row),
    // jsonb written by recordAuditEvent, already redacted.
    changes: row.changes as AuditChange[],
  };
}

/**
 * The next batch of events for one export, newest first, through the same
 * filter the list API uses (packages/db), so the file holds the rows the page
 * shows for the same filters.
 */
export async function readEventBatch(
  client: TenantClient,
  input: {
    tenantId: string;
    filters: ExportFilters;
    retainedFrom: Date;
    snapshotAt: Date;
    cursor: BatchCursor | null;
    limit?: number;
  },
): Promise<{ events: ExportEvent[]; next: BatchCursor | null }> {
  const { filters } = input;
  const batch = await readAuditEventBatch(client, {
    tenantId: input.tenantId,
    filter: filters,
    actionCodes: filters.q ? auditActionCodesMatching(filters.q) : [],
    retainedFrom: input.retainedFrom,
    snapshotAt: input.snapshotAt,
    cursor: input.cursor,
    limit: input.limit ?? EXPORT_BATCH_SIZE,
  });
  return { events: batch.rows.map(toExportEvent), next: batch.next };
}
