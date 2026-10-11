import { randomUUID } from "node:crypto";

import {
  PROJECT_LIMIT_PER_ORGANIZATION,
  type CreateProjectRequest,
  type OrganizationRole,
  type ProjectListResponse,
  type ProjectRole,
  type ProjectSummary,
  type UpdateProjectRequest,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent, type AuditChange } from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { membershipDenied } from "../monitors/permissions";
import { assertMemberBeforeTenantContext } from "../organization-notifications/service";
import {
  assertProjectAccess,
  projectAccessOf,
  projectNotFound,
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

// Lock order shared by every Project write: organization row, then the
// per-Organization advisory lock (create only), then the projects row
// (update and delete). The role is read after the organization lock because it
// may have changed since the pre-check. Not enterOrganization of the monitors,
// which checks monitor permissions.
async function enterOrganization(
  client: PoolClient,
  identity: Identity,
): Promise<OrganizationRole> {
  const organization = await client.query(
    "select id from organization where id = $1 for share",
    [identity.organizationId],
  );
  if (organization.rows.length === 0) membershipDenied();
  const role = normalizeOrganizationRole(await memberRole(client, identity));
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

// Locks the row, then reads the actor's own membership: a role change locks
// the same row, so reading before the lock could judge by a role that is
// being replaced.
async function lockProject(
  client: PoolClient,
  identity: Identity,
  projectId: string,
  organizationRole: OrganizationRole,
  action: "project.update" | "project.delete",
): Promise<{ name: string; description: string | null }> {
  const locked = await client.query<{
    name: string;
    description: string | null;
  }>(
    `select name, description from projects
     where id = $1 and tenant_id = $2 for update`,
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
      const seesAll = isOrganizationAdmin(
        normalizeOrganizationRole(await memberRole(client, identity)),
      );
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
