# App shell

The shell is the chrome around every signed-in page: a sidebar, a header and a scrollable main column. Sidebar and header sit on Canvas behind hairline edges; Surface is for cards, fields and overlays. Tokens, type and spacing follow `docs/design-system.md`. Routes without chrome (sign-in, password reset, invitation, two-factor, e-mail verification, onboarding) render in a bare layout; the not-found page stands outside both.

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

| Region            | Size and behavior                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar, expanded | 240 px at 1024 px and wider                                                                                                                                                      |
| Sidebar, rail     | 56 px icon rail below 1024 px                                                                                                                                                    |
| Sidebar, drawer   | Slide-in over the page below 640 px; modal, focus moves to its close control on open and back to the toggle on close                                                             |
| Header            | 56 px, side padding 32 px (16 px below 640 px) aligned with main: sidebar toggle, breadcrumb, search-all field with a ⌘K / Ctrl+K hint, notifications; no product logo or avatar |
| Main              | Scrollable, 32 px padding; data pages fill the column, form pages cap the form column at 720 px (a test panel may sit beside it from `lg`); 24 px rhythm; overview (`/workspace`) carries the deeper canvas and hairline texture (design-system.md LAY-08/LAY-09), the monitor list and the inbox carry a canvas grain      |

The header toggle overrides the breakpoint default until the breakpoint itself changes. ⌘K / Ctrl+K opens the command palette from anywhere in the shell. The product mark appears only where there is no organization to show: sign-in, auth cards, not-found, and the sidebar of a user without membership.

## Navigation model

One navigation definition feeds the sidebar, the command palette and the settings tab strip; nothing is defined twice.

- Leaf: label, icon, path, optional roles (hidden from other roles), optional palette entries, optional count. The count is a server value in monospace Secondary text, `aria-hidden` so the link name stays the label, hidden in the rail and whenever the value is unknown or failed (never a stale or guessed number, CMP-01). Sources: the inbox shows the unread count shared with the notifications badge (hidden at zero); the monitor list shows `summary.total` of the active organization's monitor list.
- Group: label and leaves, rendered as a labelled section, never an accordion; the rail shows a divider in its place; a group with nothing visible disappears.
- A path may carry an organization parameter resolved against the active organization; a leaf that needs one is hidden when there is none.
- Palette entries are searchable in ⌘K under the leaf's label and form the leaf's tab strip, but are never sidebar rows. The leaf is active on every one of its tabs.
- Only real destinations are listed; no placeholder routes.
- Active row: Primary tint (design-system Tokens) as fill with Primary text, a 3 px Primary bar on the left edge (also on the rail button), medium weight, `aria-current="page"`. The sidebar width changes over 150 ms; hover fills over 100 ms.

Example (NightWatch): ภาพรวม; ตรวจสถานะบริการ; การแจ้งเตือน; การตั้งค่าส่วนตัว with tabs โปรไฟล์, ความปลอดภัย, เซสชันและอุปกรณ์, การแสดงผล; group องค์กร with สมาชิก and ตั้งค่าการแจ้งเตือน (owner, admin).

## Sidebar

- Organization switcher on top, in a 56 px row that matches the header: organization mark (solid Primary with On primary initials, monospace when Latin per TYP-04, 4 px corner), name, `องค์กร · <role>`. With more than one membership it is a button opening a `menuitemradio` list. Skeleton while the context loads.
- Account menu at the bottom: avatar (circle, inset fill with strong edge, Text initials, monospace when Latin per TYP-04), name, e-mail. Opens upward: role pill and organization, one link to personal settings, the theme control, sign-out.

## Header

The breadcrumb root is the organization the page acts on: on an organization-scoped route the one named in the URL (a bookmark may name an organization other than the active one), elsewhere the active organization. The page crumb comes from the navigation definition, so an id never shows; section labels are not crumbs. Below 1024 px the breadcrumb shows only the current page and search is icon-only.

