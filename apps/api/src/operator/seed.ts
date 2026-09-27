import {
  createDatabase,
  withAccountContextRaw,
  withTenantContextRaw,
} from "@nightwatch/db";
import { hashPassword } from "better-auth/crypto";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import type { PoolClient } from "pg";

const SEED_LOCK = "nightwatch-local-demo-seed-v3";
const ORIGIN = "nightwatch-local-demo-seed-v3";
const PASSWORD = "nightwatch-demo-password";
const LOCK_WAIT_MS = 5_000;
const DEFAULT_ORGANIZATION_ID = "7b0a2d01-60c2-4b32-9b17-1e9e87000001";

type Scope = "tenant" | "account";
type EventType =
  | "ORG-NOTIFICATION-SETTINGS-CHANGED"
  | "PASSWORD_CHANGED"
  | "MFA_ENABLED"
  | "MFA_DISABLED";

export type SeedIdentity = Readonly<{
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "viewer" | "auditor";
}>;
type OrganizationIdentity = Readonly<{
  id: string;
  slug: string;
  name: string;
}>;
type NotificationSeed = Readonly<{
  id: string;
  scope: Scope;
  tenantId?: string;
  userId?: string;
  eventType: EventType;
  read: boolean;
  offsetMinutes: number;
}>;
export type SeedFault = "after-runtime" | "during-finalization";
export type SeedOptions = Readonly<{ now?: Date; fault?: SeedFault }>;

export const DEMO_USERS: readonly SeedIdentity[] = [
  {
    id: "6b0a2d01-60c2-4b32-9b17-1e9e87000001",
    email: "owner@nightwatch.invalid",
    name: "Demo Owner",
    role: "owner",
  },
  {
    id: "6b0a2d01-60c2-4b32-9b17-1e9e87000002",
    email: "admin@nightwatch.invalid",
    name: "Demo Admin",
    role: "admin",
  },
  {
    id: "6b0a2d01-60c2-4b32-9b17-1e9e87000003",
    email: "viewer@nightwatch.invalid",
    name: "Demo Viewer",
    role: "viewer",
  },
  {
    id: "6b0a2d01-60c2-4b32-9b17-1e9e87000004",
    email: "auditor@nightwatch.invalid",
    name: "Demo Auditor",
    role: "auditor",
  },
];

export const DEMO_ORGANIZATIONS: readonly OrganizationIdentity[] = [
  {
    id: DEFAULT_ORGANIZATION_ID,
    slug: "nightwatch-demo-alpha",
    name: "NightWatch Demo Alpha",
  },
  {
    id: "7b0a2d01-60c2-4b32-9b17-1e9e87000002",
    slug: "nightwatch-demo-beta",
    name: "NightWatch Demo Beta",
  },
];

function stableId(kind: string, key: string): string {
  return `${ORIGIN}:${kind}:${key}`;
}

