import { createDatabase } from "@nightwatch/db";
import { hashPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";

export type E2EFixtureIdentity = Readonly<{
  userId: string;
  accountId: string;
  organizationId: string;
  memberId: string;
  organizationSlug: string;
}>;

const PRODUCTION_FIXTURE: E2EFixtureIdentity = {
  userId: "00000000-0000-4000-8000-000000000006",
  accountId: "00000000-0000-4000-8000-000000000106",
  organizationId: "00000000-0000-4000-8000-000000000206",
  memberId: "00000000-0000-4000-8000-000000000306",
  organizationSlug: "e2e-settings",
};
const FIXTURE_EMAIL_DOMAIN = "@nightwatch.invalid";

function requiredEnv(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be a non-empty value`);
  }
  return value;
}

export function readE2EFixtureConfig(source: NodeJS.ProcessEnv): {
  ownerUrl: string;
  email: string;
  password: string;
} {
  const ownerUrl = requiredEnv(source, "DATABASE_OWNER_URL");
  const email = requiredEnv(source, "E2E_EMAIL").toLowerCase();
  const password = requiredEnv(source, "E2E_PASSWORD");
  if (!/^[^@\s]+@nightwatch\.invalid$/.test(email)) {
    throw new Error(
      `E2E_EMAIL must use the disposable ${FIXTURE_EMAIL_DOMAIN} domain`,
    );
  }
  return { ownerUrl, email, password };
}

export async function resetFixture(
  client: PoolClient,
  email: string,
  passwordHash: string,
  identity: E2EFixtureIdentity = PRODUCTION_FIXTURE,
): Promise<void> {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `provision-e2e-fixture:${identity.organizationSlug}`,
    ]);

    const emailConflict = await client.query<{ id: string }>(
      `select id from "user"
       where (id = $2 and lower(email) <> lower($1))
          or (id <> $2 and lower(email) = lower($1))`,
      [email, identity.userId],
    );
    if (emailConflict.rows.length > 0) {
      throw new Error("E2E fixture user identity conflicts with existing data");
    }

    const organizationConflict = await client.query<{ id: string }>(
      `select id from organization
       where (id = $2 and slug <> $1)
          or (id <> $2 and slug = $1)`,
      [identity.organizationSlug, identity.organizationId],
    );
    if (organizationConflict.rows.length > 0) {
      throw new Error(
        "E2E fixture organization identity conflicts with existing data",
      );
    }

    const sharedState = await client.query<{ shared: boolean }>(
      `select exists (
         select 1 from member
         where (user_id = $1 or organization_id = $2::uuid)
           and not (id = $3 and user_id = $1 and organization_id = $2::uuid)
         union all
         select 1 from invitation
         where inviter_id = $1 or organization_id = $2::uuid
         union all
         select 1 from "user"
         where id <> $1 and last_active_tenant_id = $2::uuid
         union all
         select 1 from account
         where user_id = $1
           and not (id = $4 and account_id = $1 and provider_id = 'credential')
         union all
         select 1 from session
         where user_id <> $1 and active_organization_id = $2::text
       ) as shared`,
      [
        identity.userId,
        identity.organizationId,
        identity.memberId,
        identity.accountId,
      ],
    );
    if (sharedState.rows[0]?.shared === true) {
      throw new Error("E2E fixture identity is shared with non-fixture data");
    }

    // Replacing the bounded fixture clears sessions, MFA state, and any
    // interrupted password lifecycle while retaining all non-fixture data.
    await client.query(`delete from "user" where id = $1`, [identity.userId]);
    await client.query(`delete from organization where id = $1`, [
      identity.organizationId,
    ]);

    await client.query(
      `insert into organization (id, name, slug, created_at, updated_at)
       values ($1, $2, $3, now(), now())`,
      [
        identity.organizationId,
        "NightWatch E2E Settings",
        identity.organizationSlug,
      ],
    );
    await client.query(
      `insert into "user"
         (id, name, email, email_verified, last_active_tenant_id, created_at, updated_at)
       values ($1, $2, $3, true, $4, now(), now())`,
      [
        identity.userId,
        "NightWatch E2E Settings",
        email,
        identity.organizationId,
      ],
    );
    await client.query(
      `insert into account
         (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, $3, now(), now())`,
      [identity.accountId, identity.userId, passwordHash],
    );
    await client.query(
      `insert into member
         (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now())`,
      [identity.memberId, identity.organizationId, identity.userId],
    );

    await client.query("commit");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // A broken connection is discarded when released.
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const { ownerUrl, email, password } = readE2EFixtureConfig(process.env);

  const passwordHash = await hashPassword(password);
  const database = createDatabase(ownerUrl);
  try {
    const client = await database.sql.connect();
    try {
      await resetFixture(client, email, passwordHash);
    } finally {
      client.release();
    }
  } finally {
    await database.close();
  }

  console.log("Dedicated E2E settings fixture provisioned.");
}

if (import.meta.main) {
  main().catch(() => {
    console.error("provision-e2e-fixture: failed");
    process.exit(1);
  });
}
