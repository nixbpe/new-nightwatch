<!--
Every section below is required unless it says "if applicable". The Technical
Lead's /review-pr command treats an empty required section, or a claim without
command, result and commit SHA, as a Blocker evidence gap. Write facts a
reviewer can check; never claim more verification than was run.
-->

## Summary

<!-- One or two sentences: what changed and why. Reference the issue, Feature or AC it serves. -->

Closes #

## Scope and non-goals

- In scope:
- Out of scope (deliberately untouched):

## Changes

<!-- Per file or per behavior, in the order a reviewer should read them. Name contracts that changed (API, schema, RLS, queue payloads, env names) and the docs updated for them. -->

-

## Acceptance coverage

<!-- One row per AC-<NN> or issue requirement this PR claims. "Proof" names the test, scenario or command that exercises it. -->

| Criterion | Proof | Result (observed pass / observed fail / not verified) |
| --------- | ----- | ----------------------------------------------------- |
|           |       |                                                       |

## Evidence

<!--
Runtime behavior, not just tests. Include:
- For UI changes: before and after screenshots of the changed surface in both
  themes (light, dark) and at 375×812 with 200% root text (docs/design-system.md
  LAY-02, A11Y). Attach them here or link the Playwright trace/attachments.
- For DB/RLS, security or concurrency changes: the scenario, the trigger, the
  state it reached and the state it preserved.
- Commands are shown exactly as run. Database-touching commands
  (test:integration, test:coverage, e2e) run through scripts/dev-env.mjs after
  `bun run db:up`, never against an ambient or production database.
-->

## Quality gates

<!--
Fill every row. "not run" is an acceptable value; a missing row is not.
PR CI never runs e2e (release-stage is workflow_dispatch only), so a change that
touches apps/web, e2e/ or user-facing API behavior needs a local e2e result here.
-->

| Gate                                     | Command                                 | Result (pass / fail / not run) | Commit SHA | Notes |
| ---------------------------------------- | --------------------------------------- | ------------------------------ | ---------- | ----- |
| validate                                 | `bun run validate`                      |                                |            |       |
| integration                              | `bun run test:integration`              |                                |            |       |
| coverage                                 | `COVERAGE_GATE=1 bun run test:coverage` |                                |            |       |
| build                                    | `bun run build`                         |                                |            |       |
| security                                 | `bun run security`                      |                                |            |       |
| e2e (local; required for UI/e2e changes) | `bun run e2e` or focused spec           |                                |            |       |

- PR CI status on the head commit:
- Independent review (agent:code-reviewer): Blocker / Major / Minor counts and IDs:

## Risks and follow-ups

<!-- Known risks, flaky observations disclosed (even if a retry passed), deferred items with their issue numbers, and any decision still open with its owner. -->

-

## Author checklist

- [ ] Only owned, in-scope files changed; no unrelated refactors or drive-by fixes
- [ ] Tests and docs updated for every contract that changed
- [ ] Every gate row above has a result and the SHA it ran on
- [ ] UI change: screenshots in both themes and at 375×812 + 200% text attached
- [ ] No secrets, generated noise or build output committed
- [ ] This PR is not merged by its author and does not imply release approval
