# Personal settings — task list (see tasks/plan.md)

## Phase 0

- [x] Task 0: materialise tasks/plan.md + tasks/todo.md and commit

## Phase 1 — settings-shell

- [x] Task 1: move SecuritySettingsPage → pages/settings/SecurityPage, rename loader
- [x] Task 2: SettingsLayout + settings-tabs + nested /settings routes + placeholders
- [x] Task 3a: nav leaf + palette entries + AppShell palette tests
- [x] Task 3b: account-menu single link + AppShell menu tests + docs

### Checkpoint A

- [x] validate green · live 1440/768/390 both themes · anonymous redirect (ae9c670) · human review: screenshots sent
- [x] Gate: approval to rewrite the six existing security test cases into MfaCard/PasswordCard tests (granted 2026-09-11)

## Phase 2 — account-security

- [x] Task 4: MfaCard three-step flow with existing enable/verify
- [x] Task 5: qrcode dependency, QR render, copy/download, ack gate
- [x] Task 6: enabled state — regenerate codes, disable MFA
- [x] Task 7: PasswordCard + SecurityPage composition/states

### Checkpoint B

- [x] validate green (131) · keyboard/focus pass · real-TOTP round trip · e2e settings.spec written + run (5 passed) · human review: screenshots sent (1b2dd6b)

## Phase 3 — account-display

- [x] Task 8: lib/preferences (types, storage, hook, formatDateTime)
- [x] Task 9: DisplayPage (theme + language/time cards)

### Checkpoint C

- [x] validate green (143) · persists across reload · theme in sync with account menu (shared store) · 1440/390 light+dark

## Phase 4 — account-sessions

- [x] Task 10: lib/sessions/device-label
- [x] Task 11: SessionsPage (list, revoke one, revoke others, states)

### Checkpoint D

- [x] validate green · two-device live revoke (phone signed out) · no tokens in DOM · 1440 light + 390 dark

## Phase 5 — account-profile

- [x] Task 12: ProfilePage (name edit, read-only email, initials avatar)

### Checkpoint E — complete

- [x] validate green (163) · e2e 11/11 (settings 5 + auth-entry/hello, stale login heading fixed) · live pass 4 tabs × 3 widths × 2 themes, 0 problems · docs current · human review: screenshots sent
