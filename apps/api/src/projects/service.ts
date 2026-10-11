import { randomUUID } from "node:crypto";

import {
  PROJECT_LIMIT_PER_ORGANIZATION,
  PROJECT_MEMBER_CANDIDATE_LIMIT,
  type AddProjectMembersRequest,
  type CreateProjectRequest,
  type OrganizationRole,
  type ProjectDetail,
  type ProjectListResponse,
  type ProjectMember,
  type ProjectMemberCandidatesResponse,
  type ProjectMemberListResponse,
  type ProjectRole,
  type ProjectSummary,
  type UpdateProjectMemberRequest,
  type UpdateProjectRequest,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import {
  recordAuditEvent,
  roleChange,
  type AuditChange,
} from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { membershipDenied } from "../monitors/permissions";
import { assertMemberBeforeTenantContext } from "../organization-notifications/service";
import {
  assertProjectAccess,
  projectAccessOf,
  projectNotFound,
  type ProjectAction,
} from "./access";

type Identity = {
  organizationId: string;
  actorUserId: string;
  requestId?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: Date;
  memberCount: number;
  myRole: ProjectRole | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SLUG_CONSTRAINT = "projects_tenant_slug_key";

// `$1` organization, `$2` the requesting user. Every table is filtered by
// tenant_id, not by RLS alone.
const SUMMARY_SELECT = `
  select p.id, p.name, p.slug, p.description, p.updated_at as "updatedAt",
         (select count(*)::int from project_members pm
           where pm.tenant_id = p.tenant_id and pm.project_id = p.id) as "memberCount",
         me.role as "myRole"
  from projects p
  left join project_members me
    on me.tenant_id = p.tenant_id and me.project_id = p.id and me.user_id = $2
  where p.tenant_id = $1`;

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    memberCount: row.memberCount,
    myRole: row.myRole,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isOrganizationAdmin(role: OrganizationRole | null): boolean {
  return role === "owner" || role === "admin";
}

async function memberRole(
  client: PoolClient,
  identity: Identity,
): Promise<string> {
  const member = await client.query<{ role: string }>(
    "select role from member where organization_id = $1 and user_id = $2",
    [identity.organizationId, identity.actorUserId],
  );
  const role = member.rows[0]?.role;
  if (role === undefined) membershipDenied();
  return role;
}

// Membership changes lock the organization row FOR UPDATE, so reading the role
// under FOR SHARE keeps it valid until the transaction ends. Reads need this
// too: the list must not show every Project to an admin being demoted.
async function lockedMemberRole(
  client: PoolClient,
  identity: Identity,
): Promise<OrganizationRole | null> {
  const organization = await client.query(
    "select id from organization where id = $1 for share",
    [identity.organizationId],
  );
  if (organization.rows.length === 0) membershipDenied();
  return normalizeOrganizationRole(await memberRole(client, identity));
}

// Lock order shared by every Project write: organization row, then the
// per-Organization advisory lock (create only), then the projects row
// (update and delete). Not enterOrganization of the monitors, which checks
// monitor permissions.
async function enterOrganization(
  client: PoolClient,
  identity: Identity,
): Promise<OrganizationRole> {
  const role = await lockedMemberRole(client, identity);
  if (role === null) {
    throw new AppError(
      403,
      "PERMISSION_DENIED",
      "คุณไม่มีสิทธิ์จัดการโปรเจกต์ขององค์กรนี้",
    );
  }
  return role;
}

async function loadSummary(
  client: PoolClient,
  identity: Identity,
  projectId: string,
): Promise<ProjectRow> {
  const result = await client.query<ProjectRow>(
    `${SUMMARY_SELECT} and p.id = $3`,
    [identity.organizationId, identity.actorUserId, projectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("project disappeared inside its own transaction");
  return row;
}

// Locks the row (writes), then reads the actor's own membership: a role change
// locks the same row, so reading before the lock could judge by a role that is
// being replaced. Reads pass `lock: false` and take no row lock.
async function lockProject(
  client: PoolClient,
  identity: Identity,
  projectId: string,
  organizationRole: OrganizationRole,
  action: ProjectAction,
  lock = true,
): Promise<{ name: string; description: string | null }> {
  const locked = await client.query<{
    name: string;
    description: string | null;
  }>(
    `select name, description from projects
     where id = $1 and tenant_id = $2${lock ? " for update" : ""}`,
    [projectId, identity.organizationId],
  );
  const row = locked.rows[0];
  if (!row) projectNotFound();
  const mine = await client.query<{ role: ProjectRole }>(
    `select role from project_members
     where tenant_id = $1 and project_id = $2 and user_id = $3`,
    [identity.organizationId, projectId, identity.actorUserId],
  );
  assertProjectAccess(
    projectAccessOf(organizationRole, mine.rows[0]?.role ?? null),
    action,
  );
  return row;
}

function parseProjectId(raw: string): string {
  if (!UUID_PATTERN.test(raw)) projectNotFound();
  return raw.toLowerCase();
}

export async function listProjects(
  database: Database,
  identity: Identity,
): Promise<ProjectListResponse> {
  await assertMemberBeforeTenantContext(
    database,
    identity.organizationId,
    identity.actorUserId,
  );
  return withTenantContextRaw(
    database,
    identity.organizationId,
    async (client) => {
      const role = await lockedMemberRole(client, identity);
      if (role === null) membershipDenied();
      const seesAll = isOrganizationAdmin(role);
      const result = await client.query<ProjectRow>(
        `${SUMMARY_SELECT}${seesAll ? "" : " and me.user_id is not null"}
         order by p.name, p.id`,
        [identity.organizationId, identity.actorUserId],
      );
      return { projects: result.rows.map(toSummary) };
    },
  );
}

export async function createProject(
  database: Database,
  input: Identity & { input: CreateProjectRequest },
): Promise<ProjectSummary> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const actorRole = await enterOrganization(client, input);
      if (!isOrganizationAdmin(actorRole)) {
        throw new AppError(
          403,
          "PERMISSION_DENIED",
          "คุณไม่มีสิทธิ์สร้างโปรเจกต์ในองค์กรนี้",
        );
      }
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        `projects:${input.organizationId}`,
      ]);
      const count = await client.query<{ total: string }>(
        "select count(*) as total from projects where tenant_id = $1",
        [input.organizationId],
      );
      if (Number(count.rows[0]?.total ?? 0) >= PROJECT_LIMIT_PER_ORGANIZATION) {
        throw new AppError(
          409,
          "PROJECT_LIMIT_REACHED",
          "องค์กรนี้มีโปรเจกต์ครบจำนวนสูงสุดแล้ว",
        );
      }
      const projectId = randomUUID();
      try {
        await client.query(
          `insert into projects (id, tenant_id, name, slug, description)
           values ($1, $2, $3, $4, $5)`,
          [
            projectId,
            input.organizationId,
            input.input.name,
            input.input.slug,
            input.input.description ?? null,
          ],
        );
      } catch (error) {
        const failure = error as { code?: string; constraint?: string };
        if (
          failure.code === "23505" &&
          failure.constraint === SLUG_CONSTRAINT
        ) {
          throw new AppError(
            409,
            "PROJECT_SLUG_TAKEN",
            "slug นี้ถูกใช้แล้วในองค์กร",
            { field: "slug" },
          );
        }
        throw error;
      }
      await client.query(
        `insert into project_members (project_id, tenant_id, user_id, role)
         values ($1, $2, $3, 'admin')`,
        [projectId, input.organizationId, input.actorUserId],
      );
      await recordAuditEvent(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole,
        action: "organization.project.create",
        target: { type: "project", id: projectId },
        changes: [],
        requestId: input.requestId,
      });
      return toSummary(await loadSummary(client, input, projectId));
    },
  );
}

