import type {
  OrganizationNotificationSettings,
  NotificationSettingsUpdate,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { recordAuditEvent, type AuditChange } from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";

type MembershipRow = { role: string };
type SettingsRow = {
  settingsChangedEnabled: boolean;
  monitorAlertsEnabled: boolean;
  version: number;
};
type OrganizationRow = { id: string };

function settingsResponse(
  organizationId: string,
  row: SettingsRow | undefined,
): OrganizationNotificationSettings {
  return {
    organizationId,
    settingsChangedEnabled: row?.settingsChangedEnabled ?? true,
    monitorAlertsEnabled: row?.monitorAlertsEnabled ?? true,
    version: row?.version ?? 0,
  };
}

function booleanChange(
  field: "monitorAlertsEnabled" | "settingsChangedEnabled",
  before: boolean,
  after: boolean,
): AuditChange {
  return {
    field,
    before: { kind: "value", value: before },
    after: { kind: "value", value: after },
  };
}

function assertMember(
  row: MembershipRow | undefined,
): asserts row is MembershipRow {
  if (!row) {
    throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
  }
}

function hasSettingsAdministratorRole(role: string): boolean {
  return role.split(",").some((token) => {
    const normalizedRole = token.trim();
    return normalizedRole === "owner" || normalizedRole === "admin";
  });
}

function assertSettingsAdministrator(row: MembershipRow | undefined): void {
  assertMember(row);
  if (!hasSettingsAdministratorRole(row.role)) {
    throw new AppError(
      403,
      "PERMISSION_DENIED",
      "คุณไม่มีสิทธิ์เปลี่ยนการตั้งค่าองค์กร",
    );
  }
}

async function membershipFor(
  query: (
    text: string,
    values: readonly unknown[],
  ) => Promise<{ rows: MembershipRow[] }>,
  organizationId: string,
  userId: string,
): Promise<MembershipRow | undefined> {
  const result = await query(
    `select role from member
     where organization_id = $1 and user_id = $2`,
    [organizationId, userId],
  );
  return result.rows[0];
}

// Runs before tenant context so a nonmember never sets `app.tenant_id` or
// contends on another organization's locks; callers recheck under their locks.
export async function assertMemberBeforeTenantContext(
  database: Database,
  organizationId: string,
  userId: string,
): Promise<void> {
  const client = await database.sql.connect();
  try {
    const result = await client.query(
      `select 1 from member where organization_id = $1 and user_id = $2`,
      [organizationId, userId],
    );
    if (result.rows.length === 0) assertMember(undefined);
  } finally {
    client.release();
  }
}

export async function getOrganizationNotificationSettings(
  database: Database,
  input: { organizationId: string; userId: string },
): Promise<OrganizationNotificationSettings> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.userId,
  );
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      await client.query(
        "select id from organization where id = $1 for share",
        [input.organizationId],
      );
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        `notification-membership:${input.organizationId}`,
      ]);
      assertSettingsAdministrator(
        await membershipFor(
          client.query.bind(client),
          input.organizationId,
          input.userId,
        ),
      );
      const result = await client.query<SettingsRow>(
        `select org_settings_changed_enabled as "settingsChangedEnabled",
              monitor_alerts_enabled as "monitorAlertsEnabled", version
       from notification_org_settings
       where tenant_id = $1`,
        [input.organizationId],
      );
      return settingsResponse(input.organizationId, result.rows[0]);
    },
  );
}

