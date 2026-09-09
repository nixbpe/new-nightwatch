import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  INTERNAL_PROVISIONING_USER_ID,
  provisionOrganization,
  type ProvisionArgs,
} from "./provision-organization";

/**
 * Real-DB concurrent provisioning regression (SEC-004).
 *
 * Environment contract (the explicit integration project supplies these;
 * missing vars throw — this test never silently skips):
 * - DATABASE_URL — runtime connection; required by the shared contract
 *   (requireIntegrationDatabaseUrls refuses otherwise).
 * - DATABASE_OWNER_URL — owner connection used for migrations and
 *   provisioning DDL; required, never falls back to the runtime role
 *   (CONFIG-001).
 * - MIGRATIONS_DIR — optional; defaults to the repo's packages/db/migrations.
 *
 * No SMTP is exercised: only the persisted provisioning core is tested
 * (the post-commit mail step stays a QA CLI smoke concern). Fixtures use
 * per-run unique slugs/emails so concurrent workers and re-runs against a
 * shared dev database never collide with QA's nw-qa-* users.
 */

// Provisioning is owner-role work: the contract requires BOTH URLs up front
// and this suite connects with the owner — never a runtime-role fallback.
const { ownerUrl: OWNER_URL } = requireIntegrationDatabaseUrls();
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

const runId = crypto.randomUUID().slice(0, 8);
const slug = (suffix: string) => `nw-orgretry-${runId}-${suffix}`;
const email = (suffix: string) => `orgretry-${runId}-${suffix}@example.test`;

const createdSlugs: string[] = [];
const createdUserIds: string[] = [];

// Inferred from the provisioning core itself; the production type stays
// unexported (tests must not drive new public API surface).
type ProvisionOutcome = Awaited<ReturnType<typeof provisionOrganization>>;

// The pool is created at module scope but connects lazily on first query;
// beforeAll applies migrations before any test touches it.
const database: Database = createDatabase(OWNER_URL);

type OrgRow = { id: string; name: string };
type InvitationRow = {
  id: string;
  role: string;
  status: string;
  inviter_id: string;
  expires_at: string;
};

async function findOrganization(aSlug: string): Promise<OrgRow | null> {
  const result = await database.sql.query<OrgRow>(
    "select id, name from organization where slug = $1",
    [aSlug],
  );
  return result.rows[0] ?? null;
}

async function liveInvitations(
  organizationId: string,
  anEmail: string,
): Promise<InvitationRow[]> {
  const result = await database.sql.query<InvitationRow>(
    `select id, role, status, inviter_id, expires_at
     from invitation
     where organization_id = $1 and lower(email) = lower($2)
       and status = 'pending' and expires_at > now()`,
    [organizationId, anEmail],
  );
  return result.rows;
}

/**
 * Drives the provisioning core the way the operator CLI does: the core
 * opens the transaction, the caller commits deliberately, and a failure
 * rolls back — including the serialized advisory-lock window.
 */
