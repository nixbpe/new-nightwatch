---
description: Implement one approved GitHub issue and open a merge-ready PR
---

Use skill:`delivery-orchestration` and skill:`git-workflow`.

Run this command as agent:`tech-lead`. The Technical Lead reads the issue, writes the Technical Spec, splits and dispatches Tasks, reviews and decides; it never edits code itself. Workers implement, run checks and commit, and agent:`software-engineer` as integration owner pushes and opens the PR.

Require one GitHub issue URL or issue number as the command argument. Implement that issue end to end according to the issue, repository instructions, accepted specs, dependencies and acceptance criteria.

## Authorization

- Start work now. The issue is the approved scope and this command approves the Technical Spec, so write the spec per skill:`technical-spec` and continue without waiting; stop only for an open decision the issue does not settle.
- Override any existing `COMMIT_MODE: none` with `COMMIT_MODE: owned-slice`.
- Set `STOP_AT: merge-ready`.
- You may commit, push the current working branch and open one PR for this issue. If the current branch is the default branch, work on a new branch named for the issue. This overrides, for this issue only, the rules that forbid workers to push or open a PR.
- Do not merge the PR or start dependent follow-up work.

Complete the implementation and tests. Where required by the issue or spec, also complete runtime smoke checks, accessibility checks and `PROOF`.

After all writers stop:

1. Run final code review and resolve all in-scope findings.
2. Run every required focused check and the repository's full quality gates.
3. Push and open the PR only when all required local checks pass. If any required check fails or is not run, report the blocker without claiming completion or opening a PR.
4. Wait for required PR CI checks to pass, then report the work as merge-ready.

The PR body follows file:`.github/PULL_REQUEST_TEMPLATE.md` with every required section filled: the issue-closing reference, scope, non-goals, acceptance coverage, evidence, the quality-gate table with results and commit SHA, and known risks. Where required by the issue or spec, include `PROOF`, security or isolation evidence and downstream handoff contracts. The Technical Lead reviews it with command:`/review-pr`.

Return the PR URL, commit SHA, implementation summary, review and verification results, CI status, and confirmation that the PR was not merged and dependent work was not started.
