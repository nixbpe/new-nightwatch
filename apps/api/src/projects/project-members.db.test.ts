import {
  auditLogListResponseSchema,
  projectDetailSchema,
  projectMemberCandidatesResponseSchema,
  projectMemberListResponseSchema,
  projectMemberSchema,
  projectSummarySchema,
  type ProjectMember,
} from "@nightwatch/api-contract";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as auditRecord from "../audit/record";
import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";

let ctx: MonitorTestContext;
let org: TestOrganization;
let otherOrg: TestOrganization;
let outsider: string;

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  org = await ctx.createOrganization("pmember-a");
  otherOrg = await ctx.createOrganization("pmember-b");
  outsider = await ctx.createUser("pmember-outsider");
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
  ctx.hooks.before = undefined;
});

afterAll(async () => {
  await ctx.close();
});

type Role = "admin" | "member";

const base = (organization: TestOrganization, projectId: string) =>
  `/api/organizations/${organization.id}/projects/${projectId}`;

let sequence = 0;

// A Project whose only members are the ones given: the creator is removed so
// that an Organization Owner or Admin is not counted as a Project member.
async function projectWith(
  organization: TestOrganization,
  members: [string, Role][],
): Promise<string> {
  const response = await ctx.call(
    organization.users.owner,
    "POST",
    `/api/organizations/${organization.id}/projects`,
    {
      name: `Members ${String(++sequence)}`,
      slug: `pm-${ctx.run}-${String(sequence)}`,
    },
  );
  expect(response.status).toBe(201);
  const { id } = projectSummarySchema.parse(response.json);
  await ctx.owner.sql.query(
    "delete from project_members where project_id = $1",
    [id],
  );
  for (const [userId, role] of members) {
    await ctx.owner.sql.query(
      "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, $4)",
      [id, organization.id, userId, role],
    );
  }
  return id;
}

async function rolesOf(projectId: string): Promise<Record<string, string>> {
  const rows = await ctx.owner.sql.query<{ user_id: string; role: string }>(
    "select user_id, role from project_members where project_id = $1",
    [projectId],
  );
  return Object.fromEntries(rows.rows.map((row) => [row.user_id, row.role]));
}

async function memberEvents(organizationId: string, projectId: string) {
  const rows = await ctx.owner.sql.query<{
    action: string;
    actor_role: string;
    target_type: string;
    target_id: string;
    target_attributes: Record<string, unknown>;
    changes: unknown[];
  }>(
    `select action, actor_role, target_type, target_id, target_attributes, changes
     from audit_events
     where tenant_id = $1 and action like 'organization.project.member.%'
       and target_attributes ->> 'projectId' = $2
     order by occurred_at, id`,
    [organizationId, projectId],
  );
  return rows.rows;
}

const errorCode = (response: { json: unknown }) =>
  (response.json as { error: { code: string } }).error.code;

const add = (
  organization: TestOrganization,
  actor: string | null,
  projectId: string,
  body: Record<string, unknown>,
) => ctx.call(actor, "POST", `${base(organization, projectId)}/members`, body);

const patch = (
  organization: TestOrganization,
  actor: string,
  projectId: string,
  userId: string,
  role: string,
) =>
  ctx.call(
    actor,
    "PATCH",
    `${base(organization, projectId)}/members/${userId}`,
    {
      role,
    },
  );

const remove = (
  organization: TestOrganization,
  actor: string,
  projectId: string,
  userId: string,
) =>
  ctx.call(
    actor,
    "DELETE",
    `${base(organization, projectId)}/members/${userId}`,
  );

