# Workspace AppShell — reference screenshots

Reference renders of the `/workspace` AppShell explored in a Claude Design canvas
session: a left menubar (collapsible to an icon rail, org switcher on top, account
menu pinned to the bottom), a topbar with search-all and notifications, and four
body variants (dashboard, table, wizard, panel) plus overlay and narrow states.

These are illustrative mockups with placeholder data ("Orbit Digital", sample
people and projects) — not implemented screens. They follow
[`../../design-system.md`](../design-system.md); where the two disagree, the
design system doc is the source of truth and these images should be regenerated.

## Files

| Body variant | Light | Dark |
| --- | --- | --- |
| Dashboard | `dashboard-light.png` | `dashboard-dark.png` |
| Table (members) | `table-light.png` | `table-dark.png` |
| Wizard (new project) | `wizard-light.png` | `wizard-dark.png` |
| Panel (project list + detail) | `panel-light.png` | `panel-dark.png` |
| Search-all (⌘K) open | `search-all-light.png` | `search-all-dark.png` |
| Notifications open | `notifications-light.png` | `notifications-dark.png` |
| Account menu open | `user-menu-light.png` | `user-menu-dark.png` |
| Narrow / tablet (768px, rail) | `tablet-light.png` | `tablet-dark.png` |

Desktop shots are 1440×900; the tablet pair is 768×1024.

## Notes for whoever implements this

- Dark theme is intentionally near-black (`#000000` canvas / `#121316` surface),
  not the older `#111315` / `#1B1E22` pair — see the Colors table in the design
  system doc.
- Corners are a single 4px radius everywhere (controls, panels, overlays); pills
  stay reserved for status badges/tags, counters and avatars.
- Cards and panels get a hairline border, not a shadow; shadows are reserved for
  floating overlays (the popovers and command palette shown here).
- Timestamps and numeric counts are set in a monospace face; everything else,
  including all Thai text, stays in the sans-serif.
