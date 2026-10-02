import { createDatabase, runMigrations } from "@nightwatch/db";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cancelPendingInvitation,
  createOrganizationInvitation,
  resendPendingInvitation,
} from "../organization-notifications/invitations";
import {
  leaveOrganization,
  revokeOrganizationMember,
  updateOrganizationMemberRole,
} from "../organization-notifications/members";
import { updateOrganizationNotificationSettings } from "../organization-notifications/service";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;
const createdUsers: string[] = [];

type Person = { userId: string; memberId: string };

async function addMember(label: string, role: string): Promise<Person> {
  const userId = `audit-${label}-${run}-${String(createdUsers.length)}`;
  const memberId = `audit-m-${label}-${run}-${String(createdUsers.length)}`;
  createdUsers.push(userId);
  await owner.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [userId, `Name ${label}`, `${userId}@example.test`],
  );
  await owner.query(
    `insert into member (id, organization_id, user_id, role, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [memberId, organizationId, userId, role],
  );
  return { userId, memberId };
}

type EventRow = {
  actor_user_id: string;
  actor_role: string;
  category: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_attributes: Record<string, unknown>;
  changes: unknown[];
  request_id: string | null;
};

async function events(): Promise<EventRow[]> {
  return (
    await owner.query<EventRow>(
      `select actor_user_id, actor_role, category, action, target_type, target_id,
              target_attributes, changes, request_id
       from audit_events where tenant_id = $1 order by occurred_at, id`,
      [organizationId],
    )
  ).rows;
}

async function eventCount(): Promise<number> {
  return (await events()).length;
}

/** Returns the events written while `work` ran. */
async function written(work: () => Promise<unknown>): Promise<EventRow[]> {
  const before = await eventCount();
  await work();
  return (await events()).slice(before);
}

async function memberRole(memberId: string): Promise<string | undefined> {
  return (
    await owner.query<{ role: string }>(
      "select role from member where id = $1",
      [memberId],
    )
  ).rows[0]?.role;
}

function roleValue(value: string | null) {
  return value === null ? null : { kind: "value", value };
}

let ownerPerson: Person;
let adminPerson: Person;
let viewerPerson: Person;
let auditorPerson: Person;

beforeAll(async () => {
  await owner.connect();
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.query(
    "insert into organization (id, name, slug) values ($1, 'Audit events', $2)",
    [organizationId, `audit-events-${run}`],
  );
  ownerPerson = await addMember("owner", "owner");
  adminPerson = await addMember("admin", "admin");
  viewerPerson = await addMember("viewer", "viewer");
  auditorPerson = await addMember("auditor", "auditor");
}, 120_000);

afterAll(async () => {
  await owner.query(
    "drop trigger if exists audit_events_test_fail on audit_events",
  );
  await owner.query("drop function if exists audit_events_test_fail()");
  await owner.query("delete from organization where id = $1", [organizationId]);
  await owner.query('delete from "user" where id = any($1::text[])', [
    createdUsers,
  ]);
  await owner.end();
  await database.close();
});

describe("member events", () => {
  it("role update writes one event with the actor role, target user and role change", async () => {
    const target = await addMember("role-target", "viewer");
    const [event, ...rest] = await written(() =>
      updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: adminPerson.userId,
        memberId: target.memberId,
        role: "auditor",
        requestId: `req-${run}`,
      }),
    );
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      actor_user_id: adminPerson.userId,
      actor_role: "admin",
      category: "member",
      action: "organization.member.role.update",
      target_type: "member",
      target_id: target.userId,
      request_id: `req-${run}`,
      changes: [
        {
          field: "role",
          before: roleValue("viewer"),
          after: roleValue("auditor"),
        },
      ],
    });
    expect(JSON.stringify(event)).not.toContain("@example.test");
    expect(JSON.stringify(event)).not.toContain("Name role-target");
  });

  it("role update to the exact stored role writes no event, no update and the same response", async () => {
    const target = await addMember("role-same", "viewer");
    const before = await owner.query<{ updated_at: Date }>(
      "select updated_at from member where id = $1",
      [target.memberId],
    );
    const eventsBefore = await eventCount();
    const result = await updateOrganizationMemberRole(database, {
      organizationId,
      actorUserId: ownerPerson.userId,
      memberId: target.memberId,
      role: "viewer",
    });
    expect(result).toMatchObject({ userId: target.userId, role: "viewer" });
    expect(await eventCount()).toBe(eventsBefore);
    const after = await owner.query<{ updated_at: Date }>(
      "select updated_at from member where id = $1",
      [target.memberId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("role update on a composite stored role rewrites it and writes an event with the normalized role as before", async () => {
    const composite = await addMember("role-composite", "viewer,auditor");
    const [event, ...rest] = await written(() =>
      updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: ownerPerson.userId,
        memberId: composite.memberId,
        role: "viewer",
      }),
    );
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      action: "organization.member.role.update",
      target_id: composite.userId,
      changes: [
        {
          field: "role",
          before: roleValue("viewer"),
          after: roleValue("viewer"),
        },
      ],
    });
    expect(await memberRole(composite.memberId)).toBe("viewer");
  });

  it("revoke writes one event that outlives the removed member", async () => {
    const target = await addMember("revoked", "auditor");
    const [event, ...rest] = await written(() =>
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: ownerPerson.userId,
        memberId: target.memberId,
      }),
    );
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      actor_role: "owner",
      action: "organization.member.revoke",
      target_type: "member",
      target_id: target.userId,
      changes: [{ field: "role", before: roleValue("auditor"), after: null }],
    });
    expect(await memberRole(target.memberId)).toBeUndefined();
  });

  it("leave writes one event where actor and target are the same user", async () => {
    const leaver = await addMember("leaver", "viewer");
    const [event, ...rest] = await written(() =>
      leaveOrganization(database, {
        organizationId,
        actorUserId: leaver.userId,
      }),
    );
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      actor_user_id: leaver.userId,
      actor_role: "viewer",
      action: "organization.member.leave",
      target_id: leaver.userId,
      changes: [{ field: "role", before: roleValue("viewer"), after: null }],
    });
  });

  it("denied role update, revoke and leave write no event", async () => {
    const target = await addMember("denied-target", "viewer");
    const before = await eventCount();
    await expect(
      updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: viewerPerson.userId,
        memberId: target.memberId,
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: auditorPerson.userId,
        memberId: target.memberId,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      leaveOrganization(database, {
        organizationId,
        actorUserId: `not-a-member-${run}`,
      }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
    expect(await eventCount()).toBe(before);
    expect(await memberRole(target.memberId)).toBe("viewer");
  });
});

describe("invitation events", () => {
  it("create, resend and cancel write one event each, keyed by public id with no email or bearer id", async () => {
    const email = `invitee-${run}@example.test`;
    const [created, ...createdRest] = await written(async () => {
      await createOrganizationInvitation(database, {
        organizationId,
        actorUserId: adminPerson.userId,
        email,
        role: "viewer",
        requestId: `req-create-${run}`,
      });
    });
    expect(createdRest).toHaveLength(0);
    const invitation = (
      await owner.query<{ id: string; public_id: string }>(
        "select id, public_id from invitation where organization_id = $1 and email = $2",
        [organizationId, email],
      )
    ).rows[0];
    if (!invitation) throw new Error("invitation was not created");
    expect(created).toMatchObject({
      actor_role: "admin",
      category: "invitation",
      action: "organization.invitation.create",
      target_type: "invitation",
      target_id: invitation.public_id,
      target_attributes: { role: "viewer" },
      request_id: `req-create-${run}`,
      changes: [{ field: "role", before: null, after: roleValue("viewer") }],
    });

    await owner.query(
      "update invitation set sent_at = now() - interval '10 minutes' where public_id = $1",
      [invitation.public_id],
    );
    const [resent, ...resentRest] = await written(async () => {
      await resendPendingInvitation(database, {
        organizationId,
        actorUserId: ownerPerson.userId,
        publicId: invitation.public_id,
      });
    });
    expect(resentRest).toHaveLength(0);
    expect(resent).toMatchObject({
      actor_role: "owner",
      action: "organization.invitation.resend",
      target_id: invitation.public_id,
      target_attributes: { role: "viewer" },
      changes: [],
    });

    const [canceled, ...canceledRest] = await written(() =>
      cancelPendingInvitation(database, {
        organizationId,
        actorUserId: adminPerson.userId,
        publicId: invitation.public_id,
      }),
    );
    expect(canceledRest).toHaveLength(0);
    expect(canceled).toMatchObject({
      action: "organization.invitation.cancel",
      target_id: invitation.public_id,
      target_attributes: { role: "viewer" },
      changes: [{ field: "role", before: roleValue("viewer"), after: null }],
    });

    // Neither the address nor either generation of the bearer id is stored.
    const rotated = (
      await owner.query<{ id: string }>(
        "select id from invitation where public_id = $1",
        [invitation.public_id],
      )
    ).rows[0];
    const stored = JSON.stringify(await events());
    expect(stored).not.toContain(email);
    expect(stored).not.toContain(invitation.id);
    expect(stored).not.toContain(rotated?.id ?? "unreachable");
  });

  it("denied and rejected invitation requests write no event", async () => {
    const before = await eventCount();
    await expect(
      createOrganizationInvitation(database, {
        organizationId,
        actorUserId: auditorPerson.userId,
        email: `denied-${run}@example.test`,
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      createOrganizationInvitation(database, {
        organizationId,
        actorUserId: ownerPerson.userId,
        email: `${viewerPerson.userId}@example.test`,
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "USER_ALREADY_MEMBER" });
    await expect(
      cancelPendingInvitation(database, {
        organizationId,
        actorUserId: viewerPerson.userId,
        publicId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      resendPendingInvitation(database, {
        organizationId,
        actorUserId: viewerPerson.userId,
        publicId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      resendPendingInvitation(database, {
        organizationId,
        actorUserId: ownerPerson.userId,
        publicId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVITATION_NOT_FOUND" });
    expect(await eventCount()).toBe(before);
  });
});

describe("notification settings events", () => {
  async function settingsVersion(): Promise<number> {
    const result = await owner.query<{ version: number }>(
      "select version from notification_org_settings where tenant_id = $1",
      [organizationId],
    );
    return result.rows[0]?.version ?? 0;
  }

  async function update(
    actor: Person,
    change: {
      settingsChangedEnabled?: boolean;
      monitorAlertsEnabled?: boolean;
    },
  ) {
    return updateOrganizationNotificationSettings(database, {
      organizationId,
      userId: actor.userId,
      actorDisplayName: "Actor",
      update: { ...change, expectedVersion: await settingsVersion() },
      requestId: `req-settings-${run}`,
    });
  }

  it("writes the action that matches the changed fields, one event per mutation", async () => {
    const [alertsOnly, ...rest1] = await written(() =>
      update(ownerPerson, { monitorAlertsEnabled: false }),
    );
    expect(rest1).toHaveLength(0);
    expect(alertsOnly).toMatchObject({
      actor_role: "owner",
      category: "notification_settings",
      action: "organization.notification-settings.monitor-alerts.update",
      target_type: "notification_settings",
      request_id: `req-settings-${run}`,
      changes: [
        {
          field: "monitorAlertsEnabled",
          before: { kind: "value", value: true },
          after: { kind: "value", value: false },
        },
      ],
    });

    const [settingsOnly, ...rest2] = await written(() =>
      update(adminPerson, { settingsChangedEnabled: false }),
    );
    expect(rest2).toHaveLength(0);
    expect(settingsOnly).toMatchObject({
      actor_role: "admin",
      action: "organization.notification-settings.update",
      changes: [
        {
          field: "settingsChangedEnabled",
          before: { kind: "value", value: true },
          after: { kind: "value", value: false },
        },
      ],
    });

    const [both, ...rest3] = await written(() =>
      update(ownerPerson, {
        settingsChangedEnabled: true,
        monitorAlertsEnabled: true,
      }),
    );
    expect(rest3).toHaveLength(0);
    expect(both?.action).toBe("organization.notification-settings.update");
    expect(both?.changes).toHaveLength(2);
  });

  it("a request that changes nothing or is rejected writes no event", async () => {
    const before = await eventCount();
    const versionBefore = await settingsVersion();
    await update(ownerPerson, {
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    await expect(
      updateOrganizationNotificationSettings(database, {
        organizationId,
        userId: ownerPerson.userId,
        actorDisplayName: "Actor",
        update: {
          monitorAlertsEnabled: false,
          expectedVersion: versionBefore + 99,
        },
      }),
    ).rejects.toMatchObject({ code: "SETTINGS_VERSION_CONFLICT" });
    await expect(
      update(viewerPerson, { monitorAlertsEnabled: false }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await eventCount()).toBe(before);
    expect(await settingsVersion()).toBe(versionBefore);
  });
});

describe("a failed event insert rolls the mutation back", () => {
  async function installFailingTrigger() {
    // Fails only this file's Organization so parallel suites keep writing.
    await owner.query(
      `create or replace function audit_events_test_fail() returns trigger
       language plpgsql as $$
       begin
         if new.tenant_id = '${organizationId}'::uuid then
           raise exception 'audit insert blocked by test';
         end if;
         return new;
       end $$`,
    );
    await owner.query(
      `create trigger audit_events_test_fail before insert on audit_events
       for each row execute function audit_events_test_fail()`,
    );
  }
  async function removeFailingTrigger() {
    await owner.query("drop trigger audit_events_test_fail on audit_events");
  }

  it("leaves members, invitations and settings unchanged and returns the error for every request type", async () => {
    const roleTarget = await addMember("rb-role", "viewer");
    const revokeTarget = await addMember("rb-revoke", "viewer");
    const leaver = await addMember("rb-leave", "viewer");
    const pending = `rb-pending-${run}@example.test`;
    await createOrganizationInvitation(database, {
      organizationId,
      actorUserId: ownerPerson.userId,
      email: pending,
      role: "viewer",
    });
    await owner.query(
      "update invitation set sent_at = now() - interval '10 minutes' where organization_id = $1 and email = $2",
      [organizationId, pending],
    );
    const pendingRow = (
      await owner.query<{ public_id: string; id: string; sent_at: Date }>(
        "select public_id, id, sent_at from invitation where organization_id = $1 and email = $2",
        [organizationId, pending],
      )
    ).rows[0];
    if (!pendingRow) throw new Error("pending invitation missing");
    type SettingsRow = {
      org_settings_changed_enabled: boolean;
      monitor_alerts_enabled: boolean;
      version: number;
    };
    const settingsRow = async () =>
      (
        await owner.query<SettingsRow>(
          `select org_settings_changed_enabled, monitor_alerts_enabled, version
           from notification_org_settings where tenant_id = $1`,
          [organizationId],
        )
      ).rows[0];
    const settingsBefore = await settingsRow();
    const settingsVersionBefore = settingsBefore?.version ?? 0;
    const intentCount = async () =>
      (
        await owner.query<{ n: number }>(
          "select count(*)::int as n from notification_intents where tenant_id = $1",
          [organizationId],
        )
      ).rows[0]?.n;
    const intentsBefore = await intentCount();
    const eventsBefore = await eventCount();

    await installFailingTrigger();
    try {
      const attempts: (() => Promise<unknown>)[] = [
        () =>
          updateOrganizationMemberRole(database, {
            organizationId,
            actorUserId: ownerPerson.userId,
            memberId: roleTarget.memberId,
            role: "admin",
          }),
        () =>
          revokeOrganizationMember(database, {
            organizationId,
            actorUserId: ownerPerson.userId,
            memberId: revokeTarget.memberId,
          }),
        () =>
          leaveOrganization(database, {
            organizationId,
            actorUserId: leaver.userId,
          }),
        () =>
          createOrganizationInvitation(database, {
            organizationId,
            actorUserId: ownerPerson.userId,
            email: `rb-new-${run}@example.test`,
            role: "viewer",
          }),
        () =>
          resendPendingInvitation(database, {
            organizationId,
            actorUserId: ownerPerson.userId,
            publicId: pendingRow.public_id,
          }),
        () =>
          cancelPendingInvitation(database, {
            organizationId,
            actorUserId: ownerPerson.userId,
            publicId: pendingRow.public_id,
          }),
        () =>
          updateOrganizationNotificationSettings(database, {
            organizationId,
            userId: ownerPerson.userId,
            actorDisplayName: "Actor",
            update: {
              monitorAlertsEnabled: false,
              expectedVersion: settingsVersionBefore,
            },
          }),
        () =>
          updateOrganizationNotificationSettings(database, {
            organizationId,
            userId: ownerPerson.userId,
            actorDisplayName: "Actor",
            update: {
              settingsChangedEnabled: false,
              expectedVersion: settingsVersionBefore,
            },
          }),
      ];
      // Sequential on purpose: each attempt must fail on its own insert.
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toThrow(/audit insert blocked by test/);
      }
    } finally {
      await removeFailingTrigger();
    }

    expect(await memberRole(roleTarget.memberId)).toBe("viewer");
    expect(await memberRole(revokeTarget.memberId)).toBe("viewer");
    expect(await memberRole(leaver.memberId)).toBe("viewer");
    const invitations = await owner.query<{
      email: string;
      status: string;
      id: string;
      sent_at: Date;
    }>(
      "select email, status, id, sent_at from invitation where organization_id = $1 and email like 'rb-%'",
      [organizationId],
    );
    expect(invitations.rows).toEqual([
      {
        email: pending,
        status: "pending",
        id: pendingRow.id,
        sent_at: pendingRow.sent_at,
      },
    ]);
    expect(await settingsRow()).toEqual(settingsBefore);
    expect(await intentCount()).toBe(intentsBefore);
    expect(await eventCount()).toBe(eventsBefore);
  });
});
