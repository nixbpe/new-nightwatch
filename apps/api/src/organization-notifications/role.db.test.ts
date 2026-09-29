import { createDatabase, runMigrations } from "@nightwatch/db";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { updateOrganizationMemberRole, type MemberResponse } from "./members";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const roles = ["owner", "admin", "viewer", "auditor"] as const;
type Role = (typeof roles)[number];
// Member IDs are opaque text, not UUIDs.
const users = Object.fromEntries(
  roles.map((role) => [role, `role-user-${role}-${run}`]),
) as Record<Role, string>;
const members = Object.fromEntries(
  roles.map((role) => [role, `role-member-${role}-${run}`]),
) as Record<Role, string>;
const secondOwner = {
  user: `role-user-owner2-${run}`,
  member: `role-member-owner2-${run}`,
};
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;
const WAITING_QUERY = "select id from organization where id = $1 for update%";

async function state() {
  const result = await owner.query<{ id: string; role: string }>(
    "select id, role from member where organization_id = $1 order by id",
    [organizationId],
  );
  return result.rows;
}

const ownerCount = async () =>
  (await state()).filter((member) => member.role === "owner").length;

async function reset(withSecondOwner = true) {
  for (const role of roles) {
    await owner.query("update member set role = $2 where id = $1", [
      members[role],
      role,
    ]);
  }
  await owner.query("update member set role = $2 where id = $1", [
    secondOwner.member,
    withSecondOwner ? "owner" : "viewer",
  ]);
}

