import {
  auditLogListResponseSchema,
  projectListResponseSchema,
  projectSummarySchema,
  type ProjectSummary,
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
  org = await ctx.createOrganization("project-a");
  otherOrg = await ctx.createOrganization("project-b");
  outsider = await ctx.createUser("project-outsider");
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await ctx.close();
});

const projectsPath = (organizationId: string, suffix = "") =>
  `/api/organizations/${organizationId}/projects${suffix}`;

let sequence = 0;
const nextSlug = () => `proj-${ctx.run}-${String(++sequence)}`;

const create = (
  organization: TestOrganization,
  userId: string | null,
  body: Record<string, unknown> = {},
) =>
  ctx.call(userId, "POST", projectsPath(organization.id), {
    name: "Payments",
    slug: nextSlug(),
    ...body,
  });

async function created(
  organization: TestOrganization,
  body: Record<string, unknown> = {},
): Promise<ProjectSummary> {
  const response = await create(organization, organization.users.owner, body);
  expect(response.status).toBe(201);
  return projectSummarySchema.parse(response.json);
}

async function addProjectMember(
  organization: TestOrganization,
  projectId: string,
  userId: string,
  role: "admin" | "member",
) {
  await ctx.owner.sql.query(
    "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, $4)",
    [projectId, organization.id, userId, role],
  );
}

async function projectRows(organizationId: string) {
  return (
    await ctx.owner.sql.query<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      updated_at: Date;
    }>(
      "select id, name, slug, description, updated_at from projects where tenant_id = $1 order by slug",
      [organizationId],
    )
  ).rows;
}

async function auditEvents(organizationId: string, projectId?: string) {
  const rows = await ctx.owner.sql.query<{
    action: string;
    category: string;
    actor_role: string;
    target_type: string;
    target_id: string | null;
    target_attributes: Record<string, unknown>;
    changes: unknown[];
  }>(
    `select action, category, actor_role, target_type, target_id, target_attributes, changes
     from audit_events
     where tenant_id = $1 and ($2::text is null or target_id = $2)
     order by occurred_at, id`,
    [organizationId, projectId ?? null],
  );
  return rows.rows;
}

function errorOf(response: { json: unknown }) {
  return (response.json as { error: { code: string; details?: unknown } })
    .error;
}

describe("create (AC-01, AC-02)", () => {
  it.each(["viewer", "auditor"] as const)(
    "%s answers 403 PERMISSION_DENIED and writes nothing",
    async (role) => {
      const before = (await projectRows(org.id)).length;
      const response = await create(org, org.users[role]);
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe("PERMISSION_DENIED");
      expect(await projectRows(org.id)).toHaveLength(before);
    },
  );

  it("answers 403 MEMBERSHIP_DENIED to a user outside the Organization", async () => {
    const response = await create(org, outsider);
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe("MEMBERSHIP_DENIED");
  });

  it("answers 401 without a session", async () => {
    expect((await create(org, null)).status).toBe(401);
  });

  it.each(["owner", "admin"] as const)(
    "%s creates a Project and becomes its administrator",
    async (role) => {
      const slug = nextSlug();
      const response = await create(org, org.users[role], {
        slug,
        description: "  first project  ",
      });
      expect(response.status).toBe(201);
      const project = projectSummarySchema.parse(response.json);
      expect(project).toMatchObject({
        slug,
        description: "first project",
        memberCount: 1,
        myRole: "admin",
      });
      const members = await ctx.owner.sql.query(
        "select user_id, role from project_members where project_id = $1",
        [project.id],
      );
      expect(members.rows).toEqual([
        { user_id: org.users[role], role: "admin" },
      ]);
    },
  );
});

describe("validation (AC-03, AC-10)", () => {
  it.each([
    { name: "" },
    { name: "n".repeat(81) },
    { slug: "ab" },
    { slug: "Upper-Case" },
    { description: "d".repeat(501) },
    { tenantId: crypto.randomUUID() },
  ])("rejects POST %j with 400", async (body) => {
    const before = (await projectRows(org.id)).length;
    const response = await create(org, org.users.owner, body);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe("VALIDATION_ERROR");
    expect(await projectRows(org.id)).toHaveLength(before);
  });

  it.each([
    {},
    { slug: "renamed-slug" },
    { organizationId: crypto.randomUUID() },
  ])(
    "rejects PATCH %j with 400 and leaves the Project as it was",
    async (body) => {
      const project = await created(org);
      const response = await ctx.call(
        org.users.owner,
        "PATCH",
        projectsPath(org.id, `/${project.id}`),
        body,
      );
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe("VALIDATION_ERROR");
      const rows = await projectRows(org.id);
      expect(rows.find((row) => row.id === project.id)?.slug).toBe(
        project.slug,
      );
    },
  );
});

