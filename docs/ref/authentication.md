# Authentication behavior

This reference preserves the browser error and session decisions from issue #2 and issue #65. Admission, MFA and organization access rules remain in the Feature contracts and [Architecture Rules](../architecture.md#sign-in-and-choosing-an-organization).

## Session policy

- `/login` sends only `email` and `password` through `authClient.signIn.email`. It has no remember-device checkbox, mockup notice or issue #65 link.
- Better Auth `1.6.23` uses its default 7-day session and default refresh behavior. The policy does not impose a fixed maximum age measured from login.
- Omitting `rememberMe` keeps the library default `true`. Closing the browser does not introduce a logout requirement.
- The `trustDevice` checkbox on `/two-factor` is separate. TOTP, recovery codes and the default 30-day trusted-device lifetime remain unchanged.
- The invitation guidance, password-reset link, validation, pending state and redirect behavior remain part of the login page.

The session decision was approved on 2026-10-03 and delivered in `3ff483e` for issue #65. The API does not override `session.expiresIn` for this decision.

## Browser auth errors

`authErrorMessage(error: unknown, fallback: string): string` in `apps/web/src/lib/auth-client.ts` resolves Better Auth errors in this order.

1. A known string `error.code` returns the mapped Thai text.
2. Otherwise, `error.status === 429` returns `มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง`.
3. Otherwise, the helper returns the caller's Thai `fallback`.

The helper never returns `error.message`. The code map and Thai wording live in `auth-client.ts`; `auth-client.test.ts` covers the resolution order and fallback. Unmapped errors log their original `code` and `message` through `console.warn` only in development. Production logs nothing from this helper.

Login offers verification resend when `signInError.status === 403` or `signInError.code === "EMAIL_NOT_VERIFIED"`. The decision does not depend on message text.

## Account enumeration and fallback

- Login keeps one generic message for `INVALID_EMAIL_OR_PASSWORD`.
- `USER_NOT_FOUND` remains unmapped and uses the caller's generic fallback to avoid account enumeration.
- `USER_ALREADY_EXISTS` is mapped because signup is invitation-only for an email the invitee already holds.
- An unmapped server-authored Thai message also uses the caller's fallback. A specific message needs a mapped API code.
- `TOO_MANY_ATTEMPTS` and `SESSION_NOT_FOUND` are not Better Auth `1.6.23` codes. The map uses the library's actual codes.

Issue #2 delivered this mapping in `e4b46dc`. These rules apply to Better Auth errors, not unrelated first-party API errors.
