import { createDatabase } from "@nightwatch/db";
import {
  createLogger,
  loadAuthEnv,
  loadEnv,
  type Logger,
} from "@nightwatch/shared";
import type { PoolClient } from "pg";
import { z } from "zod";

import { buildInvitationEmail } from "../auth/emails";
import { createMailer } from "../auth/mailer";

/**
 * Operator-only first-organization provisioning. Organizations are never
 * created over HTTP (`allowUserToCreateOrganization: false`); this command
 * is the single provisioning path, run against the OWNER connection
 * (migrations/provisioning only — the runtime role is non-owner
 * NOBYPASSRLS).
 *
 * It transactionally creates the organization and one pending owner
 * invitation with an unguessable ID, then sends the standard invitation
 * email via the real SMTP helper AFTER commit. A delivery failure is
 * reported loudly with a retry path: re-running the same command finds
 * the pending invitation and re-sends it — never a duplicate
 * organization, never a silent success, and the invitation URL/token is
 * never logged.
 *
 * Better Auth's `invitation.inviterId` is a hard user FK, so invitations
 * are attributed to a reserved INTERNAL provisioning principal: a real
 * `user` row with a deterministic internal id, an unverified `.invalid`
 * email, and no account, password or session — audit provenance only,
 * not a login or backdoor, and never a fabricated customer.
 */

export const INTERNAL_PROVISIONING_USER_ID = "nw-internal-provisioning";
export const INTERNAL_PROVISIONING_EMAIL =
  "provisioning@nightwatch.internal.invalid";
const INTERNAL_PROVISIONING_NAME = "NightWatch provisioning";

/** Matches the Better Auth organization plugin default invitation TTL. */
const INVITATION_TTL = "48 hours";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;

const provisionArgsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .regex(SLUG_PATTERN, "slug must be lowercase alphanumeric with hyphens"),
  ownerEmail: z.email(),
});

export type ProvisionArgs = z.infer<typeof provisionArgsSchema>;

function usage(): string {
  return [
    "Usage: provision-organization --name <organization name> \\",
    "  --slug <organization-slug> --owner-email <email>",
    "",
    "Provisions the first organization and sends a pending owner",
    "invitation via SMTP. Re-running with the same slug re-sends the",
    "pending invitation instead of creating duplicates.",
  ].join("\n");
}

export function parseProvisionArgs(argv: string[]): ProvisionArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 2) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value !== undefined) {
        flags.set(arg.slice(2), value);
        i += 1;
      }
    }
  }
  const parsed = provisionArgsSchema.safeParse({
    name: flags.get("name"),
    slug: flags.get("slug"),
    ownerEmail: flags.get("owner-email"),
  });
  if (!parsed.success) {
    console.error(usage());
    console.error(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n"),
    );
    process.exit(2);
  }
  if (parsed.data.ownerEmail.toLowerCase() === INTERNAL_PROVISIONING_EMAIL) {
    console.error(
      `Refusing to provision the internal principal's own email (${INTERNAL_PROVISIONING_EMAIL}) as an owner.`,
    );
    process.exit(2);
  }
  return parsed.data;
}

type ProvisionOutcome = {
  organizationName: string;
  ownerEmail: string;
  invitationId: string;
  resent: boolean;
  alreadyMember: boolean;
};

/**
 * Transactional provisioning core: ensures the internal principal, then
 * creates the organization and a pending owner invitation, or resolves the
 * retry path (existing pending invitation re-send / already-member no-op).
 * Returns what the post-commit email step needs; sends nothing itself.
 */