describe("add members (AC-04, AC-09, AC-12)", () => {
  it("lets an Organization Owner or Admin who is not a Project member add users, deduplicated, one audit event per user", async () => {
    const projectId = await projectWith(org, []);
    const response = await add(org, org.users.admin, projectId, {
      userIds: [org.users.viewer, org.users.viewer, org.users.auditor],
      role: "member",
    });
    expect(response.status).toBe(200);
    const { members } = projectMemberListResponseSchema.parse(response.json);
    expect(members.map((member) => member.userId).sort()).toEqual(
      [org.users.viewer, org.users.auditor].sort(),
    );
    expect(await rolesOf(projectId)).toEqual({
      [org.users.viewer]: "member",
      [org.users.auditor]: "member",
    });
    const events = await memberEvents(org.id, projectId);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "organization.project.member.add",
      actor_role: "admin",
      target_type: "member",
      target_attributes: { projectId },
      changes: [
        {
          field: "role",
          before: null,
          after: { kind: "value", value: "member" },
        },
      ],
    });
    expect(events.map((event) => event.target_id).sort()).toEqual(
      [org.users.viewer, org.users.auditor].sort(),
    );
    expect(JSON.stringify(events)).not.toContain("@");
  });

  it("is idempotent: a user already in the Project keeps their role and writes no event", async () => {
    const projectId = await projectWith(org, [[org.users.viewer, "admin"]]);
    const again = await add(org, org.users.owner, projectId, {
      userIds: [org.users.viewer],
      role: "member",
    });
    expect(again.status).toBe(200);
    expect(await rolesOf(projectId)).toEqual({ [org.users.viewer]: "admin" });
    expect(await memberEvents(org.id, projectId)).toHaveLength(0);

    const mixed = await add(org, org.users.owner, projectId, {
      userIds: [org.users.viewer, org.users.auditor],
      role: "member",
    });
    expect(mixed.status).toBe(200);
    expect(await rolesOf(projectId)).toEqual({
      [org.users.viewer]: "admin",
      [org.users.auditor]: "member",
    });
    const events = await memberEvents(org.id, projectId);
    expect(events.map((event) => event.target_id)).toEqual([org.users.auditor]);
  });

  it.each(["owner", "admin", "viewer", "auditor"] as const)(
    "adds an Organization %s as admin and as member (AC-12)",
    async (role) => {
      const projectId = await projectWith(org, [[org.users.viewer, "admin"]]);
      if (role === "viewer") {
        await ctx.owner.sql.query(
          "delete from project_members where project_id = $1",
          [projectId],
        );
        await ctx.owner.sql.query(
          "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'admin')",
          [projectId, org.id, org.users.auditor],
        );
      }
      for (const projectRole of ["admin", "member"] as const) {
        await ctx.owner.sql.query(
          "delete from project_members where project_id = $1 and user_id = $2",
          [projectId, org.users[role]],
        );
        const response = await add(org, org.users.owner, projectId, {
          userIds: [org.users[role]],
          role: projectRole,
        });
        expect(response.status).toBe(200);
        const { members } = projectMemberListResponseSchema.parse(
          response.json,
        );
        expect(
          members.find((member) => member.userId === org.users[role]),
        ).toMatchObject({ organizationRole: role, projectRole });
      }
    },
  );

  it("answers 422 PROJECT_MEMBER_NOT_IN_ORGANIZATION and adds nobody when one user is not a member of the Organization", async () => {
    const projectId = await projectWith(org, []);
    for (const stranger of [outsider, otherOrg.users.owner, "no-such-user"]) {
      const response = await add(org, org.users.owner, projectId, {
        userIds: [org.users.viewer, stranger],
        role: "member",
      });
      expect(response.status).toBe(422);
      expect(errorCode(response)).toBe("PROJECT_MEMBER_NOT_IN_ORGANIZATION");
    }
    expect(await rolesOf(projectId)).toEqual({});
    expect(await memberEvents(org.id, projectId)).toHaveLength(0);
  });

  it("answers 422, not 500, when the Organization member disappears before the insert", async () => {
    const projectId = await projectWith(org, []);
    const leaving = await ctx.createUser("pmember-leaving");
    await ctx.owner.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [crypto.randomUUID(), org.id, leaving],
    );
    let removed = false;
    ctx.hooks.before = async (text) => {
      if (removed || !text.includes("insert into project_members")) return;
      removed = true;
      await ctx.owner.sql.query(
        "delete from member where organization_id = $1 and user_id = $2",
        [org.id, leaving],
      );
    };
    const response = await add(org, org.users.owner, projectId, {
      userIds: [leaving],
      role: "member",
    });
    expect(removed).toBe(true);
    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("PROJECT_MEMBER_NOT_IN_ORGANIZATION");
    expect(await rolesOf(projectId)).toEqual({});
  });

  it.each([
    { userIds: [], role: "member" },
    { userIds: ["x"] },
    { userIds: ["x"], role: "owner" },
    { userIds: ["x"], role: "member", tenantId: "t" },
    {
      userIds: Array.from({ length: 101 }, (_, index) => String(index)),
      role: "member",
    },
  ])("rejects %j with 400", async (body) => {
    const projectId = await projectWith(org, []);
    const response = await add(org, org.users.owner, projectId, body);
    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("keeps updated_at as it was", async () => {
    const projectId = await projectWith(org, [[org.users.viewer, "admin"]]);
    const read = async () =>
      (
        await ctx.owner.sql.query<{ updated_at: Date }>(
          "select updated_at from projects where id = $1",
          [projectId],
        )
      ).rows[0]?.updated_at.getTime();
    const before = await read();
    await add(org, org.users.owner, projectId, {
      userIds: [org.users.auditor],
      role: "member",
    });
    await patch(org, org.users.owner, projectId, org.users.auditor, "admin");
    await remove(org, org.users.owner, projectId, org.users.auditor);
    expect(await read()).toBe(before);
  });
});

