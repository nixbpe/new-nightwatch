import {
  organizationRoleSchema,
  type InvitationResponse,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { findInvitationPreview } from "../auth/invitations";

// Every unusable or cross-tenant ID gets one not-found: no enumeration.
export async function getInvitationPreview(
  database: Database,
  invitationId: string,
): Promise<InvitationResponse> {
  const record = await findInvitationPreview(database, invitationId);
  const role = record ? organizationRoleSchema.safeParse(record.role) : null;
  if (!record || !role?.success) {
    throw new AppError(
      404,
      "INVITATION_NOT_FOUND",
      "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
    );
  }
  return {
    invitation: {
      id: record.id,
      email: record.email,
      organizationName: record.organizationName,
      role: role.data,
      expiresAt: record.expiresAt.toISOString(),
    },
  };
}

function invitationNotFound(): never {
  throw new AppError(
    404,
    "INVITATION_NOT_FOUND",
    "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
  );
}

export async function acceptInvitation(
  database: Database,
  input: { invitationId: string; userId: string; email: string },
): Promise<string> {
  // The bearer lookup only resolves the organization; it grants no membership.
  const resolution = await database.sql.query<{ organizationId: string }>(
    'select organization_id as "organizationId" from invitation where id = $1',
    [input.invitationId],
  );
  const organizationId = resolution.rows[0]?.organizationId;
  if (!organizationId) return invitationNotFound();

  return withTenantContextRaw(database, organizationId, async (client) => {
    const organization = await client.query(
      "select id from organization where id = $1 for update",
      [organizationId],
    );
    if (organization.rows.length === 0) return invitationNotFound();
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `notification-membership:${organizationId}`,
    ]);
    const locked = await client.query(
      "select id from invitation where id = $1 and organization_id = $2 for update",
      [input.invitationId, organizationId],
    );
    if (locked.rows.length === 0) return invitationNotFound();
    const invitation = await client.query<{ role: string }>(
      `select role from invitation
       where id = $1 and organization_id = $2 and status = 'pending'
         and expires_at > clock_timestamp() and lower(email) = lower($3)`,
      [input.invitationId, organizationId, input.email],
    );
    const role = invitation.rows[0]?.role;
    if (!role) return invitationNotFound();

    const member = await client.query(
      "select id from member where organization_id = $1 and user_id = $2 for update",
      [organizationId, input.userId],
    );
    if (member.rows.length > 0) {
      throw new AppError(409, "USER_ALREADY_MEMBER", "คุณเป็นสมาชิกองค์กรแล้ว");
    }
    const count = await client.query<{ total: number }>(
      'select count(*)::int as total from member where organization_id = $1',
      [organizationId],
    );
    if ((count.rows[0]?.total ?? 0) >= 1000) {
      throw new AppError(
        409,
        "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
        "องค์กรมีสมาชิกครบ 1,000 คนแล้ว",
      );
    }
    await client.query(
      `insert into member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, $4, now())`,
      [crypto.randomUUID(), organizationId, input.userId, role],
    );
    await client.query(
      "update invitation set status = 'accepted' where id = $1 and organization_id = $2 and status = 'pending'",
      [input.invitationId, organizationId],
    );
    return organizationId;
  });
}
