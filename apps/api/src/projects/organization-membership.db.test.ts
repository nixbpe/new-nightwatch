import { projectListResponseSchema } from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";

// F-003: Project access follows the Organization role and membership.
let ctx: MonitorTestContext;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

type Role = "admin" | "member";
type Response = Awaited<ReturnType<MonitorTestContext["call"]>>;

let sequence = 0;
const errorOf = (response: Response) =>
  (response.json as { error: { code: string; message: string } }).error;

const projectBase = (org: TestOrganization, projectId: string) =>
  `/api/organizations/${org.id}/projects/${projectId}`;

// A Project with exactly the given members; the creator is removed so an
// Organization Owner or Admin is not a Project member.
async function projectNamed(
  org: TestOrganization,
  name: string,
  members: [string, Role][],
): Promise<string> {
  const response = await ctx.call(
    org.users.owner,
    "POST",
    `/api/organizations/${org.id}/projects`,
    { name, slug: `om-${ctx.run}-${String(++sequence)}` },
  );
  expect(response.status).toBe(201);
  const { id } = response.json as { id: string };
  await ctx.owner.sql.query(
    "delete from project_members where project_id = $1",
    [id],
  );
  for (const [userId, role] of members) {
    await ctx.owner.sql.query(
      "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, $4)",
      [id, org.id, userId, role],
    );
  }
  return id;
}