describe("change role and remove (AC-05, AC-06, AC-09)", () => {
  it("changes a role once, records before and after, and a repeated PATCH writes nothing", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "member"],
    ]);
    const first = await patch(
      org,
      org.users.owner,
      projectId,
      org.users.auditor,
      "admin",
    );
    expect(first.status).toBe(200);
    expect(projectMemberSchema.parse(first.json)).toMatchObject({
      userId: org.users.auditor,
      projectRole: "admin",
      organizationRole: "auditor",
    });
    const again = await patch(
      org,
      org.users.owner,
      projectId,
      org.users.auditor,
      "admin",
    );
    expect(again.status).toBe(200);
    const events = await memberEvents(org.id, projectId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "organization.project.member.role.update",
      actor_role: "owner",
      target_id: org.users.auditor,
      changes: [
        {
          field: "role",
          before: { kind: "value", value: "member" },
          after: { kind: "value", value: "admin" },
        },
      ],
    });
  });

  it("removes a member with one event, and answers 404 PROJECT_MEMBER_NOT_FOUND for a user not in the Project", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "member"],
    ]);
    expect(
      (await remove(org, org.users.admin, projectId, org.users.auditor)).status,
    ).toBe(204);
    expect(await rolesOf(projectId)).toEqual({ [org.users.viewer]: "admin" });
    const events = await memberEvents(org.id, projectId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "organization.project.member.remove",
      actor_role: "admin",
      changes: [
        {
          field: "role",
          before: { kind: "value", value: "member" },
          after: null,
        },
      ],
    });
    for (const response of [
      await remove(org, org.users.admin, projectId, org.users.auditor),
      await patch(org, org.users.admin, projectId, org.users.auditor, "admin"),
      await patch(org, org.users.admin, projectId, outsider, "admin"),
    ]) {
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe("PROJECT_MEMBER_NOT_FOUND");
    }
    expect(await memberEvents(org.id, projectId)).toHaveLength(1);
  });

  it.each([
    ["the last administrator demoting themself", "viewer", "self-demote"],
    ["the last administrator removing themself", "viewer", "self-remove"],
    [
      "an Organization Owner demoting the last administrator",
      "owner",
      "demote",
    ],
    [
      "an Organization Admin removing the last administrator",
      "admin",
      "remove",
    ],
  ] as const)(
    "answers 409 LAST_PROJECT_ADMIN for %s (AC-05)",
    async (_name, actor, operation) => {
      // Owner and Admin are not Project members, so they never count as Project administrators.
      const projectId = await projectWith(org, [
        [org.users.viewer, "admin"],
        [org.users.auditor, "member"],
      ]);
      const act =
        operation === "self-demote" || operation === "demote"
          ? patch(org, org.users[actor], projectId, org.users.viewer, "member")
          : remove(org, org.users[actor], projectId, org.users.viewer);
      const response = await act;
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe("LAST_PROJECT_ADMIN");
      expect(await rolesOf(projectId)).toEqual({
        [org.users.viewer]: "admin",
        [org.users.auditor]: "member",
      });
      expect(await memberEvents(org.id, projectId)).toHaveLength(0);
    },
  );

  it("lets an administrator demote or remove another once a second administrator exists", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "admin"],
    ]);
    expect(
      (
        await patch(
          org,
          org.users.viewer,
          projectId,
          org.users.viewer,
          "member",
        )
      ).status,
    ).toBe(200);
    expect(await rolesOf(projectId)).toEqual({
      [org.users.viewer]: "member",
      [org.users.auditor]: "admin",
    });
  });

  it.each([{ role: "owner" }, {}, { role: "member", userId: "x" }])(
    "rejects PATCH %j with 400",
    async (body) => {
      const projectId = await projectWith(org, [[org.users.viewer, "admin"]]);
      const response = await ctx.call(
        org.users.owner,
        "PATCH",
        `${base(org, projectId)}/members/${org.users.viewer}`,
        body,
      );
      expect(response.status).toBe(400);
    },
  );

  // Both requests wait on the Project row, so whichever runs second must see
  // the first's result. Each caller picks its actors: the demotion and
  // removal races use the Organization Owner and Admin (not Project members),
  // so the loser's rejection is the last-admin rule, not a lost permission.
  // The self-demotion race uses the two Project administrators themselves.
  async function race(
    first: (projectId: string) => ReturnType<typeof ctx.call>,
    second: (projectId: string) => ReturnType<typeof ctx.call>,
  ) {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "admin"],
    ]);
    const holder = await ctx.owner.sql.connect();
    let responses: Awaited<ReturnType<typeof ctx.call>>[];
    try {
      await holder.query("begin");
      await holder.query("select id from projects where id = $1 for update", [
        projectId,
      ]);
      const pending = Promise.all([first(projectId), second(projectId)]);
      await vi.waitFor(
        async () => {
          // The first waiter queues on the holder's transaction id; the second
          // queues behind the first on the row's tuple lock.
          const waiting = await holder.query<{ total: string }>(
            `select count(*) as total from pg_locks
             where not granted
               and ((locktype = 'transactionid'
                     and transactionid = xid(pg_current_xact_id()))
                 or (locktype = 'tuple'
                     and relation = 'projects'::regclass))`,
          );
          expect(Number(waiting.rows[0]?.total)).toBe(2);
        },
        { timeout: 10_000, interval: 25 },
      );
      await holder.query("commit");
      responses = await pending;
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    expect(
      statuses.filter((status) => status === 200 || status === 204),
    ).toHaveLength(1);
    const loser = responses.find((response) => response.status === 409);
    expect(loser && errorCode(loser)).toBe("LAST_PROJECT_ADMIN");
    const roles = await rolesOf(projectId);
    expect(
      Object.values(roles).filter((role) => role === "admin"),
    ).toHaveLength(1);
    return projectId;
  }

  it("lets exactly one of two concurrent demotions through (AC-06)", async () => {
    const projectId = await race(
      (id) => patch(org, org.users.owner, id, org.users.viewer, "member"),
      (id) => patch(org, org.users.admin, id, org.users.auditor, "member"),
    );
    expect(await memberEvents(org.id, projectId)).toHaveLength(1);
  });

  it("lets exactly one of a concurrent demotion and removal through (AC-06)", async () => {
    const projectId = await race(
      (id) => patch(org, org.users.owner, id, org.users.viewer, "member"),
      (id) => remove(org, org.users.admin, id, org.users.auditor),
    );
    expect(await memberEvents(org.id, projectId)).toHaveLength(1);
  });

  it("lets exactly one of two concurrent self-demotions through (AC-06)", async () => {
    await race(
      (id) => patch(org, org.users.viewer, id, org.users.viewer, "member"),
      (id) => patch(org, org.users.auditor, id, org.users.auditor, "member"),
    );
  });
});

