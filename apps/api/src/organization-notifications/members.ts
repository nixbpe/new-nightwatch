import type { OrganizationMemberListResponse } from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import type { PoolClient } from "pg";
import { AppError } from "@nightwatch/shared";

import { recordAuditEvent, roleChange } from "../audit/record";
import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "./service";

type OrganizationRole = "owner" | "admin" | "viewer" | "auditor";

// `role` may be a comma-separated composite.
type MemberRow = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
};
export type MemberResponse = Omit<MemberRow, "role"> & {
  role: OrganizationRole;
};
const ORGANIZATION_ROLES: Record<string, true> = {
  owner: true,
  admin: true,
  viewer: true,
  auditor: true,
};

const OWNER_ONLY_MESSAGE = "เฉพาะเจ้าขององค์กรเท่านั้นที่เปลี่ยนเจ้าของได้";

function deny(message: string): never {
  throw new AppError(403, "PERMISSION_DENIED", message);
}

// Same denial for a missing org, so a nonmember cannot probe which exist.
function notMember(): never {
  throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
}

function memberNotFound(): never {
  throw new AppError(404, "MEMBER_NOT_FOUND", "ไม่พบสมาชิกองค์กร");
}

// Called in the transaction so an unknown stored role rolls it back.
function actorRoleOf(actor: MemberRow): OrganizationRole {
  const role = normalizeOrganizationRole(actor.role);
  if (role === null) throw new Error("member has no recognized role");
  return role;
}

function isOwner(member: MemberRow): boolean {
  return member.role
    .split(",")
    .map((role) => role.trim())
    .includes("owner");
}

function isOwnerOrAdmin(member: MemberRow): boolean {
  return (
    isOwner(member) ||
    member.role
      .split(",")
      .map((role) => role.trim())
      .includes("admin")
  );
}

// Called in the transaction so an unknown stored role rolls it back.
function toMemberResponse(member: MemberRow): MemberResponse {
  const role = normalizeOrganizationRole(member.role);
  if (role === null) {
    throw new Error("member has no recognized role");
  }
  return { ...member, role };
}

type MemberListRow = {
  member: boolean;
  actorRoleValid: boolean;
  authorized: boolean;
  total: number;
  members: {
    id: string;
    userId: string;
    name: string;
    email: string;
    role: string;
  }[];
};

export async function listOrganizationMembers(
  database: Database,
  input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    offset: number;
  },
): Promise<OrganizationMemberListResponse> {
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const result = await client.query<MemberListRow>(
        `with authorization_state as (
           select exists(
                    select 1
                    from member actor
                    where actor.organization_id = $1
                      and actor.user_id = $2
                  ) as member,
                  exists(
                    select 1
                    from member actor
                    where actor.organization_id = $1
                      and actor.user_id = $2
                      and actor.role ~ '(^|,)[[:space:]]*(owner|admin|viewer|auditor)[[:space:]]*(,|$)'
                  ) as "actorRoleValid",
                  exists(
                    select 1
                    from member actor
                    where actor.organization_id = $1
                      and actor.user_id = $2
                      and actor.role ~ '(^|,)[[:space:]]*(owner|admin)[[:space:]]*(,|$)'
                  ) as authorized
         ),
         scoped as (
           select m.id, m.user_id as "userId", u.name, u.email, m.role
           from member m
           join "user" u on u.id = m.user_id
           cross join authorization_state
           where m.organization_id = $1 and authorization_state.authorized
         ),
         page as (
           select * from scoped
           order by lower(name), id
           limit $3 offset $4
         )
         select authorization_state.member,
                authorization_state."actorRoleValid",
                authorization_state.authorized,
                (select count(*)::int from scoped) as total,
                coalesce(
                  (
                    select json_agg(
                      json_build_object(
                        'id', id, 'userId', "userId", 'name', name,
                        'email', email, 'role', role
                      )
                      order by lower(name), id
                    )
                    from page
                  ),
                  '[]'::json
                ) as members
         from authorization_state`,
        [input.organizationId, input.actorUserId, input.limit, input.offset],
      );
      const row = result.rows[0];
      if (!row) throw new Error("member list query returned no row");
      if (row.member && !row.actorRoleValid) {
        throw new Error("member has no recognized role");
      }
      if (!row.member) notMember();
      if (!row.authorized) deny("คุณไม่มีสิทธิ์ดูรายชื่อสมาชิก");
      const members = row.members.map((member) => {
        const role = normalizeOrganizationRole(member.role);
        if (role === null) {
          throw new Error("member has no recognized role");
        }
        return { ...member, role };
      });
      return {
        organizationId: input.organizationId,
        members,
        page: { limit: input.limit, offset: input.offset, total: row.total },
      };
    },
  );
}