async function waitUntilBlocked() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await owner.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where wait_event_type = 'Lock' and query like $1
       ) as waiting`,
      [WAITING_QUERY],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("role request never blocked on the organization lock");
}

// Holds the organization lock, queues a role request behind it, applies a
// concurrent change, then releases.
async function changeWhileBlocked(
  actorUserId: string,
  targetMemberId: string,
  nextRole: Role,
  change: (holder: Client) => Promise<void>,
): Promise<MemberResponse> {
  const holder = new Client({ connectionString: ownerUrl });
  await holder.connect();
  let request: Promise<MemberResponse> | undefined;
  try {
    await holder.query("begin");
    await holder.query("select id from organization where id = $1 for update", [
      organizationId,
    ]);
    request = updateOrganizationMemberRole(database, {
      organizationId,
      actorUserId,
      memberId: targetMemberId,
      role: nextRole,
    });
    await waitUntilBlocked();
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
    "insert into organization (id, name, slug, created_at) values ($1, 'Role test', $2, now())",
    [organizationId, `role-${run}`],
  );
  const rows = [
    ...roles.map((role) => [users[role], members[role], role] as const),
    [secondOwner.user, secondOwner.member, "owner"] as const,
  ];
  for (const [userId, memberId, role] of rows) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [userId, `Role ${role}`, `${userId}@example.test`],
    );
    await owner.query(
      "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, $4, now(), now())",
      [memberId, organizationId, userId, role],
    );
  }
});

afterAll(async () => {
  await owner.query("delete from organization where id = $1", [organizationId]);
  await owner.query('delete from "user" where id = any($1::text[])', [
    [...Object.values(users), secondOwner.user],
  ]);
  await owner.end();
  await database.close();
});

describe("locked organization member role mutations", () => {
  it("persists exactly the actor x target x requested-role matrix with two owners", async () => {
    for (const actor of roles) {
      for (const target of roles) {
        for (const next of roles) {
          await reset();
          const before = await state();
          const allowed =
            actor === "owner" ||
            (actor === "admin" && target !== "owner" && next !== "owner");
          const mutation = updateOrganizationMemberRole(database, {
            organizationId,
            actorUserId: users[actor],
            memberId: members[target],
            role: next,
          });
          if (allowed) {
            expect(await mutation).toEqual({
              id: members[target],
              userId: users[target],
              organizationId,
              role: next,
            });
          } else {
            await expect(mutation).rejects.toMatchObject({
              statusCode: 403,
              code: "PERMISSION_DENIED",
            });
          }
          const after = await state();
          expect(after).toEqual(
            allowed
              ? before.map((member) =>
                  member.id === members[target]
                    ? { ...member, role: next }
                    : member,
                )
              : before,
          );
          expect(await ownerCount()).toBe(
            2 +
              (allowed && target !== "owner" && next === "owner" ? 1 : 0) -
              (allowed && target === "owner" && next !== "owner" ? 1 : 0),
          );
        }
      }
    }
  }, 120_000);

  it("rejects the last owner demoting itself or promoting nobody with one owner", async () => {
    await reset(false);
    const before = await state();
    for (const next of ["admin", "viewer", "auditor"] as const) {
      await expect(
        updateOrganizationMemberRole(database, {
          organizationId,
          actorUserId: users.owner,
          memberId: members.owner,
          role: next,
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    }
    expect(await state()).toEqual(before);
    // Re-asserting owner is not a demotion.
    await expect(
      updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: members.owner,
        role: "owner",
      }),
    ).resolves.toMatchObject({ role: "owner" });
  });

  it("counts exact owner tokens, so a lookalike role is not an owner", async () => {
    await reset();
    await owner.query("update member set role = 'homeowner' where id = $1", [
      members.viewer,
    ]);
    await owner.query("update member set role = 'viewer' where id = $1", [
      secondOwner.member,
    ]);
    const before = await state();
    await expect(
      updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: members.owner,
        role: "admin",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await state()).toEqual(before);
  });

  it("gives an admin the same denial for an owner target, an absent target and an owner grant", async () => {
    await reset();
    const before = await state();
    const denials: unknown[] = [];
    for (const [memberId, role] of [
      [members.owner, "viewer"],
      [`missing-${run}`, "viewer"],
      [members.viewer, "owner"],
      [`missing-${run}`, "owner"],
    ] as const) {
      const outcome = await updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: users.admin,
        memberId,
        role,
      }).then(
        () => "unexpected success",
        (error: unknown) => error,
      );
      denials.push(outcome);
    }
    expect(denials[0]).toMatchObject({
      statusCode: 403,
      code: "PERMISSION_DENIED",
    });
    for (const denial of denials) expect(denial).toEqual(denials[0]);
    expect(await state()).toEqual(before);
  });

  it("denies a viewer before target lookup and reports a missing target to an owner as 404", async () => {
    await reset();
    for (const memberId of [members.viewer, `missing-${run}`]) {
      await expect(
        updateOrganizationMemberRole(database, {
          organizationId,
          actorUserId: users.viewer,
          memberId,
          role: "admin",
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    }
    await expect(
      updateOrganizationMemberRole(database, {
        organizationId,
        actorUserId: users.owner,
        memberId: `missing-${run}`,
        role: "admin",
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
  });

  it("rechecks a demoted actor after waiting for the organization lock", async () => {
    await reset();
    const before = await state();
    await expect(
      changeWhileBlocked(users.admin, members.viewer, "auditor", (holder) =>
        holder
          .query("update member set role = 'viewer' where id = $1", [
            members.admin,
          ])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    expect(await state()).toEqual(
      before.map((member) =>
        member.id === members.admin ? { ...member, role: "viewer" } : member,
      ),
    );
  });

  it("rechecks a target promoted to owner while an admin request waits", async () => {
    await reset();
    const before = await state();
    await expect(
      changeWhileBlocked(users.admin, members.viewer, "auditor", (holder) =>
        holder
          .query("update member set role = 'owner' where id = $1", [
            members.viewer,
          ])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    expect(await state()).toEqual(
      before.map((member) =>
        member.id === members.viewer ? { ...member, role: "owner" } : member,
      ),
    );
  });

  it("rechecks a target removed while the request waits", async () => {
    await reset();
    const extra = {
      user: `role-user-x-${run}`,
      member: `role-member-x-${run}`,
    };
    await owner.query(
      "insert into \"user\" (id, name, email, email_verified, created_at, updated_at) values ($1, 'X', $2, true, now(), now())",
      [extra.user, `${extra.user}@example.test`],
    );
    await owner.query(
      "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, 'viewer', now(), now())",
      [extra.member, organizationId, extra.user],
    );
    try {
      await expect(
        changeWhileBlocked(users.owner, extra.member, "admin", (holder) =>
          holder
            .query("delete from member where id = $1", [extra.member])
            .then(() => undefined),
        ),
      ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
    } finally {
      await owner.query('delete from "user" where id = $1', [extra.user]);
    }
  });

  it("rechecks the exact owner count when the other owner is demoted while a demotion waits", async () => {
    await reset();
    await expect(
      changeWhileBlocked(users.owner, members.owner, "viewer", (holder) =>
        holder
          .query("update member set role = 'viewer' where id = $1", [
            secondOwner.member,
          ])
          .then(() => undefined),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await ownerCount()).toBe(1);
  });

  it("serializes simultaneous demotions of two owners so one wins and one gets LAST_OWNER", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset();
      const outcomes = await Promise.allSettled([
        updateOrganizationMemberRole(database, {
          organizationId,
          actorUserId: users.owner,
          memberId: members.owner,
          role: "viewer",
        }),
        updateOrganizationMemberRole(database, {
          organizationId,
          actorUserId: secondOwner.user,
          memberId: secondOwner.member,
          role: "viewer",
        }),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === "rejected",
      );
      expect(rejected?.reason).toMatchObject({
        statusCode: 400,
        code: "LAST_OWNER",
      });
      expect(await ownerCount()).toBe(1);
    }
  });
});
