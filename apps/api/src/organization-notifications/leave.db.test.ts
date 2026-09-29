import { createDatabase, runMigrations } from "@nightwatch/db";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  leaveOrganization,
  updateOrganizationMemberRole,
  type MemberResponse,
} from "./members";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const otherOrganizationId = crypto.randomUUID();
const roles = ["owner", "admin", "viewer", "auditor"] as const;
type Role = (typeof roles)[number];
// Member IDs are opaque text, not UUIDs.
const users = Object.fromEntries(
  roles.map((role) => [role, `leave-user-${role}-${run}`]),
) as Record<Role, string>;
const members = Object.fromEntries(
  roles.map((role) => [role, `leave-member-${role}-${run}`]),
) as Record<Role, string>;
const secondOwner = {
  user: `leave-user-owner2-${run}`,
  member: `leave-member-owner2-${run}`,
};
// A second holder of every role, so the matrix never targets the actor itself.
const peers = {
  owner: secondOwner,
  admin: {
    user: `leave-user-admin2-${run}`,
    member: `leave-member-admin2-${run}`,
  },
  viewer: {
    user: `leave-user-viewer2-${run}`,
    member: `leave-member-viewer2-${run}`,
  },
  auditor: {
    user: `leave-user-auditor2-${run}`,
    member: `leave-member-auditor2-${run}`,
  },
} satisfies Record<Role, { user: string; member: string }>;
const everyone = [
  ...roles.map((role) => ({
    user: users[role],
    member: members[role],
    role: role,
  })),
  ...roles.map((role) => ({
    user: peers[role].user,
    member: peers[role].member,
    role: role,
  })),
];
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;

type Snapshot = {
  memberships: { id: string; org: string; role: string }[];
  lastActive: Record<string, string | null>;
  sessions: Record<string, string | null>;
};

// Membership, user mirror and session mirror rows for every fixture user.
async function snapshot(): Promise<Snapshot> {
  const userIds = everyone.map((entry) => entry.user);
  const memberships = await owner.query<{
    id: string;
    org: string;
    role: string;
  }>(
    `select id, organization_id as org, role from member
     where user_id = any($1::text[]) order by organization_id, id`,
    [userIds],
  );
  const lastActive = await owner.query<{
    id: string;
    last_active_tenant_id: string | null;
  }>(
    'select id, last_active_tenant_id from "user" where id = any($1::text[]) order by id',
    [userIds],
  );
  const sessions = await owner.query<{
    id: string;
    active_organization_id: string | null;
  }>(
    "select id, active_organization_id from session where user_id = any($1::text[]) order by id",
    [userIds],
  );
  return {
    memberships: memberships.rows,
    lastActive: Object.fromEntries(
      lastActive.rows.map((row) => [row.id, row.last_active_tenant_id]),
    ),
    sessions: Object.fromEntries(
      sessions.rows.map((row) => [row.id, row.active_organization_id]),
    ),
  };
}

const ownerRows = async (memberIds: string[]) =>
  (
    await owner.query<{ id: string; role: string }>(
      "select id, role from member where id = any($1::text[]) order by id",
      [memberIds],
    )
  ).rows;

const ownerCount = async () =>
  (
    await owner.query<{ count: number }>(
      `select count(*)::int as count from member
       where organization_id = $1 and role = 'owner'`,
      [organizationId],
    )
  ).rows[0]?.count ?? 0;

