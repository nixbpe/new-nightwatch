import type { OrganizationNotificationSettings } from "@nightwatch/api-contract";
import { createDatabase, type Database } from "@nightwatch/db";
import {
  Client,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { revokeOrganizationMember } from "./members";
import {
  getOrganizationNotificationSettings,
  updateOrganizationNotificationSettings,
} from "./service";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const adminId = crypto.randomUUID();
const targetId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const ownerMemberId = crypto.randomUUID();
const adminMemberId = crypto.randomUUID();
const targetMemberId = crypto.randomUUID();
const viewerMemberId = crypto.randomUUID();
const database: Database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });

async function count(query: string, values: unknown[]): Promise<number> {
  const result = await owner.query<{ count: number }>(query, values);
  return result.rows[0]?.count ?? 0;
}

beforeAll(async () => {
  await owner.connect();
  await owner.query(
    `insert into organization (id, name, slug, created_at)
     values ($1, $2, $3, now())`,
    [organizationId, `N3 ${run}`, `n3-${run}`],
  );
  const users = [
    { id: ownerId, name: "Owner" },
    { id: adminId, name: "Admin" },
    { id: targetId, name: "Target" },
    { id: viewerId, name: "Viewer" },
  ];
  for (const user of users) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())`,
      [user.id, user.name, `${user.name.toLowerCase()}-${run}@example.test`],
    );
  }
  await owner.query(
    `insert into member (id, organization_id, user_id, role, created_at, updated_at)
     values ($1, $2, $3, 'owner', now(), now()),
            ($4, $2, $5, 'admin,viewer', now(), now()),
            ($6, $2, $7, 'viewer', now(), now()),
            ($8, $2, $9, 'viewer', now(), now())`,
    [
      ownerMemberId,
      organizationId,
      ownerId,
      adminMemberId,
      adminId,
      targetMemberId,
      targetId,
      viewerMemberId,
      viewerId,
    ],
  );
  await owner.query(
    `insert into session (id, expires_at, token, user_id, active_organization_id)
     values ($1, now() + interval '1 hour', $2, $3, $4)`,
    [crypto.randomUUID(), `n3-${run}`, targetId, organizationId],
  );
  await owner.query(
    `update "user" set last_active_tenant_id = $1 where id = $2`,
    [organizationId, targetId],
  );
});

afterAll(async () => {
  await owner.query("delete from organization where id = $1", [organizationId]);
  await owner.query(`delete from "user" where id = any($1::text[])`, [
    [ownerId, adminId, targetId, viewerId],
  ]);
  await owner.end();
  await database.sql.end();
});

describe("organization notification mutations", () => {
  it("rejects stale CAS before a no-op and emits no intent", async () => {
    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId,
        userId: ownerId,
        actorDisplayName: "Owner",
        update: { expectedVersion: 1, settingsChangedEnabled: true },
      }),
    ).rejects.toMatchObject({ code: "SETTINGS_VERSION_CONFLICT" });
    expect(
      await count(
        "select count(*)::int as count from notification_intents where tenant_id = $1",
        [organizationId],
      ),
    ).toBe(0);
  });

  it("uses the old disabled value to avoid an intent", async () => {
    await updateOrganizationNotificationSettings(database, {
      organizationId,
      userId: ownerId,
      actorDisplayName: "Owner",
      update: { expectedVersion: 0, settingsChangedEnabled: false },
    });
    await updateOrganizationNotificationSettings(database, {
      organizationId,
      userId: ownerId,
      actorDisplayName: "Owner",
      update: { expectedVersion: 1, settingsChangedEnabled: true },
    });
    expect(
      await count(
        "select count(*)::int as count from notification_intents where tenant_id = $1",
        [organizationId],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as count
         from notification_intent_recipients
         where tenant_id = $1 and recipient_user_id = $2`,
        [organizationId, adminId],
      ),
    ).toBe(1);
  });
});

