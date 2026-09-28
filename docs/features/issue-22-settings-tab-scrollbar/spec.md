# Issue #22 Technical Spec

| Field | Value |
| --- | --- |
| Issue | [#22](https://github.com/nixbpe/new-nightwatch/issues/22), approved bug scope (no Feature or Story ID assigned) |
| Acceptance | Frozen by assignment: remove the stray 1px vertical overflow on the four `/settings/*` tab strips while preserving the visible 2px active underline and keyboard usability |
| Approved by user | 2026-09-28, assignment pre-approves this spec |
| STOP_AT | merge-ready |
| COMMIT_MODE | owned-slice |

## Contracts

- API, data/RLS, jobs: unchanged. No migrations, authorization, queue, dependency, or platform work.
- UI: `nav[role=tablist]` remains the horizontal tab navigation with the existing labels, active state, focus behavior and routes. The wrapper owns the hairline; the `nav` owns the negative bottom margin, so no tab extends below the scroll container. The active tab's 2px underline remains visible over the hairline.

## Design decisions

- Apply the issue's selected change in `SettingsLayout.tsx`: wrap the tablist in `border-b border-foreground/10`, move `-mb-px` from each `NavLink` to the `nav`, and preserve `overflow-x-auto` there. Do not apply `overflow-y-hidden`: it masks the scrollbar while clipping the underline.
- The issue's 68-route audit found only this vertical-overflow defect; leave `OrganizationMembersPage.tsx` and `MfaCard.tsx` untouched. Horizontal reflow concerns are recorded below and are not silently made part of this vertical-scrollbar fix.
- No markup-sensitive unit test update unless existing assertions fail; browser layout must be measured in Chromium because jsdom does not calculate scroll geometry.

## Tasks

| Task | OWNER | READY | OUTCOME | SOURCE | INVARIANTS | FILES | NON-GOALS | CONTRACTS | VERIFY | PROOF | Covers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NODE-22-1 | software-engineer, integration owner | Ready; user instructed implementation on 2026-09-28 | Remove the stray vertical 1px tablist overflow without clipping the underline | Issue #22, `docs/design-system.md` LAY-02/A11Y | Keep tab roles, route links, visible labels, horizontal keyboard navigation, active 2px underline and light/dark styling | `apps/web/src/pages/settings/SettingsLayout.tsx`, `e2e/tests/settings.spec.ts`; `apps/web/src/pages/settings/SettingsLayout.test.tsx` only if needed; this spec owned by Technical Lead | No MFA stepper/table changes, no unrelated layout redesign, no API/data changes | Wrapper hairline, negative nav margin, no child negative margin | Focused Web test, focused authenticated settings Playwright scenario in isolated worktree DB, lint/typecheck scoped as applicable; after writers stop root validate, integration, gated coverage, build, security, focused E2E | Before/after screenshots in light/dark at 375×812 and 200% root text; every `/settings/profile`, `/security`, `/sessions`, `/display` at 1440×900 and 375×812, 100% and 200%: `nav.scrollHeight === nav.clientHeight`; active 2px underline visibly overlaps hairline; keyboard focus works and labels remain accessible; report actual commands/results | Issue symptom, vertical scroll/trap and underline; LAY-02/A11Y as applicable to changed behavior |
| Integrated review and CI | Technical Lead; code-reviewer for review; integration owner for PR | NODE-22-1 stopped writing and proof reviewed | Bind final code and open one PR only after required local gates pass, then review PR and confirm CI on final SHA | Issue #22 and PR template | No source changes after final review without re-review and affected gates | Reviewed diff, template PR body | No merge, deploy or dependent work | PR uses complete template with SHA-backed gate evidence | `bun run validate`; local-DB `bun run test:integration`; local-DB `COVERAGE_GATE=1 bun run test:coverage`; `bun run build`; `bun run security`; focused local authenticated E2E; PR CI required checks | Independent full-change review, PR `/review-pr`, all required local and PR CI checks observed pass on reported final SHA | All criteria and delivery contract |

## Open decisions

| Decision | Owner |
| --- | --- |
| Horizontal scrolling of settings tabs and MFA stepper at narrow/200% text remains outside issue #22's approved vertical-overflow fix; the user explicitly instructed implementation without expanding scope on 2026-09-28. Record this risk in the PR, do not implement or start follow-up work. | Product Owner / UX for later prioritization |
