# Spec: account-security

Module `account-security` of `CAPABILITY-MAP.md`. Depends on `settings-shell` (renders inside `/settings/security`). Shared conventions are in the map.

## Objective

Turn today's single-purpose security page into the design's two cards: **ยืนยันสองขั้นตอน (MFA)** — the existing enable → verify → backup-codes flow presented as the inline three-step card, plus regenerate-codes and a new **disable** — and **รหัสผ่าน** — change password with other devices signed out. Everything runs on Better Auth endpoints that already exist; no server change.

User: a verified member securing their own account. Success: a user can enable MFA end to end without leaving the card, recover/regenerate codes, disable MFA with password confirmation, and change their password — each with honest state and errors.

## Behaviour

### MFA card (`MfaCard.tsx`)

State machine mirrors the prototype: `off → step1 → step2 → step3 → on`, plus `on` sub-states `regen: form | codes` and `disable: open`.

| State                | What the user sees                                                                                                                                                                                                                                                                                                                                                                                 | Calls                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **off**              | Badge "ปิดอยู่"; row "แอปยืนยันตัวตน" with primary button **เปิดใช้งาน**                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                             |
| **step 1**           | Stepper (1 active); field รหัสผ่านปัจจุบัน; **ถัดไป: สแกนคิวอาร์โค้ด** / ยกเลิก                                                                                                                                                                                                                                                                                                                    | `authClient.twoFactor.enable({ password })` → `{ totpURI, backupCodes }` held in component state                                                                                                              |
| **step 2**           | Stepper (2 active); `totpURI` shown as QR **and** as manual key (secret parsed from the URI, grouped in 4s, `font-mono`); backup codes grid (2 cols, mono) with คัดลอกทั้งหมด / ดาวน์โหลด .txt; checkbox "ฉันบันทึกรหัสกู้คืนไว้ในที่ปลอดภัยแล้ว…" gates **ถัดไป: ยืนยันรหัสแรก**; ย้อนกลับ returns to step 1 (re-enter password; a new `enable` call issues a new secret — say so in helper text) | copy → `navigator.clipboard.writeText`; download → Blob `.txt`                                                                                                                                                |
| **step 3**           | Stepper (3 active); 6-digit numeric input (`inputmode=numeric`, `autocomplete=one-time-code`, mono, letter-spaced); **ยืนยันและเปิดใช้งาน**; wrong code → error `Alert` + `aria-invalid` on the field, stay on step 3                                                                                                                                                                              | `authClient.twoFactor.verifyTotp({ code })` then `refetch me/context`; if `twoFactorEnabled` is still false after success show the existing "ยืนยันรหัสแล้วแต่ยังไม่สามารถยืนยันสถานะกับเซิร์ฟเวอร์ได้" alert |
| **on**               | Badge "เปิดอยู่"; success alert on the transition only; rows: "แอปยืนยันตัวตน (TOTP)" + **ปิดใช้งาน** (quiet danger-text button); "รหัสกู้คืน" + **สร้างชุดใหม่**                                                                                                                                                                                                                                  | —                                                                                                                                                                                                             |
| **on · regen form**  | Inline panel: field รหัสผ่านปัจจุบัน; **สร้างรหัสกู้คืนใหม่** / ยกเลิก                                                                                                                                                                                                                                                                                                                             | `authClient.twoFactor.generateBackupCodes({ password })`                                                                                                                                                      |
| **on · regen codes** | New codes grid + copy/download + "แสดงเพียงครั้งนี้ · ชุดเดิมใช้ไม่ได้แล้ว"; **เรียบร้อย** closes                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                             |
| **on · disable**     | Inline panel with danger alert ("การปิด MFA ทำให้บัญชีเข้าสู่ระบบได้ด้วยรหัสผ่านอย่างเดียว และรหัสกู้คืนทุกชุดจะใช้ไม่ได้อีก"); field ยืนยันรหัสผ่านปัจจุบัน; **ปิดใช้งานยืนยันสองขั้นตอน** (danger fill) / ยกเลิก                                                                                                                                                                                 | `authClient.twoFactor.disable({ password })` then refetch `me/context` → state `off`                                                                                                                          |

Honesty constraints (design-system: never present unknown data as known):

- Better Auth does not expose "codes remaining", "enabled on <date>" or "last used" — those lines from the prototype are **omitted**, not faked.
- The QR is rendered from the real `totpURI` with the approved `qrcode` package (`toDataURL(totpURI, { margin: 0, width: 168 })` → `<img alt="คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน">` on a white tile in both themes); the manual key stays beside it. Nothing else may read the URI.
- Draft secret / codes live only in component state and are cleared on cancel, on success, and on unmount.

