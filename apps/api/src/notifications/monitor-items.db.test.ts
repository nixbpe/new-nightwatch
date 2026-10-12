import { notificationListResponseSchema } from "@nightwatch/api-contract";
import {
  createDatabase,
  insertMonitorNotificationIntent,
  runMigrations,
  withTenantContextRaw,
  type MonitorNotificationEventType,
} from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  countUnreadInbox,
  listInbox,
  markAllInboxRead,
  markInboxItemRead,
} from "./service";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = crypto.randomUUID().slice(0, 8);
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const ownerUser = crypto.randomUUID();
const viewerUser = crypto.randomUUID();
const ownerToken = `monitor-items-owner-${run}`;
const viewerToken = `monitor-items-viewer-${run}`;
const projectId = crypto.randomUUID();
const otherProjectId = crypto.randomUUID();
const monitorId = crypto.randomUUID();
const otherMonitorId = crypto.randomUUID();
const deps = { database, cursorSecret: "monitor-items-secret" };
const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

const EVENTS: {
  eventType: MonitorNotificationEventType;
  reason: string | null;
  sslNotAfter: Date | null;
}[] = [
  { eventType: "MONITOR_DOWN", reason: "http_status", sslNotAfter: null },
  { eventType: "MONITOR_RECOVERED", reason: null, sslNotAfter: null },
  {
    eventType: "MONITOR_SSL_CAUTION",
    reason: null,
    sslNotAfter: new Date("2027-01-01T00:00:00.000Z"),
  },
  {
    eventType: "MONITOR_SSL_DANGER",
    reason: null,
    sslNotAfter: new Date("2027-01-01T00:00:00.000Z"),
  },
  {
    eventType: "MONITOR_SSL_EXPIRED",
    reason: null,
    sslNotAfter: new Date("2027-01-01T00:00:00.000Z"),
  },
];

