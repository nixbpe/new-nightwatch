# App shell structure

Shell code lives in `apps/web/src/components/shell/`. It follows the
reference renders in `docs/ref/designs/` (README there) and the token rules
in `docs/design-system.md`. Scope is layout and navigation only; page content
was not redesigned.

## Layout

```
┌──────────┬──────────────────────────────────────────────┐
│ Org      │ ⊟  Org › Page            [ค้นหาทั้งหมด… ⌘K] 🔔 │  header (h-14)
│ switcher ├──────────────────────────────────────────────┤
│          │                                              │
│ nav      │  <main> — scrollable, full width, 32px pad   │
│ sections │      routed page (inside ErrorBoundary)      │
│          │                                              │
│ account  │  © NightWatch (footer, bottom of scroll)     │
└──────────┴──────────────────────────────────────────────┘
```

- **`AppShell.tsx`** — full-height sidebar beside a header + main column.
  Sidebar width follows the breakpoint: expanded (240px) at `lg`+, icon rail
  (56px) below `lg`, a slide-in drawer below `sm`. The header toggle
  overrides the breakpoint default until the breakpoint itself changes.
  ⌘K / Ctrl+K opens the command palette from anywhere in the shell.
- **`AuthLayout.tsx`** — plain `<Outlet/>` for every no-chrome route
  (`/login`, `/forgot-password`, `/reset-password`,
  `/accept-invitation/:id`, `/two-factor`, `/verify-email`, `/onboarding`).
  Layout switching is structural: which layout a route nests under in
  `router.tsx`, gated by the existing loaders in `lib/auth/loaders.ts`. No
  extra client-side redirect guard was added (see the comment in
  `AuthLayout.tsx` for why).
- **`NotFoundPage`** (`*`) stays outside both layouts.

`TenantProvider` wraps `AppShell` (not just the workspace page) because the
org switcher, account menu and breadcrumb all read the active organization.

## Sidebar

- **`OrgSwitcher.tsx`** (top) — org mark (initials, 4px corner), name,
  `องค์กร · <role>`. With more than one membership it is a button opening a
  `menuitemradio` list; switching goes through `TenantProvider.switchOrg`.
  This is the shell's logo slot: the product mark appears only when the
  user has no membership. Skeleton while `/me/context` is pending.
- **`Sidebar.tsx`** — renders `NAV_ITEMS` from `nav-config.ts`
  (`NavLeaf | NavGroup`). Groups are labelled sections, not accordions; the
  rail shows a divider in their place. A leaf may carry `:organizationId`
  in its path (resolved against the active organization) and `roles`
  (hidden from other roles); a group with nothing visible disappears.
  Active row: alpha fill, medium weight, primary-coloured icon,
  `aria-current="page"`.
- **`AccountMenu.tsx`** (bottom) — avatar (circle), name, email; opens
  upward: role pill + org, one link **การตั้งค่าส่วนตัว** → `/settings/profile`
  (its tabs hold profile, security, sessions and display), theme segmented
  control (`lib/theme.ts`), sign-out.

```ts
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  { label: "การแจ้งเตือน", icon: "inbox", path: "/notifications" },
  {
    label: "การตั้งค่าส่วนตัว",
    icon: "sliders",
    path: "/settings",
    palette: [
      /* โปรไฟล์, ความปลอดภัย, เซสชันและอุปกรณ์, การแสดงผล → /settings/<tab> */
    ],
  },
  {
    label: "องค์กร",
    children: [
      {
        label: "ตั้งค่าการแจ้งเตือน",
        icon: "bell",
        path: "/organizations/:organizationId/notification-settings",
        roles: ["owner", "admin"],
      },
    ],
  },
];
```

A leaf's `palette` entries are searchable in ⌘K (grouped under the leaf's
label) but never rendered as sidebar rows; `pages/settings/settings-tabs.ts`
derives the settings tab strip from them, so one definition feeds the
sidebar, the palette and the tabs. `/settings` is prefix-active on every
tab, which is what the breadcrumb shows.

Only real destinations are listed; the reference's illustrative
Projects/Activity/Reports/Members sections were deliberately not added as
placeholder routes (confirmed with the user).

## Header

`Header.tsx`: sidebar toggle (hamburger below `sm`), breadcrumb rooted at the
active organization (`breadcrumb.ts` derives the page crumb from
`NAV_ITEMS`, matching organization-scoped leaves on their route shape so an
id never shows; section labels are not crumbs), the search-all field with a
⌘K hint, and notifications. Below `lg` the breadcrumb shows only the current
page and search is icon-only, matching the 768px reference. No product logo
or avatar in the header.

## Overlays

- **`CommandPalette.tsx`** — modal search-all. Its only index today is the
  nav config (section "หน้าและการตั้งค่า"), resolved for the active
  organization and the user's role, so results are real and navigate. ↑↓
  select, ↵ opens, esc closes, Tab stays inside; focus returns to whatever
  opened it. Footer shows `ค้นหาใน <org>`.