describe("slug (AC-04)", () => {
  it("answers 409 PROJECT_SLUG_TAKEN with details.field, and allows the slug in another Organization", async () => {
    const first = await created(org);
    const duplicate = await create(org, org.users.admin, { slug: first.slug });
    expect(duplicate.status).toBe(409);
    expect(errorOf(duplicate)).toMatchObject({
      code: "PROJECT_SLUG_TAKEN",
      details: { field: "slug" },
    });
    expect(
      (await create(otherOrg, otherOrg.users.owner, { slug: first.slug }))
        .status,
    ).toBe(201);
  });
});

describe("list (AC-05, AC-06)", () => {
  it("shows memberCount, myRole and updatedAt, and an Owner sees Projects they did not join", async () => {
    const byAdmin = projectSummarySchema.parse(
      (await create(org, org.users.admin, { name: "By admin" })).json,
    );
    const joined = await created(org, { name: "Joined" });
    await addProjectMember(org, joined.id, org.users.viewer, "member");

    const asOwner = await ctx.call(
      org.users.owner,
      "GET",
      projectsPath(org.id),
    );
    expect(asOwner.status).toBe(200);
    const projects = projectListResponseSchema.parse(asOwner.json).projects;
    expect(projects.find((project) => project.id === byAdmin.id)).toMatchObject(
      { memberCount: 1, myRole: null },
    );
    const row = projects.find((project) => project.id === joined.id);
    expect(row).toMatchObject({ memberCount: 2, myRole: "admin" });
    const stored = (await projectRows(org.id)).find(
      (project) => project.id === joined.id,
    );
    expect(row?.updatedAt).toBe(stored?.updated_at.toISOString());
    expect(projects.map((project) => [project.name, project.id])).toEqual(
      [...projects]
        .sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1,
        )
        .map((project) => [project.name, project.id]),
    );
  });

  it("shows a viewer only the Projects they joined, and an empty list when they joined none", async () => {
    const hidden = await created(org, { name: "Hidden" });
    const shared = await created(org, { name: "Shared" });
    await addProjectMember(org, shared.id, org.users.auditor, "member");

    const viewer = await ctx.call(
      org.users.viewer,
      "GET",
      projectsPath(org.id),
    );
    const viewerIds = projectListResponseSchema
      .parse(viewer.json)
      .projects.map((project) => project.id);
    expect(viewerIds).not.toContain(hidden.id);
    expect(viewerIds).not.toContain(shared.id);

    const auditor = await ctx.call(
      org.users.auditor,
      "GET",
      projectsPath(org.id),
    );
    const auditorProjects = projectListResponseSchema.parse(
      auditor.json,
    ).projects;
    expect(auditorProjects.map((project) => project.id)).toContain(shared.id);
    expect(auditorProjects.map((project) => project.id)).not.toContain(
      hidden.id,
    );

    const empty = await ctx.createOrganization("project-empty");
    const none = await ctx.call(
      empty.users.viewer,
      "GET",
      projectsPath(empty.id),
    );
    expect(none.status).toBe(200);
    expect(none.json).toEqual({ projects: [] });
  });

  it("answers 403 MEMBERSHIP_DENIED to a user outside the Organization", async () => {
    const response = await ctx.call(outsider, "GET", projectsPath(org.id));
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe("MEMBERSHIP_DENIED");
  });

  it("never lists another Organization's Projects", async () => {
    const foreign = await created(otherOrg);
    const response = await ctx.call(
      org.users.owner,
      "GET",
      projectsPath(org.id),
    );
    expect(
      projectListResponseSchema
        .parse(response.json)
        .projects.map((project) => project.id),
    ).not.toContain(foreign.id);
  });
});