function inboxId(notificationId: string, role: SeedIdentity["role"]): string {
  const bytes = createHash("sha256")
    .update(`${ORIGIN}:inbox:${notificationId}:${role}`)
    .digest();
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeDatabaseUrl(value: string): string {
  return value.trim();
}

export function assertLocalSeedTarget(
  value: string,
  role: "nightwatch_owner" | "nightwatch",
): void {
  const url = new URL(value);
  if (
    url.protocol !== "postgres:" ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    decodeURIComponent(url.username) !== role ||
    url.pathname !== "/nightwatch"
  ) {
    throw new Error(
      `local demo seed target must be the loopback ${role}/nightwatch database`,
    );
  }
}

export function readSeedConfig(
  source: NodeJS.ProcessEnv,
  expectedOwnerUrl: string,
  expectedRuntimeUrl: string,
): { ownerUrl: string; runtimeUrl: string } {
  const ownerUrl = source.DATABASE_OWNER_URL?.trim();
  const runtimeUrl = source.DATABASE_URL?.trim();
  if (!ownerUrl || !runtimeUrl) {
    throw new Error(
      "DATABASE_OWNER_URL and DATABASE_URL are required for local demo seed",
    );
  }
  assertLocalSeedTarget(ownerUrl, "nightwatch_owner");
  assertLocalSeedTarget(runtimeUrl, "nightwatch");
  if (ownerUrl !== expectedOwnerUrl || runtimeUrl !== expectedRuntimeUrl) {
    throw new Error(
      "DATABASE_OWNER_URL and DATABASE_URL must match the computed local Compose targets",
    );
  }
  return { ownerUrl, runtimeUrl };
}

function notifications(): NotificationSeed[] {
  const tenant = DEMO_ORGANIZATIONS.flatMap((org, index) => [
    {
      id: stableId("intent", `${org.slug}:recent`),
      scope: "tenant" as const,
      tenantId: org.id,
      eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED" as const,
      read: false,
      offsetMinutes: index * 2 + 5,
    },
    {
      id: stableId("intent", `${org.slug}:older`),
      scope: "tenant" as const,
      tenantId: org.id,
      eventType: "ORG-NOTIFICATION-SETTINGS-CHANGED" as const,
      read: true,
      offsetMinutes: index * 2 + 65,
    },
  ]);
  const account = DEMO_USERS.flatMap((user, index) => [
    {
      id: stableId("intent", `${user.role}:password`),
      scope: "account" as const,
      userId: user.id,
      eventType: "PASSWORD_CHANGED" as const,
      read: false,
      offsetMinutes: 10 + index * 3,
    },
    {
      id: stableId("intent", `${user.role}:mfa-enabled`),
      scope: "account" as const,
      userId: user.id,
      eventType: "MFA_ENABLED" as const,
      read: true,
      offsetMinutes: 11 + index * 3,
    },
    {
      id: stableId("intent", `${user.role}:mfa-disabled`),
      scope: "account" as const,
      userId: user.id,
      eventType: "MFA_DISABLED" as const,
      read: false,
      offsetMinutes: 12 + index * 3,
    },
  ]);
  return [...tenant, ...account];
}

const NOTIFICATIONS = notifications();

async function assertMigrationsCurrent(client: PoolClient): Promise<void> {
  const dir = fileURLToPath(
    new URL("../../../../packages/db/migrations", import.meta.url),
  );
  const files = (await readdir(dir))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const expected = await Promise.all(
    files.map(
      async (name) =>
        [
          name,
          createHash("sha256")
            .update(await readFile(`${dir}/${name}`))
            .digest("hex"),
        ] as const,
    ),
  );
  const applied = await client.query<{ name: string; sha256: string }>(
    "select name, sha256 from __nightwatch_migrations",
  );
  if (
    applied.rows.length !== expected.length ||
    expected.some(
      ([name, hash]) =>
        applied.rows.find((row) => row.name === name)?.sha256 !== hash,
    )
  ) {
    throw new Error(
      "database migrations are not current; run bun run db:migrate first",
    );
  }
}

async function acquireLock(client: PoolClient): Promise<void> {
  const end = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < end) {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)::bigint) as locked",
      [SEED_LOCK],
    );
    if (result.rows[0]?.locked) return;
    await setTimeout(50);
  }
  throw new Error(
    "local demo seed is already running; timed out waiting for lock",
  );
}

function identityConflict(): never {
  throw new Error("seed identity conflicts with existing data; refusing seed");
}

