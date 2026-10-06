import { fileURLToPath } from "node:url";
import { createDatabase, runMigrations } from "@nightwatch/db";
import { createLogger } from "@nightwatch/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthSession } from "../auth";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { registerMeRoutes } from "./routes";
import {
  getMeContext,
  resolveActiveOrganization,
  setActiveOrganization,
} from "./service";
import type { PoolClient } from "pg";
import { leaveOrganization } from "../organization-notifications/members";

const urls = requireIntegrationDatabaseUrls();
const database = createDatabase(urls.runtimeUrl);
const owner = createDatabase(urls.ownerUrl);
const userId = crypto.randomUUID();
const firstOrg = crypto.randomUUID();
const secondOrg = crypto.randomUUID();
const orgIds: [string, string] =
  firstOrg < secondOrg ? [firstOrg, secondOrg] : [secondOrg, firstOrg];
const session: AuthSession = {
  user: {
    id: userId,
    email: `${userId}@example.test`,
    name: "Resolver fixture",
    emailVerified: true,
  },
  session: {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 86400000),
  },
};
const logger = createLogger({ level: "silent" });
const app = new OpenAPIHono();
registerMeRoutes(app, {
  trustedOrigin: "http://localhost:5173",
  database,
  logger,
  auth: {
    getSession: () => Promise.resolve(session),
    handler: () => Promise.resolve(new Response()),
  },
});

