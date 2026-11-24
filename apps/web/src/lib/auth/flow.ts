// Link lifetimes as users read them. The values mirror apps/api/src/auth/emails.ts (verification and
// reset tokens: Better Auth default 3600 s; invitations: 48 hours); the web app cannot import the API.
export const VERIFICATION_LINK_LIFETIME = "1 ชั่วโมง";
export const RESET_LINK_LIFETIME = "1 ชั่วโมง";
export const INVITATION_LIFETIME = "48 ชั่วโมง";
// Better Auth twoFactor plugin default (trustDeviceMaxAge 30 days); apps/api/src/auth/index.ts does not override it.
export const TRUST_DEVICE_LIFETIME = "30 วัน";

export type AuthNotice = "email-verified" | "password-reset";

// Router `state` is an untrusted UI hint in this tab's history, not a security guarantee.
// Pages map each notice key to their own copy; state does not prove an auth action succeeded.
export type AuthFlowState = {
  notice?: AuthNotice;
  email?: string;
  /** The verification email was just sent (signup), so the page may say so. */
  sent?: boolean;
};

const NOTICES: readonly string[] = [
  "email-verified",
  "password-reset",
] satisfies AuthNotice[];

export function readAuthFlowState(state: unknown): AuthFlowState {
  if (typeof state !== "object" || state === null) {
    return {};
  }
  const { notice, email, sent } = state as Record<string, unknown>;
  return {
    ...(typeof notice === "string" && NOTICES.includes(notice)
      ? { notice: notice as AuthNotice }
      : {}),
    ...(typeof email === "string" && email.trim() !== ""
      ? { email: email.trim() }
      : {}),
    ...(sent === true ? { sent } : {}),
  };
}