// The organization row lock orders settings changes with membership mutations,
// so recipients are a commit-time snapshot of current owners/admins.
export async function updateOrganizationNotificationSettings(
  database: Database,
  input: {
    organizationId: string;
    userId: string;
    actorDisplayName: string;
    update: NotificationSettingsUpdate;
    requestId?: string;
  },
): Promise<OrganizationNotificationSettings> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.userId,
  );
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const organization = await client.query<OrganizationRow>(
        "select id from organization where id = $1 for update",
        [input.organizationId],
      );
      if (!organization.rows[0]) {
        throw new AppError(
          403,
          "MEMBERSHIP_DENIED",
          "คุณไม่ใช่สมาชิกขององค์กรนี้",
        );
      }
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        `notification-membership:${input.organizationId}`,
      ]);
      const membership = await membershipFor(
        client.query.bind(client),
        input.organizationId,
        input.userId,
      );
      assertSettingsAdministrator(membership);
      const actorRole = normalizeOrganizationRole(membership?.role ?? "");
      if (actorRole === null) throw new Error("member has no recognized role");

      const current = await client.query<SettingsRow>(
        `select org_settings_changed_enabled as "settingsChangedEnabled",
              monitor_alerts_enabled as "monitorAlertsEnabled", version
       from notification_org_settings
       where tenant_id = $1`,
        [input.organizationId],
      );
      const previous = current.rows[0];
      const currentSettings = settingsResponse(input.organizationId, previous);
      if (currentSettings.version !== input.update.expectedVersion) {
        throw new AppError(
          409,
          "SETTINGS_VERSION_CONFLICT",
          "การตั้งค่าองค์กรถูกแก้ไขแล้ว",
          { current: currentSettings },
        );
      }
      const next = {
        settingsChangedEnabled:
          input.update.settingsChangedEnabled ??
          currentSettings.settingsChangedEnabled,
        monitorAlertsEnabled:
          input.update.monitorAlertsEnabled ??
          currentSettings.monitorAlertsEnabled,
      };
      if (
        next.settingsChangedEnabled ===
          currentSettings.settingsChangedEnabled &&
        next.monitorAlertsEnabled === currentSettings.monitorAlertsEnabled
      ) {
        return currentSettings;
      }
      const changes: AuditChange[] = [];
      if (
        next.settingsChangedEnabled !== currentSettings.settingsChangedEnabled
      ) {
        changes.push(
          booleanChange(
            "settingsChangedEnabled",
            currentSettings.settingsChangedEnabled,
            next.settingsChangedEnabled,
          ),
        );
      }
      if (next.monitorAlertsEnabled !== currentSettings.monitorAlertsEnabled) {
        changes.push(
          booleanChange(
            "monitorAlertsEnabled",
            currentSettings.monitorAlertsEnabled,
            next.monitorAlertsEnabled,
          ),
        );
      }

      const nextVersion = currentSettings.version + 1;
      await client.query(
        `insert into notification_org_settings
        (tenant_id, org_settings_changed_enabled, monitor_alerts_enabled, version)
       values ($1, $2, $3, $4)
       on conflict (tenant_id) do update
       set org_settings_changed_enabled = excluded.org_settings_changed_enabled,
           monitor_alerts_enabled = excluded.monitor_alerts_enabled,
           version = excluded.version,
           updated_at = now()`,
        [
          input.organizationId,
          next.settingsChangedEnabled,
          next.monitorAlertsEnabled,
          nextVersion,
        ],
      );

      if (currentSettings.settingsChangedEnabled) {
        const intentId = crypto.randomUUID();
        const origin = `organization-notification-settings:${intentId}`;
        const recipients = await client.query<{ userId: string }>(
          `select user_id as "userId" from member
         where organization_id = $1
           and user_id <> $2
           and exists (
             select 1
             from unnest(string_to_array(role, ',')) as role_token
             where btrim(role_token) in ('owner', 'admin')
           )
         order by user_id`,
          [input.organizationId, input.userId],
        );
        await client.query(
          `insert into notification_intents
          (id, scope_kind, tenant_id, origin, event_type, occurred_at,
           actor_user_id, actor_display_name)
         values ($1, 'tenant', $2, $3,
                 'ORG-NOTIFICATION-SETTINGS-CHANGED', now(), $4, $5)`,
          [
            intentId,
            input.organizationId,
            origin,
            input.userId,
            input.actorDisplayName,
          ],
        );
        if (recipients.rows.length > 0) {
          await client.query(
            `insert into notification_intent_recipients
            (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
           select $1, $2, recipient_user_id, 'tenant', $3
           from unnest($4::text[]) as recipients(recipient_user_id)`,
            [
              intentId,
              origin,
              input.organizationId,
              recipients.rows.map((recipient) => recipient.userId),
            ],
          );
        }
        await client.query("select create_notification_dispatch($1, $2)", [
          crypto.randomUUID(),
          intentId,
        ]);
      }

      await recordAuditEvent(client, {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorRole,
        // One mutation, one event: monitor alerts alone has its own action.
        action:
          next.settingsChangedEnabled !== currentSettings.settingsChangedEnabled
            ? "organization.notification-settings.update"
            : "organization.notification-settings.monitor-alerts.update",
        target: { type: "notification_settings" },
        changes,
        requestId: input.requestId,
      });

      return {
        organizationId: input.organizationId,
        ...next,
        version: nextVersion,
      };
    },
  );
}
