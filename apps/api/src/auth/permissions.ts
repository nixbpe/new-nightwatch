import {
  adminAc,
  defaultAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// The plugin lets only owners invite an owner, so an admin cannot mint one.
export const organizationAccess = defaultAc;

export const ownerRole = ownerAc;

export const adminRole = adminAc;

// Viewer and auditor differ only as domain labels; neither manages the org.
export const viewerRole = defaultAc.newRole({});

export const auditorRole = defaultAc.newRole({});

export const organizationRoles = {
  owner: ownerRole,
  admin: adminRole,
  viewer: viewerRole,
  auditor: auditorRole,
} as const;
