import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Better Auth persistence model (better-auth@1.6.23, PostgreSQL/Drizzle).
 *
 * Table and field names must stay aligned with the Better Auth core and
 * organization/twoFactor plugin schemas — the drizzle adapter resolves
 * models by these exact names. Property names are the Better Auth field
 * names (camelCase); column names are snake_case.
 *
 * IDs: user/account/session/verification/member/invitation/twoFactor use
 * text IDs; organizations are UUIDs per the NightWatch persistence model.
 * `advanced.database.generateId` returns UUIDs for every model, so all
 * text ID columns carry UUID values too.
 */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled"),
    lastActiveTenantId: uuid("last_active_tenant_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive identity invariant: prevents duplicate accounts for
    // the same mailbox regardless of how the address was cased at signup.
    uniqueIndex("user_email_lower_key").on(sql`lower(${table.email})`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Organization plugin field: the active organization for the session.
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_provider_account_key").on(
      table.providerId,
      table.accountId,
    ),
    index("account_user_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable("organization", {
  // UUID tenant identity; unguessable and URL-safe for cross-tenant links.
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // One membership per user per organization — the SQL invariant that
    // makes concurrent invitation acceptance idempotent-safe.
    uniqueIndex("member_organization_user_key").on(
      table.organizationId,
      table.userId,
    ),
    index("member_user_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // Plain lookup index only: an organization legitimately holds many
    // invitations over time (INT-DB-1); uniqueness is NOT enforced here.
    index("invitation_organization_idx").on(table.organizationId),
  ],
);

export const twoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  // Encrypted TOTP secret and backup codes (Better Auth symmetric
  // encryption keyed from BETTER_AUTH_SECRET). Never log these columns.
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failed_verification_count")
    .notNull()
    .default(0),
  lockedUntil: timestamp("locked_until", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const notificationOrgSettings = pgTable("notification_org_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  orgSettingsChangedEnabled: boolean("org_settings_changed_enabled")
    .notNull()
    .default(true),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationIntents = pgTable(
  "notification_intents",
  {
    id: text("id").primaryKey(),
    scopeKind: text("scope_kind").notNull(),
    tenantId: uuid("tenant_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorDisplayName: text("actor_display_name"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_intents_origin_key").on(table.origin),
    index("notification_intents_tenant_occurred_idx").on(
      table.tenantId,
      table.occurredAt,
      table.id,
    ),
    index("notification_intents_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const notificationIntentRecipients = pgTable(
  "notification_intent_recipients",
  {
    intentId: text("intent_id").notNull(),
    origin: text("origin").notNull(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").notNull(),
    tenantId: uuid("tenant_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_intent_recipients_origin_recipient_key").on(
      table.origin,
      table.recipientUserId,
    ),
  ],
);

export const notificationInboxItems = pgTable(
  "notification_inbox_items",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => notificationIntents.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").notNull(),
    tenantId: uuid("tenant_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorDisplayName: text("actor_display_name"),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_inbox_items_origin_recipient_key").on(
      table.origin,
      table.recipientUserId,
    ),
    index("notification_inbox_items_tenant_visible_idx").on(
      table.tenantId,
      table.recipientUserId,
      table.occurredAt,
      table.id,
    ),
    index("notification_inbox_items_user_visible_idx").on(
      table.userId,
      table.recipientUserId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const notificationAccountMfaState = pgTable(
  "notification_account_mfa_state",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    verifiedEnabled: boolean("verified_enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const notificationDispatchLedger = pgTable(
  "notification_dispatch_ledger",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => notificationIntents.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").notNull(),
    tenantId: uuid("tenant_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
    enqueuedAt: timestamp("enqueued_at", { mode: "date", withTimezone: true }),
    failureReason: text("failure_reason"),
    failureSummary: text("failure_summary"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_dispatch_ledger_intent_key").on(table.intentId),
    index("notification_dispatch_ledger_claim_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
  ],
);

const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
});

export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    method: text("method").notNull().default("GET"),
    headers: jsonb("headers").notNull().default([]),
    queryParams: jsonb("query_params").notNull().default([]),
    bodyType: text("body_type"),
    bodyContent: text("body_content"),
    authType: text("auth_type").notNull().default("none"),
    apiKeyHeaderName: text("api_key_header_name"),
    expectedStatusText: text("expected_status_text")
      .notNull()
      .default("200-299"),
    expectedStatusRanges: jsonb("expected_status_ranges")
      .notNull()
      .default([{ from: 200, to: 299 }]),
    assertions: jsonb("assertions").notNull().default([]),
    intervalSeconds: integer("interval_seconds").notNull().default(300),
    timeoutSeconds: integer("timeout_seconds").notNull().default(10),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    checkConfigVersion: integer("check_config_version").notNull().default(1),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastCheckAt: timestamp("last_check_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastOutcome: text("last_outcome"),
    lastPassedConfigVersion: integer("last_passed_config_version"),
    sslHost: text("ssl_host"),
    sslIssuer: text("ssl_issuer"),
    sslNotAfter: timestamp("ssl_not_after", {
      mode: "date",
      withTimezone: true,
    }),
    sslState: text("ssl_state"),
    sslReason: text("ssl_reason"),
    sslNotifiedNotAfter: timestamp("ssl_notified_not_after", {
      mode: "date",
      withTimezone: true,
    }),
    sslNotifiedLevel: text("ssl_notified_level"),
    clientRequestId: uuid("client_request_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("monitors_id_tenant_key").on(table.id, table.tenantId),
    unique("monitors_client_request_key").on(
      table.tenantId,
      table.clientRequestId,
    ),
    index("monitors_tenant_idx").on(table.tenantId, table.id),
  ],
);

export const monitorSecrets = pgTable(
  "monitor_secrets",
  {
    monitorId: uuid("monitor_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    keyVersion: text("key_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.slot] }),
    foreignKey({
      columns: [table.monitorId, table.tenantId],
      foreignColumns: [monitors.id, monitors.tenantId],
    }).onDelete("cascade"),
  ],
);

/** `nextCheckAt` is null while the monitor is paused (unclaimable). */
export const monitorSchedule = pgTable(
  "monitor_schedule",
  {
    monitorId: uuid("monitor_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    nextCheckAt: timestamp("next_check_at", {
      mode: "date",
      withTimezone: true,
    }),
    claimToken: text("claim_token"),
    claimedUntil: timestamp("claimed_until", {
      mode: "date",
      withTimezone: true,
    }),
    checkConfigVersion: integer("check_config_version").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    timeoutSeconds: integer("timeout_seconds").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.monitorId, table.tenantId],
      foreignColumns: [monitors.id, monitors.tenantId],
    }).onDelete("cascade"),
  ],
);

/** Monthly partitions by `scheduledFor`; see `ensure_monitor_partitions`. */
export const monitorCheckResults = pgTable(
  "monitor_check_results",
  {
    monitorId: uuid("monitor_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    checkedAt: timestamp("checked_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    outcome: text("outcome").notNull(),
    httpStatus: integer("http_status"),
    responseTimeMs: integer("response_time_ms"),
    failureReason: text("failure_reason"),
    tlsReason: text("tls_reason"),
    assertions: jsonb("assertions").notNull().default([]),
    urlMasked: text("url_masked").notNull(),
    checkConfigVersion: integer("check_config_version").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    evaluatedFromPrefix: boolean("evaluated_from_prefix")
      .notNull()
      .default(false),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.scheduledFor] }),
    index("monitor_check_results_scheduled_idx").on(table.scheduledFor),
    foreignKey({
      columns: [table.monitorId, table.tenantId],
      foreignColumns: [monitors.id, monitors.tenantId],
    }).onDelete("cascade"),
  ],
);

/** Monthly partitions by `hourStart`; see `ensure_monitor_partitions`. */
export const monitorCheckHourly = pgTable(
  "monitor_check_hourly",
  {
    monitorId: uuid("monitor_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    hourStart: timestamp("hour_start", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    checks: integer("checks").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    coveredSeconds: integer("covered_seconds").notNull().default(0),
    responseChecks: integer("response_checks").notNull().default(0),
    responseMsSum: bigint("response_ms_sum", { mode: "number" })
      .notNull()
      .default(0),
    responseMsMax: integer("response_ms_max"),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.hourStart] }),
    index("monitor_check_hourly_hour_idx").on(table.hourStart),
    foreignKey({
      columns: [table.monitorId, table.tenantId],
      foreignColumns: [monitors.id, monitors.tenantId],
    }).onDelete("cascade"),
  ],
);

