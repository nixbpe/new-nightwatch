# Projects contract verification

The user selected an eligible-only candidate list. Existing Project members are excluded before the API limit and do not appear in the add dialog. A concurrent addition remains an idempotent success.

The workspace entry requests a fresh server selection. The selected Project opens its first real navigation leaf, currently monitors. No readable Project opens the Organization's Projects page. Overview and AWS pages remain outside this change.

## Regression results

| Scenario | Original implementation | Fixed implementation |
| --- | --- | --- |
| Existing members excluded from empty, name and email searches; exclusion before limit; idempotent retry | 5 failed | 5 passed |
| Fresh server selection overrides cached hints for remembered, fallback and absent Projects | 3 failed | 3 passed |
| Browser member management, Project entry and Organization membership | Not run as this combined scope | 21 passed |

The failing tests precede the fix in commit `216ecec`.

Run the API cases through the local environment in [Quality gates](../../../scripts/quality/README.md), with `src/projects/project-members.db.test.ts -t regression`. Run the loader cases with `bun run --cwd apps/web test src/lib/auth/loaders.test.tsx -t regression`. Run the browser cases with `bun run e2e tests/project-members.spec.ts tests/project-switcher.spec.ts tests/project-organization-membership.spec.ts`.

## Add dialog screenshots

Screenshots use a 1440 × 900 viewport and synthetic local fixtures. Fixture identifiers differ between runs.

| Theme | Before | After |
| --- | --- | --- |
| Light | [Existing-member row](before-light.png) | [Eligible-only rows](after-light.png) |
| Dark | [Existing-member row](before-dark.png) | [Eligible-only rows](after-dark.png) |