// Every user is a member of both organizations, last active in A, with one
// session selecting A and one selecting B.
async function reset(withSecondOwner = true) {
  await owner.query(
    "delete from member where organization_id = any($1::uuid[])",
    [[organizationId, otherOrganizationId]],
  );
  for (const entry of everyone) {
    const role =
      entry.user === secondOwner.user && !withSecondOwner
        ? "viewer"
        : entry.role;
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $3, $2, $4, now(), now()), ($5, $6, $2, 'viewer', now(), now())`,
      [
        entry.member,
        entry.user,
        organizationId,
        role,
        `${entry.member}-b`,
        otherOrganizationId,
      ],
    );
    await owner.query(
      'update "user" set last_active_tenant_id = $2 where id = $1',
      [entry.user, organizationId],
    );
    await owner.query("delete from session where user_id = $1", [entry.user]);
    await owner.query(
      `insert into session (id, expires_at, token, user_id, active_organization_id)
       values ($1, now() + interval '1 day', $2, $3, $4),
              ($5, now() + interval '1 day', $6, $3, $7)`,
      [
        `${entry.user}-sa`,
        `${entry.user}-ta-${run}`,
        entry.user,
        organizationId,
        `${entry.user}-sb`,
        `${entry.user}-tb-${run}`,
        otherOrganizationId,
      ],
    );
  }
}

// Expected snapshot after `targetUser` leaves from A and nothing else changes.
function afterLeave(before: Snapshot, targetUser: string): Snapshot {
  const target = everyone.find((entry) => entry.user === targetUser);
  return {
    memberships: before.memberships.filter((row) => row.id !== target?.member),
    lastActive: { ...before.lastActive, [targetUser]: null },
    sessions: { ...before.sessions, [`${targetUser}-sa`]: null },
  };
}

// Waits until a backend is blocked by this holder's transaction, not by any
// other session that happens to be waiting on a lock.
async function waitUntilBlocked(holderPid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await owner.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where $1::int = any(pg_blocking_pids(pid))
       ) as waiting`,
      [holderPid],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("request never blocked on the holder's lock");
}

// Holds the organization lock, queues an action behind it, applies a concurrent
// change, then releases.
async function whileBlocked<T>(
  start: () => Promise<T>,
  change: (holder: Client) => Promise<void>,
): Promise<T> {
  const holder = new Client({ connectionString: ownerUrl });
  await holder.connect();
  let request: Promise<T> | undefined;
  try {
    const pid = await holder.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    await holder.query("begin");
    await holder.query("select id from organization where id = $1 for update", [
      organizationId,
    ]);
    request = start();
    await waitUntilBlocked(pid.rows[0]?.pid ?? -1);
    await change(holder);
    await holder.query("commit");
    return await request;
  } finally {
    await holder.query("rollback").catch(() => undefined);
    await holder.end();
    if (request) await request.catch(() => undefined);
  }
}

const leave = (actorUserId: string): Promise<MemberResponse> =>
  leaveOrganization(database, { organizationId, actorUserId });

beforeAll(async () => {
  await owner.connect();
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.query(
    `insert into organization (id, name, slug, created_at)
     values ($1, 'Leave A', $3, now()), ($2, 'Leave B', $4, now())`,
    [organizationId, otherOrganizationId, `leave-a-${run}`, `leave-b-${run}`],
  );
  for (const entry of everyone) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [entry.user, `Leave ${entry.role}`, `${entry.user}@example.test`],
    );
  }
});

afterAll(async () => {
  await owner.query("delete from organization where id = any($1::uuid[])", [
    [organizationId, otherOrganizationId],
  ]);
  await owner.query('delete from "user" where id = any($1::text[])', [
    everyone.map((entry) => entry.user),
  ]);
  await owner.end();
  await database.close();
});

