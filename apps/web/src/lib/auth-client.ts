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

// Thai copy for known better-auth error codes. `USER_NOT_FOUND` is deliberately absent (account enumeration).
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  INVALID_PASSWORD: "รหัสผ่านไม่ถูกต้อง",
  EMAIL_NOT_VERIFIED: "อีเมลนี้ยังไม่ได้รับการยืนยัน",
  PASSWORD_TOO_SHORT: "รหัสผ่านสั้นเกินไป",
  PASSWORD_TOO_LONG: "รหัสผ่านยาวเกินไป",
  USER_ALREADY_EXISTS: "อีเมลนี้มีบัญชีอยู่แล้ว",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "อีเมลนี้มีบัญชีอยู่แล้ว",
  INVALID_TOKEN: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว",
  TOKEN_EXPIRED: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว",
  SESSION_EXPIRED: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
  SESSION_NOT_FRESH: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
  INVALID_CODE: "รหัสยืนยันไม่ถูกต้อง",
  INVALID_BACKUP_CODE: "รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว",
  OTP_HAS_EXPIRED: "รหัสยืนยันหมดอายุแล้ว",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "ลองผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่",
  ACCOUNT_TEMPORARILY_LOCKED:
    "ยืนยันผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง",
  INVALID_TWO_FACTOR_COOKIE: "การยืนยันสองขั้นตอนหมดเวลา กรุณาเข้าสู่ระบบใหม่",
};

const RATE_LIMITED_MESSAGE = "มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง";

// Resolves better-auth errors to Thai copy by `code`, then rate-limit status, else the caller's fallback.
// Never returns `error.message`: it is server English text.
export function authErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) {
    return fallback;
  }
  const { code, status, message } = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const mapped =
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(AUTH_ERROR_MESSAGES, code)
      ? AUTH_ERROR_MESSAGES[code]
      : undefined;
  const resolved =
    mapped ?? (status === 429 ? RATE_LIMITED_MESSAGE : undefined);
  if (resolved === undefined && import.meta.env.DEV) {
    console.warn("[auth] unmapped error", { code, message });
  }
  return resolved ?? fallback;
}
