import { createDatabase, runMigrations } from "@nightwatch/db";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { revokeOrganizationMember, type MemberResponse } from "./members";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const otherOrganizationId = crypto.randomUUID();
const roles = ["owner", "admin", "viewer", "auditor"] as const;
type Role = (typeof roles)[number];
// Member IDs are opaque text, not UUIDs.
const users = Object.fromEntries(
  roles.map((role) => [role, `revoke-user-${role}-${run}`]),
) as Record<Role, string>;
const members = Object.fromEntries(
  roles.map((role) => [role, `revoke-member-${role}-${run}`]),
) as Record<Role, string>;
const secondOwner = {
  user: `revoke-user-owner2-${run}`,
  member: `revoke-member-owner2-${run}`,
};
const everyone = [
  ...roles.map((role) => ({
    user: users[role],
    member: members[role],
    role: role,
  })),
  { user: secondOwner.user, member: secondOwner.member, role: "owner" },
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

// Expected snapshot after `targetUser` is revoked from A and nothing else changes.
function afterRevoke(before: Snapshot, targetUser: string): Snapshot {
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
  throw new Error("revoke request never blocked on the holder's lock");
}

// Holds the organization lock, queues a revoke behind it, applies a concurrent
// change, then releases.
async function revokeWhileBlocked(
  actorUserId: string,
  targetMemberId: string,
  change: (holder: Client) => Promise<void>,
): Promise<MemberResponse> {
  const holder = new Client({ connectionString: ownerUrl });
  await holder.connect();
  let request: Promise<MemberResponse> | undefined;
  try {
    const pid = await holder.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    await holder.query("begin");
    await holder.query("select id from organization where id = $1 for update", [
      organizationId,
    ]);
    request = revokeOrganizationMember(database, {
      organizationId,
      actorUserId,
      memberId: targetMemberId,
    });
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

beforeAll(async () => {
  await owner.connect();
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.query(
    `insert into organization (id, name, slug, created_at)
     values ($1, 'Revoke A', $3, now()), ($2, 'Revoke B', $4, now())`,
    [organizationId, otherOrganizationId, `revoke-a-${run}`, `revoke-b-${run}`],
  );
  for (const entry of everyone) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [entry.user, `Revoke ${entry.role}`, `${entry.user}@example.test`],
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

describe("locked organization member revoke", () => {
  it("persists exactly the actor x target matrix with two owners and clears only organization A mirrors", async () => {
    for (const actor of roles) {
      for (const target of roles) {
        await reset();
        const targetUser = users[target];
        const targetMember = members[target];
        const before = await snapshot();
        const mutation = revokeOrganizationMember(database, {
          organizationId,
          actorUserId: users[actor],
          memberId: targetMember,
        });
        const allowed =
          actor === "owner" || (actor === "admin" && target !== "owner");
        if (allowed) {
          expect(await mutation).toEqual({
            id: targetMember,
            userId: targetUser,
            organizationId,
            role: target,
          });
          expect(await snapshot()).toEqual(afterRevoke(before, targetUser));
          // B membership and B session mirror of the revoked user survive.
          const after = await snapshot();
          expect(
            after.memberships.some(
              (row) =>
                row.id === `${targetMember}-b` &&
                row.org === otherOrganizationId,
            ),
          ).toBe(true);
          expect(after.sessions[`${targetUser}-sb`]).toBe(otherOrganizationId);
        } else {
          await expect(mutation).rejects.toMatchObject({
            statusCode: 403,
            code: "PERMISSION_DENIED",
          });
          expect(await snapshot()).toEqual(before);
        }
        expect(await ownerCount()).toBeGreaterThanOrEqual(1);
      }
    }
  }, 120_000);

  it("rejects the last owner revoking itself and leaves every row untouched", async () => {
    await reset(false);
    const before = await snapshot();
    await expect(
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: members.owner,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await snapshot()).toEqual(before);
    expect(await ownerCount()).toBe(1);
  });

  it("lets an owner revoke itself when another owner remains", async () => {
    await reset();
    const before = await snapshot();
    await revokeOrganizationMember(database, {
      organizationId,
      actorUserId: users.owner,
      memberId: members.owner,
    });
    expect(await snapshot()).toEqual(afterRevoke(before, users.owner));
    expect(await ownerCount()).toBe(1);
  });

  it("counts exact owner tokens, so a lookalike role does not satisfy last-owner", async () => {
    await reset(false);
    await owner.query("update member set role = 'homeowner' where id = $1", [
      members.viewer,
    ]);
    const before = await snapshot();
    await expect(
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: members.owner,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await snapshot()).toEqual(before);
  });

  it("gives an admin the same denial for an owner target and an absent target", async () => {
    await reset();
    const before = await snapshot();
    const denials: unknown[] = [];
    for (const memberId of [
      members.owner,
      secondOwner.member,
      `missing-${run}`,
    ]) {
      denials.push(
        await revokeOrganizationMember(database, {
          organizationId,
          actorUserId: users.admin,
          memberId,
        }).then(
          () => "unexpected success",
          (error: unknown) => error,
        ),
      );
    }
    expect(denials[0]).toMatchObject({
      statusCode: 403,
      code: "PERMISSION_DENIED",
    });
    for (const denial of denials) expect(denial).toEqual(denials[0]);
    expect(await snapshot()).toEqual(before);
  });

  it("denies viewer and auditor before target lookup and reports a missing target to an owner as 404", async () => {
    await reset();
    const before = await snapshot();
    const outcomes: unknown[] = [];
    for (const actor of ["viewer", "auditor"] as const) {
      for (const memberId of [members.owner, `missing-${run}`]) {
        outcomes.push(
          await revokeOrganizationMember(database, {
            organizationId,
            actorUserId: users[actor],
            memberId,
          }).then(
            () => "unexpected success",
            (error: unknown) => error,
          ),
        );
      }
    }
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        statusCode: 403,
        code: "PERMISSION_DENIED",
      });
      expect(outcome).toEqual(outcomes[0]);
    }
    await expect(
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: `missing-${run}`,
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
    expect(await snapshot()).toEqual(before);
  });

  it("denies a nonmember actor without touching any row", async () => {
    await reset();
    const before = await snapshot();
    await expect(
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: `stranger-${run}`,
        memberId: members.viewer,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "MEMBERSHIP_DENIED" });
    expect(await snapshot()).toEqual(before);
  });

  it("rechecks a demoted actor after waiting for the organization lock", async () => {
    await reset();
    const before = await snapshot();
    await expect(
      revokeWhileBlocked(users.admin, members.viewer, (holder) =>
        holder
          .query("update member set role = 'viewer' where id = $1", [
            members.admin,
          ])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    const after = await snapshot();
    expect(after.memberships).toEqual(
      before.memberships.map((row) =>
        row.id === members.admin ? { ...row, role: "viewer" } : row,
      ),
    );
    expect(after.lastActive).toEqual(before.lastActive);
    expect(after.sessions).toEqual(before.sessions);
  });

  it("rechecks a target promoted to owner while an admin revoke waits", async () => {
    await reset();
    const before = await snapshot();
    await expect(
      revokeWhileBlocked(users.admin, members.viewer, (holder) =>
        holder
          .query("update member set role = 'owner' where id = $1", [
            members.viewer,
          ])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    const after = await snapshot();
    expect(after.memberships).toEqual(
      before.memberships.map((row) =>
        row.id === members.viewer ? { ...row, role: "owner" } : row,
      ),
    );
    expect(after.sessions).toEqual(before.sessions);
  });

  it("rechecks a target removed while the request waits and reports 404, not success", async () => {
    await reset();
    await expect(
      revokeWhileBlocked(users.owner, members.viewer, (holder) =>
        holder
          .query("delete from member where id = $1", [members.viewer])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
  });

  it("rechecks the exact owner count when the other owner is demoted while a revoke waits", async () => {
    await reset();
    await expect(
      revokeWhileBlocked(users.owner, members.owner, (holder) =>
        holder
          .query("update member set role = 'viewer' where id = $1", [
            secondOwner.member,
          ])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await ownerCount()).toBe(1);
  });

  it("serializes two owners revoking themselves so one wins and one gets LAST_OWNER", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const outcomes = await Promise.allSettled([
        revokeOrganizationMember(database, {
          organizationId,
          actorUserId: users.owner,
          memberId: members.owner,
        }),
        revokeOrganizationMember(database, {
          organizationId,
          actorUserId: secondOwner.user,
          memberId: secondOwner.member,
        }),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.find((outcome) => outcome.status === "rejected")?.reason,
      ).toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
      expect(await ownerCount()).toBe(1);
    }
  });

  it("serializes two owners revoking each other so the loser is denied as a former member", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const outcomes = await Promise.allSettled([
        revokeOrganizationMember(database, {
          organizationId,
          actorUserId: users.owner,
          memberId: secondOwner.member,
        }),
        revokeOrganizationMember(database, {
          organizationId,
          actorUserId: secondOwner.user,
          memberId: members.owner,
        }),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      const reason = outcomes.find((outcome) => outcome.status === "rejected")
        ?.reason as { statusCode?: number; code?: string } | undefined;
      expect(reason?.statusCode).toBe(403);
      expect(reason?.code).toBe("MEMBERSHIP_DENIED");
      expect(await ownerCount()).toBe(1);
    }
  });

  it("serializes a target and a duplicate revoke so the second gets 404", async () => {
    await reset();
    const outcomes = await Promise.allSettled([
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: members.viewer,
      }),
      revokeOrganizationMember(database, {
        organizationId,
        actorUserId: secondOwner.user,
        memberId: members.viewer,
      }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.find((outcome) => outcome.status === "rejected")?.reason,
    ).toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
  });
});
