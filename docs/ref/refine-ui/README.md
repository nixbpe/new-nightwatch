# UI refinement pass — before/after evidence

Side-by-side renders (left: `main` at `40067c1`, right: this branch) taken
with Playwright against the Vite dev server with every `/api` call mocked
in-browser, so both columns show the same data. Desktop shots are 1440×900
scaled to 720px wide; the mobile pair is 390×844 at native size. Data
("Orbit Digital", sample people, sample notifications) is illustrative.

| File                            | What to look at                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `login-light.jpg` / `-dark.jpg` | Design-system faces actually loaded; input and button share one 40px height; icons come from the shared set |
| `forgot-light.jpg`              | Brand mark above the card; hairline card instead of a shadow                                               |
| `verify-email-anon.jpg`         | Footer links spaced from the form; no em-dash in the continue link                                         |
| `notfound.jpg`                  | Brand mark + hairline card + shared `<Button>`                                                             |
| `workspace-light.jpg` / `-dark` | Real page header (scope eyebrow + title) and an `EmptyState` instead of a slug line; bounded invite form   |
| `workspace-noorg.jpg`           | No-membership state as a card inside the shell, not its own `<main>`                                       |
| `workspace-rail.jpg`            | Icon rail with the two new destinations                                                                    |
| `workspace-mobile.jpg`          | Same header pattern at 390px                                                                               |
| `notifications-page.jpg`        | Shared `PageHeader` with the bulk action; two-line rows                                                    |
| `notifications-detail.jpg`      | Back button left-aligned; same content width as every other page                                           |
| `notifications-popover.jpg`     | Two-line rows show more items in the same panel                                                            |
| `org-notification-settings.jpg` | Reachable from the sidebar; breadcrumb shows the page name instead of a UUID; same frame as other pages    |
| `settings-*.jpg`                | Sidebar now lists the inbox and the organization section; description copy without em-dashes              |
| `command-palette.jpg`           | Palette indexes the same destinations as the sidebar, resolved for the active organization and role       |
