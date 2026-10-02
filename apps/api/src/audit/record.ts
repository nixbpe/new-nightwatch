import type { PoolClient } from "pg";

export const AUDIT_ACTION_CATEGORIES = {
  "organization.monitor.create": "monitor",
  "organization.monitor.update": "monitor",
  "organization.monitor.pause": "monitor",
  "organization.monitor.resume": "monitor",
  "organization.monitor.delete": "monitor",
  "organization.monitor.secret.set": "monitor",
  "organization.monitor.secret.replace": "monitor",
  "organization.notification-settings.monitor-alerts.update":
    "notification_settings",
  "organization.notification-settings.update": "notification_settings",
  "organization.member.role.update": "member",
  "organization.member.revoke": "member",
  "organization.member.leave": "member",
  "organization.invitation.create": "invitation",
  "organization.invitation.resend": "invitation",
  "organization.invitation.cancel": "invitation",
  "organization.audit-log.export": "audit_log",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_CATEGORIES;

export type AuditValue =
  | { kind: "value"; value: string | number | boolean | null }
  | { kind: "masked" }
  | { kind: "secret_set" }
  | { kind: "changed" };

export type AuditChange = {
  field: string;
  key?: string;
  before: AuditValue | null;
  after: AuditValue | null;
};

export type AuditTarget = {
  type:
    | "monitor"
    | "member"
    | "invitation"
    | "notification_settings"
    | "audit_export";
  /** user id, invitation `public_id`, monitor id or export id; never `invitation.id`. */
  id?: string;
  /** Non-personal display attributes only (no email, name or search text). */
  attributes?: Record<string, unknown>;
};

export type AuditEventInput = {
  organizationId: string;
  actorUserId: string;
  /** Role read in the same transaction, already normalized. */
  actorRole: "owner" | "admin" | "viewer" | "auditor";
  action: AuditAction;
  target: AuditTarget;
  /** Redacted by the caller; this helper stores it as given. */
  changes: AuditChange[];
  requestId?: string;
};

/** Role value for a `role` change; `null` side means no role (not a member or no invitation). */
export function roleChange(
  before: string | null,
  after: string | null,
): AuditChange {
  return {
    field: "role",
    before: before === null ? null : { kind: "value", value: before },
    after: after === null ? null : { kind: "value", value: after },
  };
}

/**
 * The only writer of `audit_events`. Call it inside the mutation's tenant
 * transaction after its last write: a failed insert rolls the whole mutation
 * back (OD-04), so a change never commits without its event.
 */
export async function recordAuditEvent(
  client: PoolClient,
  input: AuditEventInput,
): Promise<void> {
  await client.query(
    `insert into audit_events
       (tenant_id, actor_user_id, actor_role, category, action,
        target_type, target_id, target_attributes, changes, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [
      input.organizationId,
      input.actorUserId,
      input.actorRole,
      AUDIT_ACTION_CATEGORIES[input.action],
      input.action,
      input.target.type,
      input.target.id ?? null,
      JSON.stringify(input.target.attributes ?? {}),
      JSON.stringify(input.changes),
      input.requestId ?? null,
    ],
  );
}
