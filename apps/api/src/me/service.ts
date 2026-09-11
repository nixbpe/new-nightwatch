import {
  organizationRoleSchema,
  type MeContextOrganization,
  type MeContextResponse,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError, type Logger } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import type { Auth, AuthSession } from "../auth";

/**
 * Organization access boundary for the authenticated `/me` context.
 * Raw, parameterized pool queries are intentional: the global auth tables
 * are pre-tenant (no RLS by explicit architecture decision), so isolation
 * comes entirely from these verified-membership lookups filtered by the
 * session's user id — never from browser selection, session
 * `activeOrganizationId`, or request bodies.
 */

type MembershipRow = {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
};

type LastActiveRow = { lastActiveTenantId: string | null };

const MEMBERSHIPS_SELECT = `
  select o.id   as "organizationId",
         o.name,
         o.slug,
         m.role
  from member m
  join organization o on o.id = m.organization_id
  where m.user_id = $1
  order by m.created_at asc, o.id asc
`;

/**
 * The only session entry point for this slice. A missing session is 401;
 * an unverified email is 403. A pending TOTP challenge never yields a
 * full session from `auth.getSession`, so it cannot bypass this boundary.
 */
export async function requireVerifiedSession(
  auth: Auth,
  headers: Headers,
): Promise<AuthSession> {
  const session = await auth.getSession(headers);
  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบก่อน");
  }
  if (!session.user.emailVerified) {
    throw new AppError(
      403,
      "EMAIL_NOT_VERIFIED",
      "กรุณายืนยันอีเมลของคุณก่อนใช้งาน",
    );
  }
  return session;
}

function listMemberships(
  database: Database,
  userId: string,
): Promise<MembershipRow[]> {
  return database.sql
    .query<MembershipRow>(MEMBERSHIPS_SELECT, [userId])
    .then((result) => result.rows);
}

function readLastActiveTenantId(
  database: Database,
  userId: string,
): Promise<string | null> {
  return database.sql
    .query<LastActiveRow>(
      `select last_active_tenant_id as "lastActiveTenantId"
       from "user" where id = $1`,
      [userId],
    )
    .then((result) => result.rows[0]?.lastActiveTenantId ?? null);
}

function toContext(
  session: AuthSession,
  memberships: MembershipRow[],
  lastActiveTenantId: string | null,
): MeContextResponse {
  const organizations: MeContextOrganization[] = [];
  for (const row of memberships) {
    const role = organizationRoleSchema.safeParse(row.role);
    if (role.success) {
      organizations.push({
        id: row.organizationId,
        name: row.name,
        slug: row.slug,
        role: role.data,
      });
    }
  }
  // The stored selection is only ever exposed while it still resolves to
  // a live membership: a revoked membership can never retain the active
  // selection in a response.
  const active =
    lastActiveTenantId !== null &&
    organizations.some((org) => org.id === lastActiveTenantId)
      ? lastActiveTenantId
      : null;
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      twoFactorEnabled: session.user.twoFactorEnabled ?? false,
    },
    organizations,
    lastActiveTenantId: active,
  };
}

/**
 * Verified-session context for tenant selection: the user's memberships
 * (ordered by membership `created_at` for determinism) and their active
 * selection filtered through live membership.
 */
export async function getMeContext(
  database: Database,
  session: AuthSession,
): Promise<MeContextResponse> {
  const [memberships, lastActiveTenantId] = await Promise.all([
    listMemberships(database, session.user.id),
    readLastActiveTenantId(database, session.user.id),
  ]);
  return toContext(session, memberships, lastActiveTenantId);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // The connection is already broken; release will discard it.
  }
}

/**
 * Switch the active organization. Membership is re-verified inside the
 * transaction with `FOR UPDATE` on the membership row: an in-flight
 * revocation blocks the switch and is re-checked, and a revocation that
 * lands after the commit is invisible to responses because reads filter
 * the stored selection through live membership. The session's
 * `activeOrganizationId` is mirrored in the same transaction for Better
 * Auth org-scoped APIs but is never trusted for membership itself.
 * Denials are audit-logged without tenant data or secrets.
 */
export async function setActiveOrganization(
  database: Database,
  logger: Logger,
  session: AuthSession,
  organizationId: string,
): Promise<MeContextResponse> {
  const client = await database.sql.connect();
  let inTransaction = true;
  try {
    await client.query("begin");
    const membership = await client.query(
      `select m.organization_id
       from member m
       where m.organization_id = $1 and m.user_id = $2
       for update`,
      [organizationId, session.user.id],
    );
    if (membership.rows.length === 0) {
      await rollbackQuietly(client);
      inTransaction = false;
      logger.warn(
        { code: "MEMBERSHIP_DENIED", reason: "NOT_MEMBER" },
        "active organization change denied: not a member",
      );
      throw new AppError(
        403,
        "MEMBERSHIP_DENIED",
        "คุณไม่ใช่สมาชิกขององค์กรนี้",
      );
    }
    await client.query(
      `update "user"
       set last_active_tenant_id = $1, updated_at = now()
       where id = $2`,
      [organizationId, session.user.id],
    );
    await client.query(
      `update session
       set active_organization_id = $1
       where token = $2`,
      [organizationId, session.session.token],
    );
    await client.query("commit");
    inTransaction = false;
    logger.info(
      { userId: session.user.id, organizationId },
      "active organization changed",
    );
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }
    throw error;
  } finally {
    client.release();
  }
  return getMeContext(database, session);
}
