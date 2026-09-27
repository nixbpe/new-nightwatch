import {
  organizationRoleSchema,
  type InvitationResponse,
} from "@nightwatch/api-contract";
import type { Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";

import { findInvitationPreview } from "../auth/invitations";

// Every unusable or cross-tenant ID gets one not-found: no enumeration.
export async function getInvitationPreview(
  database: Database,
  invitationId: string,
): Promise<InvitationResponse> {
  const record = await findInvitationPreview(database, invitationId);
  const role = record ? organizationRoleSchema.safeParse(record.role) : null;
  if (!record || !role?.success) {
    throw new AppError(
      404,
      "INVITATION_NOT_FOUND",
      "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
    );
  }
  return {
    invitation: {
      id: record.id,
      email: record.email,
      organizationName: record.organizationName,
      role: role.data,
      expiresAt: record.expiresAt.toISOString(),
    },
  };
}
