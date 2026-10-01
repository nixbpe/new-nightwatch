import type {
  OrganizationRole,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { normalizeOrganizationRole } from "../me/service";
import { assertMemberBeforeTenantContext } from "./service";

const RESEND_COOLDOWN_SECONDS = 300;

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
           and lower(email) = $2 and status = 'pending' and expires_at > clock_timestamp()
       ) as "emailExists",
       (select count(*)::int from invitation where organization_id = $1
         and status = 'pending' and expires_at > clock_timestamp()) as count`,
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
      // Runs only after every check above passed, so a rejected create
      // leaves expired rows pending.
      await client.query(
        `update invitation set status = 'canceled', updated_at = clock_timestamp()
       where organization_id = $1 and lower(email) = $2 and status = 'pending'
         and (expires_at is null or expires_at <= clock_timestamp())`,
        [input.organizationId, input.email],
      );
      const id = crypto.randomUUID();
      await client.query(
        `with creation_time as materialized (select clock_timestamp() as created_at)
       insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
       select $1, $2, $3, $4, 'pending', $5, created_at + interval '48 hours', created_at, created_at
       from creation_time`,
        [id, input.organizationId, input.email, input.role, input.actorUserId],
      );
      return { id, email: input.email, organizationName: name };
    },
  );
}

type TenantClient = Parameters<Parameters<typeof withTenantContextRaw>[2]>[0];

// Lock prefix shared by cancel and resend: organization row, membership
// advisory lock, then the actor's member row. Viewer and auditor are rejected
// before any invitation lookup so they cannot probe which publicId exists.
async function lockOrganizationAsInvitationManager(
  client: TenantClient,
  input: {
    organizationId: string;
    actorUserId: string;
    deniedMessage: string;
  },
): Promise<{ organizationName: string; actorRole: "owner" | "admin" }> {
  const organization = await client.query<{ name: string }>(
    "select name from organization where id = $1 for update",
    [input.organizationId],
  );
  const organizationName = organization.rows[0]?.name;
  if (organizationName === undefined) {
    throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
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
    throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
  }
  const actorRole = normalizeOrganizationRole(storedRole);
  if (actorRole === null) throw new Error("member has no recognized role");
  if (actorRole !== "owner" && actorRole !== "admin") {
    throw new AppError(403, "PERMISSION_DENIED", input.deniedMessage);
  }
  return { organizationName, actorRole };
}

export async function cancelPendingInvitation(
  database: Database,
  input: { organizationId: string; actorUserId: string; publicId: string },
): Promise<void> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  await withTenantContextRaw(database, input.organizationId, async (client) => {
    const { actorRole } = await lockOrganizationAsInvitationManager(client, {
      ...input,
      deniedMessage: "คุณไม่มีสิทธิ์ยกเลิกคำเชิญ",
    });
    const invitation = await client.query<{ role: string }>(
      `select role from invitation
       where public_id = $1 and organization_id = $2 and status = 'pending'
       for update`,
      [input.publicId, input.organizationId],
    );
    const storedInvitationRole = invitation.rows[0]?.role;
    if (storedInvitationRole === undefined) {
      throw new AppError(
        404,
        "INVITATION_NOT_FOUND",
        "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
      );
    }
    const invitationRole = normalizeOrganizationRole(storedInvitationRole);
    if (invitationRole === null) {
      throw new Error("invitation has no recognized role");
    }
    if (actorRole === "admin" && invitationRole === "owner") {
      throw new AppError(
        403,
        "PERMISSION_DENIED",
        "เฉพาะเจ้าของจัดการคำเชิญของเจ้าของได้",
      );
    }
    await client.query(
      `update invitation set status = 'canceled', updated_at = clock_timestamp()
       where public_id = $1 and organization_id = $2`,
      [input.publicId, input.organizationId],
    );
  });
}

export type RotatedInvitation = {
  sentAt: string;
  expiresAt: string;
  resendAvailableAt: string;
};

// Replaces the bearer id of a pending row and restarts its 48 hour lifetime and
// cooldown from one clock reading, so the old link dies with the commit.
export async function rotateInvitationId(
  client: TenantClient,
  input: { publicId: string; organizationId: string; newId: string },
): Promise<RotatedInvitation> {
  const result = await client.query<RotatedInvitation>(
    `with rotation_time as materialized (select clock_timestamp() as t)
     update invitation set id = $3, sent_at = t, expires_at = t + interval '48 hours',
       updated_at = t
     from rotation_time
     where public_id = $1 and organization_id = $2
     returning invitation.sent_at as "sentAt", invitation.expires_at as "expiresAt",
       invitation.sent_at + make_interval(secs => $4::int) as "resendAvailableAt"`,
    [
      input.publicId,
      input.organizationId,
      input.newId,
      RESEND_COOLDOWN_SECONDS,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("invitation rotation updated no row");
  return row;
}

export async function resendPendingInvitation(
  database: Database,
  input: { organizationId: string; actorUserId: string; publicId: string },
): Promise<{
  id: string;
  email: string;
  role: OrganizationRole;
  organizationName: string;
  sentAt: string;
  expiresAt: string;
  resendAvailableAt: string;
}> {
  await assertMemberBeforeTenantContext(
    database,
    input.organizationId,
    input.actorUserId,
  );
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const { organizationName, actorRole } =
        await lockOrganizationAsInvitationManager(client, {
          ...input,
          deniedMessage: "คุณไม่มีสิทธิ์ส่งคำเชิญซ้ำ",
        });
      const invitation = await client.query<{
        email: string;
        role: string;
        expired: boolean;
        cooling: boolean;
        resendAvailableAt: string;
      }>(
        `select email, role,
           (expires_at is null or expires_at <= clock_timestamp()) as expired,
           clock_timestamp() < sent_at + make_interval(secs => $3::int) as cooling,
           sent_at + make_interval(secs => $3::int) as "resendAvailableAt"
         from invitation
         where public_id = $1 and organization_id = $2 and status = 'pending'
         for update`,
        [input.publicId, input.organizationId, RESEND_COOLDOWN_SECONDS],
      );
      const row = invitation.rows[0];
      if (row === undefined) {
        throw new AppError(
          404,
          "INVITATION_NOT_FOUND",
          "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
        );
      }
      const role = normalizeOrganizationRole(row.role);
      if (role === null) throw new Error("invitation has no recognized role");
      if (actorRole === "admin" && role === "owner") {
        throw new AppError(
          403,
          "PERMISSION_DENIED",
          "เฉพาะเจ้าของจัดการคำเชิญของเจ้าของได้",
        );
      }
      if (row.cooling) {
        throw new AppError(
          429,
          "INVITATION_RESEND_COOLDOWN",
          "ส่งคำเชิญซ้ำได้อีกครั้งภายหลัง",
          { resendAvailableAt: new Date(row.resendAvailableAt).toISOString() },
        );
      }
      const member = await client.query(
        `select 1 from member m join "user" u on u.id = m.user_id
         where m.organization_id = $1 and lower(u.email) = lower($2) limit 1`,
        [input.organizationId, row.email],
      );
      if (member.rows.length > 0) {
        throw new AppError(
          409,
          "USER_ALREADY_MEMBER",
          "ผู้รับเป็นสมาชิกองค์กรแล้ว",
        );
      }
      // A live row is already counted in activeCount, so only an expired row
      // adds to it and competes for the same email.
      if (row.expired) {
        const live = await client.query<{
          duplicate: boolean;
          count: number;
        }>(
          `select exists (
             select 1 from invitation where organization_id = $1
               and lower(email) = lower($2) and status = 'pending'
               and expires_at > clock_timestamp() and public_id <> $3
           ) as duplicate,
           (select count(*)::int from invitation where organization_id = $1
             and status = 'pending' and expires_at > clock_timestamp()) as count`,
          [input.organizationId, row.email, input.publicId],
        );
        if (live.rows[0]?.duplicate) {
          throw new AppError(
            409,
            "INVITATION_ALREADY_PENDING",
            "มีคำเชิญที่ยังใช้งานได้แล้ว",
          );
        }
        if ((live.rows[0]?.count ?? 0) >= 100) {
          throw new AppError(
            409,
            "INVITATION_LIMIT_REACHED",
            "คำเชิญที่ยังใช้งานได้ครบ 100 รายการแล้ว",
          );
        }
      }
      const id = crypto.randomUUID();
      const rotated = await rotateInvitationId(client, {
        publicId: input.publicId,
        organizationId: input.organizationId,
        newId: id,
      });
      return {
        id,
        email: row.email,
        role,
        organizationName,
        sentAt: new Date(rotated.sentAt).toISOString(),
        expiresAt: new Date(rotated.expiresAt).toISOString(),
        resendAvailableAt: new Date(rotated.resendAvailableAt).toISOString(),
      };
    },
  );
}

type PendingInvitationListRow = {
  member: boolean;
  actorRole: string | null;
  authorized: boolean;
  total: number;
  activeCount: number;
  invitations: {
    publicId: string;
    email: string;
    role: string;
    sentAt: string;
    expiresAt: string | null;
    expired: boolean;
    resendAvailableAt: string;
  }[];
};

export async function listPendingInvitations(
  database: Database,
  input: {
    organizationId: string;
    actorUserId: string;
    limit: number;
    offset: number;
  },
): Promise<PendingInvitationListResponse> {
  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      const result = await client.query<PendingInvitationListRow>(
        `with actor as (
           select role from member
           where organization_id = $1 and user_id = $2
         ),
         authorization_state as (
           select exists(select 1 from actor) as member,
                  (select role from actor) as "actorRole",
                  exists(
                    select 1 from actor
                    where role ~ '(^|,)[[:space:]]*(owner|admin)[[:space:]]*(,|$)'
                  ) as authorized
         ),
         scoped as (
           select i.public_id, i.email, i.role, i.sent_at, i.expires_at,
                  (i.expires_at is null or i.expires_at <= clock_timestamp()) as expired
           from invitation i
           cross join authorization_state
           where i.organization_id = $1 and i.status = 'pending'
             and authorization_state.authorized
         ),
         page as (
           select * from scoped
           order by sent_at desc, public_id
           limit $3 offset $4
         )
         select authorization_state.member,
                authorization_state."actorRole",
                authorization_state.authorized,
                (select count(*)::int from scoped) as total,
                (select count(*)::int from scoped where not expired) as "activeCount",
                coalesce(
                  (
                    select json_agg(
                      json_build_object(
                        'publicId', public_id, 'email', email, 'role', role,
                        'sentAt', sent_at, 'expiresAt', expires_at,
                        'expired', expired,
                        'resendAvailableAt',
                          sent_at + make_interval(secs => $5::int)
                      )
                      order by sent_at desc, public_id
                    )
                    from page
                  ),
                  '[]'::json
                ) as invitations
         from authorization_state`,
        [
          input.organizationId,
          input.actorUserId,
          input.limit,
          input.offset,
          RESEND_COOLDOWN_SECONDS,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("invitation list query returned no row");
      if (!row.member || row.actorRole === null) {
        throw new AppError(
          403,
          "MEMBERSHIP_DENIED",
          "คุณไม่ใช่สมาชิกขององค์กรนี้",
        );
      }
      const actorRole = normalizeOrganizationRole(row.actorRole);
      if (actorRole === null) throw new Error("member has no recognized role");
      if (!row.authorized) {
        throw new AppError(
          403,
          "PERMISSION_DENIED",
          "คุณไม่มีสิทธิ์ดูคำเชิญที่รอตอบรับ",
        );
      }
      const iso = (value: string) => new Date(value).toISOString();
      const invitations = row.invitations.map((invitation) => {
        const role = normalizeOrganizationRole(invitation.role);
        if (role === null) throw new Error("invitation has no recognized role");
        return {
          publicId: invitation.publicId,
          email: invitation.email,
          role,
          sentAt: iso(invitation.sentAt),
          expiresAt:
            invitation.expiresAt === null ? null : iso(invitation.expiresAt),
          expired: invitation.expired,
          resendAvailableAt: iso(invitation.resendAvailableAt),
          manageable: actorRole === "owner" || role !== "owner",
        };
      });
      return {
        organizationId: input.organizationId,
        invitations,
        activeCount: row.activeCount,
        activeLimit: 100 as const,
        page: { limit: input.limit, offset: input.offset, total: row.total },
      };
    },
  );
}