export const monitorIncidents = pgTable(
  "monitor_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    endedAt: timestamp("ended_at", { mode: "date", withTimezone: true }),
    startReason: text("start_reason").notNull(),
    startHttpStatus: integer("start_http_status"),
    endReason: text("end_reason"),
    downNotified: boolean("down_notified").notNull().default(false),
  },
  (table) => [
    foreignKey({
      columns: [table.monitorId, table.tenantId],
      foreignColumns: [monitors.id, monitors.tenantId],
    }).onDelete("cascade"),
    uniqueIndex("monitor_incidents_one_open_key")
      .on(table.monitorId)
      .where(sql`${table.endedAt} is null`),
    index("monitor_incidents_history_idx").on(table.monitorId, table.startedAt),
    index("monitor_incidents_retention_idx")
      .on(table.endedAt)
      .where(sql`${table.endedAt} is not null`),
  ],
);

export const monitorEvents = pgTable(
  "monitor_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    urlMasked: text("url_masked"),
  },
  (table) => [
    foreignKey({
      columns: [table.monitorId, table.tenantId],
      foreignColumns: [monitors.id, monitors.tenantId],
    }).onDelete("cascade"),
    index("monitor_events_monitor_idx").on(table.monitorId, table.occurredAt),
    index("monitor_events_retention_idx").on(table.occurredAt),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  twoFactor,
  notificationOrgSettings,
  notificationIntents,
  notificationIntentRecipients,
  notificationInboxItems,
  notificationAccountMfaState,
  notificationDispatchLedger,
  monitors,
  monitorSecrets,
  monitorSchedule,
  monitorCheckResults,
  monitorCheckHourly,
  monitorIncidents,
  monitorEvents,
};
