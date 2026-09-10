# Spec: account-profile

Module `account-profile` of `CAPABILITY-MAP.md`. Depends on `settings-shell` (renders inside `/settings/profile`). Shared conventions are in the map.

## Objective

Let a user change how they appear to others — their display name — and see the identity facts of the account (email, verification). Avatar stays initials-derived; upload is deferred by decision. Uses Better Auth's `updateUser`; no server change.

User: a verified member. Success: the new name shows in the sidebar account block, the account menu and activity immediately after saving; the email is visibly read-only and verified.

## Behaviour

Card **ข้อมูลโปรไฟล์** ("ชื่อและรูปที่แสดงให้สมาชิกองค์กรอื่นเห็นในกิจกรรมและคำเชิญ"):

- **Avatar**: 64 px circle with initials via the shell's `initialsOf(name)`, live-updating as the name field is edited. No เปลี่ยนรูป / ลบรูป buttons (deferred); helper text: "ระบบใช้อักษรย่อจากชื่อที่แสดง".
- **ชื่อที่แสดง**: text input, initial value from `me/context`; required, trimmed, 1–100 characters; error next to the field.
- **อีเมล**: read-only (`readOnly`, secondary text) with badge "ยืนยันแล้ว" (positive) — always true behind the verified gate; helper "ใช้เข้าสู่ระบบและรับการแจ้งเตือน · เปลี่ยนอีเมลยังไม่เปิดให้บริการ". No edit control of any kind (confirmed).
- Footer: **บันทึกการเปลี่ยนแปลง** (primary, disabled until the name differs from the saved value) and **ยกเลิก** (ghost, restores the saved value).
- Save → `authClient.updateUser({ name })` → on success: success `Alert` "บันทึกแล้ว", `invalidateQueries(ME_CONTEXT_QUERY_KEY)` so the sidebar/account menu re-render with the new name, and `authClient.useSession` refetch (the client session atom also carries `name`). On error → error `Alert` via `authErrorMessage`, field keeps the typed value.
- Two-column field grid at ≥ 640 px, single column below.

Omitted from the prototype: "PNG หรือ JPG ไม่เกิน 2 MB" copy and picture buttons.

## Project structure

```
apps/web/src/pages/settings/ProfilePage.tsx        replace placeholder
apps/web/src/pages/settings/ProfilePage.test.tsx   new
```

(`initialsOf` is imported from `components/shell/initials.ts`.)

## Testing

- Renders name from `me/context`, email read-only with the verified badge, avatar initials.
- Save disabled until the name changes; empty/whitespace/too-long name shows the field error and does not call `updateUser`.
- Successful save calls `updateUser({ name })`, shows the success alert, invalidates `ME_CONTEXT_QUERY_KEY` (spy on the QueryClient), and the avatar initials update.
- Server error shows the alert and keeps the typed value; ยกเลิก restores the saved name.
- Live: after saving in the browser, the sidebar account block shows the new name without reload.

## Boundaries (module deltas)

- Ask first: enabling `changeEmail` on the server; any avatar storage.
- Never: send fields other than `name` to `updateUser`.

## Success criteria

- [ ] Name change persists (visible after reload) and propagates to the shell without reload.
- [ ] Email cannot be edited and is labelled verified from real data.
- [ ] Validation and error states per above; `bun run validate` green.

## Resolved questions (2026-09-11)

1. Email change: no button, not even a disabled one.
