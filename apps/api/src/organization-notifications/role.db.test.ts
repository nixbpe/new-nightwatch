import { createDatabase, runMigrations } from "@nightwatch/db";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { updateOrganizationMemberRole, type MemberResponse } from "./members";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const run = crypto.randomUUID();
const organizationId = crypto.randomUUID();
const roles = ["owner", "admin", "viewer", "auditor"] as const;
type Role = (typeof roles)[number];
const users = {
  owner: crypto.randomUUID(),
  admin: crypto.randomUUID(),
  viewer: crypto.randomUUID(),
  auditor: crypto.randomUUID(),
};
const members = {
  owner: crypto.randomUUID(),
  admin: crypto.randomUUID(),
  viewer: crypto.randomUUID(),
  auditor: crypto.randomUUID(),
};
const secondOwner = { user: crypto.randomUUID(), member: crypto.randomUUID() };
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const migrationsDir = new URL(
  "../../../../packages/db/migrations",
  import.meta.url,
).pathname;

async function state() {
  const result = await owner.query<{ id: string; role: string }>(
    "select id, role from member where organization_id = $1 order by id",
    [organizationId],
  );
  return result.rows;
}

async function reset() {
  for (const role of roles) {
    await owner.query("update member set role = $2 where id = $1", [members[role], role]);
  }
  await owner.query("update member set role = 'owner' where id = $1", [secondOwner.member]);
}

async function changeWhileRoleRequestWaits(
  actorUserId: string,
  targetMemberId: string,
  nextRole: Role,
  changedMemberId: string,
  changedRole: Role,
) {
  const holder = new Client({ connectionString: ownerUrl });
  await holder.connect();
  let request: Promise<MemberResponse> | undefined;
  try {
    await holder.query("begin");
    await holder.query("select id from organization where id = $1 for update", [organizationId]);
    request = updateOrganizationMemberRole(database, {
      organizationId, actorUserId, memberId: targetMemberId, role: nextRole,
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waiting = await owner.query<{ waiting: boolean }>(
        `select exists (
           select 1 from pg_stat_activity
           where wait_event_type = 'Lock'
             and query like 'select id from organization where id = $1 for update%'
         ) as waiting`,
      );
      if (waiting.rows[0]?.waiting) break;
    }
    const waiting = await owner.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where wait_event_type = 'Lock'
           and query like 'select id from organization where id = $1 for update%'
       ) as waiting`,
    );
    expect(waiting.rows[0]?.waiting).toBe(true);
    await holder.query("update member set role = $2 where id = $1", [changedMemberId, changedRole]);
    await holder.query("commit");
    return await request;
  } finally {
    await holder.query("rollback");
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
  for (const [id, role] of [...roles.map((role) => [users[role], role]), [secondOwner.user, "owner"]] as const) {
    await owner.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [id, `Role ${role}`, `${id}@example.test`],
    );
  }
  for (const role of roles) {
    await owner.query(
      "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, $4, now(), now())",
      [members[role], organizationId, users[role], role],
    );
  }
  await owner.query(
    "insert into member (id, organization_id, user_id, role, created_at, updated_at) values ($1, $2, $3, 'owner', now(), now())",
    [secondOwner.member, organizationId, secondOwner.user],
  );
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
  it("persists precisely the owner/admin/viewer/auditor actor × target × requested-role matrix", async () => {
    for (const actor of roles) {
      for (const target of roles) {
        for (const next of roles) {
          await reset();
          const before = await state();
          const allowed = actor === "owner" || (actor === "admin" && target !== "owner" && next !== "owner");
          const mutation = updateOrganizationMemberRole(database, {
            organizationId,
            actorUserId: users[actor],
            memberId: members[target],
            role: next,
          });
          if (allowed) {
            expect(await mutation).toEqual({
              id: members[target], userId: users[target], organizationId, role: next,
            });
          } else {
            await expect(mutation).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
          }
          const after = await state();
          expect(after).toEqual(allowed
            ? before.map((member) => member.id === members[target] ? { ...member, role: next } : member)
            : before);
          expect(after.filter((member) => member.role === "owner")).toHaveLength(
            2 + (allowed && target !== "owner" && next === "owner" ? 1 : 0)
              - (allowed && target === "owner" && next !== "owner" ? 1 : 0),
          );
        }
      }
    }
  }, 120_000);

  it("does not reveal a protected owner target to an admin probing an absent member", async () => {
    await reset();
    const before = await state();
    const denials = [];
    for (const memberId of [members.owner, crypto.randomUUID()]) {
      try {
        await updateOrganizationMemberRole(database, {
          organizationId, actorUserId: users.admin, memberId, role: "viewer",
        });
        throw new Error("admin unexpectedly changed a protected target");
      } catch (error) {
        if (error instanceof Error && error.message === "admin unexpectedly changed a protected target") throw error;
        denials.push(error);
      }
    }
    expect(denials[0]).toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    expect(denials[1]).toEqual(denials[0]);
    expect(await state()).toEqual(before);
  });

  it("checks the exact owner token and rejects the last-owner demotion without changing state", async () => {
    await reset();
    await owner.query("update member set role = 'homeowner' where id = $1", [members.viewer]);
    await owner.query("update member set role = 'viewer' where id = $1", [secondOwner.member]);
    const before = await state();
    await expect(updateOrganizationMemberRole(database, {
      organizationId, actorUserId: users.owner, memberId: members.owner, role: "admin",
    })).rejects.toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect(await state()).toEqual(before);
  });

  it("rechecks a demoted actor after waiting for the organization lock", async () => {
    await reset();
    const before = await state();
    await expect(changeWhileRoleRequestWaits(
      users.admin, members.viewer, "auditor", members.admin, "viewer",
    )).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    expect(await state()).toEqual(before.map((member) =>
      member.id === members.admin ? { ...member, role: "viewer" } : member));
  });

  it("rechecks a promoted owner target after waiting for the organization lock", async () => {
    await reset();
    const before = await state();
    await expect(changeWhileRoleRequestWaits(
      users.admin, members.viewer, "auditor", members.viewer, "owner",
    )).rejects.toMatchObject({ statusCode: 403, code: "PERMISSION_DENIED" });
    expect(await state()).toEqual(before.map((member) =>
      member.id === members.viewer ? { ...member, role: "owner" } : member));
  });

  it("serializes simultaneous demotions of two owners so exactly one wins", async () => {
    await reset();
    const outcomes = await Promise.allSettled([
      updateOrganizationMemberRole(database, { organizationId, actorUserId: users.owner, memberId: members.owner, role: "viewer" }),
      updateOrganizationMemberRole(database, { organizationId, actorUserId: secondOwner.user, memberId: secondOwner.member, role: "viewer" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (!rejected || rejected.status !== "rejected") throw new Error("missing losing demotion");
    expect(rejected.reason).toMatchObject({ statusCode: 400, code: "LAST_OWNER" });
    expect((await state()).filter((member) => member.role === "owner")).toHaveLength(1);
  });
});