async function convergeIdentity(
  client: PoolClient,
  passwordHash: string,
): Promise<void> {
  for (const org of DEMO_ORGANIZATIONS) {
    const existing = await client.query<{
      id: string;
      name: string;
      slug: string;
    }>("select id, name, slug from organization where id = $1 or slug = $2", [
      org.id,
      org.slug,
    ]);
    if (
      existing.rows.some(
        (row) =>
          row.id !== org.id || row.name !== org.name || row.slug !== org.slug,
      )
    )
      identityConflict();
  }
  for (const user of DEMO_USERS) {
    const existing = await client.query<{
      id: string;
      name: string;
      email: string;
      email_verified: boolean;
    }>(
      'select id, name, email, email_verified from "user" where id = $1 or lower(email) = lower($2)',
      [user.id, user.email],
    );
    if (
      existing.rows.some(
        (row) =>
          row.id !== user.id ||
          row.name !== user.name ||
          row.email !== user.email ||
          !row.email_verified,
      )
    )
      identityConflict();
    const accountId = stableId("account", user.role);
    const account = await client.query<{
      id: string;
      account_id: string;
      provider_id: string;
      user_id: string;
    }>(
      "select id, account_id, provider_id, user_id from account where id = $1 or (provider_id = 'credential' and account_id = $2)",
      [accountId, user.id],
    );
    if (
      account.rows.some(
        (row) =>
          row.id !== accountId ||
          row.account_id !== user.id ||
          row.provider_id !== "credential" ||
          row.user_id !== user.id,
      )
    )
      identityConflict();
    for (const org of DEMO_ORGANIZATIONS) {
      const memberId = stableId("member", `${org.slug}:${user.role}`);
      const member = await client.query<{
        id: string;
        organization_id: string;
        user_id: string;
        role: string;
      }>(
        "select id, organization_id, user_id, role from member where id = $1 or (organization_id = $2::uuid and user_id = $3)",
        [memberId, org.id, user.id],
      );
      if (
        member.rows.some(
          (row) =>
            row.id !== memberId ||
            row.organization_id !== org.id ||
            row.user_id !== user.id ||
            row.role !== user.role,
        )
      )
        identityConflict();
    }
  }
  for (const org of DEMO_ORGANIZATIONS) {
    await client.query(
      "insert into organization (id, name, slug, created_at, updated_at) values ($1, $2, $3, now(), now()) on conflict do nothing",
      [org.id, org.name, org.slug],
    );
  }
  for (const user of DEMO_USERS) {
    await client.query(
      'insert into "user" (id, name, email, email_verified, last_active_tenant_id, created_at, updated_at) values ($1, $2, $3, true, $4, now(), now()) on conflict do nothing',
      [user.id, user.name, user.email, DEFAULT_ORGANIZATION_ID],
    );
    await client.query(
      'update "user" set last_active_tenant_id = $2, updated_at = now() where id = $1',
      [user.id, DEFAULT_ORGANIZATION_ID],
    );
    const accountId = stableId("account", user.role);
    await client.query(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ($1, $2, 'credential', $2, $3, now(), now()) on conflict do nothing",
      [accountId, user.id, passwordHash],
    );
    await client.query(
      "update account set password = $2, updated_at = now() where id = $1",
      [accountId, passwordHash],
    );
    for (const org of DEMO_ORGANIZATIONS) {
      await client.query(
        "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, $4, now(), now()) on conflict do nothing",
        [
          stableId("member", `${org.slug}:${user.role}`),
          org.id,
          user.id,
          user.role,
        ],
      );
    }
  }
}

type IntentRow = {
  origin: string;
  scope_kind: Scope;
  tenant_id: string | null;
  user_id: string | null;
  event_type: EventType;
  occurred_at: Date;
  expires_at: Date;
  actor_user_id: string | null;
  actor_display_name: string | null;
};
type RecipientRow = {
  recipient_user_id: string;
  origin: string;
  scope_kind: Scope;
  tenant_id: string | null;
  user_id: string | null;
};
type InboxRow = RecipientRow & {
  id: string;
  event_type: EventType;
  occurred_at: Date;
  expires_at: Date;
  read_at: Date | null;
  actor_user_id: string | null;
  actor_display_name: string | null;
};
type LedgerRow = {
  id: string;
  scope_kind: Scope;
  tenant_id: string | null;
  user_id: string | null;
  status: string;
  claim_token: string | null;
  claimed_at: Date | null;
  enqueued_at: Date | null;
  attempt_count: number;
  failure_reason: string | null;
  failure_summary: string | null;
};

function sameTime(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}
function expiresAt(occurredAt: Date): Date {
  return new Date(occurredAt.getTime() + 30 * 24 * 60 * 60_000);
}