async function lockedMember(
  client: PoolClient,
  organizationId: string,
  userId: string,
): Promise<MemberRow> {
  const result = await client.query<MemberRow>(
    `select id, user_id as "userId", organization_id as "organizationId", role
     from member where organization_id = $1 and user_id = $2 for update`,
    [organizationId, userId],
  );
  const member = result.rows[0];
  if (!member) notMember();
  return member;
}

async function lockedTarget(
  client: PoolClient,
  organizationId: string,
  memberId: string,
  hideMissingFromAdmin = false,
): Promise<MemberRow> {
  const result = await client.query<MemberRow>(
    `select id, user_id as "userId", organization_id as "organizationId", role
     from member where organization_id = $1 and id = $2 for update`,
    [organizationId, memberId],
  );
  const member = result.rows[0];
  if (!member) {
    // An admin is denied for an owner target, so a missing id must look the same.
    if (hideMissingFromAdmin) deny(OWNER_ONLY_MESSAGE);
    memberNotFound();
  }
  return member;
}

async function withLockedOrganization<T>(
  database: Database,
  organizationId: string,
  actorUserId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await assertMemberBeforeTenantContext(database, organizationId, actorUserId);
  return withTenantContextRaw(database, organizationId, async (client) => {
    const organization = await client.query<{ id: string }>(
      "select id from organization where id = $1 for update",
      [organizationId],
    );
    if (!organization.rows[0]) notMember();
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `notification-membership:${organizationId}`,
    ]);
    return fn(client);
  });
}

async function assertOwnerMayChangeOwner(
  client: PoolClient,
  organizationId: string,
  actor: MemberRow,
  target: MemberRow,
  targetWillRemainOwner: boolean,
): Promise<void> {
  if (!isOwner(target) || targetWillRemainOwner) return;
  if (!isOwner(actor)) deny(OWNER_ONLY_MESSAGE);
  const owners = await client.query<{ count: number }>(
    `select count(*)::int as count from member
     where organization_id = $1
       and exists (
         select 1
         from unnest(string_to_array(role, ',')) as role_token
         where btrim(role_token) = 'owner'
       )`,
    [organizationId],
  );
  if ((owners.rows[0]?.count ?? 0) <= 1) {
    throw new AppError(
      400,
      "LAST_OWNER",
      "องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน",
    );
  }
}

export async function updateOrganizationMemberRole(
  database: Database,
  input: {
    organizationId: string;
    actorUserId: string;
    memberId: string;
    role: OrganizationRole;
    requestId?: string;
  },
): Promise<MemberResponse> {
  if (!ORGANIZATION_ROLES[input.role]) {
    throw new AppError(400, "INVALID_ROLE", "บทบาทองค์กรไม่ถูกต้อง");
  }
  return withLockedOrganization(
    database,
    input.organizationId,
    input.actorUserId,
    async (client) => {
      const actor = await lockedMember(
        client,
        input.organizationId,
        input.actorUserId,
      );
      // Before the target lookup so an unauthorized caller can't probe members.
      if (!isOwnerOrAdmin(actor)) deny("คุณไม่มีสิทธิ์เปลี่ยนบทบาทสมาชิก");
      if (!isOwner(actor) && input.role === "owner") deny(OWNER_ONLY_MESSAGE);
      const target = await lockedTarget(
        client,
        input.organizationId,
        input.memberId,
        !isOwner(actor),
      );
      if (!isOwner(actor) && isOwner(target)) deny(OWNER_ONLY_MESSAGE);
      await assertOwnerMayChangeOwner(
        client,
        input.organizationId,
        actor,
        target,
        input.role === "owner",
      );
      const previousRole = actorRoleOf(target);
      // Same role after normalizing: nothing changes, so no write and no event.
      if (previousRole === input.role) return toMemberResponse(target);
      const updated = await client.query<MemberRow>(
        `update member set role = $3, updated_at = now()
       where organization_id = $1 and id = $2
       returning id, user_id as "userId", organization_id as "organizationId", role`,
        [input.organizationId, input.memberId, input.role],
      );
      const member = updated.rows[0];
      if (!member) memberNotFound();
      await recordAuditEvent(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: actorRoleOf(actor),
        action: "organization.member.role.update",
        target: { type: "member", id: target.userId },
        changes: [roleChange(previousRole, input.role)],
        requestId: input.requestId,
      });
      return toMemberResponse(member);
    },
  );
}