async function provision(args: ProvisionArgs): Promise<ProvisionOutcome> {
  const client = await database.sql.connect();
  try {
    const outcome = await provisionOrganization(client, args);
    await client.query("commit");
    return outcome;
  } catch (error) {
    await client.query("rollback").catch(() => {
      // Connection already broken; release discards it.
    });
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await runMigrations({ url: OWNER_URL, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  try {
    for (const aSlug of createdSlugs) {
      // Members and invitations cascade with the organization.
      await database.sql.query("delete from organization where slug = $1", [
        aSlug,
      ]);
    }
    for (const userId of createdUserIds) {
      await database.sql.query('delete from "user" where id = $1', [userId]);
    }
  } finally {
    await database.close();
  }
});

describe("provisionOrganization against real PostgreSQL", () => {
  it("serializes concurrent retries: create-or-resend yields exactly one live owner invitation", async () => {
    const args: ProvisionArgs = {
      name: "OrgRetry Concurrency",
      slug: slug("race"),
      ownerEmail: email("race"),
    };
    createdSlugs.push(args.slug);

    const [first, second] = await Promise.all([
      provision(args),
      provision(args),
    ]);

    // One transaction created, the other re-sent the same invitation.
    expect([first.resent, second.resent].filter(Boolean)).toHaveLength(1);
    expect(first.invitationId).toBe(second.invitationId);
    expect(first.alreadyMember).toBe(false);
    expect(second.alreadyMember).toBe(false);

    const org = await findOrganization(args.slug);
    expect(org).not.toBeNull();
    if (!org) return;

    const live = await liveInvitations(org.id, args.ownerEmail);
    expect(live).toHaveLength(1);
    expect(live[0]?.role).toBe("owner");
    expect(live[0]?.status).toBe("pending");
    expect(live[0]?.inviter_id).toBe(INTERNAL_PROVISIONING_USER_ID);
    expect(Date.parse(live[0]?.expires_at ?? "")).toBeGreaterThan(Date.now());

    // Two further concurrent retries while the invitation is still live
    // both re-send the same single invitation — never a second row.
    const [retryA, retryB] = await Promise.all([
      provision(args),
      provision(args),
    ]);
    expect(retryA.resent).toBe(true);
    expect(retryB.resent).toBe(true);
    expect(retryA.invitationId).toBe(first.invitationId);
    expect(retryB.invitationId).toBe(first.invitationId);
    expect(await liveInvitations(org.id, args.ownerEmail)).toHaveLength(1);
  });

  it("rejects an owner retry for a live viewer invitation without changing it", async () => {
    const args: ProvisionArgs = {
      name: "OrgRetry Role Mismatch",
      slug: slug("viewer"),
      ownerEmail: email("viewer"),
    };
    createdSlugs.push(args.slug);

    const created = await provision(args);
    const org = await findOrganization(args.slug);
    expect(org).not.toBeNull();
    if (!org) return;
    await database.sql.query(
      "update invitation set role = 'viewer' where id = $1",
      [created.invitationId],
    );

    // Read all invitation history, not only live rows: cancellation,
    // deletion, promotion and replacement must all remain observable.
    type StoredInvitation = InvitationRow & {
      organization_id: string;
      email: string;
      created_at: string;
      updated_at: string;
    };
    const invitationQuery = `select id, organization_id, email, role, status,
                                   inviter_id, expires_at, created_at, updated_at
                            from invitation where organization_id = $1 order by id`;
    const before = await database.sql.query<StoredInvitation>(invitationQuery, [
      org.id,
    ]);
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({
      id: created.invitationId,
      role: "viewer",
      status: "pending",
    });
    expect(await liveInvitations(org.id, args.ownerEmail)).toHaveLength(1);

    // A rejected core operation cannot supply an invitation to the CLI's
    // post-commit mail step; SMTP itself is exercised by the CLI smoke.
    await expect(provision(args)).rejects.toThrow();

    const after = await database.sql.query<StoredInvitation>(invitationQuery, [
      org.id,
    ]);
    expect(after.rows).toEqual(before.rows);
    const members = await database.sql.query<{ n: number }>(
      "select count(*)::int as n from member where organization_id = $1",
      [org.id],
    );
    expect(members.rows[0]?.n).toBe(0);
  });

  it("creates a fresh invitation when the only historical one is expired", async () => {
    const args: ProvisionArgs = {
      name: "OrgRetry Expiry",
      slug: slug("expiry"),
      ownerEmail: email("expiry"),
    };
    createdSlugs.push(args.slug);

    const created = await provision(args);
    expect(created.resent).toBe(false);

    // Age the pending invitation beyond its TTL (owner-role fixture
    // aging, the same mechanism QA used); the expired historical row
    // keeps status 'pending' by design and must not block a fresh one.
    await database.sql.query(
      "update invitation set expires_at = now() - interval '1 hour' where id = $1",
      [created.invitationId],
    );

    const again = await provision(args);
    expect(again.resent).toBe(false);
    expect(again.invitationId).not.toBe(created.invitationId);

    const org = await findOrganization(args.slug);
    expect(org).not.toBeNull();
    if (!org) return;
    const live = await liveInvitations(org.id, args.ownerEmail);
    expect(live).toHaveLength(1);
    expect(live[0]?.id).toBe(again.invitationId);
  });

  it("no-ops when the owner is already a member and issues no invitation", async () => {
    const args: ProvisionArgs = {
      name: "OrgRetry Member",
      slug: slug("member"),
      ownerEmail: email("member"),
    };
    createdSlugs.push(args.slug);

    // Provision first, then materialize the invited user and their
    // membership as an accepted invitation would.
    const created = await provision(args);
    const org = await findOrganization(args.slug);
    expect(org).not.toBeNull();
    if (!org) return;

    const userId = crypto.randomUUID();
    createdUserIds.push(userId);
    await database.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())`,
      [userId, "OrgRetry Member", args.ownerEmail],
    );
    await database.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now())`,
      [crypto.randomUUID(), org.id, userId],
    );

    const outcome = await provision(args);
    expect(outcome.alreadyMember).toBe(true);
    expect(outcome.invitationId).toBe("");

    // The pre-existing pending invitation is untouched; none is added.
    const live = await liveInvitations(org.id, args.ownerEmail);
    expect(live).toHaveLength(1);
    expect(live[0]?.id).toBe(created.invitationId);
  });
});