describe("locked organization self-leave", () => {
  it("persists exactly each role leaving with two holders of every role and clears only organization A mirrors", async () => {
    for (const role of roles) {
      await reset();
      const before = await snapshot();
      expect(await leave(users[role])).toEqual({
        id: members[role],
        userId: users[role],
        organizationId,
        role,
      });
      const after = await snapshot();
      expect(after).toEqual(afterLeave(before, users[role]));
      // Account, B membership and B session mirror survive.
      expect(after.memberships.map((row) => row.id)).toContain(
        `${members[role]}-b`,
      );
      expect(after.sessions[`${users[role]}-sb`]).toBe(otherOrganizationId);
      expect(after.lastActive[users[role]]).toBeNull();
      expect(
        (await owner.query('select 1 from "user" where id = $1', [users[role]]))
          .rowCount,
      ).toBe(1);
      expect(await ownerCount()).toBe(role === "owner" ? 1 : 2);
    }
  }, 120_000);

  it("rejects the sole owner leaving and leaves every row untouched", async () => {
    await reset(false);
    const before = await snapshot();
    await expect(leave(users.owner)).rejects.toMatchObject({
      statusCode: 400,
      code: "LAST_OWNER",
    });
    expect(await snapshot()).toEqual(before);
    expect(await ownerCount()).toBe(1);
  });

  it("lets one of two owners leave and keeps the other", async () => {
    await reset();
    const before = await snapshot();
    await leave(users.owner);
    expect(await snapshot()).toEqual(afterLeave(before, users.owner));
    expect(await ownerCount()).toBe(1);
  });

  it("denies a nonmember and a former member the same way without touching rows", async () => {
    await reset();
    const before = await snapshot();
    await expect(leave(`stranger-${run}`)).rejects.toMatchObject({
      statusCode: 403,
      code: "MEMBERSHIP_DENIED",
    });
    await leave(users.viewer);
    await expect(leave(users.viewer)).rejects.toMatchObject({
      statusCode: 403,
      code: "MEMBERSHIP_DENIED",
    });
    expect(await snapshot()).toEqual(afterLeave(before, users.viewer));
  });

  it("serializes two owners leaving so one wins and one gets LAST_OWNER", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const outcomes = await Promise.allSettled([
        leave(users.owner),
        leave(secondOwner.user),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.find((outcome) => outcome.status === "rejected")?.reason,
      ).toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
      expect(await ownerCount()).toBe(1);
      // The loser's membership persists; exactly one of the two rows is gone.
      const rows = await ownerRows([members.owner, secondOwner.member]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.role).toBe("owner");
      const winner = outcomes.find((outcome) => outcome.status === "fulfilled");
      expect(winner?.status === "fulfilled" && winner.value.id).not.toBe(
        rows[0]?.id,
      );
    }
  });

  it("rechecks the owner count when the other owner is demoted while a leave waits", async () => {
    await reset();
    await expect(
      whileBlocked(
        () => leave(users.owner),
        (holder) =>
          holder
            .query("update member set role = 'viewer' where id = $1", [
              secondOwner.member,
            ])
            .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await ownerCount()).toBe(1);
  });

  it.each([
    { leaver: users.owner, demoter: secondOwner },
    {
      leaver: secondOwner.user,
      demoter: { user: users.owner, member: members.owner },
    },
  ])(
    "serializes one owner leaving with the other demoting themselves so one wins and one gets LAST_OWNER",
    async ({ leaver, demoter }) => {
      for (let round = 0; round < 5; round += 1) {
        await reset();
        const outcomes = await Promise.allSettled([
          leave(leaver),
          updateOrganizationMemberRole(database, {
            organizationId,
            actorUserId: demoter.user,
            memberId: demoter.member,
            role: "viewer",
          }),
        ]);
        expect(
          outcomes.filter((outcome) => outcome.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          outcomes.find((outcome) => outcome.status === "rejected")?.reason,
        ).toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
        expect(await ownerCount()).toBe(1);
        // Both users keep a membership unless the leave won.
        const leaverMember = everyone.find((entry) => entry.user === leaver);
        const rows = await ownerRows([
          leaverMember?.member ?? "",
          demoter.member,
        ]);
        const leaveWon = outcomes[0].status === "fulfilled";
        expect(rows).toHaveLength(leaveWon ? 1 : 2);
        expect(rows.filter((row) => row.role === "owner")).toHaveLength(1);
      }
    },
  );

  it("rechecks a member removed while a leave waits and reports a former member denial", async () => {
    await reset();
    await expect(
      whileBlocked(
        () => leave(users.viewer),
        (holder) =>
          holder
            .query("delete from member where id = $1", [members.viewer])
            .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "MEMBERSHIP_DENIED" });
  });
});