describe("organization notification settings authorization", () => {
  const authorizationRun = crypto.randomUUID().slice(0, 8);
  const organizationAId = crypto.randomUUID();
  const organizationBId = crypto.randomUUID();
  const authorizationOwnerId = crypto.randomUUID();
  const authorizationAdminId = crypto.randomUUID();
  const authorizationCombinedAdminId = crypto.randomUUID();
  const authorizationViewerId = crypto.randomUUID();
  const authorizationAuditorId = crypto.randomUUID();
  const authorizationSubstringRoleId = crypto.randomUUID();
  const authorizationMemberIds = Array.from({ length: 6 }, () =>
    crypto.randomUUID(),
  );

  async function authorizationCounts(tenantId: string) {
    const result = await owner.query<{
      settingsCount: number;
      intentCount: number;
      ledgerCount: number;
    }>(
      `select
         (select count(*)::int from notification_org_settings where tenant_id = $1) as "settingsCount",
         (select count(*)::int from notification_intents where tenant_id = $1) as "intentCount",
         (select count(*)::int
          from notification_dispatch_ledger as ledger
          join notification_intents as intent on intent.id = ledger.intent_id
          where intent.tenant_id = $1) as "ledgerCount"`,
      [tenantId],
    );
    const counts = result.rows[0];
    if (!counts) throw new Error("authorization counts missing");
    return counts;
  }

  beforeAll(async () => {
    await owner.query(
      `insert into organization (id, name, slug, created_at)
       values ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [
        organizationAId,
        `N3 authorization A ${authorizationRun}`,
        `n3-authorization-a-${authorizationRun}`,
        organizationBId,
        `N3 authorization B ${authorizationRun}`,
        `n3-authorization-b-${authorizationRun}`,
      ],
    );
    const users = [
      { id: authorizationOwnerId, name: "Authorization Owner" },
      { id: authorizationAdminId, name: "Authorization Admin" },
      {
        id: authorizationCombinedAdminId,
        name: "Authorization Combined Admin",
      },
      { id: authorizationViewerId, name: "Authorization Viewer" },
      { id: authorizationAuditorId, name: "Authorization Auditor" },
      {
        id: authorizationSubstringRoleId,
        name: "Authorization Substring Role",
      },
    ];
    for (const user of users) {
      await owner.query(
        `insert into "user" (id, name, email, email_verified, created_at, updated_at)
         values ($1, $2, $3, true, now(), now())`,
        [
          user.id,
          user.name,
          `${user.name.toLowerCase().replaceAll(" ", "-")}-${authorizationRun}@example.test`,
        ],
      );
    }
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now()),
              ($4, $2, $5, 'admin', now(), now()),
              ($6, $2, $7, 'admin, viewer', now(), now()),
              ($8, $2, $9, 'viewer', now(), now()),
              ($10, $2, $11, 'auditor', now(), now()),
              ($12, $2, $13, 'administrator', now(), now())`,
      [
        authorizationMemberIds[0],
        organizationAId,
        authorizationOwnerId,
        authorizationMemberIds[1],
        authorizationAdminId,
        authorizationMemberIds[2],
        authorizationCombinedAdminId,
        authorizationMemberIds[3],
        authorizationViewerId,
        authorizationMemberIds[4],
        authorizationAuditorId,
        authorizationMemberIds[5],
        authorizationSubstringRoleId,
      ],
    );
    await owner.query(
      `insert into session (id, expires_at, token, user_id, active_organization_id)
       values ($1, now() + interval '1 hour', $2, $3, $4)`,
      [
        crypto.randomUUID(),
        `n3-authorization-${authorizationRun}`,
        authorizationOwnerId,
        organizationAId,
      ],
    );
  });

  afterAll(async () => {
    await owner.query("delete from organization where id = any($1::uuid[])", [
      [organizationAId, organizationBId],
    ]);
    await owner.query(`delete from "user" where id = any($1::text[])`, [
      [
        authorizationOwnerId,
        authorizationAdminId,
        authorizationCombinedAdminId,
        authorizationViewerId,
        authorizationAuditorId,
        authorizationSubstringRoleId,
      ],
    ]);
  });

  it("allows only owner and exact admin role tokens to read and compare-and-swap settings", async () => {
    await expect(
      getOrganizationNotificationSettings(database, {
        organizationId: organizationAId,
        userId: authorizationOwnerId,
      }),
    ).resolves.toMatchObject({ organizationId: organizationAId, version: 0 });
    await expect(
      getOrganizationNotificationSettings(database, {
        organizationId: organizationAId,
        userId: authorizationAdminId,
      }),
    ).resolves.toMatchObject({ organizationId: organizationAId, version: 0 });
    await expect(
      getOrganizationNotificationSettings(database, {
        organizationId: organizationAId,
        userId: authorizationCombinedAdminId,
      }),
    ).resolves.toMatchObject({ organizationId: organizationAId, version: 0 });

    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId: organizationAId,
        userId: authorizationOwnerId,
        actorDisplayName: "Authorization Owner",
        update: { expectedVersion: 0, settingsChangedEnabled: false },
      }),
    ).resolves.toMatchObject({ settingsChangedEnabled: false, version: 1 });
    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId: organizationAId,
        userId: authorizationAdminId,
        actorDisplayName: "Authorization Admin",
        update: { expectedVersion: 1, settingsChangedEnabled: true },
      }),
    ).resolves.toMatchObject({ settingsChangedEnabled: true, version: 2 });
    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId: organizationAId,
        userId: authorizationCombinedAdminId,
        actorDisplayName: "Authorization Combined Admin",
        update: { expectedVersion: 2, settingsChangedEnabled: false },
      }),
    ).resolves.toMatchObject({ settingsChangedEnabled: false, version: 3 });
  });

  it("denies viewers, auditors, and substring roles without changing settings, intents, or ledger rows", async () => {
    const deniedMembers = [
      authorizationViewerId,
      authorizationAuditorId,
      authorizationSubstringRoleId,
    ];
    const before = await authorizationCounts(organizationAId);

    for (const userId of deniedMembers) {
      await expect(
        getOrganizationNotificationSettings(database, {
          organizationId: organizationAId,
          userId,
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
      await expect(
        updateOrganizationNotificationSettings(database, {
          organizationId: organizationAId,
          userId,
          actorDisplayName: "Denied",
          update: { expectedVersion: 3, settingsChangedEnabled: true },
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    }
    expect(await authorizationCounts(organizationAId)).toEqual(before);
  });

  it("denies an organization A actor against an inactive organization B URL without mutations", async () => {
    const before = await authorizationCounts(organizationBId);

    await expect(
      getOrganizationNotificationSettings(database, {
        organizationId: organizationBId,
        userId: authorizationOwnerId,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "MEMBERSHIP_DENIED" });
    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId: organizationBId,
        userId: authorizationOwnerId,
        actorDisplayName: "Authorization Owner",
        update: { expectedVersion: 0, settingsChangedEnabled: false },
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "MEMBERSHIP_DENIED" });
    expect(await authorizationCounts(organizationBId)).toEqual(before);
  });
});

describe("organization notification settings rollback", () => {
  const rollbackRun = crypto.randomUUID().slice(0, 8);
  const rollbackOrganizationId = crypto.randomUUID();
  const rollbackOwnerId = crypto.randomUUID();
  const rollbackAdminId = crypto.randomUUID();
  const rollbackOwnerMemberId = crypto.randomUUID();
  const rollbackAdminMemberId = crypto.randomUUID();

  type Snapshot = {
    settingsChangedEnabled: boolean | null;
    version: number | null;
    intentCount: number;
    recipientCount: number;
    ledgerCount: number;
  };

  type FaultEvidence = {
    triggered: boolean;
    intentId: string | null;
    dispatchReturned: boolean;
  };

  async function snapshot(): Promise<Snapshot> {
    const result = await owner.query<Snapshot>(
      `select
         (select org_settings_changed_enabled
          from notification_org_settings
          where tenant_id = $1) as "settingsChangedEnabled",
         (select version
          from notification_org_settings
          where tenant_id = $1) as "version",
         (select count(*)::int
          from notification_intents
          where tenant_id = $1) as "intentCount",
         (select count(*)::int
          from notification_intent_recipients
          where tenant_id = $1) as "recipientCount",
         (select count(*)::int
          from notification_dispatch_ledger as ledger
          join notification_intents as intent on intent.id = ledger.intent_id
          where intent.tenant_id = $1) as "ledgerCount"`,
      [rollbackOrganizationId],
    );
    const state = result.rows[0];
    if (!state) throw new Error("rollback snapshot missing");
    return state;
  }

  function databaseThatFailsAfter(
    point: "settings" | "dispatch",
    evidence: FaultEvidence,
  ): Database {
    return {
      ...database,
      sql: new Proxy(database.sql, {
        get(target, property, receiver) {
          if (property !== "connect")
            return Reflect.get(target, property, receiver) as unknown;
          return async (): Promise<PoolClient> => {
            const client = await target.connect();
            const originalQuery = client.query.bind(client);
            const query = async <Row extends QueryResultRow>(
              text: string,
              values?: unknown[],
            ): Promise<QueryResult<Row>> => {
              const result = await originalQuery<Row>(text, values);
              if (!Array.isArray(values) || evidence.triggered) {
                return result;
              }
              if (
                text.includes("insert into notification_intents") &&
                values[1] === rollbackOrganizationId &&
                typeof values[0] === "string"
              ) {
                evidence.intentId = values[0];
                return result;
              }
              if (
                point === "settings" &&
                text.includes("insert into notification_org_settings") &&
                values[0] === rollbackOrganizationId
              ) {
                evidence.triggered = true;
                throw new Error("injected fault after settings mutation");
              }
              if (
                point === "dispatch" &&
                text.includes("select create_notification_dispatch") &&
                values[1] === evidence.intentId
              ) {
                evidence.dispatchReturned = true;
                evidence.triggered = true;
                throw new Error("injected fault after dispatch mutation");
              }
              return result;
            };
            client.query = query as PoolClient["query"];
            const originalRelease = client.release.bind(client);
            client.release = (error?: Error | boolean): void => {
              client.query = originalQuery;
              client.release = originalRelease;
              originalRelease(error);
            };
            return client;
          };
        },
      }),
    };
  }

  beforeAll(async () => {
    await owner.query(
      `insert into organization (id, name, slug, created_at)
       values ($1, $2, $3, now())`,
      [
        rollbackOrganizationId,
        `N3 rollback ${rollbackRun}`,
        `n3-rollback-${rollbackRun}`,
      ],
    );
    await owner.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Rollback Owner', $2, true, now(), now()),
              ($3, 'Rollback Admin', $4, true, now(), now())`,
      [
        rollbackOwnerId,
        `rollback-owner-${rollbackRun}@example.test`,
        rollbackAdminId,
        `rollback-admin-${rollbackRun}@example.test`,
      ],
    );
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now()),
              ($4, $2, $5, 'admin', now(), now())`,
      [
        rollbackOwnerMemberId,
        rollbackOrganizationId,
        rollbackOwnerId,
        rollbackAdminMemberId,
        rollbackAdminId,
      ],
    );
  });

  afterAll(async () => {
    await owner.query("delete from organization where id = $1", [
      rollbackOrganizationId,
    ]);
    await owner.query(`delete from "user" where id = any($1::text[])`, [
      [rollbackOwnerId, rollbackAdminId],
    ]);
  });

  it("rolls back settings, intents, recipients, and ledger rows after post-mutation faults", async () => {
    const defaultPrestate = await snapshot();
    expect(defaultPrestate).toEqual({
      settingsChangedEnabled: null,
      version: null,
      intentCount: 0,
      recipientCount: 0,
      ledgerCount: 0,
    });

    const settingsFault: FaultEvidence = {
      triggered: false,
      intentId: null,
      dispatchReturned: false,
    };
    await expect(
      updateOrganizationNotificationSettings(
        databaseThatFailsAfter("settings", settingsFault),
        {
          organizationId: rollbackOrganizationId,
          userId: rollbackOwnerId,
          actorDisplayName: "Rollback Owner",
          update: { expectedVersion: 0, settingsChangedEnabled: false },
        },
      ),
    ).rejects.toThrow("injected fault after settings mutation");
    expect(settingsFault).toEqual({
      triggered: true,
      intentId: null,
      dispatchReturned: false,
    });
    expect(await snapshot()).toEqual(defaultPrestate);

    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId: rollbackOrganizationId,
        userId: rollbackOwnerId,
        actorDisplayName: "Rollback Owner",
        update: { expectedVersion: 0, settingsChangedEnabled: false },
      }),
    ).resolves.toMatchObject({ settingsChangedEnabled: false, version: 1 });
    expect(await snapshot()).toEqual({
      settingsChangedEnabled: false,
      version: 1,
      intentCount: 1,
      recipientCount: 1,
      ledgerCount: 1,
    });

    await updateOrganizationNotificationSettings(database, {
      organizationId: rollbackOrganizationId,
      userId: rollbackOwnerId,
      actorDisplayName: "Rollback Owner",
      update: { expectedVersion: 1, settingsChangedEnabled: true },
    });
    const existingPrestate = await snapshot();
    expect(existingPrestate).toEqual({
      settingsChangedEnabled: true,
      version: 2,
      intentCount: 1,
      recipientCount: 1,
      ledgerCount: 1,
    });

    const dispatchFault: FaultEvidence = {
      triggered: false,
      intentId: null,
      dispatchReturned: false,
    };
    await expect(
      updateOrganizationNotificationSettings(
        databaseThatFailsAfter("dispatch", dispatchFault),
        {
          organizationId: rollbackOrganizationId,
          userId: rollbackOwnerId,
          actorDisplayName: "Rollback Owner",
          update: { expectedVersion: 2, settingsChangedEnabled: false },
        },
      ),
    ).rejects.toThrow("injected fault after dispatch mutation");
    expect(dispatchFault.triggered).toBe(true);
    expect(typeof dispatchFault.intentId).toBe("string");
    expect(dispatchFault.dispatchReturned).toBe(true);
    expect(await snapshot()).toEqual(existingPrestate);

    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId: rollbackOrganizationId,
        userId: rollbackOwnerId,
        actorDisplayName: "Rollback Owner",
        update: { expectedVersion: 2, settingsChangedEnabled: false },
      }),
    ).resolves.toMatchObject({ settingsChangedEnabled: false, version: 3 });
    expect(await snapshot()).toEqual({
      settingsChangedEnabled: false,
      version: 3,
      intentCount: 2,
      recipientCount: 2,
      ledgerCount: 2,
    });
  });
});