describe("update and delete permissions", () => {
  it.each([
    ["PATCH", { name: "Changed" }],
    ["DELETE", undefined],
  ] as const)(
    "%s answers 404 PROJECT_NOT_FOUND to a user who cannot see the Project, like a missing id",
    async (method, body) => {
      const project = await created(org);
      const foreign = await created(otherOrg);
      for (const id of [
        project.id,
        crypto.randomUUID(),
        foreign.id,
        "not-a-uuid",
      ]) {
        const asViewer = await ctx.call(
          org.users.viewer,
          method,
          projectsPath(org.id, `/${id}`),
          body,
        );
        expect(asViewer.status).toBe(404);
        expect(errorOf(asViewer).code).toBe("PROJECT_NOT_FOUND");
      }
      const asOwner = await ctx.call(
        org.users.owner,
        method,
        projectsPath(org.id, `/${foreign.id}`),
        body,
      );
      expect(asOwner.status).toBe(404);
      expect(
        (await projectRows(otherOrg.id)).some((row) => row.id === foreign.id),
      ).toBe(true);
    },
  );

  it("lets a Project administrator update but not delete; a Project member does neither", async () => {
    const project = await created(org);
    await addProjectMember(org, project.id, org.users.viewer, "admin");
    await addProjectMember(org, project.id, org.users.auditor, "member");
    const path = projectsPath(org.id, `/${project.id}`);

    expect(
      (await ctx.call(org.users.viewer, "PATCH", path, { name: "By admin" }))
        .status,
    ).toBe(200);
    const denied = await ctx.call(org.users.viewer, "DELETE", path);
    expect(denied.status).toBe(403);
    expect(errorOf(denied).code).toBe("PERMISSION_DENIED");

    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await ctx.call(
        org.users.auditor,
        method,
        path,
        method === "PATCH" ? { name: "By member" } : undefined,
      );
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe("PERMISSION_DENIED");
    }
    const row = (await projectRows(org.id)).find(
      (item) => item.id === project.id,
    );
    expect(row?.name).toBe("By admin");
  });

  it("answers 403 MEMBERSHIP_DENIED to a user outside the Organization", async () => {
    const project = await created(org);
    const response = await ctx.call(
      outsider,
      "DELETE",
      projectsPath(org.id, `/${project.id}`),
    );
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe("MEMBERSHIP_DENIED");
  });
});

describe("update", () => {
  it("changes name and description, and a repeated PATCH changes nothing (no audit, same updated_at)", async () => {
    const project = await created(org, { description: "before" });
    const path = projectsPath(org.id, `/${project.id}`);
    const first = await ctx.call(org.users.admin, "PATCH", path, {
      name: "Renamed",
      description: "after",
    });
    expect(first.status).toBe(200);
    expect(projectSummarySchema.parse(first.json)).toMatchObject({
      name: "Renamed",
      description: "after",
      slug: project.slug,
    });
    const stored = (await projectRows(org.id)).find(
      (row) => row.id === project.id,
    );
    const eventsAfterFirst = await auditEvents(org.id, project.id);

    const repeat = await ctx.call(org.users.admin, "PATCH", path, {
      name: "Renamed",
      description: "after",
    });
    expect(repeat.status).toBe(200);
    expect(repeat.json).toEqual(first.json);
    const again = (await projectRows(org.id)).find(
      (row) => row.id === project.id,
    );
    expect(again?.updated_at.toISOString()).toBe(
      stored?.updated_at.toISOString(),
    );
    expect(await auditEvents(org.id, project.id)).toHaveLength(
      eventsAfterFirst.length,
    );
  });

  it("clears the description with null or a blank string", async () => {
    const project = await created(org, { description: "text" });
    const path = projectsPath(org.id, `/${project.id}`);
    const cleared = await ctx.call(org.users.owner, "PATCH", path, {
      description: "   ",
    });
    expect(projectSummarySchema.parse(cleared.json).description).toBeNull();
  });

  it("answers 404 for a Project another request already deleted", async () => {
    const project = await created(org);
    const path = projectsPath(org.id, `/${project.id}`);
    expect((await ctx.call(org.users.owner, "DELETE", path)).status).toBe(204);
    const patch = await ctx.call(org.users.owner, "PATCH", path, {
      name: "Late",
    });
    expect(patch.status).toBe(404);
    expect(errorOf(patch).code).toBe("PROJECT_NOT_FOUND");
    expect((await ctx.call(org.users.owner, "DELETE", path)).status).toBe(404);
  });
});

describe("delete (AC-08)", () => {
  it("removes the Project and its memberships", async () => {
    const project = await created(org);
    await addProjectMember(org, project.id, org.users.viewer, "member");
    const response = await ctx.call(
      org.users.admin,
      "DELETE",
      projectsPath(org.id, `/${project.id}`),
    );
    expect(response.status).toBe(204);
    expect(
      (await projectRows(org.id)).some((row) => row.id === project.id),
    ).toBe(false);
    const members = await ctx.owner.sql.query(
      "select 1 from project_members where project_id = $1",
      [project.id],
    );
    expect(members.rows).toEqual([]);
  });
});

