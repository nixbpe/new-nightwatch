# Personal settings — task list (see tasks/plan.md)

## Phase 0

- [x] Task 0: materialise tasks/plan.md + tasks/todo.md and commit

## Phase 1 — settings-shell

- [x] Task 1: move SecuritySettingsPage → pages/settings/SecurityPage, rename loader
- [x] Task 2: SettingsLayout + settings-tabs + nested /settings routes + placeholders
- [x] Task 3a: nav leaf + palette entries + AppShell palette tests
- [ ] Task 3b: account-menu single link + AppShell menu tests + docs

### Checkpoint A

- [ ] validate green · live 1440/768/390 both themes · anonymous redirect · human review
- [x] Gate: approval to rewrite the six existing security test cases into MfaCard/PasswordCard tests (granted 2026-09-11)

## Phase 2 — account-security

- [ ] Task 4: MfaCard three-step flow with existing enable/verify
- [ ] Task 5: qrcode dependency, QR render, copy/download, ack gate
- [ ] Task 6: enabled state — regenerate codes, disable MFA
- [ ] Task 7: PasswordCard + SecurityPage composition/states

### Checkpoint B

- [ ] validate green · keyboard pass · real-authenticator round trip · e2e written · human review

## Phase 3 — account-display

- [ ] Task 8: lib/preferences (types, storage, hook, formatDateTime)
- [ ] Task 9: DisplayPage (theme + language/time cards)

### Checkpoint C

- [ ] validate green · persists across reload · in sync with account-menu theme

## Phase 4 — account-sessions

- [ ] Task 10: lib/sessions/device-label
- [ ] Task 11: SessionsPage (list, revoke one, revoke others, states)

### Checkpoint D

- [ ] validate green · two-context revoke test · no tokens in DOM

## Phase 5 — account-profile

- [ ] Task 12: ProfilePage (name edit, read-only email, initials avatar)

### Checkpoint E — complete

- [ ] validate green · e2e settings.spec with DB · live pass all tabs · docs current · human review
