import type {
  OrganizationNotificationSettings,
  NotificationSettingsUpdate,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

type MembershipRow = { role: string };
type SettingsRow = { settingsChangedEnabled: boolean; version: number };
type OrganizationRow = { id: string };

function settingsResponse(
  organizationId: string,
  row: SettingsRow | undefined,
): OrganizationNotificationSettings {
  return {
    organizationId,
    settingsChangedEnabled: row?.settingsChangedEnabled ?? true,
    version: row?.version ?? 0,
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

/** Reads settings only for a current owner or administrator. */
export async function getOrganizationNotificationSettings(
  database: Database,
  input: { organizationId: string; userId: string },
): Promise<OrganizationNotificationSettings> {
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
        `select org_settings_changed_enabled as "settingsChangedEnabled", version
       from notification_org_settings
       where tenant_id = $1`,
        [input.organizationId],
      );
      return settingsResponse(input.organizationId, result.rows[0]);
    },
  );
}

/**
 * Compare-and-swap settings update. The organization row is the single lock
 * ordering settings changes with every membership mutation. Recipients are a
 * commit-time snapshot of other current owners/admins, so a later promotion
 * cannot see an old intent and a demotion/revocation cannot receive one.
 */
export async function updateOrganizationNotificationSettings(
  database: Database,
  input: {
    organizationId: string;
    userId: string;
    actorDisplayName: string;
    update: NotificationSettingsUpdate;
  },
): Promise<OrganizationNotificationSettings> {
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
      assertSettingsAdministrator(
        await membershipFor(
          client.query.bind(client),
          input.organizationId,
          input.userId,
        ),
      );

      const current = await client.query<SettingsRow>(
        `select org_settings_changed_enabled as "settingsChangedEnabled", version
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
      if (
        currentSettings.settingsChangedEnabled ===
        input.update.settingsChangedEnabled
      ) {
        return currentSettings;
      }

      const nextVersion = currentSettings.version + 1;
      await client.query(
        `insert into notification_org_settings
        (tenant_id, org_settings_changed_enabled, version)
       values ($1, $2, $3)
       on conflict (tenant_id) do update
       set org_settings_changed_enabled = excluded.org_settings_changed_enabled,
           version = excluded.version,
           updated_at = now()`,
        [
          input.organizationId,
          input.update.settingsChangedEnabled,
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

      return {
        organizationId: input.organizationId,
        settingsChangedEnabled: input.update.settingsChangedEnabled,
        version: nextVersion,
      };
    },
  );
}