/** What materialize does for a completed dispatch, for the recipients the writer snapshotted. */
async function materialize(tenantId: string): Promise<void> {
  await owner.query(
    `insert into notification_inbox_items
       (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id,
        event_type, occurred_at, subject_project_id, subject_monitor_id,
        subject_monitor_name, monitor_reason, ssl_not_after)
     select gen_random_uuid()::text, intent.id, intent.origin,
            recipient.recipient_user_id, 'tenant', intent.tenant_id,
            intent.event_type, intent.occurred_at, intent.subject_project_id,
            intent.subject_monitor_id,
            intent.subject_monitor_name, intent.monitor_reason, intent.ssl_not_after
     from notification_intents intent
     join notification_intent_recipients recipient on recipient.intent_id = intent.id
     where intent.tenant_id = $1`,
    [tenantId],
  );
  await owner.query(
    `update notification_dispatch_ledger set status = 'completed'
     where tenant_id = $1`,
    [tenantId],
  );
}

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.connect();
  for (const id of [orgA, orgB]) {
    await owner.query(
      "insert into organization (id, name, slug) values ($1, $2, $3)",
      [id, `Monitor items ${run}`, `monitor-items-${id.slice(0, 8)}-${run}`],
    );
  }
  for (const [id, name] of [
    [ownerUser, "owner"],
    [viewerUser, "viewer"],
  ] as const) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified, last_active_tenant_id)
       values ($1, $2, $3, true, $4)`,
      [id, name, `monitor-items-${name}-${run}@example.test`, orgA],
    );
  }
  for (const [user, token] of [
    [ownerUser, ownerToken],
    [viewerUser, viewerToken],
  ]) {
    await owner.query(
      `insert into session (id, token, user_id, expires_at, active_organization_id)
       values ($1, $2, $3, now() + interval '1 day', $4)`,
      [crypto.randomUUID(), token, user, orgA],
    );
  }
  for (const [org, user, role] of [
    [orgA, ownerUser, "owner"],
    [orgB, ownerUser, "admin"],
    [orgA, viewerUser, "viewer"],
  ]) {
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [crypto.randomUUID(), org, user, role],
    );
  }
  // No monitors or projects rows: the notifications must not depend on either still existing.
  let offset = 0;
  for (const event of EVENTS) {
    offset += 1;
    await withTenantContextRaw(database, orgA, (client) =>
      insertMonitorNotificationIntent(client, {
        tenantId: orgA,
        projectId,
        monitorId,
        monitorName: "Checkout",
        origin: `monitor:${monitorId}:${event.eventType}:${run}`,
        occurredAt: new Date(Date.now() - 60_000 + offset * 1_000),
        ...event,
      }),
    );
  }
  await withTenantContextRaw(database, orgB, (client) =>
    insertMonitorNotificationIntent(client, {
      tenantId: orgB,
      projectId: otherProjectId,
      monitorId: otherMonitorId,
      monitorName: "Other org monitor",
      eventType: "MONITOR_DOWN",
      origin: `monitor:${otherMonitorId}:down:${run}`,
      occurredAt: new Date(),
      reason: "timeout",
      sslNotAfter: null,
    }),
  );
  await materialize(orgA);
  await materialize(orgB);
}, 120_000);

afterAll(async () => {
  await owner.query('delete from "user" where id = any($1::text[])', [
    [ownerUser, viewerUser],
  ]);
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [orgA, orgB],
  ]);
  await owner.end();
  await database.close();
});

describe("monitor notification inbox items", () => {
  it("lists all five event types of the active organization with subject, reason and expiry", async () => {
    const list = notificationListResponseSchema.parse(
      await listInbox(deps, {
        userId: ownerUser,
        sessionToken: ownerToken,
        limit: 20,
      }),
    );
    expect(list.organizationId).toBe(orgA);
    expect(
      list.items.map((item) => [
        item.eventType,
        "reason" in item ? item.reason : undefined,
        "sslNotAfter" in item ? item.sslNotAfter : undefined,
      ]),
    ).toEqual([
      ["MONITOR_SSL_EXPIRED", null, "2027-01-01T00:00:00.000Z"],
      ["MONITOR_SSL_DANGER", null, "2027-01-01T00:00:00.000Z"],
      ["MONITOR_SSL_CAUTION", null, "2027-01-01T00:00:00.000Z"],
      ["MONITOR_RECOVERED", null, null],
      ["MONITOR_DOWN", "http_status", null],
    ]);
    for (const item of list.items) {
      expect(item).toMatchObject({
        scope: "organization",
        organizationId: orgA,
        category: "monitor",
        actor: null,
        subject: { projectId, monitorId, monitorName: "Checkout" },
      });
    }
  });

  it("shows another organization's items only after that organization is active", async () => {
    await owner.query(
      'update "user" set last_active_tenant_id = $1 where id = $2',
      [orgB, ownerUser],
    );
    await owner.query(
      "update session set active_organization_id = $1 where token = $2",
      [orgB, ownerToken],
    );
    const list = await listInbox(deps, {
      userId: ownerUser,
      sessionToken: ownerToken,
      limit: 20,
    });
    expect(list.organizationId).toBe(orgB);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      eventType: "MONITOR_DOWN",
      reason: "timeout",
      subject: { projectId: otherProjectId, monitorId: otherMonitorId },
    });
  });

  it("gives a viewer no monitor items", async () => {
    const list = await listInbox(deps, {
      userId: viewerUser,
      sessionToken: viewerToken,
      limit: 20,
    });
    expect(list.items).toEqual([]);
  });
});

describe("monitor items follow Project access", () => {
  const org = crypto.randomUUID();
  const project = crypto.randomUUID();
  const users = {
    member: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    ownerOnly: crypto.randomUUID(),
  };
  const monitor = crypto.randomUUID();
  let settingsIntent = "";

  const read = (userId: string) =>
    listInbox(deps, { userId, sessionToken: "unused", limit: 20 });
  const names = async (userId: string) =>
    (await read(userId)).items.map((item) => item.eventType);
  const unread = async (userId: string) =>
    (await countUnreadInbox(deps, { userId, sessionToken: "unused" }))
      .unreadCount;

  beforeAll(async () => {
    await owner.query(
      "insert into organization (id, name, slug) values ($1, 'Items access', $2)",
      [org, `items-access-${run}`],
    );
    for (const [name, id] of Object.entries(users)) {
      await owner.query(
        `insert into "user" (id, name, email, email_verified, last_active_tenant_id)
         values ($1, $2, $3, true, $4)`,
        [id, name, `items-access-${name}-${run}@example.test`, org],
      );
      await owner.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [
          crypto.randomUUID(),
          org,
          id,
          name === "admin"
            ? "admin"
            : name === "ownerOnly"
              ? "owner"
              : "viewer",
        ],
      );
    }
    await owner.query(
      "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'P', $3)",
      [project, org, `p-${run}`],
    );
    await owner.query(
      `insert into project_members (project_id, tenant_id, user_id, role)
       values ($1, $2, $3, 'member')`,
      [project, org, users.member],
    );
    await withTenantContextRaw(database, org, (client) =>
      insertMonitorNotificationIntent(client, {
        tenantId: org,
        projectId: project,
        monitorId: monitor,
        monitorName: "Guarded",
        eventType: "MONITOR_DOWN",
        origin: `monitor:${monitor}:down:${run}`,
        occurredAt: new Date(),
        reason: "timeout",
        sslNotAfter: null,
      }),
    );
    // A non-monitor item that every member keeps seeing.
    settingsIntent = crypto.randomUUID();
    await owner.query(
      `insert into notification_intents
         (id, scope_kind, tenant_id, origin, event_type, occurred_at)
       values ($1, 'tenant', $2, $3, 'ORG-NOTIFICATION-SETTINGS-CHANGED', now())`,
      [settingsIntent, org, `settings-${run}`],
    );
    await owner.query(
      `insert into notification_intent_recipients
         (intent_id, origin, recipient_user_id, scope_kind, tenant_id)
       values ($1, $2, $3, 'tenant', $4)`,
      [settingsIntent, `settings-${run}`, users.member, org],
    );
    await owner.query(
      `insert into notification_dispatch_ledger (id, intent_id, scope_kind, tenant_id)
       values ($1, $2, 'tenant', $3)`,
      [crypto.randomUUID(), settingsIntent, org],
    );
    await materialize(org);
  }, 60_000);

  afterAll(async () => {
    await owner.query("delete from organization where id = $1", [org]);
    await owner.query('delete from "user" where id = any($1::text[])', [
      Object.values(users),
    ]);
  });

  const removeFromProject = () =>
    owner.query(
      "delete from project_members where project_id = $1 and user_id = $2",
      [project, users.member],
    );
  const addToProject = () =>
    owner.query(
      `insert into project_members (project_id, tenant_id, user_id, role)
       values ($1, $2, $3, 'member')`,
      [project, org, users.member],
    );
  const itemOf = async (userId: string) =>
    (
      await owner.query<{ id: string; read_at: Date | null }>(
        `select id, read_at from notification_inbox_items
         where recipient_user_id = $1 and event_type = 'MONITOR_DOWN'`,
        [userId],
      )
    ).rows[0];

  it("serves the item to a Project member and to an Organization admin", async () => {
    expect(await names(users.member)).toContain("MONITOR_DOWN");
    expect(await names(users.admin)).toEqual(["MONITOR_DOWN"]);
    expect(await unread(users.member)).toBe(2);
  });

  it("a member removed from the Project loses the item in the list, the unread count, mark-one and mark-all, and keeps other items", async () => {
    const item = await itemOf(users.member);
    await removeFromProject();
    expect(await names(users.member)).toEqual([
      "ORG-NOTIFICATION-SETTINGS-CHANGED",
    ]);
    expect(await unread(users.member)).toBe(1);
    await expect(
      markInboxItemRead(deps, {
        userId: users.member,
        sessionToken: "unused",
        itemId: must(item).id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const all = await markAllInboxRead(deps, {
      userId: users.member,
      sessionToken: "unused",
      expectedOrganizationId: org,
    });
    expect(all.markedCount).toBe(1);
    expect((await itemOf(users.member))?.read_at).toBeNull();
  });

  it("a member added back regains the item, still unread", async () => {
    await addToProject();
    expect(await names(users.member)).toContain("MONITOR_DOWN");
    expect(await unread(users.member)).toBe(1);
  });

  it("an Organization admin demoted to viewer without a Project membership loses the item", async () => {
    await owner.query(
      "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
      [org, users.admin],
    );
    expect(await names(users.admin)).toEqual([]);
    expect(await unread(users.admin)).toBe(0);
    await owner.query(
      "update member set role = 'admin' where organization_id = $1 and user_id = $2",
      [org, users.admin],
    );
    expect(await names(users.admin)).toEqual(["MONITOR_DOWN"]);
  });

  it("items of a deleted Project survive it for Owner/Admin and disappear for members", async () => {
    await owner.query("delete from projects where id = $1", [project]);
    expect(await names(users.member)).toEqual([
      "ORG-NOTIFICATION-SETTINGS-CHANGED",
    ]);
    expect(await names(users.admin)).toEqual(["MONITOR_DOWN"]);
  });
});

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}
