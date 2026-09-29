# App shell

The shell is the chrome around every signed-in page: a sidebar, a header and a scrollable main column. Tokens, type and spacing follow `docs/design-system.md`. Routes without chrome (sign-in, password reset, invitation, two-factor, e-mail verification, onboarding) render in a bare layout; the not-found page stands outside both.

## Layout

```
┌──────────┬──────────────────────────────────────────────┐
│ Org      │ ⊟  Org › Page            [ค้นหาทั้งหมด… ⌘K] 🔔 │  header
│ switcher ├──────────────────────────────────────────────┤
│          │                                              │
│ nav      │  main: scrollable, full width, 32 px padding │
│ sections │      routed page inside an error boundary    │
│          │                                              │
│ account  │  footer at the bottom of the scroll          │
└──────────┴──────────────────────────────────────────────┘
```

| Region            | Size and behavior                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Sidebar, expanded | 240 px at 1024 px and wider                                                                                            |
| Sidebar, rail     | 56 px icon rail below 1024 px                                                                                          |
| Sidebar, drawer   | Slide-in over the page below 640 px; modal, focus moves to its close control on open and back to the toggle on close   |
| Header            | 56 px: sidebar toggle, breadcrumb, search-all field with a ⌘K / Ctrl+K hint, notifications; no product logo or avatar |
| Main              | Scrollable, 32 px padding; data pages fill the column, form pages cap at 720 px; 24 px rhythm; overview, inbox and directory carry a canvas grain |

The header toggle overrides the breakpoint default until the breakpoint itself changes. ⌘K / Ctrl+K opens the command palette from anywhere in the shell. The product mark appears only where there is no organization to show: sign-in, auth cards, not-found, and the sidebar of a user without membership.

## Navigation model

One navigation definition feeds the sidebar, the command palette and the settings tab strip; nothing is defined twice.

- Leaf: label, icon, path, optional roles (hidden from other roles), optional palette entries.
- Group: label and leaves, rendered as a labelled section, never an accordion; the rail shows a divider in its place; a group with nothing visible disappears.
- A path may carry an organization parameter resolved against the active organization; a leaf that needs one is hidden when there is none.
- Palette entries are searchable in ⌘K under the leaf's label and form the leaf's tab strip, but are never sidebar rows. The leaf is active on every one of its tabs.
- Only real destinations are listed; no placeholder routes.
- Active row: Text at low opacity as fill, a 3 px Primary bar on the left edge (also on the rail button), medium weight, Primary icon, `aria-current="page"`. The sidebar width changes over 150 ms; hover fills over 100 ms.

Example (NightWatch): ภาพรวม; การแจ้งเตือน; การตั้งค่าส่วนตัว with tabs โปรไฟล์, ความปลอดภัย, เซสชันและอุปกรณ์, การแสดงผล; group องค์กร with สมาชิก and ตั้งค่าการแจ้งเตือน (owner, admin).

## Sidebar

- Organization switcher on top: organization mark (initials, 4 px corner), name, `องค์กร · <role>`. With more than one membership it is a button opening a `menuitemradio` list. Skeleton while the context loads.
- Account menu at the bottom: avatar (circle), name, e-mail. Opens upward: role pill and organization, one link to personal settings, the theme control, sign-out.

## Header

The breadcrumb root is the organization the page acts on: on an organization-scoped route the one named in the URL (a bookmark may name an organization other than the active one), elsewhere the active organization. The page crumb comes from the navigation definition, so an id never shows; section labels are not crumbs. Below 1024 px the breadcrumb shows only the current page and search is icon-only.

## Overlays

Shared menu-button behavior: focus moves in on open; ↑↓ move between items; Escape, an outside click or selecting an item returns focus to the trigger.

- Command palette: modal search-all over the navigation definition, resolved for the active organization and the user's role, so every result navigates. ↑↓ select, ↵ opens, Escape closes, Tab stays inside. The footer names the organization being searched.
- Notifications popover: title row, the five most recent inbox rows (two lines each), footer links to the inbox page and, for owners and admins, the organization's notification settings. Loading is a skeleton, no data an honest empty line; the unread badge is the server's count.

## Page frame

Every routed page uses one frame: a fluid column (forms cap at 720 px) with 24 px rhythm and a page header with a scope row (organization or account mark, name and a role or context pill, no separator characters), the 24 px title, a status line for facts (slug, counts, freshness; identifiers and numbers in monospace), an optional description and actions on the right that wrap under the title when the width runs out. Cards are hairline panels, never shadows. Forms bound their fields (about 448 px wide or a two-column grid) and put actions in a row under a hairline. Page-level loading and error states render as cards inside the frame, never as their own main region.

## Theme

Three states: system, light, dark. An explicit choice overrides the system preference with the same tokens either way. The choice is persisted per browser and applied before first paint so no page flashes the wrong theme. The account menu and the display settings tab drive one shared state, so a change in either shows in both.

## Decisions

- Tenant context is provided at shell level, not per page, because the switcher, the account menu and the breadcrumb all read the active organization.
- Which routes get chrome is decided by route nesting and the route loaders, not by a client-side redirect guard, so one place decides who may see what.
- The breadcrumb roots at the organization in the URL so a bookmark to another organization's page names that organization.
- A skip link targets the main region, and the error boundary around the routed page keeps the chrome usable when a page crashes.
- Skeleton and empty-state primitives use Text at low opacity so they read on both themes.
