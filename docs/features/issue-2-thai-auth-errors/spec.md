# Issue #2 Technical Spec

| Field | Value |
| --- | --- |
| Issue | [#2](https://github.com/nixbpe/new-nightwatch/issues/2), approved enhancement scope (no Feature or Story ID assigned) |
| Acceptance | Issue #2 checklist: (1) no English better-auth text on any `apps/web` page for a known error, (2) unknown code shows the caller's Thai `fallback`, (3) `bun run validate` passes |
| Approved by user | `/implement-issue 2` approves this spec, 2026-09-29 |
| STOP_AT | merge-ready |
| COMMIT_MODE | owned-slice |

## Contracts

- API, data/RLS, jobs: unchanged. No migration, authorization, queue, dependency or platform change.
- `authErrorMessage(error: unknown, fallback: string): string` in `apps/web/src/lib/auth-client.ts` keeps its signature. Resolution order:
  1. `error.code` is a string in the map below → mapped Thai text.
  2. `error.status === 429` (better-auth rate limiter returns only `message`, no `code`) → `มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง`.
  3. Otherwise → `fallback`. `error.message` is never returned.
- In development only (`import.meta.env.DEV`), the helper logs the original `code` and `message` with `console.warn`. Production logs nothing.
- Code map, verified against better-auth 1.6.23 (`@better-auth/core/src/error/codes.ts` `BASE_ERROR_CODES`, `better-auth/dist/plugins/two-factor/error-code.mjs` `TWO_FACTOR_ERROR_CODES`):

| `error.code` | Thai text |
| --- | --- |
| `INVALID_EMAIL_OR_PASSWORD` | อีเมลหรือรหัสผ่านไม่ถูกต้อง |
| `INVALID_PASSWORD` | รหัสผ่านไม่ถูกต้อง |
| `EMAIL_NOT_VERIFIED` | อีเมลนี้ยังไม่ได้รับการยืนยัน |
| `PASSWORD_TOO_SHORT` | รหัสผ่านสั้นเกินไป |
| `PASSWORD_TOO_LONG` | รหัสผ่านยาวเกินไป |
| `USER_ALREADY_EXISTS`, `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | อีเมลนี้มีบัญชีอยู่แล้ว |
| `INVALID_TOKEN`, `TOKEN_EXPIRED` | ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว |
| `SESSION_EXPIRED`, `SESSION_NOT_FRESH` | เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง |
| `INVALID_CODE` | รหัสยืนยันไม่ถูกต้อง |
| `INVALID_BACKUP_CODE` | รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว |
| `OTP_HAS_EXPIRED` | รหัสยืนยันหมดอายุแล้ว |
| `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` | ลองผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่ |
| `ACCOUNT_TEMPORARILY_LOCKED` | ยืนยันผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง |
| `INVALID_TWO_FACTOR_COOKIE` | การยืนยันสองขั้นตอนหมดเวลา กรุณาเข้าสู่ระบบใหม่ |

- `LoginPage.tsx`: the resend-verification branch checks `signInError.status === 403 || signInError.code === "EMAIL_NOT_VERIFIED"` instead of `/not verified/i` on the message text, because the message becomes Thai.

## Design decisions

- One map inside `auth-client.ts`; all 14 files the issue lists reach it through `authErrorMessage` or `sessions.ts`, so callers other than `LoginPage.tsx` need no edit. `SessionsPage.tsx:113` displays `sessions.ts:19`'s `Error`, which already carries helper output.
- Security (account enumeration): login keeps one generic text for `INVALID_EMAIL_OR_PASSWORD`; `USER_NOT_FOUND` is deliberately unmapped and falls back to the caller's generic text. `USER_ALREADY_EXISTS` is mapped only because signup is invitation-only for an email the invitee already holds.
- Server-authored Thai messages without a mapped code (for example `AUTH_INTERNAL_ERROR` in `apps/api/src/auth/index.ts:181`, and the invitation-required signup denial thrown at `apps/api/src/auth/index.ts:251` without a `code`) now show the caller's `fallback`; issue criterion (2) requires this. Restoring the specific invitation text needs an API `code`, which is a follow-up outside this issue (apps/api is a non-goal).
- Non-goals: `WorkspacePage.tsx:32` shows `meError` from `TenantProvider`'s API `/me` query, not better-auth; `OnboardingPage.tsx` already shows a fixed Thai text; `ErrorBoundary.tsx` and `preferences.ts` are unrelated.
- Issue names `TOO_MANY_ATTEMPTS` and `SESSION_NOT_FOUND`; neither exists in better-auth 1.6.23. The map uses the real codes above.
- Accessibility, layout, themes: unchanged; the same `Alert` elements render different text.

## Tasks

| Task | OWNER | READY | OUTCOME | SOURCE | INVARIANTS | FILES | NON-GOALS | CONTRACTS | VERIFY | PROOF | Covers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NODE-2-1 | software-engineer, integration owner | Ready | Known better-auth errors render Thai; unknown ones render the caller's fallback; login still offers resend verification | Issue #2; this spec | `authErrorMessage` signature; caller fallbacks; no raw `error.message` to users; no prod logging | `apps/web/src/lib/auth-client.ts`, a new `apps/web/src/lib/auth-client.test.ts`, `apps/web/src/pages/LoginPage.tsx`, affected `apps/web/src/**/*.test.tsx`, `e2e/tests/settings.spec.ts` if it asserts English; this spec (Technical Lead authored, owner commits it) | API, server messages, `WorkspacePage`, i18n library | Code map and resolution order above | Web lint, typecheck, unit tests; root full gates after review | Helper unit cases: mapped code, 429 without code, unknown code, message without code, non-object; LoginPage unverified branch by `code` and by 403; updated page tests assert Thai text; grep shows no remaining English better-auth assertions | Issue criteria (1), (2), (3) |
| Integrated review and CI | Technical Lead; code-reviewer | After NODE-2-1 | One PR closing #2 | Issue #2, this spec, PR template | No merge, deployment or dependent work | Reviewed diff and PR body | None | PR template | `bun run validate`, integration, `COVERAGE_GATE=1 bun run test:coverage`, `bun run build`, `bun run security`, local e2e on the head SHA; required PR CI | Gate results per SHA | Issue criterion (3) |

## Open decisions

None. The Thai wording above is a Technical Lead choice and may change in review without changing the contract.