async function memberIdOf(org: TestOrganization, userId: string) {
  const result = await ctx.owner.sql.query<{ id: string }>(
    "select id from member where organization_id = $1 and user_id = $2",
    [org.id, userId],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("fixture member missing");
  return id;
}

const projectRowCount = async (org: TestOrganization, userId: string) =>
  Number(
    (
      await ctx.owner.sql.query<{ total: string }>(
        "select count(*) as total from project_members where tenant_id = $1 and user_id = $2",
        [org.id, userId],
      )
    ).rows[0]?.total,
  );

const memberRowCount = async (org: TestOrganization, userId: string) =>
  Number(
    (
      await ctx.owner.sql.query<{ total: string }>(
        "select count(*) as total from member where organization_id = $1 and user_id = $2",
        [org.id, userId],
      )
    ).rows[0]?.total,
  );

async function setOrganizationRole(
  org: TestOrganization,
  userId: string,
  role: string,
) {
  const response = await ctx.call(
    org.users.owner,
    "PATCH",
    `/api/organizations/${org.id}/members/${await memberIdOf(org, userId)}/role`,
    { role },
  );
  expect(response.status).toBe(200);
}

const revoke = async (
  org: TestOrganization,
  actor: string,
  targetUserId: string,
) =>
  ctx.call(
    actor,
    "DELETE",
    `/api/organizations/${org.id}/members/${await memberIdOf(org, targetUserId)}`,
  );

const leave = (org: TestOrganization, actor: string) =>
  ctx.call(actor, "DELETE", `/api/organizations/${org.id}/members/me`);

const listProjects = (org: TestOrganization, actor: string) =>
  ctx.call(actor, "GET", `/api/organizations/${org.id}/projects`);

describe("removal deletes Project memberships (AC-01)", () => {
  it.each(["revoke", "leave"] as const)(
    "after %s the user's Project rows are gone and every Project route answers 403 MEMBERSHIP_DENIED",
    async (how) => {
      const org = await ctx.createOrganization(`om-gone-${how}`);
      const user = org.users.viewer;
      const keeper = org.users.auditor;
      const first = await projectNamed(org, "Gone One", [
        [user, "member"],
        [keeper, "admin"],
      ]);
      const second = await projectNamed(org, "Gone Two", [
        [user, "admin"],
        [keeper, "admin"],
      ]);
      expect(await projectRowCount(org, user)).toBe(2);

      const response =
        how === "revoke"
          ? await revoke(org, org.users.owner, user)
          : await leave(org, user);
      expect(response.status).toBe(200);

      expect(await projectRowCount(org, user)).toBe(0);
      expect(await memberRowCount(org, user)).toBe(0);
      const denied = [
        await listProjects(org, user),
        await ctx.call(user, "GET", projectBase(org, first)),
        await ctx.call(user, "GET", `${projectBase(org, first)}/members`),
        await ctx.call(user, "PATCH", projectBase(org, second), {
          name: "Renamed",
        }),
        await ctx.call(
          user,
          "DELETE",
          `${projectBase(org, second)}/members/${keeper}`,
        ),
      ];
      for (const result of denied) {
        expect(result.status).toBe(403);
        expect(errorOf(result).code).toBe("MEMBERSHIP_DENIED");
      }
    },
  );
});

describe("role changes apply immediately (AC-02, AC-03)", () => {
  it.each(["admin", "owner"] as const)(
    "a viewer promoted to %s sees and manages a Project they are not a member of",
    async (role) => {
      const org = await ctx.createOrganization(`om-promote-${role}`);
      const user = org.users.viewer;
      const projectId = await projectNamed(org, "Promote Target", [
        [org.users.auditor, "admin"],
      ]);
      expect((await listProjects(org, user)).json).toEqual({ projects: [] });
      expect(
        (await ctx.call(user, "GET", projectBase(org, projectId))).status,
      ).toBe(404);

      await setOrganizationRole(org, user, role);

      const list = projectListResponseSchema.parse(
        (await listProjects(org, user)).json,
      );
      expect(list.projects.map((project) => project.id)).toEqual([projectId]);
      expect(list.projects[0]?.myRole).toBeNull();
      const rename = await ctx.call(
        user,
        "PATCH",
        projectBase(org, projectId),
        {
          name: "Promoted Rename",
        },
      );
      expect(rename.status).toBe(200);
      const added = await ctx.call(
        user,
        "POST",
        `${projectBase(org, projectId)}/members`,
        { userIds: [org.users.auditor, org.users.admin], role: "member" },
      );
      expect(added.status).toBe(200);
      expect(await projectRowCount(org, user)).toBe(0);
    },
  );

  it("a demoted admin keeps the Project role they hold and loses every other Project", async () => {
    const org = await ctx.createOrganization("om-demote");
    const user = org.users.admin;
    const asMember = await projectNamed(org, "Demote Member", [
      [user, "member"],
      [org.users.auditor, "admin"],
    ]);
    const asAdmin = await projectNamed(org, "Demote Admin", [[user, "admin"]]);
    const hidden = await projectNamed(org, "Demote Hidden", [
      [org.users.auditor, "admin"],
    ]);
    expect(
      projectListResponseSchema.parse((await listProjects(org, user)).json)
        .projects,
    ).toHaveLength(3);

    await setOrganizationRole(org, user, "viewer");

    const list = projectListResponseSchema.parse(
      (await listProjects(org, user)).json,
    );
    expect(
      list.projects.map((project) => [project.id, project.myRole]).sort(),
    ).toEqual(
      [
        [asMember, "member"],
        [asAdmin, "admin"],
      ].sort(),
    );
    const gone = await ctx.call(user, "GET", projectBase(org, hidden));
    expect(gone.status).toBe(404);
    expect(errorOf(gone).code).toBe("PROJECT_NOT_FOUND");
    expect(
      (await ctx.call(user, "GET", `${projectBase(org, hidden)}/members`))
        .status,
    ).toBe(404);
    expect(
      (
        await ctx.call(user, "PATCH", projectBase(org, asMember), {
          name: "Nope",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.call(user, "PATCH", projectBase(org, asAdmin), {
          name: "Still Admin",
        })
      ).status,
    ).toBe(200);
  });
});

describe("last Project administrator (AC-04)", () => {
  it("rejects a revoke with 409 naming every blocking Project in name order and deletes nothing", async () => {
    const org = await ctx.createOrganization("om-last-revoke");
    const user = org.users.viewer;
    // Created out of name order; the Organization Owner and Admin are not
    // Project members, so they are not the other administrator.
    await projectNamed(org, "Zulu Sole", [[user, "admin"]]);
    await projectNamed(org, "Alpha Sole", [[user, "admin"]]);
    await projectNamed(org, "Shared", [
      [user, "admin"],
      [org.users.auditor, "admin"],
    ]);
    await projectNamed(org, "Plain Member", [
      [user, "member"],
      [org.users.auditor, "admin"],
    ]);

    const response = await revoke(org, org.users.admin, user);

    expect(response.status).toBe(409);
    const error = errorOf(response);
    expect(error.code).toBe("LAST_PROJECT_ADMIN");
    expect(error.message).toContain("Alpha Sole, Zulu Sole");
    expect(error.message).not.toContain("Shared");
    expect(error.message).not.toContain("Plain Member");
    expect(await memberRowCount(org, user)).toBe(1);
    expect(await projectRowCount(org, user)).toBe(4);
  });

  it("rejects a leave with 409 naming the Project and keeps the membership", async () => {
    const org = await ctx.createOrganization("om-last-leave");
    const user = org.users.viewer;
    await projectNamed(org, "Leave Sole", [[user, "admin"]]);

    const response = await leave(org, user);

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe("LAST_PROJECT_ADMIN");
    expect(errorOf(response).message).toContain("Leave Sole");
    expect(await memberRowCount(org, user)).toBe(1);
    expect(await projectRowCount(org, user)).toBe(1);
  });

  it.each(["revoke", "leave"] as const)(
    "lets %s through once another Project administrator exists",
    async (how) => {
      const org = await ctx.createOrganization(`om-other-${how}`);
      const user = org.users.viewer;
      const projectId = await projectNamed(org, "Has Another", [
        [user, "admin"],
        [org.users.auditor, "admin"],
      ]);

      const response =
        how === "revoke"
          ? await revoke(org, org.users.owner, user)
          : await leave(org, user);

      expect(response.status).toBe(200);
      expect(await projectRowCount(org, user)).toBe(0);
      const rows = await ctx.owner.sql.query(
        "select 1 from project_members where project_id = $1 and role = 'admin'",
        [projectId],
      );
      expect(rows.rowCount).toBe(1);
    },
  );

  it("answers an unauthorized caller 403 without naming any Project", async () => {
    const org = await ctx.createOrganization("om-last-denied");
    await projectNamed(org, "Secret Name", [[org.users.auditor, "admin"]]);

    const response = await revoke(org, org.users.viewer, org.users.auditor);

    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe("PERMISSION_DENIED");
    expect(response.text).not.toContain("Secret Name");
    expect(await memberRowCount(org, org.users.auditor)).toBe(1);
  });

  it.each(["revoke", "leave"] as const)(
    "reports LAST_OWNER before LAST_PROJECT_ADMIN when the sole owner leaves by %s",
    async (how) => {
      const org = await ctx.createOrganization(`om-owner-${how}`);
      await projectNamed(org, "Owner Sole", [[org.users.owner, "admin"]]);

      const response =
        how === "revoke"
          ? await revoke(org, org.users.owner, org.users.owner)
          : await leave(org, org.users.owner);

      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe("LAST_OWNER");
    },
  );
});

describe("concurrent removal and Project role change (AC-06)", () => {
  // Holds the Organization row, starts `first`, waits until it is queued, then
  // starts `second` and waits until it is queued too, so the lock queue (and
  // with it the order the requests run in) is fixed. Revoke and leave take the
  // row FOR UPDATE and a Project role change takes it FOR SHARE.
  async function race(
    org: TestOrganization,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    const holder = await ctx.owner.sql.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for update",
        [org.id],
      );
      const holderPid = (
        await holder.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]?.pid;
      // Backends queued behind the holder, directly or behind another waiter.
      // Read on a separate connection: inside the holder's transaction
      // pg_stat_activity is a snapshot taken at the first read.
      const waitForQueued = (count: number) =>
        vi.waitFor(
          async () => {
            const queued = await ctx.owner.sql.query<{ total: string }>(
              `select count(*) as total from pg_stat_activity a
               where $1::int = any(pg_blocking_pids(a.pid))
                  or exists (
                    select 1 from pg_stat_activity b
                    where b.pid = any(pg_blocking_pids(a.pid))
                      and $1::int = any(pg_blocking_pids(b.pid))
                  )`,
              [holderPid],
            );
            expect(Number(queued.rows[0]?.total)).toBe(count);
          },
          { timeout: 8_000, interval: 25 },
        );
      const firstResponse = first();
      await waitForQueued(1);
      const secondResponse = second();
      await waitForQueued(2);
      await holder.query("commit");
      return [await firstResponse, await secondResponse];
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
  }

  const adminCount = async (projectId: string) =>
    (
      await ctx.owner.sql.query(
        "select 1 from project_members where project_id = $1 and role = 'admin'",
        [projectId],
      )
    ).rowCount;

  describe.each(["revoke", "leave"] as const)("%s", (how) => {
    async function setup() {
      const org = await ctx.createOrganization(`om-race-${how}`);
      const [a, b] = [org.users.viewer, org.users.auditor];
      const projectId = await projectNamed(org, `Race ${how}`, [
        [a, "admin"],
        [b, "admin"],
      ]);
      const removal = () =>
        how === "revoke" ? revoke(org, org.users.owner, a) : leave(org, a);
      const demotion = () =>
        ctx.call(
          org.users.owner,
          "PATCH",
          `${projectBase(org, projectId)}/members/${b}`,
          { role: "member" },
        );
      return { org, a, b, projectId, removal, demotion };
    }

    it("rejects the removal with 409 LAST_PROJECT_ADMIN when the demotion of the other admin runs first", async () => {
      const { org, a, projectId, removal, demotion } = await setup();

      const [demoted, removed] = await race(org, demotion, removal);

      expect(demoted.status).toBe(200);
      expect(removed.status).toBe(409);
      expect(errorOf(removed).code).toBe("LAST_PROJECT_ADMIN");
      expect(await memberRowCount(org, a)).toBe(1);
      expect(await adminCount(projectId)).toBe(1);
    });

    it("rejects the demotion with 409 LAST_PROJECT_ADMIN when the removal runs first", async () => {
      const { org, a, projectId, removal, demotion } = await setup();

      const [removed, demoted] = await race(org, removal, demotion);

      expect(removed.status).toBe(200);
      expect(demoted.status).toBe(409);
      expect(errorOf(demoted).code).toBe("LAST_PROJECT_ADMIN");
      expect(await memberRowCount(org, a)).toBe(0);
      expect(await adminCount(projectId)).toBe(1);
    });
  });
});
