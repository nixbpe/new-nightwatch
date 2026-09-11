# Implementation Plan: Personal Settings (การตั้งค่าส่วนตัว)

## Context

The personal-settings feature was designed as a clickable prototype (artifact `85f80e5a…`) and specified in `CAPABILITY-MAP.md` + five `SPEC-*.md` files (commit `0478565`, all open questions resolved). This plan turns those specs into ordered, verifiable tasks. Nothing on the server changes: every operation is an existing better-auth 1.6.23 endpoint under `/api/auth/*` (`updateUser`, `changePassword`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `twoFactor.enable/verifyTotp/generateBackupCodes/disable` — presence confirmed in `node_modules`). The work is entirely in `apps/web`.

Build order (from the map): `settings-shell` → `account-security` → `account-display` → `account-sessions` → `account-profile`. Display comes before sessions because sessions consume `formatDateTime`.

## Architecture decisions (already fixed by the specs)

- **Route family** under `AppShell`: layout route `/settings` (`settingsLoader` = today's `securitySettingsLoader`, renamed) with children `profile | security | sessions | display`; index → `replace("/settings/profile")` (same pattern as `rootLoader` in `lib/auth/loaders.ts`). Unknown children fall to the existing `*` 404.
- **One source for tabs**: `nav-config.ts`'s `/settings` leaf gets `palette?: NavLeaf[]` (4 tabs). `getNavDestinations()` appends them **after** the leaf with `group` = parent label, so ⌘K lists them grouped and `breadcrumb.ts` (`find(isLeafActive)`) still resolves to "การตั้งค่าส่วนตัว". `pages/settings/settings-tabs.ts` derives the strip from that list — the shell never imports from `pages/`.
- **Account menu** shrinks to one link (การตั้งค่าส่วนตัว → `/settings/profile`); 2FA status leaves the menu.
- **Honesty over fidelity**: anything the API doesn't return (codes remaining, enabled-on, last password change, geolocation) is omitted.
- **One new dependency**: `qrcode` (+ `@types/qrcode` dev) for the MFA QR. Everything else is `Intl`/in-house.
- **Preferences** live in `localStorage` (`nightwatch-preferences`, Zod-checked), mirroring `lib/theme.ts`.

## Dependency graph

```
settings-shell
  T1 move SecurityPage + rename loader ─┐
  T2 SettingsLayout + tabs + icons + routes ─┼─► T3a nav leaf + palette ─► T3b account menu + docs ─► Checkpoint A
                                        │
account-security (needs T2; rewriting the six old security tests is approved)
  T4 MfaCard steps 1–3 (existing calls) ─► T5 QR + copy/download/ack ─► T6 enabled state: regen + disable
  T7 PasswordCard + page composition ─────────────────────────────────► Checkpoint B
account-display (needs T2)
  T8 lib/preferences ─► T9 DisplayPage ─► Checkpoint C
account-sessions (needs T2, T8)
  T10 device-label ─► T11 SessionsPage ─► Checkpoint D
account-profile (needs T2)
  T12 ProfilePage ─► Checkpoint E (final: e2e + docs)
```

Existing code to reuse (do not reinvent): `authClient` + `authErrorMessage` (`lib/auth-client.ts`), `Alert/Field/Input/SubmitButton` (`components/ui.tsx`), `Skeleton`, `EmptyState`, `Kbd`, `usePopover`, `initialsOf`, icons (`components/shell/*`), `useTheme` (`lib/theme.ts`), `useTenant` (`lib/tenant/TenantProvider.tsx`), `ME_CONTEXT_QUERY_KEY`/`fetchMeContext` (`lib/api/me.ts`), `gateVerifiedSession`/`prefetchMeContext` (`lib/auth/loaders.ts`), test harness patterns in `AppShell.test.tsx` and `SecuritySettingsPage.test.tsx`.

## Tasks

Every task ends with `bun run validate` green and one conventional commit (`feat(web): …`, attribution trailer). Live checks use the running dev servers (`bun run dev`) and the saved Playwright session state from this session.

### Phase 0

**Task 0 — Materialise the plan files.** Create `tasks/plan.md` (this document) and `tasks/todo.md` (the task checklist). Commit `docs: add implementation plan for personal settings`. Scope XS.

### Phase 1 — settings-shell

**Task 1 — Move the security page under `pages/settings/` and rename the loader.**
`git mv` `pages/SecuritySettingsPage.tsx` → `pages/settings/SecurityPage.tsx` (component `SecurityPage`) and its test (the test's `vi.mock("../lib/api/me")` becomes `"../../lib/api/me"`); `securitySettingsLoader` → `settingsLoader` in `lib/auth/loaders.ts:120` and `loaders.test.tsx` (3 references); `router.tsx` (import + route) points `/settings/security` at the moved page. No behaviour change; docs references move to T3.

- Acceptance: the six existing security test cases pass with only path/name edits; `/settings/security` renders as before.
- Verify: `cd apps/web && bunx vitest run src/pages/settings/SecurityPage.test.tsx src/lib/auth/loaders.test.tsx`; `bun run validate`.
- Files: 2 moved, `loaders.ts`, `loaders.test.tsx`, `router.tsx`. Scope S.

**Task 2 — SettingsLayout, tab config, nested routes, placeholders.**
`pages/settings/settings-tabs.ts` (a local const typed with `NavIconName`; T3a rewires it to the nav leaf's `palette`), `icons.tsx` (register `user` and `monitor` in `NAV_ICONS` — today only grid/shield/sliders, and both the tab strip and later the palette index `NAV_ICONS[icon]`), `SettingsLayout.tsx` (kicker from `useTenant().me`, h1, subtitle with `activeOrg?.name`, `role=tablist` of `NavLink`s with underline + primary icon, `overflow-x:auto`, content `max-width:960px`), placeholders `ProfilePage/SessionsPage/DisplayPage` rendering `EmptyState("ส่วนนี้ยังไม่พร้อมใช้งาน")`, `router.tsx` layout route `/settings` + index redirect + 4 children.

- Acceptance: `/settings` → `/settings/profile`; each tab URL renders its page inside the layout; active tab `aria-selected=true`; `/settings/foo` → 404.
- Verify: new `SettingsLayout.test.tsx` (header, 4 hrefs, active tab, index redirect, security heading still present); `bun run validate`; live 1440/768/390 both themes, keyboard through tabs.
- Files: `settings-tabs.ts`, `icons.tsx`, `SettingsLayout.tsx`, `SettingsLayout.test.tsx`, 3 placeholder pages (one pattern), `router.tsx`. Scope M.

**Task 3a — Nav leaf + palette destinations.**
`nav-config.ts`: `NavLeaf.palette?: NavLeaf[]`; "ตั้งค่า" group leaf → `{ label: "การตั้งค่าส่วนตัว", icon: "sliders", path: "/settings", palette: [4 tabs] }`; `getNavDestinations()` appends palette entries after their leaf with `group` = leaf label and **strips `palette` from the spread** so destinations stay flat. `settings-tabs.ts` now derives from that leaf (replacing T2's local const). `AppShell.test.tsx`: nav link name/href (~L148), palette option count 2→6 and label (~L291-297), plus a new grouped-result + Enter-navigates case.

- Acceptance: sidebar shows one settings row (no palette rows); breadcrumb on `/settings/*` = `Org › การตั้งค่าส่วนตัว`; ⌘K lists 4 tabs under "การตั้งค่าส่วนตัว" and Enter navigates.
- Verify: `AppShell.test.tsx` + `SettingsLayout.test.tsx`; `bun run validate`; live: palette navigation to each tab.
- Files: `nav-config.ts`, `settings-tabs.ts`, `AppShell.test.tsx`. Scope S.

**Task 3b — Account menu single link + docs.**
`AccountMenu.tsx`: one link (การตั้งค่าส่วนตัว → `/settings/profile`), remove the two stubs, the security link and the 2FA text (and the now-unused `twoFactorEnabled` read). `AppShell.test.tsx`: account-menu assertions (~L186, L198-202 — the focus-on-open test now targets the single link). `docs/ref/shell-structure.md`: nav section and the four `SecuritySettingsPage` mentions.

- Acceptance: account menu has exactly one link and no 2FA text; focus lands on it when the menu opens; docs describe the new leaf and page location.
- Verify: `AppShell.test.tsx`; `bun run validate`; live: menu → settings.
- Files: `AccountMenu.tsx`, `AppShell.test.tsx`, `docs/ref/shell-structure.md`. Scope S.

**Checkpoint A (shell)** — validate green; live pass at 1440/768/390 light+dark; anonymous `/settings/sessions` → `/login?from=%2Fsettings%2Fsessions` (note: anonymous `/settings` lands at `from=%2Fsettings%2Fprofile` because React Router applies the deepest redirect — expected); human review before Phase 2.

### Phase 2 — account-security

**Task 4 — `MfaCard` with the inline three-step flow (existing calls only).**
Extract the MFA logic from `SecurityPage` into `pages/settings/MfaCard.tsx`: state `off | step1 | step2 | step3 | on`; stepper; step 1 password → `twoFactor.enable`; step 2 manual key (secret parsed from `totpURI`, grouped by 4, mono) + backup codes grid; step 3 6-digit input → `twoFactor.verifyTotp` → refetch `me/context` (keep the existing "ยืนยันรหัสแล้วแต่…" guard); wrong code stays on step 3 with `Alert` + `aria-invalid`. Cancel/back clear the draft; draft cleared on unmount.

- Acceptance: happy path off→on with the mocked calls; wrong-code path; cancel discards the secret (not in DOM).
- **Test rewrite (ask-first boundary — approved by the user 2026-09-11, "rewrite keeping the original intents"):** the six cases in today's `SecuritySettingsPage.test.tsx` assert the old copy and flow ("เปิดใช้งานยืนยันสองขั้นตอน", "ยังไม่ได้เปิดใช้งาน"/"เปิดใช้งานแล้ว", "ยืนยันรหัสแรกและเปิดใช้งาน", regen field visible immediately, resubmitting regen while codes show). They are rewritten — not dropped — into `MfaCard.test.tsx` with the same intents (enable happy path, verify error, status follows the server contract, regen once, refetch guard), plus the new copy. The `createAuthClient` mock gains `twoFactor.disable` (T6) and `changePassword` (T7).
- Verify: `MfaCard.test.tsx`; `bun run validate`.
- Files: `MfaCard.tsx`, `MfaCard.test.tsx`, `SecurityPage.tsx`, `SecurityPage.test.tsx`, `icons.tsx` (smartphone/key/copy/download). Scope M.

**Task 5 — QR, copy/download, acknowledgement gate.**
Add `qrcode` + `@types/qrcode` (`bun add` in `apps/web`, lockfile committed); import from the package root (`import QRCode from "qrcode"` — confirm after install which browser-safe entry the package exposes before reaching for `qrcode/lib/browser`); render `toDataURL(totpURI, { margin: 0, width: 168 })` into an `<img alt>` on a white tile; คัดลอก (secret) and คัดลอกทั้งหมด / ดาวน์โหลด .txt (codes) via `navigator.clipboard` / Blob; checkbox gates "ถัดไป: ยืนยันรหัสแรก" (`disabled={!ack}`).

- Acceptance: QR `<img>` present with a data URL when `totpURI` exists; next disabled until the checkbox; copy calls clipboard with the secret / codes; `bun run security:audit` still clean.
- Verify: `MfaCard.test.tsx` (mock `qrcode.toDataURL` and `navigator.clipboard`); `bun run validate`; live scan with a phone authenticator against the dev API.
- Files: `apps/web/package.json`, `bun.lock`, `MfaCard.tsx`, `MfaCard.test.tsx`. Scope S.

**Task 6 — Enabled state: regenerate codes and disable.**
`on` state rows; "สร้างชุดใหม่" inline panel → `twoFactor.generateBackupCodes({ password })` → one-time codes grid → "เรียบร้อย"; "ปิดใช้งาน" inline panel with danger `Alert` → `twoFactor.disable({ password })` → refetch `me/context` → `off`. Only one panel open at a time. Inline panels are not overlays (no focus trap), but opening one moves focus to its first field and cancelling returns focus to the button that opened it (design-system.md return-path rule).

- Acceptance: regen shows new codes once; disable requires password, flips to off on success, keeps the panel with the error on failure; the shell's account block/menu stays truthful (invalidation).
- Verify: `MfaCard.test.tsx`; `bun run validate`; live: enable → disable round trip with a real authenticator.
- Files: `MfaCard.tsx`, `MfaCard.test.tsx`. Scope S.

**Task 7 — `PasswordCard` and page composition.**
`PasswordCard.tsx`: 3 password fields with show/hide (LoginPage pattern), validation (≥ 8, match, ≠ current), `changePassword({ …, revokeOtherSessions: true })`, success/error `Alert`, reset on success. `SecurityPage.tsx`: MFA card first, password card second; `Skeleton` while `me/context` pending; existing retry block on error; drop the `<Navigate to="/login">` (loader gates).

- Acceptance: validation messages; API called with `revokeOtherSessions: true`; success resets; server error shown; page order and loading/error states.
- Verify: `PasswordCard.test.tsx`, `SecurityPage.test.tsx`; `bun run validate`; live: change password, old password rejected at login.
- Files: `PasswordCard.tsx`, `PasswordCard.test.tsx`, `SecurityPage.tsx`, `SecurityPage.test.tsx`. Scope M.

**Checkpoint B (security)** — validate green; full keyboard pass through steps 1–3, regen, disable; both themes; DB-gated e2e written (`e2e/tests/settings.spec.ts`: enable via computed TOTP, disable, password change) and run locally once; human review.

### Phase 3 — account-display

**Task 8 — `lib/preferences.ts`.**
`Preferences` type, `PREFERENCES_KEY`, Zod-guarded `readPreferences`, `usePreferences()` (`useSyncExternalStore` or state + effect like `theme.ts`), `formatDateTime(date, prefs)` using `Intl.DateTimeFormat("th-TH", { timeZone, hourCycle, … })`; defaults: browser zone → `Asia/Bangkok`, `h23`, `monday`, `th`.

- Acceptance: defaults on empty/corrupt/throwing storage; round-trip; `formatDateTime` h23 vs h12 and two zones on a fixed `Date`.
- Verify: `preferences.test.ts`; `bun run validate`.
- Files: `lib/preferences.ts`, `lib/preferences.test.ts`. Scope S.

**Task 9 — `DisplayPage`.**
Theme card bound to `useTheme()` (segmented control like `AccountMenu`'s); ภาษาและเวลา card: language select disabled with the single "ไทย" option + helper; time zone select from `Intl.supportedValuesOf("timeZone")` labelled `"<city> (GMT±h)"` sorted by offset; hour cycle; week start; save disabled until dirty; cancel restores; success `Alert`.

- Acceptance: theme toggles `data-theme`; selects reflect stored values; save writes `localStorage["nightwatch-preferences"]`; cancel restores; language disabled.
- Verify: `DisplayPage.test.tsx`; `bun run validate`; live: change zone, reload, persists; account-menu theme control stays in sync.
- Files: `DisplayPage.tsx`, `DisplayPage.test.tsx`. Scope S.

**Checkpoint C (display)** — validate green; live both themes at 390 (selects wrap to one column).

### Phase 4 — account-sessions

**Task 10 — `lib/sessions/device-label.ts`.**
In-house matcher → `{ label: "Chrome 129 · macOS", kind: "phone" | "desktop" }`; unknown → `{ label: "อุปกรณ์ที่ไม่รู้จัก", kind: "desktop" }`.

- Acceptance: table-driven test over ~8 UA strings incl. empty/garbage.
- Verify: `device-label.test.ts`; `bun run validate`. Files: 2. Scope S.

**Task 11 — `SessionsPage`.**
Query `["me","sessions"]` → `authClient.listSessions()`, prefetched by a `sessionsLoader` on the `/settings/sessions` child route (FE-12: protected data routes prefetch their primary query before route commit — same `resolveQueryClientForIdentity(...).query({ staleTime: "static" })` pattern as `prefetchMeContext` in `lib/auth/loaders.ts`; the layout loader already gates the session, so the child loader only prefetches); current = `useSession().data.session.token`; rows (icon by kind, label, badge "อุปกรณ์นี้", `ipAddress` mono or "ไม่ทราบ IP", relative `updatedAt` via `Intl.RelativeTimeFormat("th")`, absolute in `title` via `formatDateTime`); sort current first then `updatedAt` desc; per-row inline confirm (focus moves to the confirm button, back to the row's trigger on cancel) → `revokeSession({ token })`; footer "ออกจากระบบทุกอุปกรณ์อื่น" → inline confirm → `revokeOtherSessions()`; states: skeleton ×3, error+retry, info alert when only the current session remains. Tokens never rendered.

- Acceptance: current row badged/un-revokable; revoke one → API called with that token → refetch; revoke others → info alert; missing IP/UA fall back; `container.textContent` contains no token.
- Confirmed shapes: `revokeSession({ token })`, `revokeOtherSessions()` (no body), `listSessions()` items `{ id, token, userId, createdAt: Date, updatedAt: Date, expiresAt, ipAddress?, userAgent? }` — the client revives dates to `Date`, so test fixtures must use `Date` objects; the current session is `useSession().data.session.token` (present on the client type — no `id` fallback needed).
- Verify: `SessionsPage.test.tsx`; `bun run validate`; live: two browser contexts, revoke one, the other lands on `/login` on next navigation.
- Files: `SessionsPage.tsx`, `SessionsPage.test.tsx`, `lib/auth/loaders.ts` (+ test), `router.tsx` (+ `icons.tsx` laptop if missing). Scope M.

**Checkpoint D (sessions)** — validate green; live two-context revoke test; both themes at 390.

### Phase 5 — account-profile

**Task 12 — `ProfilePage`.**
Avatar (64 px, `initialsOf`, live with the field), ชื่อที่แสดง (required, trimmed, 1–100), อีเมล `readOnly` + "ยืนยันแล้ว" badge + helper (no edit control), save disabled until dirty → `authClient.updateUser({ name })` → success `Alert`, `invalidateQueries(ME_CONTEXT_QUERY_KEY)` (the shell's account block/menu read `me/context` first, so this alone refreshes them); the `useSession` atom is refreshed by the better-auth client after `/update-user` — verify in this task and, if it is not, call `authClient.getSession()` once after success; cancel restores; two-column grid ≥ 640 px.

- Acceptance: name from `me/context`; validation blocks the call; success updates initials and invalidates; error keeps the typed value; cancel restores; the test asserts `updateUser` was called with exactly `{ name }` (the better-auth body type is an open record, so TypeScript will not enforce this).
- Verify: `ProfilePage.test.tsx`; `bun run validate`; live: sidebar account block shows the new name without reload.
- Files: `ProfilePage.tsx`, `ProfilePage.test.tsx`. Scope S.

**Checkpoint E (complete)** — `bun run validate`; `bun run e2e` with DB env (`settings.spec.ts`: anonymous redirect, tab URLs, MFA round trip, password change, session revoke); live pass of all four tabs at 1440/768/390 in both themes; `docs/ref/shell-structure.md` current; remove `SecuritySettingsPage` references from docs; human review.

## Risks and mitigations

| Risk                                                                                  | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| better-auth client param names (reviewed against the pinned 1.6.23 `.d.mts`)          | Low    | Confirmed: `revokeSession({ token })`, `revokeOtherSessions()`, `changePassword({ currentPassword, newPassword, revokeOtherSessions? })`, `twoFactor.enable({ password })` → `{ totpURI, backupCodes }`, `verifyTotp({ code })`, `generateBackupCodes({ password })`, `disable({ password })`; `updateUser` body is an open record — covered by a payload assertion in T12. |
| Old security tests encode the old copy/flow                                           | Low    | T1 keeps them intact (paths only); T4–T7 rewrite them with the same intents — approved by the user (2026-09-11); case count must not drop.                                                                                                                                                                                                                                  |
| Palette entries leak into the sidebar or the breadcrumb picks a tab label             | Low    | Confirmed by review: `Sidebar` reads only `NAV_ITEMS`/`children`; breadcrumb `find` hits the `/settings` leaf first; `getNavDestinations()` strips `palette` from the spread; T3 test asserts both.                                                                                                                                                                         |
| happy-dom / TS environment for clipboard, `createObjectURL`, `Intl.supportedValuesOf` | Low    | Confirmed present: happy-dom 20.14 ships `navigator.clipboard.writeText` and `URL.createObjectURL` (spy, don't mock); web tsconfig lib `ESNext` types `Intl.supportedValuesOf`.                                                                                                                                                                                             |
| Identifying the current session on the client                                         | Low    | Confirmed: the client session type carries `token`; compare against `listSessions` tokens.                                                                                                                                                                                                                                                                                  |
| Session `ipAddress` is the proxy's address in production                              | Low    | Shown as-is with no claim; server follow-up recorded in `SPEC-account-sessions.md`.                                                                                                                                                                                                                                                                                         |
| `qrcode` bundle size / audit                                                          | Low    | Import `qrcode/lib/browser` only; `bun run security:audit` in T5.                                                                                                                                                                                                                                                                                                           |
| MFA e2e needs a TOTP generator                                                        | Low    | Compute TOTP in the test from the shown secret with Node `crypto` (RFC 6238, 30 s, SHA-1) — no new dependency.                                                                                                                                                                                                                                                              |

## Parallelisation

After Checkpoint A: Phase 2 (T4–T7), Phase 3 (T8–T9) and Phase 5 (T12) are independent and can run in parallel worktrees; Phase 4 waits for T8. All touch different files except `icons.tsx` (T4, T11 — trivial merges) and `router.tsx` (only T2).

## Verification (end to end)

1. `bun run validate` — format, codegen check (unchanged), lint, typecheck, unit tests.
2. `bun run dev`, then Playwright against `http://localhost:3000` with the saved session state: visit each tab, ⌘K → "เซสชัน", account menu → settings, breadcrumb text; screenshots at 1440/768/390 light+dark; zero horizontal overflow.
3. Security round trip with a real authenticator app (enable → verify → regenerate → disable) and a password change (old password rejected).
4. Sessions: second browser context, revoke it from the first, confirm it is signed out.
5. `bun run e2e` with `DATABASE_URL`/`BETTER_AUTH_SECRET` set runs `settings.spec.ts`.
