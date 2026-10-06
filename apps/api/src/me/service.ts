import {
  organizationRoleSchema,
  type MeContextOrganization,
  type MeContextResponse,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError, type Logger } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import type { Auth, AuthSession } from "../auth";

// Auth tables have no RLS: isolation comes only from membership lookups by the
// session user id, never browser selection, activeOrganizationId or bodies.

type MembershipRow = {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
};

type LastActiveRow = { lastActiveTenantId: string | null };

const ROLE_PRIORITY: Record<MeContextOrganization["role"], number> = {
  owner: 0,
  admin: 1,
  viewer: 2,
  auditor: 3,
};

// Projects composite stored roles for the UI; never rewrites the stored role.
export function normalizeOrganizationRole(
  rawRole: string,
): MeContextOrganization["role"] | null {
  const exactRole = organizationRoleSchema.safeParse(rawRole);
  if (exactRole.success) return exactRole.data;

  let normalizedRole: MeContextOrganization["role"] | null = null;
  for (const token of rawRole.split(",")) {
    const role = organizationRoleSchema.safeParse(token.trim());
    if (
      role.success &&
      (normalizedRole === null ||
        ROLE_PRIORITY[role.data] < ROLE_PRIORITY[normalizedRole])
    ) {
      normalizedRole = role.data;
    }
  }
  return normalizedRole;
}

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

// A pending TOTP challenge never yields a full session, so it cannot pass here.
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
    const role = normalizeOrganizationRole(row.role);
    if (role !== null) {
      organizations.push({
        id: row.organizationId,
        name: row.name,
        slug: row.slug,
        role,
      });
    }
  }
  // A revoked membership must never keep the active selection in a response.
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

function selectOrganization(
  memberships: MembershipRow[],
  lastActive: string | null,
): string | null {
  const valid = memberships.filter(
    (row) => normalizeOrganizationRole(row.role) !== null,
  );
  return (
    valid.find((row) => row.organizationId === lastActive)?.organizationId ??
    valid[0]?.organizationId ??
    null
  );
}

// Discovery is user-bound. Never acquire a second org lock after the user lock.
// Repeatable-read serialization failures and changed candidates restart the entire lock graph.
export async function resolveActiveOrganization(
  database: Database,
  session: AuthSession,
): Promise<MeContextResponse> {
  const client = await database.sql.connect();
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const discovered = await client.query<MembershipRow>(MEMBERSHIPS_SELECT, [
        session.user.id,
      ]);
      const remembered = await client.query<LastActiveRow>(
        `select last_active_tenant_id as "lastActiveTenantId" from "user" where id = $1`,
        [session.user.id],
      );
      const candidate = selectOrganization(
        discovered.rows,
        remembered.rows[0]?.lastActiveTenantId ?? null,
      );
      await client.query("begin isolation level repeatable read");
      try {
        if (candidate !== null) {
          const org = await client.query(
            "select id from organization where id = $1 for update",
            [candidate],
          );
          if (org.rows.length === 0) {
            await client.query("rollback");
            continue;
          }
          await client.query(
            "select pg_advisory_xact_lock(hashtext($1)::bigint)",
            [`notification-membership:${candidate}`],
          );
          await client.query(
            "select role from member where organization_id = $1 and user_id = $2 for update",
            [candidate, session.user.id],
          );
        }
        const account = await client.query<LastActiveRow>(
          `select last_active_tenant_id as "lastActiveTenantId" from "user" where id = $1 for update`,
          [session.user.id],
        );
        const memberships = await client.query<MembershipRow>(
          MEMBERSHIPS_SELECT,
          [session.user.id],
        );
        const selected = selectOrganization(
          memberships.rows,
          account.rows[0]?.lastActiveTenantId ?? null,
        );
        if (selected !== candidate) {
          await client.query("rollback");
          continue;
        }
        await client.query(
          `update "user" set last_active_tenant_id = $1, updated_at = now() where id = $2 and last_active_tenant_id is distinct from $1::uuid`,
          [selected, session.user.id],
        );
        await client.query(
          `update session set active_organization_id = $1 where user_id = $2 and active_organization_id is distinct from $1::text`,
          [selected, session.user.id],
        );
        const context = toContext(session, memberships.rows, selected);
        await client.query("commit");
        return context;
      } catch (error) {
        await rollbackQuietly(client);
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "40001" || error.code === "40P01")
        )
          continue;
        throw error;
      }
    }
    throw new AppError(
      503,
      "ACTIVE_ORGANIZATION_RESOLUTION_FAILED",
      "ไม่สามารถโหลดข้อมูลองค์กรได้ กรุณาลองใหม่",
    );
  } finally {
    client.release();
  }
}

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

function denyNotMember(logger: Logger): never {
  logger.warn(
    { code: "MEMBERSHIP_DENIED", reason: "NOT_MEMBER" },
    "active organization change denied: not a member",
  );
  throw new AppError(403, "MEMBERSHIP_DENIED", "คุณไม่ใช่สมาชิกขององค์กรนี้");
}

// FOR UPDATE makes an in-flight revocation block the switch. The session
// mirror serves Better Auth org APIs and is never trusted for membership.
export async function setActiveOrganization(
  database: Database,
  logger: Logger,
  session: AuthSession,
  organizationId: string,
): Promise<MeContextResponse> {
  const client = await database.sql.connect();
  let inTransaction = false;
  try {
    // Before any lock so a nonmember never contends on another org's rows.
    const preMembership = await client.query(
      "select 1 from member where organization_id = $1 and user_id = $2",
      [organizationId, session.user.id],
    );
    if (preMembership.rows.length === 0) denyNotMember(logger);
    await client.query("begin");
    inTransaction = true;
    const organization = await client.query(
      "select id from organization where id = $1 for update",
      [organizationId],
    );
    if (organization.rows.length === 0) {
      await rollbackQuietly(client);
      inTransaction = false;
      denyNotMember(logger);
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `notification-membership:${organizationId}`,
    ]);
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
      denyNotMember(logger);
    }
    await client.query(
      `update "user"
       set last_active_tenant_id = $1, updated_at = now()
       where id = $2`,
      [organizationId, session.user.id],
    );
    // Selection is account-global, so every session mirror moves with it.
    await client.query(
      `update session
       set active_organization_id = $1
       where user_id = $2`,
      [organizationId, session.user.id],
    );
    const memberships = await client.query<MembershipRow>(MEMBERSHIPS_SELECT, [
      session.user.id,
    ]);
    const context = toContext(session, memberships.rows, organizationId);
    await client.query("commit");
    inTransaction = false;
    logger.info(
      { event: "active_organization_changed" },
      "active organization changed",
    );
    return context;
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }
    throw error;
  } finally {
    client.release();
  }
}
