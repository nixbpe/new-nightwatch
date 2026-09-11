import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  readE2EFixtureConfig,
  resetFixture,
  type E2EFixtureIdentity,
} from "./provision-e2e-fixture";

const { ownerUrl: OWNER_URL } = requireIntegrationDatabaseUrls();
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const database: Database = createDatabase(OWNER_URL);
const runId = crypto.randomUUID();
const fixtureIdentity = {
  userId: crypto.randomUUID(),
  accountId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  memberId: crypto.randomUUID(),
  organizationSlug: `e2e-settings-test-${runId}`,
} satisfies E2EFixtureIdentity;
const fixtureEmail = `settings-fixture-${runId}@nightwatch.invalid`;
const conflictUserId = crypto.randomUUID();
const sharedUserId = crypto.randomUUID();
const rollbackUserId = crypto.randomUUID();

async function cleanup(): Promise<void> {
  await database.sql.query('delete from "user" where id = any($1::text[])', [
    [fixtureIdentity.userId, conflictUserId, sharedUserId, rollbackUserId],
  ]);
  await database.sql.query("delete from organization where id = $1", [
    fixtureIdentity.organizationId,
  ]);
}

beforeAll(async () => {
  await runMigrations({ url: OWNER_URL, migrationsDir: MIGRATIONS_DIR });
});

beforeEach(cleanup);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await database.close();
  }
});

describe("E2E fixture configuration", () => {
  it("requires explicit owner URL, email, and password and restricts the disposable domain", () => {
    expect(() => readE2EFixtureConfig({})).toThrow(
      "DATABASE_OWNER_URL must be a non-empty value",
    );
    expect(() =>
      readE2EFixtureConfig({
        DATABASE_OWNER_URL: OWNER_URL,
        E2E_EMAIL: "settings@example.com",
        E2E_PASSWORD: "password",
      }),
    ).toThrow("E2E_EMAIL must use the disposable @nightwatch.invalid domain");

    expect(
      readE2EFixtureConfig({
        DATABASE_OWNER_URL: `  ${OWNER_URL}  `,
        E2E_EMAIL: "  Settings@NightWatch.Invalid  ",
        E2E_PASSWORD: "  disposable-password  ",
      }),
    ).toEqual({
      ownerUrl: OWNER_URL,
      email: "settings@nightwatch.invalid",
      password: "disposable-password",
    });
  });
});

