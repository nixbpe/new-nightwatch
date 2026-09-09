import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

/**
 * Invitation boundary: the single place that decides whether an invitation
 * admits a signup or renders a public preview. Raw SQL is intentional —
 * the email match must be case-insensitive and the queries stay unit
 * testable against a narrow `sql` seam without a live database.
 */

export type InvitationRecord = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  organizationName: string;
};

const INVITATION_SELECT = `
  select i.id,
         i.email,
         i.role,
         i.expires_at as "expiresAt",
         o.name as "organizationName"
  from invitation i
  join organization o on o.id = i.organization_id
`;

function lookup(
  database: Database,
  invitationId: string,
  email?: string,
): Promise<InvitationRecord | null> {
  let text = `${INVITATION_SELECT} where i.id = $1 and i.status = 'pending' and i.expires_at > now()`;
  const params: string[] = [invitationId];
  if (email !== undefined) {
    params.push(email);
    text += " and lower(i.email) = lower($2)";
  }
  return database.sql
    .query<InvitationRecord>(text, params)
    .then((result) => result.rows[0] ?? null);
}

/**
 * Server-side gate for the raw `POST /api/auth/sign-up/email` endpoint:
 * signup must present a pending, unexpired invitation whose email matches
 * the signup email (case-insensitively). Any violation fails closed with
 * one safe message — the response never distinguishes missing, expired,
 * cancelled, replayed or email-mismatched invitations, and leaks nothing
 * about other tenants.
 */
export async function assertInvitationAdmitsSignup(
  database: Database,
  input: { invitationId: string | null; email: string },
): Promise<void> {
  const invitation =
    input.invitationId === null
      ? null
      : await lookup(database, input.invitationId, input.email);
  if (!invitation) {
    throw new AppError(
      403,
      "INVITATION_REQUIRED",
      "การสมัครสมาชิกต้องได้รับคำเชิญที่ยังใช้งานได้ และต้องตรงกับอีเมลที่ได้รับเชิญ",
    );
  }
}

/**
 * Public preview for the accept-invitation page. Returns null for unknown,
 * cancelled, accepted or expired invitations so the route can answer a
 * safe not-found regardless of the underlying reason.
 */
export async function findInvitationPreview(
  database: Database,
  invitationId: string,
): Promise<InvitationRecord | null> {
  return lookup(database, invitationId);
}
