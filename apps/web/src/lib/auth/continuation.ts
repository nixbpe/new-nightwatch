/**
 * Same-origin, session-scoped carry-over for interrupted auth journeys:
 * the invitation being accepted survives email verification and login, and
 * the intended destination survives the two-factor round trip.
 */

const INVITATION_KEY = "nightwatch.pendingInvitation";
const RETURN_TO_KEY = "nightwatch.auth.returnTo";
const DEFAULT_RETURN_TO = "/workspace";
const SAME_ORIGIN_BASE = new URL("https://nightwatch.invalid");

const ENCODED_CONTROL_OR_BACKSLASH =
  /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f|8[0-9a-f]|9[0-9a-f])/i;

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

/**
 * Canonicalizes a same-origin absolute path. The fixed base makes URL
 * parsing independent of runtime globals and exposes protocol-relative or
 * slash/backslash inputs whose canonical origin would escape the app.
 */
export function normalizeReturnTo(path: string | null): string {
  if (path === null || !path.startsWith("/")) {
    return DEFAULT_RETURN_TO;
  }
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code === 92 || code <= 31 || (code >= 127 && code <= 159)) {
      return DEFAULT_RETURN_TO;
    }
  }
  if (ENCODED_CONTROL_OR_BACKSLASH.test(path)) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const url = new URL(path, SAME_ORIGIN_BASE);
    return url.origin === SAME_ORIGIN_BASE.origin
      ? url.pathname + url.search + url.hash
      : DEFAULT_RETURN_TO;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

export function rememberReturnTo(path: string): void {
  sessionStorage.setItem(RETURN_TO_KEY, normalizeReturnTo(path));
}

export function readReturnTo(): string {
  const storedValue = sessionStorage.getItem(RETURN_TO_KEY);
  const value = normalizeReturnTo(storedValue);
  if (storedValue !== null) {
    sessionStorage.setItem(RETURN_TO_KEY, value);
  }
  return value;
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