describe("E2E fixture reset", () => {
  it("creates a verified credential owner and replaces security-sensitive state", async () => {
    const firstClient = await database.sql.connect();
    try {
      await resetFixture(
        firstClient,
        fixtureEmail,
        "first-password-hash",
        fixtureIdentity,
      );
    } finally {
      firstClient.release();
    }

    const created = await database.sql.query<{
      emailVerified: boolean;
      password: string;
      role: string;
      slug: string;
    }>(
      `select u.email_verified as "emailVerified", a.password, m.role, o.slug
       from "user" u
       join account a on a.user_id = u.id and a.provider_id = 'credential'
       join member m on m.user_id = u.id
       join organization o on o.id = m.organization_id
       where lower(u.email) = lower($1)`,
      [fixtureEmail],
    );
    expect(created.rows).toEqual([
      {
        emailVerified: true,
        password: "first-password-hash",
        role: "owner",
        slug: fixtureIdentity.organizationSlug,
      },
    ]);

    const userId = await database.sql.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1)',
      [fixtureEmail],
    );
    expect(userId.rows).toHaveLength(1);
    await database.sql.query(
      `insert into session (id, token, user_id, expires_at, created_at, updated_at)
       values ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [crypto.randomUUID(), crypto.randomUUID(), userId.rows[0]?.id],
    );

    const secondClient = await database.sql.connect();
    try {
      await resetFixture(
        secondClient,
        fixtureEmail,
        "second-password-hash",
        fixtureIdentity,
      );
    } finally {
      secondClient.release();
    }

    const replaced = await database.sql.query<{
      password: string;
      sessionCount: number;
    }>(
      `select a.password,
              (select count(*)::int from session s where s.user_id = u.id) as "sessionCount"
       from "user" u
       join account a on a.user_id = u.id and a.provider_id = 'credential'
       where lower(u.email) = lower($1)`,
      [fixtureEmail],
    );
    expect(replaced.rows).toEqual([
      { password: "second-password-hash", sessionCount: 0 },
    ]);
  });

  it("rolls back without touching a conflicting identity", async () => {
    await database.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Conflict', $2, true, now(), now())`,
      [conflictUserId, fixtureEmail],
    );

    const client = await database.sql.connect();
    try {
      await expect(
        resetFixture(client, fixtureEmail, "password-hash", fixtureIdentity),
      ).rejects.toThrow(
        "E2E fixture user identity conflicts with existing data",
      );
    } finally {
      client.release();
    }

    const state = await database.sql.query<{
      users: number;
      organizations: number;
    }>(
      `select
         (select count(*)::int from "user" where id = $1) as users,
         (select count(*)::int from organization where slug = $2) as organizations`,
      [conflictUserId, fixtureIdentity.organizationSlug],
    );
    expect(state.rows).toEqual([{ users: 1, organizations: 0 }]);
  });

  it.each(["account", "member", "invitation", "session"] as const)(
    "refuses to delete a fixture with one non-fixture %s relation",
    async (kind) => {
      const firstClient = await database.sql.connect();
      try {
        await resetFixture(
          firstClient,
          fixtureEmail,
          "password-hash",
          fixtureIdentity,
        );
      } finally {
        firstClient.release();
      }

      if (kind === "member" || kind === "session") {
        await database.sql.query(
          `insert into "user" (id, name, email, email_verified, created_at, updated_at)
           values ($1, 'Shared user', $2, true, now(), now())`,
          [sharedUserId, `shared-${runId}@example.test`],
        );
      }
      if (kind === "account") {
        await database.sql.query(
          `insert into account
             (id, account_id, provider_id, user_id, password, created_at, updated_at)
           values ($1, $2, 'secondary', $3, 'secondary-hash', now(), now())`,
          [crypto.randomUUID(), crypto.randomUUID(), fixtureIdentity.userId],
        );
      } else if (kind === "member") {
        await database.sql.query(
          `insert into member
             (id, organization_id, user_id, role, created_at, updated_at)
           values ($1, $2, $3, 'viewer', now(), now())`,
          [crypto.randomUUID(), fixtureIdentity.organizationId, sharedUserId],
        );
      } else if (kind === "invitation") {
        await database.sql.query(
          `insert into invitation
             (id, organization_id, email, role, status, inviter_id, expires_at, created_at, updated_at)
           values ($1, $2, $3, 'viewer', 'pending', $4, now() + interval '1 day', now(), now())`,
          [
            crypto.randomUUID(),
            fixtureIdentity.organizationId,
            `invite-${runId}@example.test`,
            fixtureIdentity.userId,
          ],
        );
      } else {
        await database.sql.query(
          `insert into session
             (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, now() + interval '1 hour', now(), now())`,
          [
            crypto.randomUUID(),
            crypto.randomUUID(),
            sharedUserId,
            fixtureIdentity.organizationId,
          ],
        );
      }

      const client = await database.sql.connect();
      try {
        await expect(
          resetFixture(
            client,
            fixtureEmail,
            "replacement-hash",
            fixtureIdentity,
          ),
        ).rejects.toThrow(
          "E2E fixture identity is shared with non-fixture data",
        );
      } finally {
        client.release();
      }

      const preserved = await database.sql.query<{
        accounts: number;
        invitations: number;
        members: number;
        sessions: number;
      }>(
        `select
           (select count(*)::int from account where user_id = $1) as accounts,
           (select count(*)::int from member where organization_id = $2) as members,
           (select count(*)::int from invitation where organization_id = $2) as invitations,
           (select count(*)::int from session where user_id = $3 and active_organization_id = $2::text) as sessions`,
        [fixtureIdentity.userId, fixtureIdentity.organizationId, sharedUserId],
      );
      const expectedByKind: Record<
        typeof kind,
        {
          accounts: number;
          invitations: number;
          members: number;
          sessions: number;
        }
      > = {
        account: { accounts: 2, invitations: 0, members: 1, sessions: 0 },
        member: { accounts: 1, invitations: 0, members: 2, sessions: 0 },
        invitation: { accounts: 1, invitations: 1, members: 1, sessions: 0 },
        session: { accounts: 1, invitations: 0, members: 1, sessions: 1 },
      };
      expect(preserved.rows).toEqual([expectedByKind[kind]]);
    },
  );

  it("rolls back fixture replacement when a post-delete insert fails", async () => {
    const seedClient = await database.sql.connect();
    try {
      await resetFixture(
        seedClient,
        fixtureEmail,
        "original-hash",
        fixtureIdentity,
      );
    } finally {
      seedClient.release();
    }
    await database.sql.query("delete from account where id = $1", [
      fixtureIdentity.accountId,
    ]);
    const collidingAccountId = crypto.randomUUID();
    await database.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'Rollback owner', $2, true, now(), now())`,
      [rollbackUserId, `rollback-${runId}@example.test`],
    );
    await database.sql.query(
      `insert into account
         (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, 'unrelated-hash', now(), now())`,
      [collidingAccountId, rollbackUserId],
    );

    const client = await database.sql.connect();
    try {
      await expect(
        resetFixture(client, fixtureEmail, "replacement-hash", {
          ...fixtureIdentity,
          accountId: collidingAccountId,
        }),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      client.release();
    }

    const restored = await database.sql.query<{
      fixtureUsers: number;
      organizations: number;
      unrelatedAccounts: number;
    }>(
      `select
         (select count(*)::int from "user" where id = $1 and email = $2) as "fixtureUsers",
         (select count(*)::int from organization where id = $3 and slug = $4) as organizations,
         (select count(*)::int from account where id = $5 and user_id = $6) as "unrelatedAccounts"`,
      [
        fixtureIdentity.userId,
        fixtureEmail,
        fixtureIdentity.organizationId,
        fixtureIdentity.organizationSlug,
        collidingAccountId,
        rollbackUserId,
      ],
    );
    expect(restored.rows).toEqual([
      { fixtureUsers: 1, organizations: 1, unrelatedAccounts: 1 },
    ]);
  });
});
