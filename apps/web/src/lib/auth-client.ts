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

// Mirrors apps/api/src/auth/permissions.ts so organization calls are typed with viewer/auditor.
// `ac` is omitted: the plugin already falls back to `defaultAc`, and passing it triggers a TS2322 variance mismatch.
const organizationRoles = {
  owner: ownerAc,
  admin: adminAc,
  viewer: defaultAc.newRole({}),
  auditor: defaultAc.newRole({}),
} as const;

// `baseURL` falls back to the page origin when the Vite dev proxy serves `/api` same-origin.
export const authClient = createAuthClient({
  baseURL: env.VITE_API_BASE_URL || window.location.origin,
  plugins: [
    organizationClient({
      roles: organizationRoles,
    }),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        // Full navigation keeps the challenge reachable even if the login form unmounted first.
        window.location.assign("/two-factor");
      },
    }),
  ],
});

export type Session = typeof authClient.$Infer.Session;

export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

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