describe("permissions (AC-07, AC-08)", () => {
  it("answers 403 PERMISSION_DENIED to a Project member on candidates, add, change and remove, and still lets them read", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "member"],
      [org.users.auditor, "admin"],
    ]);
    const actor = org.users.viewer;
    const denied = [
      await ctx.call(actor, "GET", `${base(org, projectId)}/member-candidates`),
      await add(org, actor, projectId, {
        userIds: [org.users.owner],
        role: "member",
      }),
      await patch(org, actor, projectId, org.users.auditor, "member"),
      await patch(org, actor, projectId, "no-such-user", "member"),
      await remove(org, actor, projectId, org.users.auditor),
    ];
    for (const response of denied) {
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe("PERMISSION_DENIED");
    }
    expect(await rolesOf(projectId)).toEqual({
      [org.users.viewer]: "member",
      [org.users.auditor]: "admin",
    });
    expect(await memberEvents(org.id, projectId)).toHaveLength(0);
    expect((await ctx.call(actor, "GET", base(org, projectId))).status).toBe(
      200,
    );
    expect(
      (await ctx.call(actor, "GET", `${base(org, projectId)}/members`)).status,
    ).toBe(200);
  });

  it("lets a Project administrator manage members", async () => {
    const projectId = await projectWith(org, [[org.users.viewer, "admin"]]);
    expect(
      (
        await add(org, org.users.viewer, projectId, {
          userIds: [org.users.auditor],
          role: "member",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await patch(
          org,
          org.users.viewer,
          projectId,
          org.users.auditor,
          "admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (await remove(org, org.users.viewer, projectId, org.users.auditor))
        .status,
    ).toBe(204);
  });

  it("answers 404 PROJECT_NOT_FOUND on every route to a user who cannot see the Project, and for a Project of another Organization or a malformed id", async () => {
    const projectId = await projectWith(org, [[org.users.auditor, "admin"]]);
    const foreign = await projectWith(otherOrg, [
      [otherOrg.users.viewer, "admin"],
    ]);
    const routes = (
      organization: TestOrganization,
      id: string,
      actor: string,
    ) => [
      ctx.call(actor, "GET", base(organization, id)),
      ctx.call(actor, "GET", `${base(organization, id)}/members`),
      ctx.call(actor, "GET", `${base(organization, id)}/member-candidates`),
      add(organization, actor, id, { userIds: [actor], role: "member" }),
      patch(organization, actor, id, org.users.auditor, "member"),
      remove(organization, actor, id, org.users.auditor),
    ];
    const cases = [
      // A viewer who is not in the Project.
      ...routes(org, projectId, org.users.viewer),
      // A Project id from another Organization, asked as an Owner of this one.
      ...routes(org, foreign, org.users.owner),
      ...routes(org, "not-a-uuid", org.users.owner),
    ];
    for (const response of await Promise.all(cases)) {
      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe("PROJECT_NOT_FOUND");
    }
    expect(await rolesOf(projectId)).toEqual({ [org.users.auditor]: "admin" });
    expect(await rolesOf(foreign)).toEqual({
      [otherOrg.users.viewer]: "admin",
    });
  });

  it("answers 403 MEMBERSHIP_DENIED outside the Organization and 401 without a session", async () => {
    const projectId = await projectWith(org, [[org.users.viewer, "admin"]]);
    const outside = await ctx.call(
      outsider,
      "GET",
      `${base(org, projectId)}/members`,
    );
    expect(outside.status).toBe(403);
    expect(errorCode(outside)).toBe("MEMBERSHIP_DENIED");
    expect(
      (await add(org, null, projectId, { userIds: ["x"], role: "member" }))
        .status,
    ).toBe(401);
  });
});

describe("read", () => {
  it("returns the Project with memberCount, adminCount and myRole", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "member"],
    ]);
    const asMember = projectDetailSchema.parse(
      (await ctx.call(org.users.auditor, "GET", base(org, projectId))).json,
    );
    expect(asMember).toMatchObject({
      memberCount: 2,
      adminCount: 1,
      myRole: "member",
    });
    const asOwner = projectDetailSchema.parse(
      (await ctx.call(org.users.owner, "GET", base(org, projectId))).json,
    );
    expect(asOwner).toMatchObject({
      memberCount: 2,
      adminCount: 1,
      myRole: null,
    });
  });

  it("lists administrators first, then by name, with joinedAt", async () => {
    const projectId = await projectWith(org, [
      [org.users.auditor, "member"],
      [org.users.viewer, "member"],
      [org.users.admin, "admin"],
    ]);
    const response = await ctx.call(
      org.users.owner,
      "GET",
      `${base(org, projectId)}/members`,
    );
    const { members } = projectMemberListResponseSchema.parse(response.json);
    expect(members[0]?.userId).toBe(org.users.admin);
    const rest = members.slice(1);
    expect(rest.map((member) => member.name)).toEqual(
      rest.map((member) => member.name).sort((a, b) => a.localeCompare(b)),
    );
    expect(members.every((member) => member.email.includes("@"))).toBe(true);
    expect(
      members.every(
        (member: ProjectMember) => !Number.isNaN(Date.parse(member.joinedAt)),
      ),
    ).toBe(true);
  });
});

