import { withTenantContextRaw, type Database } from "@nightwatch/db";
import type { PoolClient } from "pg";
import { AppError } from "@nightwatch/shared";

import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "./service";

type OrganizationRole = "owner" | "admin" | "viewer" | "auditor";

/** A stored member row; `role` may be a comma-separated composite. */
type MemberRow = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
};
/** A member as returned by the API, projected to one contract role. */
export type MemberResponse = Omit<MemberRow, "role"> & {
  role: OrganizationRole;
};
const ORGANIZATION_ROLES: Record<string, true> = {
  owner: true,
  admin: true,
  viewer: true,
  auditor: true,
};

function deny(message: string): never {
  throw new AppError(403, "PERMISSION_DENIED", message);
}

// One denial for a missing organization and a non-member actor, so a
// nonmember cannot probe which organizations exist.
function notMember(): never {
  throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
}

function memberNotFound(): never {
  throw new AppError(404, "MEMBER_NOT_FOUND", "ไม่พบสมาชิกองค์กร");
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

// Projected inside the transaction so an unrecognized stored role rolls the
// mutation back instead of committing it behind a failed response.
function toMemberResponse(member: MemberRow): MemberResponse {
  const role = normalizeOrganizationRole(member.role);
  if (role === null) {
    throw new Error(`member ${member.id} has no recognized role`);
  }
  return { ...member, role };
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
): Promise<MemberRow> {
  const result = await client.query<MemberRow>(
    `select id, user_id as "userId", organization_id as "organizationId", role
     from member where organization_id = $1 and id = $2 for update`,
    [organizationId, memberId],
  );
  const member = result.rows[0];
  if (!member) memberNotFound();
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
  if (!isOwner(actor)) deny("เฉพาะเจ้าขององค์กรเท่านั้นที่เปลี่ยนเจ้าของได้");
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
      // Authorize before touching the target, so an unauthorized caller can
      // neither probe which members exist nor contend on their rows.
      if (!isOwnerOrAdmin(actor)) deny("คุณไม่มีสิทธิ์เปลี่ยนบทบาทสมาชิก");
      const target = await lockedTarget(
        client,
        input.organizationId,
        input.memberId,
      );
      if (
        (!isOwner(actor) && isOwner(target)) ||
        (!isOwner(actor) && input.role === "owner")
      ) {
        deny("เฉพาะเจ้าขององค์กรเท่านั้นที่เปลี่ยนเจ้าของได้");
      }
      await assertOwnerMayChangeOwner(
        client,
        input.organizationId,
        actor,
        target,
        input.role === "owner",
      );
      const updated = await client.query<MemberRow>(
        `update member set role = $3, updated_at = now()
       where organization_id = $1 and id = $2
       returning id, user_id as "userId", organization_id as "organizationId", role`,
        [input.organizationId, input.memberId, input.role],
      );
      const member = updated.rows[0];
      if (!member) memberNotFound();
      return toMemberResponse(member);
    },
  );
}

export async function revokeOrganizationMember(
  database: Database,
  input: { organizationId: string; actorUserId: string; memberId: string },
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
      // Authorize before touching the target, so an unauthorized caller can
      // neither probe which members exist nor contend on their rows.
      if (!isOwnerOrAdmin(actor)) deny("คุณไม่มีสิทธิ์ลบสมาชิก");
      const target = await lockedTarget(
        client,
        input.organizationId,
        input.memberId,
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
      return toMemberResponse(member);
    },
  );
}

/** A current member may leave without holding member-delete permission. */
export async function leaveOrganization(
  database: Database,
  input: { organizationId: string; actorUserId: string },
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
      return toMemberResponse(removedMember);
    },
  );
}