describe("audit (AC-09)", () => {
  it("records create, update and delete without names or description text, and the audit log API reads them", async () => {
    const auditOrg = await ctx.createOrganization("project-audit");
    const response = await create(auditOrg, auditOrg.users.admin, {
      name: "Audited",
      description: "secret description",
    });
    const project = projectSummarySchema.parse(response.json);
    const path = projectsPath(auditOrg.id, `/${project.id}`);
    await ctx.call(auditOrg.users.admin, "PATCH", path, {
      name: "Audited renamed",
      description: "another secret",
    });

    const stored = await auditEvents(auditOrg.id, project.id);
    expect(stored.map((event) => event.action)).toEqual([
      "organization.project.create",
      "organization.project.update",
    ]);
    expect(stored[0]).toMatchObject({
      category: "project",
      actor_role: "admin",
      target_type: "project",
      target_attributes: {},
      changes: [],
    });
    expect(stored[1]?.changes).toEqual([
      {
        field: "name",
        before: { kind: "value", value: "Audited" },
        after: { kind: "value", value: "Audited renamed" },
      },
      { field: "description", before: null, after: { kind: "changed" } },
    ]);
    expect(JSON.stringify(stored)).not.toContain("secret");

    const readEvents = async () => {
      const read = await ctx.call(
        auditOrg.users.owner,
        "GET",
        `/api/organizations/${auditOrg.id}/audit-log/events?categories=project`,
      );
      expect(read.status).toBe(200);
      return auditLogListResponseSchema.parse(read.json).events;
    };
    const live = await readEvents();
    expect(live.map((event) => event.action).sort()).toEqual([
      "organization.project.create",
      "organization.project.update",
    ]);
    expect(live[0]?.target).toEqual({
      type: "project",
      projectId: project.id,
      displayName: "Audited renamed",
      deleted: false,
    });

    expect((await ctx.call(auditOrg.users.owner, "DELETE", path)).status).toBe(
      204,
    );
    const afterDelete = await readEvents();
    expect(afterDelete).toHaveLength(3);
    for (const event of afterDelete) {
      expect(event.target).toEqual({
        type: "project",
        projectId: project.id,
        displayName: null,
        deleted: true,
      });
    }
    expect(
      afterDelete.find(
        (event) => event.action === "organization.project.delete",
      )?.actor.roleAtTime,
    ).toBe("owner");
  });

  it("leaves no Project row when the audit write fails", async () => {
    const before = await projectRows(org.id);
    vi.spyOn(auditRecord, "recordAuditEvent").mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    const response = await create(org, org.users.owner);
    expect(response.status).toBe(500);
    expect(await projectRows(org.id)).toEqual(before);
  });

  it("keeps the Project when the audit write of a delete or update fails", async () => {
    const project = await created(org);
    const path = projectsPath(org.id, `/${project.id}`);
    vi.spyOn(auditRecord, "recordAuditEvent").mockRejectedValue(
      new Error("audit unavailable"),
    );
    expect(
      (await ctx.call(org.users.owner, "PATCH", path, { name: "Nope" })).status,
    ).toBe(500);
    expect((await ctx.call(org.users.owner, "DELETE", path)).status).toBe(500);
    const row = (await projectRows(org.id)).find(
      (item) => item.id === project.id,
    );
    expect(row?.name).toBe(project.name);
  });
});

describe("limit (AC-11)", () => {
  async function fill(organization: TestOrganization, count: number) {
    await ctx.owner.sql.query(
      `insert into projects (tenant_id, name, slug)
       select $1, 'filler ' || n, 'filler-' || n from generate_series(1, $2::int) as n`,
      [organization.id, count],
    );
  }

  it("answers 409 PROJECT_LIMIT_REACHED for the 51st Project, and deleting one makes room", async () => {
    const full = await ctx.createOrganization("project-full");
    await fill(full, 50);
    const response = await create(full, full.users.owner);
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe("PROJECT_LIMIT_REACHED");
    expect(await projectRows(full.id)).toHaveLength(50);

    const victim = (await projectRows(full.id))[0];
    expect(
      (
        await ctx.call(
          full.users.owner,
          "DELETE",
          projectsPath(full.id, `/${victim?.id ?? ""}`),
        )
      ).status,
    ).toBe(204);
    expect((await create(full, full.users.owner)).status).toBe(201);
  });

  it("lets exactly one of two concurrent creates take the 50th place", async () => {
    const racing = await ctx.createOrganization("project-race");
    await fill(racing, 49);
    const responses = await Promise.all([
      create(racing, racing.users.owner),
      create(racing, racing.users.admin),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const loser = responses.find((response) => response.status === 409);
    expect(loser && errorOf(loser).code).toBe("PROJECT_LIMIT_REACHED");
    expect(await projectRows(racing.id)).toHaveLength(50);
  });
});