// The description text is never recorded: it may be 500 characters of free
// text with personal data, so the event only says that it changed.
function updateChanges(
  before: { name: string; description: string | null },
  after: { name: string; description: string | null },
): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.name !== after.name) {
    changes.push({
      field: "name",
      before: { kind: "value", value: before.name },
      after: { kind: "value", value: after.name },
    });
  }
  if (before.description !== after.description) {
    changes.push({
      field: "description",
      before: null,
      after: { kind: "changed" },
    });
  }
  return changes;
}

export async function updateProject(
  database: Database,
  input: Identity & { projectId: string; input: UpdateProjectRequest },
): Promise<ProjectSummary> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  const projectId = parseProjectId(input.projectId);
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const actorRole = await enterOrganization(client, input);
      const previous = await lockProject(
        client,
        input,
        projectId,
        actorRole,
        "project.update",
      );
      const next = {
        name: input.input.name ?? previous.name,
        description:
          input.input.description === undefined
            ? previous.description
            : input.input.description,
      };
      const changes = updateChanges(previous, next);
      // A repeated PATCH leaves updated_at and the audit log as they were.
      if (changes.length === 0) {
        return toSummary(await loadSummary(client, input, projectId));
      }
      await client.query(
        `update projects set name = $3, description = $4, updated_at = now()
         where id = $1 and tenant_id = $2`,
        [projectId, input.organizationId, next.name, next.description],
      );
      await recordAuditEvent(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole,
        action: "organization.project.update",
        target: { type: "project", id: projectId },
        changes,
        requestId: input.requestId,
      });
      return toSummary(await loadSummary(client, input, projectId));
    },
  );
}

