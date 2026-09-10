# Spec: account-display

Module `account-display` of `CAPABILITY-MAP.md`. Depends on `settings-shell` (renders inside `/settings/display`). Shared conventions are in the map.

## Objective

One place for how the app looks and formats things on this device: theme (already implemented in the account menu, surfaced here too) and language / time zone / time format / week start. By decision, all of it is stored in the browser only — no server persistence, no migration.

User: a verified member. Success: choices apply immediately, survive reload on the same browser, and the page is honest that they are per-device.

## Behaviour

Card **ธีม** ("มีผลทันทีกับอุปกรณ์นี้ และจำไว้สำหรับครั้งถัดไป"): the same segmented control as the account menu — สว่าง / มืด / ตามระบบ — bound to `useTheme()` from `lib/theme.ts`. Applies instantly; the account menu's control and this one stay in sync because they share the hook and `localStorage` key.

Card **ภาษาและเวลา** ("ใช้กับข้อความ วันที่ และเวลาที่แสดงทั่วทั้งแอป · เก็บไว้ในเบราว์เซอร์นี้เท่านั้น"):

| Field            | Control | Options / default                                                                                                                          | Notes                                                                                                                                          |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ภาษา             | select  | `th` only; default `th`                                                                                                                    | Single option today; helper "ภาษาอังกฤษจะเพิ่มในภายหลัง". Not a fake choice — the control is rendered disabled until a second language exists. |
| โซนเวลา          | select  | IANA zones from `Intl.supportedValuesOf("timeZone")`, label `"<city> (GMT±h)"`; default the browser's zone, falling back to `Asia/Bangkok` | Sorted by offset then name.                                                                                                                    |
| รูปแบบเวลา       | select  | `24 ชั่วโมง (14:05)` = `h23`, `12 ชั่วโมง (2:05 PM)` = `h12`; default `h23`                                                                |                                                                                                                                                |
| วันแรกของสัปดาห์ | select  | จันทร์ / อาทิตย์; default จันทร์                                                                                                           |                                                                                                                                                |

Footer: **บันทึกการเปลี่ยนแปลง** (primary, disabled until dirty) writes the draft to storage; **ยกเลิก** restores the stored values. Success `Alert` "บันทึกแล้ว — ใช้กับเบราว์เซอร์นี้".

**Storage & hook** (`lib/preferences.ts`):

```ts
export type Preferences = {
  language: "th";
  timeZone: string; // IANA
  hourCycle: "h23" | "h12";
  weekStart: "monday" | "sunday";
};
export const PREFERENCES_KEY = "nightwatch-preferences";
export function usePreferences(): {
  preferences: Preferences;
  save(next: Preferences): void;
};
export function formatDateTime(date: Date, p: Preferences): string; // Intl.DateTimeFormat("th-TH", { timeZone, hourCycle, … })
```

Reads are guarded (`try/catch`, schema-checked with a tiny Zod object so a corrupt value falls back to defaults); writes swallow storage errors like `theme.ts` does. `formatDateTime` is the consumer-facing helper; its first consumer is `account-sessions` (absolute "ใช้งานล่าสุด" in the row's `title`), which is why this module is built before sessions. Later features (reports, activity) adopt it the same way.

## Project structure

```
apps/web/src/pages/settings/DisplayPage.tsx        replace placeholder
apps/web/src/pages/settings/DisplayPage.test.tsx   new
apps/web/src/lib/preferences.ts                     new
apps/web/src/lib/preferences.test.ts                new
```

## Testing

- `preferences.test.ts`: defaults when storage empty / corrupt / throws; round-trip save → read; `formatDateTime` for `h23` vs `h12` and two time zones (fixed `Date`).
- `DisplayPage.test.tsx`: theme control toggles `data-theme` on `<html>` (reuse the `theme.ts` behaviour test approach); selects show stored values; save disabled until dirty; save writes `localStorage["nightwatch-preferences"]` and shows the alert; cancel restores; language select is disabled with one option.
- Live: change time zone, reload — value persists; theme change reflects in the sidebar control too.

## Boundaries (module deltas)

- Ask first: adding a time-zone list dependency (the spec uses `Intl.supportedValuesOf`, available in all supported browsers); any move to server-side persistence.
- Never: present language as selectable while only Thai exists.

## Success criteria

- [ ] Theme control here and in the account menu are always in sync.
- [ ] Time zone / format / week start persist per browser and survive reload; corrupt storage falls back to defaults without a crash.
- [ ] `formatDateTime` covered by tests and exported for consumers.
- [ ] Page states honest about per-device scope; `bun run validate` green.

## Resolved questions (2026-09-11)

1. Sessions adopt `formatDateTime` immediately; build order is `account-display` → `account-sessions`.