Errors map through `authErrorMessage` with the Thai fallbacks already used by `SecuritySettingsPage` (kept verbatim). Wrong password on enable/regenerate/disable is a field-level error on the password input.

### Password card (`PasswordCard.tsx`)

- Fields: รหัสผ่านปัจจุบัน, รหัสผ่านใหม่, ยืนยันรหัสผ่านใหม่ (each with the existing show/hide toggle pattern from `LoginPage`).
- Validation: new ≥ 8 characters (confirmed: matches reset/signup and the better-auth default; the prototype's "12" copy is corrected to 8), confirm matches, new ≠ current; errors next to the field.
- Submit **เปลี่ยนรหัสผ่าน** (secondary style — MFA's enable is the card group's one dominant action): `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`. Success → success `Alert` "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นทุกเครื่องถูกออกจากระบบ", form reset. Wrong current password → error on that field.
- Footer note (design): "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นทุกเครื่องจะถูกออกจากระบบ".
- "เปลี่ยนล่าสุด <date>" from the prototype is omitted (not exposed by the API).

### Page composition (`SecurityPage.tsx`)

MFA card first, password card second (design order). Loading: `Skeleton` rows while `me/context` is pending; error: the existing retry block. The `<Navigate to="/login">` fallback in the current page is dropped — `settingsLoader` already gates.

## Project structure

```
apps/web/src/pages/settings/SecurityPage.tsx        rewrite (composition)
apps/web/src/pages/settings/MfaCard.tsx             new (extracted + extended from SecuritySettingsPage)
apps/web/src/pages/settings/PasswordCard.tsx        new
apps/web/src/pages/settings/SecurityPage.test.tsx   extend existing tests
apps/web/src/pages/settings/MfaCard.test.tsx        new
apps/web/src/pages/settings/PasswordCard.test.tsx   new
apps/web/src/components/shell/icons.tsx             add: smartphone, key, refresh, copy, download, check-circle if missing
apps/web/package.json                               add dependency qrcode + devDependency @types/qrcode (approved)
```

## Testing

Unit (mock `twoFactor.{enable,verifyTotp,generateBackupCodes,disable}`, `changePassword`, `fetchMeContext`):

- Enable happy path: off → step1 → (enable resolves) step2 shows the secret from the URI and 8 codes → checkbox gates next → step3 → `verifyTotp` called with the typed code → `me/context` refetched → badge "เปิดอยู่" + success alert.
- Wrong code keeps step 3, shows the alert, marks the input invalid; a second correct code succeeds.
- Cancel at step 2 discards the draft (secret no longer in the DOM).
- Regenerate: password → codes shown once → "เรียบร้อย" hides them.
- Disable: requires password; on success badge is "ปิดอยู่" and `twoFactor.disable` was called with the password; on `error` the panel stays open with the message.
- Password: client validation messages; `changePassword` called with `revokeOtherSessions: true`; success resets fields; server error shown.
- Existing `SecuritySettingsPage.test.tsx` cases are preserved (renamed) — none deleted.

E2E (`settings.spec.ts`, DB-gated): sign in as a seeded user → enable MFA with a TOTP generated from the shown secret (test computes the code) → disable → password change → old password fails, new succeeds.

Live: full keyboard pass through the three steps; screen-reader labels on every field; dark theme QR stays on a white tile.

## Boundaries (module deltas)

- Ask first: any dependency beyond `qrcode`; changing the 8-character policy; any change to the better-auth `twoFactor` options.
- Never: log or persist `totpURI`, secrets or backup codes (not even in test snapshots); never keep the enrolment draft across route changes.

## Success criteria

- [ ] MFA can be enabled, codes regenerated, and MFA disabled entirely within the card; shell account menu shows the correct "2FA เปิดอยู่ / ปิดอยู่" after each change (via `me/context` invalidation).
- [ ] Password change works with `revokeOtherSessions: true`; wrong current password is a field error.
- [ ] No invented numbers or dates anywhere on the page.
- [ ] Steps, alerts and buttons keyboard-operable with visible focus; `aria-invalid` + `aria-describedby` on invalid fields.
- [ ] Unit tests cover every row of the state table; `bun run validate` green.

## Resolved questions (2026-09-11)

1. QR rendering: `qrcode` approved; step 2 shows a real QR plus the manual key.
2. Password minimum stays 8; the design copy is corrected.
