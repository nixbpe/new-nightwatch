# App shell structure

Summary of the 7-step app shell restructure (`apps/web/src/components/shell/`),
delivered as one commit per step:

```
c0a1107 step 1/7 — layout (header/sidebar/main/footer)
98086d0 step 2/7 — config-driven sidebar
35ead77 step 3/7 — header (breadcrumb, search/notification stubs, avatar menu)
46829d4 step 4/7 — routing confirmation + 404 page
d0692f6 step 5/7 — AuthLayout for no-shell-chrome routes
0fd8ea9 step 6/7 — persisted theme toggle
a802980 step 7/7 — hardening (error boundary, skeleton, empty state, a11y)
```

Reference used: the earlier AppShell mockup (screenshots in `docs/ref/designs/`).
Scope was layout and navigation only — no page content was redesigned.

## Two layouts

Every route in `router.tsx` nests under one of two layouts, chosen by whether
the page needs shell chrome:

- **`AppShell.tsx`** — header, collapsible sidebar, scrollable `<main>`,
  footer. Used by `/workspace` and `/settings/security`. Collapses to an
  icon-only sidebar on desktop (toggle button) and a slide-in drawer on
  mobile (below the `sm` breakpoint).
- **`AuthLayout.tsx`** — a plain `<Outlet/>` passthrough, used by `/login`,
  `/forgot-password`, `/reset-password`, `/accept-invitation/:invitationId`,
  `/two-factor`, `/verify-email`, `/onboarding`. These pages already render
  their own full-page chrome; this layout only makes "no sidebar/header here"
  explicit in the route tree.

"Layout switching" (step 5's auth-flag requirement) is realized structurally:
which layout a route nests under is fixed, and access to it is gated by this
app's existing loaders (`lib/auth/loaders.ts` — e.g. `requireAnonLoader`,
`workspaceLoader`), which is this app's real equivalent of an auth flag
(checked against the server per navigation, not a client boolean). No
additional redirect guard was added at the layout level, deliberately: the
`/two-factor` route already owns its own challenge-arrival rules, and a
generic session check at the layout layer risked contradicting that.

`NotFoundPage` (the `*` route) stays outside both layouts — a bad URL is
reachable by anonymous and signed-in visitors alike, and neither layout's
chrome (which assumes a known session state) fits both.

## Sidebar: config-driven nav

`nav-config.ts` is the sidebar's only source of truth:

```ts
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: "grid", path: "/workspace" },
  {
    label: "ตั้งค่า",
    icon: "sliders",
    children: [
      { label: "ความปลอดภัยบัญชี", icon: "shield", path: "/settings/security" },
    ],
  },
];
```

Each entry has a label, icon, optional path (omitted for a group-only
parent), and optional children. `Sidebar.tsx` renders it recursively, tracks
active state (exact match or path-prefix match), expands the group containing
the active route by default, and renders icon-only when collapsed.
`breadcrumb.ts` walks the same tree to derive the header's breadcrumb trail
from the current route, so nav and breadcrumb can never drift apart.

Only two real destinations exist today. The mockup's illustrative
Projects/Activity/Reports/Members sections were deliberately left out rather
than added as placeholder routes (confirmed with the user).

## Header

Logo slot, breadcrumb, a disabled search placeholder, a disabled notification
placeholder, and a user avatar dropdown (email display, a disabled "profile"
stub, a real link to `/settings/security`, the theme toggle, and real
sign-out). Search/notifications are genuinely inert (`disabled`, not just
unstyled) so they don't read as broken features.

## Theme

`lib/theme.ts`'s `useTheme()` hook backs a light/dark/system segmented
control in the header's avatar menu. "System" clears `data-theme` and lets
`index.css`'s `prefers-color-scheme` block decide; "light"/"dark" set
`data-theme` explicitly. The choice persists to `localStorage`
(`nightwatch-theme`), and an inline script in `index.html`'s `<head>` applies
it before first paint to avoid a flash of the wrong theme.

## Hardening

- A skip-to-content link as the first focusable element, jumping to
  `#main-content`.
- The existing global `ErrorBoundary` (`components/ErrorBoundary.tsx`) is
  additionally scoped around just the routed `<Outlet/>` inside `<main>`, so
  a crashing page no longer takes the header/sidebar/footer down with it.
- `Skeleton.tsx` — a pulsing placeholder, used by the header's avatar slot
  while the session is resolving.
- `EmptyState.tsx` — a reusable no-data primitive, provided as scaffolding
  for pages to use; no existing page was rewritten to adopt it (out of
  scope).
- Focus management: the avatar menu moves focus to its first enabled item on
  open and returns it to the trigger on Escape/outside-click/selection; the
  mobile drawer does the same with its own trigger and close button.
- Verified with a real running app at 390/768/1280px: zero horizontal
  overflow at any breakpoint.

## Removed or changed along the way

- `WorkspacePage.tsx` — its own inline `<header>` (brand mark, security
  link, logout button) was removed; that's now the shell's job. Its org
  switcher stayed as page content (not moved into the shell), since
  `WorkspacePage.test.tsx` renders the page standalone and asserts on it
  directly.
- `SecuritySettingsPage.tsx` — the `AuthPageShell` wrapper was removed (both
  its error-state and main-state returns); the page now renders as plain
  content inside `AppShell`, with a local heading in place of what
  `AuthPageShell` used to provide.
- `NotFoundPage` gained a brand mark and now points at `/workspace` instead
  of `/login`.

## Tests

`AppShell.test.tsx` covers: header + sidebar + skip link + routed content
rendering together; a crashing child page being caught without losing shell
chrome; and the avatar menu's open-focus behavior. Full suite: 105/105
passing (102 pre-existing + 3 new).
