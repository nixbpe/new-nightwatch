import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

// Raw SQL keeps these unit-testable against the narrow `sql` seam.

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

// One message for every failure so the response never reveals the reason.
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

export async function findInvitationPreview(
  database: Database,
  invitationId: string,
): Promise<InvitationRecord | null> {
  return lookup(database, invitationId);
}
