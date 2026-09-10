# Spec: account-sessions

Module `account-sessions` of `CAPABILITY-MAP.md`. Depends on `settings-shell` (renders inside `/settings/sessions`) and on `account-display` for `formatDateTime`. Shared conventions are in the map.

## Objective

Show every session signed in to the account and let the user end any of them — one at a time or all others at once. Data and actions come from Better Auth's session endpoints; no server change.

User: a verified member checking for unfamiliar devices. Success: the list is truthful about what the server knows (and silent about what it doesn't), the current device is unmistakable, and revoking takes effect immediately.

## Behaviour

**Data.** `authClient.listSessions()` → sessions `{ id, token, userId, expiresAt, createdAt, updatedAt, ipAddress, userAgent }`. Wrapped in a TanStack query, key `["me", "sessions"]` (personal data — no `organizationId` in the key, per FE-05 that field applies to tenant data). The current session is the one whose `token` equals `authClient.useSession().data.session.token`.

**Row** (design: icon tile, two lines, trailing action):

| Element            | Source                                                                                                                                                                                                                                  | Fallback when absent        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Icon               | phone vs laptop from the parsed user agent                                                                                                                                                                                              | laptop                      |
| Line 1             | device label `"<browser> <major> · <OS>"` from `deviceLabel(userAgent)`                                                                                                                                                                 | "อุปกรณ์ที่ไม่รู้จัก"       |
| Badge "อุปกรณ์นี้" | `token === current token`                                                                                                                                                                                                               | —                           |
| Line 2             | `ipAddress` (mono) · "ใช้งานล่าสุด <relative>" from `updatedAt` via `Intl.RelativeTimeFormat("th")`, absolute timestamp in `title` via `formatDateTime(updatedAt, preferences)` from `lib/preferences.ts` (user time zone + hour cycle) | IP: "ไม่ทราบ IP"; time: "—" |
| Action             | **ออกจากระบบ** (secondary, small) on every non-current row                                                                                                                                                                              | current row has no action   |

The prototype's city/country line is **omitted** — there is no geolocation source. Sessions sort: current first, then `updatedAt` descending.

**Actions**

- Row **ออกจากระบบ** → confirm inline (button turns into "ยืนยันออกจากระบบ / ยกเลิก" for that row) → `authClient.revokeSession({ token })` → invalidate `["me","sessions"]`. Failure → row-level error text, list unchanged.
- Footer **ออกจากระบบทุกอุปกรณ์อื่น** (danger-text quiet button, shown only when other sessions exist) → inline confirm → `authClient.revokeOtherSessions()` → invalidate. Footer copy: "อุปกรณ์นี้จะยังเข้าสู่ระบบอยู่ · อุปกรณ์อื่นต้องเข้าสู่ระบบใหม่ (และผ่าน MFA ถ้าเปิดไว้)".
- When only the current session remains: info `Alert` "ไม่มีอุปกรณ์อื่นเข้าสู่ระบบอยู่ — มีเพียงอุปกรณ์นี้เท่านั้น" and no footer button.

**States.** Loading: 3 skeleton rows. Error: `Alert` + "ลองใหม่". Empty (should not happen — the current session is always present): `EmptyState`.

**`deviceLabel(ua)` (`lib/sessions/device-label.ts`).** Small in-house matcher — no dependency — recognising Chrome/Edge/Firefox/Safari (+ major version) and macOS/Windows/iOS/Android/Linux, returning `{ label, kind: "phone" | "desktop" }`. Anything unrecognised → `{ label: "อุปกรณ์ที่ไม่รู้จัก", kind: "desktop" }`, with the raw UA available in the row's `title`. If richer detection is wanted later, a parser library is an "ask first" item.

**Security notes.** `listSessions` returns other sessions' tokens; they are used only as the revoke argument and never rendered, logged, or put in the URL. Revoking the current session is deliberately not offered here (that is "ออกจากระบบ" in the account menu).

## Project structure

```
apps/web/src/pages/settings/SessionsPage.tsx        replace placeholder
apps/web/src/pages/settings/SessionsPage.test.tsx   new
apps/web/src/lib/sessions/device-label.ts           new
apps/web/src/lib/sessions/device-label.test.ts      new
apps/web/src/components/shell/icons.tsx             add: laptop, smartphone if missing
```

## Testing

- `device-label.test.ts`: table-driven over ~8 real UA strings (Chrome/mac, Safari/iOS, Edge/Windows, Firefox/Linux, Android Chrome, empty, garbage) → expected label + kind.
- `SessionsPage.test.tsx` (mock `listSessions`, `revokeSession`, `revokeOtherSessions`, `useSession`): current row carries the badge and no action; other rows show label/IP/relative time; missing IP/UA fall back honestly; revoke one → confirm → API called with that token → list refetched; revoke others → API called → info alert appears; API error keeps the row and shows the message; tokens never appear in `container.textContent`.
- E2E (DB-gated): sign in twice in two contexts; the first context sees two sessions, revokes the other; the second context's next navigation lands on `/login`.
- Live: 390 px rows wrap without overflow; keyboard confirm/cancel; dark theme.

## Boundaries (module deltas)

- Ask first: a UA-parser dependency; any better-auth session option (e.g. IP-address header trust behind a proxy — see the follow-up below).
- Never: render or log session tokens; offer "revoke current session" here.

## Success criteria

- [ ] List reflects the server: revoking a session removes it after refetch; revoking others leaves exactly the current one.
- [ ] Current device badged and un-revokable; every other row has a confirm-then-revoke control.
- [ ] No fabricated location; missing IP/UA shown as unknown.
- [ ] Tokens absent from DOM; `bun run validate` green; tests cover the states above.

## Resolved questions (2026-09-11)

1. IP column: show `ipAddress` exactly as returned, no location claim. **Recorded server follow-up (outside this initiative, ask-first):** when production sits behind a reverse proxy, configure `advanced.ipAddress.ipAddressHeaders` in `apps/api/src/auth/index.ts` for the trusted header only, after confirming the topology — otherwise the column shows the proxy's address.