describe("member candidates", () => {
  const candidates = async (
    projectId: string,
    query: string,
    actor = org.users.owner,
  ) => {
    const response = await ctx.call(
      actor,
      "GET",
      `${base(org, projectId)}/member-candidates${query}`,
    );
    expect(response.status).toBe(200);
    return projectMemberCandidatesResponseSchema.parse(response.json)
      .candidates;
  };

  it("returns every matching Organization member with their Project role, by name or email, ignoring case", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "member"],
    ]);
    const emailOf = async (userId: string) =>
      (
        await ctx.owner.sql.query<{ email: string }>(
          'select email from "user" where id = $1',
          [userId],
        )
      ).rows[0]?.email ?? "";
    const email = await emailOf(org.users.viewer);
    const byEmail = await candidates(
      projectId,
      `?q=${encodeURIComponent(email.toUpperCase())}`,
    );
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]).toMatchObject({
      userId: org.users.viewer,
      projectRole: "admin",
      organizationRole: "viewer",
    });
    const all = await candidates(projectId, `?q=pmember-a-`);
    expect(
      Object.fromEntries(
        all.map((candidate) => [candidate.userId, candidate.projectRole]),
      ),
    ).toEqual({
      [org.users.owner]: null,
      [org.users.admin]: null,
      [org.users.viewer]: "admin",
      [org.users.auditor]: "member",
    });
    const none = await candidates(projectId, "?q=zzz-no-match-zzz");
    expect(none).toEqual([]);
  });

  it("treats % and _ in q literally and rejects a q over 100 characters", async () => {
    const projectId = await projectWith(org, []);
    expect(await candidates(projectId, "?q=%25")).toEqual([]);
    expect(await candidates(projectId, "?q=_")).toEqual([]);
    const tooLong = await ctx.call(
      org.users.owner,
      "GET",
      `${base(org, projectId)}/member-candidates?q=${"a".repeat(101)}`,
    );
    expect(tooLong.status).toBe(400);
  });

  it("returns at most 50 candidates, ordered by name", async () => {
    const big = await ctx.createOrganization("pmember-big");
    for (let index = 0; index < 52; index += 1) {
      const userId = await ctx.createUser(`pmember-big-extra-${String(index)}`);
      await ctx.owner.sql.query(
        "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
        [crypto.randomUUID(), big.id, userId],
      );
    }
    const projectId = await projectWith(big, []);
    const response = await ctx.call(
      big.users.owner,
      "GET",
      `${base(big, projectId)}/member-candidates`,
    );
    const list = projectMemberCandidatesResponseSchema.parse(
      response.json,
    ).candidates;
    expect(list).toHaveLength(50);
    const names = list.map((candidate) => candidate.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("audit (AC-10)", () => {
  it("is readable through the audit log API with both the member and the Project resolved, and the Project name follows a rename", async () => {
    const auditOrg = await ctx.createOrganization("pmember-audit");
    const projectId = await projectWith(auditOrg, [
      [auditOrg.users.viewer, "admin"],
    ]);
    await add(auditOrg, auditOrg.users.owner, projectId, {
      userIds: [auditOrg.users.auditor],
      role: "member",
    });
    await patch(
      auditOrg,
      auditOrg.users.owner,
      projectId,
      auditOrg.users.auditor,
      "admin",
    );
    await remove(
      auditOrg,
      auditOrg.users.owner,
      projectId,
      auditOrg.users.auditor,
    );

    const read = await ctx.call(
      auditOrg.users.owner,
      "GET",
      `/api/organizations/${auditOrg.id}/audit-log/events?categories=project`,
    );
    expect(read.status).toBe(200);
    const events = auditLogListResponseSchema
      .parse(read.json)
      .events.filter((event) =>
        event.action.startsWith("organization.project.member."),
      );
    expect(events.map((event) => event.action).sort()).toEqual([
      "organization.project.member.add",
      "organization.project.member.remove",
      "organization.project.member.role.update",
    ]);
    const projectName = (
      await ctx.owner.sql.query<{ name: string }>(
        "select name from projects where id = $1",
        [projectId],
      )
    ).rows[0]?.name;
    const auditorName = (
      await ctx.owner.sql.query<{ name: string }>(
        'select name from "user" where id = $1',
        [auditOrg.users.auditor],
      )
    ).rows[0]?.name;
    for (const event of events) {
      expect(event.target).toEqual({
        type: "member",
        userId: auditOrg.users.auditor,
        displayName: auditorName,
        membership: "current",
        project: { projectId, displayName: projectName, deleted: false },
      });
    }
  });

  it("rolls the member write back when the audit write fails", async () => {
    const projectId = await projectWith(org, [
      [org.users.viewer, "admin"],
      [org.users.auditor, "member"],
    ]);
    const before = await rolesOf(projectId);
    vi.spyOn(auditRecord, "recordAuditEvent").mockRejectedValue(
      new Error("audit unavailable"),
    );
    const responses = [
      await add(org, org.users.owner, projectId, {
        userIds: [org.users.admin],
        role: "member",
      }),
      await patch(org, org.users.owner, projectId, org.users.auditor, "admin"),
      await remove(org, org.users.owner, projectId, org.users.auditor),
    ];
    expect(responses.map((response) => response.status)).toEqual([
      500, 500, 500,
    ]);
    expect(await rolesOf(projectId)).toEqual(before);
  });
});

describe("search term redaction", () => {
  it("keeps q out of the logs and the audit log on success, denial and validation failure", async () => {
    const term = `somchai.secret.${ctx.run}@example.test`;
    const projectId = await projectWith(org, [
      [org.users.viewer, "member"],
      [org.users.auditor, "admin"],
    ]);
    const path = `${base(org, projectId)}/member-candidates`;
    const ok = await ctx.call(org.users.owner, "GET", `${path}?q=${term}`);
    const denied = await ctx.call(org.users.viewer, "GET", `${path}?q=${term}`);
    const invalid = await ctx.call(
      org.users.owner,
      "GET",
      `${path}?q=${term}${"a".repeat(100)}`,
    );
    expect([ok.status, denied.status, invalid.status]).toEqual([200, 403, 400]);
    expect(ctx.lines.length).toBeGreaterThan(0);
    expect(ctx.lines.join("\n")).not.toContain(term);
    expect(JSON.stringify(invalid.json)).not.toContain(term);
    const events = await ctx.owner.sql.query(
      "select 1 from audit_events where tenant_id = $1 and (target_attributes::text like $2 or changes::text like $2)",
      [org.id, `%${term}%`],
    );
    expect(events.rows).toEqual([]);
  });
});
