import type { OrganizationRole } from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "./service";

export async function createOrganizationInvitation(
  database: Database,
  input: {
    organizationId: string;
    actorUserId: string;
    email: string;
    role: OrganizationRole;
  },
): Promise<{ id: string; email: string; organizationName: string }> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const organization = await client.query<{ name: string }>(
        "select name from organization where id = $1 for update",
        [input.organizationId],
      );
      const name = organization.rows[0]?.name;
      if (name === undefined) {
        throw new AppError(
          403,
          "MEMBERSHIP_DENIED",
          "คุณไม่ใช่สมาชิกขององค์กรนี้",
        );
      }
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        `notification-membership:${input.organizationId}`,
      ]);
      const actor = await client.query<{ role: string }>(
        "select role from member where organization_id = $1 and user_id = $2 for update",
        [input.organizationId, input.actorUserId],
      );
      const storedRole = actor.rows[0]?.role;
      if (storedRole === undefined) {
        throw new AppError(
          403,
          "MEMBERSHIP_DENIED",
          "คุณไม่ใช่สมาชิกขององค์กรนี้",
        );
      }
      const role = normalizeOrganizationRole(storedRole);
      if (role === null) throw new Error("member has no recognized role");
      if (
        (role !== "owner" && role !== "admin") ||
        (role === "admin" && input.role === "owner")
      )
        throw new AppError(
          403,
          "PERMISSION_DENIED",
          "คุณไม่มีสิทธิ์เชิญสมาชิก",
        );

      const member = await client.query(
        `select 1 from member m join "user" u on u.id = m.user_id
       where m.organization_id = $1 and lower(u.email) = $2 limit 1`,
        [input.organizationId, input.email],
      );
      if (member.rows.length > 0) {
        throw new AppError(
          409,
          "USER_ALREADY_MEMBER",
          "ผู้รับเป็นสมาชิกองค์กรแล้ว",
        );
      }
      const pending = await client.query<{
        emailExists: boolean;
        count: number;
      }>(
        `select exists (
         select 1 from invitation where organization_id = $1
           and lower(email) = $2 and status = 'pending' and expires_at > now()
       ) as "emailExists",
       (select count(*)::int from invitation where organization_id = $1
         and status = 'pending' and expires_at > now()) as count`,
        [input.organizationId, input.email],
      );
      if (pending.rows[0]?.emailExists) {
        throw new AppError(
          409,
          "INVITATION_ALREADY_PENDING",
          "มีคำเชิญที่ยังใช้งานได้แล้ว",
        );
      }
      if ((pending.rows[0]?.count ?? 0) >= 100) {
        throw new AppError(
          409,
          "INVITATION_LIMIT_REACHED",
          "คำเชิญที่ยังใช้งานได้ครบ 100 รายการแล้ว",
        );
      }
      const id = crypto.randomUUID();
      await client.query(
        `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
       values ($1, $2, $3, $4, 'pending', $5, now() + interval '48 hours', now())`,
        [id, input.organizationId, input.email, input.role, input.actorUserId],
      );
      return { id, email: input.email, organizationName: name };
    },
  );
}
