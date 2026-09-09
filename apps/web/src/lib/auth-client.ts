import { createAuthClient } from "better-auth/react";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import {
  adminAc,
  defaultAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

import { env } from "./env";

/**
 * Custom organization roles, mirroring apps/api/src/auth/permissions.ts.
 * Passing them here types native organization calls (inviteMember role,
 * accepted memberships) as owner/admin/viewer/auditor instead of the
 * plugin defaults (which know nothing about "viewer"/"auditor").
 * The access constants are plain data — no server-only imports.
 *
 * The `ac` option is deliberately omitted: better-auth's organization
 * plugin already falls back to `defaultAc`, and client-side
 * checkRolePermission only reads the roles map (hasPermissionFn ignores
 * options.ac). Passing it explicitly only re-triggers a generic-variance
 * mismatch (TS2322) against the widened `AccessControl` parameter.
 */
const organizationRoles = {
  owner: ownerAc,
  admin: adminAc,
  viewer: defaultAc.newRole({}),
  auditor: defaultAc.newRole({}),
} as const;

/**
 * Better Auth browser client. `basePath` defaults to `/api/auth` (mutual pin
 * better-auth@1.6.23 with AuthServer); `baseURL` is the API origin, or the
 * page origin when the Vite dev proxy serves `/api` same-origin.
 */
export const authClient = createAuthClient({
  baseURL: env.VITE_API_BASE_URL || window.location.origin,
  plugins: [
    organizationClient({
      roles: organizationRoles,
    }),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        // Full navigation keeps the challenge reachable even when the login
        // form unmounted before the server answered; the intended return path
        // is carried in sessionStorage (see lib/auth/continuation.ts).
        window.location.assign("/two-factor");
      },
    }),
  ],
});

export type Session = typeof authClient.$Infer.Session;

/** Case-insensitive email comparison for invitation/account matching. */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Display-safe message from a Better Auth client error. */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return fallback;
}
