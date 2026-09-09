import {
  adminAc,
  defaultAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Custom organization roles for NightWatch.
 *
 * v1.6.23 default statements: organization [update, delete],
 * member [create, update, delete], invitation [create, cancel],
 * team [...], ac [...]. Viewer and auditor hold no organization-management
 * permissions; the distinction is a domain role label enforced by future
 * domain permission guards, not by org-management rights.
 *
 * Role escalation is constrained by the plugin itself: only a member whose
 * role includes `creatorRole` ("owner") can create an invitation for the
 * "owner" role (crud-invites.ts checks this independently of AC
 * statements), so an admin can never mint an owner via inviteMember.
 */
export const organizationAccess = defaultAc;

/** Full control, including organization deletion and role management. */
export const ownerRole = ownerAc;

/** Manage members, invitations and settings; cannot delete the organization. */
export const adminRole = adminAc;

/** Read-only participant: no org-management permissions. */
export const viewerRole = defaultAc.newRole({});

/** Read-only oversight: no org-management permissions. */
export const auditorRole = defaultAc.newRole({});

export const organizationRoles = {
  owner: ownerRole,
  admin: adminRole,
  viewer: viewerRole,
  auditor: auditorRole,
} as const;