async function assertNotificationGraph(
  client: PoolClient,
  exact: boolean,
  requireNoLedgers: boolean,
): Promise<void> {
  for (const notification of NOTIFICATIONS) {
    const intent = await client.query<IntentRow>(
      "select origin, scope_kind, tenant_id, user_id, event_type, occurred_at, expires_at, actor_user_id, actor_display_name from notification_intents where id = $1",
      [notification.id],
    );
    const [intentRow] = intent.rows;
    if (!intentRow) continue;
    const expectedUsers =
      notification.scope === "tenant"
        ? DEMO_USERS
        : DEMO_USERS.filter((user) => user.id === notification.userId);
    const invalidIntent =
      intent.rows.length !== 1 ||
      intentRow.origin !== notification.id ||
      intentRow.scope_kind !== notification.scope ||
      intentRow.tenant_id !== (notification.tenantId ?? null) ||
      intentRow.user_id !== (notification.userId ?? null) ||
      intentRow.event_type !== notification.eventType ||
      intentRow.actor_user_id !== null ||
      intentRow.actor_display_name !== null ||
      !sameTime(intentRow.expires_at, expiresAt(intentRow.occurred_at));
    const recipients = await client.query<RecipientRow>(
      "select recipient_user_id, origin, scope_kind, tenant_id, user_id from notification_intent_recipients where intent_id = $1",
      [notification.id],
    );
    const inbox = await client.query<InboxRow>(
      "select id, recipient_user_id, origin, scope_kind, tenant_id, user_id, event_type, occurred_at, expires_at, read_at, actor_user_id, actor_display_name from notification_inbox_items where intent_id = $1",
      [notification.id],
    );
    const ledger = await client.query<LedgerRow>(
      "select id, scope_kind, tenant_id, user_id, status, claim_token, claimed_at, enqueued_at, attempt_count, failure_reason, failure_summary from notification_dispatch_ledger where intent_id = $1",
      [notification.id],
    );
    const recipientIds = new Set(
      recipients.rows.map((row) => row.recipient_user_id),
    );
    const invalidRecipients =
      recipients.rows.length > expectedUsers.length ||
      recipients.rows.some(
        (row) =>
          !expectedUsers.some((user) => user.id === row.recipient_user_id) ||
          row.origin !== notification.id ||
          row.scope_kind !== notification.scope ||
          row.tenant_id !== (notification.tenantId ?? null) ||
          row.user_id !== (notification.userId ?? null),
      );
    const invalidInbox =
      inbox.rows.length > expectedUsers.length ||
      inbox.rows.some((row) => {
        const user = expectedUsers.find(
          (candidate) => candidate.id === row.recipient_user_id,
        );
        return (
          !user ||
          !recipientIds.has(row.recipient_user_id) ||
          row.id !== inboxId(notification.id, user.role) ||
          row.origin !== notification.id ||
          row.scope_kind !== notification.scope ||
          row.tenant_id !== (notification.tenantId ?? null) ||
          row.user_id !== (notification.userId ?? null) ||
          row.event_type !== notification.eventType ||
          row.actor_user_id !== null ||
          row.actor_display_name !== null ||
          !sameTime(row.occurred_at, intentRow.occurred_at) ||
          !sameTime(row.expires_at, expiresAt(intentRow.occurred_at)) ||
          (notification.read
            ? row.read_at === null ||
              !sameTime(row.read_at, intentRow.occurred_at)
            : row.read_at !== null)
        );
      });
    const [dispatch] = ledger.rows;
    const invalidLedger =
      ledger.rows.length > 1 ||
      (requireNoLedgers
        ? ledger.rows.length !== 0
        : ledger.rows.length === 1 &&
          (!dispatch ||
            dispatch.id !== stableId("ledger", notification.id) ||
            dispatch.scope_kind !== notification.scope ||
            dispatch.tenant_id !== (notification.tenantId ?? null) ||
            dispatch.user_id !== (notification.userId ?? null) ||
            dispatch.status !== "completed" ||
            dispatch.claim_token !== null ||
            dispatch.claimed_at !== null ||
            dispatch.enqueued_at !== null ||
            dispatch.attempt_count !== 0 ||
            dispatch.failure_reason !== null ||
            dispatch.failure_summary !== null));
    if (
      invalidIntent ||
      invalidRecipients ||
      invalidInbox ||
      invalidLedger ||
      (exact &&
        (recipients.rows.length !== expectedUsers.length ||
          inbox.rows.length !== expectedUsers.length))
    ) {
      throw new Error(
        "seed notification graph conflicts with existing data; refusing cleanup",
      );
    }
  }
}