export async function revokeOrganizationMember(
  database: Database,
  input: {
    organizationId: string;
    actorUserId: string;
    memberId: string;
    requestId?: string;
  },
): Promise<MemberResponse> {
  return withLockedOrganization(
    database,
    input.organizationId,
    input.actorUserId,
    async (client) => {
      const actor = await lockedMember(
        client,
        input.organizationId,
        input.actorUserId,
      );
      // Before the target lookup so an unauthorized caller can't probe members.
      if (!isOwnerOrAdmin(actor)) deny("คุณไม่มีสิทธิ์ลบสมาชิก");
      const target = await lockedTarget(
        client,
        input.organizationId,
        input.memberId,
        !isOwner(actor),
      );
      await assertOwnerMayChangeOwner(
        client,
        input.organizationId,
        actor,
        target,
        false,
      );
      const removed = await client.query<MemberRow>(
        `delete from member where organization_id = $1 and id = $2
       returning id, user_id as "userId", organization_id as "organizationId", role`,
        [input.organizationId, input.memberId],
      );
      await client.query(
        `update "user" set last_active_tenant_id = null, updated_at = now()
       where id = $1 and last_active_tenant_id = $2`,
        [target.userId, input.organizationId],
      );
      await client.query(
        `update session set active_organization_id = null
       where user_id = $1 and active_organization_id = $2`,
        [target.userId, input.organizationId],
      );
      const member = removed.rows[0];
      if (!member) memberNotFound();
      const response = toMemberResponse(member);
      await recordAuditEvent(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: actorRoleOf(actor),
        action: "organization.member.revoke",
        target: { type: "member", id: target.userId },
        changes: [roleChange(response.role, null)],
        requestId: input.requestId,
      });
      return response;
    },
  );
}

// Needs no member-delete permission.
export async function leaveOrganization(
  database: Database,
  input: { organizationId: string; actorUserId: string; requestId?: string },
): Promise<MemberResponse> {
  return withLockedOrganization(
    database,
    input.organizationId,
    input.actorUserId,
    async (client) => {
      const member = await lockedMember(
        client,
        input.organizationId,
        input.actorUserId,
      );
      await assertOwnerMayChangeOwner(
        client,
        input.organizationId,
        member,
        member,
        false,
      );
      const removed = await client.query<MemberRow>(
        `delete from member where organization_id = $1 and id = $2
       returning id, user_id as "userId", organization_id as "organizationId", role`,
        [input.organizationId, member.id],
      );
      await client.query(
        `update "user" set last_active_tenant_id = null, updated_at = now()
       where id = $1 and last_active_tenant_id = $2`,
        [member.userId, input.organizationId],
      );
      await client.query(
        `update session set active_organization_id = null
       where user_id = $1 and active_organization_id = $2`,
        [member.userId, input.organizationId],
      );
      const removedMember = removed.rows[0];
      if (!removedMember) memberNotFound();
      const response = toMemberResponse(removedMember);
      await recordAuditEvent(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: response.role,
        action: "organization.member.leave",
        target: { type: "member", id: member.userId },
        changes: [roleChange(response.role, null)],
        requestId: input.requestId,
      });
      return response;
    },
  );
}