export async function deleteProject(
  database: Database,
  input: Identity & { projectId: string },
): Promise<void> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  const projectId = parseProjectId(input.projectId);
  await withTenantContextRaw(database, input.organizationId, async (client) => {
    const actorRole = await enterOrganization(client, input);
    await lockProject(client, input, projectId, actorRole, "project.delete");
    await client.query(
      "delete from projects where id = $1 and tenant_id = $2",
      [projectId, input.organizationId],
    );
    await recordAuditEvent(client, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole,
      action: "organization.project.delete",
      target: { type: "project", id: projectId },
      changes: [],
      requestId: input.requestId,
    });
  });
}

// ---- Members ----------------------------------------------------------------

type MemberRow = {
  userId: string;
  name: string;
  email: string;
  organizationRole: string;
  projectRole: ProjectRole;
  joinedAt: Date;
};

// `$1` organization, `$2` Project. Sorted for the members table: administrators
// first, then by name.
const MEMBER_SELECT = `
  select pm.user_id as "userId", u.name, u.email,
         m.role as "organizationRole", pm.role as "projectRole",
         pm.created_at as "joinedAt"
  from project_members pm
  join member m on m.organization_id = pm.tenant_id and m.user_id = pm.user_id
  join "user" u on u.id = pm.user_id
  where pm.tenant_id = $1 and pm.project_id = $2`;

// A stored role that no longer normalizes grants no Organization access, so it
// shows as the least privileged role instead of hiding a Project member.
function displayRole(raw: string): OrganizationRole {
  return normalizeOrganizationRole(raw) ?? "viewer";
}

function toMember(row: MemberRow): ProjectMember {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    organizationRole: displayRole(row.organizationRole),
    projectRole: row.projectRole,
    joinedAt: row.joinedAt.toISOString(),
  };
}

async function loadMembers(
  client: PoolClient,
  identity: Identity,
  projectId: string,
): Promise<ProjectMember[]> {
  const result = await client.query<MemberRow>(
    `${MEMBER_SELECT} order by (pm.role = 'admin') desc, u.name, pm.user_id`,
    [identity.organizationId, projectId],
  );
  return result.rows.map(toMember);
}

async function loadMember(
  client: PoolClient,
  identity: Identity,
  projectId: string,
  userId: string,
): Promise<ProjectMember> {
  const result = await client.query<MemberRow>(
    `${MEMBER_SELECT} and pm.user_id = $3`,
    [identity.organizationId, projectId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("member disappeared inside its own transaction");
  return toMember(row);
}

// Reads and writes alike lock the organization row first (FOR SHARE), so the
// actor's Organization role stays valid until the transaction ends.
async function withProjectAccess<T>(
  database: Database,
  input: Identity & { projectId: string },
  action: ProjectAction,
  lock: boolean,
  work: (
    client: PoolClient,
    context: { projectId: string; actorRole: OrganizationRole },
  ) => Promise<T>,
): Promise<T> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  const projectId = parseProjectId(input.projectId);
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const actorRole = lock
        ? await enterOrganization(client, input)
        : await readOrganizationRole(client, input);
      await lockProject(client, input, projectId, actorRole, action, lock);
      return work(client, { projectId, actorRole });
    },
  );
}

