import { openTestPostgres } from "@nightwatch/db/testing";
import { createLogger } from "@nightwatch/shared";
import { expect, it } from "vitest";

import type { AuthSession } from "../auth";
import { setActiveOrganization } from "./service";

it("rolls back the earlier user selection and every session when the session mirror write fails, then permits a retry", async () => {
  const fixture = await openTestPostgres("me-service-rollback");
  const errors: unknown[] = [];
  try {
    const userId = crypto.randomUUID();
    const sentinelId = crypto.randomUUID();
    const orgA = crypto.randomUUID();
    const orgB = crypto.randomUUID();
    const session: AuthSession = {
      user: {
        id: userId,
        name: "Rollback fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
      },
      session: {
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    };
    for (const id of [orgA, orgB]) {
      await fixture.owner.sql.query(
        "insert into organization (id, name, slug) values ($1::uuid, 'Rollback organization', $1::text)",
        [id],
      );
    }
    for (const id of [userId, sentinelId]) {
      await fixture.owner.sql.query(
        `insert into "user" (id, name, email, email_verified, last_active_tenant_id, updated_at)
         values ($1, 'Rollback fixture', $2, true, $3, '2020-01-01 00:00:00.123456+00')`,
        [id, `${id}@example.test`, orgA],
      );
    }
    for (const id of [orgA, orgB]) {
      await fixture.owner.sql.query(
        "insert into member (id, user_id, organization_id, role) values ($1, $2, $3, 'viewer')",
        [crypto.randomUUID(), userId, id],
      );
    }
    for (const [id, user, token] of [
      [session.session.id, userId, session.session.token],
      [crypto.randomUUID(), userId, crypto.randomUUID()],
      [crypto.randomUUID(), sentinelId, crypto.randomUUID()],
    ]) {
      await fixture.owner.sql.query(
        `insert into session (id, user_id, token, expires_at, active_organization_id)
         values ($1, $2, $3, now() + interval '1 day', $4)`,
        [id, user, token, orgA],
      );
    }
    const readState = async () => {
      const users = await fixture.owner.sql.query<{
        id: string;
        last_active_tenant_id: string | null;
        updated_at: string;
      }>(
        `select id, last_active_tenant_id, updated_at::text from "user"
         where id = any($1::text[]) order by id`,
        [[userId, sentinelId]],
      );
      const sessions = await fixture.owner.sql.query<{
        state: Record<string, unknown> & {
          user_id: string;
          active_organization_id: string | null;
        };
      }>(
        "select to_jsonb(s) as state from session s where user_id = any($1::text[]) order by id",
        [[userId, sentinelId]],
      );
      return { users: users.rows, sessions: sessions.rows };
    };
    const before = await readState();
    expect(before.users).toHaveLength(2);
    expect(
      before.users.every((row) => row.last_active_tenant_id === orgA),
    ).toBe(true);
    expect(before.sessions).toHaveLength(3);
    await fixture.owner.sql.query(`
      create function aarc02_fail_session_mirror() returns trigger language plpgsql as $$
      begin
        if new.user_id = tg_argv[0] and new.active_organization_id = tg_argv[1] then
          if (select last_active_tenant_id::text from "user" where id = new.user_id)
             is distinct from tg_argv[1] then
            raise exception 'AARC02_USER_WRITE_NOT_VISIBLE';
          end if;
          raise exception 'AARC02_SESSION_MIRROR_FAILURE';
        end if;
        return new;
      end $$
    `);
    await fixture.owner.sql.query(`
      create trigger aarc02_fail_session_mirror before update of active_organization_id on session
      for each row execute function aarc02_fail_session_mirror('${userId}', '${orgB}')
    `);
    const runtimePid = await fixture.runtime.sql.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    const logger = createLogger({ level: "silent" });
    await expect(
      setActiveOrganization(fixture.runtime, logger, session, orgB),
    ).rejects.toThrow(/^AARC02_SESSION_MIRROR_FAILURE$/);
    expect(await readState()).toEqual(before);
    const connection = await fixture.owner.sql.query(
      "select state, xact_start is null as transaction_closed from pg_stat_activity where pid = $1",
      [runtimePid.rows[0]?.pid],
    );
    expect(connection.rows).toEqual([
      { state: "idle", transaction_closed: true },
    ]);

    await fixture.owner.sql.query(
      "drop trigger aarc02_fail_session_mirror on session",
    );
    await fixture.owner.sql.query("drop function aarc02_fail_session_mirror()");
    const retried = await setActiveOrganization(
      fixture.runtime,
      logger,
      session,
      orgB,
    );
    expect(retried.lastActiveTenantId).toBe(orgB);
    const after = await readState();
    expect(
      after.users.find((row) => row.id === userId)?.last_active_tenant_id,
    ).toBe(orgB);
    expect(after.users.find((row) => row.id === userId)?.updated_at).not.toBe(
      before.users.find((row) => row.id === userId)?.updated_at,
    );
    expect(after.users.find((row) => row.id === sentinelId)).toEqual(
      before.users.find((row) => row.id === sentinelId),
    );
    expect(after.sessions).toEqual(
      before.sessions.map(({ state }) => ({
        state:
          state.user_id === userId
            ? { ...state, active_organization_id: orgB }
            : state,
      })),
    );
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await fixture.close();
    } catch (cleanup) {
      errors.push(cleanup);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      "Rollback test and fixture cleanup failed",
      { cause: errors[0] },
    );
}, 180_000);