## Overlays

Shared menu-button behavior: focus moves in on open; ↑↓ move between items; Escape, an outside click or selecting an item returns focus to the trigger.

- Command palette: modal search-all over the navigation definition, resolved for the active organization and the user's role, so every result navigates. ↑↓ select, ↵ opens, Escape closes, Tab stays inside. The footer names the organization being searched.
- Notifications popover: title row, the five most recent inbox rows (two lines each), footer links to the inbox page and, for owners and admins, the organization's notification settings. Loading is a skeleton, no data an honest empty line; the unread badge is the server's count as a Text-filled counter (Text fill, Canvas numerals in monospace).
- Inbox rows (popover and inbox page): an unread row carries a Primary dot and a semibold title; a read row a hollow strong-edge dot and a regular title.

## Page frame

Every routed page uses one frame: a fluid column (the form column caps at 720 px; a side panel may sit beside it from `lg`) with 24 px rhythm and a page header with an optional eyebrow (a Latin route code, TYP-04), a scope row (organization or account mark, name and a role or context pill, no separator characters), the 28 px title, a status line for facts (slug, counts, freshness; Thai labels in the sans-serif, values such as counts, ids, times and URLs in monospace; a status pill may lead it), an optional description and actions on the right that wrap under the title when the width runs out. Sections open with a section header: a 16 px semibold h2 with an optional `aria-hidden` section code, meta or actions on the right and a Divider under it. Cards are hairline panels, never shadows; modal dialogs follow LAY-07. Sibling stats or rows may share a hairline grid. A mockup region follows CMP-06. Forms bound their fields (about 448 px wide or a two-column grid) and put actions in a row under a hairline. Page-level loading and error states render as cards inside the frame, never as their own main region.

## Settings reflow

The four routes `/settings/{profile,security,sessions,display}` keep full-label icon tabs, `aria-selected`, DOM and Tab focus order, and visible focus. Whole fixed-height tabs wrap into rows without horizontal scrolling, clipping or page overflow. Labels do not wrap inside tabs, and tabs do not become icon-only.

The selected tab has a 2 px underline on its own row. On the last row it overlays the wrapper's 1 px hairline; earlier rows remain visible above the hairline. The wrapper owns `border-b` and the nav owns `-mb-px`. The nav has no vertical overflow (`scrollHeight === clientHeight`). Overflow masking and label truncation do not replace this geometry.

The three-step MFA indicator keeps full labels, `aria-current="step"` and completed states. Narrow layouts stack the steps vertically. At `lg`, the steps are horizontal with wrapping labels and decorative connectors. The connectors are hidden in the vertical layout.

MFA footer actions keep secondary before primary in DOM order. They stack on narrow screens and return to a row at `sm`. Labels wrap inside actions, and actions remain within the card and viewport. Keyboard focus, acknowledgment and stage controls remain unchanged.

Issue #22 delivered this behavior in `1693dad`. The authenticated regression matrix lives in `e2e/tests/settings.spec.ts`. The issue-specific tab and stepper rules are stricter than the horizontal-scroll allowance in LAY-02; they do not change table behavior.

## Theme

Three states: system, light, dark. An explicit choice overrides the system preference with the same tokens either way. The choice is persisted per browser and applied before first paint so no page flashes the wrong theme. The account menu and the display settings tab drive one shared state, so a change in either shows in both.

## Decisions

- Tenant context is provided at shell level, not per page, because the switcher, the account menu and the breadcrumb all read the active organization.
- Which routes get chrome is decided by route nesting and the route loaders, not by a client-side redirect guard, so one place decides who may see what.
- The breadcrumb roots at the organization in the URL so a bookmark to another organization's page names that organization.
- A skip link targets the main region, and the error boundary around the routed page keeps the chrome usable when a page crashes.
- Skeleton and empty-state primitives use Text at low opacity so they read on both themes.
