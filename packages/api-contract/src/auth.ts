import { z } from "zod";

/**
 * Browser-safe auth/onboarding contracts shared by the web app, the API
 * and the future OrgAccess slice. No server-only imports.
 */

/** Custom organization roles (Better Auth organization plugin AC roles). */
export const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "viewer",
  "auditor",
]);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/**
 * Public invitation preview for the accept-invitation page.
 * The unguessable invitation ID is the bearer capability; invalid,
 * expired, cancelled or unknown IDs all map to a safe not-found error.
 */
export const invitationResponseSchema = z.object({
  invitation: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    organizationName: z.string().min(1),
    role: organizationRoleSchema,
    expiresAt: z.string().datetime(),
  }),
});

export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

export const meContextOrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  role: organizationRoleSchema,
});

export type MeContextOrganization = z.infer<typeof meContextOrganizationSchema>;

/**
 * Authenticated context for tenant selection (served by the OrgAccess
 * slice; the schema lives here so UI and API share one contract).
 */
export const meContextResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string().email(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
  }),
  organizations: z.array(meContextOrganizationSchema),
  lastActiveTenantId: z.string().uuid().nullable(),
});

export type MeContextResponse = z.infer<typeof meContextResponseSchema>;

/** Input for switching the active organization. */
export const activeOrganizationInputSchema = z.object({
  organizationId: z.string().uuid(),
});

export type ActiveOrganizationInput = z.infer<
  typeof activeOrganizationInputSchema
>;