async function readOrganizationRole(
  client: PoolClient,
  identity: Identity,
): Promise<OrganizationRole> {
  const role = await lockedMemberRole(client, identity);
  if (role === null) membershipDenied();
  return role;
}

export async function getProject(
  database: Database,
  input: Identity & { projectId: string },
): Promise<ProjectDetail> {
  return withProjectAccess(
    database,
    input,
    "project.read",
    false,
    async (client, { projectId }) => {
      const summary = toSummary(await loadSummary(client, input, projectId));
      const admins = await client.query<{ total: number }>(
        `select count(*)::int as total from project_members
         where tenant_id = $1 and project_id = $2 and role = 'admin'`,
        [input.organizationId, projectId],
      );
      return { ...summary, adminCount: admins.rows[0]?.total ?? 0 };
    },
  );
}

export async function listProjectMembers(
  database: Database,
  input: Identity & { projectId: string },
): Promise<ProjectMemberListResponse> {
  return withProjectAccess(
    database,
    input,
    "project.read",
    false,
    async (client, { projectId }) => ({
      members: await loadMembers(client, input, projectId),
    }),
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// `q` is a search term over personal data: it only ever reaches the query as a
// bound parameter, never a log field or an audit event.
export async function listMemberCandidates(
  database: Database,
  input: Identity & { projectId: string; q: string | undefined },
): Promise<ProjectMemberCandidatesResponse> {
  const q = input.q === undefined || input.q === "" ? null : input.q;
  return withProjectAccess(
    database,
    input,
    "project.members.manage",
    false,
    async (client, { projectId }) => {
      const result = await client.query<{
        userId: string;
        name: string;
        email: string;
        organizationRole: string;
        projectRole: ProjectRole | null;
      }>(
        `select m.user_id as "userId", u.name, u.email,
                m.role as "organizationRole", pm.role as "projectRole"
         from member m
         join "user" u on u.id = m.user_id
         left join project_members pm
           on pm.tenant_id = m.organization_id and pm.project_id = $2
          and pm.user_id = m.user_id
         where m.organization_id = $1
           and ($3::text is null or u.name ilike $3::text or u.email ilike $3::text)
         order by u.name, m.user_id
         limit $4`,
        [
          input.organizationId,
          projectId,
          q === null ? null : `%${escapeLike(q)}%`,
          PROJECT_MEMBER_CANDIDATE_LIMIT,
        ],
      );
      return {
        candidates: result.rows.map((row) => ({
          userId: row.userId,
          name: row.name,
          email: row.email,
          organizationRole: displayRole(row.organizationRole),
          projectRole: row.projectRole,
        })),
      };
    },
  );
}

function memberAudit(
  input: Identity,
  actorRole: OrganizationRole,
  projectId: string,
  userId: string,
  action:
    | "organization.project.member.add"
    | "organization.project.member.role.update"
    | "organization.project.member.remove",
  change: AuditChange,
) {
  return {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorRole,
    action,
    target: { type: "member" as const, id: userId, attributes: { projectId } },
    changes: [change],
    requestId: input.requestId,
  };
}

const NOT_IN_ORGANIZATION = () =>
  new AppError(
    422,
    "PROJECT_MEMBER_NOT_IN_ORGANIZATION",
    "ผู้ใช้บางคนไม่ได้เป็นสมาชิกขององค์กรนี้",
  );

export async function addProjectMembers(
  database: Database,
  input: Identity & { projectId: string; input: AddProjectMembersRequest },
): Promise<ProjectMemberListResponse> {
  return withProjectAccess(
    database,
    input,
    "project.members.manage",
    true,
    async (client, { projectId, actorRole }) => {
      const userIds = [...new Set(input.input.userIds)];
      const known = await client.query<{ userId: string }>(
        `select user_id as "userId" from member
         where organization_id = $1 and user_id = any($2::text[])`,
        [input.organizationId, userIds],
      );
      if (known.rows.length !== userIds.length) throw NOT_IN_ORGANIZATION();
      let inserted: { userId: string }[];
      try {
        // A user already in the Project keeps their role: the request adds,
        // it never changes (AC-04).
        const result = await client.query<{ userId: string }>(
          `insert into project_members (project_id, tenant_id, user_id, role)
           select $1, $2, u, $4 from unnest($3::text[]) as u
           on conflict (project_id, user_id) do nothing
           returning user_id as "userId"`,
          [projectId, input.organizationId, userIds, input.input.role],
        );
        inserted = result.rows;
      } catch (error) {
        // The Organization member row went away between the check and the insert.
        if ((error as { code?: string }).code === "23503") {
          throw NOT_IN_ORGANIZATION();
        }
        throw error;
      }
      for (const { userId } of inserted) {
        await recordAuditEvent(
          client,
          memberAudit(
            input,
            actorRole,
            projectId,
            userId,
            "organization.project.member.add",
            roleChange(null, input.input.role),
          ),
        );
      }
      return { members: await loadMembers(client, input, projectId) };
    },
  );
}

// Rows are read after the Project lock, so two requests that would together
// remove the last administrator run one after the other and the second sees
// the first's result (AC-06). Organization Owners and Admins who are not
// Project members do not count as Project administrators.
async function targetMemberRole(
  client: PoolClient,
  identity: Identity,
  projectId: string,
  userId: string,
): Promise<ProjectRole> {
  const target = await client.query<{ role: ProjectRole }>(
    `select role from project_members
     where tenant_id = $1 and project_id = $2 and user_id = $3`,
    [identity.organizationId, projectId, userId],
  );
  const role = target.rows[0]?.role;
  if (role === undefined) {
    throw new AppError(
      404,
      "PROJECT_MEMBER_NOT_FOUND",
      "ผู้ใช้นี้ไม่ได้เป็นสมาชิกของโปรเจกต์",
    );
  }
  return role;
}

async function assertAnotherAdmin(
  client: PoolClient,
  identity: Identity,
  projectId: string,
  userId: string,
): Promise<void> {
  const others = await client.query<{ total: number }>(
    `select count(*)::int as total from project_members
     where tenant_id = $1 and project_id = $2 and role = 'admin' and user_id <> $3`,
    [identity.organizationId, projectId, userId],
  );
  if ((others.rows[0]?.total ?? 0) === 0) {
    throw new AppError(
      409,
      "LAST_PROJECT_ADMIN",
      "โปรเจกต์ต้องมีผู้ดูแลอย่างน้อยหนึ่งคน",
    );
  }
}

export async function updateProjectMember(
  database: Database,
  input: Identity & {
    projectId: string;
    userId: string;
    input: UpdateProjectMemberRequest;
  },
): Promise<ProjectMember> {
  return withProjectAccess(
    database,
    input,
    "project.members.manage",
    true,
    async (client, { projectId, actorRole }) => {
      const before = await targetMemberRole(
        client,
        input,
        projectId,
        input.userId,
      );
      const after = input.input.role;
      // The same role again leaves the row and the audit log as they were.
      if (before !== after) {
        if (before === "admin") {
          await assertAnotherAdmin(client, input, projectId, input.userId);
        }
        await client.query(
          `update project_members set role = $4
           where tenant_id = $1 and project_id = $2 and user_id = $3`,
          [input.organizationId, projectId, input.userId, after],
        );
        await recordAuditEvent(
          client,
          memberAudit(
            input,
            actorRole,
            projectId,
            input.userId,
            "organization.project.member.role.update",
            roleChange(before, after),
          ),
        );
      }
      return loadMember(client, input, projectId, input.userId);
    },
  );
}

export async function removeProjectMember(
  database: Database,
  input: Identity & { projectId: string; userId: string },
): Promise<void> {
  await withProjectAccess(
    database,
    input,
    "project.members.manage",
    true,
    async (client, { projectId, actorRole }) => {
      const before = await targetMemberRole(
        client,
        input,
        projectId,
        input.userId,
      );
      if (before === "admin") {
        await assertAnotherAdmin(client, input, projectId, input.userId);
      }
      await client.query(
        `delete from project_members
         where tenant_id = $1 and project_id = $2 and user_id = $3`,
        [input.organizationId, projectId, input.userId],
      );
      await recordAuditEvent(
        client,
        memberAudit(
          input,
          actorRole,
          projectId,
          input.userId,
          "organization.project.member.remove",
          roleChange(before, null),
        ),
      );
    },
  );
}