- **`NotificationsPopover.tsx`** — title row, the five most recent inbox
  rows (shared `NotificationRows`, two lines each), footer links to the
  inbox page and, for owners/admins, the organization's notification
  settings. Loading is a skeleton, no data an honest empty line; the unread
  badge is the server's count.
- **`usePopover.ts`** — shared menu-button behaviour for the three
  popovers: focus moves in on open, ↑↓ rove between items, Escape /
  outside click / item select return focus to the trigger.

## Page frame

Every routed page inside the shell uses `Page.tsx`: `Page` (one 960px
left-aligned column, 24px rhythm) and `PageHeader` (eyebrow for scope, the
title, an optional description, actions on the right). Cards are hairline
`border-foreground/10` panels, never shadows; forms bound their fields
(`max-w-md` or a two-column grid) and put actions in a row under a
hairline. Page-level loading and error states render as cards inside the
shell, never their own `<main>`. `BrandMark.tsx` is the one product mark
(login panel, auth card pages, 404, no-membership sidebar fallback).

## Personal settings (`/settings/*`)

`pages/settings/` holds the personal-settings page: `SettingsLayout.tsx`
(header + tab strip, gated by `settingsLoader`) with one child route per tab
— `ProfilePage` (display name, read-only verified email, initials avatar),
`SecurityPage` (`MfaCard` inline three-step TOTP enrolment / regenerate /
disable, `PasswordCard`), `SessionsPage` (better-auth sessions, revoke one or
all others; prefetched by `sessionsLoader`) and `DisplayPage` (theme +
browser-stored language/time preferences from `lib/preferences.ts`). `/settings`
lands on the profile tab. Capability decisions remain in `CAPABILITY-MAP.md`;
e2e coverage lives in `e2e/tests/settings.spec.ts`.

## Theme

`lib/theme.ts` `useTheme()` is one shared store behind both the account menu's
segmented control and the display tab's, so a change in either shows in both.
"system" clears `data-theme`; "light"/"dark" set it. Persisted in
`localStorage` (`nightwatch-theme`); an inline script in `index.html`
applies it before first paint. Dark tokens are the near-black pair from the
design system (`#000000` canvas / `#121316` surface) and all corners are
4px (`index.css`).

## Hardening

- Skip-to-content link → `#main-content`.
- The global `ErrorBoundary` is additionally scoped around the routed
  `<Outlet/>`, so a crashing page leaves the shell chrome usable.
- `Skeleton.tsx` (loading) and `EmptyState.tsx` (no data) primitives use
  foreground-alpha fills so they read on both themes.
- Mobile drawer: focus moves to its close button on open and back to the
  hamburger on Escape / backdrop / selection.
- Verified live at 1440 / 768 / 390 in both themes: zero horizontal overflow.

## Tests

`AppShell.test.tsx` renders the real shell (TenantProvider + mocked
`/me/context`) and covers: structure (org switcher, org-rooted breadcrumb,
labelled nav section with no accordion, role-gated organization leaf,
account block, skip link), the
scoped error boundary, account-menu focus + Escape return, org switch
success and denied, ⌘K → grouped palette result → Enter navigation,
field-open / Escape focus return, the notifications empty state, and the
no-membership logo fallback. `pages/settings/SettingsLayout.test.tsx` covers
the settings frame (header, tabs, index redirect, security tab).

## Removed or changed on existing pages

- `WorkspacePage.tsx` — its inline header (earlier) and its org `<select>`
  (now) are gone; both moved into the shell. Its two org-switching tests
  moved to `AppShell.test.tsx`.
- `SecuritySettingsPage.tsx` — `AuthPageShell` wrapper removed; renders as
  plain content inside `AppShell` with a local heading. Since moved to
  `pages/settings/SecurityPage.tsx` as the security tab of `/settings`.
- `NotFoundPage` — brand mark added, link points at `/workspace`.
- UI refinement pass (branch `refine-ui`): the design-system faces are
  self-hosted through `@fontsource`; `Card`/`Input`/`Button`/`Alert` follow
  the token rules in one place (hairline cards, 40px controls); every page
  shares `Page`/`PageHeader`; the workspace shows a real page header and an
  `EmptyState` instead of a slug line; the inbox and organization settings
  are in the sidebar; no em-dashes in visible copy.

## History

```
c0a1107  step 1/7 layout          d0692f6  step 5/7 AuthLayout
98086d0  step 2/7 sidebar          0fd8ea9  step 6/7 theme toggle
35ead77  step 3/7 header           a802980  step 7/7 hardening
46829d4  step 4/7 routing + 404    9ee0649  tokens to design-system doc
                                   cea06db  rebuild shell to reference
```