export async function provisionOrganization(
  client: PoolClient,
  args: ProvisionArgs,
): Promise<ProvisionOutcome> {
  await client.query("begin");
  try {
    // Serialize the whole create-or-resend decision per normalized slug
    // before any check: two concurrent operator retries for the same
    // existing organization must never both observe "no pending
    // invitation" and both insert. The lock is transaction-scoped
    // (pg_advisory_xact_lock) and released by this transaction's
    // commit/rollback, so a crashed process can never wedge provisioning,
    // and unrelated slugs provision in parallel. Because every later read
    // happens after the lock is held, the membership/pending checks below
    // are the serialized recheck — a concurrent commit lands before the
    // loser proceeds.
    await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
      `provision-organization:${args.slug}`,
    ]);

    // The reserved principal is the inviter for provenance only: it can
    // never authenticate (no account/password) and its .invalid email can
    // never receive mail.
    await client.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, false, now(), now())
       on conflict (id) do nothing`,
      [
        INTERNAL_PROVISIONING_USER_ID,
        INTERNAL_PROVISIONING_NAME,
        INTERNAL_PROVISIONING_EMAIL,
      ],
    );

    const existing = await client.query<{ id: string; name: string }>(
      `select id, name from organization where slug = $1`,
      [args.slug],
    );
    const organization = existing.rows[0];
    if (organization) {
      const membership = await client.query(
        `select m.id
         from member m
         join "user" u on u.id = m.user_id
         where m.organization_id = $1 and lower(u.email) = lower($2)`,
        [organization.id, args.ownerEmail],
      );
      if (membership.rows.length > 0) {
        return {
          organizationName: organization.name,
          ownerEmail: args.ownerEmail,
          invitationId: "",
          resent: false,
          alreadyMember: true,
        };
      }
      const pending = await client.query<{ id: string; role: string }>(
        `select id, role from invitation
         where organization_id = $1 and lower(email) = lower($2)
           and status = 'pending' and expires_at > now()
         order by created_at desc
         limit 1`,
        [organization.id, args.ownerEmail],
      );
      if (pending.rows[0]) {
        if (pending.rows[0].role !== "owner") {
          throw new Error(
            "A pending invitation exists with a non-owner role; owner provisioning cannot reuse it.",
          );
        }
        // Retry path: the invitation already exists; only re-send mail.
        return {
          organizationName: organization.name,
          ownerEmail: args.ownerEmail,
          invitationId: pending.rows[0].id,
          resent: true,
          alreadyMember: false,
        };
      }
      const invitationId = crypto.randomUUID();
      await client.query(
        `insert into invitation
           (id, organization_id, email, role, status, inviter_id, expires_at,
            created_at, updated_at)
         values ($1, $2, $3, 'owner', 'pending', $4, now() + $5::interval,
                 now(), now())`,
        [
          invitationId,
          organization.id,
          args.ownerEmail,
          INTERNAL_PROVISIONING_USER_ID,
          INVITATION_TTL,
        ],
      );
      return {
        organizationName: organization.name,
        ownerEmail: args.ownerEmail,
        invitationId,
        resent: false,
        alreadyMember: false,
      };
    }

    const organizationId = crypto.randomUUID();
    const invitationId = crypto.randomUUID();
    await client.query(
      `insert into organization (id, name, slug, created_at, updated_at)
       values ($1, $2, $3, now(), now())`,
      [organizationId, args.name, args.slug],
    );
    await client.query(
      `insert into invitation
         (id, organization_id, email, role, status, inviter_id, expires_at,
          created_at, updated_at)
       values ($1, $2, $3, 'owner', 'pending', $4, now() + $5::interval,
               now(), now())`,
      [
        invitationId,
        organizationId,
        args.ownerEmail,
        INTERNAL_PROVISIONING_USER_ID,
        INVITATION_TTL,
      ],
    );
    return {
      organizationName: args.name,
      ownerEmail: args.ownerEmail,
      invitationId,
      resent: false,
      alreadyMember: false,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection broken; release discards it.
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseProvisionArgs(process.argv.slice(2));
  const env = loadEnv();
  const authEnv = loadAuthEnv();
  const logger: Logger = createLogger({
    level: env.LOG_LEVEL,
    name: "nightwatch-provisioning",
  });

  // Provisioning uses the owner connection; it is not available to the
  // runtime role and is never used by request handling.
  const url = authEnv.DATABASE_OWNER_URL ?? authEnv.DATABASE_URL;
  const database = createDatabase(url);
  try {
    const client = await database.sql.connect();
    let outcome: ProvisionOutcome;
    try {
      outcome = await provisionOrganization(client, args);
      if (outcome.alreadyMember) {
        await client.query("commit");
        console.log(
          `${args.ownerEmail} is already a member of organization "${args.slug}"; nothing to do.`,
        );
        return;
      }
      await client.query("commit");
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Connection broken; release discards it.
      }
      throw error;
    } finally {
      client.release();
    }

    // Post-commit delivery with real failure semantics. A failure here is
    // visible and retryable: the pending invitation persists, and
    // re-running this command re-sends it.
    const mailer = createMailer(authEnv, logger);
    const mail = buildInvitationEmail(authEnv, {
      organizationName: outcome.organizationName,
      invitationId: outcome.invitationId,
    });
    try {
      await mailer.verify();
      await mailer.send({ ...mail, to: outcome.ownerEmail });
    } catch (error) {
      logger.error(
        { err: error, slug: args.slug },
        "provisioning invitation email failed; re-run the same command to resend",
      );
      console.error(
        `Organization "${args.slug}" is provisioned, but the invitation email ` +
          `could not be delivered. Re-run the same command to resend the pending invitation.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      outcome.resent
        ? `Re-sent the pending owner invitation for organization "${args.slug}" to ${outcome.ownerEmail}.`
        : `Provisioned organization "${args.slug}" and sent the owner invitation to ${outcome.ownerEmail}.`,
    );
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("provision-organization: failed", error);
    process.exit(1);
  });
}
