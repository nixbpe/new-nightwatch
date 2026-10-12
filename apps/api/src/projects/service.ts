import { randomUUID } from "node:crypto";

import {
  PROJECT_LIMIT_PER_ORGANIZATION,
  type CreateProjectRequest,
  type LastProjectResponse,
  type RememberedProjectResponse,
  type OrganizationRole,
  type ProjectDetail,
  type ProjectListResponse,
  type ProjectRole,
  type ProjectSummary,
  type UpdateProjectRequest,
} from "@nightwatch/api-contract";
import {
  withTenantContextRaw,
  withTenantUserContextRaw,
  type Database,
} from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent, type AuditChange } from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "../organization-notifications/service";
import {
  assertProjectAccess,
  isReadAction,
  projectAccessOf,
  projectNotFound,
  type ProjectAction,
} from "./access";

export type Identity = {
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

// A nonmember and a missing Organization get the same denial, so callers
// cannot probe which Organizations exist.
export function membershipDenied(): never {
  throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
}

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
// (update and delete).
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

// Locks the row, then reads the actor's own membership: a role change locks the
// same row, so reading before the lock could judge by a role that is being
// replaced. Writes take FOR UPDATE. Reads pass `exclusive: false` and take
// FOR SHARE: a delete holds FOR UPDATE, so a read either finishes before it or
// waits and then finds the Project gone (404), never a half-deleted one. Shared
// locks do not block each other and nobody upgrades one, so they cannot
// deadlock with a writer.
async function lockProject(
  client: PoolClient,
  identity: Identity,
  projectId: string,
  organizationRole: OrganizationRole,
  action: ProjectAction,
  exclusive = true,
): Promise<{ name: string; description: string | null }> {
  const locked = await client.query<{
    name: string;
    description: string | null;
  }>(
    `select name, description from projects
     where id = $1 and tenant_id = $2 ${exclusive ? "for update" : "for share"}`,
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

// Reads and writes alike lock the organization row first (FOR SHARE), so the
// actor's Organization role stays valid until the transaction ends. The action
// decides the answer to a role that no longer normalizes: a read is denied as
// listProjects denies it (MEMBERSHIP_DENIED), management as the other Project
// writes deny it (PERMISSION_DENIED). `exclusive` only picks the row lock.
export async function withProjectAccess<T>(
  database: Database,
  input: Identity & { projectId: string },
  action: ProjectAction,
  exclusive: boolean,
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
      const actorRole = isReadAction(action)
        ? await readOrganizationRole(client, input)
        : await enterOrganization(client, input);
      await lockProject(client, input, projectId, actorRole, action, exclusive);
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

// The remembered Project is a hint, not a grant: it is written only after the
// caller passed the same read check as GET /{projectId}, and every read checks
// access again. The user context is set on the connection that already holds
// the Organization and Project locks, so a revocation cannot interleave.
// Writes are ordered by `selectedAt`, the client's landing time clamped to the
// server clock (a fast client clock cannot block later saves): an older save
// that arrives late leaves the row alone, and the response is the Project the
// row holds afterwards, whichever request wrote it. The reply is read back in a
// fresh statement and only names a Project the caller can still read (a member
// of it, or Owner/Admin; the rule of resolveLastProject). When the stored one is
// not readable (removed from it, demoted, deleted with its row), the requested
// Project replaces it, inserting the row if the deletion removed it.
// Under READ COMMITTED a removal committing after the read-back is a valid
// order: the stored Project was readable when answered. No lock on the stored
// Project is taken, so no order against the removal path's locks arises.
// Accepted limit: `selectedAt` comes from the clients' clocks, so a device that
// runs behind can lose to an earlier landing from another device by up to that
// skew; equal stamps keep the first stored.
export async function rememberLastProject(
  database: Database,
  input: Identity & { projectId: string; selectedAt: string },
): Promise<RememberedProjectResponse> {
  return withProjectAccess(
    database,
    input,
    "project.read",
    false,
    async (client, { projectId, actorRole }) => {
      await client.query("select set_config('app.user_id', $1, true)", [
        input.actorUserId,
      ]);
      const admin = isOrganizationAdmin(actorRole);
      await client.query(
        `insert into member_last_project
           (tenant_id, user_id, project_id, selected_at)
         values ($1, $2, $3, least($4::timestamptz, now()))
         on conflict (tenant_id, user_id)
         do update set project_id = excluded.project_id,
                       selected_at = excluded.selected_at,
                       updated_at = now()
         where member_last_project.selected_at < excluded.selected_at`,
        [input.organizationId, input.actorUserId, projectId, input.selectedAt],
      );
      // A fresh statement, so a removal that committed while the upsert waited is seen.
      const readable = await client.query<{ project_id: string }>(
        `select m.project_id from member_last_project m
         where m.tenant_id = $1 and m.user_id = $2
           and ($3::boolean or exists (
             select 1 from project_members pm
             where pm.tenant_id = m.tenant_id
               and pm.project_id = m.project_id
               and pm.user_id = m.user_id))`,
        [input.organizationId, input.actorUserId, admin],
      );
      let stored = readable.rows[0]?.project_id;
      if (stored === undefined) {
        // The stored Project is no longer readable by the caller: the requested one, which the
        // locks held here keep readable, replaces it whatever its time.
        const replaced = await client.query<{ project_id: string }>(
          `insert into member_last_project
             (tenant_id, user_id, project_id, selected_at)
           values ($1, $2, $3, least($4::timestamptz, now()))
           on conflict (tenant_id, user_id)
           do update set project_id = excluded.project_id,
                         selected_at = excluded.selected_at,
                         updated_at = now()
           returning project_id`,
          [
            input.organizationId,
            input.actorUserId,
            projectId,
            input.selectedAt,
          ],
        );
        stored = replaced.rows[0]?.project_id;
      }
      if (stored === undefined) throw new Error("last Project row missing");
      return { projectId: stored };
    },
  );
}

// Remembered Project while still readable, else the first readable one in the
// list's order (name, id), else null. Reads only; nothing is written back.
export async function resolveLastProject(
  database: Database,
  identity: Identity,
): Promise<LastProjectResponse> {
  await assertMemberBeforeTenantContext(
    database,
    identity.organizationId,
    identity.actorUserId,
  );
  return withTenantUserContextRaw(
    database,
    identity.organizationId,
    identity.actorUserId,
    async (client) => {
      const role = await lockedMemberRole(client, identity);
      if (role === null) membershipDenied();
      const result = await client.query<{ id: string }>(
        `select p.id
         from projects p
         left join project_members me
           on me.tenant_id = p.tenant_id and me.project_id = p.id and me.user_id = $2
         left join member_last_project last
           on last.tenant_id = p.tenant_id and last.project_id = p.id and last.user_id = $2
         where p.tenant_id = $1${isOrganizationAdmin(role) ? "" : " and me.user_id is not null"}
         order by (last.project_id is not null) desc, p.name, p.id
         limit 1`,
        [identity.organizationId, identity.actorUserId],
      );
      return { projectId: result.rows[0]?.id ?? null };
    },
  );
}
