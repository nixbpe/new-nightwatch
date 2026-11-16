# Authentication behavior

This reference preserves the browser error and session decisions from issue #2 and issue #65. Admission, MFA and organization access rules remain in the Feature contracts and [Architecture Rules](../architecture.md#sign-in-and-choosing-an-organization).

## Session policy

- `/login` accepts email and password. It has no remember-device checkbox.
- Session expiry and refresh follow Better Auth defaults. The policy does not impose a fixed maximum age measured from login.
- Login uses persistent sessions by default. Closing the browser does not introduce a logout requirement.
- The `trustDevice` checkbox on `/two-factor` is separate from session persistence. Trusted-device expiry follows Better Auth defaults. TOTP and recovery codes remain available.
- The invitation guidance, password-reset link, validation, pending state and redirect behavior remain part of the login page.

The session decision was approved on 2026-10-03 and delivered in `3ff483e` for issue #65.

## Browser auth errors

The browser resolves Better Auth errors in this order.

1. If `error.code` is a string with a mapping, the browser displays the mapped Thai text.
2. Otherwise, `error.status === 429` selects `มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง`.
3. Otherwise, the browser displays the caller's Thai `fallback`.

The browser never displays `error.message` from this mapping. Unmapped errors log their original `code` and `message` only in development. This mapping produces no logs in production.

The [sign-in code index](../features.md#เข้าสู่ระบบและเลือกองค์กร) locates the browser error mapping and its focused tests.

Login offers verification resend when `signInError.status === 403` or `signInError.code === "EMAIL_NOT_VERIFIED"`. The decision does not depend on message text.

## Account enumeration and fallback

- Login keeps one generic message for `INVALID_EMAIL_OR_PASSWORD`.
- `USER_NOT_FOUND` remains unmapped and uses the caller's generic fallback to avoid account enumeration.
- `USER_ALREADY_EXISTS` is mapped because signup is invitation-only for an email the invitee already holds.
- An unmapped server-authored Thai message also uses the caller's fallback. A specific message needs a mapped API code.
- Mappings use codes from Better Auth core and the plugins enabled by the application.

Issue #2 delivered this mapping in `e4b46dc`. These rules apply to Better Auth errors, not unrelated first-party API errors.
