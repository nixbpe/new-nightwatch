import {
  PROJECT_MEMBER_CANDIDATE_LIMIT,
  type AddProjectMembersRequest,
  type AddProjectMembersResponse,
  type OrganizationRole,
  type ProjectMember,
  type ProjectMemberCandidatesResponse,
  type ProjectMemberListResponse,
  type ProjectRole,
  type UpdateProjectMemberRequest,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import {
  recordAuditEvent,
  roleChange,
  type AuditChange,
} from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { withProjectAccess, type Identity } from "./service";

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
      }>(
        `select m.user_id as "userId", u.name, u.email,
                m.role as "organizationRole"
         from member m
         join "user" u on u.id = m.user_id
         where m.organization_id = $1
           and not exists (
             select 1 from project_members pm
             where pm.tenant_id = m.organization_id and pm.project_id = $2
               and pm.user_id = m.user_id
           )
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
): Promise<AddProjectMembersResponse> {
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
      return {
        members: await loadMembers(client, input, projectId),
        addedUserIds: inserted.map((row) => row.userId),
      };
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