beforeAll(async () => {
  await runMigrations({
    url: urls.ownerUrl,
    migrationsDir: fileURLToPath(
      new URL("../../../../packages/db/migrations", import.meta.url),
    ),
  });
  await owner.sql.query(
    `insert into "user" (id, name, email, email_verified) values ($1, 'Resolver fixture', $2, true)`,
    [userId, session.user.email],
  );
  for (const id of orgIds) {
    await owner.sql.query(
      `insert into organization (id, name, slug) values ($1::uuid, 'Resolver org', $1::text)`,
      [id],
    );
    await owner.sql.query(
      `insert into member (id, user_id, organization_id, role, created_at) values ($1, $2, $3, 'viewer', '2026-01-01')`,
      [crypto.randomUUID(), userId, id],
    );
  }
  await owner.sql.query(
    `insert into session (id, token, user_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
    [session.session.id, session.session.token, userId],
  );
});
beforeEach(async () => {
  await owner.sql.query(
    `update "user" set last_active_tenant_id = null where id = $1`,
    [userId],
  );
  await owner.sql.query(
    `update session set active_organization_id = null where user_id = $1`,
    [userId],
  );
  await owner.sql.query(
    `update member set role = 'viewer' where user_id = $1`,
    [userId],
  );
});
afterAll(async () => {
  await owner.sql.query(`delete from "user" where id = $1`, [userId]);
  await owner.sql.query(`delete from organization where id = any($1::uuid[])`, [
    orgIds,
  ]);
  await database.close();
  await owner.close();
});

describe("verified organization bootstrap", () => {
  it("initializes deterministic membership and session mirror without a switch", async () => {
    const response = await app.request("/api/me/resolve-active-org", {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lastActiveTenantId: orgIds[0],
    });
    const state = await database.sql.query(
      `select u.last_active_tenant_id, s.active_organization_id from "user" u join session s on s.user_id = u.id where u.id = $1`,
      [userId],
    );
    expect(state.rows).toEqual([
      { last_active_tenant_id: orgIds[0], active_organization_id: orgIds[0] },
    ]);
  });
});

async function assertMirrors(selected: string | null) {
  const state = await database.sql.query<{
    last_active_tenant_id: string | null;
  }>(`select last_active_tenant_id from "user" where id = $1`, [userId]);
  expect(state.rows[0]?.last_active_tenant_id).toBe(selected);
  const mirrors = await database.sql.query<{
    active_organization_id: string | null;
  }>(`select active_organization_id from session where user_id = $1`, [userId]);
  expect(mirrors.rows.length).toBeGreaterThan(0);
  expect(
    mirrors.rows.every((row) => row.active_organization_id === selected),
  ).toBe(true);
}

// PostgreSQL lock graph is the barrier; no timing delay establishes ordering.
async function waitForBlocked(blocker: PoolClient) {
  const pid = await blocker.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  for (let poll = 0; poll < 1000; poll += 1) {
    const waiters = await owner.sql.query(
      `select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`,
      [pid.rows[0]?.pid],
    );
    if (waiters.rows.length > 0) return;
  }
  throw new Error("resolver never reached the lock barrier");
}

describe("resolver state and lock convergence", () => {
  it("retains valid selection and repairs every session, including a newly inserted session", async () => {
    await setActiveOrganization(database, logger, session, orgIds[1]);
    const newSession = crypto.randomUUID();
    await owner.sql.query(
      `insert into session (id, token, user_id, expires_at) values ($1, $1, $2, now() + interval '1 day')`,
      [newSession, userId],
    );
    expect(
      (await resolveActiveOrganization(database, session)).lastActiveTenantId,
    ).toBe(orgIds[1]);
    await assertMirrors(orgIds[1]);
  });
  it("GET stays read-only; unknown roles produce admission and clear stale mirrors", async () => {
    await owner.sql.query(
      `update member set role = 'unknown' where user_id = $1`,
      [userId],
    );
    await owner.sql.query(
      `update "user" set last_active_tenant_id = $1 where id = $2`,
      [orgIds[1], userId],
    );
    await owner.sql.query(
      `update session set active_organization_id = $1 where user_id = $2`,
      [orgIds[1], userId],
    );
    expect(
      (await getMeContext(database, session)).lastActiveTenantId,
    ).toBeNull();
    await assertMirrors(orgIds[1]);
    expect(await resolveActiveOrganization(database, session)).toMatchObject({
      organizations: [],
      lastActiveTenantId: null,
    });
    await assertMirrors(null);
  });
  it("stale remembered selection falls back to the sole supported membership", async () => {
    await owner.sql.query(
      `update member set role = 'unknown' where organization_id = $1 and user_id = $2`,
      [orgIds[0], userId],
    );
    await owner.sql.query(
      `update "user" set last_active_tenant_id = $1 where id = $2`,
      [orgIds[0], userId],
    );
    const response = await app.request("/api/me/resolve-active-org", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        organizationId: orgIds[0],
        userId: "foreign-user",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      organizations: [{ id: orgIds[1] }],
      lastActiveTenantId: orgIds[1],
    });
    await assertMirrors(orgIds[1]);
  });
  it("membership creation time takes precedence over organization id", async () => {
    await owner.sql.query(
      `update member set created_at = '2025-01-01' where organization_id = $1 and user_id = $2`,
      [orgIds[1], userId],
    );
    try {
      expect(
        (await resolveActiveOrganization(database, session)).lastActiveTenantId,
      ).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
    } finally {
      await owner.sql.query(
        `update member set created_at = '2026-01-01' where user_id = $1`,
        [userId],
      );
    }
  });
  it("concurrent initializers converge without overwriting valid remembered selection", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        resolveActiveOrganization(database, session),
      ),
    );
    expect(
      results.every((result) => result.lastActiveTenantId === orgIds[0]),
    ).toBe(true);
    await assertMirrors(orgIds[0]);
  });
  it("switch committed while initializer awaits its org wins final validation", async () => {
    const blocker = await owner.sql.connect();
    await blocker.query("begin");
    await blocker.query(
      "select id from organization where id = $1 for update",
      [orgIds[0]],
    );
    const pending = resolveActiveOrganization(database, session);
    try {
      await waitForBlocked(blocker);
      await setActiveOrganization(database, logger, session, orgIds[1]);
      await blocker.query("commit");
      expect((await pending).lastActiveTenantId).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await pending.catch(() => {});
    }
  });
  it("membership removed while initializer waits is never assigned", async () => {
    const blocker = await owner.sql.connect();
    await blocker.query("begin");
    await blocker.query(
      "select id from organization where id = $1 for update",
      [orgIds[0]],
    );
    const pending = resolveActiveOrganization(database, session);
    try {
      await waitForBlocked(blocker);
      await blocker.query(
        "select pg_advisory_xact_lock(hashtext($1)::bigint)",
        [`notification-membership:${orgIds[0]}`],
      );
      await blocker.query(
        "delete from member where organization_id = $1 and user_id = $2",
        [orgIds[0], userId],
      );
      await blocker.query("commit");
      expect((await pending).lastActiveTenantId).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
      await expect(
        setActiveOrganization(database, logger, session, orgIds[0]),
      ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await pending.catch(() => {});
      await owner.sql.query(
        `insert into member (id, user_id, organization_id, role, created_at) values ($1, $2, $3, 'viewer', '2026-01-01') on conflict do nothing`,
        [crypto.randomUUID(), userId, orgIds[0]],
      );
    }
  });
  it("an insert missed by update-all-sessions converges at its own bootstrap", async () => {
    const insertion = await owner.sql.connect();
    await insertion.query("begin");
    const id = crypto.randomUUID();
    try {
      await insertion.query(
        `insert into session (id, token, user_id, expires_at) values ($1, $1, $2, now() + interval '1 day')`,
        [id, userId],
      );
      await setActiveOrganization(database, logger, session, orgIds[1]);
      await insertion.query("commit");
      expect(
        (await resolveActiveOrganization(database, session)).lastActiveTenantId,
      ).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
    } finally {
      await insertion.query("rollback");
      insertion.release();
    }
  });
  it("explicit switches serialize and the later commit remains authoritative", async () => {
    const blocker = await owner.sql.connect();
    await blocker.query("begin");
    await blocker.query(
      "select id from organization where id = $1 for update",
      [orgIds[1]],
    );
    const later = setActiveOrganization(database, logger, session, orgIds[1]);
    try {
      await waitForBlocked(blocker);
      await setActiveOrganization(database, logger, session, orgIds[0]);
      await blocker.query("commit");
      expect((await later).lastActiveTenantId).toBe(orgIds[1]);
      expect(
        (await resolveActiveOrganization(database, session)).lastActiveTenantId,
      ).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await later.catch(() => {});
    }
  });
  it("self-leave after selection clears mirrors and re-bootstrap selects remaining or admission", async () => {
    await resolveActiveOrganization(database, session);
    try {
      await leaveOrganization(database, {
        organizationId: orgIds[0],
        actorUserId: userId,
      });
      await assertMirrors(null);
      expect(
        (await resolveActiveOrganization(database, session)).lastActiveTenantId,
      ).toBe(orgIds[1]);
      await leaveOrganization(database, {
        organizationId: orgIds[1],
        actorUserId: userId,
      });
      await assertMirrors(null);
      expect(await resolveActiveOrganization(database, session)).toMatchObject({
        organizations: [],
        lastActiveTenantId: null,
      });
      await expect(
        setActiveOrganization(database, logger, session, orgIds[1]),
      ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
    } finally {
      for (const organizationId of orgIds)
        await owner.sql.query(
          `insert into member (id, user_id, organization_id, role, created_at) values ($1, $2, $3, 'viewer', '2026-01-01') on conflict do nothing`,
          [crypto.randomUUID(), userId, organizationId],
        );
    }
  });
  it("runs as a non-owner NOBYPASSRLS role", async () => {
    const roles = await database.sql.query(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(roles.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });
});
