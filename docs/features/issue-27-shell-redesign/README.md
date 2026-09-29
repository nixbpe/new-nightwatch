# App shell redesign (#27): before and after captures

Chromium 1440×900, full page, signed in as the seeded demo owner
(`bun run db:seed`, `owner@nightwatch.invalid`). "Before" is `main` at
`576f6a5` (the state the review in #27 assessed); "after" is the head of
`feat/redesign-shell`. Light theme unless the name says dark.

| Route | Before | After |
| --- | --- | --- |
| `/workspace` | `assets/workspace-before-light.png` | `assets/workspace-after-light.png` |
| `/organizations/:id/members` | `assets/members-before-light.png`, `assets/members-before-dark.png` | `assets/members-after-light.png`, `assets/members-after-dark.png` |
| `/notifications` | `assets/notifications-before-light.png` | `assets/notifications-after-light.png` |
| `/settings/security` | `assets/settings-security-before-light.png` | `assets/settings-security-after-light.png` |

The other four routes changed through the same shared components (Page,
PageHeader, Card, PageState, EmptyState) and are not captured here.
