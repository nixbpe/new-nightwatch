/**
 * Same-origin, session-scoped carry-over for interrupted auth journeys:
 * the invitation being accepted survives email verification and login, and
 * the intended destination survives the two-factor round trip.
 */

const INVITATION_KEY = "nightwatch.pendingInvitation";
const RETURN_TO_KEY = "nightwatch.auth.returnTo";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function rememberInvitation(invitationId: string | null): void {
  if (invitationId !== null && SAFE_ID.test(invitationId)) {
    sessionStorage.setItem(INVITATION_KEY, invitationId);
  } else if (invitationId === null) {
    sessionStorage.removeItem(INVITATION_KEY);
  }
}

export function readInvitation(): string | null {
  const value = sessionStorage.getItem(INVITATION_KEY);
  return value !== null && SAFE_ID.test(value) ? value : null;
}

export function clearInvitation(): void {
  sessionStorage.removeItem(INVITATION_KEY);
}

/** Only same-origin absolute paths; anything else falls back to /workspace. */
export function rememberReturnTo(path: string): void {
  if (path.startsWith("/") && !path.startsWith("//")) {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  }
}

export function readReturnTo(): string {
  const value = sessionStorage.getItem(RETURN_TO_KEY);
  return value !== null && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/workspace";
}

export function clearReturnTo(): void {
  sessionStorage.removeItem(RETURN_TO_KEY);
}

/**
 * Where a signed-in arrival at an anonymous-only gate continues: a
 * remembered pending invitation wins over the return path. Pure read —
 * the caller decides when to consume (clearReturnTo) after commit.
 */
export function readPostAuthDestination(): string {
  return readInvitation() === null ? readReturnTo() : "/onboarding";
}