async function cleanupNotifications(client: PoolClient): Promise<void> {
  await assertNotificationGraph(client, false, false);
  await client.query(
    "delete from notification_intents where id = any($1::text[])",
    [NOTIFICATIONS.map((item) => item.id)],
  );
}

async function createNotification(
  client: PoolClient,
  notification: NotificationSeed,
  occurredAt: Date,
): Promise<void> {
  await client.query(
    "insert into notification_intents (id, scope_kind, tenant_id, user_id, origin, event_type, occurred_at) values ($1, $2, $3::uuid, $4, $1, $5, $6)",
    [
      notification.id,
      notification.scope,
      notification.tenantId ?? null,
      notification.userId ?? null,
      notification.eventType,
      occurredAt,
    ],
  );
  const recipients =
    notification.scope === "tenant"
      ? DEMO_USERS
      : DEMO_USERS.filter((user) => user.id === notification.userId);
  for (const user of recipients) {
    await client.query(
      "insert into notification_intent_recipients (intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id) values ($1, $1, $2, $3, $4::uuid, $5)",
      [
        notification.id,
        user.id,
        notification.scope,
        notification.tenantId ?? null,
        notification.userId ?? null,
      ],
    );
    await client.query(
      "insert into notification_inbox_items (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id, user_id, event_type, occurred_at, read_at) values ($1, $2, $2, $3, $4, $5::uuid, $6, $7, $8, $9)",
      [
        inboxId(notification.id, user.role),
        notification.id,
        user.id,
        notification.scope,
        notification.tenantId ?? null,
        notification.userId ?? null,
        notification.eventType,
        occurredAt,
        notification.read ? occurredAt : null,
      ],
    );
  }
}

async function finalizeLedgers(
  client: PoolClient,
  fault?: SeedFault,
): Promise<void> {
  await client.query("begin");
  try {
    await assertNotificationGraph(client, true, true);
    for (const [index, item] of NOTIFICATIONS.entries()) {
      await client.query(
        "insert into notification_dispatch_ledger (id, intent_id, scope_kind, tenant_id, user_id, status) values ($1, $2, $3, $4::uuid, $5, 'completed')",
        [
          stableId("ledger", item.id),
          item.id,
          item.scope,
          item.tenantId ?? null,
          item.userId ?? null,
        ],
      );
      if (fault === "during-finalization" && index === 0)
        throw new Error("injected seed finalization failure");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function seedLocalDemo(
  ownerUrl: string,
  runtimeUrl: string,
  options: SeedOptions = {},
): Promise<void> {
  assertLocalSeedTarget(ownerUrl, "nightwatch_owner");
  assertLocalSeedTarget(runtimeUrl, "nightwatch");
  const owner = createDatabase(ownerUrl);
  const runtime = createDatabase(runtimeUrl);
  try {
    const client = await owner.sql.connect();
    try {
      await acquireLock(client);
      await assertMigrationsCurrent(client);
      await client.query("begin");
      try {
        await convergeIdentity(client, await hashPassword(PASSWORD));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
      await client.query("begin");
      try {
        await cleanupNotifications(client);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
      const now = options.now ?? new Date();
      for (const item of NOTIFICATIONS) {
        const occurredAt = new Date(
          now.getTime() - item.offsetMinutes * 60_000,
        );
        if (item.scope === "tenant") {
          if (!item.tenantId)
            throw new Error("tenant seed notification is invalid");
          await withTenantContextRaw(runtime, item.tenantId, (scoped) =>
            createNotification(scoped, item, occurredAt),
          );
        } else {
          if (!item.userId)
            throw new Error("account seed notification is invalid");
          await withAccountContextRaw(runtime, item.userId, (scoped) =>
            createNotification(scoped, item, occurredAt),
          );
        }
      }
      if (options.fault === "after-runtime")
        throw new Error("injected seed runtime failure");
      await finalizeLedgers(client, options.fault);
    } finally {
      await client
        .query("select pg_advisory_unlock(hashtext($1)::bigint)", [SEED_LOCK])
        .catch(() => undefined);
      client.release();
    }
  } finally {
    await runtime.close();
    await owner.close();
  }
}
