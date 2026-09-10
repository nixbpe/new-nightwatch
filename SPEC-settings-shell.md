# Spec: settings-shell

Module `settings-shell` of `CAPABILITY-MAP.md` (Personal Settings). Shared conventions — tech stack, commands, code style, testing strategy, boundaries — are in the map and apply here unchanged; this file adds only what is specific to the module.

## Objective

Give the personal-settings tabs a home inside the existing AppShell: a `/settings/*` route family with a page header, a horizontal tab strip (per the revised design — the left sub-nav was dropped for eating too much width), and the nav / breadcrumb / account-menu wiring that gets a signed-in user there. Ships with placeholder tab bodies so the four account modules can land independently.

User: any signed-in, email-verified member. Success: from anywhere in the app a user reaches each settings tab in ≤ 2 clicks, the URL identifies the tab, and reloading keeps them on it.

## Behaviour

**Routes** (nested under `AppShell`, all gated by one loader):

| Path                 | Element        | Notes                                                    |
| -------------------- | -------------- | -------------------------------------------------------- |
| `/settings`          | index          | `replace("/settings/profile")`                           |
| `/settings/profile`  | `ProfilePage`  | placeholder until `account-profile`                      |
| `/settings/security` | `SecurityPage` | today's `SecuritySettingsPage`, unchanged in this module |
| `/settings/sessions` | `SessionsPage` | placeholder until `account-sessions`                     |
| `/settings/display`  | `DisplayPage`  | placeholder until `account-display`                      |

- One loader, `settingsLoader`, on the `/settings` layout route: the existing `securitySettingsLoader` renamed (same verified-session gate + `me/context` prefetch). Child routes add no loaders.
- Unknown child (`/settings/foo`) falls through to the app's `*` NotFound route.
- Placeholder bodies are a real `EmptyState` ("ส่วนนี้ยังไม่พร้อมใช้งาน") — not fake content.

**Layout** (`SettingsLayout.tsx`), matching the design:

- Kicker `"<ชื่อผู้ใช้> · บัญชีของฉัน"` (name from `me/context`, skeleton while pending), `<h1>การตั้งค่าส่วนตัว</h1>`, subtitle `ใช้กับบัญชีของคุณในทุกองค์กร — ไม่ใช่การตั้งค่าขององค์กร <ชื่อองค์กร>` (org name from `useTenant().activeOrg`; the clause after the dash is omitted when there is no active org).
- Tab strip: `role="tablist"` of `NavLink`s (`role="tab"`, `aria-selected`), 40 px tall, 2 px primary underline + primary icon on the active tab, hairline bottom border, `overflow-x: auto` on narrow screens. Icons: user / shield / monitor / sliders from `icons.tsx`.
- Content column `max-width: 960px`, left-aligned, 24 px below the tabs.
- Tab config in `settings-tabs.ts`: `{ key, label, icon, path }[]` derived from the nav leaf's `palette` entries — one source for the strip, the palette and the tests.

**Navigation wiring**

- `nav-config.ts`: the "ตั้งค่า" group's leaf becomes `{ label: "การตั้งค่าส่วนตัว", icon: "sliders", path: "/settings", palette: [...] }` (prefix matching already marks it active on every tab and yields the breadcrumb `Org › การตั้งค่าส่วนตัว`, as in the design). `NavLeaf` gains an optional `palette?: NavLeaf[]` — sub-destinations that are searchable in ⌘K but never rendered as sidebar rows. `getNavDestinations()` appends them with `group` = the parent label, so the palette lists โปรไฟล์ / ความปลอดภัย / เซสชันและอุปกรณ์ / การแสดงผล under "การตั้งค่าส่วนตัว" with no other palette change. `settings-tabs.ts` derives the tab strip from that same list (single source; the shell never imports from `pages/`).
- `AccountMenu.tsx`: the links section becomes a single real item **การตั้งค่าส่วนตัว** → `/settings/profile`. The "โปรไฟล์ของฉัน" and "การตั้งค่าส่วนตัว" stubs and the "ความปลอดภัยของบัญชี" link are removed (security is a tab); the "2FA เปิดอยู่/ปิดอยู่" text therefore leaves the menu and is shown on the security tab instead. The theme control and ออกจากระบบ stay as they are.
- Anything else that linked to `/settings/security` keeps working.

