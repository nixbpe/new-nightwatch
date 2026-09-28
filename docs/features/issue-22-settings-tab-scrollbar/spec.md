# Issue #22 Technical Spec

| Field | Value |
| --- | --- |
| Issue | [#22](https://github.com/nixbpe/new-nightwatch/issues/22), approved bug scope (no Feature or Story ID assigned) |
| Acceptance | Frozen issue #22 symptom plus user's 2026-09-28 decision `Fix in PR #24` for both settings-tab and MFA-stepper horizontal reflow at narrow and 200% text; `docs/design-system.md` LAY-02 and A11Y-01 |
| Approved by user | 2026-09-28, assignment pre-approves this spec |
| STOP_AT | merge-ready |
| COMMIT_MODE | owned-slice |

## Contracts

- API, data/RLS, jobs: unchanged. No migrations, authorization, queue, dependency, or platform work.
- UI: `nav[role=tablist]` keeps four labeled route links, `aria-selected`, focus order and visible focus. Tabs reflow into rows within the available width rather than scrolling horizontally; each active tab keeps its visible 2px underline. On the last row it overlays the wrapper hairline; on an earlier row the underline remains visible above it. Keep the wrapper hairline and the `nav` negative bottom margin so `scrollHeight === clientHeight` on all four routes and both text scales. The MFA `ol[aria-label="ขั้นตอนการเปิดใช้งาน"]` keeps all three ordered labels and `aria-current="step"` on the active step; its items reflow or stack without horizontal scrolling, clipping or loss of stage controls. No page-level horizontal overflow. API/data/RLS/jobs unchanged.

## Design decisions

- Preserve the existing vertical fix: wrapper owns `border-b`, nav owns `-mb-px`, no child negative bottom margin or `overflow-y-hidden`. Replace the tab strip's horizontal-scroll/nowrap constraint with responsive wrapping, retaining each complete label and a visible active/focus indicator on every row. Keep natural keyboard Tab order and route semantics; do not introduce icon-only tabs or new keyboard behavior.
- Use the existing responsive reflow pattern for the MFA stepper: its ordered items stack when space is narrow and labels wrap within their items at enlarged text; optional desktop connectors remain decorative and cannot force intrinsic overflow. Preserve number/completed state, `aria-current`, and all adjacent form actions. The member table is unchanged; only tables may scroll horizontally (LAY-02).
- Prove layout in Chromium rather than jsdom. Check page `documentElement.scrollWidth <= innerWidth`, each non-table component's `scrollWidth <= clientWidth`, settings `scrollHeight === clientHeight`, visible 2px underline/focus, and the stepper at all three active stages. Capture before/after light/dark screenshots including 375×812 at 200% and 1440×900 at 200%; report numeric geometry before/after for 375×812 and 1440×900 at 200%, plus 375×812 at 100%. Accessibility checks cover labels, stage state, sequential keyboard focus and visible focus without clipping. No new API, table, queue, dependency, or platform contract; accessibility/maintainability are the architecture drivers.

## Tasks

| Task | OWNER | READY | OUTCOME | SOURCE | INVARIANTS | FILES | NON-GOALS | CONTRACTS | VERIFY | PROOF | Covers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NODE-22-1 | software-engineer, integration owner | Ready; this amended spec is pre-approved | Reflow all four settings tab strips and retain the 1px vertical fix | Issue #22; approved `Fix in PR #24`; LAY-02/A11Y-01 | Four labels/links, selected states, keyboard Tab order, visible focus, 2px active underline and light/dark styling | `apps/web/src/pages/settings/SettingsLayout.tsx`, `e2e/tests/settings.spec.ts` (integration owner); tests only where behavior warrants; spec Technical Lead owned | No table/API/data changes, no icon-only truncation, no vertical-scroll masking | Tabs wrap without horizontal overflow; wrapper/nav vertical geometry unchanged | Focused Web and authenticated Chromium browser checks using isolated DB; no full gates while sibling writes | Numeric before/after component/page geometry at 375×812 100%/200% and 1440×900 200%, four routes, both themes; screenshot proof; Tab/focus/route/underline checks | Original vertical criterion; settings-tab horizontal LAY-02 and A11Y-01 |
| NODE-22-2 | software-engineer | Ready; disjoint source and test ownership | Reflow three-step MFA indicator without losing label/stage/action | Issue #22; approved `Fix in PR #24`; LAY-02/A11Y-01 | Ordered labels, `aria-current`, completion icon, password/scan/verify controls and focus paths | `apps/web/src/pages/settings/MfaCard.tsx`, focused MFA regression proof in a separately owned test file if needed; send browser proof to integration owner for shared `e2e/tests/settings.spec.ts` | No MFA authentication behavior, table or API/data change; no edits to integration-owned files | Step items wrap/stack and labels remain readable at narrow/200%; no component or page horizontal overflow | Focused component tests and authenticated browser scenario for each stage; no full gates while sibling writes | Numeric before/after stepper/page geometry at 375×812 100%/200% and 1440×900 200%, light/dark screenshot and stage/keyboard/focus/action proof | MFA horizontal LAY-02 and A11Y-01 |
| Integrated review and CI | Technical Lead; code-reviewer; integration owner for push | NODE-22-1 and NODE-22-2 stopped writing and focused proof reviewed | Bind final candidate and update existing PR #24 only after local gates pass | Issue #22, this spec and PR template | Source edit after binding invalidates candidate; no merge, deployment, force-push or dependent work | Reviewed integrated diff, screenshot proof, PR body at final SHA | No new PR | Final independent review and `/review-pr` have no unresolved in-scope findings | Focused runtime/browser/accessibility; `bun run validate`; local-DB `bun run test:integration`; local-DB `COVERAGE_GATE=1 bun run test:coverage`; `bun run build`; `bun run security`; focused local authenticated E2E; all required PR CI on final SHA | Before/after exact geometry, preserved original fix, both responsive fixes, screenshots, gate outputs, final SHA and CI status | All criteria and delivery contract |

## Open decisions

None. Both horizontal reflow decisions are `Fix in PR #24` by user approval on 2026-09-28.
