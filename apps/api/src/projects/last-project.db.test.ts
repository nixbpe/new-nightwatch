import { lastProjectResponseSchema } from "@nightwatch/api-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";

let ctx: MonitorTestContext;
let outsider: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  outsider = await ctx.createUser("lp-outsider");
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

type Role = "admin" | "member";

let sequence = 0;
// A Project with exactly the given members; the creator is removed so an
// Organization Owner or Admin is not a Project member.
async function projectNamed(
  org: TestOrganization,
  name: string,
  members: [string, Role][] = [],
): Promise<string> {
  const response = await ctx.call(
    org.users.owner,
    "POST",
    `/api/organizations/${org.id}/projects`,
    { name, slug: `lp-${ctx.run}-${String(++sequence)}` },
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

const put = (
  userId: string | null,
  organizationId: string,
  projectId: string,
) =>
  ctx.call(userId, "PUT", "/api/me/last-project", {
    organizationId,
    projectId,
  });

async function resolved(userId: string | null, organizationId: string) {
  const response = await ctx.call(
    userId,
    "GET",
    `/api/me/last-project?organizationId=${organizationId}`,
  );
  expect(response.status).toBe(200);
  return lastProjectResponseSchema.parse(response.json).projectId;
}

const stored = async (org: TestOrganization, userId: string) =>
  (
    await ctx.owner.sql.query<{ project_id: string }>(
      "select project_id from member_last_project where tenant_id = $1 and user_id = $2",
      [org.id, userId],
    )
  ).rows[0]?.project_id ?? null;

async function memberIdOf(org: TestOrganization, userId: string) {
  const id = (
    await ctx.owner.sql.query<{ id: string }>(
      "select id from member where organization_id = $1 and user_id = $2",
      [org.id, userId],
    )
  ).rows[0]?.id;
  if (id === undefined) throw new Error("fixture member missing");
  return id;
}

const errorCode = (response: { json: unknown }) =>
  (response.json as { error: { code: string } }).error.code;

describe("PUT /api/me/last-project", () => {
  it("remembers a Project the member can read, replacing the previous one", async () => {
    const org = await ctx.createOrganization("lp-put");
    const user = org.users.viewer;
    const first = await projectNamed(org, "Alpha", [[user, "member"]]);
    const second = await projectNamed(org, "Beta", [[user, "member"]]);

    expect((await put(user, org.id, first)).status).toBe(200);
    expect(await stored(org, user)).toBe(first);
    const response = await put(user, org.id, second);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ projectId: second });
    expect(await stored(org, user)).toBe(second);
  });

  it("lets an Owner remember a Project they are not a member of", async () => {
    const org = await ctx.createOrganization("lp-put-owner");
    const project = await projectNamed(org, "Alpha");
    expect((await put(org.users.owner, org.id, project)).status).toBe(200);
    expect(await stored(org, org.users.owner)).toBe(project);
  });

  it("answers 404 PROJECT_NOT_FOUND to a member of the Organization with no access, and stores nothing", async () => {
    const org = await ctx.createOrganization("lp-put-noaccess");
    const user = org.users.viewer;
    const hidden = await projectNamed(org, "Hidden", [
      [org.users.auditor, "member"],
    ]);
    const response = await put(user, org.id, hidden);
    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("PROJECT_NOT_FOUND");
    expect(await stored(org, user)).toBeNull();
  });

  it("answers the same 404 for an unknown, malformed or foreign Project", async () => {
    const org = await ctx.createOrganization("lp-put-unknown");
    const other = await ctx.createOrganization("lp-put-other");
    const foreign = await projectNamed(other, "Foreign");
    const hidden = await put(
      org.users.viewer,
      org.id,
      await projectNamed(org, "Hidden"),
    );
    for (const projectId of [crypto.randomUUID(), "not-a-uuid", foreign]) {
      const response = await put(org.users.owner, org.id, projectId);
      expect(response.status).toBe(404);
      expect(response.json).toEqual(hidden.json);
    }
    expect(await stored(org, org.users.owner)).toBeNull();
  });

  it("answers 403 MEMBERSHIP_DENIED outside the Organization and 401 without a session", async () => {
    const org = await ctx.createOrganization("lp-put-outside");
    const project = await projectNamed(org, "Alpha");
    const denied = await put(outsider, org.id, project);
    expect(denied.status).toBe(403);
    expect(errorCode(denied)).toBe("MEMBERSHIP_DENIED");
    expect((await put(null, org.id, project)).status).toBe(401);
  });

  it("keeps one user's choice away from another user and another Organization", async () => {
    const org = await ctx.createOrganization("lp-iso-a");
    const other = await ctx.createOrganization("lp-iso-b");
    const mine = await projectNamed(org, "Mine", [
      [org.users.viewer, "member"],
      [org.users.auditor, "member"],
    ]);
    await projectNamed(org, "Aaa first", [[org.users.auditor, "member"]]);
    await put(org.users.viewer, org.id, mine);

    expect(await stored(org, org.users.auditor)).toBeNull();
    expect(await stored(other, org.users.viewer)).toBeNull();
    // The auditor has no choice, so gets the first Project by name, not viewer's.
    expect(await resolved(org.users.auditor, org.id)).not.toBe(mine);
  });
});