## Project structure (this module touches)

```
apps/web/src/pages/settings/SettingsLayout.tsx        new
apps/web/src/pages/settings/SettingsLayout.test.tsx   new
apps/web/src/pages/settings/settings-tabs.ts           new
apps/web/src/pages/settings/SecurityPage.tsx           moved from pages/SecuritySettingsPage.tsx (git mv, no behaviour change)
apps/web/src/pages/settings/SecurityPage.test.tsx      moved with it
apps/web/src/pages/settings/{Profile,Sessions,Display}Page.tsx   new placeholders
apps/web/src/lib/auth/loaders.ts                        rename securitySettingsLoader → settingsLoader
apps/web/src/router.tsx                                 nested /settings routes
apps/web/src/components/shell/nav-config.ts             leaf change + `palette` field on NavLeaf + getNavDestinations() includes palette entries
apps/web/src/components/shell/AccountMenu.tsx           one link, stubs removed
apps/web/src/components/shell/AppShell.test.tsx         update assertions: sidebar leaf, single menu link, palette shows the 4 tabs
docs/ref/shell-structure.md                             nav section: the new leaf
```

## Testing

- `SettingsLayout.test.tsx`: renders header (kicker with user name, h1, subtitle with org name); four tabs with correct `href`s; the tab for the current URL has `aria-selected="true"`; index `/settings` redirects to `/settings/profile`; `/settings/security` still renders the security page's heading.
- `AppShell.test.tsx`: sidebar shows "การตั้งค่าส่วนตัว" linking to `/settings`; account menu has exactly one link, "การตั้งค่าส่วนตัว" → `/settings/profile`, and no 2FA text; breadcrumb on `/settings/security` reads `Org A › การตั้งค่าส่วนตัว`; typing "เซสชัน" in ⌘K lists "เซสชันและอุปกรณ์" under group "การตั้งค่าส่วนตัว" and Enter navigates to `/settings/sessions`.
- Existing `SecurityPage.test.tsx` passes unchanged after the move (only import paths change).
- e2e `settings.spec.ts` (public part): unauthenticated `/settings/security` bounces to `/login?from=%2Fsettings%2Fsecurity`.
- Live: 1440 / 768 / 390, both themes; Tab key reaches every tab and Enter activates it; zero horizontal overflow.

## Boundaries (module deltas)

- Ask first before adding anything to the shell beyond `nav-config.ts` (leaf + `palette`), the palette group label, and the account-menu link.
- Never gate tabs client-side by role — every tab is personal and available to every verified user.

## Success criteria

- [ ] All five URLs resolve; `/settings` → `/settings/profile` by replace; `/settings/foo` → 404 page.
- [ ] Anonymous visit to any `/settings/*` redirects to login carrying `from`; unverified → `/verify-email`.
- [ ] Tab strip: `role=tablist`, active tab `aria-selected=true` + visible underline, keyboard reachable, scrolls horizontally at 390 px without page overflow.
- [ ] Sidebar, breadcrumb and account menu reflect the new destinations; command palette lists "การตั้งค่าส่วนตัว" and its four tabs (grouped), and the sidebar still shows one settings row.
- [ ] Security page behaviour and tests are byte-for-byte equivalent after the move.
- [ ] `bun run validate` green; `docs/ref/shell-structure.md` updated.

## Resolved questions (2026-09-11)

1. Account menu: one settings link only (การตั้งค่าส่วนตัว → `/settings/profile`).
2. Palette: yes — all four tabs, via palette-only entries on the nav leaf.