describe("organization notification settings read revocation linearization", () => {
  const linearizationRun = crypto.randomUUID().slice(0, 8);
  const linearizationOrganizationId = crypto.randomUUID();
  const linearizationOwnerId = crypto.randomUUID();
  const linearizationTargetId = crypto.randomUUID();
  const linearizationOwnerMemberId = crypto.randomUUID();
  const linearizationTargetMemberId = crypto.randomUUID();

  async function waitForBlockedQuery(
    queryPattern: string,
    blockerPid: number,
    message: string,
  ): Promise<number> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const blocked = await owner.query<{ pid: number }>(
        `select pid from pg_stat_activity
         where datname = current_database()
           and pid <> pg_backend_pid()
           and state = 'active'
           and wait_event_type = 'Lock'
           and query like $1
           and $2 = any(pg_blocking_pids(pid))`,
        [queryPattern, blockerPid],
      );
      const pid = blocked.rows[0]?.pid;
      if (pid) return pid;
      // PostgreSQL lock state has no notification channel, so fake timers cannot observe it.
      const delay = Promise.withResolvers<undefined>();
      setTimeout(() => {
        delay.resolve(undefined);
      }, 25);
      await delay.promise;
    }
    throw new Error(message);
  }

  beforeAll(async () => {
    await owner.query(
      `insert into organization (id, name, slug, created_at)
       values ($1, $2, $3, now())`,
      [
        linearizationOrganizationId,
        `N3 settings linearization ${linearizationRun}`,
        `n3-settings-linearization-${linearizationRun}`,
      ],
    );
    for (const [id, name] of [
      [linearizationOwnerId, "Linearization Owner"],
      [linearizationTargetId, "Linearization Target"],
    ] satisfies readonly [string, string][]) {
      await owner.query(
        `insert into "user" (id, name, email, email_verified, created_at, updated_at)
         values ($1, $2, $3, true, now(), now())`,
        [
          id,
          name,
          `${name.replaceAll(" ", "-")}-${linearizationRun}@example.test`,
        ],
      );
    }
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now()),
              ($4, $2, $5, 'admin', now(), now())`,
      [
        linearizationOwnerMemberId,
        linearizationOrganizationId,
        linearizationOwnerId,
        linearizationTargetMemberId,
        linearizationTargetId,
      ],
    );
    await owner.query(
      `insert into notification_org_settings
        (tenant_id, org_settings_changed_enabled, version)
       values ($1, true, 1)`,
      [linearizationOrganizationId],
    );
  });

  beforeEach(async () => {
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'admin', now(), now())
       on conflict (id) do nothing`,
      [
        linearizationTargetMemberId,
        linearizationOrganizationId,
        linearizationTargetId,
      ],
    );
  });

  afterAll(async () => {
    await owner.query("delete from organization where id = $1", [
      linearizationOrganizationId,
    ]);
    await owner.query(`delete from "user" where id = any($1::text[])`, [
      [linearizationOwnerId, linearizationTargetId],
    ]);
  });

  it("denies a settings read after a blocking revoke commits first", async () => {
    const holder = new Client({ connectionString: ownerUrl });
    let holderOpen = false;
    let revoke: Promise<unknown> | undefined;
    let read: Promise<unknown> | undefined;
    try {
      await holder.connect();
      await holder.query("begin");
      holderOpen = true;
      const held = await holder.query<{ pid: number }>(
        `select pg_backend_pid() as pid from member
         where id = $1 for update`,
        [linearizationTargetMemberId],
      );
      const holderPid = held.rows[0]?.pid;
      if (!holderPid) throw new Error("holder backend PID was not returned");

      revoke = revokeOrganizationMember(database, {
        organizationId: linearizationOrganizationId,
        actorUserId: linearizationOwnerId,
        memberId: linearizationTargetMemberId,
      });
      const revokePid = await waitForBlockedQuery(
        "%from member%and id = $2%for update%",
        holderPid,
        "revoke did not wait on the target membership lock",
      );
      read = getOrganizationNotificationSettings(database, {
        organizationId: linearizationOrganizationId,
        userId: linearizationTargetId,
      });
      await waitForBlockedQuery(
        "%select id from organization where id = $1 for share%",
        revokePid,
        "settings read did not wait behind the revocation transaction",
      );

      await holder.query("commit");
      holderOpen = false;
      await revoke;
      await expect(read).rejects.toMatchObject({
        statusCode: 403,
        code: "MEMBERSHIP_DENIED",
      });
    } finally {
      if (holderOpen) await holder.query("rollback").catch(() => undefined);
      await Promise.allSettled(
        [revoke, read].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
      await holder.end();
    }
  });

  it("returns settings when the read holds the organization lock before revoke", async () => {
    const holder = new Client({ connectionString: ownerUrl });
    let holderOpen = false;
    let read: Promise<OrganizationNotificationSettings> | undefined;
    let revoke: Promise<unknown> | undefined;
    try {
      await holder.connect();
      await holder.query("begin");
      holderOpen = true;
      const held = await holder.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const holderPid = held.rows[0]?.pid;
      if (!holderPid) throw new Error("holder backend PID was not returned");
      await holder.query(
        "lock table notification_org_settings in access exclusive mode",
      );

      read = getOrganizationNotificationSettings(database, {
        organizationId: linearizationOrganizationId,
        userId: linearizationTargetId,
      });
      const readPid = await waitForBlockedQuery(
        "%from notification_org_settings%",
        holderPid,
        "settings read did not reach its settings select",
      );
      revoke = revokeOrganizationMember(database, {
        organizationId: linearizationOrganizationId,
        actorUserId: linearizationOwnerId,
        memberId: linearizationTargetMemberId,
      });
      await waitForBlockedQuery(
        "%select id from organization where id = $1 for update%",
        readPid,
        "revoke did not wait behind the settings read organization lock",
      );

      await holder.query("commit");
      holderOpen = false;
      await expect(read).resolves.toMatchObject({
        organizationId: linearizationOrganizationId,
        settingsChangedEnabled: true,
        version: 1,
      });
      await revoke;
    } finally {
      if (holderOpen) await holder.query("rollback").catch(() => undefined);
      await Promise.allSettled(
        [read, revoke].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
      await holder.end();
    }
  });
});