describe("GET /api/me/last-project fallback chain", () => {
  it("is null when the user can read no Project", async () => {
    const org = await ctx.createOrganization("lp-get-none");
    await projectNamed(org, "Hidden", [[org.users.auditor, "member"]]);
    expect(await resolved(org.users.viewer, org.id)).toBeNull();
  });

  it("is the first Project by name when nothing was remembered, and writes nothing", async () => {
    const org = await ctx.createOrganization("lp-get-first");
    const user = org.users.viewer;
    await projectNamed(org, "Zulu", [[user, "member"]]);
    const alpha = await projectNamed(org, "Alpha", [[user, "member"]]);
    await projectNamed(org, "Aardvark hidden", []);
    expect(await resolved(user, org.id)).toBe(alpha);
    expect(await stored(org, user)).toBeNull();
  });

  it("prefers the remembered Project over the first one", async () => {
    const org = await ctx.createOrganization("lp-get-last");
    const user = org.users.viewer;
    await projectNamed(org, "Alpha", [[user, "member"]]);
    const zulu = await projectNamed(org, "Zulu", [[user, "member"]]);
    await put(user, org.id, zulu);
    expect(await resolved(user, org.id)).toBe(zulu);
  });

  it("falls back to the first accessible Project after the user is removed from the remembered one", async () => {
    const org = await ctx.createOrganization("lp-get-removed");
    const user = org.users.viewer;
    const alpha = await projectNamed(org, "Alpha", [
      [user, "member"],
      [org.users.auditor, "admin"],
    ]);
    const zulu = await projectNamed(org, "Zulu", [
      [user, "member"],
      [org.users.auditor, "admin"],
    ]);
    await put(user, org.id, zulu);
    const removal = await ctx.call(
      org.users.auditor,
      "DELETE",
      `/api/organizations/${org.id}/projects/${zulu}/members/${user}`,
    );
    expect(removal.status).toBe(204);
    expect(await resolved(user, org.id)).toBe(alpha);

    await ctx.call(
      org.users.auditor,
      "DELETE",
      `/api/organizations/${org.id}/projects/${alpha}/members/${user}`,
    );
    expect(await resolved(user, org.id)).toBeNull();
  });

  it("re-checks the Organization role: a demoted admin loses Projects they were not a member of", async () => {
    const org = await ctx.createOrganization("lp-get-demoted");
    const admin = org.users.admin;
    const alpha = await projectNamed(org, "Alpha", [
      [org.users.auditor, "member"],
    ]);
    const zulu = await projectNamed(org, "Zulu", [[admin, "member"]]);
    await put(admin, org.id, alpha);
    expect(await resolved(admin, org.id)).toBe(alpha);

    const memberId = await memberIdOf(org, admin);
    const demotion = await ctx.call(
      org.users.owner,
      "PATCH",
      `/api/organizations/${org.id}/members/${memberId}/role`,
      { role: "viewer" },
    );
    expect(demotion.status).toBe(200);
    expect(await resolved(admin, org.id)).toBe(zulu);
  });

  it("drops a deleted Project from the chain", async () => {
    const org = await ctx.createOrganization("lp-get-deleted");
    const owner = org.users.owner;
    const alpha = await projectNamed(org, "Alpha");
    const zulu = await projectNamed(org, "Zulu");
    await put(owner, org.id, zulu);
    expect(await resolved(owner, org.id)).toBe(zulu);
    const deletion = await ctx.call(
      owner,
      "DELETE",
      `/api/organizations/${org.id}/projects/${zulu}`,
    );
    expect(deletion.status).toBe(204);
    expect(await resolved(owner, org.id)).toBe(alpha);
  });

  it("answers 403 and keeps no row once the user is removed from the Organization", async () => {
    const org = await ctx.createOrganization("lp-get-revoked");
    const user = org.users.viewer;
    const alpha = await projectNamed(org, "Alpha", [[user, "member"]]);
    await put(user, org.id, alpha);
    const memberId = await memberIdOf(org, user);
    const revoked = await ctx.call(
      org.users.owner,
      "DELETE",
      `/api/organizations/${org.id}/members/${memberId}`,
    );
    expect(revoked.status).toBe(200);
    expect(await stored(org, user)).toBeNull();
    const response = await ctx.call(
      user,
      "GET",
      `/api/me/last-project?organizationId=${org.id}`,
    );
    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("MEMBERSHIP_DENIED");
  });

  it("answers 400 for a malformed Organization id and 401 without a session", async () => {
    expect(
      (await ctx.call(outsider, "GET", "/api/me/last-project?organizationId=x"))
        .status,
    ).toBe(400);
    const org = await ctx.createOrganization("lp-get-401");
    expect(
      (
        await ctx.call(
          null,
          "GET",
          `/api/me/last-project?organizationId=${org.id}`,
        )
      ).status,
    ).toBe(401);
  });
});
