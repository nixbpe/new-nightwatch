import { fileURLToPath } from "node:url";
import { createDatabase, runMigrations } from "@nightwatch/db";
import { createLogger } from "@nightwatch/shared";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthSession } from "../auth";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { registerMeRoutes } from "./routes";
import {
  getMeContext,
  resolveActiveOrganization,
  setActiveOrganization,
} from "./service";
import type { PoolClient, QueryResult } from "pg";
import {
  leaveOrganization,
  revokeOrganizationMember,
} from "../organization-notifications/members";

const urls = requireIntegrationDatabaseUrls();
const userId = crypto.randomUUID();
const runtimeName = `me-service-tests-${userId}`;
const runtimeUrl = new URL(urls.runtimeUrl);
runtimeUrl.searchParams.set("application_name", runtimeName);
const database = createDatabase(runtimeUrl.toString());
const owner = createDatabase(urls.ownerUrl);
const ownedUserIds = [userId];
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
  const roles = await database.sql.query(
    `select rolsuper, rolbypassrls,
            pg_has_role(current_user, d.datdba, 'MEMBER') as owns_database,
            exists (
              select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r', 'p')
                and pg_has_role(current_user, c.relowner, 'MEMBER')
            ) as owns_tables
       from pg_roles r cross join pg_database d
      where r.rolname = current_user and d.datname = current_database()`,
  );
  expect(roles.rows).toEqual([
    {
      rolsuper: false,
      rolbypassrls: false,
      owns_database: false,
      owns_tables: false,
    },
  ]);
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
  await owner.sql.query("delete from session where user_id = $1 and id <> $2", [
    userId,
    session.session.id,
  ]);
  await restoreMemberships();
});
afterAll(async () => {
  try {
    await owner.sql.query(`delete from "user" where id = any($1::text[])`, [
      ownedUserIds,
    ]);
    await owner.sql.query(
      `delete from organization where id = any($1::uuid[])`,
      [orgIds],
    );
  } finally {
    await Promise.all([database.close(), owner.close()]);
  }
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

const BARRIER_TIMEOUT_MS = 5000;

async function withinDeadline<T>(
  pending: Promise<T>,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, BARRIER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function finishOperations(operations: Promise<unknown>[]) {
  const settled = Promise.allSettled(operations);
  try {
    await withinDeadline(settled, "Runtime operations did not settle");
  } catch (error) {
    const cancellation = {
      text: `select pg_cancel_backend(pid) from pg_stat_activity
             where datname = current_database() and application_name = $1
               and state = 'active'`,
      values: [runtimeName],
      query_timeout: 1000,
    };
    await owner.sql.query(cancellation);
    await withinDeadline(settled, "Runtime operations survived cancellation");
    throw error;
  }
}

async function waitForBlocked(blocker: PoolClient) {
  const pid = await blocker.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return vi.waitFor(
    async () => {
      // Activity metadata is a snapshot; pg_blocking_pids is live. Require
      // both observations for the same returned waiter before releasing it.
      const query = {
        text: `select pid, wait_event_type, pg_blocking_pids(pid) as blockers
             from pg_stat_activity
             where $1 = any(pg_blocking_pids(pid)) and wait_event_type = 'Lock'`,
        values: [pid.rows[0]?.pid],
        query_timeout: 1000,
      };
      const waiters = await owner.sql.query<{
        pid: number;
        wait_event_type: string;
        blockers: number[];
      }>(query);
      expect(waiters.rows.length).toBeGreaterThan(0);
      expect(waiters.rows[0]?.wait_event_type).toBe("Lock");
      expect(waiters.rows[0]?.blockers).toContain(pid.rows[0]?.pid);
    },
    { timeout: BARRIER_TIMEOUT_MS, interval: 10 },
  );
}

function resolverPhase(text: string) {
  const sql = text
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^begin\b/.test(sql)) return "begin";
  if (/^commit\b/.test(sql)) return "commit";
  if (/\bfrom organization\b/.test(sql) && /\bfor update\b/.test(sql))
    return "organization-lock";
  if (
    (/\bfrom user\b/.test(sql) && /\bfor update\b/.test(sql)) ||
    /^update user\b/.test(sql)
  )
    return "account-lock";
  return null;
}

async function restoreMemberships() {
  for (const organizationId of orgIds) {
    await owner.sql.query(
      `insert into member (id, user_id, organization_id, role, created_at)
       values ($1, $2, $3, 'viewer', '2026-01-01')
       on conflict (organization_id, user_id)
       do update set role = excluded.role, created_at = excluded.created_at`,
      [crypto.randomUUID(), userId, organizationId],
    );
  }
}

async function removalFixture(action: "leave" | "revoke", remaining: boolean) {
  const actor = crypto.randomUUID();
  ownedUserIds.push(actor);
  const restore = async () => {
    try {
      await owner.sql.query('delete from "user" where id = $1', [actor]);
    } finally {
      await restoreMemberships();
    }
  };
  try {
    await owner.sql.query(
      'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
      [actor, "Race actor", `${actor}@nightwatch.invalid`],
    );
    await owner.sql.query(
      "insert into member (id, user_id, organization_id, role) values ($1, $2, $3, 'owner')",
      [crypto.randomUUID(), actor, orgIds[0]],
    );
    const target = await owner.sql.query<{ id: string }>(
      "select id from member where user_id = $1 and organization_id = $2",
      [userId, orgIds[0]],
    );
    const memberId = target.rows[0]?.id;
    if (memberId === undefined)
      throw new Error("Removal fixture has no target membership");
    if (!remaining) {
      await owner.sql.query(
        "delete from member where user_id = $1 and organization_id = $2",
        [userId, orgIds[1]],
      );
    }
    return {
      remove: () =>
        action === "leave"
          ? leaveOrganization(database, {
              organizationId: orgIds[0],
              actorUserId: userId,
            })
          : revokeOrganizationMember(database, {
              organizationId: orgIds[0],
              actorUserId: actor,
              memberId,
            }),
      restore,
    };
  } catch (error) {
    await restore();
    throw error;
  }
}

// The resolver uses pg's Promise overloads only. These typed views retain the
// real objects while giving scheduling spies the same understood contract.
function promiseQueries(client: Pick<PoolClient, "query">): {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
} {
  return client;
}
const promiseConnections: { connect: () => Promise<PoolClient> } = database.sql;

describe("resolver state and lock convergence", () => {
  it("bounds repeated candidate changes and fails without overwriting the winning switch", async () => {
    const client = await database.sql.connect();
    const realQuery = client.query.bind(client);
    let attempts = 0;
    let winning = orgIds[1];
    const querySpy = vi
      .spyOn(promiseQueries(client), "query")
      .mockImplementation(async (config, values) => {
        if (resolverPhase(config) === "begin") {
          attempts++;
          winning = attempts % 2 === 1 ? orgIds[1] : orgIds[0];
          await setActiveOrganization(database, logger, session, winning);
        }
        return realQuery(config, values);
      });
    const connectionSpy = vi
      .spyOn(promiseConnections, "connect")
      .mockImplementationOnce(() => Promise.resolve(client));
    const pending = resolveActiveOrganization(database, session);
    try {
      await expect(
        withinDeadline(pending, "Resolver did not stop retrying"),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "ACTIVE_ORGANIZATION_RESOLUTION_FAILED",
      });
      // Resolver releases this client. Restore its promise-only scheduling spy
      // before Pool.query can reuse it with the callback overload.
      querySpy.mockRestore();
      connectionSpy.mockRestore();
      expect(attempts).toBeGreaterThan(1);
      await assertMirrors(winning);
      expect(
        (await getMeContext(database, session)).organizations.map(
          (org) => org.id,
        ),
      ).toEqual(orgIds);
    } finally {
      querySpy.mockRestore();
      connectionSpy.mockRestore();
      await finishOperations([pending]);
    }
  });
  it("re-discovers a membership inserted after zero-candidate discovery before admitting tenant use", async () => {
    await owner.sql.query("delete from member where user_id = $1", [userId]);
    const client = await database.sql.connect();
    const realQuery = client.query.bind(client);
    let attempts = 0;
    const querySpy = vi
      .spyOn(promiseQueries(client), "query")
      .mockImplementation(async (config, values) => {
        if (resolverPhase(config) === "begin" && ++attempts === 1) {
          await owner.sql.query(
            `insert into member (id, user_id, organization_id, role, created_at) values ($1, $2, $3, 'viewer', '2026-01-01')`,
            [crypto.randomUUID(), userId, orgIds[1]],
          );
        }
        return realQuery(config, values);
      });
    const connectionSpy = vi
      .spyOn(promiseConnections, "connect")
      .mockImplementationOnce(() => Promise.resolve(client));
    const pending = resolveActiveOrganization(database, session);
    try {
      expect(
        (
          await withinDeadline(
            pending,
            "Resolver did not rediscover membership",
          )
        ).lastActiveTenantId,
      ).toBe(orgIds[1]);
      querySpy.mockRestore();
      connectionSpy.mockRestore();
      expect(attempts).toBeGreaterThan(1);
      await assertMirrors(orgIds[1]);
      await expect(
        setActiveOrganization(database, logger, session, orgIds[0]),
      ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
    } finally {
      querySpy.mockRestore();
      connectionSpy.mockRestore();
      try {
        await finishOperations([pending]);
      } finally {
        await restoreMemberships();
      }
    }
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
    const response = await app.request("/api/me/context");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lastActiveTenantId: null });
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
  it("concurrent initializers converge on the deterministic fallback", async () => {
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
      expect(
        (await withinDeadline(pending, "Initializer did not finish"))
          .lastActiveTenantId,
      ).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await finishOperations([pending]);
    }
  });
  it("preserves valid selection and repairs every session when an insert misses the switch", async () => {
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
      const inserted = await database.sql.query<{
        active_organization_id: string | null;
      }>("select active_organization_id from session where id = $1", [id]);
      expect(inserted.rows[0]?.active_organization_id).toBeNull();
      const newSession = {
        ...session,
        session: { ...session.session, id, token: id },
      };
      await owner.sql.query(
        "update session set active_organization_id = null where id = $1",
        [session.session.id],
      );
      expect(
        (await resolveActiveOrganization(database, newSession))
          .lastActiveTenantId,
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
      expect(
        (await withinDeadline(later, "Switch did not finish"))
          .lastActiveTenantId,
      ).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
      expect(
        (await resolveActiveOrganization(database, session)).lastActiveTenantId,
      ).toBe(orgIds[1]);
      await assertMirrors(orgIds[1]);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await finishOperations([later]);
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
      await restoreMemberships();
    }
  });
  for (const action of ["leave", "revoke"] as const) {
    for (const ordering of ["removal-first", "resolver-first"] as const) {
      for (const remaining of [true, false]) {
        it(`${action} ${ordering} with remaining membership ${String(remaining)} preserves mirrors and denies removed scope`, async () => {
          const fixture = await removalFixture(action, remaining);
          const client = await database.sql.connect();
          const realQuery = client.query.bind(client);
          let removed = false;
          const querySpy = vi
            .spyOn(promiseQueries(client), "query")
            .mockImplementation(async (config, values) => {
              if (
                !removed &&
                ordering === "removal-first" &&
                resolverPhase(config) === "begin"
              ) {
                removed = true;
                await fixture.remove();
              }
              const result = await realQuery(config, values);
              if (
                !removed &&
                ordering === "resolver-first" &&
                resolverPhase(config) === "commit"
              ) {
                removed = true;
                await fixture.remove();
              }
              return result;
            });
          const connectionSpy = vi
            .spyOn(promiseConnections, "connect")
            .mockImplementationOnce(() => Promise.resolve(client));
          const pending = resolveActiveOrganization(database, session);
          try {
            const resolved = await withinDeadline(
              pending,
              "Resolver did not finish after removal",
            );
            querySpy.mockRestore();
            connectionSpy.mockRestore();
            expect(removed).toBe(true);
            const expected = remaining ? orgIds[1] : null;
            if (ordering === "removal-first") {
              expect(resolved).toMatchObject({
                lastActiveTenantId: expected,
                organizations: remaining ? [{ id: orgIds[1] }] : [],
              });
              await assertMirrors(expected);
            } else {
              expect(resolved.lastActiveTenantId).toBe(orgIds[0]);
              await assertMirrors(null);
            }
            const fresh = await resolveActiveOrganization(database, session);
            expect(fresh.lastActiveTenantId).toBe(expected);
            await assertMirrors(expected);
            expect(
              fresh.organizations.some((org) => org.id === orgIds[0]),
            ).toBe(false);
            await expect(
              setActiveOrganization(database, logger, session, orgIds[0]),
            ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
          } finally {
            try {
              await finishOperations([pending]);
            } finally {
              querySpy.mockRestore();
              connectionSpy.mockRestore();
              await fixture.restore();
            }
          }
        });
      }
    }
  }

  for (const action of ["leave", "revoke"] as const) {
    for (const winner of ["resolver", "removal"] as const) {
      for (const remaining of [true, false]) {
        it(`overlapping runtime ${action}, ${winner} wins org lock, remaining ${String(remaining)}`, async () => {
          const fixture = await removalFixture(action, remaining);
          const client = await database.sql.connect();
          const realQuery = client.query.bind(client);
          const held = Promise.withResolvers<undefined>();
          const release = Promise.withResolvers<undefined>();
          let paused = false;
          const querySpy = vi
            .spyOn(promiseQueries(client), "query")
            .mockImplementation(async (text, values) => {
              const result = await realQuery(text, values);
              if (!paused && resolverPhase(text) === "organization-lock") {
                paused = true;
                held.resolve(undefined);
                await release.promise;
              }
              return result;
            });
          const preflight =
            winner === "removal" ? await database.sql.connect() : null;
          const connectionSpy = vi.spyOn(promiseConnections, "connect");
          if (preflight !== null)
            connectionSpy.mockResolvedValueOnce(preflight);
          connectionSpy.mockResolvedValueOnce(client);
          const first =
            winner === "resolver"
              ? resolveActiveOrganization(database, session)
              : fixture.remove();
          void first.catch(held.reject);
          let second: Promise<unknown> | undefined;
          try {
            await withinDeadline(
              held.promise,
              "Runtime winner never acquired its lock",
            );
            second =
              winner === "resolver"
                ? fixture.remove()
                : resolveActiveOrganization(database, session);
            void second.catch(() => undefined);
            await waitForBlocked(client);
            release.resolve(undefined);
            const results = await withinDeadline(
              Promise.all([first, second]),
              "Overlapping removal did not finish",
            );
            querySpy.mockRestore();
            connectionSpy.mockRestore();
            const resolved = results[winner === "resolver" ? 0 : 1];
            const expected = remaining ? orgIds[1] : null;
            if (winner === "removal") {
              expect(resolved).toMatchObject({
                lastActiveTenantId: expected,
                organizations: remaining ? [{ id: orgIds[1] }] : [],
              });
              await assertMirrors(expected);
            } else {
              expect(resolved).toMatchObject({ lastActiveTenantId: orgIds[0] });
              await assertMirrors(null);
            }
            const fresh = await resolveActiveOrganization(database, session);
            expect(fresh.lastActiveTenantId).toBe(expected);
            await assertMirrors(expected);
            expect(
              fresh.organizations.some((org) => org.id === orgIds[0]),
            ).toBe(false);
            await expect(
              setActiveOrganization(database, logger, session, orgIds[0]),
            ).rejects.toMatchObject({ code: "MEMBERSHIP_DENIED" });
          } finally {
            release.resolve(undefined);
            try {
              await finishOperations([
                first,
                ...(second === undefined ? [] : [second]),
              ]);
            } finally {
              querySpy.mockRestore();
              connectionSpy.mockRestore();
              await fixture.restore();
            }
          }
        });
      }
    }
  }

  for (const winner of ["resolver", "switch"] as const) {
    it(`overlapping runtime switch with ${winner} holding the account lock`, async () => {
      const client = await database.sql.connect();
      const realQuery = client.query.bind(client);
      const held = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<undefined>();
      let paused = false;
      const querySpy = vi
        .spyOn(promiseQueries(client), "query")
        .mockImplementation(async (text, values) => {
          const result = await realQuery(text, values);
          if (!paused && resolverPhase(text) === "account-lock") {
            paused = true;
            held.resolve(undefined);
            await release.promise;
          }
          return result;
        });
      const connectionSpy = vi
        .spyOn(promiseConnections, "connect")
        .mockImplementationOnce(() => Promise.resolve(client));
      const change = () =>
        setActiveOrganization(database, logger, session, orgIds[1]);
      const first =
        winner === "resolver"
          ? resolveActiveOrganization(database, session)
          : change();
      void first.catch(held.reject);
      let second: ReturnType<typeof resolveActiveOrganization> | undefined;
      try {
        await withinDeadline(
          held.promise,
          "Runtime winner never acquired account lock",
        );
        second =
          winner === "resolver"
            ? change()
            : resolveActiveOrganization(database, session);
        void second.catch(() => undefined);
        await waitForBlocked(client);
        release.resolve(undefined);
        const [firstContext, secondContext] = await withinDeadline(
          Promise.all([first, second]),
          "Overlapping switch did not finish",
        );
        querySpy.mockRestore();
        connectionSpy.mockRestore();
        expect(firstContext.lastActiveTenantId).toBe(
          winner === "resolver" ? orgIds[0] : orgIds[1],
        );
        expect(secondContext.lastActiveTenantId).toBe(orgIds[1]);
        await assertMirrors(orgIds[1]);
        expect(
          (await resolveActiveOrganization(database, session))
            .lastActiveTenantId,
        ).toBe(orgIds[1]);
        expect(
          (await getMeContext(database, session)).organizations.map(
            (org) => org.id,
          ),
        ).toEqual(orgIds);
      } finally {
        release.resolve(undefined);
        try {
          await finishOperations([
            first,
            ...(second === undefined ? [] : [second]),
          ]);
        } finally {
          querySpy.mockRestore();
          connectionSpy.mockRestore();
        }
      }
    });
  }
});
